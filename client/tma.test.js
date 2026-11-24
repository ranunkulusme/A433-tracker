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
    documentElement: { classList: { add: () => {}, remove: () => {}, contains: () => true } },
    body: { classList: { add: () => {}, remove: () => {}, contains: () => true }, appendChild: () => {} },
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
    documentElement: { classList: { add: () => {}, remove: () => {}, contains: () => true } },
    body: { classList: { add: () => {}, remove: () => {}, contains: () => true } },
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
    documentElement: { classList: { add: () => {}, remove: () => {}, contains: () => true } },
    body: { classList: { add: () => {}, remove: () => {}, contains: () => true } },
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
  Object.assign(context, mockWindow);
  Object.assign(context, mockWindow);
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

  // 6. Test openAuthModal in TMA mode suppresses modal-auth and renders unbound screen
  assert.doesNotThrow(() => {
    elements['modal-auth'].classList.remove('open');
    elements['overlay'].classList.remove('open');
    context.openAuthModal('login', 'Тестовое предупреждение');
    assert.equal(elements['modal-auth'].classList.contains('open'), false);
    assert.equal(elements['overlay'].classList.contains('open'), false);
    assert.equal(elements['tma-unbound-screen'].style.display, 'block');
  });
});

test('initTmaAuth self-heals using kow_token and binds telegram when telegram-webapp returns 404', async () => {
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
        addEventListener: () => {}
      };
    }
    return elements[id];
  }

  const mockStorage = {
    kow_token: 'existing_valid_token'
  };

  const requestsMade = [];
  const mockWindow = {
    location: { search: '?tma=1', hash: '', pathname: '/' },
    localStorage: {
      getItem: (k) => mockStorage[k] || null,
      setItem: (k, v) => { mockStorage[k] = String(v); },
      removeItem: (k) => { delete mockStorage[k]; }
    },
    Telegram: {
      WebApp: {
        initData: 'query_id=test_data&user=%7B%22id%22%3A999%7D',
        platform: 'ios',
        ready: () => {},
        expand: () => {}
      }
    },
    fetch: async (url, options) => {
      requestsMade.push({ url, options });
      if (url === '/api/auth/telegram-webapp') {
        return {
          ok: false,
          status: 404,
          headers: { get: () => 'application/json' },
          json: async () => ({ error: 'USER_NOT_BOUND' })
        };
      }
      if (url === '/api/auth/me') {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ user: { id: 42, username: 'player42', rank: 'Р3' } })
        };
      }
      if (url === '/api/telegram/bind-webapp') {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ success: true })
        };
      }
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ ok: true, events: [], players: [], catalog: [] })
      };
    },
    addEventListener: () => {}
  };

  const mockDocument = {
    readyState: 'complete',
    documentElement: { classList: { contains: () => true, add: () => {}, remove: () => {} } },
    body: { classList: { contains: () => true, add: () => {}, remove: () => {} } },
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
  Object.assign(context, mockWindow);
  Object.assign(context, mockWindow);
  context.window = context;
  context.globalThis = context;
  mockDocument.defaultView = context;

  vm.runInContext(logicCode, context);
  vm.runInContext(appCode, context);
  vm.runInContext(tmaCode, context);

  const authSuccess = await context.initTmaAuth();
  assert.equal(authSuccess, true, 'initTmaAuth should return true after self-healing via existing token');

  // Verify requests made in order:
  // 1. /api/auth/telegram-webapp (fails with 404)
  // 2. /api/auth/me (validates existing session)
  // 3. /api/telegram/bind-webapp (binds telegram so subsequent launches auto-login)
  const calledUrls = requestsMade.map(r => r.url);
  assert.ok(calledUrls.includes('/api/auth/telegram-webapp'), 'Should attempt telegram-webapp');
  assert.ok(calledUrls.includes('/api/auth/me'), 'Should check /api/auth/me fallback');
  assert.ok(calledUrls.includes('/api/telegram/bind-webapp'), 'Should auto-bind telegram to account');
});

