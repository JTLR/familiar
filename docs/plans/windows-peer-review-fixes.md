# Peer Review Fixes — Windows Support Branch

**Overall Progress:** `100%`

## TLDR

Fix 13 confirmed issues from the peer review of the windows-support branch (27 files, 4 commits). The CRITICAL + HIGH fixes address a broken OCR pipeline in production builds: the PowerShell script isn't bundled, settings don't recognise the `windows_ocr` type, and the PS1 has resource leaks + scoping bugs. Medium/Low fixes cover platform-specific UI text, test channel exposure, and code quality.

## Critical Decisions

- **Fix order: pipeline-first** — CRITICAL #1 + HIGH #2 are tightly coupled (bundling + settings recognition). Fix together so the OCR pipeline works end-to-end in production.
- **`windows_ocr` as third recognised type** — Add alongside `apple_vision_ocr` and `llm` in all normalisation paths. Don't collapse it into `apple_vision_ocr` — they're distinct extractors.
- **PS1 fixes are surgical** — Add `.Dispose()` calls and variable resets, don't refactor the PowerShell structure.
- **Skip partially-valid findings** — `quitAndInstall` args (#8), tray click UX (#9), atomic writeFileSync (#19) are acknowledged but not worth the risk of changing behaviour pre-merge.

## Tasks

- [x] 🟩 **Step 1: Fix CRITICAL — Bundle windows-ocr.ps1 + .asar path detection**
  - [x] 🟩 Add `windows-ocr.ps1` to `win.extraResources` in `package.json`
  - [x] 🟩 Add `isPackaged` / `process.resourcesPath` path resolution in `src/ocr/windows-ocr.js`

- [x] 🟩 **Step 2: Fix HIGH — Recognise `windows_ocr` extractor type in settings**
  - [x] 🟩 `src/settings.js` — Recognise `windows_ocr` alongside `apple_vision_ocr`
  - [x] 🟩 `src/ipc/settings.js` — Change Windows default to `'windows_ocr'`
  - [x] 🟩 `src/ipc/settings.js` — Change error-fallback Windows default to `'windows_ocr'`
  - [x] 🟩 `src/ipc/settings.js` — Change save-handler normalisation to recognise `windows_ocr`

- [x] 🟩 **Step 3: Fix HIGH — Add timeout to OCR PowerShell process**
  - [x] 🟩 `src/ocr/windows-ocr.js` — Add proportional timeout (30s base + 5s per image)

- [x] 🟩 **Step 4: Fix HIGH — Dispose WinRT objects in PS1**
  - [x] 🟩 `src/ocr/windows-ocr.ps1` — Add `$bitmap.Dispose()` in success and error paths
  - [x] 🟩 `$decoder` (BitmapDecoder) doesn't implement IDisposable — skipped correctly

- [x] 🟩 **Step 5: Fix HIGH — Variable scoping in PS1 catch block**
  - [x] 🟩 `src/ocr/windows-ocr.ps1` — Initialise `$isPreprocessed`, `$ocrInputPath`, `$bitmap`, `$fileStream` at top of each iteration

- [x] 🟩 **Step 6: Fix MEDIUM — Gate E2E IPC channels behind env var**
  - [x] 🟩 `src/dashboard/preload.js` — E2E channels gated behind `FAMILIAR_E2E === '1'`

- [x] 🟩 **Step 7: Fix MEDIUM — Platform check for Windows OCR extractor**
  - [x] 🟩 `src/screen-stills/stills-markdown-extractor.js` — Explicit `=== 'win32'` check with LLM fallback for unknown platforms

- [x] 🟩 **Step 8: Fix MEDIUM — Platform-aware UI text in dashboard**
  - [x] 🟩 HTML uses neutral defaults with `data-platform-text` attributes
  - [x] 🟩 `renderer.js` `applyPlatformText()` sets correct text on load (system tray vs Dock, Windows OCR vs Apple's OCR, permission hints)
  - [x] 🟩 Permission check buttons hidden on Windows

- [x] 🟩 **Step 9: Fix MEDIUM — PS1 array performance**
  - [x] 🟩 `$lineTexts` → `List[string]`, `$wordData` → `List[hashtable]`

- [x] 🟩 **Step 10: Fix LOW — Extract default interval constant**
  - [x] 🟩 `DEFAULT_CAPTURE_INTERVAL_SECONDS` added to `src/const.js`
  - [x] 🟩 Replaced 3 duplicated expressions in `main.js`, `ipc/settings.js` (x2)

## Documentation Check

- **CLAUDE.md** — No changes needed (this is the Familiar fork, not the command centre)
- **`docs/reference/`** — No reference docs in the Familiar fork that need updating
- **MEMORY.md** — Updated (peer review completion noted)
