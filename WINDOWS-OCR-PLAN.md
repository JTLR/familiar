# Windows OCR Plan

**Overall Progress:** `90%`

## TLDR
Replace Tesseract.js (garbage output on screenshots) with Windows.Media.Ocr via a PowerShell helper script. Mirrors the Apple Vision binary pattern — platform-native OCR invoked as a subprocess, JSON output parsed into familiar-layout-v0 markdown. "Local" in the UI means Apple Vision on macOS, Windows OCR on Windows. No UI changes beyond updating the description label.

## Critical Decisions
- **Windows.Media.Ocr via PowerShell 5.1** — Built-in on all Windows 10+, good at screen content, free, no API key. Must use `powershell.exe` (not `pwsh.exe`) for WinRT type loading.
- **Batch multiple images per invocation** — PowerShell cold start is ~1s. Batching amortises this across all images in a tick. Script accepts multiple paths, outputs JSON keyed by path.
- **Match Apple Vision output shape** — Script outputs `{ meta, lines }` per image so we can reuse `buildMarkdownLayoutFromOcr()` directly. No bounding rects in v1.
- **Remove Tesseract entirely** — Not fit for screenshot OCR. No fallback retention.

## Tasks:

- [x] 🟩 **Step 1: Create Windows OCR PowerShell script**
  - [x] 🟩 New file `src/ocr/windows-ocr.ps1`
  - [x] 🟩 Accept multiple image paths as arguments
  - [x] 🟩 Load WinRT types, create OCR engine from user profile languages
  - [x] 🟩 Process each image: StorageFile → Stream → BitmapDecoder → SoftwareBitmap → OCR
  - [x] 🟩 Output JSON to stdout: object keyed by image path, each value has `{ meta: { image_width, image_height }, lines: string[] }`
  - [x] 🟩 Handle errors per-image (skip failed images, include in output)

- [x] 🟩 **Step 2: Create Node.js wrapper (`windows-ocr.js`)**
  - [x] 🟩 New file `src/ocr/windows-ocr.js`
  - [x] 🟩 `runWindowsOcrBatch({ imagePaths })` — spawns `powershell.exe` with script path + image args, parses JSON stdout
  - [x] 🟩 `canRunWindowsOcr()` — checks `process.platform === 'win32'`
  - [x] 🟩 50MB stdout buffer (matching Apple Vision pattern)
  - [x] 🟩 `buildMarkdownLayoutFromWindowsOcr()` — familiar-layout-v0 format with Windows-specific metadata

- [x] 🟩 **Step 3: Create Windows OCR extractor**
  - [x] 🟩 New file `src/screen-stills/windows-ocr-extractor.js`
  - [x] 🟩 Implements extractor contract: `type`, `execution`, `canRun()`, `extractBatch()`
  - [x] 🟩 `extractBatch()` calls `runWindowsOcrBatch()` with all row image paths, maps results back to row IDs
  - [x] 🟩 Uses `buildMarkdownLayoutFromWindowsOcr()` with `escapeForQuotedBullet` reused from apple-vision-ocr.js
  - [x] 🟩 `maxParallelBatches: 2` (bounded like Apple Vision)

- [x] 🟩 **Step 4: Route factory and clean up Tesseract**
  - [x] 🟩 `stills-markdown-extractor.js`: Replace Tesseract import/routing with Windows OCR extractor
  - [x] 🟩 Delete `src/screen-stills/tesseract-ocr-extractor.js`
  - [x] 🟩 `npm uninstall tesseract.js` (removed 13 packages)
  - [x] 🟩 Update `processing-engine.js` label from "Tesseract" to "Windows OCR"

- [ ] 🟨 **Step 5: Test**
  - [x] 🟩 Select "Local" in dashboard on Windows, verify OCR output is readable text
  - [x] 🟩 Verify markdown files have `extractor: windows-ocr` and `ocr_engine: windows-media-ocr` metadata
  - [ ] 🟥 Verify switching to "Cloud" still works
  - [x] 🟩 Verify macOS path unaffected (code review — all 6 routing paths verified correct)
  - [x] 🟩 Verify no stale Tesseract references in src/

## Bugs Fixed During Testing
- **PowerShell backtick escaping** — `'IAsyncOperation``1'` (two backticks in single quotes) didn't match .NET type name. Fixed to single backtick.
- **JSON control characters** — Windows OCR returns text with control chars that break `ConvertTo-Json`. Fixed with Node.js-side sanitization before `JSON.parse()`.
- **Capture scale** — 0.5x scale produced unreadable 960x540 images. Changed to 1.0x on Windows (macOS stays 0.5x).