test('apiFetch does not intercept /api/auth/ 401 errors with "Сессия истекла"', async () => {
  const logicCode = fs.readFileSync(path.join(__dirname, '../shared/logic.js'), 'utf8');
  const appCode = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const tmaCode = fs.readFileSync(path.join(__dirname, 'tma.js'), 'utf8');

  let unboundMessage = null;
  const mockWindow = {
    location: { search: '?tma=1', hash: '', pathname: '/' },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    },
    Telegram: {
      WebApp: { initData: '', platform: 'ios', ready: () => {}, expand: () => {} }
    },
    fetch: async (url) => {
      if (url === '/api/auth/login') {
        return {
          ok: false,
          status: 401,
          headers: { get: () => 'application/json' },
          json: async () => ({ error: 'INVALID_CREDENTIALS', message: 'Неверный логин или пароль' })
        };
      }
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({})
      };
    },
    addEventListener: () => {}
  };

  const mockDocument = {
    readyState: 'complete',
    documentElement: { classList: { contains: () => true, add: () => {}, remove: () => {} } },
    body: { classList: { contains: () => true, add: () => {}, remove: () => {} } },
    getElementById: () => ({ style: {}, classList: { add: () => {}, remove: () => {}, contains: () => false }, querySelectorAll: () => [], querySelector: () => null, focus: () => {} }),
    querySelector: () => null,
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
  Object.assign(context, mockWindow);
  Object.assign(context, mockWindow);
  context.window = context;
  context.globalThis = context;
  mockDocument.defaultView = context;

  vm.runInContext(logicCode, context);
  vm.runInContext(appCode, context);
  vm.runInContext(tmaCode, context);

  // Hook renderTmaUnboundScreen to ensure it is NOT called with "Сессия истекла"
  context.renderTmaUnboundScreen = (err) => {
    unboundMessage = err ? (err.message || String(err)) : null;
  };

  await assert.rejects(
    async () => {
      await context.apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'bad', password: 'wrong' })
      });
    },
    (err) => {
      assert.equal(err.message, 'Неверный логин или пароль');
      assert.equal(err.status, 401);
      return true;
    }
  );

  assert.equal(unboundMessage, null, 'renderTmaUnboundScreen must not be triggered with session expired on auth routes');
});

