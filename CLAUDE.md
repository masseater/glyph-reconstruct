# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# ai-font

A two-stage AI pipeline using Google Gemini 3 that reconstructs glyphs: text input → Gemini vision description → Gemini image generation.

## Architecture

```
Character Input → Gemini 3 Pro (Vision) → Text Description → Gemini 3 Pro Image → PNG Image
```

**Two-stage pipeline:**
1. **Gemini Vision** (src/reconstruct.ts): Analyzes glyph visual characteristics and generates structured JSON descriptions
2. **Gemini Image Generation** (src/reconstruct.ts): Reconstructs glyph images from text descriptions with AI-style distortion

**Key design principles:**
- Vision descriptions must NOT mention character names/letters, only visual shapes
- Uses `@google/genai` SDK with `generateContent()` for both vision and image generation
- Vision API uses `responseMimeType: "application/json"` with `responseJsonSchema` for structured output
- Image generation uses `responseModalities: ["image", "text"]` with `imageConfig`
- Zod schemas define expected outputs: `{codePoint, description, visualTags[]}`
- Each run gets a unique session ID for provenance tracking

## Commands

```bash
bun install              # Install dependencies
bun run reconstruct      # Run reconstruction pipeline
bun run reconstruct --reuse-descriptions  # Skip description generation, reuse from latest run
```

## Environment Variables

```bash
GEMINI_API_KEY=your-gemini-api-key  # Required, used for both vision and image
```

Models are hardcoded in src/reconstruct.ts:45-46:
- Vision: `gemini-3-pro-preview`
- Image: `gemini-3-pro-image-preview`

## Code Structure

### src/reconstruct.ts (Single-file Pipeline)
All pipeline logic is in this single file:

**Configuration constants:**
```typescript
const START_CHAR = "あ";  // First character in range (line 41)
const END_CHAR = "ん";    // Last character in range (line 42)
```

**Key functions:**
- `generateDescription(char)` - Calls Gemini vision with JSON schema (line 92)
- `generateGlyphImage(description)` - Generates distorted glyph image (line 137)
- `buildImagePrompt()` - Creates prompt for AI-style "dreamlike, slightly corrupted" glyphs (line 125)
- `withRetry()` - Exponential backoff for 503/429 errors (line 15)

**Rate limiting:** Uses `Bottleneck` with `maxConcurrent: 100` and dynamic minTime based on GEMINI_RPM

## Output Files

```
output/
  {timestamp}/                    # ISO timestamp with Tokyo timezone
    prompt-template.txt           # System/user prompt template
    description-{char}.json       # Gemini vision output per character
    {char}.png                    # Generated glyph images
```

## Modifying the Pipeline

**To change character range:** Edit `START_CHAR` and `END_CHAR` in src/reconstruct.ts:41-42

**To change Gemini vision prompts:**
- System prompt: `SYSTEM_PROMPT` constant (src/reconstruct.ts:71)
- User prompt: `buildUserPrompt()` function (src/reconstruct.ts:78)

**To change image generation prompts:** Edit `buildImagePrompt()` in src/reconstruct.ts:125
