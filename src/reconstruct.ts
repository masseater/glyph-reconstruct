#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync, readdirSync, existsSync, readFileSync, copyFileSync } from "node:fs";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import Bottleneck from "bottleneck";
import { z } from "zod";

// Rate limiter: Gemini API limits (adjust based on your tier)
const RPM = Number(process.env.GEMINI_RPM) || 300;
const limiter = new Bottleneck({
  maxConcurrent: 100,
  minTime: Math.ceil(60000 / RPM) // ms between requests to stay under RPM
});

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;
      const status = e?.status;
      const isRetryable =
        status === 503 ||
        status === 429 ||
        e?.message?.includes("Empty response");
      if (isRetryable && attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

// ========================================
// 固定値: ここで文字範囲を指定
// ========================================
const START_CHAR = "あ";
const END_CHAR = "ん";

// Gemini 3 models
const VISION_MODEL_NAME = "gemini-3-pro-preview";
const IMAGE_MODEL_NAME = "gemini-3-pro-image-preview";
const API_KEY = process.env.GEMINI_API_KEY;

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!_client) {
    if (!API_KEY) {
      throw new Error("GEMINI_API_KEY is required");
    }
    _client = new GoogleGenAI({ apiKey: API_KEY });
  }
  return _client;
}

// Zod schema for structured output
const glyphDescriptionSchema = z.toJSONSchema(z.object({
  codePoint: z.string().describe("Unicode code point (e.g., U+3042)"),
  description: z.string().describe("Detailed visual description of the glyph shape"),
  visualTags: z.array(z.string()).describe("Visual characteristics tags")
}));

// ========================================
// Step 1: Vision AIでテキスト記述を生成
// ========================================
const SYSTEM_PROMPT = [
  "You are a typography expert analyzing glyph characteristics.",
  "Generate detailed visual descriptions for font reconstruction.",
  "Focus on: stroke weight, terminals, serifs, contrast, proportions, counters.",
  "NEVER mention character names or letters, only describe visual shapes."
].join("\n");

function buildUserPrompt(char: string): string {
  const codePoint = `U+${char.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}`;
  return [
    `Analyze the glyph with code point ${codePoint}.`,
    "Provide detailed visual description that enables accurate reconstruction from description alone."
  ].join("\n");
}

type Description = {
  codePoint: string;
  description: string;
  visualTags: string[];
};

async function generateDescription(char: string): Promise<Description> {
  return withRetry(async () => {
    const response = await getClient().models.generateContent({
      model: VISION_MODEL_NAME,
      contents: buildUserPrompt(char),
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseJsonSchema: glyphDescriptionSchema,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        temperature: 0
      }
    });

    const text = response.text;

    if (!text) {
      throw new Error(`Empty response: ${JSON.stringify(response, null, 2)}`);
    }

    const parsed = JSON.parse(text);

    return {
      codePoint: parsed.codePoint,
      description: parsed.description,
      visualTags: parsed.visualTags
    };
  });
}

// ========================================
// Step 2: 画像生成AIで画像を作成
// ========================================
function buildImagePrompt(description: string): string {
  return [
    `Create a typographic glyph with these characteristics: ${description}`,
    "Transform this glyph through AI-style image-to-image distortion.",
    "The character should retain its basic shape but become organically warped, with strokes that bleed, merge, and develop complex textures.",
    "Imagine the glyph has been processed through multiple AI generations - edges become fuzzy, details emerge like townscapes or abstract patterns within the strokes.",
    "The result should look like a dreamlike, slightly corrupted version of the original character - recognizable but mutated.",
    "Render in black on white background, centered.",
    "Output only the glyph, no labels, no annotations."
  ].join(" ");
}

async function generateGlyphImage(description: string): Promise<string> {
  return withRetry(async () => {
    const prompt = buildImagePrompt(description);

    const response = await getClient().models.generateContent({
      model: IMAGE_MODEL_NAME,
      contents: prompt,
      config: {
        responseModalities: ["image", "text"],
        imageConfig: {
          aspectRatio: "1:1"
        },
        temperature: 1.5,
      }
    });

    const parts = response.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p: any) => p.inlineData);

    if (!imagePart?.inlineData?.data) {
      throw new Error(`No image data in response: ${JSON.stringify(response, null, 2)}`);
    }

    const base64Data = imagePart.inlineData.data;
    const mimeType = imagePart.inlineData.mimeType;

    return `data:${mimeType};base64,${base64Data}`;
  });
}

