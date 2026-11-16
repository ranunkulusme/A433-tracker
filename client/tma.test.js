/**
 * KoW Tracker - TMA Client Module Tests
 * Verifies that tma.js executes safely in isolated and pre-app environments
 * without ReferenceErrors (e.g., apiFetch, toast, loadDataFromServer).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('tma.js executes without ReferenceError in bare browser environment without app.js', () => {
  const tmaCode = fs.readFileSync(path.join(__dirname, 'tma.js'), 'utf8');

  // Mock DOM / Window environment
  const mockStorage = {};
  const mockWindow = {
    location: { search: '?tma=1', hash: '' },
    localStorage: {
      getItem: (k) => mockStorage[k] || null,
      setItem: (k, v) => { mockStorage[k] = String(v); },
      removeItem: (k) => { delete mockStorage[k]; }
    },
    Telegram: {
      WebApp: {
        initData: 'query_id=test&user=%7B%22id%22%3A123%7D&hash=fake',
        initDataUnsafe: { user: { id: 123 } },
        platform: 'ios',
        ready: () => {},
        expand: () => {}
      }
    },
    fetch: async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ ok: true })
    })
  };

  const mockDocument = {
    readyState: 'complete',
    documentElement: { classList: { add: () => {}, contains: () => true } },
    body: { classList: { add: () => {}, contains: () => true }, appendChild: () => {} },
    getElementById: () => null,
    addEventListener: () => {}
  };

  mockWindow.window = mockWindow;
  mockWindow.document = mockDocument;

  const context = vm.createContext({
    window: mockWindow,
    document: mockDocument,
    localStorage: mockWindow.localStorage,
    Telegram: mockWindow.Telegram,
    fetch: mockWindow.fetch,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout: (id) => clearTimeout(id)
  });

  // Executing tma.js must not throw ReferenceError: apiFetch / toast / state / currentUser
  assert.doesNotThrow(() => {
    vm.runInContext(tmaCode, context);
  });

  // Verify that apiFetch and doTmaApiFetch are available and defined
  assert.equal(typeof context.window.apiFetch, 'function');
  assert.equal(typeof context.apiFetch, 'function');
  assert.equal(typeof context.doTmaApiFetch, 'function');
  assert.equal(typeof context.window.toast, 'function');
  assert.equal(typeof context.toast, 'function');
});

test('doTmaApiFetch executes standalone fetch and handles JSON and errors', async () => {
  const tmaCode = fs.readFileSync(path.join(__dirname, 'tma.js'), 'utf8');

  let capturedUrl = null;
  let capturedOptions = null;

  const mockWindow = {
    location: { search: '?tma=1', hash: '' },
    localStorage: {
      getItem: (k) => (k === 'kow_token' ? 'test_jwt_token' : null),
      setItem: () => {},
      removeItem: () => {}
    },
    fetch: async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      if (url === '/api/error-test') {
        return {
          ok: false,
          status: 400,
          headers: { get: () => 'application/json' },
          json: async () => ({ message: 'Invalid credentials' })
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true, user: { id: 1 } })
      };
    }
  };

  const mockDocument = {
    readyState: 'complete',
    documentElement: { classList: { add: () => {}, contains: () => true } },
    body: { classList: { add: () => {}, contains: () => true } },
    getElementById: () => null,
    addEventListener: () => {}
  };
  mockWindow.window = mockWindow;
  mockWindow.document = mockDocument;

  const context = vm.createContext({
    window: mockWindow,
    document: mockDocument,
    localStorage: mockWindow.localStorage,
    fetch: mockWindow.fetch,
    console,
    setTimeout,
    clearTimeout
  });

  vm.runInContext(tmaCode, context);

  // 1. Successful call
  const res = await context.doTmaApiFetch('/api/test-endpoint', {
    method: 'POST',
    body: { foo: 'bar' }
  });

  assert.equal(capturedUrl, '/api/test-endpoint');
  assert.equal(capturedOptions.method, 'POST');
  assert.equal(capturedOptions.headers['Authorization'], 'Bearer test_jwt_token');
  assert.equal(capturedOptions.headers['Content-Type'], 'application/json');
  assert.equal(capturedOptions.body, JSON.stringify({ foo: 'bar' }));
  assert.equal(res.success, true);

  // 2. Error call throws with proper message
  await assert.rejects(
    async () => {
      await context.doTmaApiFetch('/api/error-test');
    },
    (err) => {
      assert.equal(err.message, 'Invalid credentials');
      assert.equal(err.status, 400);
      return true;
    }
  );
});

test('doTmaApiFetch delegates to window.__appApiFetch when app.js is loaded', async () => {
  const tmaCode = fs.readFileSync(path.join(__dirname, 'tma.js'), 'utf8');

  let appApiCalled = false;
  const mockWindow = {
    location: { search: '?tma=1', hash: '' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    __appApiFetch: async (url, options) => {
      appApiCalled = true;
      return { delegated: true, url };
    }
  };

  const mockDocument = {
    readyState: 'complete',
    documentElement: { classList: { add: () => {}, contains: () => true } },
    body: { classList: { add: () => {}, contains: () => true } },
    getElementById: () => null,
    addEventListener: () => {}
  };
  mockWindow.window = mockWindow;
  mockWindow.document = mockDocument;

  const context = vm.createContext({
    window: mockWindow,
    document: mockDocument,
    localStorage: mockWindow.localStorage,
    console,
    setTimeout,
    clearTimeout
  });

  vm.runInContext(tmaCode, context);

  const res = await context.doTmaApiFetch('/api/delegated-test');
  assert.equal(appApiCalled, true);
  assert.equal(res.delegated, true);
  assert.equal(res.url, '/api/delegated-test');
});

test('sequential execution of logic.js, app.js and tma.js has zero identifier collisions and switches tabs cleanly', () => {
  const logicCode = fs.readFileSync(path.join(__dirname, '../shared/logic.js'), 'utf8');
  const appCode = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const tmaCode = fs.readFileSync(path.join(__dirname, 'tma.js'), 'utf8');

  const elements = {};
  function getEl(id) {
    if (!elements[id]) {
      elements[id] = {
        id,
        innerHTML: '',
        style: {},
        classList: {
          _classes: new Set(),
          add: function(c) { this._classes.add(c); },
          remove: function(c) { this._classes.delete(c); },
          contains: function(c) { return this._classes.has(c); }
        },
        querySelectorAll: () => [],
        querySelector: () => null,
        addEventListener: () => {},
        focus: () => {}
      };
    }
    return elements[id];
  }

  const mockStorage = {};
  const mockWindow = {
    location: { search: '?tma=1', hash: '', pathname: '/' },
    localStorage: {
      getItem: (k) => mockStorage[k] || null,
      setItem: (k, v) => { mockStorage[k] = String(v); },
      removeItem: (k) => { delete mockStorage[k]; }
    },
    Telegram: {
      WebApp: {
        initData: '',
        platform: 'ios',
        ready: () => {},
        expand: () => {}
      }
    },
    fetch: async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ ok: true, events: [], players: [], catalog: [] })
    }),
    addEventListener: () => {}
  };

  const mockDocument = {
    readyState: 'complete',
    documentElement: { classList: { contains: () => false, add: () => {}, remove: () => {} } },
    body: { classList: { contains: () => false, add: () => {}, remove: () => {} } },
    getElementById: (id) => getEl(id),
    querySelector: (sel) => getEl(sel.replace(/^[#.]/, '')),
    querySelectorAll: () => [],
    addEventListener: () => {}
  };

  mockWindow.window = mockWindow;
  mockWindow.document = mockDocument;

  const context = vm.createContext({
    window: mockWindow,
    document: mockDocument,
    localStorage: mockWindow.localStorage,
    Telegram: mockWindow.Telegram,
    fetch: mockWindow.fetch,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    addEventListener: () => {}
  });
  context.window = context;
  context.globalThis = context;
  mockDocument.defaultView = context;

  // 1. Must load sequentially without SyntaxError: Identifier 'X' has already been declared
  assert.doesNotThrow(() => {
    vm.runInContext(logicCode, context);
    vm.runInContext(appCode, context);
    vm.runInContext(tmaCode, context);
  }, 'Loading logic.js, app.js, tma.js sequentially threw a SyntaxError or ReferenceError');

  // 2. Verify TMA functions exist and are not recursive stubs
  assert.equal(typeof context.switchTmaTab, 'function');
  assert.equal(typeof context.window.switchTmaTab, 'function');
  assert.equal(typeof context.renderTmaCabinet, 'function');
  assert.equal(typeof context.window.renderTmaCabinet, 'function');
  assert.equal(typeof context.renderTmaApp, 'function');
  assert.equal(typeof context.window.renderTmaApp, 'function');

  // 3. Test calling renderTmaApp
  assert.doesNotThrow(() => {
    context.renderTmaApp();
  });

  // 4. Test switching tabs
  assert.doesNotThrow(() => {
    context.switchTmaTab('events');
    assert.equal(elements['tma-tab-events'].style.display, 'block');

    context.switchTmaTab('matrix');
    assert.equal(elements['tma-tab-matrix'].style.display, 'block');

    context.switchTmaTab('cabinet');
    assert.equal(elements['tma-tab-cabinet'].style.display, 'block');
  });

  // 5. Test unbound screen
  assert.doesNotThrow(() => {
    context.renderTmaUnboundScreen();
    assert.equal(elements['tma-unbound-screen'].style.display, 'block');
  });
});