test('isTmaMode returns false in regular browser with Telegram SDK platform=weba and cleans up tma-mode', () => {
  const tmaCode = fs.readFileSync(path.join(__dirname, 'tma.js'), 'utf8');

  const sessionStorageMock = {
    kow_tma: '1',
    getItem: (k) => sessionStorageMock[k] || null,
    setItem: (k, v) => { sessionStorageMock[k] = String(v); },
    removeItem: (k) => { delete sessionStorageMock[k]; }
  };

  const docClasses = new Set(['tma-mode']);
  const bodyClasses = new Set(['tma-mode']);
  const appElement = { id: 'app', style: { display: 'none' } };
  const tmaElement = { id: 'tma-app', style: { display: 'flex' } };

  const mockWindow = {
    location: { search: '', hash: '' },
    navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    sessionStorage: sessionStorageMock,
    Telegram: {
      WebApp: {
        platform: 'weba',
        initData: '',
        initDataUnsafe: {}
      }
    }
  };

  const mockDocument = {
    readyState: 'complete',
    documentElement: {
      classList: {
        contains: (c) => docClasses.has(c),
        add: (c) => docClasses.add(c),
        remove: (c) => docClasses.delete(c)
      }
    },
    body: {
      classList: {
        contains: (c) => bodyClasses.has(c),
        add: (c) => bodyClasses.add(c),
        remove: (c) => bodyClasses.delete(c)
      }
    },
    getElementById: (id) => {
      if (id === 'app') return appElement;
      if (id === 'tma-app') return tmaElement;
      return null;
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {}
  };

  mockWindow.window = mockWindow;
  mockWindow.document = mockDocument;

  const context = vm.createContext({
    window: mockWindow,
    document: mockDocument,
    sessionStorage: mockWindow.sessionStorage,
    Telegram: mockWindow.Telegram,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout: (fn) => fn(),
    clearTimeout: () => {}
  });
  Object.assign(context, mockWindow);
  context.window = context;
  context.globalThis = context;

  vm.runInContext(tmaCode, context);

  // In standard browser with empty initData and platform 'weba', isTmaMode must be false
  assert.equal(context.isTmaMode(), false);
  // Stale kow_tma must be removed from sessionStorage
  assert.equal(sessionStorageMock.kow_tma, undefined);
  // tma-mode class must be removed from documentElement and body
  assert.equal(docClasses.has('tma-mode'), false);
  assert.equal(bodyClasses.has('tma-mode'), false);
  // Web app must be restored to visible, and tma app hidden
  assert.equal(appElement.style.display, '');
  assert.equal(tmaElement.style.display, 'none');

  // Verify that legitimate TMA markers return true
  // 1. With initData:
  mockWindow.Telegram.WebApp.initData = 'query_id=123&user=%7B%22id%22%3A1%7D&hash=abc';
  assert.equal(context.isTmaMode(), true);
  assert.equal(sessionStorageMock.kow_tma, '1');

  // 2. With tgWebAppData in hash:
  mockWindow.Telegram.WebApp.initData = '';
  sessionStorageMock.kow_tma = undefined;
  mockWindow.location.hash = '#tgWebAppData=test';
  assert.equal(context.isTmaMode(), true);

  // 3. With proxy:
  mockWindow.location.hash = '';
  context.TelegramWebviewProxy = {};
  assert.equal(context.isTmaMode(), true);
  delete context.TelegramWebviewProxy;

  // 4. With ?tma=1 search param:
  mockWindow.location.search = '?tma=1';
  assert.equal(context.isTmaMode(), true);

  // 5. TelegramGameProxy (defined by telegram-web-app.js for backward compatibility) must NOT trigger TMA mode
  mockWindow.location.search = '';
  mockWindow.location.hash = '';
  mockWindow.Telegram.WebApp.initData = '';
  mockWindow.TelegramGameProxy = { receiveEvent: () => {} };
  context.TelegramGameProxy = mockWindow.TelegramGameProxy;
  assert.equal(context.isTmaMode(), false);
  delete mockWindow.TelegramGameProxy;
  delete context.TelegramGameProxy;
});

test('app.js isTmaMode returns false in regular browser and correctly cleans up classes', () => {
  const logicCode = fs.readFileSync(path.join(__dirname, '../shared/logic.js'), 'utf8');
  const appCode = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

  const sessionStorageMock = {
    kow_tma: '1',
    getItem: (k) => sessionStorageMock[k] || null,
    setItem: (k, v) => { sessionStorageMock[k] = String(v); },
    removeItem: (k) => { delete sessionStorageMock[k]; }
  };

  const docClasses = new Set(['tma-mode']);
  const bodyClasses = new Set(['tma-mode']);
  const appElement = { id: 'app', style: { display: 'none' } };
  const tmaElement = { id: 'tma-app', style: { display: 'flex' } };

  const mockWindow = {
    location: { search: '', hash: '', pathname: '/' },
    navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
    sessionStorage: sessionStorageMock,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    Telegram: {
      WebApp: {
        platform: 'weba',
        initData: '',
        initDataUnsafe: {}
      }
    },
    addEventListener: () => {},
    fetch: async () => ({ ok: true, json: async () => ({}) })
  };

  const mockDocument = {
    readyState: 'complete',
    documentElement: {
      classList: {
        contains: (c) => docClasses.has(c),
        add: (c) => docClasses.add(c),
        remove: (c) => docClasses.delete(c)
      }
    },
    body: {
      classList: {
        contains: (c) => bodyClasses.has(c),
        add: (c) => bodyClasses.add(c),
        remove: (c) => bodyClasses.delete(c)
      }
    },
    getElementById: (id) => {
      if (id === 'app') return appElement;
      if (id === 'tma-app') return tmaElement;
      return null;
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {}
  };

  const context = vm.createContext({
    window: mockWindow,
    document: mockDocument,
    sessionStorage: mockWindow.sessionStorage,
    localStorage: mockWindow.localStorage,
    Telegram: mockWindow.Telegram,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {}
  });
  Object.assign(context, mockWindow);
  context.window = context;
  context.globalThis = context;

  vm.runInContext(logicCode, context);
  vm.runInContext(appCode, context);

  // In standard browser, app.js isTmaMode must return false
  assert.equal(context.isTmaMode(), false);
  assert.equal(sessionStorageMock.kow_tma, undefined);
  assert.equal(docClasses.has('tma-mode'), false);
  assert.equal(bodyClasses.has('tma-mode'), false);
  assert.equal(appElement.style.display, '');
  assert.equal(tmaElement.style.display, 'none');
});

test('apiFetch and initTmaAuth do not kill session or show "Сессия истекла" when /api/telegram/bind-webapp returns 401', async () => {
  const logicCode = fs.readFileSync(path.join(__dirname, '../shared/logic.js'), 'utf8');
  const appCode = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const tmaCode = fs.readFileSync(path.join(__dirname, 'tma.js'), 'utf8');

  let unboundMessage = null;
  const storage = {
    kow_token: 'valid_jwt_token_123',
    kow_user: JSON.stringify({ id: 5, username: 'hero' })
  };

  const mockWindow = {
    location: { search: '?tma=1', hash: '', pathname: '/' },
    localStorage: {
      getItem: (k) => storage[k] || null,
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: (k) => { delete storage[k]; }
    },
    Telegram: {
      WebApp: { initData: 'query_id=1&auth_date=100&hash=mock', platform: 'ios', ready: () => {}, expand: () => {} }
    },
    fetch: async (url, options = {}) => {
      if (url === '/api/auth/me') {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ user: { id: 5, username: 'hero', rank: 'r3' } })
        };
      }
      if (url === '/api/auth/login') {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ token: 'valid_jwt_token_123', user: { id: 5, username: 'hero', rank: 'r3' } })
        };
      }
      if (url === '/api/telegram/bind-webapp') {
        return {
          ok: false,
          status: 401,
          headers: { get: () => 'application/json' },
          json: async () => ({ error: 'INVALID_TELEGRAM_DATA', message: 'Ошибка валидации Telegram WebApp' })
        };
      }
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({})
      };
    },
    addEventListener: () => {}
  };

  const mockDocument = {
    readyState: 'complete',
    documentElement: { classList: { contains: () => true, add: () => {}, remove: () => {} } },
    body: { classList: { contains: () => true, add: () => {}, remove: () => {} } },
    getElementById: () => ({ style: {}, classList: { add: () => {}, remove: () => {}, contains: () => false }, querySelectorAll: () => [], querySelector: () => null, focus: () => {} }),
    querySelector: () => null,
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
  Object.assign(context, mockWindow);
  context.window = context;
  context.globalThis = context;
  mockDocument.defaultView = context;

  vm.runInContext(logicCode, context);
  vm.runInContext(appCode, context);
  vm.runInContext(tmaCode, context);

  context.renderTmaUnboundScreen = (err) => {
    unboundMessage = err ? (err.message || String(err)) : null;
  };

  // 1. Direct call to apiFetch('/api/telegram/bind-webapp') must not clear token or trigger "Сессия истекла"
  await assert.rejects(
    async () => {
      await context.apiFetch('/api/telegram/bind-webapp', {
        method: 'POST',
        body: JSON.stringify({ initData: 'mock' })
      });
    },
    (err) => {
      assert.equal(err.status, 401);
      return true;
    }
  );

  assert.equal(storage.kow_token, 'valid_jwt_token_123', 'kow_token must NOT be wiped when bind-webapp fails');
  assert.equal(unboundMessage, null, 'renderTmaUnboundScreen must NOT be called with "Сессия истекла"');

  // 2. initTmaAuth self-heal with valid token must succeed even if bind-webapp fails
  unboundMessage = null;
  const authSuccess = await context.initTmaAuth();
  assert.equal(authSuccess, true, 'initTmaAuth should succeed via valid token');
  assert.equal(storage.kow_token, 'valid_jwt_token_123', 'token should remain valid in storage');
  assert.equal(unboundMessage, null, 'unbound screen should not show session expired');

  // 3. handleTmaLoginSubmit must preserve token even if background bind-webapp fails
  unboundMessage = null;
  const loginStorage = {};
  context.localStorage = {
    getItem: (k) => loginStorage[k] || null,
    setItem: (k, v) => { loginStorage[k] = String(v); },
    removeItem: (k) => { delete loginStorage[k]; }
  };
  const mockUserInput = { value: 'hero' };
  const mockPassInput = { value: 'pass123' };
  const mockBtn = { disabled: false, textContent: '' };
  const mockAlert = { style: {}, textContent: '' };

  context.document.getElementById = (id) => {
    if (id === 'tma-login-user') return mockUserInput;
    if (id === 'tma-login-pass') return mockPassInput;
    if (id === 'tma-login-btn') return mockBtn;
    if (id === 'tma-auth-alert') return mockAlert;
    return { style: {}, classList: { add: () => {}, remove: () => {}, contains: () => false }, querySelectorAll: () => [], querySelector: () => null, focus: () => {} };
  };

  await context.handleTmaLoginSubmit({ preventDefault: () => {} });
  assert.equal(loginStorage.kow_token, 'valid_jwt_token_123', 'token must be retained in localStorage after login');
  assert.equal(unboundMessage, null, 'renderTmaUnboundScreen should not be triggered with session expired');
});