function findLatestOutputDir(): string | null {
  const outputBase = "output";
  if (!existsSync(outputBase)) return null;

  const dirs = readdirSync(outputBase, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()
    .reverse();

  return dirs.length > 0 ? `${outputBase}/${dirs[0]}` : null;
}

function copyDescriptionsFromDir(sourceDir: string, targetDir: string, chars: string[]): Map<string, Description> {
  const descriptions = new Map<string, Description>();

  for (const char of chars) {
    const sourceFile = `${sourceDir}/description-${char}.json`;
    const targetFile = `${targetDir}/description-${char}.json`;

    if (existsSync(sourceFile)) {
      copyFileSync(sourceFile, targetFile);
      const content = readFileSync(sourceFile, "utf-8");
      descriptions.set(char, JSON.parse(content));
    }
  }

  return descriptions;
}

async function main() {
  const reuseDescriptions = process.argv.includes("--reuse-descriptions");

  // 新しいディレクトリを作る前に最新ディレクトリを取得
  const latestDir = reuseDescriptions ? findLatestOutputDir() : null;

  const sessionId = randomUUID();
  const timestamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" }).replace(/:/g, "-").replace(/ /g, "T");
  const outputDir = `output/${timestamp}`;

  mkdirSync(outputDir, { recursive: true });
  console.error(`Output: ${outputDir}\n`);

  const promptTemplatePath = `${outputDir}/prompt-template.txt`;
  writeFileSync(promptTemplatePath, `=== System Prompt ===\n${SYSTEM_PROMPT}\n\n=== User Prompt Template ===\nAnalyze the glyph with code point [CODE_POINT].\nProvide detailed visual description that enables accurate reconstruction from description alone.`);

  const startCode = START_CHAR.codePointAt(0)!;
  const endCode = END_CHAR.codePointAt(0)!;

  const chars: string[] = [];
  for (let code = startCode; code <= endCode; code++) {
    chars.push(String.fromCodePoint(code));
  }

  function createBar(label: string, total: number) {
    let done = 0;
    let processing = 0;

    const render = () => {
      const width = 40;
      const doneWidth = Math.floor((done / total) * width);
      const processingWidth = Math.min(Math.floor((processing / total) * width), width - doneWidth);
      const emptyWidth = width - doneWidth - processingWidth;

      const bar = '\x1b[32m' + '█'.repeat(doneWidth) +
                  '\x1b[33m' + '▓'.repeat(processingWidth) +
                  '\x1b[90m' + '░'.repeat(emptyWidth) +
                  '\x1b[0m';

      process.stderr.write(`\r${label} [${bar}] ${done}/${total} (${processing} processing)`);
    };

    return {
      start: () => render(),
      incProcessing: () => { processing++; render(); },
      decProcessingIncDone: () => { processing--; done++; render(); },
      stop: () => process.stderr.write('\n')
    };
  }

  // Phase 1: 全文字のdescription生成（または流用）
  let descriptions: { char: string; desc: Description }[];

  if (reuseDescriptions) {
    if (!latestDir) {
      console.error("Error: No previous output directory found to reuse descriptions from.");
      process.exit(1);
    }
    console.error(`Reusing descriptions from: ${latestDir}`);
    const descMap = copyDescriptionsFromDir(latestDir, outputDir, chars);
    descriptions = chars
      .filter(char => descMap.has(char))
      .map(char => ({ char, desc: descMap.get(char)! }));
    console.error(`Copied ${descriptions.length}/${chars.length} descriptions\n`);
  } else {
    const bar1 = createBar('Descriptions', chars.length);
    bar1.start();
    descriptions = await Promise.all(
      chars.map(char => limiter.schedule(async () => {
        bar1.incProcessing();
        const desc = await generateDescription(char);
        const descPath = `${outputDir}/description-${char}.json`;
        writeFileSync(descPath, JSON.stringify(desc, null, 2));
        bar1.decProcessingIncDone();
        return { char, desc };
      }))
    );
    bar1.stop();
  }

  // Phase 2: 全文字の画像生成
  const bar2 = createBar('Images      ', chars.length);
  bar2.start();
  const results = await Promise.all(
    descriptions.map(({ char, desc }) => limiter.schedule(async () => {
      bar2.incProcessing();
      const dataUri = await generateGlyphImage(desc.description);
      const outputPath = `${outputDir}/${char}.png`;
      const base64Data = dataUri.split(",")[1];
      const buffer = Buffer.from(base64Data, "base64");
      writeFileSync(outputPath, buffer);
      bar2.decProcessingIncDone();
      return { char, description: desc, image: outputPath };
    }))
  );
  bar2.stop();

  console.error(`\nComplete! Session: ${sessionId}`);
  console.log(JSON.stringify({ sessionId, outputDir, results }, null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
}
