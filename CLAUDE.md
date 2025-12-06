# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# ai-font

A two-stage AI pipeline using Google Gemini that reconstructs glyphs: text input → Gemini vision description → Gemini image generation.

## Architecture

```
Character Input → Gemini (Vision) → Text Description → Gemini (Image) → PNG Image
```

**Two-stage pipeline:**
1. **Gemini Vision** (src/reconstruct.ts): Analyzes glyph visual characteristics and generates natural language descriptions
2. **Gemini Image Generation** (src/image-generator.ts): Reconstructs glyph images from text descriptions

**Key design principles:**
- Vision descriptions must NOT mention character names/letters, only visual shapes
- Vision API uses `@google/generative-ai` SDK with `generateContent()`
- Image generation uses Google Generative Language REST API directly
- Gemini returns JSON wrapped in markdown code blocks - must be cleaned before parsing
- Zod schemas define expected outputs: `{codePoint, description, visualTags[]}`
- Each run gets a unique session ID for provenance tracking

## Commands

```bash
# Install dependencies
bun install

# Run reconstruction pipeline
bun run reconstruct
```

## Environment Variables

```bash
# Gemini Vision
VISION_MODEL_NAME=gemini-2.0-flash-exp
VISION_API_KEY=your-gemini-api-key

# Gemini Image Generation
IMAGE_MODEL_NAME=imagen-3.0-generate-001
IMAGE_API_KEY=your-gemini-api-key  # Can be same as VISION_API_KEY
```

**Important notes:**
- Gemini uses `generateContent()` (not `generateObject()`) - returns text that must be parsed
- Response cleaning is required: strips ```json and ``` markdown wrappers
- Both vision and image generation use Google Generative Language API

## Code Structure

### src/reconstruct.ts (Main Pipeline)
**Configuration constants at top of file:**
```typescript
const START_CHAR = "あ";  // First character in range
const END_CHAR = "ん";    // Last character in range
```

**Pipeline flow:**
1. `generateDescription(char)` - Calls Gemini via `@google/generative-ai`
2. Cleans JSON response (removes markdown code blocks)
3. Saves description JSON to `output/{timestamp}/description-{char}.json`
4. `generateGlyphImage()` - Generates image from description
5. `downloadAndSaveImage()` - Saves PNG to `output/{timestamp}/{char}.png`

**Concurrency:** Uses `p-limit` with `MAX_CONCURRENT = 20` for batch processing

### src/image-generator.ts
- `generateGlyphImage()`: Calls Google Generative Language API directly
- Uses `responseModalities: ["image"]` with `imageConfig` for image generation
- `buildImagePrompt()`: Constructs image generation prompt emphasizing "no text, no labels, no annotations"
- `downloadAndSaveImage()`: Handles both data URIs and HTTP URLs
- Returns base64-encoded images as data URIs

## Output Files

```
output/
  {timestamp}/                    # Created by reconstruct.ts
    prompt-template.txt           # System/user prompt template
    description-{char}.json       # Gemini vision output per character
    {char}.png                    # Generated glyph images
```

## Modifying the Pipeline

**To change character range:** Edit `START_CHAR` and `END_CHAR` in src/reconstruct.ts:12-13

**To change Gemini vision prompts:**
- System prompt: `SYSTEM_PROMPT` constant (src/reconstruct.ts:42)
- User prompt: `buildUserPrompt()` function (src/reconstruct.ts:50)

**To change image generation prompts:** Edit `buildImagePrompt()` in src/image-generator.ts:66

**JSON cleaning:** If Gemini response format changes, update the regex in src/reconstruct.ts:73