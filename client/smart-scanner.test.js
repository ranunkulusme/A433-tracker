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

test('SmartScannerUI: displayScannerResults highlights recognized fields and shows warning when empty', () => {
  function makeMockElement(id, initialValue = '0') {
    const classList = new Set();
    return {
      id,
      value: initialValue,
      className: '',
      style: {},
      textContent: '',
      classList: {
        add: (c) => classList.add(c),
        remove: (c) => classList.delete(c),
        contains: (c) => classList.has(c)
      },
      parentElement: {
        querySelector: () => null,
        appendChild: () => {}
      }
    };
  }

  const elements = {
    'scanner-results-container': makeMockElement('scanner-results-container'),
    'scanner-results-summary': makeMockElement('scanner-results-summary'),
    'scanner-preview-nickname': makeMockElement('scanner-preview-nickname', ''),
    'scanner-preview-update-nickname': { checked: false },
    'scanner-preview-power': makeMockElement('scanner-preview-power', '0'),
    'scanner-preview-kills': makeMockElement('scanner-preview-kills', '0'),
    'scanner-preview-kill-points': makeMockElement('scanner-preview-kill-points', '0'),
    'scanner-preview-coupons': makeMockElement('scanner-preview-coupons', '0'),
    'scanner-preview-puzzles': makeMockElement('scanner-preview-puzzles', '0'),
    'scanner-preview-star-coupons': makeMockElement('scanner-preview-star-coupons', '0'),
    'scanner-preview-stars-1': makeMockElement('scanner-preview-stars-1', '0'),
    'scanner-preview-stars-2': makeMockElement('scanner-preview-stars-2', '0'),
    'scanner-preview-stars-3': makeMockElement('scanner-preview-stars-3', '0'),
    'scanner-preview-star-points-badge': makeMockElement('scanner-preview-star-points-badge', ''),
    'scanner-btn-apply': makeMockElement('scanner-btn-apply', ''),
    'scanner-raw-details': makeMockElement('scanner-raw-details'),
    'scanner-raw-text-pre': makeMockElement('scanner-raw-text-pre')
  };

  global.document = {
    getElementById: (id) => elements[id] || null
  };
  global.formatInputNumber = (n) => String(n);

  // 1. Successful recognition with recognizedFields
  smartScannerUI.displayScannerResults({
    success: true,
    hasRecognizedData: true,
    imagesProcessed: 1,
    recognizedFields: ['coupons', 'puzzles'],
    stock: { coupons: 450000, puzzles: 2200 },
    rawText: 'Купон готовности 450,000'
  });

  assert.ok(elements['scanner-results-summary'].textContent.includes('Распознано параметров: 2'));
  assert.equal(elements['scanner-preview-coupons'].classList.contains('ocr-detected-input'), true);
  assert.equal(elements['scanner-preview-puzzles'].classList.contains('ocr-detected-input'), true);
  assert.equal(elements['scanner-preview-power'].classList.contains('ocr-detected-input'), false);
  assert.equal(elements['scanner-raw-text-pre'].textContent, 'Купон готовности 450,000');
  assert.equal(elements['scanner-raw-details'].style.display, 'block');

  // 2. Empty / Unrecognized result
  smartScannerUI.displayScannerResults({
    success: true,
    hasRecognizedData: false,
    imagesProcessed: 1,
    recognizedFields: [],
    stock: {},
    rawText: ''
  });

  assert.ok(elements['scanner-results-summary'].className.includes('error'));
  assert.ok(elements['scanner-results-summary'].textContent.includes('не удалось обнаружить данные'));
  assert.equal(elements['scanner-preview-coupons'].classList.contains('ocr-detected-input'), false);
  assert.equal(elements['scanner-preview-puzzles'].classList.contains('ocr-detected-input'), false);
  assert.equal(elements['scanner-btn-apply'].textContent, '✓ Сохранить текущие значения');

  delete global.document;
  delete global.formatInputNumber;
});

test('SmartScannerUI: handleScannerFileInput extracts files and resets input value', async () => {
  let processedFiles = null;
  const mockFile = { name: 'screenshot.png', type: 'image/png' };
  const mockEvent = {
    target: {
      files: [mockFile],
      value: 'C:\\fakepath\\screenshot.png'
    }
  };

  const origHandle = smartScannerUI.handleScannerFiles;
  smartScannerUI.handleScannerFiles = (files) => {
    processedFiles = files;
  };

  assert.equal(typeof smartScannerUI.handleScannerFileInput, 'function');
  smartScannerUI.handleScannerFileInput(mockEvent);

  assert.equal(mockEvent.target.value, '');
  assert.equal(processedFiles.length, 1);
  assert.equal(processedFiles[0].name, 'screenshot.png');

  smartScannerUI.handleScannerFiles = origHandle;
});

test('SmartScannerUI: handleExchangeFileInput extracts files and resets input value', async () => {
  let processedFiles = null;
  const mockFile = { name: 'exchange.png', type: 'image/png' };
  const mockEvent = {
    target: {
      files: [mockFile],
      value: 'C:\\fakepath\\exchange.png'
    }
  };

  const origHandle = smartScannerUI.handleExchangeFiles;
  smartScannerUI.handleExchangeFiles = (files) => {
    processedFiles = files;
  };

  assert.equal(typeof smartScannerUI.handleExchangeFileInput, 'function');
  smartScannerUI.handleExchangeFileInput(mockEvent);

  assert.equal(mockEvent.target.value, '');
  assert.equal(processedFiles.length, 1);
  assert.equal(processedFiles[0].name, 'exchange.png');

  smartScannerUI.handleExchangeFiles = origHandle;
});

test('SmartScannerUI: handleScannerFiles supports apiFetch returning parsed JSON object directly', async () => {
  const mockFile = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  let displayedResult = null;

  global.apiFetch = async (url, options) => {
    assert.equal(url, '/api/ocr/scan');
    assert.equal(options.method, 'POST');
    // apiFetch in app.js returns the parsed JSON payload directly, NOT a fetch Response object!
    return {
      success: true,
      hasRecognizedData: true,
      imagesProcessed: 1,
      recognizedFields: ['coupons'],
      stock: { coupons: 150000 },
      rawText: 'Купон готовности 150,000'
    };
  };

  const origDisplay = smartScannerUI.displayScannerResults;
  smartScannerUI.displayScannerResults = (res) => {
    displayedResult = res;
  };

  // Mock DOM progress elements
  global.document = {
    getElementById: (id) => ({
      style: {},
      textContent: '',
      classList: { add: () => {}, remove: () => {} }
    })
  };

  await smartScannerUI.handleScannerFiles([mockFile]);

  assert.ok(displayedResult);
  assert.equal(displayedResult.success, true);
  assert.equal(displayedResult.hasRecognizedData, true);
  assert.equal(displayedResult.stock.coupons, 150000);

  delete global.apiFetch;
  delete global.document;
  smartScannerUI.displayScannerResults = origDisplay;
});


