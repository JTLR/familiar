const SETTINGS_DIR_NAME = '.familiar'
const SETTINGS_FILE_NAME = 'settings.json'
const FAMILIAR_BEHIND_THE_SCENES_DIR_NAME = 'familiar'
const STILLS_DIR_NAME = 'stills'
const STILLS_MARKDOWN_DIR_NAME = 'stills-markdown'
const STILLS_DB_FILENAME = 'stills.db'

// Platform-aware default capture interval in seconds.
// macOS: 4s (free local Apple Vision OCR, low cost per capture).
// Windows: 15s (cloud LLM cost when using non-native extractor).
const DEFAULT_CAPTURE_INTERVAL_SECONDS = process.platform === 'darwin' ? 4 : 15

module.exports = {
  SETTINGS_DIR_NAME,
  SETTINGS_FILE_NAME,
  FAMILIAR_BEHIND_THE_SCENES_DIR_NAME,
  STILLS_DIR_NAME,
  STILLS_MARKDOWN_DIR_NAME,
  STILLS_DB_FILENAME,
  DEFAULT_CAPTURE_INTERVAL_SECONDS
}
