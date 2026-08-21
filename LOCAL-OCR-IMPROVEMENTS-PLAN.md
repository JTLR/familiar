# Local OCR Improvements Plan

**Overall Progress:** `85%`

## TLDR
Improve Familiar's Windows local OCR mode so it produces useful metadata and structured layout, removing the need for cloud/LLM extraction. Three improvements: window metadata capture at screenshot time, bounding box layout inference, and image preprocessing for OCR accuracy.

## Critical Decisions
- **Window metadata capture via PowerShell**: Consistent with existing OCR pattern. ~1s cold start is acceptable since it runs async alongside the 15s capture interval, doesn't block anything.
- **Metadata stored in queue DB, not in-memory**: Window info must be captured at screenshot time (foreground window changes), so it's stored in `stills_queue` and forwarded to the extractor later.
- **Bounding boxes from existing OcrLine.Words API**: Windows.Media.Ocr already returns word-level BoundingRect data. Currently discarded - just need to extract and return it.
- **Layout heuristic, not ML**: Simple coordinate-based rules (top strip = header, left column = sidebar, main area = content). Won't match LLM quality but massively better than "UNCLEAR".
- **Image preprocessing in PowerShell**: Use System.Drawing (already available in .NET/WinRT context) to sharpen and convert to grayscale before OCR. Avoids adding Node.js native deps.

## Tasks:

- [x] 🟩 **Step 1: Window metadata capture module**
  - [x] 🟩 Create `src/ocr/windows-foreground.ps1` - PowerShell script using Win32 `GetForegroundWindow()`, `GetWindowText()`, and `GetWindowThreadProcessId()` to return `{ title, app, pid }` as JSON
  - [x] 🟩 Create `src/ocr/windows-foreground.js` - Node.js wrapper (same pattern as `windows-ocr.js`): spawns `powershell.exe`, parses JSON result, handles errors gracefully (returns `null` fields on failure, never throws)
  - [x] 🟩 Normalise app name: strip `.exe`, lowercase (e.g. `"chrome"`, `"code"`, `"slack"`)
  - [x] 🟩 Normalise window title: extract meaningful part (browsers often include ` - Google Chrome` suffix, VS Code includes path, etc.)

- [x] 🟩 **Step 2: Thread metadata through the pipeline**
  - [x] 🟩 Add columns to `stills_queue` schema: `window_title TEXT`, `app_name TEXT` (migration-safe: use `ALTER TABLE ADD COLUMN` with defaults, not table recreation)
  - [x] 🟩 Update `stills-queue.js` `enqueueCapture()` to accept and store `windowTitle`, `appName`
  - [x] 🟩 Update `stills-queue.js` `getPendingBatch()` SELECT to return `window_title`, `app_name`
  - [x] 🟩 Update `recorder.js` `captureNext()`: call `getWindowMetadata()` alongside screenshot capture, pass result to `enqueueCapture()`

- [x] 🟩 **Step 3: Use metadata in markdown output**
  - [x] 🟩 Update `windows-ocr-extractor.js` `extractBatch()`: pass `row.window_title`, `row.app_name` through to `buildMarkdownImpl()`
  - [x] 🟩 Update `windows-ocr.js` `buildMarkdownLayoutFromWindowsOcr()`: accept `windowMeta` param, replace hardcoded `unknown` values with real data (falling back to `unknown` if not available)
  - [x] 🟩 Map metadata to frontmatter fields: `app` = normalised app name, `window_title_raw` = full title, `window_title_norm` = cleaned title, `url` = extracted from browser title if detectable

- [x] 🟩 **Step 4: Extract bounding boxes from OCR**
  - [x] 🟩 Update `windows-ocr.ps1`: for each `OcrLine`, iterate `.Words` and collect `BoundingRect` (x, y, width, height) per word. Return as `words: [{ text, x, y, w, h }]` alongside existing `lines` array
  - [x] 🟩 Update `windows-ocr.js` `runWindowsOcrBatch()`: parse the new `words` array from JSON results, pass through to the markdown builder
  - [x] 🟩 Keep the flat `lines` array for backward compat (the `# OCR` section stays as-is)

- [x] 🟩 **Step 5: Layout inference from bounding boxes**
  - [x] 🟩 Implement `inferLayoutRegions({ words, imageWidth, imageHeight })` in `windows-ocr.js` (new function)
  - [x] 🟩 Heuristic rules: group words by vertical position into rows, then identify regions:
    - Top ~5-8% of screen height = `[HEADER]` (title bars, menus, toolbars)
    - Left ~15-25% if text density is high = `[SIDEBAR]` (nav panels, file trees)
    - Remaining area = `[CONTENT]` (main working area)
    - Detect grid: if two distinct horizontal clusters of text exist, set `grid: 2x1`; otherwise `grid: 1x1`
  - [x] 🟩 Each region gets bounding box coordinates and concatenated text from its words
  - [x] 🟩 Update `buildMarkdownLayoutFromWindowsOcr()` to use inferred regions instead of hardcoded single `[CONTENT]` block
  - [x] 🟩 Fall back to current single `[CONTENT]` block if no words/bounds available

- [x] 🟩 **Step 6: Image preprocessing for OCR accuracy**
  - [x] 🟩 Update `windows-ocr.ps1`: before running OCR, preprocess the bitmap:
    - Convert to grayscale + contrast boost (reduces noise from syntax highlighting, UI chrome colours)
    - Uses GDI+ ColorMatrix (System.Drawing) for single-pass processing
  - [x] 🟩 Make preprocessing configurable: `-Preprocess` flag passed from Node.js (defaults to `true`)
  - [ ] 🟥 Benchmark: compare OCR output on same screenshots with and without preprocessing to confirm improvement (manual step after deploy)

- [ ] 🟥 **Step 7: Test and verify** (manual — restart Familiar and capture a session)
  - [ ] 🟥 Run Familiar with changes, capture a full session
  - [ ] 🟥 Verify frontmatter has real `app`, `window_title_raw`, `window_title_norm` values
  - [ ] 🟥 Verify `[HEADER]`, `[SIDEBAR]`, `[CONTENT]` layout regions appear with coordinates
  - [ ] 🟥 Verify OCR accuracy improved on code/terminal content
  - [ ] 🟥 Test `/familiar` skill filtering by app and window title
  - [ ] 🟥 Test edge cases: no foreground window (lock screen), full-screen app, multi-monitor
