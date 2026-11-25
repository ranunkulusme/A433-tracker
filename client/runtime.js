/**
 * KoW Tracker - Unified Client Runtime & TMA Orchestrator (Deep Module)
 *
 * Centralizes environment detection (isTmaMode), unified apiFetch with consistent
 * 401 session expiration, normalized officerCatalog state access, shared matrix
 * recommendation view-model, UI utilities, and deterministic single boot orchestration
 * for both Desktop/PWA and Telegram Mini App adapters.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.KowRuntime = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (globalObj) {
  // Initialize shared globals without shadowing lexical app bindings
  if (typeof globalObj.state === 'undefined') {
    globalObj.state = {
      version: 3,
      officerCatalog: [],
      players: [],
      eventTypes: [],
      events: [],
      stockHistory: [],
      currentRole: 'r3',
      currentPlayerId: null
    };
  }
  if (typeof globalObj.currentUser === 'undefined') {
    globalObj.currentUser = null;
  }

  const hooks = {
    onNetworkError: null,
    onUnauthorizedSessionExpired: null
  };

  let webAdapter = null;
  let tmaAdapter = null;
  let bootPromise = null;

  function configure(nextHooks = {}) {
    if (typeof nextHooks.onNetworkError === 'function') {
      hooks.onNetworkError = nextHooks.onNetworkError;
    }
    if (typeof nextHooks.onUnauthorizedSessionExpired === 'function') {
      hooks.onUnauthorizedSessionExpired = nextHooks.onUnauthorizedSessionExpired;
    }
  }

  function registerWebAdapter(adapter) {
    webAdapter = adapter;
  }

  function registerTmaAdapter(adapter) {
    tmaAdapter = adapter;
  }

  function callTma(methodName, ...args) {
    const adapterFn = tmaAdapter && tmaAdapter.methods && tmaAdapter.methods[methodName];
    if (typeof adapterFn === 'function') {
      return adapterFn(...args);
    }
    const winFn = (typeof globalObj !== 'undefined') ? globalObj[methodName] : null;
    if (typeof winFn === 'function') {
      return winFn(...args);
    }
    return null;
  }

  function getDoc() {
    return (typeof globalObj.document !== 'undefined')
      ? globalObj.document
      : (typeof document !== 'undefined' ? document : null);
  }

  function getWin() {
    return (typeof globalObj.window !== 'undefined')
      ? globalObj.window
      : globalObj;
  }

  function getStorage(kind = 'localStorage') {
    try {
      if (globalObj && globalObj[kind]) return globalObj[kind];
      if (kind === 'localStorage' && typeof localStorage !== 'undefined') return localStorage;
      if (kind === 'sessionStorage' && typeof sessionStorage !== 'undefined') return sessionStorage;
    } catch (_) {}
    return null;
  }

  // ─── TMA ENVIRONMENT & VIEWPORT MANAGEMENT ─────────────────────
  function disableTmaView() {
    const sess = getStorage('sessionStorage');
    if (sess) {
      try { sess.removeItem('kow_tma'); } catch (_) {}
    }
    const doc = getDoc();
    if (!doc) return;
    if (typeof doc.documentElement?.classList?.remove === 'function') {
      doc.documentElement.classList.remove('tma-mode');
    }
    if (typeof doc.body?.classList?.remove === 'function') {
      doc.body.classList.remove('tma-mode');
    }
    const appEl = typeof doc.getElementById === 'function' ? doc.getElementById('app') : null;
    if (appEl && appEl.style && appEl.style.display === 'none') {
      appEl.style.display = '';
    }
    const tmaEl = typeof doc.getElementById === 'function' ? doc.getElementById('tma-app') : null;
    if (tmaEl && tmaEl.style) {
      tmaEl.style.display = 'none';
    }
  }

  function enableTmaView() {
    const sess = getStorage('sessionStorage');
    if (sess) {
      try { sess.setItem('kow_tma', '1'); } catch (_) {}
    }
    const doc = getDoc();
    if (!doc) return;
    if (doc.documentElement?.classList?.add) {
      doc.documentElement.classList.add('tma-mode');
    }
    if (doc.body?.classList?.add) {
      doc.body.classList.add('tma-mode');
    }
    const tmaEl = typeof doc.getElementById === 'function' ? doc.getElementById('tma-app') : null;
    if (tmaEl && tmaEl.style) {
      tmaEl.style.display = 'flex';
    }
    const appEl = typeof doc.getElementById === 'function' ? doc.getElementById('app') : null;
    if (appEl && appEl.style) {
      appEl.style.display = 'none';
    }
    const authModal = typeof doc.getElementById === 'function' ? doc.getElementById('modal-auth') : null;
    if (authModal) {
      authModal.classList?.remove?.('open');
      if (authModal.style) authModal.style.display = 'none';
    }
    const overlay = typeof doc.getElementById === 'function' ? doc.getElementById('overlay') : null;
    if (overlay) {
      overlay.classList?.remove?.('open');
      if (overlay.style) overlay.style.display = 'none';
    }
  }

  function detectTmaMarkers() {
    const win = getWin();
    if (!win) return false;
    const sess = getStorage('sessionStorage');
    const markActive = () => {
      if (sess) {
        try { sess.setItem('kow_tma', '1'); } catch (_) {}
      }
      return true;
    };

    if (win.TelegramWebviewProxy || globalObj.TelegramWebviewProxy) {
      return markActive();
    }
    const nav = win.navigator || globalObj.navigator || (typeof navigator !== 'undefined' ? navigator : null);
    if (nav && /Telegram/i.test(nav.userAgent || '')) {
      return markActive();
    }
    try {
      const s = (win.location && win.location.search) ? win.location.search : '';
      if (s && (s.indexOf('tma=1') !== -1 || s.indexOf('tma=') !== -1 || s === '?tma')) {
        return markActive();
      }
      if (typeof URLSearchParams !== 'undefined' && s) {
        const params = new URLSearchParams(s);
        if (params.get('tma') === '1' || params.has('tma')) {
          return markActive();
        }
      }
    } catch (_) {}
    try {
      const h = (win.location && win.location.hash) ? win.location.hash : '';
      if (h && (
        h.indexOf('tgWebAppData') !== -1 ||
        h.indexOf('tgWebAppPlatform') !== -1 ||
        h.indexOf('tgWebAppVersion') !== -1 ||
        h.indexOf('tma=1') !== -1 ||
        h.indexOf('tma') !== -1
      )) {
        return markActive();
      }
    } catch (_) {}

    const tg = (win.Telegram || globalObj.Telegram)?.WebApp;
    if (tg) {
      if (tg.initData && typeof tg.initData === 'string' && tg.initData.length > 0) {
        return markActive();
      }
      if (tg.initDataUnsafe && (tg.initDataUnsafe.user || tg.initDataUnsafe.query_id || tg.initDataUnsafe.start_param)) {
        return markActive();
      }
    }
    return false;
  }

  function isTmaMode() {
    if (detectTmaMarkers()) {
      return true;
    }
    disableTmaView();
    return false;
  }

  function applyInitialTmaMode() {
    if (detectTmaMarkers()) {
      const doc = getDoc();
      if (doc) {
        doc.documentElement?.classList?.add?.('tma-mode');
        doc.body?.classList?.add?.('tma-mode');
      }
      return true;
    }
    disableTmaView();
    return false;
  }

  function setupTmaEnvironment() {
    const win = getWin();
    const tg = (win?.Telegram || globalObj.Telegram)?.WebApp;
    if (tg) {
      try {
        if (typeof tg.ready === 'function') tg.ready();
        if (typeof tg.expand === 'function') tg.expand();
        if (typeof tg.setHeaderColor === 'function') tg.setHeaderColor('#171b22');
        if (typeof tg.setBackgroundColor === 'function') tg.setBackgroundColor('#090a0f');
        if (typeof tg.enableClosingConfirmation === 'function') tg.enableClosingConfirmation();
      } catch (err) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('TMA SDK init error:', err);
        }
      }
    }
    callTma('updateTmaLanguageUI');
  }

  // ─── SHARED UI & FORMAT UTILITIES ──────────────────────────────
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function fmtNum(value, digits = 0) {
    if (value === null || value === undefined || isNaN(value)) {
      value = 0;
    }
    return (Number(value) || 0)
      .toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits })
      .replace(/[\u00a0\u202f]/g, ' ');
  }

  function toast(msg, type = 'success') {
    const doc = getDoc();
    if (!doc || typeof doc.createElement !== 'function') return;
    const container = (typeof doc.getElementById === 'function' ? doc.getElementById('toasts') : null) || doc.body;
    if (!container || typeof container.appendChild !== 'function') return;
    const el = doc.createElement('div');
    el.className = `toast ${type || 'info'}`;
    el.innerHTML = `<span>${{ success: '✓', error: '✕', info: 'ℹ' }[type] || '✓'}</span><span>${msg}</span>`;
    container.appendChild(el);
    setTimeout(() => {
      try { el.remove(); } catch (_) {}
    }, 3500);
  }

  function parseEventBoundary(val, isEnd = false) {
    const logicRef = (typeof logic !== 'undefined' ? logic : globalObj.logic);
    if (logicRef && typeof logicRef.parseEventBoundary === 'function') {
      return logicRef.parseEventBoundary(val, isEnd);
    }
    if (!val) return null;
    if (val instanceof Date) return val.getTime();
    if (typeof val === 'number') return val;
    const str = String(val).trim();
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10) - 1;
      const d = parseInt(m[3], 10);
      return isEnd ? Date.UTC(y, mo, d, 23, 59, 59, 999) : Date.UTC(y, mo, d, 0, 0, 0, 0);
    }
    const p = new Date(str).getTime();
    return isNaN(p) ? null : p;
  }

  // ─── NORMALIZED CATALOG STORE & OFFICER MUTATION HELPERS ───────
  function normalizeStateCatalog(stateObj = null) {
    const st = stateObj || globalObj.state;
    if (!st || typeof st !== 'object') return [];
    if (!Array.isArray(st.officerCatalog) || st.officerCatalog.length === 0) {
      if (Array.isArray(st.catalog) && st.catalog.length > 0) {
        st.officerCatalog = st.catalog;
      } else if (!Array.isArray(st.officerCatalog)) {
        st.officerCatalog = [];
      }
    }
    if ('catalog' in st) {
      delete st.catalog;
    }
    return st.officerCatalog;
  }

  function getOfficerCatalog(stateObj = null) {
    return normalizeStateCatalog(stateObj);
  }

  function getCatalogOfficer(id, stateObj = null) {
    const catalog = getOfficerCatalog(stateObj);
    return catalog.find(o => String(o.id) === String(id)) || null;
  }

  function extractCleanOfficerResponse(res) {
    if (!res || typeof res !== 'object') return null;
    const { newStock, stockDeducted, stockRefunded, resetDelta, ...cleanOfficer } = res;
    return cleanOfficer;
  }

  function applyOfficerMutationResponse({ playerId = null, officerId = null, response = null, fallbackPatch = null } = {}) {
    const clean = extractCleanOfficerResponse(response);
    const newStock = response && response.newStock ? response.newStock : null;
    const cabinetProfile = globalObj.myCabinetProfile;

    if (newStock && cabinetProfile && (!playerId || cabinetProfile.id === playerId)) {
      cabinetProfile.stock = newStock;
    }

    const patchOfficerList = (list) => {
      if (!Array.isArray(list)) return;
      const targetId = officerId || (clean && clean.id);
      if (!targetId) return;
      const found = list.find(o => String(o.id) === String(targetId));
      if (found) {
        if (clean && clean.id) Object.assign(found, clean);
        else if (fallbackPatch) Object.assign(found, fallbackPatch);
      } else if (clean && clean.id && !officerId) {
        list.push(clean);
      }
    };

    if (cabinetProfile && (!playerId || cabinetProfile.id === playerId)) {
      patchOfficerList(cabinetProfile.officers);
    }
    const st = globalObj.state;
    if (st && Array.isArray(st.players)) {
      for (const p of st.players) {
        if (!playerId || p.id === playerId) {
          if (newStock) p.stock = newStock;
          patchOfficerList(p.officers);
        }
      }
    }
    return { cleanOfficer: clean, newStock };
  }

  function formatStockSpendSummary(prevStock, nextStock) {
    if (!prevStock || !nextStock) return '';
    const starCouponsSpent = Math.max(0, (Number(prevStock.starCoupons) || 0) - (Number(nextStock.starCoupons) || 0));
    if (starCouponsSpent > 0) return ` Списано: ${fmtNum(starCouponsSpent)} купонов звезды`;
    const couponsSpent = Math.max(0, (Number(prevStock.coupons) || 0) - (Number(nextStock.coupons) || 0));
    if (couponsSpent > 0) return ` Списано: ${fmtNum(couponsSpent)} куп.`;
    const puzzlesSpent = Math.max(0, (Number(prevStock.puzzles) || 0) - (Number(nextStock.puzzles) || 0));
    if (puzzlesSpent > 0) return ` Списано: ${fmtNum(puzzlesSpent)} медалей`;
    return '';
  }

  // ─── SHARED MATRIX & DEFICIT VIEW-MODEL ────────────────────────
  function getTroopIcon(type) {
    const tNorm = String(type || '').trim().toLowerCase();
    if (tNorm.includes('танк') || tNorm === 'tank') return '🛡️';
    if (tNorm.includes('пехот') || tNorm === 'infantry') return '🪖';
    if (tNorm.includes('пт') || tNorm.includes('сау')) return '🎯';
    if (tNorm.includes('гарнизон') || tNorm.includes('горнизон') || tNorm === 'garrison') return '🏰';
    if (tNorm.includes('осад') || tNorm === 'siege') return '💥';
    return '🎖️';
  }

  function classifyMatrixRecommendation(def = {}, localizeFn = null) {
    const loc = typeof localizeFn === 'function' ? localizeFn : ((_k, _p, d) => d || _p);
    const labelOf = (key, argsOrDefault, maybeDefault) => {
      if (typeof localizeFn === 'function') {
        return typeof maybeDefault !== 'undefined'
          ? localizeFn(key, argsOrDefault, maybeDefault)
          : localizeFn(key, argsOrDefault);
      }
      return typeof maybeDefault !== 'undefined' ? maybeDefault : argsOrDefault;
    };

    if (Number(def.deficitPuzzles) === 0) {
      const label = labelOf('tma.badge_max', 'Максимум ✓');
      return {
        rank: 0,
        code: 'max',
        label,
        badgeHtml: `<span class="badge badge-success">${label}</span>`,
        style: 'background:rgba(34,197,94,0.18);color:#4ade80;border:1px solid rgba(34,197,94,0.3)'
      };
    }
    if (def.isOnlyPersonalPuzzles || def.deficitSummary?.isOnlyPersonalPuzzles) {
      const label = labelOf('tma.badge_only_personal', 'Только личные');
      return {
        rank: 5,
        code: 'only_personal',
        label,
        badgeHtml: `<span class="badge badge-none">${label}</span>`,
        style: 'background:rgba(156,163,175,0.15);color:#d1d5db;border:1px solid rgba(156,163,175,0.25)'
      };
    }
    if (Number(def.costPerPuzzle) === 0) {
      const label = labelOf('tma.badge_only_puzzles', 'Только пазлы');
      return {
        rank: 5,
        code: 'only_puzzles',
        label,
        badgeHtml: `<span class="badge badge-none">${label}</span>`,
        style: 'background:rgba(156,163,175,0.15);color:#d1d5db;border:1px solid rgba(156,163,175,0.25)'
      };
    }
    const coupons = Number(def.deficitCoupons) || 0;
    if (coupons >= 12500) {
      const label = `🥇 ${labelOf('tma.place_num', { place: 1 }, '1 место')}`;
      return {
        rank: 1,
        code: 'place_1',
        label,
        badgeHtml: `<span class="badge" style="background:#f59e0b22;color:#d97706">${label}</span>`,
        style: 'background:rgba(245,158,11,0.22);color:#fbbf24;border:1px solid rgba(245,158,11,0.35)'
      };
    }
    if (coupons >= 6500) {
      const label = `🥈 ${labelOf('tma.place_num', { place: 2 }, '2 место')}`;
      return {
        rank: 2,
        code: 'place_2',
        label,
        badgeHtml: `<span class="badge" style="background:#64748b22;color:#94a3b8">${label}</span>`,
        style: 'background:rgba(148,163,184,0.2);color:#cbd5e1;border:1px solid rgba(148,163,184,0.3)'
      };
    }
    if (coupons >= 3500) {
      const label = `🥉 ${labelOf('tma.place_num', { place: 3 }, '3 место')}`;
      return {
        rank: 3,
        code: 'place_3',
        label,
        badgeHtml: `<span class="badge" style="background:#b4530922;color:#d97706">${label}</span>`,
        style: 'background:rgba(180,83,9,0.25);color:#f59e0b;border:1px solid rgba(180,83,9,0.35)'
      };
    }
    const label = labelOf('tma.badge_4_10_place', '4–10 место');
    return {
      rank: 4,
      code: 'place_4_10',
      label,
      badgeHtml: `<span class="badge badge-none">${label}</span>`,
      style: 'background:rgba(107,114,128,0.18);color:#9ca3af;border:1px solid rgba(107,114,128,0.25)'
    };
  }

  // ─── UNIFIED API FETCH WITH 401 SESSION RESET & OFFLINE HOOK ────
  async function apiFetch(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const storage = getStorage('localStorage');
    const token = storage ? storage.getItem('kow_token') : null;
    const headers = { ...(options.headers || {}) };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    headers['Pragma'] = 'no-cache';
    headers['Cache-Control'] = 'no-cache';

    let bodyObj = options.body;
    if (typeof bodyObj === 'string') {
      try { bodyObj = JSON.parse(bodyObj); } catch (_) {}
    }

    const fetchOptions = {
      ...options,
      cache: 'no-store',
      headers
    };

    if (options.body && typeof options.body === 'object' && !(typeof FormData !== 'undefined' && options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(options.body);
    }

    const fetchFn = (typeof globalObj.fetch === 'function')
      ? globalObj.fetch
      : (typeof fetch === 'function' ? fetch : null);
    if (!fetchFn) {
      throw new Error('fetch API is not available');
    }

    let res;
    try {
      res = await fetchFn(url, fetchOptions);
    } catch (netErr) {
      if (typeof hooks.onNetworkError === 'function') {
        return hooks.onNetworkError(url, method, bodyObj);
      }
      throw netErr;
    }

    const contentType = res.headers?.get?.('content-type') || '';
    let data = null;
    if (contentType.includes('application/json')) {
      try { data = await res.json(); } catch (_) {}
    } else if (typeof res.text === 'function') {
      try { data = await res.text(); } catch (_) {}
    } else if (typeof res.json === 'function') {
      try { data = await res.json(); } catch (_) {}
    }

    if (res.status === 401) {
      const urlStr = String(url || '');
      const isAuthOrBindRoute =
        urlStr.includes('/api/auth/') ||
        urlStr.includes('/api/telegram/bind') ||
        urlStr.includes('/api/telegram/channel-bind');
      const isTelegramDataError = Boolean(
        data && (data.error === 'INVALID_TELEGRAM_DATA' || data.error === 'MISSING_TELEGRAM_USER')
      );

      if (!isAuthOrBindRoute && !isTelegramDataError) {
        const hadSession = Boolean(globalObj.currentUser || (storage && storage.getItem('kow_token')));
        if (storage) {
          try {
            storage.removeItem('kow_token');
            storage.removeItem('kow_user');
          } catch (_) {}
        }
        globalObj.currentUser = null;

        if (typeof hooks.onUnauthorizedSessionExpired === 'function') {
          hooks.onUnauthorizedSessionExpired({ hadSession, isTma: isTmaMode(), data, url: urlStr });
        } else if (hadSession && isTmaMode()) {
          callTma('renderTmaUnboundScreen', { message: 'Сессия истекла. Пожалуйста, войдите снова.' });
        }
      }

      const message = (data && (data.message || data.error)) || res.statusText || 'UNAUTHORIZED';
      const err = new Error(message);
      err.status = 401;
      err.data = data;
      throw err;
    }

    if (!res.ok) {
      const message = (data && data.message) || (data && data.error) || res.statusText || 'API Error';
      const err = new Error(message);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  }

  // ─── DETERMINISTIC SINGLE BOOT ORCHESTRATOR ────────────────────
  function boot() {
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      const inTma = isTmaMode();
      if (inTma) {
        enableTmaView();
        setupTmaEnvironment();
      } else {
        disableTmaView();
      }

      if (webAdapter && typeof webAdapter.initShared === 'function') {
        await webAdapter.initShared({ isTma: inTma });
      }

      if (inTma) {
        if (tmaAdapter && typeof tmaAdapter.launch === 'function') {
          await tmaAdapter.launch();
        }
      } else if (webAdapter && typeof webAdapter.launchWeb === 'function') {
        await webAdapter.launchWeb();
      }
    })();
    return bootPromise;
  }

  function resetBootForTests() {
    bootPromise = null;
  }

  const runtimeApi = {
    configure,
    registerWebAdapter,
    registerTmaAdapter,
    callTma,
    boot,
    resetBootForTests,
    isTmaMode,
    applyInitialTmaMode,
    enableTmaView,
    disableTmaView,
    setupTmaEnvironment,
    apiFetch,
    toast,
    fmtNum,
    escapeHtml,
    parseEventBoundary,
    normalizeStateCatalog,
    getOfficerCatalog,
    getCatalogOfficer,
    extractCleanOfficerResponse,
    applyOfficerMutationResponse,
    formatStockSpendSummary,
    getTroopIcon,
    classifyMatrixRecommendation
  };

  // Expose core utilities cleanly on global scope for shared access across scripts
  const sharedExports = {
    isTmaMode,
    enableTmaView,
    disableTmaView,
    setupTmaEnvironment,
    apiFetch,
    toast,
    fmtNum,
    escapeHtml,
    parseEventBoundary,
    normalizeStateCatalog,
    getOfficerCatalog,
    getCatalogOfficer,
    extractCleanOfficerResponse,
    applyOfficerMutationResponse,
    formatStockSpendSummary
  };

  globalObj.KowRuntime = runtimeApi;
  Object.assign(globalObj, sharedExports);
  if (globalObj.window && globalObj.window !== globalObj) {
    globalObj.window.KowRuntime = runtimeApi;
    Object.assign(globalObj.window, sharedExports);
  }
  if (typeof globalObj.getLocalizedOfficerType !== 'function') {
    const fallbackLocType = (type) => {
      const logicRef = (typeof logic !== 'undefined' ? logic : globalObj.logic);
      if (logicRef && typeof logicRef.getLocalizedOfficerType === 'function') {
        return logicRef.getLocalizedOfficerType(type);
      }
      return type || '';
    };
    globalObj.getLocalizedOfficerType = fallbackLocType;
    if (globalObj.window && globalObj.window !== globalObj) {
      globalObj.window.getLocalizedOfficerType = fallbackLocType;
    }
  }

  return runtimeApi;
});
