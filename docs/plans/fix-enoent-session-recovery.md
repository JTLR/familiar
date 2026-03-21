# Fix ENOENT Session Directory Recovery

## Status: 100% — Complete

## Problem
When the stills session directory is deleted while Familiar is running (e.g. by Syncthing, manual cleanup, or disk issues), the in-memory `sessionStore` still references the deleted path. Every capture tick (4s) and every stop attempt fails with ENOENT indefinitely. The app becomes stuck and non-functional until manually restarted.

## Plan

### Step 1: Harden `captureNext()` in `recorder.js` — ✅
- Added `fs.existsSync` check before capture attempt
- On missing dir: finalize dead session, auto-start a new one via stored `lastContextFolderPath`
- Prevents infinite ENOENT spam every 4 seconds

### Step 2: Harden `writeManifest()` in `session-store.js` — ✅
- Re-creates session directory if missing before writing manifest.json
- Covers the case where dir disappears mid-session but comes back

### Step 3: Harden `finalize()` in `session-store.js` — ✅
- Catches ENOENT from `writeManifest()` and logs warning instead of throwing
- Ensures `stop()` completes cleanly even when the directory is gone

## Files
- `src/screen-stills/recorder.js`
- `src/screen-stills/session-store.js`
