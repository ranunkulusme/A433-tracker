/**
 * KoW Tracker - Tests for Smart Scanner Client Module
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const smartScannerUI = require('./smart-scanner.js');

test('SmartScannerUI: exports all core controller functions', () => {
  assert.equal(typeof smartScannerUI.openSmartScannerModal, 'function');
  assert.equal(typeof smartScannerUI.closeSmartScannerModal, 'function');
  assert.equal(typeof smartScannerUI.updateScannerPreviewStarPoints, 'function');
  assert.equal(typeof smartScannerUI.handleScannerFiles, 'function');
  assert.equal(typeof smartScannerUI.displayScannerResults, 'function');
  assert.equal(typeof smartScannerUI.applyScanResultsToProfile, 'function');
  assert.equal(typeof smartScannerUI.initSmartScanner, 'function');

  assert.equal(typeof smartScannerUI.openExchangeOcrModal, 'function');
  assert.equal(typeof smartScannerUI.closeExchangeOcrModal, 'function');
  assert.equal(typeof smartScannerUI.initExchangeOcr, 'function');
  assert.equal(typeof smartScannerUI.handleExchangeFiles, 'function');
  assert.equal(typeof smartScannerUI.renderExchangeOcrTable, 'function');
  assert.equal(typeof smartScannerUI.recalcExchangeRowTotal, 'function');
  assert.equal(typeof smartScannerUI.removeExchangeRow, 'function');
  assert.equal(typeof smartScannerUI.addManualExchangeRow, 'function');
  assert.equal(typeof smartScannerUI.submitBatchExchangeOfficers, 'function');
});

test('SmartScannerUI: star points preview calculation', () => {
  // Mock DOM elements
  const elements = {
    'scanner-preview-stars-1': { value: '2' },
    'scanner-preview-stars-2': { value: '1' },
    'scanner-preview-stars-3': { value: '1' },
    'scanner-preview-star-points-badge': { textContent: '' }
  };

  global.document = {
    getElementById: (id) => elements[id] || null
  };
  global.fmtNum = (n) => String(n);
  global.logic = {
    calculateTotalStarPoints: ({ legendaryStars1, legendaryStars2, legendaryStars3 }) => {
      return (legendaryStars1 * 110) + (legendaryStars2 * 420) + (legendaryStars3 * 960);
    }
  };

  smartScannerUI.updateScannerPreviewStarPoints();

  // (2 * 110) + (1 * 420) + (1 * 960) = 220 + 420 + 960 = 1600
  assert.match(elements['scanner-preview-star-points-badge'].textContent, /1600/);

  delete global.document;
  delete global.fmtNum;
  delete global.logic;
});
