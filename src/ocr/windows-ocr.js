// Windows OCR integration using the Windows.Media.Ocr WinRT API.
// Mirrors the apple-vision-ocr.js pattern: a platform-native helper invoked as a subprocess,
// returning JSON with { meta, lines } per image.
//
// The PowerShell script (windows-ocr.ps1) handles the WinRT interop.
// This module provides the Node.js wrapper and markdown formatter.

const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const { escapeForQuotedBullet } = require('./apple-vision-ocr')

const execFileAsync = promisify(execFile)

// In production builds, the .ps1 is unpacked via extraResources to
// resources/windows-ocr.ps1 (outside the .asar archive, where
// PowerShell can actually read it). In dev, use the source tree path.
const isPackaged = __dirname.includes('.asar')
const SCRIPT_PATH = isPackaged
  ? path.join(process.resourcesPath, 'windows-ocr.ps1')
  : path.join(__dirname, 'windows-ocr.ps1')

/**
 * Runs Windows OCR on a batch of images in a single PowerShell invocation.
 * Amortises the ~1s PowerShell cold start across all images in the batch.
 *
 * @param {Object} options
 * @param {string[]} options.imagePaths - Absolute paths to image files.
 * @param {boolean} [options.preprocess=true] - Whether to preprocess images (grayscale + contrast) before OCR.
 * @param {Object} [options.logger=console] - Logger instance.
 * @returns {Map<string, { meta: Object, lines: string[], words: Object[] }>} Results keyed by image path.
 *   Missing keys indicate the image failed (error logged).
 */
const runWindowsOcrBatch = async ({ imagePaths, preprocess = true, logger = console } = {}) => {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
    return new Map()
  }

  // Must use powershell.exe (5.1), not pwsh.exe (7+).
  // WinRT type loading only works in Windows PowerShell.
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', SCRIPT_PATH,
    ...(preprocess ? ['-Preprocess'] : []),
    ...imagePaths
  ]

  let stdout
  try {
    // Base 30s for PowerShell cold start + 5s per image for OCR processing.
    // Prevents a hung PowerShell process from blocking the capture pipeline.
    const timeoutMs = 30000 + (imagePaths.length * 5000)
    const result = await execFileAsync('powershell.exe', args, {
      maxBuffer: 1024 * 1024 * 50,
      timeout: timeoutMs,
      windowsHide: true
    })
    stdout = result.stdout
  } catch (error) {
    logger.error('Windows OCR PowerShell script failed', { error: error.message })
    return new Map()
  }

  let parsed
  try {
    // Strip all ASCII control characters (0x00-0x1F) from the raw output.
    // PowerShell's ConvertTo-Json doesn't reliably escape control chars that
    // the Windows OCR engine returns in recognised text. Removing \r\n just
    // collapses the formatted JSON to a single line — still valid JSON.
    const sanitized = stdout.replace(/[\x00-\x1f]/g, '')
    parsed = JSON.parse(sanitized)
  } catch (error) {
    logger.error('Failed to parse Windows OCR JSON output', {
      error: error.message,
      stdoutPrefix: String(stdout).slice(0, 200)
    })
    return new Map()
  }

  const rawResults = parsed?.results && typeof parsed.results === 'object' ? parsed.results : {}
  const results = new Map()

  for (const [imagePath, entry] of Object.entries(rawResults)) {
    if (entry?.error) {
      logger.error('Windows OCR failed for image', { imagePath, error: entry.error })
      continue
    }
    const meta = entry?.meta && typeof entry.meta === 'object' ? entry.meta : {}
    const lines = Array.isArray(entry?.lines) ? entry.lines : []
    // Word-level bounding boxes for layout inference. Each word has { text, x, y, w, h }.
    const words = Array.isArray(entry?.words) ? entry.words : []
    results.set(imagePath, { meta, lines, words })
  }

  return results
}

/**
 * Checks whether Windows OCR can run on this platform.
 * Windows.Media.Ocr is available on all Windows 10+ with an OCR language pack installed
 * (English is installed by default on English Windows).
 */
const canRunWindowsOcr = () => process.platform === 'win32'

/**
 * Formats Windows OCR output as markdown in the familiar-layout-v0 format.
 * Mirrors buildMarkdownLayoutFromOcr() in apple-vision-ocr.js but with
 * Windows-specific metadata fields and optional layout inference from bounding boxes.
 *
 * @param {Object} options
 * @param {string} options.imagePath - Path to the source image.
 * @param {Object} options.meta - Image metadata from OCR (image_width, image_height).
 * @param {string[]} options.lines - Extracted text lines.
 * @param {Object[]} [options.words] - Word-level data with bounding boxes (from Step 4).
 * @param {Object} [options.windowMeta] - Foreground window metadata captured at screenshot time.
 * @param {string} [options.windowMeta.app] - Normalised app name (e.g. "code", "chrome").
 * @param {string} [options.windowMeta.title] - Raw window title.
 * @param {string} [options.windowMeta.titleNorm] - Cleaned window title (app suffix stripped).
 * @param {string} [options.windowMeta.url] - URL extracted from browser title, if available.
 */
