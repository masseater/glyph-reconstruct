# ai-font

Google Gemini 3を使用してひらがなグリフをAIスタイルで再構築するパイプライン。

## 概要

文字を入力すると、以下の2段階でグリフ画像を生成します：

1. **Vision分析**: Gemini 3 Proが文字の視覚的特徴をテキストで記述
2. **画像生成**: その記述のみをもとにGemini 3 Pro Imageがグリフ画像を再構築

## セットアップ

### 必要なもの

- [Bun](https://bun.sh/) (JavaScriptランタイム)
- Google AI Studio APIキー ([取得はこちら](https://aistudio.google.com/apikey))

### インストール

```bash
git clone https://github.com/your-username/ai-font.git
cd ai-font
bun install
```

### 環境変数

```bash
export GEMINI_API_KEY="your-api-key-here"
```

## 使い方

### 基本実行

```bash
bun run reconstruct
```

デフォルトでは「あ」から「ん」までのひらがなを処理します。

### 画像のみ再生成

```bash
bun run reconstruct --reuse-descriptions
```

前回の実行で生成したテキスト記述を再利用し、画像生成のみ実行します。

## 出力

`output/{timestamp}/` ディレクトリに以下が生成されます：

```
output/2024-01-15T12-30-00/
├── prompt-template.txt      # 使用したプロンプト
├── description-あ.json      # 各文字の視覚的記述
├── description-い.json
├── ...
├── あ.png                   # 生成されたグリフ画像
├── い.png
└── ...
```

## 文字範囲の変更

`src/reconstruct.ts` の41-42行目を編集：

```typescript
const START_CHAR = "あ";  // 開始文字
const END_CHAR = "ん";    // 終了文字
```

例えば漢字を生成したい場合：

```typescript
const START_CHAR = "一";
const END_CHAR = "龍";
```

## ライセンス

GPL-3.0