test('renderTmaCabinetEventBanner distinguishes between active and upcoming events', () => {
  const logicCode = fs.readFileSync(path.join(__dirname, '../shared/logic.js'), 'utf8');
  const tmaCode = fs.readFileSync(path.join(__dirname, 'tma.js'), 'utf8');

  const mockWindow = {
    location: { search: '?tma=1', hash: '' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    Telegram: { WebApp: { initData: '', initDataUnsafe: {}, ready: () => {} } },
    fetch: async () => ({ ok: true, json: async () => ({}) })
  };
  const mockDocument = {
    readyState: 'complete',
    documentElement: { classList: { contains: () => true, add: () => {}, remove: () => {} } },
    body: { classList: { contains: () => true, add: () => {}, remove: () => {} } },
    getElementById: () => null,
    querySelector: () => null,
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
  });
  Object.assign(context, mockWindow);
  context.window = context;
  context.globalThis = context;

  vm.runInContext(logicCode, context);
  vm.runInContext(tmaCode, context);

  // 1. Когда есть активное (уже идущее) событие
  const activeEvent = {
    id: 101,
    name: 'Битва за Берлин',
    startDate: new Date(Date.now() - 3600000).toISOString(),
    endDate: new Date(Date.now() + 86400000).toISOString(),
    officerCatalogId: 'beatrice'
  };
  const activeHtml = context.renderTmaCabinetEventBanner([activeEvent], {});
  assert.ok(activeHtml.includes('Идёт сейчас'), 'Для идущего события баннер должен содержать "Идёт сейчас"');
  assert.ok(!activeHtml.includes('Ближайший ивент'), 'Для идущего события баннер НЕ должен называть его "Ближайший ивент"');

  // 2. Когда событие еще только предстоит (в будущем)
  const upcomingEvent = {
    id: 102,
    name: 'Операция Тайфун',
    startDate: new Date(Date.now() + 86400000).toISOString(),
    endDate: new Date(Date.now() + 172800000).toISOString(),
    officerCatalogId: 'rex'
  };
  const upcomingHtml = context.renderTmaCabinetEventBanner([upcomingEvent], {});
  assert.ok(upcomingHtml.includes('Ближайший ивент'), 'Для будущего события баннер должен содержать "Ближайший ивент"');
  assert.ok(!upcomingHtml.includes('Идёт сейчас'), 'Для будущего события баннер НЕ должен содержать "Идёт сейчас"');

  // 3. Событие с dateFrom / dateTo (17-18 ноября) при текущей дате 18 ноября
  const event1718 = {
    id: 103,
    title: 'Сила времени',
    dateFrom: '2026-11-17',
    dateTo: '2026-11-18',
    officerCatalogId: 'beatrice'
  };
  // Проверяем через classifyEvents с временем 18 ноября 13:47 UTC (16:47 MSK)
  const classified1718 = context.logic.classifyEvents([event1718], new Date('2026-11-18T13:47:56Z'));
  assert.equal(classified1718.active.length, 1, 'Событие 17-18 ноября 18 ноября днем должно быть в active');
  assert.equal(classified1718.past.length, 0, 'Событие 17-18 ноября 18 ноября днем НЕ должно быть в past');
});

