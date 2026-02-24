#!/usr/bin/env node

// Cross-platform wrapper for the Apple Vision OCR build step.
// On macOS, delegates to the shell script that compiles the native binary.
// On all other platforms, exits silently — no native OCR binary is needed.

'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

if (process.platform !== 'darwin') {
  console.log('Skipping Apple Vision OCR build (macOS only).');
  process.exit(0);
}

const scriptPath = path.join(__dirname, 'build-apple-vision-ocr.sh');

try {
  execFileSync('bash', [scriptPath], { stdio: 'inherit' });
} catch (error) {
  console.error('Apple Vision OCR build failed:', error.message);
  process.exit(1);
}
