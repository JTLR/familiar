// Windows foreground window metadata capture for Familiar.
// Calls a PowerShell script that uses Win32 APIs to get the active window's
// title and owning process name. Used at capture time to populate markdown
// frontmatter with real app/window metadata instead of "unknown".
//
// Returns { title, app, pid } or { title: null, app: null, pid: null } on failure.
// Never throws — capture must not be blocked by metadata errors.

const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

const SCRIPT_PATH = path.join(__dirname, 'windows-foreground.ps1')

// Timeout for the PowerShell process. The script is lightweight but PowerShell
// cold start can take ~1s. 5s is generous to avoid false failures.
const TIMEOUT_MS = 5000

const EMPTY_RESULT = Object.freeze({ title: null, app: null, pid: null })

// Common browser process names for URL extraction from window titles.
const BROWSER_PROCESSES = new Set([
  'chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'arc'
])

// Suffixes that browsers and apps append to window titles.
// Used to extract the meaningful part of the title.
const APP_TITLE_SUFFIXES = [
  // Browsers
  / [-–—]\s*Google Chrome$/i,
  / [-–—]\s*Microsoft[\u200b]? Edge$/i,
  / [-–—]\s*Mozilla Firefox$/i,
  / [-–—]\s*Brave$/i,
  / [-–—]\s*Opera$/i,
  / [-–—]\s*Vivaldi$/i,
  // Editors/IDEs
  / [-–—]\s*Visual Studio Code$/i,
  / [-–—]\s*VS Code$/i,
  / [-–—]\s*Cursor$/i,
  // Communication
  / [-–—]\s*Slack$/i,
  / [-–—]\s*Microsoft Teams$/i,
  / \| Microsoft Teams$/i,
  // Terminal
  / [-–—]\s*Windows Terminal$/i,
  / [-–—]\s*MINGW64:.*$/i,
]

/**
 * Normalise the app/process name: strip .exe, lowercase.
 * e.g. "Code.exe" -> "code", "chrome" -> "chrome"
 */
const normalizeAppName = (rawApp) => {
  if (typeof rawApp !== 'string' || !rawApp.trim()) {
    return null
  }
  return rawApp.trim().replace(/\.exe$/i, '').toLowerCase()
}

/**
 * Clean the window title by stripping common app-name suffixes.
 * Returns the meaningful part of the title.
 * e.g. "CLAUDE.md - personal-command-center - Visual Studio Code" -> "CLAUDE.md - personal-command-center"
 */
const normalizeWindowTitle = (rawTitle) => {
  if (typeof rawTitle !== 'string' || !rawTitle.trim()) {
    return null
  }
  let title = rawTitle.trim()
  for (const pattern of APP_TITLE_SUFFIXES) {
    title = title.replace(pattern, '')
  }
  return title.trim() || null
}

/**
 * Attempt to extract a URL from a browser window title.
 * Some browsers show the URL in the title when focused on the address bar,
 * or include the domain in the title format.
 * Returns the URL string or null.
 */
const extractUrlFromTitle = (rawTitle, appName) => {
  if (!rawTitle || !appName) {
    return null
  }
  // Only attempt URL extraction for known browser processes.
  if (!BROWSER_PROCESSES.has(appName)) {
    return null
  }
  // Check if the title looks like a URL (common when address bar is focused).
  const urlMatch = rawTitle.match(/^(https?:\/\/\S+)/)
  if (urlMatch) {
    return urlMatch[1]
  }
  return null
}

/**
 * Get the currently active foreground window's metadata.
 * Spawns a PowerShell process to call Win32 APIs.
 *
 * @param {Object} [options]
 * @param {Object} [options.logger=console] - Logger instance.
 * @returns {Promise<{ title: string|null, app: string|null, pid: number|null,
 *           titleNorm: string|null, url: string|null }>}
 */
const getWindowMetadata = async ({ logger = console } = {}) => {
  if (process.platform !== 'win32') {
    return { ...EMPTY_RESULT, titleNorm: null, url: null }
  }

  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT_PATH
    ], {
      timeout: TIMEOUT_MS,
      windowsHide: true
    })

    const sanitized = stdout.replace(/[\x00-\x1f]/g, '')
    const parsed = JSON.parse(sanitized)

    const rawTitle = parsed?.title || null
    const rawApp = parsed?.app || null
    const pid = typeof parsed?.pid === 'number' ? parsed.pid : null

    const app = normalizeAppName(rawApp)
    const titleNorm = normalizeWindowTitle(rawTitle)
    const url = extractUrlFromTitle(rawTitle, app)

    return { title: rawTitle, app, pid, titleNorm, url }
  } catch (error) {
    logger.warn('Failed to capture foreground window metadata', {
      error: error?.message || String(error)
    })
    return { ...EMPTY_RESULT, titleNorm: null, url: null }
  }
}

module.exports = {
  getWindowMetadata,
  normalizeAppName,
  normalizeWindowTitle,
  extractUrlFromTitle,
  BROWSER_PROCESSES
}
