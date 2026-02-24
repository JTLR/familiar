#!/usr/bin/env node

// Cross-platform script to rebuild better-sqlite3 for the Electron runtime.
// Attempts to download a prebuilt binary first (fast, no compiler needed).
// Falls back to a full native build from source if no prebuilt is available.

'use strict';

const { execSync } = require('node:child_process');
const path = require('node:path');

// Read Electron version from package.json so it doesn't drift on upgrades.
const { devDependencies } = require('../package.json');
const electronVersion = devDependencies.electron.replace(/^\^|~/, '');
const betterSqlite3Dir = path.join(__dirname, '..', 'node_modules', 'better-sqlite3');

function tryPrebuildInstall() {
  try {
    execSync(
      `npx prebuild-install --runtime=electron --target=${electronVersion}`,
      { cwd: betterSqlite3Dir, stdio: 'inherit' }
    );
    return true;
  } catch {
    return false;
  }
}

function buildFromSource() {
  const env = {
    ...process.env,
    npm_config_runtime: 'electron',
    npm_config_target: electronVersion,
    npm_config_disturl: 'https://electronjs.org/headers'
  };
  execSync('npm rebuild better-sqlite3 --build-from-source', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env
  });
}

console.log(`Rebuilding better-sqlite3 for Electron ${electronVersion}...`);

if (tryPrebuildInstall()) {
  console.log('Prebuilt binary installed successfully.');
  process.exit(0);
}

console.log('No prebuilt binary available; building from source...');
try {
  buildFromSource();
} catch (error) {
  console.error('Failed to rebuild better-sqlite3:', error.message);
  process.exit(1);
}
