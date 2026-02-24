const { buildTrayMenuTemplate } = require('../menu');
const { loadSettings } = require('../settings');
const { getRecordingIndicatorVisuals } = require('../recording-status-indicator');

const getElectronMenu = () => {
    const electron = require('electron');
    return electron && electron.Menu ? electron.Menu : null;
};

const getElectronNativeImage = () => {
    const electron = require('electron');
    return electron && electron.nativeImage ? electron.nativeImage : null;
};

// Build a tiny 12x12 raw RGBA bitmap of a filled circle.
// Electron's nativeImage.createFromDataURL does not support SVG on Windows,
// so we generate raw pixel data and pass it to nativeImage.createFromBitmap.
function buildCircleBitmap({ size = 12, radius = 4, r, g, b }) {
    const pixels = Buffer.alloc(size * size * 4, 0);
    const cx = size / 2;
    const cy = size / 2;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = x + 0.5 - cx;
            const dy = y + 0.5 - cy;
            if (dx * dx + dy * dy <= radius * radius) {
                const offset = (y * size + x) * 4;
                pixels[offset] = r;
                pixels[offset + 1] = g;
                pixels[offset + 2] = b;
                pixels[offset + 3] = 255;
            }
        }
    }
    return { pixels, size };
}

function parseHexColor(hex) {
    const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!match) {
        return null;
    }
    return {
        r: parseInt(match[1], 16),
        g: parseInt(match[2], 16),
        b: parseInt(match[3], 16),
    };
}

function createRecordingIndicatorIconFactory({
    nativeImage = getElectronNativeImage(),
    logger = console,
} = {}) {
    const cache = new Map();

    return ({ colorHex } = {}) => {
        if (!nativeImage || typeof nativeImage.createFromBitmap !== 'function') {
            return null;
        }
        if (typeof colorHex !== 'string' || colorHex.length === 0) {
            return null;
        }
        if (cache.has(colorHex)) {
            return cache.get(colorHex);
        }

        const color = parseHexColor(colorHex);
        if (!color) {
            logger.warn('Tray recording indicator: invalid color', { colorHex });
            return null;
        }

        const { pixels, size } = buildCircleBitmap({ size: 12, radius: 4, ...color });
        const icon = nativeImage.createFromBitmap(pixels, { width: size, height: size });
        if (!icon || (typeof icon.isEmpty === 'function' && icon.isEmpty())) {
            logger.warn('Tray recording indicator icon creation failed', { colorHex });
            return null;
        }

        cache.set(colorHex, icon);
        return icon;
    };
}

function createTrayMenuController({
    tray,
    trayHandlers,
    loadSettingsFn = loadSettings,
    buildTrayMenuTemplateFn = buildTrayMenuTemplate,
    getRecordingState = null,
    menu = getElectronMenu(),
    recordingIndicatorIconFactory = null,
    logger = console,
} = {}) {
    const resolveRecordingIndicatorIcon = typeof recordingIndicatorIconFactory === 'function'
        ? recordingIndicatorIconFactory
        : createRecordingIndicatorIconFactory({ logger });

    const resolveRecordingPaused = () => {
        if (typeof getRecordingState !== 'function') {
            return false;
        }
        const state = getRecordingState();
        return Boolean(state && state.manualPaused);
    };

    const resolveRecordingState = () => {
        if (typeof getRecordingState !== 'function') {
            return null;
        }
        return getRecordingState() || null;
    };

    function updateTrayMenu({ recordingPaused } = {}) {
        if (!menu) {
            logger.warn('Tray menu update skipped: menu unavailable');
            return;
        }
        if (!tray) {
            logger.warn('Tray menu update skipped: tray not ready');
            return;
        }

        if (!trayHandlers) {
            logger.warn('Tray menu update skipped: handlers not ready');
            return;
        }

        const isPaused =
            typeof recordingPaused === 'boolean' ? recordingPaused : resolveRecordingPaused();
        const recordingState = resolveRecordingState();
        const recordingIndicator = getRecordingIndicatorVisuals(recordingState || {});
        const recordingStatusIcon = resolveRecordingIndicatorIcon({
            colorHex: recordingIndicator.trayColorHex
        });
        const trayMenu = menu.buildFromTemplate(
            buildTrayMenuTemplateFn({
                ...trayHandlers,
                recordingPaused: isPaused,
                recordingState,
                recordingStatusIcon
            })
        );

        tray.setContextMenu(trayMenu);
        if (typeof tray.setToolTip === 'function') {
            tray.setToolTip('Familiar');
        }

        logger.log('Tray menu updated', {
            recordingPaused: isPaused,
            recordingIndicatorStatus: recordingIndicator.status
        });
    }

    function refreshTrayMenuFromSettings() {
        loadSettingsFn();
        updateTrayMenu({
            recordingPaused: resolveRecordingPaused(),
        });
    }

    function registerTrayRefreshHandlers() {
        if (tray && typeof tray.on === 'function') {
            tray.on('click', () => {
                refreshTrayMenuFromSettings();
            });

            tray.on('right-click', () => {
                refreshTrayMenuFromSettings();
            });
        } else {
            logger.warn('Tray menu refresh handlers unavailable');
        }
    }

    return {
        updateTrayMenu,
        refreshTrayMenuFromSettings,
        registerTrayRefreshHandlers,
    };
}

module.exports = {
    createTrayMenuController,
    createRecordingIndicatorIconFactory,
};