const buildMarkdownLayoutFromWindowsOcr = ({ imagePath, meta, lines, words, windowMeta } = {}) => {
  const width = Number(meta?.image_width) || null
  const height = Number(meta?.image_height) || null
  const resolution = width && height ? `${width}x${height}` : 'unknown'

  // Use real window metadata when available, fall back to "unknown".
  const app = windowMeta?.app || 'unknown'
  const titleRaw = windowMeta?.title || 'unknown'
  const titleNorm = windowMeta?.titleNorm || 'unknown'
  const url = windowMeta?.url || 'unknown'

  const normalizedLines = Array.isArray(lines)
    ? lines.map((line) => String(line).trim()).filter(Boolean)
    : []

  const ocrLines = normalizedLines.length > 0 ? normalizedLines : ['NO_TEXT_DETECTED']
  const ocrBullets = ocrLines.map((line) => `- "${escapeForQuotedBullet(line)}"`).join('\n')
  const basename = imagePath ? path.basename(imagePath) : 'unknown'

  // Attempt layout inference from word bounding boxes if available.
  const layoutLines = buildLayoutSection({ words, width, height })

  return [
    '---',
    'format: familiar-layout-v0',
    'extractor: windows-ocr',
    `source_image: ${basename}`,
    `screen_resolution: ${resolution}`,
    `grid: ${layoutLines.grid}`,
    `app: ${app}`,
    `window_title_raw: ${titleRaw}`,
    `window_title_norm: ${titleNorm}`,
    `url: ${url}`,
    'ocr_engine: windows-media-ocr',
    '---',
    '# Layout Map',
    `SCREEN ${resolution}`,
    `GRID ${layoutLines.grid}`,
    ...layoutLines.regions,
    '',
    '# OCR',
    ocrBullets,
    ''
  ].join('\n')
}

/**
 * Build the Layout Map section from word bounding boxes.
 * Falls back to a single [CONTENT] block if no bounding box data is available.
 * Layout inference implemented in Step 5.
 */
const buildLayoutSection = ({ words, width, height } = {}) => {
  // If bounding box data is available, use layout inference (Step 5).
  if (Array.isArray(words) && words.length > 0 && width && height) {
    return inferLayoutRegions({ words, imageWidth: width, imageHeight: height })
  }

  // Fallback: single content block covering entire screen.
  const fallbackRegion = width && height
    ? `[CONTENT] (0,0)-(${width},${height}) text: "UNCLEAR (no bounding box data)"`
    : '[CONTENT] (x1,y1)-(x2,y2) text: "UNCLEAR (no bounding box data)"'
  return { grid: 'unknown', regions: [fallbackRegion] }
}

// --- Layout inference constants ---
// These thresholds define the boundary between header/sidebar/content regions.
// Tuned for typical desktop UIs at 1920x1080.

// Header: top strip of the screen (title bars, menus, toolbars).
const HEADER_THRESHOLD_RATIO = 0.08  // Top 8% of screen height
// Sidebar: left column if text density is high enough to suggest a nav panel.
const SIDEBAR_THRESHOLD_RATIO = 0.25  // Left 25% of screen width
// Minimum word count in a region to consider it populated.
const MIN_WORDS_FOR_REGION = 3
// Minimum fraction of sidebar-zone words to total words to declare a sidebar exists.
const SIDEBAR_DENSITY_THRESHOLD = 0.08

/**
 * Infer layout regions from OCR word bounding boxes using coordinate heuristics.
 *
 * Groups words into up to three regions:
 * - [HEADER]: words in the top ~8% of screen (title bars, menus, toolbars)
 * - [SIDEBAR]: words in the left ~25% of screen, below the header (nav panels, file trees)
 * - [CONTENT]: everything else (main working area)
 *
 * Also detects horizontal grid layout: if content words cluster into two distinct
 * horizontal zones, sets grid to "2x1" (e.g. side-by-side editor panels).
 *
 * @param {Object} options
 * @param {Object[]} options.words - Word data with { text, x, y, w, h }.
 * @param {number} options.imageWidth - Image width in pixels.
 * @param {number} options.imageHeight - Image height in pixels.
 * @returns {{ grid: string, regions: string[] }}
 */