test('renderTmaMatrix renders compact officer cards instead of sector power ranking', () => {
  const logicCode = fs.readFileSync(path.join(__dirname, '../shared/logic.js'), 'utf8');
  const tmaCode = fs.readFileSync(path.join(__dirname, 'tma.js'), 'utf8');

  let containerHtml = '';
  const mockContainer = {
    set innerHTML(val) { containerHtml = val; },
    get innerHTML() { return containerHtml; }
  };

  const mockWindow = {
    location: { search: '?tma=1', hash: '' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    Telegram: { WebApp: { initData: '', initDataUnsafe: {}, ready: () => {} } },
    fetch: async () => ({ ok: true, json: async () => ({}) })
  };
  const mockDocument = {
    readyState: 'complete',
    documentElement: { classList: { contains: () => true, add: () => {}, remove: () => {} } },
    body: { classList: { contains: () => true, add: () => {}, remove: () => {} } },
    getElementById: (id) => {
      if (id === 'tma-tab-matrix') return mockContainer;
      return null;
    },
    querySelector: () => null,
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
  });
  Object.assign(context, mockWindow);
  context.window = context;
  context.globalThis = context;

  vm.runInContext(logicCode, context);
  vm.runInContext(tmaCode, context);

  context.state = {
    players: [
      {
        id: 1,
        name: 'Командир Альфа',
        stock: { coupons: 15000, puzzles: 50, updatedAt: new Date().toISOString() },
        officers: [
          { id: 'off-1', catalogId: 'beatrice', level: 120, stars: 5, skills: [5, 5, 5, 5] },
          { id: 'off-2', catalogId: 'angel', level: 146, stars: 5, skills: [5, 5, 5, 5], personalPuzzles: 155, onlyPersonalPuzzles: true }
        ]
      }
    ],
    officerCatalog: [
      { id: 'beatrice', name: 'Беатрис', type: 'Танк', generation: 6, couponPerPuzzle: 500 },
      { id: 'angel', name: 'Анхель', type: 'Танк', generation: 7, couponPerPuzzle: 0, upgradeType: 'special' }
    ],
    events: [],
    currentRole: 'r5'
  };
  context.currentUser = { id: 1, playerId: 1, rank: 'r5' };

  context.renderTmaMatrix();

  // Проверка:
  // 1. Должна быть карточка для Беатрис и Анхель
  assert.ok(containerHtml.includes('Беатрис'), 'Матрица должна отображать офицера Беатрис');
  assert.ok(containerHtml.includes('Анхель'), 'Матрица должна отображать офицера Анхель');

  // 2. Должны быть бейджи рекомендаций
  assert.ok(containerHtml.includes('Только личные'), 'Для Анхель должен отображаться бейдж Только личные');

  // 3. Не должно быть старой заглушки рейтинга секторов
  assert.ok(!containerHtml.includes('Сводка гильдии (Рейтинг)'), 'Не должно быть старой заглушки рейтинга');

  // 4. Должны присутствовать чипы фильтра родов войск (строго 5 видов, без Авиации)
  assert.ok(!containerHtml.includes('Авиация'), 'Авиация должна быть исключена');
  assert.ok(containerHtml.includes('Танк'), 'Должен присутствовать фильтр Танк');
  assert.ok(containerHtml.includes('Пехота'), 'Должен присутствовать фильтр Пехота');
});

