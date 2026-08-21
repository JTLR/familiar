# Feature Implementation Plan: Windows Packaging & Launch at Login

**Overall Progress:** `85%`

## TLDR
Add Windows NSIS installer packaging to electron-builder, implement a cross-platform "Launch at Login" toggle in Settings UI backed by `app.setLoginItemSettings()`, and replace the current macOS-only hardcoded auto-launch with the new setting. Intended for upstream PR.

## Critical Decisions
- **NSIS installer**: Standard for Electron on Windows. Handles registry entries, uninstall, and `setLoginItemSettings` integration.
- **`app.setLoginItemSettings()`**: Electron's built-in cross-platform API. Works with NSIS on Windows (registry Run key) and native on macOS. No third-party deps needed.
- **Default `launchAtLogin: false`**: Opt-in, not opt-out. Breaks from current macOS hardcoded behaviour but is the right default for a user-facing setting.
- **Unsigned for now**: No code signing cert. SmartScreen "Unknown publisher" warning is acceptable.
- **Setting stored in `~/.familiar/settings.json`**: Same as all other settings. No separate config.

## Tasks:

- [x] 🟩 **Step 1: Windows icon for installer**
  - [x] 🟩 Check `build/icon.png` dimensions (needs 256x256+). If sufficient, electron-builder auto-converts to `.ico`. If not, generate a proper `build/icon.ico`. — **1024x1024 RGBA, auto-conversion works.**

- [x] 🟩 **Step 2: Add Windows NSIS target to electron-builder config**
  - [x] 🟩 Add `win` section to `package.json` `build` config with NSIS target, icon path, and `oneClick: false` (allows custom install dir)
  - [x] 🟩 Add `dist:win` script to `package.json` scripts (mirrors `dist:mac` pattern, skips macOS-only `build:apple-vision-ocr` step)
  - [x] 🟩 Update `description` field in `package.json` to be platform-neutral (currently says "macOS")
  - [x] 🟩 Update `keywords` in `package.json` to include "Windows"
  - [x] 🟩 Moved `extraResources` (apple-vision-ocr) under `mac` to prevent Windows build failures

- [x] 🟩 **Step 3: Add `launchAtLogin` to settings system**
  - [x] 🟩 `src/settings.js` — Add `launchAtLogin` boolean to `saveSettings()` merge logic (same pattern as `alwaysRecordWhenActive`)
  - [x] 🟩 `src/ipc/settings.js` — Add `launchAtLogin` to `handleGetSettings()` response (default `false`) and `handleSaveSettings()` accepted payload

- [x] 🟩 **Step 4: Wire `setLoginItemSettings` to the new setting**
  - [x] 🟩 `src/main.js` — Replace hardcoded `app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true })` with setting-driven call
  - [x] 🟩 `src/main.js` — Add `applyLaunchAtLoginSetting()` for both `darwin` and `win32`
  - [x] 🟩 `src/main.js` — Call on startup and via `onSettingsSaved` callback
  - [x] 🟩 `src/main.js` — Add `settings:getLaunchAtLoginStatus` IPC handler for UI sync

- [x] 🟩 **Step 5: Add Launch at Login toggle to Settings UI**
  - [x] 🟩 `src/dashboard/preload.js` — Add `getLaunchAtLoginStatus` IPC bridge
  - [x] 🟩 `src/dashboard/index.html` — Toggle in General section with label, description, error/status elements
  - [x] 🟩 `src/dashboard/settings.js` — `saveLaunchAtLogin` + event listener (same pattern as `saveAlwaysRecordWhenActive`)
  - [x] 🟩 `src/dashboard/state.js` — `currentLaunchAtLogin` state + `setLaunchAtLoginValue` setter
  - [x] 🟩 `src/dashboard/bootstrap/settings.js` — Pass through `setLaunchAtLoginValue`
  - [x] 🟩 `src/dashboard/renderer.js` — Element selectors, state wiring, bootstrap wiring

- [ ] 🟨 **Step 6: Build and test Windows installer**
  - [x] 🟩 All 36 settings/dashboard/state tests pass. 12 pre-existing failures (macOS OCR, stills recorder) unrelated to our changes.
  - [x] 🟩 Run `npm run dist:win` — `Familiar Setup 0.0.38.exe` (101MB) built successfully
  - [x] 🟩 Fixed: NSIS requires `.ico` (not `.png`) for installer icons — generated `build/icon.ico` (6 sizes, 16-256px)
  - [x] 🟩 Fixed: winCodeSign symlink error — pre-populated cache at `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0\`
  - [ ] 🟥 Install on Windows, verify app runs from installed location — **manual step**
  - [ ] 🟥 Test Launch at Login toggle: enable, restart, verify app starts on login — **manual step**
  - [ ] 🟥 Test Launch at Login toggle: disable, restart, verify app does NOT start on login — **manual step**
  - [ ] 🟥 Verify auto-updater works with Windows build (checks GitHub releases) — **manual step**

- [ ] 🟨 **Step 7: Verify macOS behaviour unchanged**
  - [ ] 🟥 Confirm macOS build still works (`dist:mac`) — **manual step, needs macOS**
  - [ ] 🟥 Confirm Launch at Login defaults to `false` on fresh install (breaking change from hardcoded `true` — intentional, note in PR description) — **manual step**