const inferLayoutRegions = ({ words, imageWidth, imageHeight } = {}) => {
  if (!Array.isArray(words) || words.length === 0 || !imageWidth || !imageHeight) {
    const fallback = `[CONTENT] (0,0)-(${imageWidth || 0},${imageHeight || 0}) text: "UNCLEAR"`
    return { grid: 'unknown', regions: [fallback] }
  }

  const headerMaxY = Math.round(imageHeight * HEADER_THRESHOLD_RATIO)
  const sidebarMaxX = Math.round(imageWidth * SIDEBAR_THRESHOLD_RATIO)

  // Classify each word into a region based on its position.
  const headerWords = []
  const sidebarWords = []
  const contentWords = []

  for (const word of words) {
    const centerY = word.y + (word.h / 2)
    const centerX = word.x + (word.w / 2)

    if (centerY < headerMaxY) {
      headerWords.push(word)
    } else if (centerX < sidebarMaxX) {
      sidebarWords.push(word)
    } else {
      contentWords.push(word)
    }
  }

  // Determine if sidebar has enough density to be a real panel.
  const hasSidebar = sidebarWords.length >= MIN_WORDS_FOR_REGION &&
    (sidebarWords.length / words.length) >= SIDEBAR_DENSITY_THRESHOLD

  // If sidebar doesn't qualify, merge its words into content.
  if (!hasSidebar) {
    contentWords.push(...sidebarWords)
    sidebarWords.length = 0
  }

  // Detect horizontal grid in content area.
  // If content words cluster into two distinct horizontal zones, it's a 2-column layout.
  const grid = detectGrid(contentWords, imageWidth, sidebarMaxX)

  // Build region strings.
  const regions = []

  if (headerWords.length >= MIN_WORDS_FOR_REGION) {
    const bounds = computeBounds(headerWords)
    const text = truncateText(headerWords.map((w) => w.text).join(' '), 200)
    regions.push(`[HEADER] (${bounds.x1},${bounds.y1})-(${bounds.x2},${bounds.y2}) text: "${escapeForQuotedBullet(text)}"`)
  }

  if (hasSidebar && sidebarWords.length >= MIN_WORDS_FOR_REGION) {
    const bounds = computeBounds(sidebarWords)
    const text = truncateText(sidebarWords.map((w) => w.text).join(' '), 200)
    regions.push(`[SIDEBAR] (${bounds.x1},${bounds.y1})-(${bounds.x2},${bounds.y2}) text: "${escapeForQuotedBullet(text)}"`)
  }

  if (contentWords.length > 0) {
    const bounds = computeBounds(contentWords)
    const text = truncateText(contentWords.map((w) => w.text).join(' '), 300)
    regions.push(`[CONTENT] (${bounds.x1},${bounds.y1})-(${bounds.x2},${bounds.y2}) text: "${escapeForQuotedBullet(text)}"`)
  }

  // Fallback if somehow no regions were populated.
  if (regions.length === 0) {
    regions.push(`[CONTENT] (0,0)-(${imageWidth},${imageHeight}) text: "UNCLEAR"`)
  }

  return { grid, regions }
}

/**
 * Detect if content words form a multi-column grid layout.
 * Looks for a gap in the horizontal distribution of words that suggests two panels.
 */
const detectGrid = (contentWords, imageWidth, leftOffset) => {
  if (contentWords.length < 10) {
    return '1x1'
  }

  // Compute the horizontal center of each word.
  const centers = contentWords.map((w) => w.x + w.w / 2)

  // Find the midpoint of the content area.
  const contentMid = leftOffset + (imageWidth - leftOffset) / 2

  // Count words in left and right halves.
  let leftCount = 0
  let rightCount = 0
  // Track how many words sit near the midpoint (within 5% of image width).
  const gapZone = imageWidth * 0.05
  let gapCount = 0

  for (const cx of centers) {
    if (Math.abs(cx - contentMid) < gapZone) {
      gapCount++
    } else if (cx < contentMid) {
      leftCount++
    } else {
      rightCount++
    }
  }

  // Two-column layout: both halves have significant word counts and the gap zone is sparse.
  const totalNonGap = leftCount + rightCount
  if (
    totalNonGap > 0 &&
    leftCount / totalNonGap > 0.25 &&
    rightCount / totalNonGap > 0.25 &&
    gapCount / contentWords.length < 0.15
  ) {
    return '2x1'
  }

  return '1x1'
}

/**
 * Compute the bounding box that contains all given words.
 */
const computeBounds = (words) => {
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity

  for (const word of words) {
    if (word.x < x1) x1 = word.x
    if (word.y < y1) y1 = word.y
    if (word.x + word.w > x2) x2 = word.x + word.w
    if (word.y + word.h > y2) y2 = word.y + word.h
  }

  return {
    x1: Math.round(x1),
    y1: Math.round(y1),
    x2: Math.round(x2),
    y2: Math.round(y2)
  }
}

/**
 * Truncate text to a maximum length, appending "..." if truncated.
 */
const truncateText = (text, maxLen) => {
  if (typeof text !== 'string') return ''
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 3) + '...'
}

module.exports = {
  runWindowsOcrBatch,
  canRunWindowsOcr,
  buildMarkdownLayoutFromWindowsOcr,
  buildLayoutSection,
  inferLayoutRegions,
  detectGrid,
  computeBounds,
  truncateText
}