test('submitTmaEventEditor normalizes dates to YYYY-MM-DD and preserves officerId/rsvpStatus', async () => {
  const tmaCode = fs.readFileSync(path.join(__dirname, 'tma.js'), 'utf8');

  let savedPayload = null;
  const mockElements = {
    'tma-ee-type': { value: '1' },
    'tma-event-editor-title': { textContent: '' },
    'tma-ee-date-from': { value: '2026-11-25T14:30' },
    'tma-ee-date-to': { value: '2026-11-28T18:00' },
    'tma-ee-note': { value: 'Test Event' },
    'tma-ee-save-btn': { disabled: false },
    'tma-ee-places-list': { innerHTML: '' },
    'tma-ee-places-count': { textContent: '' },
    'tma-event-editor-modal': { style: {}, querySelector: () => null }
  };

  const mockWindow = {
    location: { search: '?tma=1', hash: '' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    Telegram: { WebApp: { initData: '', initDataUnsafe: {}, ready: () => {} } },
    fetch: async () => ({ ok: true, json: async () => ({}) })
  };
  const mockDocument = {
    readyState: 'complete',
    documentElement: { classList: { contains: () => true, add: () => {}, remove: () => {} } },
    body: { classList: { contains: () => true, add: () => {}, remove: () => {} }, appendChild: () => {} },
    getElementById: (id) => mockElements[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ classList: { add: () => {} }, appendChild: () => {}, setAttribute: () => {} }),
    addEventListener: () => {}
  };
  mockWindow.window = mockWindow;
  mockWindow.document = mockDocument;

  const context = vm.createContext({
    window: mockWindow,
    document: mockDocument,
    localStorage: mockWindow.localStorage,
    Telegram: mockWindow.Telegram,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
  });
  Object.assign(context, mockWindow);
  context.window = context;
  context.globalThis = context;

  vm.runInContext(tmaCode, context);

  // Set existing event with assignments having officerId and rsvpStatus
  context.state = {
    eventTypes: [{ id: 1, name: 'Король Войны', places: [{ place: 1, coupons: 30000 }] }],
    players: [{ id: 42, name: 'Сектор 42', officers: [{ id: 'off-42', name: 'Офицер 42' }] }],
    events: [{
      id: 99,
      typeId: 1,
      dateFrom: '2026-11-25',
      dateTo: '2026-11-28',
      places: [{ place: 1, coupons: 30000 }],
      assignments: [{ place: 1, playerId: 42, officerId: 'off-42', rsvpStatus: 'confirmed' }]
    }]
  };

  context.doTmaApiFetch = async (url, opts) => {
    if (url === '/api/events' && opts.method === 'POST') {
      savedPayload = opts.body;
      return { id: 99, ...opts.body };
    }
    return { ok: true };
  };

  context.openTmaEventEditor(99);
  // Simulate user changing date to datetime-local values
  mockElements['tma-ee-date-from'].value = '2026-11-25T14:30';
  mockElements['tma-ee-date-to'].value = '2026-11-28T18:00';

  await context.submitTmaEventEditor();

  assert.ok(savedPayload, 'Event payload must be submitted');
  assert.equal(savedPayload.dateFrom, '2026-11-25', 'dateFrom must be normalized to YYYY-MM-DD without timestamp');
  assert.equal(savedPayload.dateTo, '2026-11-28', 'dateTo must be normalized to YYYY-MM-DD without timestamp');
  assert.equal(savedPayload.assignments.length, 1);
  assert.equal(savedPayload.assignments[0].officerId, 'off-42', 'Existing officerId must be preserved');
  assert.equal(savedPayload.assignments[0].rsvpStatus, 'confirmed', 'Existing rsvpStatus must be preserved');
});

