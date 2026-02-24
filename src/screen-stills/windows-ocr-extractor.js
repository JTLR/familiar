// Windows OCR extractor using the Windows.Media.Ocr WinRT API.
// Follows the same extractor contract as Apple Vision and LLM extractors.
// Routes through a PowerShell helper script that calls the native Windows OCR engine.
// Passes foreground window metadata (captured at screenshot time) through to the
// markdown formatter for real app/window/URL frontmatter fields.

const {
  runWindowsOcrBatch,
  canRunWindowsOcr,
  buildMarkdownLayoutFromWindowsOcr
} = require('../ocr/windows-ocr')
const { normalizeAppName, normalizeWindowTitle, extractUrlFromTitle } = require('../ocr/windows-foreground')

/**
 * Creates a Windows OCR extractor that implements the standard extractor contract.
 * Used as the "Local" processing engine on Windows where Apple Vision is unavailable.
 */
const createWindowsOcrExtractor = ({
  logger = console,
  runWindowsOcrBatchImpl = runWindowsOcrBatch,
  canRunWindowsOcrImpl = canRunWindowsOcr,
  buildMarkdownImpl = buildMarkdownLayoutFromWindowsOcr
} = {}) => {
  const canRun = async () => {
    if (!canRunWindowsOcrImpl()) {
      return {
        ok: false,
        reason: 'not_windows',
        message: 'Windows OCR is only available on Windows.'
      }
    }
    return { ok: true }
  }

  const extractBatch = async ({ rows } = {}) => {
    if (!Array.isArray(rows) || rows.length === 0) {
      return new Map()
    }

    // Batch all images into a single PowerShell invocation to amortise the ~1s cold start.
    const imagePaths = rows.map((row) => row.image_path)
    const ocrResults = await runWindowsOcrBatchImpl({ imagePaths, logger })

    const results = new Map()
    for (const row of rows) {
      const ocrResult = ocrResults.get(row.image_path)
      if (!ocrResult) {
        continue
      }

      // Build window metadata from queue data (captured at screenshot time).
      const app = normalizeAppName(row.app_name)
      const titleNorm = normalizeWindowTitle(row.window_title)
      const url = extractUrlFromTitle(row.window_title, app)
      const windowMeta = {
        app,
        title: row.window_title || null,
        titleNorm,
        url
      }

      const markdown = buildMarkdownImpl({
        imagePath: row.image_path,
        meta: ocrResult.meta,
        lines: ocrResult.lines,
        words: ocrResult.words || [],
        windowMeta
      })

      results.set(String(row.id), {
        markdown,
        providerLabel: 'windows_ocr',
        modelLabel: 'windows-media-ocr'
      })
    }

    return results
  }

  return {
    type: 'windows_ocr',
    // PowerShell process is heavyweight; bound parallelism like Apple Vision.
    execution: { maxParallelBatches: 2 },
    canRun,
    extractBatch
  }
}

module.exports = {
  createWindowsOcrExtractor
}