test('web app renderEventDetail and calCard handle TMA edited event with clean dates and safe officers', () => {
  const logicCode = fs.readFileSync(path.join(__dirname, '..', 'shared', 'logic.js'), 'utf8');
  const appCode = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

  let contentHtml = '';
  const mockElements = {
    content: {
      set innerHTML(val) { contentHtml = val; },
      get innerHTML() { return contentHtml; }
    },
    'page-title': { textContent: '' },
    'role-switch': { value: '' }
  };

  const mockWindow = {
    location: { hash: '#event/99', search: '' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { standalone: false, userAgent: 'test' },
    addEventListener: () => {},
    matchMedia: () => ({ matches: false }),
    fetch: async () => ({ ok: true, json: async () => ({}) })
  };
  const mockDocument = {
    readyState: 'complete',
    documentElement: { classList: { contains: () => false, add: () => {}, remove: () => {} } },
    body: { classList: { contains: () => false, add: () => {}, remove: () => {} } },
    getElementById: (id) => mockElements[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {}
  };
  mockWindow.window = mockWindow;
  mockWindow.document = mockDocument;

  const context = vm.createContext({
    window: mockWindow,
    document: mockDocument,
    localStorage: mockWindow.localStorage,
    navigator: mockWindow.navigator,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    fetch: mockWindow.fetch
  });

  vm.runInContext(logicCode, context);
  vm.runInContext(appCode, context);

  // Event edited in TMA before normalization fix (or with ISO timestamp)
  const tmaEvent = {
    id: 99,
    typeId: 1,
    dateFrom: '2026-11-25T14:30',
    dateTo: '2026-11-28T18:00',
    note: 'TMA Note',
    assignments: [
      { place: 1, playerId: 42, actualCoupons: 30000 }
    ]
  };

  vm.runInContext(`
    state.eventTypes = [{ id: 1, name: 'Король Войны', places: [{ place: 1, coupons: 30000 }] }];
    // Player without officers to ensure crash-resistance
    state.players = [{ id: 42, name: 'Сектор 42' }];
    state.events = [${JSON.stringify(tmaEvent)}];
    renderEventDetail(99);
  `, context);

  assert.ok(contentHtml.includes('Король Войны'), 'Must render event type name');
  assert.ok(!contentHtml.includes('Invalid Date'), 'Must never render Invalid Date');
  assert.ok(contentHtml.includes('25 нояб. 2026 г.'), 'Must render properly formatted Russian start date');
  assert.ok(contentHtml.includes('28 нояб. 2026 г.'), 'Must render properly formatted Russian end date');
  assert.ok(contentHtml.includes('Сектор 42'), 'Must render assigned player without throwing');
});




