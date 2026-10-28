// ─── CONSTANTS ───────────────────────────────────────────────
const APP_VERSION = 'v3.16.0';
const COUPON_PER_PUZZLE = 500;
const PUZZLES_PER_LEVEL = 5;
const MAX_LEVEL = 180;

// ─── STATE ───────────────────────────────────────────────────
let state = {
  version: 3,
  officerCatalog: [],
  players: [],    // { id, name, officers: [{id, name, level, coupons}] }
  eventTypes: [], // { id, name, color, places: [{place, label, coupons}] }
  events: [],     // { id, typeId, dateFrom, dateTo, assignments: [{place, playerId, officerId, actualCoupons?}], note }
  stockHistory: [],
  currentRole: 'r5',
  currentPlayerId: null,
  stockSyncEnabled: true,
  nextId: 1,
};

let currentUser = null;
let pendingRequestsCount = 0;
let myCabinetProfile = null;
let myCabinetSectors = [];
let regModalSelectedSectorId = null;
let myCabinetSim = {
  officerId: null,
  targetLevel: 180,
  planned: { top1: 0, top2: 0, top3: 0, top4: 0 }
};
let myOfficerEditId = null;
let regModalEventId = null;
let currentEventRegistrations = [];

function getUserSectors() {
  if (!currentUser) return [];
  const list = [];
  const seen = new Set();

  if (Array.isArray(myCabinetSectors) && myCabinetSectors.length > 0) {
    for (const s of myCabinetSectors) {
      if (s && s.id && !seen.has(Number(s.id))) {
        seen.add(Number(s.id));
        list.push(s);
      }
    }
  }

  if (Array.isArray(state.players)) {
    for (const p of state.players) {
      if (p && p.id && !seen.has(Number(p.id)) && p.userId !== undefined && p.userId !== null && Number(p.userId) === Number(currentUser.id)) {
        seen.add(Number(p.id));
        list.push(p);
      }
    }
  }

  if (list.length === 0) {
    const pl = myCabinetProfile || (currentUser.playerId ? getPlayer(currentUser.playerId) : null);
    if (pl && pl.id) {
      list.push(pl);
    }
  }

  return list;
}

// ─── API & OUTBOX QUEUE HELPERS ──────────────────────────────
let isFlushingOutbox = false;
let deferredPrompt = null;

function getLogic() {
  if (typeof logic !== 'undefined') return logic;
  if (typeof window !== 'undefined') return window;
  return globalThis;
}

function getOutboxQueue() {
  try {
    const raw = localStorage.getItem('kow_outbox_queue');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveOutboxQueue(queue) {
  try {
    localStorage.setItem('kow_outbox_queue', JSON.stringify(Array.isArray(queue) ? queue : []));
  } catch (e) {
    console.error('Failed to save outbox queue', e);
  }
}

function updateNetworkStatusUI() {
  if (typeof document === 'undefined') return;
  const badge = document.getElementById('network-status-badge');
  if (!badge) return;

  const isOnline = typeof navigator === 'undefined' || navigator.onLine;
  const queue = getOutboxQueue();

  if (isFlushingOutbox) {
    badge.className = 'network-badge syncing';
    badge.innerHTML = '🔄 <span class="badge-text">Синхронизация...</span>';
    badge.title = 'Отправка сохраненных оффлайн-изменений на сервер';
  } else if (!isOnline) {
    badge.className = 'network-badge offline';
    const queueText = queue.length > 0 ? ` (${queue.length})` : '';
    badge.innerHTML = `🟡 <span class="badge-text">Оффлайн${queueText}</span>`;
    badge.title = queue.length > 0
      ? `Оффлайн-режим. В очереди на синхронизацию: ${queue.length}`
      : 'Оффлайн-режим';
  } else if (queue.length > 0) {
    badge.className = 'network-badge pending';
    badge.innerHTML = `🟡 <span class="badge-text">В очереди: ${queue.length}</span>`;
    badge.title = `В очереди на синхронизацию: ${queue.length}`;
  } else {
    badge.className = 'network-badge online';
    badge.innerHTML = '🟢 <span class="badge-text">Онлайн</span>';
    badge.title = 'Подключено к серверу, все данные сохранены';
  }
}

function handleNetworkBadgeClick() {
  const isOnline = typeof navigator === 'undefined' || navigator.onLine;
  const queue = getOutboxQueue();

  if (isFlushingOutbox) {
    toast('Идет синхронизация с сервером...', 'info');
    return;
  }

  if (queue.length > 0 && isOnline) {
    toast('Запуск синхронизации очереди...', 'info');
    flushOutboxQueue();
    return;
  }

  if (!isOnline && queue.length > 0) {
    toast('Оффлайн-режим. Сохранено в очереди: ' + queue.length + ' действий. Нажмите при появлении сети для синхронизации.', 'info');
    return;
  }

  if (!isOnline && queue.length === 0) {
    toast('Оффлайн-режим. Очередь синхронизации пуста. Все изменения сохраняются локально.', 'info');
    return;
  }

  toast('Все данные синхронизированы с сервером', 'success');
}

async function handleInstallPwaClick() {
  if (deferredPrompt) {
    try {
      deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult && choiceResult.outcome === 'accepted') {
        deferredPrompt = null;
        const btn = document.getElementById('pwa-install-btn');
        if (btn) btn.style.display = 'none';
      }
    } catch (e) {
      console.warn('Install prompt error', e);
    }
    return;
  }

  const isIos = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isStandalone = !!((typeof window !== 'undefined' && window.navigator && window.navigator.standalone)
    || (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));

  if (isIos && !isStandalone) {
    openModal('modal-ios-install');
    return;
  }

  toast('Для установки приложения используйте пункт меню браузера «Установить» или «Добавить на главный экран»', 'info');
}

function checkPwaInstallable() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isStandalone = !!(window.navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));
  if (isIos && !isStandalone) {
    const btn = document.getElementById('pwa-install-btn');
    if (btn) btn.style.display = 'inline-flex';
  }
}

function applyOptimisticUpdate(url, method, bodyObj) {
  const m = (method || 'POST').toUpperCase();

  // R3 profile update: PUT /api/my-profile
  if (url === '/api/my-profile' && m === 'PUT') {
    if (myCabinetProfile) {
      if (bodyObj?.sector) {
        myCabinetProfile.sector = { ...(myCabinetProfile.sector || {}), ...bodyObj.sector };
      }
      if (bodyObj?.stock) {
        myCabinetProfile.stock = { ...(myCabinetProfile.stock || {}), ...bodyObj.stock };
      }
    }
    if (currentUser?.playerId && Array.isArray(state.players)) {
      const pl = state.players.find(p => p.id === currentUser.playerId);
      if (pl) {
        if (bodyObj?.sector) pl.sector = { ...(pl.sector || {}), ...bodyObj.sector };
        if (bodyObj?.stock) pl.stock = { ...(pl.stock || {}), ...bodyObj.stock };
      }
    }
  }

  // Officer create: POST /api/my-profile/officers
  if (url === '/api/my-profile/officers' && m === 'POST') {
    if (myCabinetProfile) {
      myCabinetProfile.officers = myCabinetProfile.officers || [];
      myCabinetProfile.officers.push({ ...bodyObj });
    }
    if (currentUser?.playerId && Array.isArray(state.players)) {
      const pl = state.players.find(p => p.id === currentUser.playerId);
      if (pl) {
        pl.officers = pl.officers || [];
        pl.officers.push({ ...bodyObj });
      }
    }
  }

  // Officer update: PUT /api/my-profile/officers/:id
  const offMatch = url.match(/^\/api\/my-profile\/officers\/([^/]+)$/);
  if (offMatch && m === 'PUT') {
    const offId = offMatch[1];
    if (myCabinetProfile?.officers) {
      const off = myCabinetProfile.officers.find(o => String(o.id) === String(offId));
      if (off && bodyObj) {
        Object.assign(off, bodyObj);
      }
    }
    if (currentUser?.playerId && Array.isArray(state.players)) {
      const pl = state.players.find(p => p.id === currentUser.playerId);
      if (pl?.officers) {
        const off = pl.officers.find(o => String(o.id) === String(offId));
        if (off && bodyObj) {
          Object.assign(off, bodyObj);
        }
      }
    }
  }

  // Officer delete: DELETE /api/my-profile/officers/:id
  if (offMatch && m === 'DELETE') {
    const offId = offMatch[1];
    if (myCabinetProfile?.officers) {
      myCabinetProfile.officers = myCabinetProfile.officers.filter(o => String(o.id) !== String(offId));
    }
    if (currentUser?.playerId && Array.isArray(state.players)) {
      const pl = state.players.find(p => p.id === currentUser.playerId);
      if (pl?.officers) {
        pl.officers = pl.officers.filter(o => String(o.id) !== String(offId));
      }
    }
  }

  // Event registration: POST or DELETE /api/events/:id/register or /registrations
  const regMatch = url.match(/^\/api\/events\/([^/]+)\/(register|registrations)/);
  if (regMatch) {
    const eventId = regMatch[1];
    const ev = (state.events || []).find(e => String(e.id) === String(eventId));
    if (ev) {
      if (m === 'POST') {
        const targetSectorId = (bodyObj && bodyObj.sectorId) ? Number(bodyObj.sectorId) : (currentUser?.playerId ? Number(currentUser.playerId) : null);
        ev.myRegistrations = ev.myRegistrations || [];
        const existingIdx = ev.myRegistrations.findIndex(r => Number(r.playerId) === Number(targetSectorId));
        const regItem = { ...(bodyObj || {}), playerId: targetSectorId };
        if (existingIdx >= 0) {
          ev.myRegistrations[existingIdx] = regItem;
        } else {
          ev.myRegistrations.push(regItem);
        }
        if (Number(targetSectorId) === Number(currentUser?.playerId) || !ev.myRegistration) {
          ev.myRegistration = regItem;
        }
      } else if (m === 'DELETE') {
        let targetSectorId = null;
        try {
          const u = new URL(url, 'http://localhost');
          if (u.searchParams.get('sectorId')) {
            targetSectorId = Number(u.searchParams.get('sectorId'));
          }
        } catch (_) {}
        if (!targetSectorId && bodyObj && bodyObj.sectorId) {
          targetSectorId = Number(bodyObj.sectorId);
        }
        if (!targetSectorId) {
          targetSectorId = currentUser?.playerId ? Number(currentUser.playerId) : null;
        }

        if (Array.isArray(ev.myRegistrations)) {
          ev.myRegistrations = ev.myRegistrations.filter(r => Number(r.playerId) !== Number(targetSectorId));
        }
        if (ev.myRegistration && Number(ev.myRegistration.playerId) === Number(targetSectorId)) {
          delete ev.myRegistration;
          if (ev.myRegistrations && ev.myRegistrations.length > 0) {
            ev.myRegistration = ev.myRegistrations[0];
          }
        }
      }
    }
  }
}

function handleOfflineApiRequest(url, method, bodyObj) {
  const m = (method || 'GET').toUpperCase();
  const logicApi = getLogic();

  if (m === 'POST' || m === 'PUT' || m === 'DELETE') {
    const isAllowed = typeof logicApi.isOfflineMutationAllowed === 'function'
      ? logicApi.isOfflineMutationAllowed({ endpoint: url, method: m })
      : false;

    if (!isAllowed) {
      toast('Это действие доступно только при подключении к сети', 'warning');
      const err = new Error('OFFLINE_ACTION_NOT_ALLOWED');
      err.status = 0;
      throw err;
    }

    if (url === '/api/my-profile/officers' && m === 'POST') {
      if (!bodyObj) bodyObj = {};
      if (!bodyObj.id) {
        bodyObj.id = `po-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      }
    }

    const item = typeof logicApi.createOutboxItem === 'function'
      ? logicApi.createOutboxItem({ endpoint: url, method: m, body: bodyObj })
      : { id: `outbox_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, endpoint: url, method: m, body: bodyObj, timestamp: Date.now(), retryCount: 0 };

    const currentQueue = getOutboxQueue();
    const updatedQueue = typeof logicApi.addToOutboxQueue === 'function'
      ? logicApi.addToOutboxQueue(currentQueue, item)
      : [...currentQueue, item];

    saveOutboxQueue(updatedQueue);
    updateNetworkStatusUI();

    applyOptimisticUpdate(url, m, bodyObj);
    if (typeof save === 'function') {
      save();
    }

    toast('Изменения сохранены локально и будут отправлены на сервер при появлении сети', 'info');
    return { success: true, offline: true };
  }

  // GET requests in offline mode
  if (m === 'GET') {
    if (url === '/api/auth/me') {
      if (currentUser) return { user: currentUser, player: currentUser.player || null };
      return { offline: true };
    }
    if (url === '/api/my-profile') {
      const pl = myCabinetProfile || (state.players || []).find(p => p.id === currentUser?.playerId);
      if (pl) return pl;
      return { offline: true };
    }
    if (url === '/api/catalog') return state.officerCatalog || [];
    if (url === '/api/event-types') return state.eventTypes || [];
    if (url === '/api/events') return state.events || [];
    if (url === '/api/players') return state.players || [];
    return { offline: true };
  }

  return { offline: true };
}

async function apiFetch(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const token = localStorage.getItem('kow_token');
  const headers = { ...(options.headers || {}) };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let bodyObj = options.body;
  if (typeof bodyObj === 'string') {
    try {
      bodyObj = JSON.parse(bodyObj);
    } catch (e) {}
  }

  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  // Intercept if offline
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return handleOfflineApiRequest(url, method, bodyObj);
  }

  let res;
  try {
    res = await fetch(url, { ...options, headers });
  } catch (netErr) {
    // Network failure (server unreachable or connection dropped)
    return handleOfflineApiRequest(url, method, bodyObj);
  }

  if (res.status === 401) {
    localStorage.removeItem('kow_token');
    localStorage.removeItem('kow_user');
    currentUser = null;
    renderTopbarProfile();
    renderSidebarNav();
    openAuthModal('login', 'Сессия истекла. Пожалуйста, войдите снова.');
    const err = new Error('UNAUTHORIZED');
    err.status = 401;
    throw err;
  }

  let data = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
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

async function flushOutboxQueue() {
  if (isFlushingOutbox) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  const token = localStorage.getItem('kow_token');
  if (!token) return;

  let queue = getOutboxQueue();
  if (!queue.length) {
    updateNetworkStatusUI();
    return;
  }

  isFlushingOutbox = true;
  updateNetworkStatusUI();

  const logicApi = getLogic();

  try {
    for (const item of [...queue]) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        break;
      }

      let res;
      try {
        const headers = {
          'Authorization': `Bearer ${token}`
        };
        let body = undefined;
        if (item.body !== undefined && item.body !== null) {
          headers['Content-Type'] = 'application/json';
          body = typeof item.body === 'string' ? item.body : JSON.stringify(item.body);
        }

        res = await fetch(item.endpoint, {
          method: item.method || 'POST',
          headers,
          body
        });
      } catch (netErr) {
        break;
      }

      if (res.status >= 200 && res.status < 300) {
        queue = typeof logicApi.filterOutboxQueue === 'function'
          ? logicApi.filterOutboxQueue(getOutboxQueue(), item.id)
          : getOutboxQueue().filter(q => q.id !== item.id);
        saveOutboxQueue(queue);
        updateNetworkStatusUI();
      } else if (res.status === 401) {
        toast('Сессия истекла во время синхронизации. Пожалуйста, выполните вход повторно.', 'warning');
        break;
      } else if (res.status >= 400 && res.status < 500) {
        let errMsg = `Ошибка ${res.status}`;
        try {
          const errData = await res.json();
          if (errData && (errData.message || errData.error)) {
            errMsg = errData.message || errData.error;
          }
        } catch (e) {
          try { errMsg = await res.text(); } catch (e2) {}
        }
        toast(`Не удалось применить оффлайн-изменение (${item.endpoint}): ${errMsg}`, 'error');
        queue = typeof logicApi.filterOutboxQueue === 'function'
          ? logicApi.filterOutboxQueue(getOutboxQueue(), item.id)
          : getOutboxQueue().filter(q => q.id !== item.id);
        saveOutboxQueue(queue);
        updateNetworkStatusUI();
      } else {
        break;
      }
    }
  } finally {
    isFlushingOutbox = false;
    updateNetworkStatusUI();
    if (getOutboxQueue().length === 0) {
      loadDataFromServer().catch(() => {});
    }
  }
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDateTime(s) {
  if (!s) return '—';
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return s;
  }
}

async function loadDataFromServer() {
  try {
    const [cat, et, evs, vTiers] = await Promise.all([
      apiFetch('/api/catalog').catch(() => null),
      apiFetch('/api/event-types').catch(() => null),
      apiFetch('/api/events').catch(() => null),
      apiFetch('/api/vip-tiers').catch(() => null)
    ]);
    if (Array.isArray(cat)) state.officerCatalog = cat;
    if (Array.isArray(et)) state.eventTypes = et;
    if (Array.isArray(evs)) state.events = evs;
    if (Array.isArray(vTiers)) state.vipTiers = vTiers;

    if (canManage()) {
      const pl = await apiFetch('/api/players').catch(() => null);
      if (Array.isArray(pl)) state.players = pl;
      await updatePendingCount();
    }
    if (currentUser) {
      const myPl = await apiFetch('/api/my-profile').catch(() => null);
      if (myPl) {
        if (Array.isArray(myPl.sectors)) {
          myCabinetSectors = myPl.sectors;
          myPl.sectors.forEach(s => {
            const idx = state.players.findIndex(p => p.id === s.id);
            if (idx >= 0) state.players[idx] = s;
            else state.players.push(s);
          });
        }
        if (myPl.id) {
          const existingIdx = state.players.findIndex(p => p.id === myPl.id);
          if (existingIdx >= 0) state.players[existingIdx] = myPl;
          else state.players.push(myPl);
        }
      }
    }
  } catch (err) {
    console.warn('Failed to sync data with server:', err);
  }
}

// ─── STORAGE ─────────────────────────────────────────────────
function save() {
  try { localStorage.setItem('kow_v2', JSON.stringify(state)); } catch(e) {}
}
function load() {
  try {
    const raw = localStorage.getItem('kow_v2');
    if (raw) state = migrateState(JSON.parse(raw));
  } catch(e) {}
  if (!state.players.length && !state.eventTypes.length) seedDemo();
  state = migrateState(state);
  save();
}

function seedDemo() {
  state.eventTypes = [
    {
      id: state.nextId++, name: 'Король Войны', color: '#8b5cf6',
      places: [
        { place: 1, label: '🥇 1 место',  coupons: 12500 },
        { place: 2, label: '🥈 2 место',  coupons: 6500  },
        { place: 3, label: '🥉 3 место',  coupons: 3500  },
        { place: 4, label: '4–10 место',  coupons: 2750  },
      ]
    },
    {
      id: state.nextId++, name: 'Мощные Силы', color: '#06b6d4',
      places: [
        { place: 1, label: '🥇 1 место',  coupons: 12500 },
        { place: 2, label: '🥈 2 место',  coupons: 6500  },
        { place: 3, label: '🥉 3 место',  coupons: 3500  },
        { place: 4, label: '4–10 место',  coupons: 2750  },
      ]
    },
  ];
  state.players = [
    { id: state.nextId++, name: 'Командор',    officers: [{ id:'o1', name:'Адмирал Нейтон', level:8,  coupons:750  }, { id:'o2', name:'Генерал Рекс',   level:2, coupons:0    }] },
    { id: state.nextId++, name: 'Морской Волк',officers: [{ id:'o3', name:'Капитан Блэк',   level:3,  coupons:2200 }] },
    { id: state.nextId++, name: 'Шторм',       officers: [{ id:'o4', name:'Адмирал Нейтон', level:22, coupons:1500 }] },
    { id: state.nextId++, name: 'Флотоводец',  officers: [{ id:'o5', name:'Генерал Рекс',   level:1,  coupons:500  }, { id:'o6', name:'Капитан Блэк', level:0, coupons:0 }] },
    { id: state.nextId++, name: 'Навигатор',   officers: [{ id:'o7', name:'Адмирал Нейтон', level:35, coupons:0   }] },
  ];
  const kwId = state.eventTypes[0].id, msId = state.eventTypes[1].id;
  state.events = [
    {
      id: state.nextId++, typeId: kwId, dateFrom: '2025-06-02', dateTo: '2025-06-08', note: '',
      assignments: [
        { place:1, playerId:3, officerId:'o4' },
        { place:2, playerId:1, officerId:'o1' },
        { place:3, playerId:2, officerId:'o3' },
        { place:4, playerId:5, officerId:'o7' },
      ]
    },
    {
      id: state.nextId++, typeId: msId, dateFrom: '2025-06-09', dateTo: '2025-06-15', note: '',
      assignments: [
        { place:1, playerId:5, officerId:'o7' },
        { place:2, playerId:3, officerId:'o4' },
        { place:3, playerId:4, officerId:'o5' },
      ]
    },
    {
      id: state.nextId++, typeId: kwId, dateFrom: '2025-06-23', dateTo: '2025-06-29', note: 'Предстоящий',
      assignments: [
        { place:1, playerId:5, officerId:'o7' },
        { place:2, playerId:3, officerId:'o4' },
        { place:3, playerId:2, officerId:'o3' },
      ]
    },
  ];
  state = migrateState(state);
  save();
}

// ─── MATH ────────────────────────────────────────────────────
function totalPuzzles(o) { return o.level * PUZZLES_PER_LEVEL + Math.floor(o.coupons / COUPON_PER_PUZZLE); }
function pct(v, m) { return Math.min(100, Math.round(v / Math.max(1,m) * 100)); }
function fmtNum(value, digits=0) {
  return (Number(value) || 0).toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/[\u00a0\u202f]/g, ' ');
}
function fmtOne(value) { return fmtNum(value, 1); }

function formatInputNumber(val, allowDecimals = false) {
  if (typeof logic !== 'undefined' && logic.formatInputNumber) {
    return logic.formatInputNumber(val, allowDecimals);
  }
  if (val === null || val === undefined || val === '') return '';
  const str = String(val).trim();
  if (str === '') return '';
  if (allowDecimals) {
    const hasComma = str.includes(',');
    const sep = hasComma ? ',' : (str.includes('.') ? '.' : '');
    const parts = str.split(/[,\.]/);
    let intPart = parts[0].replace(/\D/g, '');
    if (intPart === '' && (parts.length > 1 || sep)) intPart = '0';
    const formattedInt = intPart === '' ? '' : intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    if (parts.length > 1 || sep) {
      const decPart = parts.slice(1).join('').replace(/\D/g, '');
      const usedSep = hasComma ? ',' : '.';
      return formattedInt === '' ? `0${usedSep}${decPart}` : `${formattedInt}${usedSep}${decPart}`;
    }
    return formattedInt;
  } else {
    const cleaned = str.replace(/\D/g, '');
    if (cleaned === '') return '';
    return cleaned.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }
}

function parseInputNumber(str, allowDecimals = false) {
  if (typeof logic !== 'undefined' && logic.parseInputNumber) {
    return logic.parseInputNumber(str, allowDecimals);
  }
  if (typeof str === 'number') {
    if (isNaN(str)) return 0;
    return allowDecimals ? str : Math.round(str);
  }
  if (!str) return 0;
  const s = String(str).replace(/\s+/g, '').trim();
  if (!s) return 0;
  if (allowDecimals) {
    const normalized = s.replace(',', '.');
    const num = parseFloat(normalized);
    return isNaN(num) ? 0 : num;
  }
  const cleaned = s.replace(/\D/g, '');
  if (!cleaned) return 0;
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? 0 : num;
}

function bindNumericInput(inputEl, allowDecimals = false) {
  if (!inputEl || inputEl._numericBound) return;
  inputEl._numericBound = true;
  inputEl.addEventListener('input', () => {
    const oldVal = inputEl.value;
    const oldPos = inputEl.selectionStart || 0;
    const rawBeforeCaret = oldVal.slice(0, oldPos).replace(/\s/g, '').length;
    const formatted = formatInputNumber(oldVal, allowDecimals);
    inputEl.value = formatted;
    let newPos = 0;
    let counted = 0;
    while (newPos < formatted.length && counted < rawBeforeCaret) {
      if (formatted[newPos] !== ' ') counted++;
      newPos++;
    }
    inputEl.setSelectionRange(newPos, newPos);
  });
}

function bindAllNumericInputs(container = document) {
  if (!container) return;
  const numericInputs = container.querySelectorAll('input[inputmode="numeric"]');
  numericInputs.forEach(el => bindNumericInput(el, false));
  const decimalInputs = container.querySelectorAll('input[inputmode="decimal"]');
  decimalInputs.forEach(el => bindNumericInput(el, true));
}

function showUndoToast(msg, undoFn, type = 'success') {
  const container = document.getElementById('toasts');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type} toast-with-action`;
  const icon = { success: '✓', error: '✕', info: 'ℹ' }[type] || '✓';
  el.innerHTML = `
    <span>${icon}</span>
    <span style="flex:1">${msg}</span>
    <button type="button" class="toast-undo-btn" style="background:rgba(255,255,255,0.15);border:none;color:#fff;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;margin-left:8px">↩ Отменить</button>
  `;
  const btn = el.querySelector('.toast-undo-btn');
  btn.onclick = async (e) => {
    e.stopPropagation();
    el.remove();
    if (typeof undoFn === 'function') {
      try {
        await undoFn();
        toast('Действие отменено');
      } catch (err) {
        toast('Ошибка отмены: ' + err.message, 'error');
      }
    }
  };
  container.appendChild(el);
  setTimeout(() => {
    if (el.parentNode) el.remove();
  }, 6500);
}

function getPlayer(id) { return state.players.find(p => p.id === id); }
function getEventType(id) { return state.eventTypes.find(t => t.id === id); }
function getEvent(id) { return state.events.find(e => e.id === id); }
function getCatalogOfficer(id) { return state.officerCatalog.find(o => o.id === id); }
function officerLabel(officer) {
  const catalog = getCatalogOfficer(officer?.catalogId);
  return catalog?.name || officer?.name || '—';
}
function playerLink(player) {
  if (!player) return '—';
  if (state.currentRole === 'r3') return `<span>${escapeHtml(player.name)}</span>`;
  return `<button class="text-link" onclick="event.stopPropagation();navigate('player_detail',{id:${player.id}})">${escapeHtml(player.name)}</button>`;
}
function officerLink(officer) {
  const catalog = getCatalogOfficer(officer?.catalogId);
  if (!catalog) return officerLabel(officer);
  return `<button class="text-link" onclick="event.stopPropagation();navigate('officer_detail',{id:'${catalog.id}'})">${catalog.name}</button>`;
}
function catalogOfficerLink(officer) {
  return `<button class="text-link" onclick="event.stopPropagation();navigate('officer_detail',{id:'${officer.id}'})">${officer.name}</button>`;
}
function canManage() {
  const role = currentUser?.rank || state.currentRole;
  return role === 'r4' || role === 'r5';
}
function canSeeStock(playerId) {
  const myId = currentUser?.playerId ?? state.currentPlayerId;
  return canManage() || myId === playerId;
}
function placeInfo(eventType, place, eventDate=null) {
  if (!eventType) return null;
  const places = eventDate ? resolveEventPlaces(eventType, eventDate) : eventType.places;
  // places[last] covers everything from that place onward
  const found = places.find(p => p.place === place);
  if (found) return found;
  const last = [...places].sort((a,b) => a.place - b.place).findLast(p => p.place <= place);
  return last || places[places.length - 1];
}

function applyEvent(officer, couponAmount) {
  const catalog = getCatalogOfficer(officer.catalogId);
  if (Number(catalog?.couponPerPuzzle) === 0) return { level: officer.level, coupons: officer.coupons };
  const couponPerPuzzle = Number(catalog?.couponPerPuzzle) || COUPON_PER_PUZZLE;
  const newCoupons = officer.coupons + couponAmount;
  const totalPuz = officer.level * PUZZLES_PER_LEVEL + Math.floor(newCoupons / couponPerPuzzle);
  const newLevel = Math.min(Math.floor(totalPuz / PUZZLES_PER_LEVEL), MAX_LEVEL);
  const remainder = newCoupons % (couponPerPuzzle * PUZZLES_PER_LEVEL);
  return { level: newLevel, coupons: remainder };
}

// ─── UI HELPERS ──────────────────────────────────────────────
const TANK_ICON = `<svg class="badge-icon" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="display:inline-block;vertical-align:-2px"><rect x="14" y="8" width="8" height="2" rx="0.5"/><path d="M7 11h8V9a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v2z"/><path d="M4 14l1.5-3h13l1.5 3H4z"/><rect x="2" y="14" width="20" height="6" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="6" cy="17" r="1.3"/><circle cx="10" cy="17" r="1.3"/><circle cx="14" cy="17" r="1.3"/><circle cx="18" cy="17" r="1.3"/></svg>`;

function troopBadge(type) {
  const map = {
    'Пехота': { cls: 'badge-troop-infantry', icon: '🪖' },
    'Танк': { cls: 'badge-troop-tank', icon: TANK_ICON },
    'ПТ': { cls: 'badge-troop-td', icon: '🎯' },
    'ПТ-Сау': { cls: 'badge-troop-td', icon: '🎯' },
    'Гарнизон': { cls: 'badge-troop-garrison', icon: '🏰' },
    'Горнизон': { cls: 'badge-troop-garrison', icon: '🏰' },
    'Осада': { cls: 'badge-troop-siege', icon: '💥' },
  };
  const info = map[type];
  if (!info) return `<span class="badge badge-none">${type || '—'}</span>`;
  return `<span class="badge ${info.cls}">${info.icon} ${type}</span>`;
}

function evBadge(et) {
  if (!et) return `<span class="badge badge-none">—</span>`;
  return `<span class="badge" style="background:${et.color}22;color:${et.color};border:1px solid ${et.color}44">${et.name}</span>`;
}

function toast(msg, type='success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${{success:'✓',error:'✕',info:'ℹ'}[type]||'✓'}</span><span>${msg}</span>`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(()=>el.remove(), 3500);
}

function openModal(id) {
  document.getElementById('overlay')?.classList.add('open');
  document.getElementById(id)?.classList.add('open');
}
function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('open');
  const anyOpen = document.querySelector('.modal.open');
  if (!anyOpen) {
    document.getElementById('overlay')?.classList.remove('open');
  }
}
function closeAllModals() {
  if (!currentUser && document.getElementById('modal-auth')?.classList.contains('open')) {
    return;
  }
  document.getElementById('overlay')?.classList.remove('open');
  document.getElementById('sidebar')?.classList.remove('open');
  document.querySelectorAll('.modal.open').forEach(m=>m.classList.remove('open'));
}
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  sb.classList.toggle('open');
  document.getElementById('overlay').classList.toggle('open', sb.classList.contains('open'));
}
function setCurrentRole(role) {
  state.currentRole = role;
  if (currentUser) currentUser.rank = role;
  save();
  renderTopbarProfile();
  renderSidebarNav();
  navigate(currentPage, pageParams);
}

// ─── VIP DEFICIT HINT ────────────────────────────────────────
function updateVipProgressHint(isCabinet = false) {
  const vipInput = isCabinet
    ? (document.getElementById('my-sector-vip') || document.getElementById('fp-vip'))
    : document.getElementById('fp-vip');
  const ptsInput = isCabinet
    ? (document.getElementById('my-sector-vip-points') || document.getElementById('fp-vip-points'))
    : document.getElementById('fp-vip-points');
  const hintEl = isCabinet
    ? (document.getElementById('my-cabinet-vip-progress-hint') || document.getElementById('vip-progress-hint'))
    : document.getElementById('vip-progress-hint');

  if (!hintEl) return;

  const vip = Math.max(0, Math.min(30, parseInt(vipInput?.value) || 0));
  const pts = Math.max(0, parseInt(ptsInput?.value) || 0);

  if (vip >= 30) {
    hintEl.style.display = 'block';
    hintEl.innerHTML = `<span class="badge badge-success" style="font-size:11px">⭐ VIP 30 (Максимальный уровень)</span>`;
    return;
  }

  const defFn = (typeof logic !== 'undefined' && logic.calculateVipDeficit)
    ? logic.calculateVipDeficit
    : (typeof calculateVipDeficit === 'function' ? calculateVipDeficit : null);

  if (!defFn) return;

  const def = defFn({ currentLevel: vip, currentPoints: pts, targetLevel: vip + 1, vipTiers: state.vipTiers });
  hintEl.style.display = 'block';
  hintEl.innerHTML = `⭐ <strong>До VIP ${def.targetLevel}</strong> осталось <strong>${fmtNum(def.pointsNeeded)}</strong> очков (+${def.dailyPuzzlesIncrease} пазлов/день)`;
}

function updateCabinetVipProgressHint() {
  updateVipProgressHint(true);
}

// ─── AUTH & SESSION ──────────────────────────────────────────
async function checkAuthDemoHint() {
  const hint = document.getElementById('auth-demo-hint');
  if (!hint) return;
  try {
    const res = await apiFetch('/api/auth/status');
    hint.style.display = (res && res.demoAccessEnabled) ? 'block' : 'none';
  } catch (e) {
    hint.style.display = 'none';
  }
}

function openAuthModal(tab = 'login', alertMessage = null) {
  openModal('modal-auth');
  switchAuthTab(tab);
  checkAuthDemoHint();
  if (alertMessage) {
    showAuthAlert(alertMessage, 'info');
  } else {
    hideAuthAlert();
  }
  const closeBtn = document.getElementById('auth-modal-close');
  if (closeBtn) {
    closeBtn.style.display = currentUser ? 'block' : 'none';
  }
}

function switchAuthTab(tab) {
  const loginForm = document.getElementById('auth-form-login');
  const regForm = document.getElementById('auth-form-register');
  const loginBtn = document.getElementById('tab-btn-login');
  const regBtn = document.getElementById('tab-btn-register');

  hideAuthAlert();

  if (tab === 'register') {
    if (loginForm) loginForm.style.display = 'none';
    if (regForm) regForm.style.display = 'flex';
    loginBtn?.classList.remove('active');
    regBtn?.classList.add('active');
    setTimeout(() => document.getElementById('auth-reg-username')?.focus(), 50);
  } else {
    if (loginForm) loginForm.style.display = 'flex';
    if (regForm) regForm.style.display = 'none';
    loginBtn?.classList.add('active');
    regBtn?.classList.remove('active');
    setTimeout(() => document.getElementById('auth-login-username')?.focus(), 50);
  }
}

function showAuthAlert(msg, type = 'error') {
  const el = document.getElementById('auth-alert');
  if (!el) return;
  el.className = `auth-alert ${type}`;
  el.textContent = msg;
  el.style.display = 'block';
}

function hideAuthAlert() {
  const el = document.getElementById('auth-alert');
  if (!el) return;
  el.style.display = 'none';
  el.textContent = '';
}

async function handleLoginSubmit(e) {
  if (e) e.preventDefault();
  const username = document.getElementById('auth-login-username')?.value.trim();
  const password = document.getElementById('auth-login-password')?.value;
  const submitBtn = document.getElementById('auth-login-submit');

  if (!username || !password) {
    showAuthAlert('Введите логин и пароль', 'error');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Вход...';
  }
  hideAuthAlert();

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.status === 403 && data.error === 'PENDING_APPROVAL') {
      showAuthAlert('Заявка отправлена руководству гильдии (Р4/Р5). После одобрения вы сможете войти.', 'warning');
      return;
    }
    if (!res.ok) {
      showAuthAlert(data.message || data.error || 'Неверный логин или пароль', 'error');
      return;
    }

    localStorage.setItem('kow_token', data.token);
    currentUser = data.user;
    if (data.player) {
      currentUser.player = data.player;
      currentUser.playerName = data.player.name;
    }
    try {
      localStorage.setItem('kow_user', JSON.stringify(currentUser));
    } catch (e) {}
    state.currentRole = currentUser.rank;
    state.currentPlayerId = currentUser.playerId || null;
    toast(`Добро пожаловать, ${currentUser.playerName || currentUser.username}!`);
    closeAllModals();
    renderTopbarProfile();
    renderSidebarNav();
    await loadDataFromServer();
    flushOutboxQueue();
    if (currentUser.rank === 'r3') {
      navigate('my_cabinet');
    } else {
      navigate('calendar');
    }
  } catch (err) {
    showAuthAlert('Ошибка соединения с сервером', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Войти';
    }
  }
}

async function handleRegisterSubmit(e) {
  if (e) e.preventDefault();
  const username = document.getElementById('auth-reg-username')?.value.trim();
  const password = document.getElementById('auth-reg-password')?.value;
  const playerNameInput = document.getElementById('auth-reg-player-name');
  const submitBtn = document.getElementById('auth-reg-submit');

  if (!username || !password) {
    showAuthAlert('Заполните логин и пароль', 'error');
    return;
  }
  if (password.length < 4) {
    showAuthAlert('Пароль должен быть не менее 4 символов', 'error');
    return;
  }

  const playerName = playerNameInput?.value.trim() || '';

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Отправка...';
  }
  hideAuthAlert();

  try {
    const body = { username, password };
    if (playerName) body.playerName = playerName;

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.error === 'USERNAME_TAKEN') {
        showAuthAlert('Логин уже занят другим пользователем', 'error');
      } else {
        showAuthAlert(data.message || data.error || 'Ошибка при регистрации', 'error');
      }
      return;
    }

    if (data.pendingApproval) {
      switchAuthTab('login');
      showAuthAlert('Заявка отправлена руководству гильдии (Р4/Р5). После одобрения вы сможете войти.', 'success');
      const loginUserInput = document.getElementById('auth-login-username');
      const loginPassInput = document.getElementById('auth-login-password');
      if (loginUserInput) loginUserInput.value = username;
      if (loginPassInput) loginPassInput.value = '';
    } else {
      toast('Регистрация успешна! Первый пользователь назначен Главой (Р5).');
      const loginUserInput = document.getElementById('auth-login-username');
      const loginPassInput = document.getElementById('auth-login-password');
      if (loginUserInput) loginUserInput.value = username;
      if (loginPassInput) loginPassInput.value = password;
      await handleLoginSubmit();
    }
  } catch (err) {
    showAuthAlert('Ошибка соединения с сервером', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Зарегистрироваться';
    }
  }
}

async function logout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  } finally {
    localStorage.removeItem('kow_token');
    localStorage.removeItem('kow_user');
    currentUser = null;
    toast('Вы вышли из системы', 'info');
    renderTopbarProfile();
    renderSidebarNav();
    openAuthModal('login');
  }
}

function openChangePasswordModal() {
  document.getElementById('form-change-password')?.reset();
  const alertEl = document.getElementById('change-pass-alert');
  if (alertEl) {
    alertEl.style.display = 'none';
    alertEl.textContent = '';
  }
  openModal('modal-change-password');
  setTimeout(() => document.getElementById('change-old-password')?.focus(), 50);
}

async function submitChangePassword(e) {
  if (e) e.preventDefault();
  const oldPassword = document.getElementById('change-old-password')?.value || '';
  const newPassword = document.getElementById('change-new-password')?.value || '';
  const confirmPassword = document.getElementById('change-confirm-password')?.value || '';
  const alertEl = document.getElementById('change-pass-alert');

  if (!oldPassword || !newPassword) {
    if (alertEl) {
      alertEl.className = 'auth-alert error';
      alertEl.textContent = 'Заполните все обязательные поля';
      alertEl.style.display = 'block';
    }
    return;
  }

  if (newPassword.length < 4) {
    if (alertEl) {
      alertEl.className = 'auth-alert error';
      alertEl.textContent = 'Новый пароль должен содержать не менее 4 символов';
      alertEl.style.display = 'block';
    }
    return;
  }

  if (newPassword !== confirmPassword) {
    if (alertEl) {
      alertEl.className = 'auth-alert error';
      alertEl.textContent = 'Новый пароль и подтверждение не совпадают';
      alertEl.style.display = 'block';
    }
    return;
  }

  const saveBtn = document.getElementById('btn-save-new-password');
  if (saveBtn) saveBtn.disabled = true;

  try {
    await apiFetch('/api/auth/change-password', {
      method: 'POST',
      body: { oldPassword, newPassword }
    });

    toast('Пароль успешно изменен! Оповещение о демо-доступе отключено.', 'success');
    closeAllModals();

    if (currentUser) {
      currentUser.hasDefaultAdminPassword = false;
      try {
        localStorage.setItem('kow_user', JSON.stringify(currentUser));
      } catch (err) {}
    }

    const secAlert = document.getElementById('admin-security-alert');
    if (secAlert) secAlert.style.display = 'none';

    const hint = document.getElementById('auth-demo-hint');
    if (hint) hint.style.display = 'none';
  } catch (err) {
    if (alertEl) {
      alertEl.className = 'auth-alert error';
      alertEl.textContent = err.message || 'Ошибка смены пароля';
      alertEl.style.display = 'block';
    }
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function checkAuth() {
  const token = localStorage.getItem('kow_token');
  if (!token) {
    currentUser = null;
    renderTopbarProfile();
    renderSidebarNav();
    openAuthModal('login');
    return false;
  }

  // If already offline, restore session immediately from cache without failing
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const cachedUser = localStorage.getItem('kow_user');
    if (cachedUser) {
      try {
        currentUser = JSON.parse(cachedUser);
        state.currentRole = currentUser.rank;
        state.currentPlayerId = currentUser.playerId || null;
        renderTopbarProfile();
        renderSidebarNav();
        closeAllModals();
        toast('Вход выполнен в оффлайн-режиме', 'info');
        return true;
      } catch (e) {}
    }
    openAuthModal('login', 'Требуется подключение к сети для входа');
    return false;
  }

  try {
    const data = await apiFetch('/api/auth/me');
    if (data && data.user) {
      currentUser = data.user;
      if (data.player) {
        currentUser.player = data.player;
        currentUser.playerName = data.player.name;
      }
      try {
        localStorage.setItem('kow_user', JSON.stringify(currentUser));
      } catch (e) {}
      state.currentRole = currentUser.rank;
      state.currentPlayerId = currentUser.playerId || null;
      renderTopbarProfile();
      renderSidebarNav();
      await loadDataFromServer().catch(() => {});
      closeAllModals();
      return true;
    }

    // Response arrived without user (or offline fallback)
    const cachedUser = localStorage.getItem('kow_user');
    if (cachedUser) {
      try {
        currentUser = JSON.parse(cachedUser);
        state.currentRole = currentUser.rank;
        state.currentPlayerId = currentUser.playerId || null;
        renderTopbarProfile();
        renderSidebarNav();
        closeAllModals();
        toast('Вход выполнен в оффлайн-режиме', 'info');
        return true;
      } catch (e) {}
    }
    openAuthModal('login', 'Требуется подключение к сети для входа');
    return false;
  } catch (err) {
    if (err && err.status === 401) {
      localStorage.removeItem('kow_token');
      localStorage.removeItem('kow_user');
      currentUser = null;
      renderTopbarProfile();
      renderSidebarNav();
      openAuthModal('login', 'Сессия истекла. Пожалуйста, войдите снова.');
      return false;
    }

    // Network error or other non-401 failure: do NOT delete token, restore cached user
    const cachedUser = localStorage.getItem('kow_user');
    if (cachedUser) {
      try {
        currentUser = JSON.parse(cachedUser);
        state.currentRole = currentUser.rank;
        state.currentPlayerId = currentUser.playerId || null;
        renderTopbarProfile();
        renderSidebarNav();
        closeAllModals();
        toast('Вход выполнен в оффлайн-режиме', 'info');
        return true;
      } catch (e) {}
    }

    openAuthModal('login', 'Ошибка соединения с сервером');
    return false;
  }
}

// ─── PENDING REQUESTS & BADGES ───────────────────────────────
async function updatePendingCount() {
  if (!canManage()) {
    pendingRequestsCount = 0;
    renderPendingBadge();
    return 0;
  }
  try {
    const pendingList = await apiFetch('/api/users/pending');
    pendingRequestsCount = Array.isArray(pendingList) ? pendingList.length : 0;
  } catch (e) {
    pendingRequestsCount = 0;
  }
  renderPendingBadge();
  return pendingRequestsCount;
}

function pluralizeRequests(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 19) return 'заявок';
  if (mod10 === 1) return 'заявка';
  if (mod10 >= 2 && mod10 <= 4) return 'заявки';
  return 'заявок';
}

function renderPendingBadge() {
  const topbarBadge = document.getElementById('topbar-pending-badge');
  if (topbarBadge) {
    if (pendingRequestsCount > 0 && canManage()) {
      topbarBadge.style.display = 'inline-flex';
      topbarBadge.innerHTML = `<span class="badge-alert">🔔 ${pendingRequestsCount} <span class="badge-alert-label">${pluralizeRequests(pendingRequestsCount)}</span></span>`;
    } else {
      topbarBadge.style.display = 'none';
    }
  }

  const navItem = document.querySelector('.nav-item[data-page="pending_registrations"]');
  if (navItem) {
    let pill = navItem.querySelector('.nav-pill');
    if (pendingRequestsCount > 0 && canManage()) {
      if (pill) {
        pill.textContent = pendingRequestsCount;
      } else {
        pill = document.createElement('span');
        pill.className = 'nav-pill badge-alert';
        pill.textContent = pendingRequestsCount;
        navItem.appendChild(pill);
      }
    } else if (pill) {
      pill.remove();
    }
  }
}

function renderTopbarProfile() {
  const container = document.getElementById('topbar-profile');
  if (!container) return;

  if (!currentUser) {
    container.innerHTML = `
      <button class="btn-primary btn-sm" onclick="openAuthModal('login')">Войти</button>
    `;
    return;
  }

  const role = (currentUser.rank || 'r3').toUpperCase();
  const name = currentUser.playerName || (currentUser.player && currentUser.player.name) || currentUser.username || 'Пользователь';
  const showPending = canManage() && pendingRequestsCount > 0;

  container.innerHTML = `
    <button id="topbar-pending-badge" class="badge-alert-btn" style="display:${showPending ? 'inline-flex' : 'none'}" onclick="navigate('pending_registrations')" title="Ожидают одобрения">
      <span class="badge-alert">🔔 ${pendingRequestsCount} <span class="badge-alert-label">${pluralizeRequests(pendingRequestsCount)}</span></span>
    </button>
    <div class="user-profile-badge">
      <span class="badge badge-rank badge-rank-${currentUser.rank || 'r3'}">[${role}]</span>
      <span class="user-profile-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
    </div>
    <button class="btn-ghost btn-sm btn-logout" onclick="logout()" title="Выйти из аккаунта">
      🚪 <span class="btn-logout-text">Выйти</span>
    </button>
  `;
}

function renderSidebarNav() {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;

  const role = currentUser?.rank || state.currentRole || 'r3';
  let items = [];

  if (role === 'r3') {
    items = [
      { page: 'my_cabinet', label: 'Мой кабинет', icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>` },
      { page: 'calendar', label: 'Календарь ивентов', icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="8" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>` },
      { page: 'calculator', label: 'Персональный калькулятор', icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/></svg>` }
    ];
  } else {
    // R4 / R5
    items = [
      { page: 'my_cabinet', label: 'Мой кабинет', icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>` },
      { page: 'calendar', label: 'Календарь', icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>` },
      { page: 'players', label: 'Секторы', icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>` },
      { page: 'officers', label: 'Офицеры', icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l7 4v6c0 5-3 8-7 10-4-2-7-5-7-10V6l7-4z"/><path d="M9 12l2 2 4-5"/></svg>` },
      { page: 'event_types', label: 'Типы ивентов', icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>` },
      { page: 'calculator', label: 'Калькулятор и Аналитика', icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/></svg>` },
      { page: 'pending_registrations', label: 'Заявки на регистрацию', icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`, pill: pendingRequestsCount }
    ];
    if (role === 'r5') {
      items.push({
        page: 'users',
        label: 'Пользователи',
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`
      });
    }
  }

  nav.innerHTML = items.map(item => `
    <a href="#" class="nav-item ${currentPage === item.page ? 'active' : ''}" data-page="${item.page}">
      ${item.icon}
      <span>${item.label}</span>
      ${item.pill ? `<span class="nav-pill badge-alert">${item.pill}</span>` : ''}
    </a>
  `).join('');

  nav.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      navigate(el.dataset.page);
    });
  });

  const footer = document.querySelector('.sidebar-footer');
  if (footer) {
    if (role === 'r3') {
      footer.style.display = 'none';
    } else {
      footer.style.display = 'flex';
      const importBtn = document.getElementById('btn-import-json');
      if (importBtn) {
        importBtn.style.display = role === 'r5' ? 'flex' : 'none';
      }
    }
  }
}

// ─── PAGE: MY CABINET ─────────────────────────────────────────
async function renderMyCabinet() {
  const c = document.getElementById('content');
  if (!currentUser) {
    c.innerHTML = `
      <div class="section-header">
        <div class="section-title">👤 Мой кабинет</div>
      </div>
      <div class="sim-box">
        <div class="auth-alert info" style="display:block;margin-bottom:12px">
          Для доступа в личный кабинет войдите в свой аккаунт.
        </div>
        <button class="btn-primary" onclick="openAuthModal('login')">Войти в систему</button>
      </div>
    `;
    return;
  }

  c.innerHTML = `<div class="empty-state"><p>Загрузка данных личного кабинета...</p></div>`;

  let profile = null;
  try {
    profile = await apiFetch('/api/my-profile');
  } catch (err) {
    if (err.status === 404 || err.message === 'NO_LINKED_PLAYER') {
      myCabinetProfile = null;
      myCabinetSectors = [];
      c.innerHTML = `
        <div class="section-header">
          <div class="section-title">👤 Мой кабинет</div>
        </div>
        <div class="sim-box cabinet-empty-card">
          <div style="font-size:36px;margin-bottom:12px">🏰</div>
          <h3 style="margin-bottom:8px">У вас пока нет секторов</h3>
          <p style="color:var(--text2);font-size:13px;max-width:440px;margin-bottom:20px;text-align:center">
            Добавьте свою первую базу для отслеживания прокачки офицеров, запасов и участия в ивентах альянса!
          </p>
          <button type="button" class="btn-primary" onclick="openAddSectorModal()">+ Создать свой первый сектор</button>
        </div>
      `;
      return;
    }
    c.innerHTML = `<div class="empty-state"><p>Ошибка загрузки профиля: ${escapeHtml(err.message)}</p></div>`;
    return;
  }

  if (!profile || !profile.sectors || profile.sectors.length === 0) {
    myCabinetProfile = null;
    myCabinetSectors = [];
    c.innerHTML = `
      <div class="section-header">
        <div class="section-title">👤 Мой кабинет</div>
      </div>
      <div class="sim-box cabinet-empty-card">
        <div style="font-size:36px;margin-bottom:12px">🏰</div>
        <h3 style="margin-bottom:8px">У вас пока нет секторов</h3>
        <p style="color:var(--text2);font-size:13px;max-width:440px;margin-bottom:20px;text-align:center">
          Добавьте свою первую базу для отслеживания прокачки офицеров, запасов и участия в ивентах альянса!
        </p>
        <button type="button" class="btn-primary" onclick="openAddSectorModal()">+ Создать свой первый сектор</button>
      </div>
    `;
    return;
  }

  const activeSector = (typeof logic !== 'undefined' && logic.findActiveSector)
    ? logic.findActiveSector(profile.sectors, profile.activeSectorId)
    : (profile.sectors.find(s => Number(s.id) === Number(profile.activeSectorId)) || profile.sectors[0]);

  const profileSectors = profile.sectors;
  profile = { ...activeSector, sectors: profileSectors, activeSectorId: activeSector.id };
  myCabinetProfile = profile;
  myCabinetSectors = profileSectors;

  profileSectors.forEach(s => {
    const idx = state.players.findIndex(p => p.id === s.id);
    if (idx >= 0) state.players[idx] = s;
    else state.players.push(s);
  });

  const rewards = dailyRewards(profile.sector);
  const today = new Date().toISOString().slice(0, 10);
  const rankLabel = (profile.rank || currentUser.rank || 'r3').toUpperCase();
  const totalStarPoints = (typeof logic !== 'undefined' && logic.calculateTotalStarPoints)
    ? logic.calculateTotalStarPoints(profile.stock)
    : (((profile.stock?.legendaryStars1 || 0) * 110) + ((profile.stock?.legendaryStars2 || 0) * 420) + ((profile.stock?.legendaryStars3 || 0) * 960));

  c.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">
          👤 Личный кабинет: ${escapeHtml(profile.name)}
          ${profile.realName ? `<span style="color:var(--text3);font-size:13px"> · ${escapeHtml(profile.realName)}</span>` : ''}
          <span class="badge badge-rank badge-rank-${profile.rank || 'r3'}">[${rankLabel}]</span>
        </div>
        <div style="color:var(--text3);font-size:12px;margin-top:4px">
          VIP ${profile.sector.vipLevel} · Секретность ${profile.sector.confidentialityLevel} · Сила ${fmtNum(profile.sector.power)} · Киллы ${fmtNum(profile.sector.kills)} · Очки ${fmtOne(profile.sector.killPoints)}
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button type="button" class="btn btn-secondary btn-scanner" onclick="openSmartScannerModal('my_cabinet')">📷 Smart Scanner</button>
        <button type="button" class="btn-ghost btn-sm" onclick="openChangePasswordModal()">🔑 Сменить пароль</button>
        <button class="btn-ghost btn-sm" onclick="renderMyCabinet()">🔄 Обновить</button>
      </div>
    </div>

    ${(currentUser && currentUser.username === 'admin' && currentUser.hasDefaultAdminPassword) ? `
      <div class="security-alert-card" id="admin-security-alert">
        <div class="security-alert-icon">⚠️</div>
        <div class="security-alert-text">
          <strong>Внимание:</strong> Установлен стандартный пароль <code>admin123</code>.
          Пожалуйста, смените его для защиты альянса. После смены пароля подсказка о демо-доступе на странице входа будет скрыта.
        </div>
        <button type="button" class="btn-primary btn-sm" onclick="openChangePasswordModal()">Сменить пароль</button>
      </div>
    ` : ''}

    <!-- SECTORS BAR -->
    <div class="cabinet-sectors-bar">
      <div class="csb-left">
        <span class="csb-label">🏰 Активный сектор:</span>
        <select id="cabinet-sector-select" class="csb-select" onchange="switchCabinetSector(this.value)">
          ${profileSectors.map(s => {
            const title = (typeof logic !== 'undefined' && logic.formatSectorTitle)
              ? logic.formatSectorTitle(s)
              : `${s.name} (VIP ${s.sector?.vipLevel || 0})`;
            return `<option value="${s.id}" ${Number(s.id) === Number(activeSector.id) ? 'selected' : ''}>${escapeHtml(title)}</option>`;
          }).join('')}
        </select>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" onclick="openAddSectorModal()">+ Добавить сектор</button>
    </div>

    <!-- SECTOR & STOCK -->
    <div class="cabinet-grid">
      <!-- Sector Card -->
      <div class="cabinet-card">
        <div class="cabinet-card-title">
          <span>⚙️ Параметры сектора</span>
          <span class="badge badge-none">+${fmtNum(rewards.puzzlesPerDay, 2)} пазл/день</span>
        </div>
        <div class="form-row form-row-3">
          <div class="form-group">
            <label for="my-sector-vip">Уровень VIP (0-30)</label>
            <input type="number" id="my-sector-vip" min="0" max="30" value="${profile.sector.vipLevel}" oninput="updateCabinetVipProgressHint()">
          </div>
          <div class="form-group">
            <label for="my-sector-vip-points">Очки VIP</label>
            <input type="text" inputmode="numeric" pattern="[0-9 ]*" autocomplete="off" id="my-sector-vip-points" value="${formatInputNumber(profile.sector.vipPoints || 0)}" oninput="updateCabinetVipProgressHint()">
          </div>
          <div class="form-group">
            <label for="my-sector-conf">Конфиденциальность</label>
            <input type="number" id="my-sector-conf" min="0" value="${profile.sector.confidentialityLevel}">
          </div>
        </div>
        <div id="my-cabinet-vip-progress-hint" class="vip-progress-hint" style="margin-bottom:12px"></div>
        <div class="form-row form-row-3">
          <div class="form-group">
            <label for="my-sector-power">Мощь / Сила</label>
            <input type="text" inputmode="numeric" pattern="[0-9 ]*" autocomplete="off" id="my-sector-power" value="${formatInputNumber(profile.sector.power)}">
          </div>
          <div class="form-group">
            <label for="my-sector-kills">Убито</label>
            <input type="text" inputmode="numeric" pattern="[0-9 ]*" autocomplete="off" id="my-sector-kills" value="${formatInputNumber(profile.sector.kills)}">
          </div>
          <div class="form-group">
            <label for="my-sector-kill-points">Очки за убийство</label>
            <input type="text" inputmode="decimal" autocomplete="off" id="my-sector-kill-points" value="${formatInputNumber(profile.sector.killPoints, true)}">
          </div>
        </div>
        <div style="font-size:11.5px;color:var(--text3)">
          💡 Ежедневный доход: <strong>+${fmtNum(rewards.puzzlesPerDay, 2)}</strong> пазлов/день (VIP: ${profile.sector.vipLevel > 10 ? Math.min(20, Math.max(2, profile.sector.vipLevel - 9)) : 0}, Секретность: ${profile.sector.confidentialityLevel >= 25 ? '0.67' : profile.sector.confidentialityLevel > 24 ? '0.5' : '0'}) + 1 сундук/день.
        </div>
        <div>
          <button type="button" class="btn-primary btn-sm" onclick="saveMySector()">💾 Сохранить параметры сектора</button>
        </div>
      </div>

      <!-- Stock Card -->
      <div class="cabinet-card">
        <div class="cabinet-card-title">
          <span>📦 Запасы гильдейца</span>
          <span style="font-size:12px;color:var(--text3);font-weight:normal">💡 Кликните на плашку для быстрого изменения</span>
        </div>
        <div class="stock-grid stock-grid-3x2" id="cabinet-stock-grid-wrap" style="margin-bottom:0">
          ${renderCabinetStockGridHtml(profile, totalStarPoints)}
        </div>
      </div>
    </div>

    <!-- OFFICERS LIST -->
    <div class="section-header" style="margin-top:20px">
      <div class="section-title">🎖️ Мои офицеры (${profile.officers.length})</div>
      <button class="btn-primary btn-sm" onclick="openAddMyOfficerModal()">+ Добавить офицера</button>
    </div>

    ${profile.officers.length ? `
      <div class="cabinet-officers-grid" id="cabinet-officers-grid">
        ${profile.officers.map(o => renderCabinetOfficerCardHtml(o, profile, today)).join('')}
      </div>
    ` : `
      <div class="empty-state" style="padding:24px;background:var(--bg2);border:1px dashed var(--border);border-radius:var(--radius);margin-bottom:24px">
        <p>У вас пока нет офицеров в профиле. Нажмите «+ Добавить офицера», чтобы добавить первого офицера!</p>
      </div>
    `}

    <!-- PERSONAL LEVELING SIMULATOR -->
    <div class="section-header" style="margin-top:28px">
      <div class="section-title">🚀 Персональный симулятор прокачки до 180 уровня</div>
    </div>
    <div id="cabinet-sim-container">
      ${renderCabinetSimulatorHtml()}
    </div>
  `;
  bindAllNumericInputs(c);
  updateCabinetVipProgressHint();
}

function renderCabinetSimulatorHtml() {
  if (!myCabinetProfile || !myCabinetProfile.officers || !myCabinetProfile.officers.length) {
    return `<div class="empty-state" style="padding:24px"><p>Добавьте офицера в кабинет, чтобы рассчитать прокачку.</p></div>`;
  }

  let selectedOfficer = myCabinetProfile.officers.find(o => o.id === myCabinetSim.officerId);
  if (!selectedOfficer) {
    selectedOfficer = myCabinetProfile.officers[0];
    myCabinetSim.officerId = selectedOfficer.id;
  }

  const cat = getCatalogOfficer(selectedOfficer.catalogId) || { couponPerPuzzle: 500, generation: 7, type: 'Пехота' };
  const rawCost = Number(cat?.couponPerPuzzle);
  const costPerPuzzle = rawCost === 0
    ? (cat?.upgradeType === 'special' ? 0 : 500)
    : (rawCost || (cat?.generation === 7 ? 600 : (cat?.generation >= 8 ? 720 : 500)));
  const targetLevel = Math.max(1, Math.min(180, myCabinetSim.targetLevel || 180));
  const today = new Date().toISOString().slice(0, 10);

  const def = calculateOfficerDeficit({
    officer: selectedOfficer,
    catalogItem: { ...cat, couponPerPuzzle: costPerPuzzle },
    player: myCabinetProfile,
    targetLevel,
    today
  });

  const stockMedals = Math.max(0, Number(myCabinetProfile.stock?.puzzles) || 0);
  const stockCoupons = Math.max(0, Number(myCabinetProfile.stock?.coupons) || 0);
  const stockPuzzlesFromCoupons = costPerPuzzle > 0 ? Math.floor(stockCoupons / costPerPuzzle) : 0;
  const totalStockPuzzlesForOfficer = stockMedals + stockPuzzlesFromCoupons;

  const et = state.eventTypes[0];
  const resolvedPlaces = et ? resolveEventPlaces(et, today) : [];
  const top1Coupons = resolvedPlaces.find(p => p.place === 1)?.coupons || 12500;
  const top2Coupons = resolvedPlaces.find(p => p.place === 2)?.coupons || 6500;
  const top3Coupons = resolvedPlaces.find(p => p.place === 3)?.coupons || 3500;
  const top4Coupons = resolvedPlaces.find(p => p.place >= 4)?.coupons || 2750;

  const top1PuzStr = costPerPuzzle > 0 ? ` (+${fmtNum(Math.floor(top1Coupons / costPerPuzzle))} пазл.)` : ' (только купоны на склад)';
  const top2PuzStr = costPerPuzzle > 0 ? ` (+${fmtNum(Math.floor(top2Coupons / costPerPuzzle))} пазл.)` : ' (только купоны на склад)';
  const top3PuzStr = costPerPuzzle > 0 ? ` (+${fmtNum(Math.floor(top3Coupons / costPerPuzzle))} пазл.)` : ' (только купоны на склад)';
  const top4PuzStr = costPerPuzzle > 0 ? ` (+${fmtNum(Math.floor(top4Coupons / costPerPuzzle))} пазл.)` : ' (только купоны на склад)';

  const sim = simulateEventProgress({
    deficitPuzzles: def.deficitPuzzles,
    costPerPuzzle,
    dailyIncome: def.dailyIncome,
    plannedEvents: [
      { coupons: top1Coupons, count: myCabinetSim.planned.top1 },
      { coupons: top2Coupons, count: myCabinetSim.planned.top2 },
      { coupons: top3Coupons, count: myCabinetSim.planned.top3 },
      { coupons: top4Coupons, count: myCabinetSim.planned.top4 },
    ],
    today
  });

  const targetPuz = targetLevel * PUZZLES_PER_LEVEL;
  const currentPuzTotal = def.currentPuzzles + def.stockPuzzles;
  const progressPct = Math.min(100, Math.round((currentPuzTotal / Math.max(1, targetPuz)) * 100));
  const effectivePuzzles = Math.min(targetPuz, currentPuzTotal + sim.puzzlesFromEvents);
  const simProgressPct = Math.min(100, Math.round((effectivePuzzles / Math.max(1, targetPuz)) * 100));

  return `
    <div class="sim-box">
      <div class="form-row" style="margin-bottom:16px">
        <div class="form-group">
          <label>Офицер для расчета</label>
          <select onchange="onCabinetSimOfficerChange(this.value)">
            ${myCabinetProfile.officers.map(o => `<option value="${o.id}" ${o.id===selectedOfficer.id?'selected':''}>${escapeHtml(officerLabel(o))} (ур. ${o.level})</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Целевой уровень прокачки</label>
          <div style="display:flex;gap:6px;align-items:center">
            <input type="number" min="1" max="180" value="${targetLevel}" onchange="setCabinetSimTargetLevel(this.value)" style="width:80px">
            <button type="button" class="btn-ghost btn-sm ${targetLevel===60?'btn-primary':''}" onclick="setCabinetSimTargetLevel(60)">60</button>
            <button type="button" class="btn-ghost btn-sm ${targetLevel===120?'btn-primary':''}" onclick="setCabinetSimTargetLevel(120)">120</button>
            <button type="button" class="btn-ghost btn-sm ${targetLevel===180?'btn-primary':''}" onclick="setCabinetSimTargetLevel(180)">180</button>
          </div>
        </div>
      </div>

      <div class="stock-grid" style="margin-bottom:16px">
        <div class="stock-card">
          <div class="label">Текущий прогресс</div>
          <div class="value" style="display:flex;align-items:center;gap:8px">
            <span>Ур. ${fmtNum(selectedOfficer.level)} <span style="font-size:12px;color:var(--text3)">/ ${targetLevel}</span></span>
            ${troopBadge(cat.type)}
          </div>
          <div style="margin-top:4px">${renderStars(selectedOfficer.stars)}</div>
          <div style="font-size:11px;color:${def.starRequirement.isStarReady?'var(--green)':'var(--amber)'};margin-top:4px">
            ${def.starRequirement.isStarReady ? '★ Готов к максимальной подготовке' : '☆ Для 180 уровня требуется 6★'}
          </div>
        </div>
        <div class="stock-card">
          <div class="label">Оставшийся дефицит</div>
          <div class="value">${fmtNum(sim.remainingDeficitPuzzles)} <span style="font-size:12px;color:var(--text3)">пазлов</span></div>
          <div style="font-size:12px;color:var(--text2);margin-top:4px">
            ${costPerPuzzle > 0 ? `${fmtNum(sim.remainingDeficitCoupons)} купонов` : 'Только пазлы'}
          </div>
        </div>
        <div class="stock-card">
          <div class="label">Ежедневный доход сектора</div>
          <div class="value">+${fmtNum(def.dailyIncome, 2)} <span style="font-size:12px;color:var(--text3)">пазл/день</span></div>
          <div style="font-size:11px;color:var(--text3);margin-top:4px">VIP ${myCabinetProfile.sector.vipLevel} · Конф. ${myCabinetProfile.sector.confidentialityLevel} · 1 сундук/день</div>
        </div>
      </div>

      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
          <span style="color:var(--text2)">Прогресс до цели (Ур. ${targetLevel}):</span>
          <strong>${simProgressPct}% (${fmtNum(effectivePuzzles)} / ${fmtNum(targetPuz)} пазлов)</strong>
        </div>
        <div class="progress-container">
          <div class="progress-fill green" style="width:${simProgressPct}%"></div>
        </div>
        <div class="sim-stock-surplus-note">
          📦 Доступно на складе для Ген. ${cat.generation || '?'}: <strong>${fmtNum(totalStockPuzzlesForOfficer)} пазл.</strong>
          ${sim.remainingDeficitPuzzles === 0
            ? `<span class="text-muted">(избыток +${fmtNum(totalStockPuzzlesForOfficer)} пазл. сверх цели)</span>`
            : `<span class="text-muted">(покрывает ${fmtNum(Math.min(Math.max(0, targetPuz - def.currentPuzzles), totalStockPuzzlesForOfficer))} пазл. дефицита)</span>`
          }
          <span class="sim-stock-detail-hint" title="Медали: ${fmtNum(stockMedals)} шт. + Купоны: ${fmtNum(stockCoupons)} шт. (по курсу ${costPerPuzzle > 0 ? `${costPerPuzzle} куп./пазл` : 'только медали'})">ℹ️</span>
        </div>
      </div>

      <div style="font-size:13px;font-weight:600;margin:16px 0 8px">Планируемые призовые места в ивентах:</div>
      <div class="sim-counter-grid">
        <div class="sim-counter-card">
          <div class="sim-counter-info">
            <span class="sim-counter-title">🥇 1 место</span>
            <span class="sim-counter-desc">${fmtNum(top1Coupons)} купонов${top1PuzStr}</span>
          </div>
          <div class="sim-counter-ctrl">
            <button type="button" class="sim-step-btn" onclick="adjustCabinetSimEvent('top1', -1)">−</button>
            <span class="sim-counter-val">${myCabinetSim.planned.top1}</span>
            <button type="button" class="sim-step-btn" onclick="adjustCabinetSimEvent('top1', 1)">+</button>
          </div>
        </div>
        <div class="sim-counter-card">
          <div class="sim-counter-info">
            <span class="sim-counter-title">🥈 2 место</span>
            <span class="sim-counter-desc">${fmtNum(top2Coupons)} купонов${top2PuzStr}</span>
          </div>
          <div class="sim-counter-ctrl">
            <button type="button" class="sim-step-btn" onclick="adjustCabinetSimEvent('top2', -1)">−</button>
            <span class="sim-counter-val">${myCabinetSim.planned.top2}</span>
            <button type="button" class="sim-step-btn" onclick="adjustCabinetSimEvent('top2', 1)">+</button>
          </div>
        </div>
        <div class="sim-counter-card">
          <div class="sim-counter-info">
            <span class="sim-counter-title">🥉 3 место</span>
            <span class="sim-counter-desc">${fmtNum(top3Coupons)} купонов${top3PuzStr}</span>
          </div>
          <div class="sim-counter-ctrl">
            <button type="button" class="sim-step-btn" onclick="adjustCabinetSimEvent('top3', -1)">−</button>
            <span class="sim-counter-val">${myCabinetSim.planned.top3}</span>
            <button type="button" class="sim-step-btn" onclick="adjustCabinetSimEvent('top3', 1)">+</button>
          </div>
        </div>
        <div class="sim-counter-card">
          <div class="sim-counter-info">
            <span class="sim-counter-title">🎖️ 4–10 место</span>
            <span class="sim-counter-desc">${fmtNum(top4Coupons)} купонов${top4PuzStr}</span>
          </div>
          <div class="sim-counter-ctrl">
            <button type="button" class="sim-step-btn" onclick="adjustCabinetSimEvent('top4', -1)">−</button>
            <span class="sim-counter-val">${myCabinetSim.planned.top4}</span>
            <button type="button" class="sim-step-btn" onclick="adjustCabinetSimEvent('top4', 1)">+</button>
          </div>
        </div>
      </div>

      <div class="sim-result-banner">
        <div>
          <div class="sim-result-title">
            Прогноз достижения: <strong>${sim.simulatedDate ? formatDate(sim.simulatedDate) : 'Не достижимо'}</strong>
            ${sim.simulatedDays !== null ? `<span style="font-size:12px;color:var(--text3)"> (${fmtNum(sim.simulatedDays)} дн.)</span>` : ''}
          </div>
          <div style="font-size:12px;color:var(--text2);margin-top:4px">
            Без ивентов: ${def.dateWithoutEvents ? `${formatDate(def.dateWithoutEvents)} (${fmtNum(def.daysWithoutEvents)} дн.)` : '—'}
            ${sim.puzzlesFromEvents > 0 ? `· Награды с ивентов: +${fmtNum(sim.puzzlesFromEvents)} пазлов` : ''}
          </div>
        </div>
        ${sim.savedDays > 0 ? `<div class="sim-result-badge">⚡ Экономия: ${fmtNum(sim.savedDays)} дней!</div>` : ''}
      </div>
    </div>
  `;
}

function renderCabinetOfficerSkills(o) {
  const skills = Array.isArray(o.skills) && o.skills.length === 4 ? o.skills : [1, 1, 1, 1];
  const cat = getCatalogOfficer(o.catalogId);
  const maxMedals = (cat && (cat.medalsBeforeTraining || cat.medals_before_training)) || 690;
  const medalsFn = (typeof logic !== 'undefined' && logic.calculateSkillMedalsProgress)
    ? logic.calculateSkillMedalsProgress
    : (typeof calculateSkillMedalsProgress === 'function' ? calculateSkillMedalsProgress : null);
  const progress = medalsFn ? medalsFn(skills, maxMedals) : { spentMedals: 0, totalMedals: maxMedals, remainingMedals: maxMedals, isMaxSkills: false };

  return `
    <div class="skill-level-group">
      <div style="display:flex;justify-content:space-between;align-items:center;width:100%;margin-bottom:2px">
        <span class="skill-group-title">Навыки 5-5-5-5:</span>
        <div class="skill-progress-badge ${progress.isMaxSkills ? 'max-skills' : ''}">
          <span>Медали: <strong>${progress.spentMedals}</strong> / ${progress.totalMedals}</span>
          ${progress.isMaxSkills ? '<span class="badge badge-success" style="font-size:10px">MAX</span>' : `<span class="skill-remaining">(-${progress.remainingMedals})</span>`}
        </div>
      </div>
      <div class="skill-selectors" style="width:100%">
        ${[0, 1, 2, 3].map(sIdx => `
          <div class="skill-selector" title="Навык ${sIdx + 1}: уровень ${skills[sIdx]}/5">
            <span class="skill-idx-badge">Н${sIdx + 1}</span>
            <div class="skill-btn-group">
              ${[1, 2, 3, 4, 5].map(lvl => `
                <button type="button" class="skill-btn ${skills[sIdx] === lvl ? 'active' : ''}" onclick="setMyOfficerSkill('${o.id}', ${sIdx}, ${lvl})">${lvl}</button>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

async function setMyOfficerSkill(officerId, skillIndex, level) {
  const off = myCabinetProfile?.officers?.find(x => String(x.id) === String(officerId));
  if (!off) return;
  const currentSkills = Array.isArray(off.skills) && off.skills.length === 4 ? [...off.skills] : [1, 1, 1, 1];
  const oldLevel = currentSkills[skillIndex];
  const newLevel = Math.max(1, Math.min(5, Number(level) || 1));
  if (oldLevel === newLevel) return;

  const newSkills = [...currentSkills];
  newSkills[skillIndex] = newLevel;

  let stockDelta = null;
  let newStock = null;

  if (myCabinetProfile?.stock) {
    const cat = getCatalogOfficer(off.catalogId);
    const rawCost = Number(cat?.couponPerPuzzle);
    const costPerPuzzle = rawCost === 0 ? (cat?.upgradeType === 'special' ? 0 : 500) : (rawCost || (cat?.generation === 7 ? 600 : (cat?.generation >= 8 ? 720 : 500)));
    const upgradeType = cat?.upgradeType || 'standard';
    const maxMedals = (cat && (cat.medalsBeforeTraining || cat.medals_before_training)) || 690;

    const deltaFn = (typeof logic !== 'undefined' && logic.calculateSkillStockDelta) ? logic.calculateSkillStockDelta : calculateSkillStockDelta;
    stockDelta = deltaFn(currentSkills, newSkills, myCabinetProfile.stock, costPerPuzzle, upgradeType, maxMedals);

    if (!stockDelta.canAfford) {
      toast(`❌ Недостаточно ресурсов на складе для улучшения навыка (не хватает ${fmtNum(stockDelta.deficitMedals || 0)} медалей). Повышение отменено.`, 'error');
      return;
    }

    newStock = {
      ...myCabinetProfile.stock,
      coupons: Math.max(0, (myCabinetProfile.stock.coupons || 0) + stockDelta.delta.coupons),
      puzzles: Math.max(0, (myCabinetProfile.stock.puzzles || 0) + stockDelta.delta.puzzles),
    };
  }

  try {
    await apiFetch(`/api/my-profile/officers/${officerId}`, {
      method: 'PUT',
      body: { skills: newSkills }
    });
    if (newStock) {
      await apiFetch('/api/my-profile', {
        method: 'PUT',
        body: { stock: newStock }
      });
      myCabinetProfile.stock = newStock;
    }

    off.skills = newSkills;
    if (state.players) {
      for (const p of state.players) {
        if (p.officers) {
          const o = p.officers.find(x => String(x.id) === String(officerId));
          if (o) o.skills = newSkills;
        }
        if (p.id === myCabinetProfile.id && newStock) {
          p.stock = newStock;
        }
      }
    }

    const cardEl = document.getElementById(`cabinet-officer-card-${officerId}`);
    if (cardEl && myCabinetProfile) {
      const today = new Date().toISOString().slice(0, 10);
      cardEl.outerHTML = renderCabinetOfficerCardHtml(off, myCabinetProfile, today);
    } else {
      await renderMyCabinet();
    }
    const simEl = document.getElementById('cabinet-sim-container');
    if (simEl && typeof renderCabinetSimulatorHtml === 'function') {
      simEl.innerHTML = renderCabinetSimulatorHtml();
    }
    const stockGridWrap = document.getElementById('cabinet-stock-grid-wrap');
    if (stockGridWrap && myCabinetProfile) {
      stockGridWrap.innerHTML = renderCabinetStockGridHtml(myCabinetProfile);
    }

    const actionText = stockDelta && stockDelta.delta.coupons < 0
      ? ` Списано: ${fmtNum(Math.abs(stockDelta.delta.coupons))} куп.`
      : (stockDelta && stockDelta.delta.puzzles < 0 ? ` Списано: ${fmtNum(Math.abs(stockDelta.delta.puzzles))} медалей` : '');

    showUndoToast(`Навык ${skillIndex + 1} обновлен: ${newSkills[skillIndex]}/5.${actionText}`, async () => {
      await setMyOfficerSkill(officerId, skillIndex, oldLevel);
    });
  } catch (err) {
    toast('Ошибка обновления навыка: ' + err.message, 'error');
  }
}

async function saveMySector() {
  const vipLevel = Math.max(0, parseInt(document.getElementById('my-sector-vip').value) || 0);
  const vipPoints = Math.max(0, parseInputNumber(document.getElementById('my-sector-vip-points')?.value));
  const confidentialityLevel = Math.max(0, parseInt(document.getElementById('my-sector-conf').value) || 0);
  const power = Math.max(0, parseInputNumber(document.getElementById('my-sector-power').value));
  const kills = Math.max(0, parseInputNumber(document.getElementById('my-sector-kills').value));
  const killPoints = Math.max(0, parseInputNumber(document.getElementById('my-sector-kill-points').value, true));

  try {
    await apiFetch('/api/my-profile', {
      method: 'PUT',
      body: {
        sector: { vipLevel, vipPoints, confidentialityLevel, power, kills, killPoints }
      }
    });
    toast('Параметры сектора успешно сохранены');
    await renderMyCabinet();
  } catch (err) {
    toast('Ошибка сохранения сектора: ' + err.message, 'error');
  }
}

function updateCabinetTotalStarPoints() {
  const el = document.getElementById('total-star-points-badge');
  if (!el) return;
  const s1 = parseInputNumber(document.getElementById('my-stock-legendary-stars-1')?.value);
  const s2 = parseInputNumber(document.getElementById('my-stock-legendary-stars-2')?.value);
  const s3 = parseInputNumber(document.getElementById('my-stock-legendary-stars-3')?.value);
  const calcFn = (typeof logic !== 'undefined' && logic.calculateTotalStarPoints) ? logic.calculateTotalStarPoints : null;
  const total = calcFn ? calcFn({ legendaryStars1: s1, legendaryStars2: s2, legendaryStars3: s3 }) : ((s1 * 110) + (s2 * 420) + (s3 * 960));
  el.textContent = `✨ Итого очков звезд: ${fmtNum(total)}`;
}

async function saveMyCabinetProfile() {
  if (!myCabinetProfile) return;
  const vipLevel = Math.max(0, parseInt(document.getElementById('my-sector-vip')?.value) || myCabinetProfile.sector?.vipLevel || 0);
  const vipPoints = Math.max(0, parseInputNumber(document.getElementById('my-sector-vip-points')?.value || document.getElementById('fp-vip-points')?.value) || myCabinetProfile.sector?.vipPoints || 0);
  const confidentialityLevel = Math.max(0, parseInt(document.getElementById('my-sector-conf')?.value) || myCabinetProfile.sector?.confidentialityLevel || 0);
  const power = Math.max(0, parseInputNumber(document.getElementById('my-sector-power')?.value) || myCabinetProfile.sector?.power || 0);
  const kills = Math.max(0, parseInputNumber(document.getElementById('my-sector-kills')?.value) || myCabinetProfile.sector?.kills || 0);
  const killPoints = Math.max(0, parseInputNumber(document.getElementById('my-sector-kill-points')?.value, true) || myCabinetProfile.sector?.killPoints || 0);

  const coupons = Math.max(0, parseInputNumber(document.getElementById('my-stock-coupons')?.value) || myCabinetProfile.stock?.coupons || 0);
  const puzzles = Math.max(0, parseInputNumber(document.getElementById('my-stock-puzzles')?.value) || myCabinetProfile.stock?.puzzles || 0);
  const starCoupons = Math.max(0, parseInputNumber(document.getElementById('my-stock-star-coupons')?.value) || myCabinetProfile.stock?.starCoupons || 0);
  const legendaryStars1 = Math.max(0, parseInputNumber(document.getElementById('my-stock-legendary-stars-1')?.value) || myCabinetProfile.stock?.legendaryStars1 || 0);
  const legendaryStars2 = Math.max(0, parseInputNumber(document.getElementById('my-stock-legendary-stars-2')?.value) || myCabinetProfile.stock?.legendaryStars2 || 0);
  const legendaryStars3 = Math.max(0, parseInputNumber(document.getElementById('my-stock-legendary-stars-3')?.value) || myCabinetProfile.stock?.legendaryStars3 || 0);
  const chests = Math.max(0, parseInputNumber(document.getElementById('my-stock-chests')?.value) || myCabinetProfile.stock?.chests || 0);

  try {
    const res = await apiFetch('/api/my-profile', {
      method: 'PUT',
      body: {
        sector: { vipLevel, vipPoints, confidentialityLevel, power, kills, killPoints },
        stock: { coupons, puzzles, starCoupons, legendaryStars1, legendaryStars2, legendaryStars3, chests }
      }
    });
    toast('Профиль успешно сохранен');
    await renderMyCabinet();
    return res;
  } catch (err) {
    toast('Ошибка сохранения профиля: ' + err.message, 'error');
    throw err;
  }
}

let cabinetInlineEditingKey = null;

function renderCabinetStockGridHtml(profile, totalStarPoints) {
  const st = profile.stock || {};
  const starPts = totalStarPoints !== undefined ? totalStarPoints : ((typeof logic !== 'undefined' && logic.calculateTotalStarPoints) ? logic.calculateTotalStarPoints(st) : 0);

  const cards = [];

  // 1. Coupons
  if (cabinetInlineEditingKey === 'coupons') {
    cards.push(`
      <div class="stock-card stock-card-editing" id="card-cabinet-coupons" onclick="event.stopPropagation()">
        <div class="label">🎟️ Купон офицера</div>
        <div class="stock-inline-edit-wrap">
          <input type="text" inputmode="numeric" pattern="[0-9 ]*" autocomplete="off" class="stock-inline-input" id="input-cabinet-coupons" value="${formatInputNumber(st.coupons || 0)}" onkeydown="handleCabinetInlineKey(event, 'coupons')">
          <div class="stock-inline-actions">
            <button type="button" class="btn-primary btn-xs" onclick="saveCabinetInline('coupons')" title="Сохранить (Enter)">✓</button>
            <button type="button" class="btn-ghost btn-xs" onclick="closeCabinetInline()" title="Отмена (Esc)">✕</button>
          </div>
        </div>
      </div>
    `);
  } else {
    cards.push(`
      <div class="stock-card stock-card-clickable" id="card-cabinet-coupons" onclick="openCabinetInline('coupons')" title="Нажмите, чтобы изменить количество купонов">
        <span class="stock-card-edit-hint">✏️</span>
        <div class="label">🎟️ Купон офицера</div>
        <div class="value" style="font-size:17px">${fmtNum(st.coupons)}</div>
      </div>
    `);
  }

  // 2. Puzzles
  if (cabinetInlineEditingKey === 'puzzles') {
    cards.push(`
      <div class="stock-card stock-card-editing" id="card-cabinet-puzzles" onclick="event.stopPropagation()">
        <div class="label">🧩 Медаль офицера</div>
        <div class="stock-inline-edit-wrap">
          <input type="text" inputmode="numeric" pattern="[0-9 ]*" autocomplete="off" class="stock-inline-input" id="input-cabinet-puzzles" value="${formatInputNumber(st.puzzles || 0)}" onkeydown="handleCabinetInlineKey(event, 'puzzles')">
          <div class="stock-inline-actions">
            <button type="button" class="btn-primary btn-xs" onclick="saveCabinetInline('puzzles')" title="Сохранить (Enter)">✓</button>
            <button type="button" class="btn-ghost btn-xs" onclick="closeCabinetInline()" title="Отмена (Esc)">✕</button>
          </div>
        </div>
      </div>
    `);
  } else {
    cards.push(`
      <div class="stock-card stock-card-clickable" id="card-cabinet-puzzles" onclick="openCabinetInline('puzzles')" title="Нажмите, чтобы изменить количество медалей">
        <span class="stock-card-edit-hint">✏️</span>
        <div class="label">🧩 Медаль офицера</div>
        <div class="value" style="font-size:17px">${fmtNum(st.puzzles)}</div>
      </div>
    `);
  }

  // 3. Chests (Moved before stars)
  if (cabinetInlineEditingKey === 'chests') {
    cards.push(`
      <div class="stock-card stock-card-editing" id="card-cabinet-chests" onclick="event.stopPropagation()">
        <div class="label">📦 Сундук выбора</div>
        <div class="stock-inline-edit-wrap">
          <input type="text" inputmode="numeric" pattern="[0-9 ]*" autocomplete="off" class="stock-inline-input" id="input-cabinet-chests" value="${formatInputNumber(st.chests || 0)}" onkeydown="handleCabinetInlineKey(event, 'chests')">
          <div class="stock-inline-actions">
            <button type="button" class="btn-primary btn-xs" onclick="saveCabinetInline('chests')" title="Сохранить (Enter)">✓</button>
            <button type="button" class="btn-ghost btn-xs" onclick="closeCabinetInline()" title="Отмена (Esc)">✕</button>
          </div>
        </div>
      </div>
    `);
  } else {
    cards.push(`
      <div class="stock-card stock-card-clickable" id="card-cabinet-chests" onclick="openCabinetInline('chests')" title="Нажмите, чтобы изменить количество сундуков">
        <span class="stock-card-edit-hint">✏️</span>
        <div class="label">📦 Сундук выбора</div>
        <div class="value" style="font-size:17px">${fmtNum(st.chests)}</div>
      </div>
    `);
  }

  // 4. Star Coupons
  if (cabinetInlineEditingKey === 'starCoupons') {
    cards.push(`
      <div class="stock-card stock-card-editing" id="card-cabinet-star-coupons" onclick="event.stopPropagation()">
        <div class="label">⭐ Купон звезды</div>
        <div class="stock-inline-edit-wrap">
          <input type="text" inputmode="numeric" pattern="[0-9 ]*" autocomplete="off" class="stock-inline-input" id="input-cabinet-star-coupons" value="${formatInputNumber(st.starCoupons || 0)}" onkeydown="handleCabinetInlineKey(event, 'starCoupons')">
          <div class="stock-inline-actions">
            <button type="button" class="btn-primary btn-xs" onclick="saveCabinetInline('starCoupons')" title="Сохранить (Enter)">✓</button>
            <button type="button" class="btn-ghost btn-xs" onclick="closeCabinetInline()" title="Отмена (Esc)">✕</button>
          </div>
        </div>
      </div>
    `);
  } else {
    cards.push(`
      <div class="stock-card stock-card-clickable" id="card-cabinet-star-coupons" onclick="openCabinetInline('starCoupons')" title="Нажмите, чтобы изменить купоны звезды">
        <span class="stock-card-edit-hint">✏️</span>
        <div class="label">⭐ Купон звезды</div>
        <div class="value" style="font-size:17px">${fmtNum(st.starCoupons || 0)}</div>
      </div>
    `);
  }

  // 5. Legendary Stars I / II / III
  if (cabinetInlineEditingKey === 'stars') {
    cards.push(`
      <div class="stock-card stock-card-editing" id="card-cabinet-stars" onclick="event.stopPropagation()">
        <div class="label">🌟 Звезды I (110) / II (420) / III (960)</div>
        <div class="stock-inline-stars-row">
          <div class="stock-inline-star-col">
            <span class="stock-star-sublabel">I (110):</span>
            <input type="text" inputmode="numeric" pattern="[0-9 ]*" autocomplete="off" class="stock-inline-input" id="input-cabinet-stars-1" value="${formatInputNumber(st.legendaryStars1 || 0)}" onkeydown="handleCabinetInlineKey(event, 'stars')" oninput="updateCabinetLiveStars()">
          </div>
          <div class="stock-inline-star-col">
            <span class="stock-star-sublabel">II (420):</span>
            <input type="text" inputmode="numeric" pattern="[0-9 ]*" autocomplete="off" class="stock-inline-input" id="input-cabinet-stars-2" value="${formatInputNumber(st.legendaryStars2 || 0)}" onkeydown="handleCabinetInlineKey(event, 'stars')" oninput="updateCabinetLiveStars()">
          </div>
          <div class="stock-inline-star-col">
            <span class="stock-star-sublabel">III (960):</span>
            <input type="text" inputmode="numeric" pattern="[0-9 ]*" autocomplete="off" class="stock-inline-input" id="input-cabinet-stars-3" value="${formatInputNumber(st.legendaryStars3 || 0)}" onkeydown="handleCabinetInlineKey(event, 'stars')" oninput="updateCabinetLiveStars()">
          </div>
        </div>
        <div class="stock-inline-actions" style="margin-top:8px">
          <button type="button" class="btn-primary btn-xs" onclick="saveCabinetInline('stars')" title="Сохранить звёзды (Enter)">✓ Сохранить</button>
          <button type="button" class="btn-ghost btn-xs" onclick="closeCabinetInline()" title="Отмена (Esc)">✕ Отмена</button>
        </div>
      </div>
    `);
  } else {
    cards.push(`
      <div class="stock-card stock-card-clickable" id="card-cabinet-stars" onclick="openCabinetInline('stars')" title="Нажмите, чтобы изменить количество звёзд">
        <span class="stock-card-edit-hint">✏️</span>
        <div class="label">🌟 Звезды I / II / III</div>
        <div class="value" style="font-size:14px;font-family:var(--mono)">
          ${fmtNum(st.legendaryStars1 || 0)} / ${fmtNum(st.legendaryStars2 || 0)} / ${fmtNum(st.legendaryStars3 || 0)}
        </div>
      </div>
    `);
  }

  // 6. Star Points (Calculation Badge)
  cards.push(`
    <div class="stock-card stock-card-clickable" id="card-cabinet-star-points" onclick="openCabinetInline('stars')" title="Нажмите для перехода к звёздам">
      <span class="stock-card-edit-hint">✏️</span>
      <div class="label">✨ Очки звезд</div>
      <div class="value" id="val-cabinet-star-points" style="font-size:17px;color:#f1e05a">${fmtNum(starPts)}</div>
    </div>
  `);

  return cards.join('');
}

function openCabinetInline(key) {
  cabinetInlineEditingKey = key;
  const wrap = document.getElementById('cabinet-stock-grid-wrap');
  if (!wrap || !myCabinetProfile) return;
  wrap.innerHTML = renderCabinetStockGridHtml(myCabinetProfile);
  bindAllNumericInputs(wrap);

  setTimeout(() => {
    if (key === 'stars') {
      const el = document.getElementById('input-cabinet-stars-1');
      if (el) { el.focus(); el.select(); }
    } else {
      const el = document.getElementById(`input-cabinet-${key === 'starCoupons' ? 'star-coupons' : key}`);
      if (el) { el.focus(); el.select(); }
    }
  }, 10);
}

function closeCabinetInline() {
  cabinetInlineEditingKey = null;
  const wrap = document.getElementById('cabinet-stock-grid-wrap');
  if (!wrap || !myCabinetProfile) return;
  wrap.innerHTML = renderCabinetStockGridHtml(myCabinetProfile);
}

function handleCabinetInlineKey(e, key) {
  if (e.key === 'Enter') {
    e.preventDefault();
    saveCabinetInline(key);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeCabinetInline();
  }
}

function updateCabinetLiveStars() {
  const s1 = Math.max(0, parseInt(document.getElementById('input-cabinet-stars-1')?.value) || 0);
  const s2 = Math.max(0, parseInt(document.getElementById('input-cabinet-stars-2')?.value) || 0);
  const s3 = Math.max(0, parseInt(document.getElementById('input-cabinet-stars-3')?.value) || 0);
  const total = s1 * 110 + s2 * 420 + s3 * 960;
  const ptsEl = document.getElementById('val-cabinet-star-points');
  if (ptsEl) ptsEl.textContent = fmtNum(total);
}

async function saveCabinetInline(key) {
  if (!myCabinetProfile) return;
  const stock = { ...myCabinetProfile.stock };

  if (key === 'coupons') {
    stock.coupons = Math.max(0, parseInputNumber(document.getElementById('input-cabinet-coupons')?.value));
  } else if (key === 'puzzles') {
    stock.puzzles = Math.max(0, parseInputNumber(document.getElementById('input-cabinet-puzzles')?.value));
  } else if (key === 'starCoupons') {
    stock.starCoupons = Math.max(0, parseInputNumber(document.getElementById('input-cabinet-star-coupons')?.value));
  } else if (key === 'chests') {
    stock.chests = Math.max(0, parseInputNumber(document.getElementById('input-cabinet-chests')?.value));
  } else if (key === 'stars') {
    stock.legendaryStars1 = Math.max(0, parseInputNumber(document.getElementById('input-cabinet-stars-1')?.value));
    stock.legendaryStars2 = Math.max(0, parseInputNumber(document.getElementById('input-cabinet-stars-2')?.value));
    stock.legendaryStars3 = Math.max(0, parseInputNumber(document.getElementById('input-cabinet-stars-3')?.value));
  }

  try {
    await apiFetch('/api/my-profile', {
      method: 'PUT',
      body: { stock }
    });
    myCabinetProfile.stock = stock;
    cabinetInlineEditingKey = null;
    toast('✓ Запасы обновлены');
    await renderMyCabinet();
  } catch (err) {
    toast('Ошибка сохранения: ' + err.message, 'error');
  }
}

function openCabinetStockEdit(fieldKey) {
  openCabinetInline(fieldKey === 'legendaryStars1' || fieldKey === 'legendaryStars2' || fieldKey === 'legendaryStars3' ? 'stars' : fieldKey);
}
function closeCabinetStockEdit() {
  closeCabinetInline();
}
function toggleCabinetStockEdit() {
  if (cabinetInlineEditingKey) closeCabinetInline();
  else openCabinetInline('coupons');
}
async function saveMyStock() {
  if (cabinetInlineEditingKey) await saveCabinetInline(cabinetInlineEditingKey);
}

async function switchCabinetSector(sectorId) {
  try {
    const sId = Number(sectorId);
    await apiFetch('/api/my-profile/active-sector', {
      method: 'POST',
      body: { sectorId: sId }
    });
    if (currentUser) {
      currentUser.playerId = sId;
    }
    state.currentPlayerId = sId;
    if (typeof save === 'function') save();
    toast('Активный сектор изменен', 'success');
    await renderMyCabinet();
  } catch (err) {
    toast('Ошибка переключения сектора: ' + (err.message || err), 'error');
  }
}

function openAddSectorModal() {
  const nameInput = document.getElementById('as-name');
  if (nameInput) nameInput.value = '';
  const rnInput = document.getElementById('as-real-name');
  if (rnInput) rnInput.value = '';
  const vipInput = document.getElementById('as-vip');
  if (vipInput) vipInput.value = 0;
  const powerInput = document.getElementById('as-power');
  if (powerInput) powerInput.value = formatInputNumber(0);
  const killsInput = document.getElementById('as-kills');
  if (killsInput) killsInput.value = formatInputNumber(0);

  const modalEl = document.getElementById('modal-add-sector');
  if (modalEl) bindAllNumericInputs(modalEl);

  openModal('modal-add-sector');
  setTimeout(() => document.getElementById('as-name')?.focus(), 50);
}

async function submitAddSector() {
  const nameInput = document.getElementById('as-name');
  const name = nameInput?.value?.trim();
  if (!name) {
    toast('Укажите название сектора', 'error');
    nameInput?.focus();
    return;
  }
  const realName = document.getElementById('as-real-name')?.value?.trim() || '';
  const vipLevel = Math.max(0, parseInt(document.getElementById('as-vip')?.value) || 0);
  const power = Math.max(0, parseInputNumber(document.getElementById('as-power')?.value || 0));
  const kills = Math.max(0, parseInputNumber(document.getElementById('as-kills')?.value || 0));

  try {
    const created = await apiFetch('/api/my-sectors', {
      method: 'POST',
      body: {
        name,
        realName,
        sector: {
          vipLevel,
          power,
          kills,
          killPoints: kills
        }
      }
    });

    closeAllModals();

    if (created && created.id) {
      const pIdx = state.players.findIndex(p => p.id === created.id);
      if (pIdx >= 0) state.players[pIdx] = created;
      else state.players.push(created);

      await apiFetch('/api/my-profile/active-sector', {
        method: 'POST',
        body: { sectorId: created.id }
      }).catch(() => {});

      if (currentUser) {
        currentUser.playerId = created.id;
      }
      state.currentPlayerId = created.id;
    }

    toast(`Сектор «${escapeHtml(created.name || name)}» создан!`, 'success');
    await renderMyCabinet();
  } catch (err) {
    toast('Ошибка создания сектора: ' + (err.message || err), 'error');
  }
}

function renderOfficerStarHintText(currentStars) {
  if (typeof logic !== 'undefined' && logic.formatOfficerStarHint) {
    return logic.formatOfficerStarHint(currentStars);
  }
  const count = Math.max(0, Math.min(6, Number(currentStars) || 0));
  if (count >= 6) {
    return '6★ Максимум (98 000 звёзд)';
  }
  const next = count + 1;
  const cost = typeof starCostFor === 'function' ? starCostFor(next) : 0;
  return `До ${next}★: ${fmtNum(cost)} звёзд`;
}

function onCabinetStarHover(officerId, star) {
  const el = document.getElementById(`cabinet-star-hint-${officerId}`);
  if (!el) return;
  const cost = typeof starCostFor === 'function' ? starCostFor(star) : 0;
  el.innerHTML = `<span class="star-hint-badge hover">✨ До <strong>${star}★</strong>: <strong>${fmtNum(cost)}</strong> звёзд (клик для выбора)</span>`;
}

function onCabinetStarLeave(officerId, currentStars) {
  const el = document.getElementById(`cabinet-star-hint-${officerId}`);
  if (!el) return;
  el.innerHTML = `<span class="star-hint-badge">⭐ ${renderOfficerStarHintText(currentStars)}</span>`;
}

function renderInteractiveStars(officer) {
  const count = Number(officer.stars) || 0;
  return `<span class="stars">${Array.from({length:6},(_,i)=>{
    const star = i + 1;
    const cost = starCostFor(star);
    const tooltipText = star < 6
      ? `До ${star}★: ${fmtNum(cost)} звёзд`
      : `Итого ${fmtNum(cost)} звёзд (6★ макс)`;
    const newStars = star === count ? star - 1 : star;
    return `<button type="button" class="star-btn ${count>=star?'active':''}" data-tooltip="${tooltipText}" title="${tooltipText}" aria-label="${tooltipText}" onmouseenter="onCabinetStarHover('${officer.id}', ${star})" onmouseleave="onCabinetStarLeave('${officer.id}', ${count})" onclick="setMyOfficerStars('${officer.id}', ${newStars})">${count>=star?'★':'☆'}</button>`;
  }).join('')}</span>`;
}

function renderCabinetOfficerCardHtml(o, profile, today) {
  const cat = getCatalogOfficer(o.catalogId) || { couponPerPuzzle: 500, generation: 7, type: 'Пехота' };
  const def = calculateOfficerDeficit({ officer: o, catalogItem: cat, player: profile, targetLevel: 180, today });
  const targetPuz = 180 * PUZZLES_PER_LEVEL;
  const currPuz = def.currentPuzzles;
  const pctVal = Math.min(100, Math.round((currPuz / targetPuz) * 100));

  return `
    <div class="cabinet-officer-card" id="cabinet-officer-card-${o.id}">
      <div class="cabinet-officer-header">
        <div>
          <div class="cabinet-officer-name">${escapeHtml(officerLabel(o))}</div>
          <div style="display:flex;gap:6px;align-items:center;margin-top:4px">
            ${troopBadge(cat.type)}
            <span class="cabinet-stat-pill">Ген. ${cat.generation}</span>
          </div>
        </div>
        <div style="display:flex;gap:4px">
          <button class="action-btn" title="Редактировать уровень и купоны" onclick="openEditMyOfficerModal('${o.id}')">✏️</button>
          <button class="action-btn danger" title="Удалить офицера" onclick="deleteMyOfficer('${o.id}', '${escapeHtml(officerLabel(o))}')">🗑️</button>
        </div>
      </div>

      <!-- Interactive Stars with dynamic hint -->
      <div class="cabinet-officer-stars-box">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:12px;color:var(--text2)">Звёзды:</span>
            ${renderInteractiveStars(o)}
          </div>
          <div>
            ${def.starRequirement.isStarReady
              ? `<span class="badge badge-success" style="font-size:10px">6★ Готово</span>`
              : `<span class="badge badge-warning" style="font-size:10px" title="Для 180 уровня требуется 6★">Нужно 6★</span>`}
          </div>
        </div>
        <div class="cabinet-star-hint" id="cabinet-star-hint-${o.id}">
          <span class="star-hint-badge">⭐ ${renderOfficerStarHintText(o.stars)}</span>
        </div>
      </div>

      <!-- Interactive Skills -->
      <div style="margin:4px 0">
        ${renderCabinetOfficerSkills(o)}
      </div>

      <!-- Level and Progress -->
      <div>
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
          <span>Уровень: <strong>${o.level} / 180</strong></span>
          <span style="color:var(--text2)">Купоны: <strong>${fmtNum(o.coupons)}</strong></span>
        </div>
        <div class="progress-container">
          <div class="progress-fill" style="width:${pctVal}%"></div>
        </div>
      </div>

      <!-- Deficit & Forecast -->
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:12px;display:flex;flex-direction:column;gap:4px">
        <div style="display:flex;justify-content:space-between">
          <span style="color:var(--text3)">Дефицит до 180:</span>
          <strong style="color:var(--text)">${fmtNum(def.deficitPuzzles)} пазл. ${def.costPerPuzzle > 0 ? `(${fmtNum(def.deficitCoupons)} куп.)` : '(только пазлы)'}</strong>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="color:var(--text3)">Прогноз без ивентов:</span>
          <span style="color:var(--text2)">${def.dateWithoutEvents ? `${formatDate(def.dateWithoutEvents)} (${def.daysWithoutEvents} дн.)` : '—'}</span>
        </div>
      </div>
    </div>
  `;
}

let myOfficerModalSkills = [1, 1, 1, 1];

function renderMyOfficerModalSkills() {
  const container = document.getElementById('my-officer-modal-skills');
  if (!container) return;
  const medalsFn = (typeof logic !== 'undefined' && logic.calculateSkillMedalsProgress)
    ? logic.calculateSkillMedalsProgress
    : (typeof calculateSkillMedalsProgress === 'function' ? calculateSkillMedalsProgress : null);
  const progress = medalsFn ? medalsFn(myOfficerModalSkills) : { spentMedals: 0, remainingMedals: 690, isMaxSkills: false };

  container.innerHTML = `
    <div class="skill-level-group">
      <div style="display:flex;justify-content:space-between;align-items:center;width:100%;margin-bottom:4px">
        <span class="skill-group-title">Уровни навыков:</span>
        <span class="skill-progress-badge ${progress.isMaxSkills ? 'max-skills' : ''}">
          Медали: <strong>${progress.spentMedals}</strong> / 690
          ${progress.isMaxSkills ? '<span class="badge badge-success" style="font-size:10px">MAX</span>' : `<span class="skill-remaining">(-${progress.remainingMedals})</span>`}
        </span>
      </div>
      <div class="skill-selectors" style="width:100%">
        ${[0, 1, 2, 3].map(sIdx => `
          <div class="skill-selector">
            <span class="skill-idx-badge">Н${sIdx + 1}</span>
            <div class="skill-btn-group">
              ${[1, 2, 3, 4, 5].map(lvl => `
                <button type="button" class="skill-btn ${myOfficerModalSkills[sIdx] === lvl ? 'active' : ''}" onclick="setMyOfficerModalSkill(${sIdx}, ${lvl})">${lvl}</button>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function setMyOfficerModalSkill(sIdx, lvl) {
  myOfficerModalSkills[sIdx] = Math.max(1, Math.min(5, Number(lvl) || 1));
  renderMyOfficerModalSkills();
}

function openAddMyOfficerModal() {
  myOfficerEditId = null;
  document.getElementById('modal-my-officer-title').textContent = 'Добавить офицера в кабинет';
  const group = document.getElementById('my-officer-catalog-group');
  if (group) group.style.display = 'flex';

  const select = document.getElementById('my-officer-catalog-select');
  if (select) {
    const existingCatalogIds = new Set((myCabinetProfile?.officers || []).map(o => o.catalogId));
    select.innerHTML = state.officerCatalog.map(cat => {
      const already = existingCatalogIds.has(cat.id);
      return `<option value="${cat.id}" ${already ? 'disabled' : ''}>${escapeHtml(cat.name)} (${cat.type}, Ген. ${cat.generation})${already ? ' — уже добавлен' : ''}</option>`;
    }).join('');
  }

  document.getElementById('my-officer-level').value = 0;
  document.getElementById('my-officer-coupons').value = 0;
  document.getElementById('my-officer-stars').value = 0;
  myOfficerModalSkills = [1, 1, 1, 1];
  renderMyOfficerModalSkills();

  openModal('modal-my-officer');
}

function openEditMyOfficerModal(officerId) {
  myOfficerEditId = officerId;
  const off = myCabinetProfile?.officers?.find(o => o.id === officerId);
  if (!off) return;

  document.getElementById('modal-my-officer-title').textContent = `Редактировать офицера: ${officerLabel(off)}`;
  const group = document.getElementById('my-officer-catalog-group');
  if (group) group.style.display = 'none';

  document.getElementById('my-officer-level').value = off.level || 0;
  document.getElementById('my-officer-coupons').value = off.coupons || 0;
  document.getElementById('my-officer-stars').value = off.stars || 0;
  myOfficerModalSkills = Array.isArray(off.skills) && off.skills.length === 4 ? [...off.skills] : [1, 1, 1, 1];
  renderMyOfficerModalSkills();

  openModal('modal-my-officer');
}

async function saveMyOfficerSubmit() {
  const level = Math.max(0, Math.min(180, parseInt(document.getElementById('my-officer-level').value) || 0));
  const coupons = Math.max(0, parseInt(document.getElementById('my-officer-coupons').value) || 0);
  const stars = Math.max(0, Math.min(6, parseInt(document.getElementById('my-officer-stars').value) || 0));
  const skills = Array.isArray(myOfficerModalSkills) && myOfficerModalSkills.length === 4
    ? myOfficerModalSkills.map(s => Math.max(1, Math.min(5, parseInt(s) || 1)))
    : [1, 1, 1, 1];

  let newStock = null;
  let levelStockDelta = null;

  if (myOfficerEditId && myCabinetProfile?.stock) {
    const oldOff = myCabinetProfile.officers?.find(o => String(o.id) === String(myOfficerEditId));
    if (oldOff && oldOff.level !== level) {
      const cat = getCatalogOfficer(oldOff.catalogId);
      const rawCost = Number(cat?.couponPerPuzzle);
      const costPerPuzzle = rawCost === 0 ? (cat?.upgradeType === 'special' ? 0 : 500) : (rawCost || (cat?.generation === 7 ? 600 : (cat?.generation >= 8 ? 720 : 500)));
      const upgradeType = cat?.upgradeType || 'standard';
      const deltaFn = (typeof logic !== 'undefined' && logic.calculateLevelStockDelta) ? logic.calculateLevelStockDelta : calculateLevelStockDelta;
      levelStockDelta = deltaFn(oldOff.level, level, myCabinetProfile.stock, costPerPuzzle, upgradeType);

      if (!levelStockDelta.canAfford) {
        toast(`❌ Недостаточно ресурсов на складе для изменения уровня (не хватает ${fmtNum(levelStockDelta.deficitPuzzles || 0)} пазл.). Изменение отменено.`, 'error');
        return;
      }

      newStock = {
        ...myCabinetProfile.stock,
        coupons: Math.max(0, (myCabinetProfile.stock.coupons || 0) + levelStockDelta.delta.coupons),
        puzzles: Math.max(0, (myCabinetProfile.stock.puzzles || 0) + levelStockDelta.delta.puzzles),
      };
    }
  }

  try {
    if (myOfficerEditId) {
      await apiFetch(`/api/my-profile/officers/${myOfficerEditId}`, {
        method: 'PUT',
        body: { level, coupons, stars, skills }
      });
      if (newStock) {
        await apiFetch('/api/my-profile', {
          method: 'PUT',
          body: { stock: newStock }
        });
        myCabinetProfile.stock = newStock;
        if (state.players) {
          const me = state.players.find(p => p.id === myCabinetProfile.id);
          if (me) me.stock = newStock;
        }
      }
      toast('Офицер обновлен');
    } else {
      const catalogId = document.getElementById('my-officer-catalog-select').value;
      if (!catalogId) {
        toast('Выберите офицера из каталога', 'error');
        return;
      }
      const cat = getCatalogOfficer(catalogId);
      await apiFetch('/api/my-profile/officers', {
        method: 'POST',
        body: { catalogId, name: cat?.name || '', level, coupons, stars, skills }
      });
      toast('Офицер добавлен в профиль');
    }
    closeAllModals();
    await renderMyCabinet();
  } catch (err) {
    toast('Ошибка сохранения офицера: ' + err.message, 'error');
  }
}

async function deleteMyOfficer(officerId, officerName) {
  if (!confirm(`Удалить офицера «${officerName}» из вашего кабинета?`)) return;

  try {
    await apiFetch(`/api/my-profile/officers/${officerId}`, { method: 'DELETE' });
    toast('Офицер удален из кабинета', 'info');
    await renderMyCabinet();
  } catch (err) {
    toast('Ошибка удаления офицера: ' + err.message, 'error');
  }
}

async function setMyOfficerStars(officerId, stars) {
  const count = Math.max(0, Math.min(6, Number(stars) || 0));
  const off = myCabinetProfile?.officers?.find(o => String(o.id) === String(officerId));
  if (!off) return;
  const oldStars = Number(off.stars) || 0;
  if (oldStars === count) return;

  let stockDelta = null;
  let newStock = null;

  if (myCabinetProfile?.stock) {
    const cat = getCatalogOfficer(off.catalogId);
    const starCouponCost = cat?.starCouponCost || (cat?.generation === 7 ? 300 : (cat?.generation <= 6 ? 250 : 360));
    const deltaFn = (typeof logic !== 'undefined' && logic.calculateStarStockDelta) ? logic.calculateStarStockDelta : calculateStarStockDelta;
    stockDelta = deltaFn(oldStars, count, myCabinetProfile.stock, starCouponCost);

    if (!stockDelta.canAfford) {
      toast(`❌ Недостаточно ресурсов на складе! Требуется ${fmtNum(stockDelta.points)} очков звёзд (не хватает ${fmtNum(stockDelta.deficitPoints)}). Повышение отменено.`, 'error');
      return;
    }

    newStock = {
      ...myCabinetProfile.stock,
      starCoupons: Math.max(0, (myCabinetProfile.stock.starCoupons || 0) + stockDelta.delta.starCoupons),
      legendaryStars1: Math.max(0, (myCabinetProfile.stock.legendaryStars1 || 0) + stockDelta.delta.legendaryStars1),
      legendaryStars2: Math.max(0, (myCabinetProfile.stock.legendaryStars2 || 0) + stockDelta.delta.legendaryStars2),
      legendaryStars3: Math.max(0, (myCabinetProfile.stock.legendaryStars3 || 0) + stockDelta.delta.legendaryStars3),
    };
  }

  try {
    await apiFetch(`/api/my-profile/officers/${officerId}`, {
      method: 'PUT',
      body: { stars: count }
    });
    if (newStock) {
      await apiFetch('/api/my-profile', {
        method: 'PUT',
        body: { stock: newStock }
      });
      myCabinetProfile.stock = newStock;
    }

    off.stars = count;
    if (state.players) {
      for (const p of state.players) {
        if (p.officers) {
          const o = p.officers.find(x => String(x.id) === String(officerId));
          if (o) o.stars = count;
        }
        if (p.id === myCabinetProfile.id && newStock) {
          p.stock = newStock;
        }
      }
    }

    const cardEl = document.getElementById(`cabinet-officer-card-${officerId}`);
    const updatedOff = myCabinetProfile?.officers?.find(o => String(o.id) === String(officerId));
    if (cardEl && updatedOff) {
      const today = new Date().toISOString().slice(0, 10);
      cardEl.outerHTML = renderCabinetOfficerCardHtml(updatedOff, myCabinetProfile, today);
    } else {
      await renderMyCabinet();
    }
    const simEl = document.getElementById('cabinet-sim-container');
    if (simEl && typeof renderCabinetSimulatorHtml === 'function') {
      simEl.innerHTML = renderCabinetSimulatorHtml();
    }
    const stockGridWrap = document.getElementById('cabinet-stock-grid-wrap');
    if (stockGridWrap && myCabinetProfile) {
      stockGridWrap.innerHTML = renderCabinetStockGridHtml(myCabinetProfile);
    }

    const actionText = stockDelta && stockDelta.delta.starCoupons < 0
      ? ` Списано: ${fmtNum(Math.abs(stockDelta.delta.starCoupons))} купонов звезды`
      : '';

    showUndoToast(`⭐ Звёзды ${escapeHtml(officerLabel(off))}: ${count}★.${actionText}`, async () => {
      await setMyOfficerStars(officerId, oldStars);
    });
  } catch (err) {
    toast('Ошибка обновления звёзд: ' + err.message, 'error');
  }
}

function onCabinetSimOfficerChange(officerId) {
  myCabinetSim.officerId = officerId;
  const container = document.getElementById('cabinet-sim-container');
  if (container) container.innerHTML = renderCabinetSimulatorHtml();
}

function setCabinetSimTargetLevel(lvl) {
  myCabinetSim.targetLevel = Math.max(1, Math.min(180, Number(lvl) || 180));
  const container = document.getElementById('cabinet-sim-container');
  if (container) container.innerHTML = renderCabinetSimulatorHtml();
}

function adjustCabinetSimEvent(key, delta) {
  if (!myCabinetSim.planned) myCabinetSim.planned = { top1: 0, top2: 0, top3: 0, top4: 0 };
  myCabinetSim.planned[key] = Math.max(0, (myCabinetSim.planned[key] || 0) + delta);
  const container = document.getElementById('cabinet-sim-container');
  if (container) container.innerHTML = renderCabinetSimulatorHtml();
}

// ─── PAGE: PENDING REGISTRATIONS ─────────────────────────────
async function renderPendingRegistrations() {
  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="section-header">
      <div class="section-title">Заявки на регистрацию участников</div>
      <button class="btn-ghost btn-sm" onclick="renderPendingRegistrations()">🔄 Обновить</button>
    </div>
    <div id="pending-users-container">
      <div class="empty-state"><p>Загрузка заявок...</p></div>
    </div>
  `;

  try {
    const pendingUsers = await apiFetch('/api/users/pending');
    pendingRequestsCount = Array.isArray(pendingUsers) ? pendingUsers.length : 0;
    renderPendingBadge();
    const container = document.getElementById('pending-users-container');
    if (!container) return;

    if (!pendingUsers || pendingUsers.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div style="font-size:32px;margin-bottom:8px">🎉</div>
          <p style="font-weight:600;font-size:15px;color:var(--text)">Нет активных заявок на регистрацию</p>
          <p style="color:var(--text3);font-size:13px;margin-top:4px">Все поступившие заявки обработаны руководствами гильдии.</p>
        </div>
      `;
      return;
    }

    const isR5 = (currentUser?.rank || state.currentRole) === 'r5';

    container.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Логин</th>
              <th>Персонаж в гильдии</th>
              <th>Дата заявки</th>
              <th>Статус</th>
              <th style="text-align:right">Действия</th>
            </tr>
          </thead>
          <tbody>
            ${pendingUsers.map(u => `
              <tr>
                <td style="color:var(--text3);font-family:var(--mono)">#${u.id}</td>
                <td style="font-weight:600;color:var(--text)">${escapeHtml(u.username)}</td>
                <td>${u.playerName ? escapeHtml(u.playerName) : '<span style="color:var(--text3)">Новый персонаж</span>'}</td>
                <td style="color:var(--text2);font-size:12px">${formatDateTime(u.createdAt || u.created_at)}</td>
                <td><span class="badge badge-pending">⏳ Ожидает</span></td>
                <td style="text-align:right">
                  <div style="display:inline-flex;gap:6px;justify-content:flex-end">
                    <button class="btn-primary btn-sm" onclick="handleApproveUser(${u.id}, 'r3')">Одобрить (Р3)</button>
                    ${isR5 ? `<button class="btn-primary btn-sm" style="background:#8b5cf6" onclick="handleApproveUser(${u.id}, 'r4')">Одобрить (Р4)</button>` : ''}
                    <button class="btn-danger btn-sm" onclick="handleRejectUser(${u.id}, '${escapeHtml(u.username)}')">Отклонить</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    const container = document.getElementById('pending-users-container');
    if (container) {
      container.innerHTML = `<div class="empty-state"><p style="color:var(--red)">Ошибка загрузки заявок: ${escapeHtml(err.message)}</p></div>`;
    }
  }
}

async function handleApproveUser(userId, rank) {
  try {
    await apiFetch(`/api/users/${userId}/approve`, {
      method: 'POST',
      body: { rank }
    });
    toast(`Пользователь #${userId} одобрен в ранге ${rank.toUpperCase()}`);
    await updatePendingCount();
    await renderPendingRegistrations();
  } catch (err) {
    toast(`Ошибка одобрения: ${err.message}`, 'error');
  }
}

async function handleRejectUser(userId, username) {
  if (!confirm(`Отклонить заявку пользователя "${username}"?`)) return;
  try {
    await apiFetch(`/api/users/${userId}/reject`, {
      method: 'POST'
    });
    toast(`Заявка пользователя "${username}" отклонена`);
    await updatePendingCount();
    await renderPendingRegistrations();
  } catch (err) {
    toast(`Ошибка отклонения: ${err.message}`, 'error');
  }
}

// ─── PAGE: USERS (R5) ────────────────────────────────────────
async function renderUsers() {
  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="section-header">
      <div class="section-title">🔐 Управление пользователями гильдии</div>
      <button class="btn-ghost btn-sm" onclick="renderUsers()">🔄 Обновить</button>
    </div>
    <div id="users-table-container">
      <div class="empty-state"><p>Загрузка пользователей...</p></div>
    </div>
  `;

  try {
    const users = await apiFetch('/api/users');
    const container = document.getElementById('users-table-container');
    if (!container) return;

    if (!users || users.length === 0) {
      container.innerHTML = `<div class="empty-state"><p>Пользователей не найдено</p></div>`;
      return;
    }

    container.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Логин</th>
              <th>Персонаж</th>
              <th>Ранг</th>
              <th>Статус</th>
              <th>Регистрация</th>
              <th style="text-align:right">Действия</th>
            </tr>
          </thead>
          <tbody>
            ${users.map(u => `
              <tr>
                <td style="color:var(--text3);font-family:var(--mono)">#${u.id}</td>
                <td style="font-weight:600;color:var(--text)">${escapeHtml(u.username)}</td>
                <td>${u.playerName ? escapeHtml(u.playerName) : '<span style="color:var(--text3)">—</span>'}</td>
                <td>
                  <select style="width:auto;padding:3px 8px;font-size:12px" onchange="handleChangeUserRank(${u.id}, this.value)">
                    <option value="r3" ${u.rank === 'r3' ? 'selected' : ''}>Р3 (Боец)</option>
                    <option value="r4" ${u.rank === 'r4' ? 'selected' : ''}>Р4 (Чиновник)</option>
                    <option value="r5" ${u.rank === 'r5' ? 'selected' : ''}>Р5 (Глава)</option>
                  </select>
                </td>
                <td>${u.is_approved ? '<span class="badge badge-success">✓ Активен</span>' : '<span class="badge badge-pending">⏳ Ожидает</span>'}</td>
                <td style="color:var(--text2);font-size:12px">${formatDateTime(u.createdAt || u.created_at)}</td>
                <td style="text-align:right">
                  <button class="action-btn" onclick="handleResetUserPassword(${u.id}, '${escapeHtml(u.username)}')">🔑 Пароль</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    const container = document.getElementById('users-table-container');
    if (container) {
      container.innerHTML = `<div class="empty-state"><p style="color:var(--red)">Ошибка: ${escapeHtml(err.message)}</p></div>`;
    }
  }
}

async function handleChangeUserRank(userId, newRank) {
  try {
    await apiFetch(`/api/users/${userId}`, {
      method: 'PATCH',
      body: { rank: newRank }
    });
    toast(`Ранг пользователя #${userId} изменен на ${newRank.toUpperCase()}`);
    if (currentUser && currentUser.id === userId) {
      currentUser.rank = newRank;
      state.currentRole = newRank;
      renderTopbarProfile();
      renderSidebarNav();
    }
  } catch (err) {
    toast(`Ошибка изменения ранга: ${err.message}`, 'error');
    renderUsers();
  }
}

async function handleResetUserPassword(userId, username) {
  const newPass = prompt(`Введите новый пароль для пользователя "${username}":`);
  if (!newPass) return;
  if (newPass.length < 4) {
    toast('Пароль должен содержать не менее 4 символов', 'error');
    return;
  }
  try {
    await apiFetch(`/api/users/${userId}`, {
      method: 'PATCH',
      body: { password: newPass }
    });
    toast(`Пароль для "${username}" успешно обновлен`);
    if (username === 'admin') {
      if (currentUser && currentUser.username === 'admin') {
        currentUser.hasDefaultAdminPassword = false;
        try { localStorage.setItem('kow_user', JSON.stringify(currentUser)); } catch (e) {}
        const secAlert = document.getElementById('admin-security-alert');
        if (secAlert) secAlert.style.display = 'none';
      }
      const hint = document.getElementById('auth-demo-hint');
      if (hint) hint.style.display = 'none';
    }
  } catch (err) {
    toast(`Ошибка смены пароля: ${err.message}`, 'error');
  }
}

function formatDate(s) {
  if (!s) return '—';
  const d = new Date(s + 'T00:00:00');
  return d.toLocaleDateString('ru',{day:'numeric',month:'short',year:'numeric'});
}
function formatDateShort(s) {
  if (!s) return '—';
  const d = new Date(s + 'T00:00:00');
  return d.toLocaleDateString('ru',{day:'numeric',month:'short'});
}
function isEventActive(ev) {
  const now = new Date(); now.setHours(0,0,0,0);
  const f = new Date(ev.dateFrom+'T00:00:00');
  const t = new Date(ev.dateTo+'T00:00:00');
  return now >= f && now <= t;
}
function isEventUpcoming(ev) {
  const now = new Date(); now.setHours(0,0,0,0);
  const f = new Date(ev.dateFrom+'T00:00:00');
  return f > now;
}
function isEventPast(ev) { return !isEventActive(ev) && !isEventUpcoming(ev); }

// ─── NAVIGATION ──────────────────────────────────────────────
let currentPage = 'calendar';
let pageParams = {};

function navigate(page, params={}) {
  const role = currentUser?.rank || state.currentRole || 'r3';

  // Role permissions check
  if (role === 'r3') {
    const allowedR3 = ['my_cabinet', 'calendar', 'calculator', 'officer_detail', 'event_detail'];
    if (!allowedR3.includes(page)) {
      page = 'my_cabinet';
    }
  } else if (role === 'r4') {
    if (page === 'users') {
      page = 'calendar';
    }
  }

  currentPage = page;
  pageParams = params;

  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active', el.dataset.page===page));
  const titles = {
    my_cabinet: 'Мой кабинет',
    calendar: 'Календарь ивентов',
    players: 'Секторы',
    officers: 'Офицеры',
    officer_detail: 'Офицер',
    event_types: 'Настройка ивентов',
    event_detail: 'Ивент',
    player_detail: 'Сектор',
    calculator: 'Калькулятор и Аналитика',
    pending_registrations: 'Заявки на регистрацию',
    users: 'Управление пользователями'
  };
  const titleEl = document.getElementById('page-title');
  if (titleEl) {
    titleEl.textContent = titles[page] || page;
  }
  const roleSwitchEl = document.getElementById('role-switch');
  if (roleSwitchEl) {
    roleSwitchEl.value = role;
  }
  const contentEl = document.getElementById('content');
  if (contentEl) {
    contentEl.innerHTML = '';
  }

  const pageRenderers = {
    my_cabinet: renderMyCabinet,
    calendar: renderCalendar,
    players: renderPlayers,
    officers: renderOfficers,
    officer_detail: () => renderOfficerDetail(params.id),
    event_types: renderEventTypes,
    event_detail: () => renderEventDetail(params.id),
    player_detail: () => renderPlayerDetail(params.id),
    calculator: renderCalculator,
    pending_registrations: renderPendingRegistrations,
    users: renderUsers
  };

  const renderer = pageRenderers[page];
  if (renderer) {
    renderer();
  }

  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('overlay')?.classList.remove('open');
}

document.querySelectorAll('.nav-item').forEach(el=>{
  el.addEventListener('click',e=>{ e.preventDefault(); navigate(el.dataset.page); });
});

// ─── PAGE: CALENDAR ──────────────────────────────────────────
function renderCalendar() {
  const sorted = [...state.events].sort((a,b)=>a.dateFrom.localeCompare(b.dateFrom));
  const active = sorted.filter(isEventActive);
  const upcoming = sorted.filter(isEventUpcoming);
  const past = sorted.filter(isEventPast);

  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="section-header">
      <div class="section-title">Ивенты</div>
      ${canManage() ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-outline" onclick="openSeasonSchedulerModal()">⚡ Создать сезон</button>
          <button class="btn-primary" onclick="openEventModal()">+ Создать ивент</button>
        </div>` : ''}
    </div>

    ${active.length ? `
    <div class="cal-section-label active-label">● Идут сейчас</div>
    <div class="cal-cards">${active.map(ev=>calCard(ev,'active')).join('')}</div>` : ''}

    ${upcoming.length ? `
    <div class="cal-section-label upcoming-label">◎ Предстоящие</div>
    <div class="cal-cards">${upcoming.map(ev=>calCard(ev,'upcoming')).join('')}</div>` : ''}

    ${past.length ? `
    <div class="cal-section-label past-label">◌ Прошедшие</div>
    <div class="cal-cards">${past.map(ev=>calCard(ev,'past')).join('')}</div>` : ''}

    ${!sorted.length ? `<div class="empty-state"><p>Ивентов нет. Создайте первый!</p></div>` : ''}
  `;
}

function calCard(ev, status) {
  const et = getEventType(ev.typeId);
  const color = et?.color || '#888';
  const assigned = ev.assignments.length;
  const totalPlaces = et ? et.places.length : 0;
  const statusLabels = { active:'● Идёт', upcoming:'◎ Скоро', past:'◌ Завершён' };
  const totalCoupons = ev.assignments.reduce((s,a)=>{
    const pi = placeInfo(et, a.place, ev.dateFrom);
    return s + (a.actualCoupons ?? pi?.coupons ?? 0);
  }, 0);

  // top 3 assigned players
  const top3 = ev.assignments.slice(0,3).map(a=>{
    const p = getPlayer(a.playerId);
    const pi = placeInfo(et, a.place, ev.dateFrom);
    return `<div class="cal-assign-row">
      <span class="cal-place">${pi?.label || `Место ${a.place}`}</span>
      <span class="cal-pname">${p ? playerLink(p) : '—'}</span>
      <span class="cal-pcoupons">${fmtNum(a.actualCoupons ?? pi?.coupons ?? 0)} купонов</span>
    </div>`;
  }).join('');

  let regHtml = '';
  const userSectors = currentUser ? getUserSectors() : [];
  if (status === 'upcoming' && currentUser && (currentUser.playerId || userSectors.length > 0)) {
    const myRegs = (ev.myRegistrations && ev.myRegistrations.length > 0)
      ? ev.myRegistrations
      : (ev.myRegistration ? [ev.myRegistration] : []);

    if (myRegs.length > 0) {
      const regItems = myRegs.map(reg => {
        const myPlace = Number(reg.desiredPlace) || 0;
        const placeLabel = myPlace === 0 ? 'Любое' : (placeInfo(et, myPlace, ev.dateFrom)?.label || `Место ${myPlace}`);
        const sector = userSectors.find(s => Number(s.id) === Number(reg.playerId)) || getPlayer(reg.playerId) || { name: 'Сектор' };
        const regOff = (sector.officers || []).find(o => o.id === reg.officerId)
          || (state.players || []).flatMap(p => p.officers || []).find(o => o.id === reg.officerId)
          || (myCabinetProfile?.officers || []).find(o => o.id === reg.officerId);
        const regOfficerName = regOff ? officerLabel(regOff) : (reg.officerId || '—');
        const showSectorName = userSectors.length > 1;

        return `
          <div class="cal-reg-item" onclick="event.stopPropagation()">
            <div style="min-width:0;overflow:hidden;text-overflow:ellipsis">
              ${showSectorName ? `<strong>[${escapeHtml(sector.name)}]</strong> ` : ''}
              <span>✓ ${escapeHtml(regOfficerName)}</span>
              <span class="badge badge-none" style="margin-left:4px;font-size:11px">${escapeHtml(placeLabel)}</span>
            </div>
            <div style="display:flex;gap:4px;flex-shrink:0">
              <button class="action-btn" title="Изменить" onclick="event.stopPropagation();openRegisterModal(${ev.id},${reg.playerId})">✏️</button>
              <button class="action-btn danger" title="Отменить" onclick="event.stopPropagation();cancelRegistrationFromDetail(${ev.id},${reg.playerId})">✕</button>
            </div>
          </div>
        `;
      }).join('');

      const registeredSectorIds = new Set(myRegs.map(r => Number(r.playerId)));
      const hasUnregisteredSectors = userSectors.some(s => !registeredSectorIds.has(Number(s.id)));

      regHtml = `
        <div style="margin-bottom:10px" onclick="event.stopPropagation()">
          ${regItems}
          ${hasUnregisteredSectors ? `
            <button class="btn-ghost btn-sm btn-block" style="margin-top:6px;font-size:11px" onclick="event.stopPropagation();openRegisterModal(${ev.id})">
              + Зарегистрировать сектор
            </button>
          ` : ''}
        </div>
      `;
    } else {
      regHtml = `
        <div style="margin-bottom:10px" onclick="event.stopPropagation()">
          <button class="btn-primary btn-sm btn-block" onclick="event.stopPropagation();openRegisterModal(${ev.id})">
            📝 Зарегистрироваться на ивент
          </button>
        </div>
      `;
    }
  }

  return `<div class="cal-card" onclick="navigate('event_detail',{id:${ev.id}})" style="--ev-color:${color}">
    <div class="cal-card-header">
      <div>
        <div class="cal-card-name">${et?.name || '—'}</div>
        <div class="cal-card-dates">${formatDateShort(ev.dateFrom)} — ${formatDateShort(ev.dateTo)}</div>
      </div>
      <div style="text-align:right">
        <span class="cal-status ${status}">${statusLabels[status]}</span>
        <div class="cal-card-meta">${fmtNum(assigned)} назначений · ${fmtNum(totalCoupons)} купонов</div>
      </div>
    </div>
    ${top3 ? `<div class="cal-assigns">${top3}${ev.assignments.length > 3 ? `<div style="font-size:11px;color:var(--text3);padding:4px 0">+ ещё ${fmtNum(ev.assignments.length-3)} назначений</div>` : ''}</div>` : `<div class="slot-empty">Назначений нет</div>`}
    ${regHtml}
    <div class="cal-card-footer">
      <span style="font-size:12px;color:var(--text3)">${ev.note || ''}</span>
      <div style="display:flex;gap:6px">
        ${canManage() ? `<button class="action-btn" onclick="event.stopPropagation();openEventModal(${ev.id})">✏️</button><button class="action-btn danger" onclick="event.stopPropagation();confirmDeleteEvent(${ev.id})">🗑</button>` : ''}
      </div>
    </div>
  </div>`;
}

// ─── PAGE: EVENT DETAIL ──────────────────────────────────────
function renderEventDetail(eventId) {
  const ev = getEvent(eventId);
  if (!ev) { navigate('calendar'); return; }
  const et = getEventType(ev.typeId);
  const color = et?.color || '#888';
  const status = isEventActive(ev)?'active':isEventUpcoming(ev)?'upcoming':'past';
  const statusLabels = { active:'● Идёт сейчас', upcoming:'◎ Предстоящий', past:'◌ Завершён' };

  const assignMap = {};
  ev.assignments.forEach(a => assignMap[a.place] = a);

  // Build full place table from eventType places
  const maxPlace = Math.max(...(et?.places||[]).map(p=>p.place), ...ev.assignments.map(a=>a.place), 0);
  const rows = [];
  const seen = new Set();
  // All assignments
  const allPlaces = [...new Set([
    ...(et?.places||[]).map(p=>p.place),
    ...ev.assignments.map(a=>a.place)
  ])].sort((a,b)=>a-b);

  for (const pl of allPlaces) {
    const a = assignMap[pl];
    const pi = placeInfo(et, pl, ev.dateFrom);
    const p = a ? getPlayer(a.playerId) : null;
    const officer = a && p ? p.officers.find(o=>o.id===a.officerId) : null;
    const coupons = a?.actualCoupons ?? pi?.coupons ?? 0;
    const isConfirmed = a?.actualCoupons !== undefined;
    const r3Submit = state.currentRole === 'r3' && state.currentPlayerId && canR3SubmitResult({ event: ev, place: pl, nowIso: new Date().toISOString(), players: state.players });

    let regMatchBadge = '';
    if (a?.playerId && ev.registrations) {
      const reg = ev.registrations.find(r => Number(r.playerId) === Number(a.playerId));
      if (reg && (Number(reg.desiredPlace) === pl || Number(reg.desiredPlace) === 0)) {
        regMatchBadge = ` <span class="badge badge-success" style="font-size:10px" title="Заявка игрока совпала с назначением">Заявка учтена ✓</span>`;
      }
    }

    rows.push(`<tr>
      <td><strong style="font-size:15px">${pi?.label || `Место ${pl}`}</strong></td>
      <td><strong>${p ? playerLink(p) : '<span style="color:var(--text3)">Не назначен</span>'}</strong>${regMatchBadge}${r3Submit ? ` <button class="action-btn" onclick="submitR3Result(${ev.id},${pl})">Это моё место</button>` : ''}</td>
      <td style="color:var(--text2)">${officer ? officerLink(officer) : '—'}</td>
      <td style="color:var(--text2)">Ур. ${officer?.level ?? '—'}</td>
      <td style="font-family:var(--mono);color:${isConfirmed?'var(--green)':'var(--text2)'};font-weight:600">
        ${fmtNum(coupons)}${isConfirmed?' ✓':''}
      </td>
    </tr>`);
  }

  const totalCoupons = ev.assignments.reduce((s,a)=>{
    const pi = placeInfo(et,a.place, ev.dateFrom);
    return s + (a.actualCoupons ?? pi?.coupons ?? 0);
  },0);

  let regBanner = '';
  const userSectors = currentUser ? getUserSectors() : [];
  if (isEventUpcoming(ev) && currentUser && (currentUser.playerId || userSectors.length > 0)) {
    const myRegs = (ev.myRegistrations && ev.myRegistrations.length > 0)
      ? ev.myRegistrations
      : (ev.myRegistration ? [ev.myRegistration] : []);

    if (myRegs.length > 0) {
      const regItems = myRegs.map(reg => {
        const myPlace = Number(reg.desiredPlace) || 0;
        const placeLabel = myPlace === 0 ? 'Любое подходящее' : (placeInfo(et, myPlace, ev.dateFrom)?.label || `Место ${myPlace}`);
        const sector = userSectors.find(s => Number(s.id) === Number(reg.playerId)) || getPlayer(reg.playerId) || { name: 'Сектор' };
        const regOff = (sector.officers || []).find(o => o.id === reg.officerId)
          || (state.players || []).flatMap(p => p.officers || []).find(o => o.id === reg.officerId)
          || (myCabinetProfile?.officers || []).find(o => o.id === reg.officerId);
        const regOfficerName = regOff ? officerLabel(regOff) : (reg.officerId || '—');
        const showSectorName = userSectors.length > 1;

        return `
          <div class="cal-reg-badge" style="margin-top:10px;padding:12px 16px;font-size:13px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
            <div>
              ${showSectorName ? `<strong>[${escapeHtml(sector.name)}]</strong> ` : ''}
              <span>✓ Подана заявка: <strong>${escapeHtml(regOfficerName)}</strong></span>
              <span class="badge badge-none" style="margin-left:6px">${escapeHtml(placeLabel)}</span>
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn-ghost btn-sm" onclick="openRegisterModal(${ev.id},${reg.playerId})">✏️ Изменить</button>
              <button class="btn-ghost btn-sm btn-danger" onclick="cancelRegistrationFromDetail(${ev.id},${reg.playerId})">✕ Отменить заявку</button>
            </div>
          </div>
        `;
      }).join('');

      const registeredSectorIds = new Set(myRegs.map(r => Number(r.playerId)));
      const hasUnregisteredSectors = userSectors.some(s => !registeredSectorIds.has(Number(s.id)));

      regBanner = `
        <div style="margin-top:14px">
          ${regItems}
          ${hasUnregisteredSectors ? `
            <div style="margin-top:10px">
              <button class="btn-ghost btn-sm" onclick="openRegisterModal(${ev.id})">+ Зарегистрировать другой сектор</button>
            </div>
          ` : ''}
        </div>
      `;
    } else {
      regBanner = `
        <div style="margin-top:14px">
          <button class="btn-primary" onclick="openRegisterModal(${ev.id})">📝 Зарегистрироваться на этот ивент</button>
        </div>
      `;
    }
  }

  const c = document.getElementById('content');
  c.innerHTML = `
    <div style="margin-bottom:20px">
      <button class="btn-ghost btn-sm" onclick="navigate('calendar')">← Календарь</button>
    </div>

    <div class="event-detail-header" style="--ev-color:${color}">
      <div class="edh-left">
        <div class="edh-name">${et?.name || '—'}</div>
        <div class="edh-dates">📅 ${formatDate(ev.dateFrom)} — ${formatDate(ev.dateTo)}</div>
        ${ev.note ? `<div class="edh-note">${ev.note}</div>` : ''}
      </div>
      <div class="edh-right">
        <span class="cal-status ${status}">${statusLabels[status]}</span>
        <div class="edh-stat">${fmtNum(ev.assignments.length)} назначений</div>
        <div class="edh-stat">Итого купонов: <strong>${fmtNum(totalCoupons)}</strong></div>
      </div>
    </div>
    ${regBanner}

    <div class="section-header" style="margin-top:24px">
      <div class="section-title">Таблица мест и назначений</div>
      <div style="display:flex;gap:8px">
        ${canManage() && isEventPast(ev) && !ev.accrued ? `<button class="btn-primary btn-sm" onclick="accrueEventRewards(${ev.id})">Начислить награды</button>` : ''}
        ${ev.accrued ? `<span class="badge badge-none">Начислено</span>` : ''}
        ${canManage() ? `<button class="btn-primary btn-sm" onclick="openEventModal(${ev.id})">✏️ Редактировать ивент</button>` : ''}
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Место</th>
            <th>Игрок</th>
            <th>Офицер</th>
            <th>Уровень</th>
            <th>Купонов</th>
          </tr>
        </thead>
        <tbody>${rows.join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:24px">Назначений нет</td></tr>'}</tbody>
      </table>
    </div>

    <div class="section-header">
      <div class="section-title">Купоны по офицерам</div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Игрок</th><th>Офицер</th><th>Уровень до</th><th>Купонов</th><th>Пазлов</th><th>Уровень после</th></tr></thead>
        <tbody>
          ${ev.assignments.map(a=>{
            const p = getPlayer(a.playerId);
            const o = p?.officers.find(x=>x.id===a.officerId);
            const pi = placeInfo(et, a.place, ev.dateFrom);
            const coupons = a.actualCoupons ?? pi?.coupons ?? 0;
            if (!o) return '';
            const after = applyEvent(o, coupons);
            const gained = after.level - o.level;
            return `<tr>
              <td><strong>${p ? playerLink(p) : '—'}</strong></td>
              <td style="color:var(--text2)">${officerLink(o)}</td>
              <td style="font-family:var(--mono)">${fmtNum(o.level)}</td>
              <td style="font-family:var(--mono);color:var(--green)">+${fmtNum(coupons)}</td>
              <td style="font-family:var(--mono);color:var(--text2)">+${fmtNum(Math.floor(coupons/COUPON_PER_PUZZLE))}</td>
              <td style="font-family:var(--mono);font-weight:600">
                ${fmtNum(after.level)}${gained>0?` <span style="color:var(--green)">(+${fmtNum(gained)})</span>`:''}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ─── EVENT REGISTRATIONS (PLAYER) ───────────────────────────
function openRegisterModal(eventId, maybeSectorId = null) {
  const ev = getEvent(eventId);
  if (!ev) return;
  const et = getEventType(ev.typeId);

  const userSectors = getUserSectors();
  if (userSectors.length === 0) {
    toast('У вас нет добавленных секторов. Сначала создайте сектор в личном кабинете!', 'warning');
    return;
  }

  regModalEventId = eventId;

  // Determine which sector to select
  let selectedSectorId = null;
  if (maybeSectorId && userSectors.some(s => Number(s.id) === Number(maybeSectorId))) {
    selectedSectorId = Number(maybeSectorId);
  } else {
    const registeredSectorIds = new Set((ev.myRegistrations || []).map(r => Number(r.playerId)));
    const unregisteredSector = userSectors.find(s => !registeredSectorIds.has(Number(s.id)));
    if (unregisteredSector) {
      selectedSectorId = Number(unregisteredSector.id);
    } else if (currentUser?.playerId && userSectors.some(s => Number(s.id) === Number(currentUser.playerId))) {
      selectedSectorId = Number(currentUser.playerId);
    } else {
      selectedSectorId = Number(userSectors[0].id);
    }
  }
  regModalSelectedSectorId = selectedSectorId;

  // Sector group visibility & selector
  const sectorGroup = document.getElementById('reg-sector-group');
  const sectorSelect = document.getElementById('reg-sector-select');
  if (sectorGroup && sectorSelect) {
    if (userSectors.length > 1) {
      sectorGroup.style.display = 'block';
      sectorSelect.innerHTML = userSectors.map(s => {
        const title = (typeof logic !== 'undefined' && logic.formatSectorTitle)
          ? logic.formatSectorTitle(s)
          : `${s.name} (VIP ${s.sector?.vipLevel || 0})`;
        return `<option value="${s.id}" ${Number(s.id) === Number(selectedSectorId) ? 'selected' : ''}>${escapeHtml(title)}</option>`;
      }).join('');
    } else {
      sectorGroup.style.display = 'none';
    }
  }

  document.getElementById('reg-event-info').innerHTML = `
    📅 Даты: <strong>${formatDate(ev.dateFrom)} — ${formatDate(ev.dateTo)}</strong> · Ивент: <strong>${escapeHtml(et?.name || '—')}</strong>
  `;

  updateRegisterModalForSector(selectedSectorId);
  openModal('modal-event-register');
}

function onRegSectorChange(sectorId) {
  regModalSelectedSectorId = Number(sectorId);
  updateRegisterModalForSector(regModalSelectedSectorId);
}

function updateRegisterModalForSector(sectorId) {
  const ev = getEvent(regModalEventId);
  if (!ev) return;
  const et = getEventType(ev.typeId);

  const userSectors = getUserSectors();
  const targetSector = userSectors.find(s => Number(s.id) === Number(sectorId))
    || getPlayer(sectorId)
    || (myCabinetProfile && Number(myCabinetProfile.id) === Number(sectorId) ? myCabinetProfile : null);

  const offSelect = document.getElementById('reg-officer-select');
  const placeSelect = document.getElementById('reg-place-select');
  const cancelBtn = document.getElementById('reg-btn-cancel');
  const submitBtn = document.getElementById('reg-btn-submit');
  const warningBox = document.getElementById('reg-warning-box');

  if (!targetSector || !targetSector.officers || !targetSector.officers.length) {
    if (offSelect) offSelect.innerHTML = '<option value="">— В секторе нет офицеров —</option>';
    if (warningBox) {
      warningBox.style.display = 'block';
      warningBox.className = 'auth-alert warning';
      warningBox.innerHTML = `⚠️ В секторе «${escapeHtml(targetSector?.name || 'Сектор')}» нет офицеров. Добавьте офицеров в личном кабинете.`;
    }
    if (submitBtn) submitBtn.disabled = true;
    if (cancelBtn) cancelBtn.style.display = 'none';
    return;
  }
  if (submitBtn) submitBtn.disabled = false;

  const existingReg = (ev.myRegistrations || []).find(r => Number(r.playerId) === Number(targetSector.id))
    || ((ev.myRegistration && Number(ev.myRegistration.playerId) === Number(targetSector.id)) ? ev.myRegistration : null);
  const isEditing = !!existingReg;

  document.getElementById('modal-event-register-title').textContent = isEditing
    ? `Изменить заявку (${escapeHtml(targetSector.name)})`
    : `Регистрация на «${et?.name || 'Ивент'}» (${escapeHtml(targetSector.name)})`;

  // populate officers
  offSelect.innerHTML = targetSector.officers.map(o => {
    const c = getCatalogOfficer(o.catalogId);
    const sel = existingReg && String(existingReg.officerId) === String(o.id);
    return `<option value="${o.id}" ${sel ? 'selected' : ''}>${escapeHtml(officerLabel(o))} (ур. ${o.level}, ${c?.type || '—'})</option>`;
  }).join('');

  // populate places
  const places = resolveEventPlaces(et, ev.dateFrom);
  let placeOptions = `<option value="0" ${existingReg && Number(existingReg.desiredPlace) === 0 ? 'selected' : ''}>Любое подходящее место (автоподбор)</option>`;

  places.forEach(p => {
    const sel = existingReg && Number(existingReg.desiredPlace) === Number(p.place);
    placeOptions += `<option value="${p.place}" ${sel ? 'selected' : ''}>${escapeHtml(p.label || `Место ${p.place}`)} (${fmtNum(p.coupons)} купонов)</option>`;
  });
  placeSelect.innerHTML = placeOptions;

  if (cancelBtn) {
    cancelBtn.style.display = isEditing ? 'inline-block' : 'none';
  }
  if (submitBtn) {
    submitBtn.textContent = isEditing ? 'Обновить заявку' : 'Подать заявку';
  }

  onRegisterModalChange();
}

function onRegisterModalChange() {
  const ev = getEvent(regModalEventId);
  if (!ev) return;
  const et = getEventType(ev.typeId);

  const userSectors = getUserSectors();
  const player = userSectors.find(s => Number(s.id) === Number(regModalSelectedSectorId))
    || getPlayer(regModalSelectedSectorId)
    || (myCabinetProfile && Number(myCabinetProfile.id) === Number(regModalSelectedSectorId) ? myCabinetProfile : null)
    || getPlayer(currentUser?.playerId)
    || myCabinetProfile;

  if (!player) return;

  const officerId = document.getElementById('reg-officer-select')?.value;
  const desiredPlace = Number(document.getElementById('reg-place-select')?.value) || 0;
  const warningBox = document.getElementById('reg-warning-box');
  if (!warningBox) return;

  const officer = (player.officers || []).find(o => o.id === officerId) || player.officers?.[0];
  if (!officer) {
    warningBox.style.display = 'none';
    return;
  }

  const cat = getCatalogOfficer(officer.catalogId);
  const def = calculateOfficerDeficit({ officer, catalogItem: cat, player, targetLevel: 180, today: ev.dateFrom });

  if (desiredPlace === 0) {
    warningBox.style.display = 'block';
    warningBox.className = 'auth-alert info';
    warningBox.innerHTML = `
      ℹ️ <strong>Любое подходящее место:</strong> алгоритм автоподбора автоматически назначит офицера на наиболее подходящее место, где награда не превысит дефицит (дефицит: <strong>${fmtNum(def.deficitCoupons)}</strong> купонов).
    `;
    return;
  }

  const pi = placeInfo(et, desiredPlace, ev.dateFrom);
  const prizeCoupons = pi?.coupons || 0;

  if (cat && Number(cat.couponPerPuzzle) === 0) {
    warningBox.style.display = 'block';
    warningBox.className = 'auth-alert warning';
    warningBox.innerHTML = `
      ⚠️ <strong>Внимание!</strong> Офицер <em>${escapeHtml(officerLabel(officer))}</em> качается исключительно золотыми пазлами. Купоны за призовое место не пойдут на прокачку уровня!
    `;
    return;
  }

  if (prizeCoupons > def.deficitCoupons) {
    const overflow = prizeCoupons - def.deficitCoupons;
    warningBox.style.display = 'block';
    warningBox.className = 'auth-alert warning';
    warningBox.innerHTML = `
      ⚠️ <strong>Внимание: возможен перерасход!</strong><br>
      Награда за ${escapeHtml(pi?.label || `место ${desiredPlace}`)} (<strong>${fmtNum(prizeCoupons)}</strong> купонов) превышает оставшийся дефицит офицера (<strong>${fmtNum(def.deficitCoupons)}</strong> купонов) на <strong>+${fmtNum(overflow)}</strong> купонов. Рекомендуется выбрать место с меньшей наградой.
    `;
  } else {
    warningBox.style.display = 'block';
    warningBox.className = 'auth-alert success';
    warningBox.innerHTML = `
      ✓ <strong>Отличный выбор!</strong> Награда (${fmtNum(prizeCoupons)} купонов) полностью покроет часть дефицита офицера (${fmtNum(def.deficitCoupons)} купонов). Перерасхода не будет.
    `;
  }
}

async function handleSubmitRegistration() {
  const eventId = regModalEventId;
  const sectorId = regModalSelectedSectorId || currentUser?.playerId;
  const officerId = document.getElementById('reg-officer-select').value;
  const desiredPlace = Number(document.getElementById('reg-place-select').value) || 0;

  if (!officerId) {
    toast('Выберите офицера для прокачки', 'error');
    return;
  }

  const btn = document.getElementById('reg-btn-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'Отправка...'; }

  try {
    await apiFetch(`/api/events/${eventId}/register`, {
      method: 'POST',
      body: { officerId, desiredPlace, sectorId }
    });
    toast('Заявка на ивент успешно сохранена!');
    closeAllModals();
    await loadDataFromServer();
    if (currentPage === 'calendar') renderCalendar();
    else if (currentPage === 'event_detail') renderEventDetail(eventId);
    else if (currentPage === 'my_cabinet') renderMyCabinet();
  } catch (err) {
    toast('Ошибка при сохранении заявки: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Подать заявку'; }
  }
}

async function handleCancelRegistration() {
  const eventId = regModalEventId;
  const sectorId = regModalSelectedSectorId || currentUser?.playerId;
  if (!confirm('Вы уверены, что хотите отменить свою заявку на этот ивент?')) return;

  try {
    const url = sectorId
      ? `/api/events/${eventId}/register?sectorId=${sectorId}`
      : `/api/events/${eventId}/register`;
    await apiFetch(url, { method: 'DELETE' });
    toast('Заявка успешно отменена', 'info');
    closeAllModals();
    await loadDataFromServer();
    if (currentPage === 'calendar') renderCalendar();
    else if (currentPage === 'event_detail') renderEventDetail(eventId);
    else if (currentPage === 'my_cabinet') renderMyCabinet();
  } catch (err) {
    toast('Ошибка отмены заявки: ' + err.message, 'error');
  }
}

async function cancelRegistrationFromDetail(eventId, sectorId = null) {
  if (!confirm('Отменить заявку на этот ивент?')) return;
  try {
    const targetSectorId = sectorId || currentUser?.playerId;
    const url = targetSectorId
      ? `/api/events/${eventId}/register?sectorId=${targetSectorId}`
      : `/api/events/${eventId}/register`;
    await apiFetch(url, { method: 'DELETE' });
    toast('Заявка отменена', 'info');
    await loadDataFromServer();
    if (currentPage === 'event_detail') {
      renderEventDetail(eventId);
    } else if (currentPage === 'calendar') {
      renderCalendar();
    }
  } catch (err) {
    toast('Ошибка отмены: ' + err.message, 'error');
  }
}

// ─── PAGE: PLAYERS ───────────────────────────────────────────
function renderPlayers() {
  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="section-header">
      <div class="section-title">Секторы альянса (${state.players.length})</div>
      ${canManage() ? `<button class="btn-primary" onclick="openPlayerModal()">+ Добавить сектор</button>` : ''}
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Сектор (База)</th><th>Владелец</th><th>Ранг</th><th>Сектор (Статы)</th><th>Офицеры</th><th>Запасы</th><th></th></tr></thead>
        <tbody>
          ${!state.players.length ? `<tr><td colspan="7" class="empty-state"><p>Нет секторов</p></td></tr>` : ''}
          ${state.players.map(p=>{
            const rewards = dailyRewards(p.sector);
            const stock = canSeeStock(p.id) ? `${fmtNum(p.stock.coupons)} куп. · ${fmtNum(p.stock.puzzles)} пазл. · ${fmtNum(p.stock.chests)} сун.` : 'Скрыто';
            const ownerHtml = p.username
              ? `<span class="badge badge-owner" title="Владелец: @${escapeHtml(p.username)}">👤 @${escapeHtml(p.username)}</span>`
              : `<span class="badge badge-no-owner">Без владельца</span>`;
            return `<tr>
              <td>
                <strong>${playerLink(p)}</strong>
                ${p.realName ? `<div style="color:var(--text3);font-size:12px">${p.realName}</div>` : ''}
              </td>
              <td>${ownerHtml}</td>
              <td><span class="badge badge-none">${p.rank}</span></td>
              <td style="color:var(--text2);font-size:12px">VIP ${fmtNum(p.sector.vipLevel)} · Конф. ${fmtNum(p.sector.confidentialityLevel)}<br>Сила ${fmtNum(p.sector.power)} · убийств ${fmtNum(p.sector.kills)} · очки ${fmtOne(p.sector.killPoints)}<br>+${fmtNum(rewards.puzzlesPerDay, 2)} пазл./день</td>
              <td>
                <div style="display:flex;flex-direction:column;gap:4px">
                  ${p.officers.map(o=>`
                    <div style="display:flex;align-items:center;gap:8px">
                      <span style="color:var(--text2);font-size:12px">${officerLink(o)}</span>
                      <span class="badge badge-none" style="font-size:10px">Ур. ${fmtNum(o.level)}</span>
                      <span style="font-size:11px;color:var(--text3)">${fmtNum(o.coupons)} купонов</span>
                      ${renderStars(o.stars)}
                    </div>`).join('')}
                </div>
              </td>
              <td style="font-family:var(--mono);font-size:12px">${stock}</td>
              <td>
                <div style="display:flex;gap:4px">
                  ${canManage() || state.currentPlayerId === p.id ? `<button class="action-btn" onclick="openPlayerModal(${p.id})">✏️</button>` : ''}
                  ${canManage() ? `<button class="action-btn danger" onclick="confirmDeletePlayer(${p.id})">🗑</button>` : ''}
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderStars(count = 0) {
  const c = Math.max(0, Math.min(6, Number(count) || 0));
  const fullHint = renderOfficerStarHintText(c);
  return `<span class="stars" data-tooltip="${fullHint}" title="${fullHint}">${Array.from({length: 6}, (_, i) => {
    const star = i + 1;
    const cost = starCostFor(star);
    const label = star < 6 ? `До ${star}★: ${fmtNum(cost)} звёзд` : `Итого ${fmtNum(cost)} звёзд (6★ макс)`;
    return `<span class="star-readonly ${c >= star ? 'active' : ''}" data-tooltip="${label}" title="${label}">${c >= star ? '★' : '☆'}</span>`;
  }).join('')}</span>`;
}

function renderPlayerDetail(playerId) {
  const p = getPlayer(playerId);
  if (!p) { navigate('players'); return; }
  const rewards = dailyRewards(p.sector);
  const history = state.stockHistory.filter(h=>h.playerId===p.id).slice(-8).reverse();
  const stockVisible = canSeeStock(p.id);
  const isOwner = currentUser && p.userId !== undefined && p.userId !== null && Number(p.userId) === Number(currentUser.id);
  const canEditSector = canManage() || isOwner || state.currentPlayerId === p.id;
  const ownerBadge = p.username
    ? `<span class="badge badge-owner" title="Владелец: @${escapeHtml(p.username)}">👤 Владелец: @${escapeHtml(p.username)}</span>`
    : `<span class="badge badge-no-owner">Без владельца</span>`;
  const changeOwnerBtn = canManage()
    ? `<button class="btn btn-secondary btn-sm" onclick="openChangeSectorOwnerModal(${p.id})">Изменить владельца</button>`
    : '';

  const c = document.getElementById('content');
  c.innerHTML = `
    <div style="margin-bottom:20px">
      <button class="btn-ghost btn-sm" onclick="navigate('players')">← Секторы</button>
    </div>
    <div class="section-header">
      <div>
        <div class="section-title">${escapeHtml(p.name)} ${p.realName ? `<span style="color:var(--text3)">· ${escapeHtml(p.realName)}</span>` : ''} <span class="player-meta-pill">VIP ${fmtNum(p.sector.vipLevel)}</span> <span class="player-meta-pill">Конф. ${fmtNum(p.sector.confidentialityLevel)}</span> <span class="player-meta-pill">Сила ${fmtNum(p.sector.power)}</span></div>
        <div style="color:var(--text3);font-size:12px;margin-top:4px">Ранг ${p.rank} · убито ${fmtNum(p.sector.kills)} · очки за убийство ${fmtOne(p.sector.killPoints)}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
          ${ownerBadge}
          ${changeOwnerBtn}
        </div>
      </div>
      ${canEditSector ? `<button class="btn-primary btn-sm" onclick="openPlayerModal(${p.id})">Редактировать</button>` : ''}
    </div>
    ${stockVisible ? `
      <div class="section-header">
        <div class="section-title">📦 Запасы сектора</div>
        ${canEditSector ? `<span style="font-size:12px;color:var(--text3);font-weight:normal">💡 Кликните на плашку для быстрого изменения</span>` : ''}
      </div>
      <div class="stock-grid" id="sector-stock-grid-wrap-${p.id}" style="margin-bottom:20px">
        ${renderSectorStockGridHtml(p, canEditSector)}
      </div>
    ` : `<div class="empty-state"><p>Запасы скрыты для роли ${state.currentRole}</p></div>`}
    <div class="section-header">
      <div class="section-title">Офицеры сектора (${(p.officers || []).length})</div>
      ${canEditSector ? `<button class="btn-primary btn-sm" onclick="openAddSectorOfficerModal(${p.id})">+ Добавить офицера</button>` : ''}
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Офицер</th><th>Тип</th><th>Поколение</th><th>Уровень</th><th>Звёзды</th><th>Навыки</th><th>До максимума</th><th>Действия</th></tr></thead>
        <tbody>
          ${!(p.officers || []).length ? `<tr><td colspan="8" class="empty-state">Нет офицеров в этом секторе</td></tr>` : ''}
          ${(p.officers || []).map(o => {
            const cat = getCatalogOfficer(o.catalogId);
            const forecast = forecastOfficer({ today: new Date().toISOString().slice(0, 10), officer: o, player: p, officerCatalog: state.officerCatalog, events: state.events, eventTypes: state.eventTypes });
            const skills = Array.isArray(o.skills) && o.skills.length === 4 ? o.skills : [1, 1, 1, 1];
            const skillsBadge = `<span class="badge badge-info" style="font-family:var(--mono);font-size:11px">[${skills.join('-')}]</span>`;
            const starsHtml = canEditSector ? renderSectorOfficerStars(p.id, o.id, o.stars) : renderStars(o.stars);
            const actionsHtml = canEditSector ? `
              <div style="display:flex;gap:4px">
                <button class="action-btn" title="Редактировать" onclick="openEditSectorOfficerModal(${p.id}, '${o.id}')">✏️</button>
                <button class="action-btn danger" title="Удалить" onclick="confirmDeleteSectorOfficer(${p.id}, '${o.id}')">🗑️</button>
              </div>
            ` : '—';
            return `<tr>
              <td><strong>${officerLink(o)}</strong></td>
              <td>${cat ? troopBadge(cat.type) : '—'}</td>
              <td style="font-family:var(--mono)">${cat ? fmtNum(cat.generation) : '—'}</td>
              <td style="font-family:var(--mono)">${fmtNum(o.level)}</td>
              <td id="sector-officer-stars-cell-${o.id}">${starsHtml}</td>
              <td>${skillsBadge}</td>
              <td>${forecast.date || 'за пределами прогноза'}</td>
              <td>${actionsHtml}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div class="section-header"><div class="section-title">История корректировок</div></div>
    <div class="table-wrap">
      <table><thead><tr><th>Дата</th><th>Было</th><th>Стало</th></tr></thead><tbody>
        ${history.map(h=>`<tr><td>${formatDate(h.date.slice(0,10))}</td><td>${fmtNum(h.before.coupons)}/${fmtNum(h.before.puzzles)}/${fmtNum(h.before.chests)}</td><td>${fmtNum(h.after.coupons)}/${fmtNum(h.after.puzzles)}/${fmtNum(h.after.chests)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty-state">Нет корректировок</td></tr>'}
      </tbody></table>
    </div>
  `;
}

let sectorInlineEditing = { playerId: null, key: null };

function renderSectorStockGridHtml(p, canEditSector) {
  const st = p.stock || {};
  const starPts = (typeof logic !== 'undefined' && logic.calculateTotalStarPoints) ? logic.calculateTotalStarPoints(st) : 0;
  const rewards = dailyRewards(p.sector);
  const pid = p.id;
  const isEditing = (k) => canEditSector && sectorInlineEditing.playerId === pid && sectorInlineEditing.key === k;

  const cards = [];

  // 1. Coupons
  if (isEditing('coupons')) {
    cards.push(`
      <div class="stock-card stock-card-editing" id="card-sector-coupons-${pid}" onclick="event.stopPropagation()">
        <div class="label">🎟️ Купон офицера</div>
        <div class="stock-inline-edit-wrap">
          <input type="number" class="stock-inline-input" id="input-sector-coupons-${pid}" min="0" value="${st.coupons || 0}" onkeydown="handleSectorInlineKey(event, ${pid}, 'coupons')">
          <div class="stock-inline-actions">
            <button type="button" class="btn-primary btn-xs" onclick="saveSectorInline(${pid}, 'coupons')" title="Сохранить (Enter)">✓</button>
            <button type="button" class="btn-ghost btn-xs" onclick="closeSectorInline(${pid})" title="Отмена (Esc)">✕</button>
          </div>
        </div>
      </div>
    `);
  } else {
    cards.push(`
      <div class="stock-card ${canEditSector ? 'stock-card-clickable' : ''}" id="card-sector-coupons-${pid}" ${canEditSector ? `onclick="openSectorInline(${pid}, 'coupons')" title="Нажмите для изменения купонов"` : ''}>
        ${canEditSector ? '<span class="stock-card-edit-hint">✏️</span>' : ''}
        <div class="label">🎟️ Купон офицера</div>
        <div class="value">${fmtNum(st.coupons)}</div>
      </div>
    `);
  }

  // 2. Puzzles
  if (isEditing('puzzles')) {
    cards.push(`
      <div class="stock-card stock-card-editing" id="card-sector-puzzles-${pid}" onclick="event.stopPropagation()">
        <div class="label">🧩 Медаль офицера</div>
        <div class="stock-inline-edit-wrap">
          <input type="number" class="stock-inline-input" id="input-sector-puzzles-${pid}" min="0" value="${st.puzzles || 0}" onkeydown="handleSectorInlineKey(event, ${pid}, 'puzzles')">
          <div class="stock-inline-actions">
            <button type="button" class="btn-primary btn-xs" onclick="saveSectorInline(${pid}, 'puzzles')" title="Сохранить (Enter)">✓</button>
            <button type="button" class="btn-ghost btn-xs" onclick="closeSectorInline(${pid})" title="Отмена (Esc)">✕</button>
          </div>
        </div>
      </div>
    `);
  } else {
    cards.push(`
      <div class="stock-card ${canEditSector ? 'stock-card-clickable' : ''}" id="card-sector-puzzles-${pid}" ${canEditSector ? `onclick="openSectorInline(${pid}, 'puzzles')" title="Нажмите для изменения медалей"` : ''}>
        ${canEditSector ? '<span class="stock-card-edit-hint">✏️</span>' : ''}
        <div class="label">🧩 Медаль офицера</div>
        <div class="value">${fmtNum(st.puzzles)}</div>
      </div>
    `);
  }

  // 3. Chests (Moved before stars)
  if (isEditing('chests')) {
    cards.push(`
      <div class="stock-card stock-card-editing" id="card-sector-chests-${pid}" onclick="event.stopPropagation()">
        <div class="label">📦 Сундук выбора</div>
        <div class="stock-inline-edit-wrap">
          <input type="number" class="stock-inline-input" id="input-sector-chests-${pid}" min="0" value="${st.chests || 0}" onkeydown="handleSectorInlineKey(event, ${pid}, 'chests')">
          <div class="stock-inline-actions">
            <button type="button" class="btn-primary btn-xs" onclick="saveSectorInline(${pid}, 'chests')" title="Сохранить (Enter)">✓</button>
            <button type="button" class="btn-ghost btn-xs" onclick="closeSectorInline(${pid})" title="Отмена (Esc)">✕</button>
          </div>
        </div>
      </div>
    `);
  } else {
    cards.push(`
      <div class="stock-card ${canEditSector ? 'stock-card-clickable' : ''}" id="card-sector-chests-${pid}" ${canEditSector ? `onclick="openSectorInline(${pid}, 'chests')" title="Нажмите для изменения сундуков"` : ''}>
        ${canEditSector ? '<span class="stock-card-edit-hint">✏️</span>' : ''}
        <div class="label">📦 Сундук выбора</div>
        <div class="value">${fmtNum(st.chests)}</div>
      </div>
    `);
  }

  // 4. Daily rewards
  cards.push(`
    <div class="stock-card"><div class="label">Ежедневно</div><div class="value">+${fmtNum(rewards.puzzlesPerDay, 2)}</div></div>
  `);

  // 5. Star Coupons (Stars placed last)
  if (isEditing('starCoupons')) {
    cards.push(`
      <div class="stock-card stock-card-editing" id="card-sector-star-coupons-${pid}" onclick="event.stopPropagation()">
        <div class="label">⭐ Купон звезды</div>
        <div class="stock-inline-edit-wrap">
          <input type="number" class="stock-inline-input" id="input-sector-star-coupons-${pid}" min="0" value="${st.starCoupons || 0}" onkeydown="handleSectorInlineKey(event, ${pid}, 'starCoupons')">
          <div class="stock-inline-actions">
            <button type="button" class="btn-primary btn-xs" onclick="saveSectorInline(${pid}, 'starCoupons')" title="Сохранить (Enter)">✓</button>
            <button type="button" class="btn-ghost btn-xs" onclick="closeSectorInline(${pid})" title="Отмена (Esc)">✕</button>
          </div>
        </div>
      </div>
    `);
  } else {
    cards.push(`
      <div class="stock-card ${canEditSector ? 'stock-card-clickable' : ''}" id="card-sector-star-coupons-${pid}" ${canEditSector ? `onclick="openSectorInline(${pid}, 'starCoupons')" title="Нажмите для изменения купонов звезды"` : ''}>
        ${canEditSector ? '<span class="stock-card-edit-hint">✏️</span>' : ''}
        <div class="label">⭐ Купон звезды</div>
        <div class="value">${fmtNum(st.starCoupons || 0)}</div>
      </div>
    `);
  }

  // 6. Legendary Stars I / II / III
  if (isEditing('stars')) {
    cards.push(`
      <div class="stock-card stock-card-editing" id="card-sector-stars-${pid}" onclick="event.stopPropagation()">
        <div class="label">🌟 Звезды I (110) / II (420) / III (960)</div>
        <div class="stock-inline-stars-row">
          <div class="stock-inline-star-col">
            <span class="stock-star-sublabel">I (110):</span>
            <input type="number" class="stock-inline-input" id="input-sector-stars-1-${pid}" min="0" value="${st.legendaryStars1 || 0}" onkeydown="handleSectorInlineKey(event, ${pid}, 'stars')" oninput="updateSectorLiveStars(${pid})">
          </div>
          <div class="stock-inline-star-col">
            <span class="stock-star-sublabel">II (420):</span>
            <input type="number" class="stock-inline-input" id="input-sector-stars-2-${pid}" min="0" value="${st.legendaryStars2 || 0}" onkeydown="handleSectorInlineKey(event, ${pid}, 'stars')" oninput="updateSectorLiveStars(${pid})">
          </div>
          <div class="stock-inline-star-col">
            <span class="stock-star-sublabel">III (960):</span>
            <input type="number" class="stock-inline-input" id="input-sector-stars-3-${pid}" min="0" value="${st.legendaryStars3 || 0}" onkeydown="handleSectorInlineKey(event, ${pid}, 'stars')" oninput="updateSectorLiveStars(${pid})">
          </div>
        </div>
        <div class="stock-inline-actions" style="margin-top:8px">
          <button type="button" class="btn-primary btn-xs" onclick="saveSectorInline(${pid}, 'stars')" title="Сохранить звёзды (Enter)">✓ Сохранить</button>
          <button type="button" class="btn-ghost btn-xs" onclick="closeSectorInline(${pid})" title="Отмена (Esc)">✕ Отмена</button>
        </div>
      </div>
    `);
  } else {
    cards.push(`
      <div class="stock-card ${canEditSector ? 'stock-card-clickable' : ''}" id="card-sector-stars-${pid}" ${canEditSector ? `onclick="openSectorInline(${pid}, 'stars')" title="Нажмите для изменения звёзд"` : ''}>
        ${canEditSector ? '<span class="stock-card-edit-hint">✏️</span>' : ''}
        <div class="label">🌟 Звезды I / II / III</div>
        <div class="value" style="font-size:14px;font-family:var(--mono)">${fmtNum(st.legendaryStars1 || 0)} / ${fmtNum(st.legendaryStars2 || 0)} / ${fmtNum(st.legendaryStars3 || 0)}</div>
      </div>
    `);
  }

  // 7. Star Points (Calculation Badge - Placed last)
  cards.push(`
    <div class="stock-card ${canEditSector ? 'stock-card-clickable' : ''}" id="card-sector-star-points-${pid}" ${canEditSector ? `onclick="openSectorInline(${pid}, 'stars')" title="Нажмите для перехода к звёздам"` : ''}>
      ${canEditSector ? '<span class="stock-card-edit-hint">✏️</span>' : ''}
      <div class="label">✨ Очки звезд</div>
      <div class="value" id="val-sector-star-points-${pid}" style="color:#f1e05a">${fmtNum(starPts)}</div>
    </div>
  `);

  return cards.join('');
}

function openSectorInline(playerId, key) {
  sectorInlineEditing = { playerId, key };
  const wrap = document.getElementById(`sector-stock-grid-wrap-${playerId}`);
  const p = getPlayer(playerId);
  if (!wrap || !p) return;
  wrap.innerHTML = renderSectorStockGridHtml(p, true);

  setTimeout(() => {
    if (key === 'stars') {
      const el = document.getElementById(`input-sector-stars-1-${playerId}`);
      if (el) { el.focus(); el.select(); }
    } else {
      const el = document.getElementById(`input-sector-${key === 'starCoupons' ? 'star-coupons' : key}-${playerId}`);
      if (el) { el.focus(); el.select(); }
    }
  }, 10);
}

function closeSectorInline(playerId) {
  sectorInlineEditing = { playerId: null, key: null };
  const wrap = document.getElementById(`sector-stock-grid-wrap-${playerId}`);
  const p = getPlayer(playerId);
  if (!wrap || !p) return;
  wrap.innerHTML = renderSectorStockGridHtml(p, true);
}

function handleSectorInlineKey(e, playerId, key) {
  if (e.key === 'Enter') {
    e.preventDefault();
    saveSectorInline(playerId, key);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeSectorInline(playerId);
  }
}

function updateSectorLiveStars(playerId) {
  const s1 = Math.max(0, parseInt(document.getElementById(`input-sector-stars-1-${playerId}`)?.value) || 0);
  const s2 = Math.max(0, parseInt(document.getElementById(`input-sector-stars-2-${playerId}`)?.value) || 0);
  const s3 = Math.max(0, parseInt(document.getElementById(`input-sector-stars-3-${playerId}`)?.value) || 0);
  const total = s1 * 110 + s2 * 420 + s3 * 960;
  const ptsEl = document.getElementById(`val-sector-star-points-${playerId}`);
  if (ptsEl) ptsEl.textContent = fmtNum(total);
}

async function saveSectorInline(playerId, key) {
  const p = getPlayer(playerId);
  if (!p) return;
  const before = { ...p.stock };
  const stock = { ...p.stock };

  if (key === 'coupons') {
    stock.coupons = Math.max(0, parseInt(document.getElementById(`input-sector-coupons-${playerId}`)?.value) || 0);
  } else if (key === 'puzzles') {
    stock.puzzles = Math.max(0, parseInt(document.getElementById(`input-sector-puzzles-${playerId}`)?.value) || 0);
  } else if (key === 'starCoupons') {
    stock.starCoupons = Math.max(0, parseInt(document.getElementById(`input-sector-star-coupons-${playerId}`)?.value) || 0);
  } else if (key === 'chests') {
    stock.chests = Math.max(0, parseInt(document.getElementById(`input-sector-chests-${playerId}`)?.value) || 0);
  } else if (key === 'stars') {
    stock.legendaryStars1 = Math.max(0, parseInt(document.getElementById(`input-sector-stars-1-${playerId}`)?.value) || 0);
    stock.legendaryStars2 = Math.max(0, parseInt(document.getElementById(`input-sector-stars-2-${playerId}`)?.value) || 0);
    stock.legendaryStars3 = Math.max(0, parseInt(document.getElementById(`input-sector-stars-3-${playerId}`)?.value) || 0);
  }

  p.stock = stock;
  state.stockHistory.push({ id: state.nextId++, playerId, date: new Date().toISOString(), before, after: stock });
  if (typeof save === 'function') save();

  try {
    await apiFetch(`/api/players/${playerId}`, {
      method: 'PUT',
      body: { stock }
    });
  } catch (_) {}

  sectorInlineEditing = { playerId: null, key: null };
  toast('✓ Запасы обновлены');
  renderPlayerDetail(playerId);
}

function openSectorStockEdit(fieldKey) {
  const pId = state.selectedPlayerId || (state.players && state.players[0] && state.players[0].id);
  if (pId) openSectorInline(pId, fieldKey === 'legendaryStars1' || fieldKey === 'legendaryStars2' || fieldKey === 'legendaryStars3' ? 'stars' : fieldKey);
}
function closeSectorStockEdit() {
  const pId = state.selectedPlayerId || (state.players && state.players[0] && state.players[0].id);
  if (pId) closeSectorInline(pId);
}
function toggleSectorStockEdit() {
  const pId = state.selectedPlayerId || (state.players && state.players[0] && state.players[0].id);
  if (!pId) return;
  if (sectorInlineEditing.playerId === pId && sectorInlineEditing.key) closeSectorInline(pId);
  else openSectorInline(pId, 'coupons');
}

function saveStockCorrection(playerId) {
  const p = getPlayer(playerId);
  const before = {...p.stock};
  const after = {
    coupons: Math.max(0,parseInt(document.getElementById('stock-coupons')?.value)||0),
    puzzles: Math.max(0,parseInt(document.getElementById('stock-puzzles')?.value)||0),
    starCoupons: Math.max(0,parseInt(document.getElementById('stock-star-coupons')?.value)||0),
    legendaryStars1: Math.max(0,parseInt(document.getElementById('stock-legendary-stars-1')?.value)||0),
    legendaryStars2: Math.max(0,parseInt(document.getElementById('stock-legendary-stars-2')?.value)||0),
    legendaryStars3: Math.max(0,parseInt(document.getElementById('stock-legendary-stars-3')?.value)||0),
    chests: Math.max(0,parseInt(document.getElementById('stock-chests')?.value)||0),
  };
  p.stock = after;
  state.stockHistory.push({ id:state.nextId++, playerId, date:new Date().toISOString(), before, after });
  save(); toast('Запасы обновлены'); renderPlayerDetail(playerId);
}

function rollbackLastStock(playerId) {
  const idx = state.stockHistory.map((h,i)=>h.playerId===playerId?i:-1).filter(i=>i>=0).pop();
  if (idx === undefined) { toast('Нет корректировок','error'); return; }
  const h = state.stockHistory[idx];
  getPlayer(playerId).stock = h.before;
  state.stockHistory.splice(idx,1);
  save(); toast('Откат выполнен','info'); renderPlayerDetail(playerId);
}

// ─── SECTOR OFFICERS & OWNER MANAGEMENT ────────────────────────
let addSectorOfficerPlayerId = null;
let asoSelectedStars = 0;
let asoSelectedSkills = [1, 1, 1, 1];

let editSectorOfficerPlayerId = null;
let editSectorOfficerId = null;
let soSelectedStars = 0;
let soSelectedSkills = [1, 1, 1, 1];

let changeOwnerSectorId = null;

function onTableStarHover(officerId, star) {
  const el = document.getElementById(`table-star-hint-${officerId}`);
  if (!el) return;
  const cost = starCostFor(star);
  el.innerHTML = `<span class="star-hint-badge-mini hover">✨ До <strong>${star}★</strong>: <strong>${fmtNum(cost)}</strong></span>`;
}

function onTableStarLeave(officerId, currentStars) {
  const el = document.getElementById(`table-star-hint-${officerId}`);
  if (!el) return;
  el.innerHTML = `<span class="star-hint-badge-mini">${renderOfficerStarHintText(currentStars)}</span>`;
}

function renderSectorOfficerStars(playerId, officerId, count = 0) {
  const currentStars = Number(count) || 0;
  const buttonsHtml = Array.from({length: 6}, (_, i) => {
    const star = i + 1;
    const cost = starCostFor(star);
    const label = star < 6 ? `До ${star}★: ${fmtNum(cost)} звёзд` : `Итого ${fmtNum(cost)} звёзд (6★ макс)`;
    const newStars = currentStars === star ? star - 1 : star;
    return `<button type="button" class="star-btn ${currentStars >= star ? 'active' : ''}" data-tooltip="${label}" title="${label}" aria-label="${label}" onmouseenter="onTableStarHover('${officerId}', ${star})" onmouseleave="onTableStarLeave('${officerId}', ${currentStars})" onclick="handleQuickChangeStars(${playerId}, '${officerId}', ${newStars})">${currentStars >= star ? '★' : '☆'}</button>`;
  }).join('');

  return `
    <div class="table-officer-stars-wrap">
      <span class="stars">${buttonsHtml}</span>
      <div class="table-star-hint" id="table-star-hint-${officerId}">
        <span class="star-hint-badge-mini">${renderOfficerStarHintText(currentStars)}</span>
      </div>
    </div>
  `;
}

async function handleQuickChangeStars(playerId, officerId, stars) {
  const s = Math.max(0, Math.min(6, parseInt(stars) || 0));
  const p = getPlayer(playerId);
  const off = p?.officers?.find(o => String(o.id) === String(officerId));
  const oldStars = off ? Number(off.stars) || 0 : 0;
  if (oldStars === s) return;

  let stockDelta = null;
  let newStock = null;

  if (p?.stock) {
    const cat = off ? getCatalogOfficer(off.catalogId) : null;
    const starCouponCost = cat?.starCouponCost || (cat?.generation === 7 ? 300 : (cat?.generation <= 6 ? 250 : 360));
    const deltaFn = (typeof logic !== 'undefined' && logic.calculateStarStockDelta) ? logic.calculateStarStockDelta : calculateStarStockDelta;
    stockDelta = deltaFn(oldStars, s, p.stock, starCouponCost);

    if (!stockDelta.canAfford) {
      toast(`❌ Недостаточно ресурсов на складе! Требуется ${fmtNum(stockDelta.points)} очков звёзд (не хватает ${fmtNum(stockDelta.deficitPoints)}).`, 'error');
      return;
    }

    newStock = {
      ...p.stock,
      starCoupons: Math.max(0, (p.stock.starCoupons || 0) + stockDelta.delta.starCoupons),
      legendaryStars1: Math.max(0, (p.stock.legendaryStars1 || 0) + stockDelta.delta.legendaryStars1),
      legendaryStars2: Math.max(0, (p.stock.legendaryStars2 || 0) + stockDelta.delta.legendaryStars2),
      legendaryStars3: Math.max(0, (p.stock.legendaryStars3 || 0) + stockDelta.delta.legendaryStars3),
    };
  }

  try {
    const res = await apiFetch(`/api/players/${playerId}/officers/${officerId}`, {
      method: 'PUT',
      body: { stars: s }
    });
    if (newStock) {
      await apiFetch(`/api/players/${playerId}`, {
        method: 'PUT',
        body: { stock: newStock }
      });
      p.stock = newStock;
    }

    if (off) {
      if (res && res.id) Object.assign(off, res);
      else off.stars = s;
    }
    if (typeof save === 'function') save();

    const cellEl = document.getElementById(`sector-officer-stars-cell-${officerId}`);
    if (cellEl) {
      cellEl.innerHTML = renderSectorOfficerStars(playerId, officerId, s);
    } else {
      renderPlayerDetail(playerId);
    }

    const actionText = stockDelta && stockDelta.delta.starCoupons < 0
      ? ` Списано: ${fmtNum(Math.abs(stockDelta.delta.starCoupons))} купонов звезды`
      : '';

    showUndoToast(`⭐ Звёзды ${escapeHtml(officerLabel(off))}: ${s}★.${actionText}`, async () => {
      await handleQuickChangeStars(playerId, officerId, oldStars);
    });
  } catch (err) {
    toast('Ошибка обновления звёзд: ' + (err.message || err), 'error');
  }
}

async function confirmDeleteSectorOfficer(playerId, officerId) {
  const p = getPlayer(playerId);
  const off = p?.officers?.find(o => String(o.id) === String(officerId));
  const cat = off ? getCatalogOfficer(off.catalogId) : null;
  const officerName = off ? (off.name || cat?.name || 'Офицер') : 'Офицер';
  const confirmed = confirm(`Удалить офицера «${officerName}» из этого сектора?`);
  if (!confirmed) return;
  try {
    await apiFetch(`/api/players/${playerId}/officers/${officerId}`, {
      method: 'DELETE'
    });
    if (p && Array.isArray(p.officers)) {
      p.officers = p.officers.filter(o => String(o.id) !== String(officerId));
    }
    if (typeof save === 'function') save();
    toast(`Офицер «${officerName}» удалён из сектора`);
    renderPlayerDetail(playerId);
  } catch (err) {
    toast('Ошибка удаления офицера: ' + (err.message || err), 'error');
  }
}

function onAsoCatalogChange(catalogId) {
  // Callback for catalog change in add modal if needed
}

function openAddSectorOfficerModal(playerId) {
  addSectorOfficerPlayerId = playerId;
  asoSelectedStars = 0;
  asoSelectedSkills = [1, 1, 1, 1];
  const p = getPlayer(playerId);
  if (!p) return;

  const existingCatalogIds = new Set((p.officers || []).map(o => o.catalogId).filter(Boolean));
  const availableOfficers = (state.officerCatalog || []).filter(co => !existingCatalogIds.has(co.id));

  if (!availableOfficers.length) {
    toast('Все офицеры из каталога уже добавлены в этот сектор', 'info');
    return;
  }

  const select = document.getElementById('aso-catalog-select');
  if (select) {
    select.innerHTML = availableOfficers.map(co => `<option value="${co.id}">${escapeHtml(co.name)} (${co.type}, Gen ${co.generation})</option>`).join('');
  }

  const lvlEl = document.getElementById('aso-level');
  if (lvlEl) lvlEl.value = 0;
  const coupEl = document.getElementById('aso-coupons');
  if (coupEl) coupEl.value = 0;

  renderAsoStarsPicker(asoSelectedStars);
  renderAsoSkillsPicker(asoSelectedSkills);
  openModal('modal-add-sector-officer');
}

function renderAsoStarsPicker(stars) {
  const container = document.getElementById('aso-stars-picker');
  if (!container) return;
  asoSelectedStars = Math.max(0, Math.min(6, parseInt(stars) || 0));
  const buttonsHtml = Array.from({length: 6}, (_, i) => {
    const s = i + 1;
    const cost = starCostFor(s);
    const label = s < 6 ? `До ${s}★: ${fmtNum(cost)} звёзд` : `Итого ${fmtNum(cost)} звёзд (6★ макс)`;
    const newStars = asoSelectedStars === s ? s - 1 : s;
    return `<button type="button" class="star-btn ${asoSelectedStars >= s ? 'active' : ''}" data-tooltip="${label}" title="${label}" aria-label="${label}" onclick="renderAsoStarsPicker(${newStars})">${asoSelectedStars >= s ? '★' : '☆'}</button>`;
  }).join('');
  const hintHtml = `<div class="star-hint-badge" style="margin-top:6px">⭐ ${renderOfficerStarHintText(asoSelectedStars)}</div>`;
  container.innerHTML = buttonsHtml + hintHtml;
}

function renderAsoSkillsPicker(skills) {
  const container = document.getElementById('aso-skills-picker');
  if (!container) return;
  asoSelectedSkills = Array.isArray(skills) && skills.length === 4 ? [...skills] : [1, 1, 1, 1];
  const medalsFn = (typeof logic !== 'undefined' && logic.calculateSkillMedalsProgress)
    ? logic.calculateSkillMedalsProgress
    : (typeof calculateSkillMedalsProgress === 'function' ? calculateSkillMedalsProgress : null);
  const progress = medalsFn ? medalsFn(asoSelectedSkills) : { spentMedals: 0, remainingMedals: 690, isMaxSkills: false };

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px;width:100%">
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-bottom:2px">
        <span style="color:var(--text2)">Навыки:</span>
        <span class="skill-progress-badge ${progress.isMaxSkills ? 'max-skills' : ''}">
          Медали: <strong>${progress.spentMedals}</strong> / 690
          ${progress.isMaxSkills ? '<span class="badge badge-success" style="font-size:10px">MAX</span>' : `<span class="skill-remaining">(-${progress.remainingMedals})</span>`}
        </span>
      </div>
      ${[0, 1, 2, 3].map(idx => `
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:12px;color:var(--text2);min-width:28px;font-weight:600">Н${idx + 1}:</span>
          <div style="display:flex;gap:4px">
            ${[1, 2, 3, 4, 5].map(lvl => `
              <button type="button" class="skill-chip-btn ${asoSelectedSkills[idx] === lvl ? 'active' : ''}" onclick="setAsoSkill(${idx}, ${lvl})">${lvl}</button>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function setAsoSkill(idx, lvl) {
  if (!Array.isArray(asoSelectedSkills) || asoSelectedSkills.length !== 4) {
    asoSelectedSkills = [1, 1, 1, 1];
  }
  asoSelectedSkills[idx] = Math.max(1, Math.min(5, Number(lvl) || 1));
  renderAsoSkillsPicker(asoSelectedSkills);
}

async function submitAddSectorOfficer() {
  if (!addSectorOfficerPlayerId) return;
  const select = document.getElementById('aso-catalog-select');
  const catalogId = select ? select.value : '';
  if (!catalogId) {
    toast('Выберите офицера из каталога', 'error');
    return;
  }
  const cat = getCatalogOfficer(catalogId);
  const level = Math.max(0, Math.min(180, parseInt(document.getElementById('aso-level')?.value) || 0));
  const coupons = Math.max(0, parseInt(document.getElementById('aso-coupons')?.value) || 0);
  const stars = Math.max(0, Math.min(6, parseInt(asoSelectedStars) || 0));
  const skills = Array.isArray(asoSelectedSkills) && asoSelectedSkills.length === 4
    ? asoSelectedSkills.map(s => Math.max(1, Math.min(5, parseInt(s) || 1)))
    : [1, 1, 1, 1];

  const payload = {
    catalogId,
    name: cat?.name || '',
    level,
    coupons,
    stars,
    skills
  };

  try {
    const res = await apiFetch(`/api/players/${addSectorOfficerPlayerId}/officers`, {
      method: 'POST',
      body: payload
    });
    const p = getPlayer(addSectorOfficerPlayerId);
    if (p) {
      p.officers = p.officers || [];
      p.officers.push(res || { id: 'o' + state.nextId++, ...payload });
    }
    if (typeof save === 'function') save();
    closeAllModals();
    toast(`Офицер «${cat?.name || ''}» добавлен в сектор`);
    renderPlayerDetail(addSectorOfficerPlayerId);
  } catch (err) {
    toast('Ошибка добавления офицера: ' + (err.message || err), 'error');
  }
}

function openEditSectorOfficerModal(playerId, officerId) {
  editSectorOfficerPlayerId = playerId;
  editSectorOfficerId = officerId;
  const p = getPlayer(playerId);
  const off = p?.officers?.find(o => String(o.id) === String(officerId));
  if (!off) {
    toast('Офицер не найден', 'error');
    return;
  }
  const cat = getCatalogOfficer(off.catalogId);
  const titleEl = document.getElementById('mso-title');
  if (titleEl) {
    titleEl.textContent = `Редактировать офицера: ${off.name || cat?.name || ''}`;
  }
  const lvlEl = document.getElementById('so-level');
  if (lvlEl) lvlEl.value = off.level || 0;
  const coupEl = document.getElementById('so-coupons');
  if (coupEl) coupEl.value = off.coupons || 0;
  soSelectedStars = off.stars || 0;
  soSelectedSkills = Array.isArray(off.skills) && off.skills.length === 4 ? [...off.skills] : [1, 1, 1, 1];

  renderSoStarsPicker(soSelectedStars);
  renderSoSkillsPicker(soSelectedSkills);
  openModal('modal-sector-officer');
}

function renderSoStarsPicker(stars) {
  const container = document.getElementById('so-stars-picker');
  if (!container) return;
  soSelectedStars = Math.max(0, Math.min(6, parseInt(stars) || 0));
  const buttonsHtml = Array.from({length: 6}, (_, i) => {
    const s = i + 1;
    const cost = starCostFor(s);
    const label = s < 6 ? `До ${s}★: ${fmtNum(cost)} звёзд` : `Итого ${fmtNum(cost)} звёзд (6★ макс)`;
    const newStars = soSelectedStars === s ? s - 1 : s;
    return `<button type="button" class="star-btn ${soSelectedStars >= s ? 'active' : ''}" data-tooltip="${label}" title="${label}" aria-label="${label}" onclick="renderSoStarsPicker(${newStars})">${soSelectedStars >= s ? '★' : '☆'}</button>`;
  }).join('');
  const hintHtml = `<div class="star-hint-badge" style="margin-top:6px">⭐ ${renderOfficerStarHintText(soSelectedStars)}</div>`;
  container.innerHTML = buttonsHtml + hintHtml;
}

function renderSoSkillsPicker(skills) {
  const container = document.getElementById('so-skills-picker');
  if (!container) return;
  soSelectedSkills = Array.isArray(skills) && skills.length === 4 ? [...skills] : [1, 1, 1, 1];
  const medalsFn = (typeof logic !== 'undefined' && logic.calculateSkillMedalsProgress)
    ? logic.calculateSkillMedalsProgress
    : (typeof calculateSkillMedalsProgress === 'function' ? calculateSkillMedalsProgress : null);
  const progress = medalsFn ? medalsFn(soSelectedSkills) : { spentMedals: 0, remainingMedals: 690, isMaxSkills: false };

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px;width:100%">
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-bottom:2px">
        <span style="color:var(--text2)">Навыки:</span>
        <span class="skill-progress-badge ${progress.isMaxSkills ? 'max-skills' : ''}">
          Медали: <strong>${progress.spentMedals}</strong> / 690
          ${progress.isMaxSkills ? '<span class="badge badge-success" style="font-size:10px">MAX</span>' : `<span class="skill-remaining">(-${progress.remainingMedals})</span>`}
        </span>
      </div>
      ${[0, 1, 2, 3].map(idx => `
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:12px;color:var(--text2);min-width:28px;font-weight:600">Н${idx + 1}:</span>
          <div style="display:flex;gap:4px">
            ${[1, 2, 3, 4, 5].map(lvl => `
              <button type="button" class="skill-chip-btn ${soSelectedSkills[idx] === lvl ? 'active' : ''}" onclick="setSoSkill(${idx}, ${lvl})">${lvl}</button>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function setSoSkill(idx, lvl) {
  if (!Array.isArray(soSelectedSkills) || soSelectedSkills.length !== 4) {
    soSelectedSkills = [1, 1, 1, 1];
  }
  soSelectedSkills[idx] = Math.max(1, Math.min(5, Number(lvl) || 1));
  renderSoSkillsPicker(soSelectedSkills);
}

async function submitEditSectorOfficer() {
  if (!editSectorOfficerPlayerId || !editSectorOfficerId) return;
  const level = Math.max(0, Math.min(180, parseInt(document.getElementById('so-level')?.value) || 0));
  const coupons = Math.max(0, parseInt(document.getElementById('so-coupons')?.value) || 0);
  const stars = Math.max(0, Math.min(6, parseInt(soSelectedStars) || 0));
  const skills = Array.isArray(soSelectedSkills) && soSelectedSkills.length === 4
    ? soSelectedSkills.map(s => Math.max(1, Math.min(5, parseInt(s) || 1)))
    : [1, 1, 1, 1];

  const payload = { level, coupons, stars, skills };
  try {
    const res = await apiFetch(`/api/players/${editSectorOfficerPlayerId}/officers/${editSectorOfficerId}`, {
      method: 'PUT',
      body: payload
    });
    const p = getPlayer(editSectorOfficerPlayerId);
    if (p && Array.isArray(p.officers)) {
      const off = p.officers.find(o => String(o.id) === String(editSectorOfficerId));
      if (off) {
        if (res && res.id) Object.assign(off, res);
        else Object.assign(off, payload);
      }
    }
    if (typeof save === 'function') save();
    closeAllModals();
    toast('Офицер сохранён');
    renderPlayerDetail(editSectorOfficerPlayerId);
  } catch (err) {
    toast('Ошибка сохранения офицера: ' + (err.message || err), 'error');
  }
}

async function openChangeSectorOwnerModal(playerId) {
  changeOwnerSectorId = playerId;
  const p = getPlayer(playerId);
  if (!p) return;
  const select = document.getElementById('cso-user-select');
  if (!select) return;

  select.innerHTML = '<option value="">— Без владельца (свободная база) —</option>';
  try {
    const users = await apiFetch('/api/users');
    if (Array.isArray(users)) {
      users.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = `@${u.username} (${u.rank || 'r3'}${u.playerName ? ' · ' + u.playerName : ''})`;
        if (p.userId !== undefined && p.userId !== null && Number(u.id) === Number(p.userId)) {
          opt.selected = true;
        }
        select.appendChild(opt);
      });
    }
  } catch (err) {
    console.error('Failed to load users for owner selector:', err);
    toast('Не удалось загрузить пользователей', 'error');
  }

  openModal('modal-change-sector-owner');
}

async function submitChangeSectorOwner() {
  if (!changeOwnerSectorId) return;
  const select = document.getElementById('cso-user-select');
  const val = select ? select.value : '';
  const userId = val ? Number(val) : null;

  try {
    const res = await apiFetch(`/api/players/${changeOwnerSectorId}`, {
      method: 'PUT',
      body: { userId }
    });
    const p = getPlayer(changeOwnerSectorId);
    if (p) {
      if (res) {
        Object.assign(p, res);
      } else {
        p.userId = userId;
      }
    }
    if (typeof loadDataFromServer === 'function') {
      try {
        await loadDataFromServer();
      } catch (_) {}
    }
    closeAllModals();
    toast('Владелец сектора сохранён');
    renderPlayerDetail(changeOwnerSectorId);
  } catch (err) {
    toast('Ошибка смены владельца: ' + (err.message || err), 'error');
  }
}

// ─── PAGE: OFFICERS ──────────────────────────────────────────
function renderOfficers() {
  const c = document.getElementById('content');
  const isEmpty = !state.officerCatalog || state.officerCatalog.length === 0;

  c.innerHTML = `
    <div class="section-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:20px">
      <div>
        <div class="section-title">🎖️ Каталог офицеров (${state.officerCatalog.length})</div>
        <div style="font-size:12px;color:var(--text2);margin-top:2px">Реестр командиров альянса, параметры доподготовки, подготовки и курсы обмена</div>
      </div>
      ${canManage() ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-primary" onclick="openOfficerCatalogModal()">+ Добавить офицера</button>
          <button class="btn-secondary" onclick="openExchangeOcrModal()">📷 Распознать из магазина</button>
          <button class="btn-secondary" onclick="openVipTiersModal()">⭐ Настройка шкалы VIP</button>
        </div>
      ` : ''}
    </div>
    ${isEmpty ? `
      <div class="empty-state" style="padding:48px 20px;text-align:center;background:var(--bg2);border-radius:12px;border:1px dashed var(--border);margin-top:16px">
        <div style="font-size:42px;margin-bottom:12px">🎖️</div>
        <h3 style="margin:0 0 8px;font-size:18px">Каталог офицеров пуст</h3>
        <p style="color:var(--text2);margin:0 0 16px;max-width:440px;margin-inline:auto">Добавьте офицеров вручную или загрузите скриншот из игрового магазина обмена медалей.</p>
        ${canManage() ? `
          <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
            <button class="btn-primary" onclick="openOfficerCatalogModal()">+ Добавить офицера</button>
            <button class="btn-secondary" onclick="openExchangeOcrModal()">📷 Распознать из магазина</button>
          </div>
        ` : ''}
      </div>
    ` : `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Офицер</th>
              <th>Тип войск</th>
              <th>Сезон</th>
              <th>Купонов на медаль</th>
              <th>Купонов за 110★</th>
              <th>До подготовки</th>
              <th>Подготовка</th>
              <th>Всего медалей</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${state.officerCatalog.map(o => {
            const b = o.medalsBeforeTraining ?? 480;
            const t = o.medalsTraining ?? 900;
            const total = o.medalsTotal ?? (b + t);
            return `<tr>
              <td><strong>${catalogOfficerLink(o)}</strong></td>
              <td>${troopBadge(o.type)}</td>
              <td><span class="badge badge-none" style="font-weight:700">S${fmtNum(o.generation || 8)}</span></td>
              <td style="font-family:var(--mono)">${fmtNum(o.couponPerPuzzle ?? 720)}</td>
              <td style="font-family:var(--mono)">${fmtNum(o.starCouponCost ?? 360)}</td>
              <td style="font-family:var(--mono)">${fmtNum(b)}</td>
              <td style="font-family:var(--mono)">${fmtNum(t)}</td>
              <td style="font-family:var(--mono);font-weight:700;color:var(--primary)">${fmtNum(total)}</td>
              <td>
                <div style="display:flex;gap:4px">
                  ${canManage() ? `<button class="action-btn" title="Редактировать" onclick="openOfficerCatalogModal('${o.id}')">✏️</button><button class="action-btn danger" title="Удалить" onclick="confirmDeleteOfficerCatalog('${o.id}')">🗑️</button>` : '—'}
                </div>
              </td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
    `}
  `;
}

function renderOfficerDetail(catalogId) {
  const officer = getCatalogOfficer(catalogId);
  if (!officer) { navigate('officers'); return; }
  const users = officerUsage(catalogId, state.players);
  const eventRows = [];
  state.events.forEach(ev => {
    const et = getEventType(ev.typeId);
    ev.assignments.forEach(a => {
      const p = getPlayer(a.playerId);
      const po = p?.officers.find(o=>o.id===a.officerId && o.catalogId===catalogId);
      if (!p || !po) return;
      const pi = placeInfo(et, a.place, ev.dateFrom);
      eventRows.push({ ev, et, p, po, pi, coupons:a.actualCoupons ?? pi?.coupons ?? 0 });
    });
  });

  const upgradeBadge = (officer.upgradeType === 'special' || officer.couponPerPuzzle === 0)
    ? `<span class="badge badge-warning">Только пазлы</span>`
    : `<span class="badge badge-info">Купонный 500/1</span>`;

  const pairingsFn = (typeof logic !== 'undefined' && logic.getRecommendedPairings)
    ? logic.getRecommendedPairings
    : (typeof getRecommendedPairings === 'function' ? getRecommendedPairings : null);
  const pairings = pairingsFn ? pairingsFn(officer.id) : [];

  document.getElementById('content').innerHTML = `
    <div style="margin-bottom:20px">
      <button class="btn-ghost btn-sm" onclick="navigate('officers')">← Офицеры</button>
    </div>
    <div class="section-header">
      <div>
        <div class="section-title">${officer.name}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
          ${troopBadge(officer.type)}
          ${upgradeBadge}
          <span style="color:var(--text3);font-size:12px">поколение ${fmtNum(officer.generation)} · ${officer.couponPerPuzzle === 0 ? 'только пазлы' : `${fmtNum(officer.couponPerPuzzle)} купонов за пазл`}</span>
        </div>
      </div>
      ${canManage()?`<div style="display:flex;gap:8px"><button class="btn-primary btn-sm" onclick="openOfficerCatalogModal('${officer.id}')">Редактировать</button><button class="btn-danger btn-sm" onclick="confirmDeleteOfficerCatalog('${officer.id}')">Удалить</button></div>`:''}
    </div>
    <div class="stock-grid">
      <div class="stock-card"><div class="label">Медали до подготовки</div><div class="value">${fmtNum(officer.medalsBeforeTraining)}</div></div>
      <div class="stock-card"><div class="label">Медали подготовки</div><div class="value">${fmtNum(officer.medalsTraining)}</div></div>
      <div class="stock-card"><div class="label">Всего медалей</div><div class="value">${fmtNum(officer.medalsTotal)}</div></div>
    </div>

    <!-- Рекомендуемые связки командиров -->
    <div class="section-header" style="margin-top:24px">
      <div class="section-title">⚔️ Рекомендуемые связки командиров</div>
    </div>
    ${pairings.length ? `
      <div class="pairings-grid">
        ${pairings.map(pair => `
          <div class="pairing-card">
            <div class="pairing-header">
              <span class="pairing-name">${escapeHtml(pair.partnerName)}</span>
              <span class="badge badge-role">${escapeHtml(pair.role)}</span>
            </div>
            <div class="pairing-synergy">${escapeHtml(pair.synergy)}</div>
          </div>
        `).join('')}
      </div>
    ` : `
      <div class="empty-state" style="padding:16px;background:var(--bg2);border:1px dashed var(--border);border-radius:var(--radius)">
        <p>Для данного офицера ещё нет связок в справочнике мета-связок.</p>
      </div>
    `}

    <div class="section-header" style="margin-top:24px"><div class="section-title">Игроки, которые качают офицера</div></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Игрок</th><th>Уровень</th><th>Купоны</th><th>Звезды</th><th>Запасы</th><th>Прогноз</th></tr></thead>
        <tbody>${users.flatMap(p=>p.officers.filter(o=>o.catalogId===catalogId).map(o=>{
          const f = forecastOfficer({ today:new Date().toISOString().slice(0,10), officer:o, player:p, officerCatalog:state.officerCatalog });
          return `<tr><td><strong>${playerLink(p)}</strong></td><td>${fmtNum(o.level)}</td><td>${fmtNum(o.coupons)}</td><td>${renderStars(o.stars)}</td><td>${canSeeStock(p.id)?`${fmtNum(p.stock.coupons)}/${fmtNum(p.stock.puzzles)}/${fmtNum(p.stock.chests)}`:'Скрыто'}</td><td>${f.date || 'за пределами прогноза'}</td></tr>`;
        })).join('') || '<tr><td colspan="6" class="empty-state">Никто не качает этого офицера</td></tr>'}</tbody>
      </table>
    </div>

    <div class="section-header" style="margin-top:24px"><div class="section-title">История участия в ивентах</div></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Ивент</th><th>Даты</th><th>Место</th><th>Игрок</th><th>Купоны</th><th>Статус</th></tr></thead>
        <tbody>${eventRows.map(row=>`<tr><td>${row.et?.name||'—'}</td><td>${formatDateShort(row.ev.dateFrom)} — ${formatDateShort(row.ev.dateTo)}</td><td>${row.pi?.label||row.pi?.place||'—'}</td><td>${playerLink(row.p)}</td><td>${fmtNum(row.coupons)}</td><td>${row.ev.accrued?'Начислено':'Не начислено'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty-state">Ивентов нет</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

// ─── PAGE: CALCULATOR ────────────────────────────────────────
let calcActiveTab = 'personal';
let calcPlayerId = null;
let calcOfficerId = null;
let calcTargetLevel = 180;
let calcPlanned = { top1: 0, top2: 0, top3: 0, top4: 0 };
let matrixFilterType = 'all';
let matrixFilterGen = 'all';
let matrixSearch = '';
let matrixSortCol = 'deficit';
let matrixSortDir = 'asc';

function setCalcTab(tab) {
  calcActiveTab = tab;
  renderCalculator();
}

function setMatrixSearch(query) {
  matrixSearch = (query || '').toLowerCase().trim();
  renderCalculator();
}

function setMatrixSort(col) {
  if (matrixSortCol === col) {
    matrixSortDir = matrixSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    matrixSortCol = col;
    matrixSortDir = 'asc';
  }
  renderCalculator();
}

function setCalcPlayer(id) {
  calcPlayerId = id ? parseInt(id) : null;
  const p = getPlayer(calcPlayerId);
  calcOfficerId = p?.officers?.[0]?.id || null;
  renderCalculator();
}

function setCalcOfficer(id) {
  calcOfficerId = id;
  renderCalculator();
}

function setCalcTargetLevel(lvl) {
  calcTargetLevel = Math.max(1, Math.min(MAX_LEVEL, parseInt(lvl) || MAX_LEVEL));
  renderCalculator();
}

function changeCalcPlanned(tier, delta) {
  calcPlanned[tier] = Math.max(0, (calcPlanned[tier] || 0) + delta);
  renderCalculator();
}

function resetCalcPlanned() {
  calcPlanned = { top1: 0, top2: 0, top3: 0, top4: 0 };
  renderCalculator();
}

function setMatrixFilterType(type) {
  matrixFilterType = type;
  renderCalculator();
}

function setMatrixFilterGen(gen) {
  matrixFilterGen = gen;
  renderCalculator();
}

function renderCalculator() {
  if (!calcPlayerId && state.players.length) {
    calcPlayerId = state.players[0].id;
  }
  const player = getPlayer(calcPlayerId);
  if (!calcOfficerId && player?.officers?.length) {
    calcOfficerId = player.officers[0].id;
  }

  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="subnav">
      <button class="subnav-btn ${calcActiveTab==='personal'?'active':''}" onclick="setCalcTab('personal')">🎯 Персональный симулятор</button>
      <button class="subnav-btn ${calcActiveTab==='matrix'?'active':''}" onclick="setCalcTab('matrix')">📊 Сводная матрица гильдии</button>
    </div>
    ${calcActiveTab === 'personal' ? renderPersonalSimulator() : renderGuildMatrix()}
  `;
}

function renderPersonalSimulator() {
  const player = getPlayer(calcPlayerId);
  if (!player) return `<div class="empty-state"><p>Нет игроков для расчета</p></div>`;
  const officer = player.officers.find(o => o.id === calcOfficerId) || player.officers[0];
  const cat = officer ? getCatalogOfficer(officer.catalogId) : null;

  if (!officer || !cat) {
    return `
      <div class="form-row" style="margin-bottom:20px">
        <div class="form-group">
          <label>Игрок</label>
          <select onchange="setCalcPlayer(this.value)">
            ${state.players.map(p => `<option value="${p.id}" ${p.id===calcPlayerId?'selected':''}>${p.name}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="empty-state"><p>У игрока нет офицеров</p></div>
    `;
  }

  const today = new Date().toISOString().slice(0, 10);
  const def = calculateOfficerDeficit({
    officer,
    catalogItem: cat,
    player,
    targetLevel: calcTargetLevel,
    today,
  });

  const et = state.eventTypes[0];
  const resolvedPlaces = et ? resolveEventPlaces(et, today) : [];
  const top1Coupons = resolvedPlaces.find(p => p.place === 1)?.coupons || 12500;
  const top2Coupons = resolvedPlaces.find(p => p.place === 2)?.coupons || 6500;
  const top3Coupons = resolvedPlaces.find(p => p.place === 3)?.coupons || 3500;
  const top4Coupons = resolvedPlaces.find(p => p.place >= 4)?.coupons || 2750;

  const sim = simulateEventProgress({
    deficitPuzzles: def.deficitPuzzles,
    costPerPuzzle: def.costPerPuzzle,
    dailyIncome: def.dailyIncome,
    plannedEvents: [
      { coupons: top1Coupons, count: calcPlanned.top1 },
      { coupons: top2Coupons, count: calcPlanned.top2 },
      { coupons: top3Coupons, count: calcPlanned.top3 },
      { coupons: top4Coupons, count: calcPlanned.top4 },
    ],
    today,
  });

  const targetPuz = calcTargetLevel * PUZZLES_PER_LEVEL;
  const currentPuzTotal = def.currentPuzzles + def.stockPuzzles;
  const progressPct = Math.min(100, Math.round((currentPuzTotal / Math.max(1, targetPuz)) * 100));
  const simProgressPct = Math.min(100, Math.round(((currentPuzTotal + sim.puzzlesFromEvents) / Math.max(1, targetPuz)) * 100));

  return `
    <div class="sim-box" style="margin-bottom:20px">
      <div class="form-row form-row-3" style="margin-bottom:16px">
        <div class="form-group">
          <label>Игрок</label>
          <select onchange="setCalcPlayer(this.value)">
            ${state.players.map(p => `<option value="${p.id}" ${p.id===calcPlayerId?'selected':''}>${p.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Офицер</label>
          <select onchange="setCalcOfficer(this.value)">
            ${player.officers.map(o => `<option value="${o.id}" ${o.id===officer.id?'selected':''}>${officerLabel(o)} (ур. ${o.level})</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Целевой уровень подготовки</label>
          <div style="display:flex;gap:6px">
            <input type="number" min="1" max="180" value="${calcTargetLevel}" onchange="setCalcTargetLevel(this.value)" style="width:80px">
            <button class="btn-ghost btn-sm" onclick="setCalcTargetLevel(60)">60</button>
            <button class="btn-ghost btn-sm" onclick="setCalcTargetLevel(120)">120</button>
            <button class="btn-ghost btn-sm" onclick="setCalcTargetLevel(180)">180</button>
          </div>
        </div>
      </div>

      <div class="stock-grid" style="margin-bottom:16px">
        <div class="stock-card">
          <div class="label">Текущий уровень</div>
          <div class="value" style="display:flex;align-items:center;gap:8px">
            <span>Ур. ${fmtNum(officer.level)} <span style="font-size:12px;color:var(--text3)">/ ${calcTargetLevel}</span></span>
            ${troopBadge(cat.type)}
          </div>
          <div style="margin-top:4px">${renderStars(officer.stars)}</div>
          <div style="font-size:11px;color:${def.starRequirement.isStarReady?'var(--green)':'var(--amber)'};margin-top:4px">
            ${def.starRequirement.isStarReady ? '★ Готов к максимальной подготовке' : '☆ Для 180 уровня требуется 6★'}
          </div>
        </div>
        <div class="stock-card">
          <div class="label">Дефицит до цели</div>
          <div class="value">${fmtNum(def.deficitPuzzles)} <span style="font-size:12px;color:var(--text3)">пазлов</span></div>
          <div style="font-size:12px;color:var(--text2);margin-top:4px">
            ${def.costPerPuzzle > 0 ? `${fmtNum(def.deficitCoupons)} купонов` : 'Только пазлы'}
          </div>
        </div>
        <div class="stock-card">
          <div class="label">Ежедневный доход</div>
          <div class="value">+${fmtNum(def.dailyIncome, 2)} <span style="font-size:12px;color:var(--text3)">пазл/день</span></div>
          <div style="font-size:11px;color:var(--text3);margin-top:4px">VIP ${player.sector.vipLevel} · Конф. ${player.sector.confidentialityLevel} · 1 сундук/день</div>
        </div>
        <div class="stock-card">
          <div class="label">Без ивентов</div>
          <div class="value" style="font-size:16px">${def.dateWithoutEvents || '—'}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:4px">
            ${def.daysWithoutEvents !== null ? `${fmtNum(def.daysWithoutEvents)} дней` : 'Недостижимо'}
          </div>
        </div>
      </div>

      <div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-bottom:4px">
          <span>Текущий прогресс подготовки</span>
          <span>${progressPct}%</span>
        </div>
        <div class="progress-container">
          <div class="progress-fill" style="width:${progressPct}%"></div>
        </div>
      </div>
    </div>

    <div class="sim-box">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div>
          <strong style="font-size:15px">Симулятор участия в будущих ивентах</strong>
          <div style="font-size:12px;color:var(--text3)">Задайте планируемые призовые места для проверки ускорения прокачки</div>
        </div>
        <button class="btn-ghost btn-sm" onclick="resetCalcPlanned()">Сбросить симуляцию</button>
      </div>

      <div class="sim-counter-grid">
        <div class="sim-counter-card">
          <div class="sim-counter-info">
            <span class="sim-counter-title">🥇 1 место</span>
            <span class="sim-counter-desc">+${fmtNum(top1Coupons)} купонов</span>
          </div>
          <div class="sim-counter-ctrl">
            <button class="sim-step-btn" onclick="changeCalcPlanned('top1', -1)">−</button>
            <span class="sim-counter-val">${calcPlanned.top1}</span>
            <button class="sim-step-btn" onclick="changeCalcPlanned('top1', 1)">+</button>
          </div>
        </div>
        <div class="sim-counter-card">
          <div class="sim-counter-info">
            <span class="sim-counter-title">🥈 2 место</span>
            <span class="sim-counter-desc">+${fmtNum(top2Coupons)} купонов</span>
          </div>
          <div class="sim-counter-ctrl">
            <button class="sim-step-btn" onclick="changeCalcPlanned('top2', -1)">−</button>
            <span class="sim-counter-val">${calcPlanned.top2}</span>
            <button class="sim-step-btn" onclick="changeCalcPlanned('top2', 1)">+</button>
          </div>
        </div>
        <div class="sim-counter-card">
          <div class="sim-counter-info">
            <span class="sim-counter-title">🥉 3 место</span>
            <span class="sim-counter-desc">+${fmtNum(top3Coupons)} купонов</span>
          </div>
          <div class="sim-counter-ctrl">
            <button class="sim-step-btn" onclick="changeCalcPlanned('top3', -1)">−</button>
            <span class="sim-counter-val">${calcPlanned.top3}</span>
            <button class="sim-step-btn" onclick="changeCalcPlanned('top3', 1)">+</button>
          </div>
        </div>
        <div class="sim-counter-card">
          <div class="sim-counter-info">
            <span class="sim-counter-title">4–10 место</span>
            <span class="sim-counter-desc">+${fmtNum(top4Coupons)} купонов</span>
          </div>
          <div class="sim-counter-ctrl">
            <button class="sim-step-btn" onclick="changeCalcPlanned('top4', -1)">−</button>
            <span class="sim-counter-val">${calcPlanned.top4}</span>
            <button class="sim-step-btn" onclick="changeCalcPlanned('top4', 1)">+</button>
          </div>
        </div>
      </div>

      <div class="sim-result-banner">
        <div>
          <div class="sim-result-title">
            Прогноз с ивентами: <strong>${sim.simulatedDate || def.dateWithoutEvents || '—'}</strong>
          </div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px">
            Остаток после ивентов: <strong>${fmtNum(sim.remainingDeficitPuzzles)}</strong> пазлов (${def.costPerPuzzle > 0 ? fmtNum(sim.remainingDeficitCoupons) + ' куп.' : 'только пазлы'})
          </div>
        </div>
        <div>
          ${sim.savedDays > 0 ? `<span class="sim-result-badge">⚡ Экономия: −${fmtNum(sim.savedDays)} дней (+${fmtNum(sim.puzzlesFromEvents)} пазл.)</span>` : `<span style="font-size:12px;color:var(--text3)">Призовые места не выбраны</span>`}
        </div>
      </div>

      <div style="margin-top:14px">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-bottom:4px">
          <span>Прогресс с учетом симулированных наград</span>
          <span>${simProgressPct}%</span>
        </div>
        <div class="progress-container">
          <div class="progress-fill green" style="width:${simProgressPct}%"></div>
        </div>
      </div>
    </div>
  `;
}

function renderGuildMatrix() {
  const rows = [];
  const types = ['all', ...OFFICER_TYPES];
  const gens = ['all', ...Array.from(new Set(state.officerCatalog.map(c => String(c.generation)).filter(Boolean))).sort((a,b)=>Number(a)-Number(b))];

  state.players.forEach(p => {
    p.officers.forEach(o => {
      const cat = getCatalogOfficer(o.catalogId);
      if (!cat) return;
      if (matrixFilterType !== 'all' && cat.type !== matrixFilterType) return;
      if (matrixFilterGen !== 'all' && String(cat.generation) !== matrixFilterGen) return;

      if (matrixSearch) {
        const pName = (p.name || '').toLowerCase();
        const oName = (o.name || cat.name || '').toLowerCase();
        if (!pName.includes(matrixSearch) && !oName.includes(matrixSearch)) return;
      }

      const def = calculateOfficerDeficit({ officer: o, catalogItem: cat, player: p, targetLevel: MAX_LEVEL, includeStock: false });
      let recBadge = '<span class="badge badge-none">4–10 место</span>';
      if (def.deficitPuzzles === 0) recBadge = '<span class="badge badge-success">Максимум ✓</span>';
      else if (def.costPerPuzzle === 0) recBadge = '<span class="badge badge-none">Только пазлы</span>';
      else if (def.deficitCoupons >= 12500) recBadge = '<span class="badge" style="background:#f59e0b22;color:#d97706">🥇 1 место</span>';
      else if (def.deficitCoupons >= 6500) recBadge = '<span class="badge" style="background:#64748b22;color:#94a3b8">🥈 2 место</span>';
      else if (def.deficitCoupons >= 3500) recBadge = '<span class="badge" style="background:#b4530922;color:#d97706">🥉 3 место</span>';

      rows.push({
        player: p,
        officer: o,
        catalog: cat,
        def,
        recBadge,
      });
    });
  });

  rows.sort((a, b) => {
    let diff = 0;
    if (matrixSortCol === 'player') {
      diff = a.player.name.localeCompare(b.player.name);
    } else if (matrixSortCol === 'officer') {
      diff = (a.catalog.name || '').localeCompare(b.catalog.name || '');
    } else if (matrixSortCol === 'type') {
      diff = (a.catalog.type || '').localeCompare(b.catalog.type || '');
    } else if (matrixSortCol === 'generation') {
      diff = (Number(a.catalog.generation) || 0) - (Number(b.catalog.generation) || 0);
    } else if (matrixSortCol === 'level') {
      diff = (Number(a.officer.level) || 0) - (Number(b.officer.level) || 0);
    } else if (matrixSortCol === 'days') {
      const da = a.def.daysWithoutEvents !== null ? a.def.daysWithoutEvents : 999999;
      const db = b.def.daysWithoutEvents !== null ? b.def.daysWithoutEvents : 999999;
      diff = da - db;
    } else { // default 'deficit'
      diff = a.def.deficitPuzzles - b.def.deficitPuzzles;
    }
    return matrixSortDir === 'asc' ? diff : -diff;
  });

  function sortHeader(col, label) {
    const active = matrixSortCol === col;
    const arrow = active ? (matrixSortDir === 'asc' ? ' ↑' : ' ↓') : '';
    return `<th class="sortable" onclick="setMatrixSort('${col}')">${label}<span class="sort-arrow">${arrow}</span></th>`;
  }

  return `
    <div class="section-header">
      <div class="section-title">Сводная матрица готовности офицеров (${rows.length})</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="text" placeholder="🔍 Поиск по игроку или офицеру..." value="${matrixSearch}" oninput="setMatrixSearch(this.value)" style="width:230px;padding:5px 9px;font-size:12px">
        <label style="font-size:12px;color:var(--text3)">Род войск:</label>
        <select style="width:130px;padding:4px 8px;font-size:12px" onchange="setMatrixFilterType(this.value)">
          ${types.map(t => `<option value="${t}" ${t===matrixFilterType?'selected':''}>${t==='all'?'Все войска':t}</option>`).join('')}
        </select>
        <label style="font-size:12px;color:var(--text3)">Поколение:</label>
        <select style="width:100px;padding:4px 8px;font-size:12px" onchange="setMatrixFilterGen(this.value)">
          ${gens.map(g => `<option value="${g}" ${g===matrixFilterGen?'selected':''}>${g==='all'?'Все':`Gen ${g}`}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${sortHeader('player', 'Игрок')}
            ${sortHeader('officer', 'Офицер')}
            ${sortHeader('type', 'Род войск')}
            ${sortHeader('generation', 'Поколение')}
            ${sortHeader('level', 'Уровень')}
            <th>Звёзды</th>
            ${sortHeader('deficit', 'Дефицит до 180')}
            <th>Склад</th>
            ${sortHeader('days', 'Без ивентов')}
            <th>Рекомендация</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td><strong>${playerLink(r.player)}</strong></td>
              <td><strong>${officerLink(r.officer)}</strong></td>
              <td>${troopBadge(r.catalog.type)}</td>
              <td style="font-family:var(--mono)">${r.catalog.generation}</td>
              <td style="font-family:var(--mono)">Ур. ${fmtNum(r.officer.level)}</td>
              <td>${renderStars(r.officer.stars)}</td>
              <td style="font-family:var(--mono)">
                ${fmtNum(r.def.deficitPuzzles)} пазл.
                <div style="font-size:11px;color:var(--text3)">${r.def.costPerPuzzle > 0 ? `${fmtNum(r.def.deficitCoupons)} куп.` : 'только пазлы'}</div>
              </td>
              <td style="font-family:var(--mono);font-size:12px">
                ${canSeeStock(r.player.id) ? `${fmtNum(r.player.stock.coupons)} куп. / ${fmtNum(r.player.stock.puzzles)} пазл.` : 'Скрыто'}
              </td>
              <td style="font-size:12px">
                ${r.def.dateWithoutEvents || '—'}
                <div style="font-size:11px;color:var(--text3)">${r.def.daysWithoutEvents !== null ? `${fmtNum(r.def.daysWithoutEvents)} дн.` : '—'}</div>
              </td>
              <td>${r.recBadge}</td>
              <td>
                <button class="action-btn" onclick="setCalcPlayer(${r.player.id});setCalcOfficer('${r.officer.id}');setCalcTab('personal')" title="Открыть симулятор">🎯</button>
              </td>
            </tr>
          `).join('') || '<tr><td colspan="11" class="empty-state">Нет офицеров по выбранным фильтрам</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

// ─── PAGE: EVENT TYPES ────────────────────────────────────────
function renderEventTypes() {
  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="section-header">
      <div class="section-title">Типы ивентов</div>
      ${canManage() ? `<button class="btn-primary" onclick="openEventTypeModal()">+ Добавить тип</button>` : ''}
    </div>
    <div id="et-list">
      ${state.eventTypes.map(et=>renderEventTypeCard(et)).join('')}
    </div>
    ${!state.eventTypes.length ? `<div class="empty-state"><p>Нет типов ивентов</p></div>` : ''}
  `;
}

function renderEventTypeCard(et) {
  return `<div class="et-card" style="--ev-color:${et.color}">
    <div class="et-card-header">
      <div style="display:flex;align-items:center;gap:10px">
        <span class="et-dot" style="background:${et.color}"></span>
        <strong>${et.name}</strong>
      </div>
      <div style="display:flex;gap:6px">
        ${canManage() ? `<button class="action-btn" onclick="openEventTypeModal(${et.id})">✏️ Редактировать</button><button class="action-btn danger" onclick="confirmDeleteEventType(${et.id})">🗑</button>` : ''}
      </div>
    </div>
    <table style="margin:0;font-size:13px">
      <thead><tr><th>Место</th><th>Название</th><th>Купонов</th><th>Пазлов</th></tr></thead>
      <tbody>
        ${et.places.map(pl=>`<tr>
          <td style="font-family:var(--mono)">${fmtNum(pl.place)}</td>
          <td>${pl.label}</td>
          <td style="font-family:var(--mono);color:var(--green)">${fmtNum(pl.coupons)}</td>
          <td style="font-family:var(--mono);color:var(--text2)">${fmtNum(Math.floor(pl.coupons/COUPON_PER_PUZZLE))}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

// ─── PLAYER MODAL ────────────────────────────────────────────
let editPlayerId = null;
let officerRows = [];

function updatePlayerModalStarPoints() {
  const el = document.getElementById('fp-total-star-points-badge');
  if (!el) return;
  const s1 = parseInt(document.getElementById('fp-stock-legendary-stars-1')?.value) || 0;
  const s2 = parseInt(document.getElementById('fp-stock-legendary-stars-2')?.value) || 0;
  const s3 = parseInt(document.getElementById('fp-stock-legendary-stars-3')?.value) || 0;
  const calcFn = (typeof logic !== 'undefined' && logic.calculateTotalStarPoints) ? logic.calculateTotalStarPoints : null;
  const total = calcFn ? calcFn({ legendaryStars1: s1, legendaryStars2: s2, legendaryStars3: s3 }) : ((s1 * 110) + (s2 * 420) + (s3 * 960));
  el.textContent = `✨ Итого очков звезд: ${fmtNum(total)}`;
}

function openPlayerModal(playerId=null) {
  editPlayerId = playerId;
  const titleEl = document.getElementById('modal-player-title');
  if (titleEl) {
    titleEl.textContent = playerId ? 'Параметры сектора' : 'Новый сектор';
  }
  const p = playerId ? getPlayer(playerId) : null;
  const nameEl = document.getElementById('fp-name');
  if (nameEl) nameEl.value = p?.name || '';
  const realNameEl = document.getElementById('fp-real-name');
  if (realNameEl) realNameEl.value = p?.realName || '';
  const rankEl = document.getElementById('fp-rank');
  if (rankEl) rankEl.value = p?.rank || 'r3';
  const vipEl = document.getElementById('fp-vip');
  if (vipEl) vipEl.value = p?.sector?.vipLevel || 0;
  const vipPointsEl = document.getElementById('fp-vip-points');
  if (vipPointsEl) vipPointsEl.value = formatInputNumber(p?.sector?.vipPoints || 0);
  const confEl = document.getElementById('fp-conf');
  if (confEl) confEl.value = p?.sector?.confidentialityLevel || 0;
  const powerEl = document.getElementById('fp-power');
  if (powerEl) powerEl.value = formatInputNumber(p?.sector?.power || 0);
  const killsEl = document.getElementById('fp-kills');
  if (killsEl) killsEl.value = formatInputNumber(p?.sector?.kills || 0);
  const killPointsEl = document.getElementById('fp-kill-points');
  if (killPointsEl) killPointsEl.value = formatInputNumber(p?.sector?.killPoints || 0, true);

  const modalEl = document.getElementById('modal-player');
  if (modalEl) bindAllNumericInputs(modalEl);
  if (typeof updateVipProgressHint === 'function') updateVipProgressHint();
  openModal('modal-player');
}

function renderOfficerRows(containerId = 'fp-officers-list') {
  const el = document.getElementById(containerId) || document.getElementById('fp-officers-list');
  if (!el) return;

  const medalsFn = (typeof logic !== 'undefined' && logic.calculateSkillMedalsProgress)
    ? logic.calculateSkillMedalsProgress
    : (typeof calculateSkillMedalsProgress === 'function' ? calculateSkillMedalsProgress : null);

  el.innerHTML = officerRows.map((o,i)=>{
    const skills = Array.isArray(o.skills) && o.skills.length === 4 ? o.skills : [1, 1, 1, 1];
    o.skills = skills;
    const progress = medalsFn ? medalsFn(skills) : { spentMedals: 0, remainingMedals: 690, isMaxSkills: false };

    return `
      <div class="officer-row-container" style="border-bottom:1px solid var(--border);padding:6px 0">
        <div class="officer-row" style="border-bottom:none;padding:0">
          <select onchange="officerRows[${i}].catalogId=this.value">
            ${state.officerCatalog.map(co=>`<option value="${co.id}" ${co.id===o.catalogId?'selected':''}>${escapeHtml(co.name)}</option>`).join('')}
          </select>
          <input type="number" placeholder="Уровень" value="${o.level}" min="0" max="179" style="width:80px" oninput="officerRows[${i}].level=parseInt(this.value)||0">
          <input type="number" placeholder="Купонов" value="${o.coupons}" min="0" step="500" style="width:100px" oninput="officerRows[${i}].coupons=parseInt(this.value)||0">
          <span class="stars">${Array.from({length:6},(_,s)=>{
            const star = s + 1;
            const cost = starCostFor(star);
            const label = star < 6 ? `${fmtNum(cost)} звезд до ${star}★` : `Итого ${fmtNum(cost)} звезд`;
            return `<button type="button" class="star-btn ${(o.stars||0)>s?'active':''}" title="${label}" aria-label="${label}" onclick="setOfficerStars(${i},${star})">${(o.stars||0)>s?'★':'☆'}</button>`;
          }).join('')}</span>
          <button type="button" class="action-btn danger" onclick="officerRows.splice(${i},1);renderOfficerRows()">✕</button>
        </div>
        <div class="skill-level-group" style="margin-top:6px">
          <span class="skill-group-title">Навыки 5-5-5-5:</span>
          <div class="skill-selectors">
            ${[0, 1, 2, 3].map(sIdx => `
              <div class="skill-selector" title="Навык ${sIdx + 1}: ${skills[sIdx]}/5">
                <span class="skill-idx-badge">Н${sIdx + 1}</span>
                <div class="skill-btn-group">
                  ${[1, 2, 3, 4, 5].map(lvl => `
                    <button type="button" class="skill-btn ${skills[sIdx] === lvl ? 'active' : ''}" onclick="setOfficerSkill(${i}, ${sIdx}, ${lvl})">${lvl}</button>
                  `).join('')}
                </div>
              </div>
            `).join('')}
          </div>
          <div class="skill-progress-badge ${progress.isMaxSkills ? 'max-skills' : ''}">
            <span>Медали: <strong>${progress.spentMedals}</strong> / 690</span>
            ${progress.isMaxSkills ? '<span class="badge badge-success" style="font-size:10px">MAX</span>' : `<span class="skill-remaining">(-${progress.remainingMedals})</span>`}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function setOfficerSkill(rowIndex, skillIndex, level) {
  if (!officerRows[rowIndex]) return;
  if (!Array.isArray(officerRows[rowIndex].skills) || officerRows[rowIndex].skills.length !== 4) {
    officerRows[rowIndex].skills = [1, 1, 1, 1];
  }
  officerRows[rowIndex].skills[skillIndex] = Math.max(1, Math.min(5, Number(level) || 1));
  renderOfficerRows();
}

function addOfficerRow() {
  officerRows.push({
    id: 'new_' + Date.now(),
    catalogId: state.officerCatalog[0]?.id,
    level: 0,
    coupons: 0,
    stars: 0,
    skills: [1, 1, 1, 1]
  });
  renderOfficerRows();
}

function setOfficerStars(index, stars) {
  officerRows[index].stars = officerRows[index].stars === stars ? stars - 1 : stars;
  renderOfficerRows();
}

async function savePlayer() {
  const name = document.getElementById('fp-name').value.trim();
  if (!name) { toast('Введите название сектора', 'error'); return; }
  const realName = document.getElementById('fp-real-name').value.trim();
  const rank = document.getElementById('fp-rank').value;
  const sector = {
    vipLevel: Math.max(0, parseInt(document.getElementById('fp-vip').value) || 0),
    vipPoints: Math.max(0, parseInputNumber(document.getElementById('fp-vip-points')?.value)),
    confidentialityLevel: Math.max(0, parseInt(document.getElementById('fp-conf').value) || 0),
    power: Math.max(0, parseInputNumber(document.getElementById('fp-power').value)),
    kills: Math.max(0, parseInputNumber(document.getElementById('fp-kills').value)),
    killPoints: Math.round(Math.max(0, parseInputNumber(document.getElementById('fp-kill-points').value, true)) * 10) / 10,
  };

  const payload = { name, realName, rank, sector };

  try {
    if (editPlayerId) {
      const res = await apiFetch(`/api/players/${editPlayerId}`, {
        method: 'PUT',
        body: payload
      });
      const p = getPlayer(editPlayerId);
      if (p) Object.assign(p, res || payload);
      toast(`Сектор «${name}» обновлён`);
    } else {
      const res = await apiFetch('/api/players', {
        method: 'POST',
        body: payload
      });
      if (res && res.id) {
        state.players.push(res);
        state.currentPlayerId ||= res.id;
      } else {
        const id = state.nextId++;
        state.players.push({
          id,
          name,
          realName,
          rank,
          sector,
          stock: { coupons: 0, puzzles: 0, starCoupons: 0, legendaryStars1: 0, legendaryStars2: 0, legendaryStars3: 0, chests: 0 },
          officers: []
        });
        state.currentPlayerId ||= id;
      }
      toast(`Сектор «${name}» добавлен`);
    }
    save();
    closeAllModals();
    if (typeof loadDataFromServer === 'function') {
      try {
        await loadDataFromServer();
      } catch (_) {}
    }
    if (editPlayerId) {
      if (currentPage === 'players') {
        renderPlayers();
      } else {
        renderPlayerDetail(editPlayerId);
      }
    } else {
      navigate('players');
    }
  } catch (err) {
    toast('Ошибка сохранения сектора: ' + (err.message || err), 'error');
  }
}

function confirmDeletePlayer(id) {
  const p = getPlayer(id);
  document.getElementById('confirm-text').textContent = `Удалить игрока «${p?.name || ''}»?`;
  document.getElementById('confirm-btn').onclick = async () => {
    try {
      await apiFetch(`/api/players/${id}`, { method: 'DELETE' });
      state.players = state.players.filter(x => x.id !== id);
      save();
      closeAllModals();
      await loadDataFromServer();
      toast('Удалено', 'info');
      navigate('players');
    } catch (err) {
      toast('Ошибка удаления игрока: ' + err.message, 'error');
    }
  };
  openModal('modal-confirm');
}

// ─── OFFICER CATALOG MODAL ───────────────────────────────────
let editCatalogOfficerId = null;

function openOfficerCatalogModal(id=null) {
  editCatalogOfficerId = id;
  const officer = id ? getCatalogOfficer(id) : null;
  const titleEl = document.getElementById('modal-officer-title');
  if (titleEl) titleEl.textContent = id ? 'Редактировать офицера каталога' : 'Добавить офицера в каталог';

  const nameInput = document.getElementById('fo-name');
  if (nameInput) nameInput.value = officer?.name || '';
  const typeInput = document.getElementById('fo-type');
  if (typeInput) typeInput.value = officer?.type || 'Танк';
  const genInput = document.getElementById('fo-generation');
  if (genInput) genInput.value = officer?.generation || 8;
  const upType = officer?.upgradeType || (officer?.couponPerPuzzle === 0 ? 'special' : 'standard');
  const upTypeSelect = document.getElementById('fo-upgrade-type');
  if (upTypeSelect) upTypeSelect.value = upType;
  const coupInput = document.getElementById('fo-coupon-per-puzzle');
  if (coupInput) coupInput.value = officer?.couponPerPuzzle ?? (upType === 'special' ? 0 : 720);
  const starCoupInput = document.getElementById('fo-star-coupon-cost');
  if (starCoupInput) starCoupInput.value = officer?.starCouponCost ?? 360;
  const bInput = document.getElementById('fo-medals-before');
  if (bInput) bInput.value = officer?.medalsBeforeTraining ?? 480;
  const tInput = document.getElementById('fo-medals-training');
  if (tInput) tInput.value = officer?.medalsTraining ?? 900;
  updateOfficerCatalogTotalMedals();
  openModal('modal-officer');
}

function updateOfficerCatalogTotalMedals() {
  const b = parseInt(document.getElementById('fo-medals-before')?.value) || 0;
  const t = parseInt(document.getElementById('fo-medals-training')?.value) || 0;
  const totalEl = document.getElementById('fo-medals-total');
  if (totalEl) {
    totalEl.value = (typeof logic !== 'undefined' && logic.calculateTotalMedals)
      ? logic.calculateTotalMedals(b, t)
      : (b + t);
  }
}

function onFoUpgradeTypeChange(val) {
  const couponInput = document.getElementById('fo-coupon-per-puzzle');
  if (!couponInput) return;
  if (val === 'special') {
    couponInput.value = 0;
  } else if (parseInt(couponInput.value) === 0) {
    couponInput.value = 720;
  }
}

async function saveOfficerCatalog() {
  const name = document.getElementById('fo-name').value.trim();
  if (!name) { toast('Введите имя офицера', 'error'); return; }
  const type = document.getElementById('fo-type').value;
  const generation = Math.max(1, parseInt(document.getElementById('fo-generation').value) || 8);
  const couponPerPuzzle = Math.max(0, parseInt(document.getElementById('fo-coupon-per-puzzle').value) || 0);
  const starCouponCost = Math.max(0, parseInt(document.getElementById('fo-star-coupon-cost')?.value) || 360);
  const medalsBeforeTraining = Math.max(0, parseInt(document.getElementById('fo-medals-before')?.value) || 480);
  const medalsTraining = Math.max(0, parseInt(document.getElementById('fo-medals-training')?.value) || 900);
  const medalsTotal = (typeof logic !== 'undefined' && logic.calculateTotalMedals)
    ? logic.calculateTotalMedals(medalsBeforeTraining, medalsTraining)
    : (medalsBeforeTraining + medalsTraining);
  const upgradeType = document.getElementById('fo-upgrade-type')?.value || (couponPerPuzzle === 0 ? 'special' : 'standard');

  const data = {
    name,
    type,
    generation,
    couponPerPuzzle,
    starCouponCost,
    medalsBeforeTraining,
    medalsTraining,
    medalsTotal,
    upgradeType,
  };
  try {
    if (editCatalogOfficerId) {
      const res = await apiFetch(`/api/catalog/${editCatalogOfficerId}`, {
        method: 'PUT',
        body: { id: editCatalogOfficerId, ...data }
      });
      const off = getCatalogOfficer(editCatalogOfficerId);
      if (off) Object.assign(off, res || data);
      toast('Офицер сохранён');
    } else {
      const res = await apiFetch('/api/catalog', {
        method: 'POST',
        body: data
      });
      if (res && res.id) state.officerCatalog.push(res);
      else state.officerCatalog.push({ id: 'catalog-' + state.nextId++, ...data });
      toast('Офицер добавлен в каталог');
    }
    save();
    closeAllModals();
    await loadDataFromServer();
    navigate('officers');
  } catch (err) {
    toast('Ошибка сохранения офицера: ' + err.message, 'error');
  }
}

function confirmDeleteOfficerCatalog(id) {
  const officer = getCatalogOfficer(id);
  const result = canDeleteOfficer(id, state.players);
  if (!result.ok) {
    toast(`Нельзя удалить: используют ${result.blockers.map(p=>p.name).join(', ')}`,'error');
    return;
  }
  document.getElementById('confirm-text').textContent = `Удалить офицера «${officer?.name || id}»?`;
  document.getElementById('confirm-btn').onclick = async () => {
    try {
      await apiFetch(`/api/catalog/${id}`, { method: 'DELETE' });
      state.officerCatalog = state.officerCatalog.filter(o => o.id !== id);
      save();
      closeAllModals();
      await loadDataFromServer();
      toast('Офицер удалён', 'info');
      navigate('officers');
    } catch (err) {
      toast('Ошибка удаления офицера: ' + err.message, 'error');
    }
  };
  openModal('modal-confirm');
}

// ─── VIP TIERS MODAL ─────────────────────────────────────────
async function openVipTiersModal() {
  if (!state.vipTiers || !state.vipTiers.length) {
    try {
      const res = await apiFetch('/api/vip-tiers');
      if (Array.isArray(res)) state.vipTiers = res;
    } catch (_) {}
  }
  renderVipTiersEditor();
  openModal('modal-vip-tiers');
}

function renderVipTiersEditor() {
  const tbody = document.getElementById('vip-tiers-editor-body');
  if (!tbody) return;

  const tiers = (state.vipTiers && state.vipTiers.length === 30)
    ? state.vipTiers
    : Array.from({ length: 30 }, (_, i) => ({
        level: i + 1,
        points: (i + 1 === 14) ? 750000 : ((i + 1) * 50000),
        dailyPuzzles: (i + 1 > 10 ? Math.min(20, Math.max(2, i + 1 - 9)) : 0),
        dailyChests: 1
      }));

  tbody.innerHTML = tiers.map(t => {
    const isVip14 = Number(t.level) === 14;
    return `
      <tr style="${isVip14 ? 'background:rgba(26,110,245,0.12);font-weight:600' : ''}">
        <td style="text-align:center;font-weight:700">
          ${isVip14 ? '<span title="VIP 14 (Ключевой)">⭐ 14</span>' : t.level}
        </td>
        <td>
          <input type="number" id="vip-tier-pts-${t.level}" value="${t.points ?? 0}" min="0" step="5000" style="width:100%;font-family:var(--mono);${isVip14 ? 'border-color:var(--primary);font-weight:700' : ''}">
        </td>
        <td>
          <input type="number" id="vip-tier-puz-${t.level}" value="${t.dailyPuzzles ?? t.daily_puzzles ?? 0}" min="0" step="0.5" style="width:100%;text-align:center;font-family:var(--mono)">
        </td>
        <td>
          <input type="number" id="vip-tier-chst-${t.level}" value="${t.dailyChests ?? t.daily_chests ?? 1}" min="0" step="1" style="width:100%;text-align:center;font-family:var(--mono)">
        </td>
      </tr>
    `;
  }).join('');
}

async function submitVipTiers() {
  const tiers = [];
  for (let lvl = 1; lvl <= 30; lvl++) {
    const pts = Math.max(0, parseInt(document.getElementById(`vip-tier-pts-${lvl}`)?.value) || 0);
    const puz = Math.max(0, parseFloat(document.getElementById(`vip-tier-puz-${lvl}`)?.value) || 0);
    const chst = Math.max(0, parseFloat(document.getElementById(`vip-tier-chst-${lvl}`)?.value) || 1);
    tiers.push({
      level: lvl,
      points: pts,
      dailyPuzzles: puz,
      dailyChests: chst
    });
  }

  try {
    const updated = await apiFetch('/api/vip-tiers', {
      method: 'PUT',
      body: { tiers }
    });
    if (Array.isArray(updated)) {
      state.vipTiers = updated;
    } else {
      state.vipTiers = tiers;
    }
    save();
    closeAllModals();
    toast('Шкала уровней VIP сохранена');
    updateVipProgressHint(false);
    updateCabinetVipProgressHint();
    if (currentPage === 'players' && editPlayerId) renderPlayerDetail(editPlayerId);
    else if (currentPage === 'my_cabinet') renderMyCabinet();
  } catch (err) {
    toast('Ошибка сохранения шкалы VIP: ' + (err.message || err), 'error');
  }
}

function resetVipTiersToDefault() {
  const DEFAULT_POINTS = [
    0, 200, 700, 2500, 6000, 15000, 35000, 75000, 130000, 220000,
    340000, 480000, 600000, 750000, 1000000, 1300000, 1700000, 2200000, 2800000, 3500000,
    4300000, 5200000, 6200000, 7300000, 8500000, 10000000, 12000000, 15000000, 19000000, 24000000
  ];
  for (let lvl = 1; lvl <= 30; lvl++) {
    const ptsEl = document.getElementById(`vip-tier-pts-${lvl}`);
    if (ptsEl) ptsEl.value = DEFAULT_POINTS[lvl - 1] ?? (lvl * 100000);
    const puzEl = document.getElementById(`vip-tier-puz-${lvl}`);
    if (puzEl) puzEl.value = lvl > 10 ? Math.min(20, Math.max(2, lvl - 9)) : 0;
    const chstEl = document.getElementById(`vip-tier-chst-${lvl}`);
    if (chstEl) chstEl.value = 1;
  }
}

// ─── EXCHANGE SHOP OCR SCANNER ─────────────────────────────────
let isExchangeOcrRunning = false;
let exchangeOcrOfficers = [];

function openExchangeOcrModal() {
  if (!canManage()) {
    toast('Недостаточно прав для управления каталогом', 'error');
    return;
  }
  isExchangeOcrRunning = false;
  exchangeOcrOfficers = [];

  const fileInput = document.getElementById('exchange-file-input');
  if (fileInput) fileInput.value = '';

  const dropzone = document.getElementById('exchange-dropzone');
  if (dropzone) {
    dropzone.style.display = 'block';
    dropzone.classList.remove('dragover');
  }

  const progressCont = document.getElementById('exchange-progress-container');
  if (progressCont) progressCont.style.display = 'none';

  const resultsCont = document.getElementById('exchange-results-container');
  if (resultsCont) resultsCont.style.display = 'none';

  const tbody = document.getElementById('exchange-ocr-table-body');
  if (tbody) tbody.innerHTML = '';

  const submitBtn = document.getElementById('exchange-btn-submit');
  if (submitBtn) submitBtn.disabled = true;

  initExchangeOcr();
  openModal('modal-exchange-ocr');
}

function closeExchangeOcrModal() {
  isExchangeOcrRunning = false;
  closeModal('modal-exchange-ocr');
}

function initExchangeOcr() {
  const dropzone = document.getElementById('exchange-dropzone');
  const fileInput = document.getElementById('exchange-file-input');

  if (dropzone && !dropzone.dataset.initialized) {
    dropzone.dataset.initialized = 'true';

    dropzone.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
      const files = e.dataTransfer ? e.dataTransfer.files : null;
      if (files && files.length > 0) {
        handleExchangeFiles(files);
      }
    });
  }

  if (fileInput && !fileInput.dataset.initialized) {
    fileInput.dataset.initialized = 'true';
    fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (files.length > 0) {
        handleExchangeFiles(files);
      }
    });
  }
}

async function handleExchangeFiles(filesList) {
  if (isExchangeOcrRunning) return;
  const files = Array.from(filesList || []).filter(f => f && (f.type ? f.type.startsWith('image/') : true));
  if (files.length === 0) {
    toast('Выберите файлы изображений для сканирования', 'warning');
    return;
  }

  const ocrEngine = (typeof smartScanner !== 'undefined' && smartScanner) || (typeof window !== 'undefined' && window.smartScanner);
  if (!ocrEngine || typeof ocrEngine.runExchangeShopOcr !== 'function') {
    toast('OCR-модуль не загружен', 'error');
    return;
  }

  isExchangeOcrRunning = true;

  const progressCont = document.getElementById('exchange-progress-container');
  const progressBar = document.getElementById('exchange-progress-bar');
  const progressPercent = document.getElementById('exchange-progress-percent');
  const progressStatus = document.getElementById('exchange-progress-status');
  const progressDetails = document.getElementById('exchange-progress-details');

  if (progressCont) progressCont.style.display = 'block';
  if (progressBar) progressBar.style.width = '5%';
  if (progressPercent) progressPercent.textContent = '5%';
  if (progressStatus) progressStatus.textContent = 'Подключение Tesseract OCR...';
  if (progressDetails) progressDetails.textContent = 'Загрузка словарей rus + eng';

  try {
    const activeLogic = (typeof logic !== 'undefined' ? logic : null) ||
      (typeof window !== 'undefined' && (window.logic || (typeof window.parseProfileScreenshotText === 'function' ? window : null))) ||
      (typeof globalThis !== 'undefined' && (globalThis.logic || (typeof globalThis.parseProfileScreenshotText === 'function' ? globalThis : null)));

    const result = await ocrEngine.runExchangeShopOcr(files, {
      logic: activeLogic,
      onProgress: (p) => {
        const pct = Math.min(100, Math.max(0, p.percent || 0));
        if (progressBar) progressBar.style.width = `${pct}%`;
        if (progressPercent) progressPercent.textContent = `${pct}%`;
        if (progressStatus && p.details) progressStatus.textContent = p.details;
        if (progressDetails) progressDetails.textContent = `Изображение ${p.current || 1} из ${p.total || 1}`;
      }
    });

    isExchangeOcrRunning = false;

    if (result && result.success && Array.isArray(result.officers) && result.officers.length > 0) {
      renderExchangeOcrTable(result.officers);
      toast(`Распознано командиров: ${result.officers.length}`);
    } else {
      toast('Командиры не найдены на скриншоте. Вы можете добавить строку вручную.', 'warning');
      renderExchangeOcrTable([{
        name: '',
        type: 'Пехота',
        generation: 8,
        couponPerPuzzle: 720,
        starCouponCost: 360,
        medalsBeforeTraining: 480,
        medalsTraining: 900,
        medalsTotal: 1380
      }]);
    }
  } catch (err) {
    isExchangeOcrRunning = false;
    toast('Ошибка распознавания: ' + (err.message || err), 'error');
    if (progressStatus) progressStatus.textContent = 'Сбой распознавания';
  }
}

function renderExchangeOcrTable(officersList) {
  const tbody = document.getElementById('exchange-ocr-table-body');
  const resultsCont = document.getElementById('exchange-results-container');
  const submitBtn = document.getElementById('exchange-btn-submit');
  if (!tbody) return;

  const types = (typeof logic !== 'undefined' && logic.OFFICER_TYPES)
    ? logic.OFFICER_TYPES
    : ['Танк', 'Пехота', 'ПТ-Сау', 'Горнизон', 'Осада'];

  tbody.innerHTML = (officersList || []).map((off, idx) => {
    const before = Math.max(0, parseInt(off.medalsBeforeTraining, 10) || 480);
    const training = Math.max(0, parseInt(off.medalsTraining, 10) || 900);
    const total = (typeof logic !== 'undefined' && logic.calculateTotalMedals)
      ? logic.calculateTotalMedals(before, training)
      : (before + training);
    const offType = types.includes(off.type) ? off.type : 'Пехота';

    return `
      <tr class="exchange-ocr-row" data-idx="${idx}">
        <td>
          <input type="text" class="input-sm exchange-row-name" value="${escapeHtml(off.name || '')}" placeholder="Имя командира" style="width:100%" required>
        </td>
        <td>
          <select class="input-sm exchange-row-type" style="width:100%">
            ${types.map(t => `<option value="${t}" ${t === offType ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </td>
        <td>
          <input type="number" class="input-sm exchange-row-gen" value="${off.generation || 8}" min="1" max="25" style="width:60px">
        </td>
        <td>
          <input type="number" class="input-sm exchange-row-coupon" value="${off.couponPerPuzzle ?? 720}" min="0" step="10" style="width:75px">
        </td>
        <td>
          <input type="number" class="input-sm exchange-row-star-coupon" value="${off.starCouponCost ?? 360}" min="0" step="10" style="width:75px">
        </td>
        <td>
          <input type="number" class="input-sm exchange-row-medals-before" value="${before}" min="0" step="10" style="width:70px" oninput="recalcExchangeRowTotal(this)">
        </td>
        <td>
          <input type="number" class="input-sm exchange-row-medals-training" value="${training}" min="0" step="10" style="width:70px" oninput="recalcExchangeRowTotal(this)">
        </td>
        <td>
          <strong class="exchange-row-medals-total" style="color:var(--text1)">${total}</strong>
        </td>
        <td style="text-align:center">
          <button type="button" class="btn-sm btn-ghost" onclick="removeExchangeRow(this)" title="Удалить строку" style="color:var(--red);padding:2px 6px">✕</button>
        </td>
      </tr>
    `;
  }).join('');

  if (resultsCont) resultsCont.style.display = 'block';
  if (submitBtn) submitBtn.disabled = tbody.children.length === 0;
}

function recalcExchangeRowTotal(input) {
  const row = input.closest('tr');
  if (!row) return;
  const beforeInput = row.querySelector('.exchange-row-medals-before');
  const trainingInput = row.querySelector('.exchange-row-medals-training');
  const totalElem = row.querySelector('.exchange-row-medals-total');
  const before = Math.max(0, parseInt(beforeInput?.value, 10) || 0);
  const training = Math.max(0, parseInt(trainingInput?.value, 10) || 0);
  const total = (typeof logic !== 'undefined' && logic.calculateTotalMedals)
    ? logic.calculateTotalMedals(before, training)
    : (before + training);
  if (totalElem) totalElem.textContent = String(total);
}

function removeExchangeRow(btn) {
  const row = btn.closest('tr');
  if (row) row.remove();
  const tbody = document.getElementById('exchange-ocr-table-body');
  const submitBtn = document.getElementById('exchange-btn-submit');
  if (submitBtn) {
    submitBtn.disabled = !tbody || tbody.children.length === 0;
  }
}

function addManualExchangeRow() {
  const tbody = document.getElementById('exchange-ocr-table-body');
  const resultsCont = document.getElementById('exchange-results-container');
  const submitBtn = document.getElementById('exchange-btn-submit');
  if (!tbody) return;

  const types = (typeof logic !== 'undefined' && logic.OFFICER_TYPES)
    ? logic.OFFICER_TYPES
    : ['Танк', 'Пехота', 'ПТ-Сау', 'Горнизон', 'Осада'];

  const tr = document.createElement('tr');
  tr.className = 'exchange-ocr-row';
  tr.innerHTML = `
    <td>
      <input type="text" class="input-sm exchange-row-name" value="" placeholder="Имя командира" style="width:100%" required>
    </td>
    <td>
      <select class="input-sm exchange-row-type" style="width:100%">
        ${types.map(t => `<option value="${t}">${t}</option>`).join('')}
      </select>
    </td>
    <td>
      <input type="number" class="input-sm exchange-row-gen" value="8" min="1" max="25" style="width:60px">
    </td>
    <td>
      <input type="number" class="input-sm exchange-row-coupon" value="720" min="0" step="10" style="width:75px">
    </td>
    <td>
      <input type="number" class="input-sm exchange-row-star-coupon" value="360" min="0" step="10" style="width:75px">
    </td>
    <td>
      <input type="number" class="input-sm exchange-row-medals-before" value="480" min="0" step="10" style="width:70px" oninput="recalcExchangeRowTotal(this)">
    </td>
    <td>
      <input type="number" class="input-sm exchange-row-medals-training" value="900" min="0" step="10" style="width:70px" oninput="recalcExchangeRowTotal(this)">
    </td>
    <td>
      <strong class="exchange-row-medals-total" style="color:var(--text1)">1380</strong>
    </td>
    <td style="text-align:center">
      <button type="button" class="btn-sm btn-ghost" onclick="removeExchangeRow(this)" title="Удалить строку" style="color:var(--red);padding:2px 6px">✕</button>
    </td>
  `;
  tbody.appendChild(tr);

  if (resultsCont) resultsCont.style.display = 'block';
  if (submitBtn) submitBtn.disabled = false;
  tr.querySelector('.exchange-row-name')?.focus();
}

async function submitBatchExchangeOfficers() {
  const rows = document.querySelectorAll('#exchange-ocr-table-body tr');
  if (!rows || rows.length === 0) {
    toast('Нет офицеров для добавления', 'warning');
    return;
  }

  const officers = [];
  for (const row of rows) {
    const nameInput = row.querySelector('.exchange-row-name');
    const name = nameInput ? nameInput.value.trim() : '';
    if (!name) {
      toast('Заполните имена всех офицеров в таблице', 'warning');
      if (nameInput) nameInput.focus();
      return;
    }

    const type = row.querySelector('.exchange-row-type')?.value || 'Пехота';
    const generation = Math.max(1, parseInt(row.querySelector('.exchange-row-gen')?.value, 10) || 8);
    const couponPerPuzzle = Math.max(0, parseInt(row.querySelector('.exchange-row-coupon')?.value, 10) || 720);
    const starCouponCost = Math.max(0, parseInt(row.querySelector('.exchange-row-star-coupon')?.value, 10) || 360);
    const medalsBeforeTraining = Math.max(0, parseInt(row.querySelector('.exchange-row-medals-before')?.value, 10) || 480);
    const medalsTraining = Math.max(0, parseInt(row.querySelector('.exchange-row-medals-training')?.value, 10) || 900);
    const medalsTotal = (typeof logic !== 'undefined' && logic.calculateTotalMedals)
      ? logic.calculateTotalMedals(medalsBeforeTraining, medalsTraining)
      : (medalsBeforeTraining + medalsTraining);

    officers.push({
      name,
      type,
      generation,
      couponPerPuzzle,
      starCouponCost,
      medalsBeforeTraining,
      medalsTraining,
      medalsTotal,
      upgradeType: 'standard'
    });
  }

  try {
    const res = await apiFetch('/api/catalog/batch', {
      method: 'POST',
      body: { officers }
    });

    closeExchangeOcrModal();
    toast(`Добавлено/обновлено офицеров: ${res?.count || officers.length}`);
    await loadDataFromServer();
    renderOfficers();
  } catch (err) {
    toast('Ошибка сохранения офицеров: ' + (err.message || err), 'error');
  }
}

// ─── EVENT TYPE MODAL ─────────────────────────────────────────
let editEtId = null;
let etPlaceRows = [];

function openEventTypeModal(etId=null) {
  editEtId = etId;
  document.getElementById('modal-et-title').textContent = etId ? 'Редактировать тип' : 'Новый тип ивента';
  if (etId) {
    const et = getEventType(etId);
    document.getElementById('fet-name').value = et.name;
    document.getElementById('fet-color').value = et.color;
    etPlaceRows = et.places.map(p=>({...p}));
  } else {
    document.getElementById('fet-name').value = '';
    document.getElementById('fet-color').value = '#8b5cf6';
    etPlaceRows = [
      { place:1, label:'🥇 1 место', coupons:12500 },
      { place:2, label:'🥈 2 место', coupons:6500  },
      { place:3, label:'🥉 3 место', coupons:3500  },
      { place:4, label:'4–10 место', coupons:2750  },
    ];
  }
  renderEtPlaceRows();
  openModal('modal-et');
}

function renderEtPlaceRows() {
  document.getElementById('fet-places-list').innerHTML = etPlaceRows.map((pl,i)=>`
    <div class="officer-row">
      <input type="number" placeholder="Место" value="${pl.place}" min="1" style="width:60px" oninput="etPlaceRows[${i}].place=parseInt(this.value)||1">
      <input type="text" placeholder="Название" value="${pl.label}" style="flex:1" oninput="etPlaceRows[${i}].label=this.value">
      <input type="number" placeholder="Купонов" value="${pl.coupons}" min="0" step="500" style="width:100px" oninput="etPlaceRows[${i}].coupons=parseInt(this.value)||0">
      <button class="action-btn danger" onclick="etPlaceRows.splice(${i},1);renderEtPlaceRows()">✕</button>
    </div>`).join('');
}

function addEtPlaceRow() {
  const nextPlace = etPlaceRows.length ? Math.max(...etPlaceRows.map(p=>p.place))+1 : 1;
  etPlaceRows.push({ place:nextPlace, label:`Место ${nextPlace}`, coupons:0 });
  renderEtPlaceRows();
}

async function saveEventType() {
  const name = document.getElementById('fet-name').value.trim();
  if (!name) { toast('Введите название','error'); return; }
  const color = document.getElementById('fet-color').value;
  const places = etPlaceRows.filter(p=>p.label.trim()).sort((a,b)=>a.place-b.place);
  if (!places.length) { toast('Добавьте хотя бы одно место','error'); return; }

  try {
    if (editEtId) {
      const et = getEventType(editEtId);
      const prizeHistory = [...(et?.prizeHistory || []), { date:new Date().toISOString().slice(0,10), places:places.map(p=>({...p})) }];
      const payload = { id: editEtId, name, color, places, prizeHistory };
      const res = await apiFetch(`/api/event-types/${editEtId}`, {
        method: 'PUT',
        body: payload
      });
      if (et) Object.assign(et, res || payload);
      toast(`Тип «${name}» обновлён`);
    } else {
      const payload = {
        name,
        color,
        places,
        prizeHistory: [{ date:new Date().toISOString().slice(0,10), places:places.map(p=>({...p})) }]
      };
      const res = await apiFetch('/api/event-types', {
        method: 'POST',
        body: payload
      });
      state.eventTypes.push(res || { id:state.nextId++, ...payload });
      toast(`Тип «${name}» добавлен`);
    }
    save();
    closeAllModals();
    await loadDataFromServer();
    navigate('event_types');
  } catch (err) {
    toast('Ошибка сохранения типа ивента: ' + err.message, 'error');
  }
}

function confirmDeleteEventType(id) {
  const et = getEventType(id);
  document.getElementById('confirm-text').textContent = `Удалить тип ивента «${et?.name || '?'}»? Все ивенты этого типа потеряют привязку.`;
  document.getElementById('confirm-btn').onclick = async () => {
    try {
      await apiFetch(`/api/event-types/${id}`, { method: 'DELETE' });
      state.eventTypes = state.eventTypes.filter(x => x.id !== id);
      save();
      closeAllModals();
      await loadDataFromServer();
      toast('Удалено', 'info');
      navigate('event_types');
    } catch (err) {
      toast('Ошибка удаления типа ивента: ' + err.message, 'error');
    }
  };
  openModal('modal-confirm');
}

// ─── SEASON SCHEDULER & CADENCE CONSTRUCTOR ──────────────────
function onSeasonTotalWeeksInputChange(val) {
  const weeks = Math.max(1, Math.min(52, parseInt(val, 10) || 8));
  setSeasonDurationWeeks(weeks);
}

function setSeasonDurationWeeks(weeks) {
  const hiddenInput = document.getElementById('season-total-weeks');
  if (hiddenInput) hiddenInput.value = weeks;

  const btnGroup = document.getElementById('season-weeks-group');
  if (btnGroup) {
    btnGroup.querySelectorAll('.season-week-btn').forEach(btn => {
      const w = parseInt(btn.getAttribute('data-weeks'), 10);
      if (w === weeks) {
        btn.classList.add('active', 'btn-primary');
        btn.classList.remove('btn-outline');
      } else {
        btn.classList.remove('active', 'btn-primary');
        btn.classList.add('btn-outline');
      }
    });
  }

  updateSeasonSchedulePreview();
}

function openSeasonSchedulerModal() {
  // Find next Monday (or today if today is Monday)
  const now = new Date();
  const day = now.getDay(); // 0: Sun, 1: Mon
  const diff = (day === 1 ? 0 : (day === 0 ? 1 : 8 - day));
  const monday = new Date(now);
  monday.setDate(monday.getDate() + diff);
  const defaultStart = monday.toISOString().slice(0, 10);

  const dateInput = document.getElementById('season-start-date');
  if (dateInput) dateInput.value = defaultStart;

  setSeasonDurationWeeks(8);

  // Set default checkbox and select values
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = Boolean(val);
    else el.value = val;
  };

  setVal('season-enable-kow', true);
  setVal('season-startday-kow', '2');
  setVal('season-duration-kow', '2');
  setVal('season-active-kow', '1');
  setVal('season-break-kow', '1');
  setVal('season-offset-kow', '0');

  setVal('season-enable-mf', true);
  setVal('season-startday-mf', '6');
  setVal('season-duration-mf', '3');
  setVal('season-active-mf', '1');
  setVal('season-break-mf', '1');
  setVal('season-offset-mf', '0');

  setVal('season-enable-pot', true);
  setVal('season-startday-pot', '2');
  setVal('season-duration-pot', '3');
  setVal('season-active-pot', '1');
  setVal('season-break-pot', '1');
  setVal('season-offset-pot', '1');

  updateSeasonSchedulePreview();
  openModal('modal-season-scheduler');
}

function updateSeasonSchedulePreview() {
  const startDate = document.getElementById('season-start-date')?.value || new Date().toISOString().slice(0, 10);
  const totalWeeks = Math.max(1, parseInt(document.getElementById('season-total-weeks')?.value, 10) || 8);

  const getNum = (id, fallback) => {
    const el = document.getElementById(id);
    return el ? (parseInt(el.value, 10) || fallback) : fallback;
  };
  const isChecked = (id) => {
    const el = document.getElementById(id);
    return el ? el.checked : false;
  };

  const rules = [];

  if (isChecked('season-enable-kow')) {
    rules.push({
      id: 'king-of-war',
      name: 'Король Войны',
      color: '#8b5cf6',
      startDayOfWeek: getNum('season-startday-kow', 2),
      durationDays: getNum('season-duration-kow', 2),
      activeWeeks: getNum('season-active-kow', 1),
      breakWeeks: getNum('season-break-kow', 1),
      weekOffset: getNum('season-offset-kow', 0),
    });
  }

  if (isChecked('season-enable-mf')) {
    rules.push({
      id: 'mighty-forces',
      name: 'Мощные Силы',
      color: '#10b981',
      startDayOfWeek: getNum('season-startday-mf', 6),
      durationDays: getNum('season-duration-mf', 3),
      activeWeeks: getNum('season-active-mf', 1),
      breakWeeks: getNum('season-break-mf', 1),
      weekOffset: getNum('season-offset-mf', 0),
    });
  }

  if (isChecked('season-enable-pot')) {
    rules.push({
      id: 'power-of-time',
      name: 'Сила Времени',
      color: '#f59e0b',
      startDayOfWeek: getNum('season-startday-pot', 2),
      durationDays: getNum('season-duration-pot', 3),
      activeWeeks: getNum('season-active-pot', 1),
      breakWeeks: getNum('season-break-pot', 1),
      weekOffset: getNum('season-offset-pot', 1),
    });
  }

  const scheduleGenerator = (typeof logic !== 'undefined' && typeof logic.generateSeasonSchedule === 'function')
    ? logic.generateSeasonSchedule
    : (typeof generateSeasonSchedule === 'function' ? generateSeasonSchedule : null);

  if (scheduleGenerator) {
    state.seasonPreviewEvents = scheduleGenerator({ startDate, totalWeeks, rules });
  } else {
    state.seasonPreviewEvents = [];
  }

  renderSeasonSchedulePreviewTable();
}

function renderSeasonSchedulePreviewTable() {
  const events = state.seasonPreviewEvents || [];
  const countEl = document.getElementById('season-preview-count');
  const submitCountEl = document.getElementById('season-submit-count');
  const submitBtn = document.getElementById('btn-submit-season');

  if (countEl) countEl.textContent = events.length;
  if (submitCountEl) submitCountEl.textContent = events.length;
  if (submitBtn) submitBtn.disabled = events.length === 0;

  const tbody = document.getElementById('season-preview-tbody');
  if (!tbody) return;

  if (events.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:18px;color:var(--text3)">Нет активных событий. Включите хотя бы одно событие выше.</td></tr>';
    return;
  }

  tbody.innerHTML = events.map((ev, idx) => {
    let badgeClass = 'badge-event-kow';
    if (ev.typeId === 'mighty-forces' || ev.name.includes('Мощные')) badgeClass = 'badge-event-mf';
    else if (ev.typeId === 'power-of-time' || ev.name.includes('Времени')) badgeClass = 'badge-event-pot';

    return `
      <tr>
        <td style="color:var(--text3)">${idx + 1}</td>
        <td><strong>${escapeHtml(ev.dateFrom)}</strong> – ${escapeHtml(ev.dateTo)}</td>
        <td>${escapeHtml(ev.dayFromStr || '')} – ${escapeHtml(ev.dayToStr || '')}</td>
        <td><span class="badge-event-tag ${badgeClass}">${escapeHtml(ev.name)}</span></td>
        <td>${ev.durationDays} дн.</td>
        <td style="text-align:center">
          <button type="button" class="btn-remove-event-row" onclick="removeSeasonPreviewEvent(${idx})" title="Удалить это событие">✕</button>
        </td>
      </tr>
    `;
  }).join('');
}

function removeSeasonPreviewEvent(index) {
  if (Array.isArray(state.seasonPreviewEvents) && state.seasonPreviewEvents[index]) {
    state.seasonPreviewEvents.splice(index, 1);
    renderSeasonSchedulePreviewTable();
  }
}

async function submitSeasonSchedule() {
  const events = state.seasonPreviewEvents || [];
  if (events.length === 0) {
    toast('Нет событий для создания в сезоне', 'error');
    return;
  }

  const submitBtn = document.getElementById('btn-submit-season');
  const oldText = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '⏳ Создание...';
  }

  try {
    const res = await apiFetch('/api/events/schedule-season', {
      method: 'POST',
      body: { events }
    });
    const createdCount = res?.createdCount ?? res?.count ?? events.length;
    toast(`Сезон успешно создан: ${createdCount} ивент(ов)`);
    closeAllModals();
    await loadDataFromServer();
    if (currentPage === 'calendar') renderCalendar();
  } catch (err) {
    toast('Ошибка создания сезона: ' + err.message, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = oldText;
    }
  }
}

// ─── EVENT MODAL ─────────────────────────────────────────────
let editEventId = null;
let eventAssignments = []; // [{place, playerId, officerId, actualCoupons?}]

function openEventModal(eventId=null) {
  editEventId = eventId;
  document.getElementById('modal-event-title').textContent = eventId ? 'Редактировать ивент' : 'Новый ивент';

  // populate event type select
  const sel = document.getElementById('fe-type');
  sel.innerHTML = state.eventTypes.map(et=>`<option value="${et.id}">${et.name}</option>`).join('');

  currentEventRegistrations = [];

  if (eventId) {
    const ev = getEvent(eventId);
    sel.value = ev.typeId;
    document.getElementById('fe-from').value = ev.dateFrom;
    document.getElementById('fe-to').value = ev.dateTo;
    document.getElementById('fe-note').value = ev.note || '';
    eventAssignments = ev.assignments.map(a=>({...a}));
    if (ev.registrations) {
      currentEventRegistrations = ev.registrations;
    }
    // refresh registrations from server
    apiFetch(`/api/events/${eventId}`).then(fresh => {
      if (fresh && fresh.registrations) {
        currentEventRegistrations = fresh.registrations;
        const localEv = getEvent(eventId);
        if (localEv) localEv.registrations = fresh.registrations;
        renderEventRegistrationsBlock();
        renderEventAssignments();
      }
    }).catch(() => {});
  } else {
    const today = new Date().toISOString().slice(0,10);
    document.getElementById('fe-from').value = today;
    document.getElementById('fe-to').value = today;
    document.getElementById('fe-note').value = '';
    eventAssignments = [];
    // pre-populate from event type places
    if (state.eventTypes.length) {
      const et = getEventType(parseInt(sel.value));
      if (et) eventAssignments = resolveEventPlaces(et, today).map(p=>({ place:p.place, playerId:null, officerId:null, actualCoupons:p.coupons }));
    }
  }
  renderEventRegistrationsBlock();
  renderEventAssignments();
  openModal('modal-event');
}

function onEventTypeChange() {
  if (eventAssignments.some(a => a.playerId)) {
    if (!confirm('Сменить тип ивента? Текущие назначения игроков будут сброшены.')) {
      const currentEv = editEventId ? getEvent(editEventId) : null;
      document.getElementById('fe-type').value = currentEv?.typeId || state.eventTypes[0]?.id;
      return;
    }
  }
  const etId = parseInt(document.getElementById('fe-type').value);
  const et = getEventType(etId);
  if (et) {
    const dateFrom = document.getElementById('fe-from').value || new Date().toISOString().slice(0,10);
    eventAssignments = resolveEventPlaces(et, dateFrom).map(p=>({ place:p.place, playerId:null, officerId:null, actualCoupons:p.coupons }));
  }
  renderEventRegistrationsBlock();
  renderEventAssignments();
}

function renderEventRegistrationsBlock() {
  const container = document.getElementById('fe-registrations-container');
  if (!container) return;
  if (!editEventId) {
    container.innerHTML = '';
    return;
  }

  const etId = parseInt(document.getElementById('fe-type')?.value);
  const et = getEventType(etId);
  const dateFrom = document.getElementById('fe-from')?.value;
  const regs = currentEventRegistrations || [];

  let html = `
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:12px;margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <strong style="font-size:13px">📋 Поданные заявки участников (${regs.length})</strong>
      </div>
  `;

  if (!regs.length) {
    html += `<div style="font-size:12px;color:var(--text3)">Заявок на этот ивент пока нет</div></div>`;
    container.innerHTML = html;
    return;
  }

  html += `<div style="display:flex;flex-direction:column;gap:6px;max-height:160px;overflow-y:auto">`;
  regs.forEach(r => {
    const player = getPlayer(r.playerId);
    const off = player?.officers?.find(o => o.id === r.officerId);
    const cat = off ? getCatalogOfficer(off.catalogId) : null;
    const desired = Number(r.desiredPlace) || 0;
    const placeLabel = desired === 0 ? 'Любое подходящее' : (placeInfo(et, desired, dateFrom)?.label || `Место ${desired}`);
    const isAssignedToDesired = eventAssignments.some(a => Number(a.playerId) === Number(r.playerId) && (Number(a.place) === desired || desired === 0));
    const isAssignedOther = !isAssignedToDesired && eventAssignments.some(a => Number(a.playerId) === Number(r.playerId));

    let statusBadge = `<span class="badge badge-none" style="font-size:10px">Не назначен</span>`;
    if (isAssignedToDesired) {
      statusBadge = `<span class="badge badge-success" style="font-size:10px">Заявка учтена ✓</span>`;
    } else if (isAssignedOther) {
      statusBadge = `<span class="badge badge-warning" style="font-size:10px">Назначен иначе</span>`;
    }

    const def = off && cat ? calculateOfficerDeficit({ officer: off, catalogItem: cat, player, targetLevel: 180, today: dateFrom }) : null;

    html += `
      <div style="display:flex;align-items:center;justify-content:space-between;background:var(--bg2);padding:6px 10px;border-radius:6px;font-size:12px">
        <div style="display:flex;align-items:center;gap:8px">
          <strong>${escapeHtml(r.playerName || player?.name || `Игрок #${r.playerId}`)}</strong>
          <span style="color:var(--text3)">→</span>
          <span style="color:var(--text2)">${escapeHtml(officerLabel(off))} (ур. ${off?.level ?? '?'})</span>
          <span class="badge badge-none" style="font-size:10px">${escapeHtml(placeLabel)}</span>
          ${r.isCooldown ? `<span class="cooldown-badge badge" style="font-size:10px">⏳ Кулдаун</span>` : ''}
          ${def ? `<span style="font-size:11px;color:var(--text3)">(дефицит: ${fmtNum(def.deficitCoupons)} куп.)</span>` : ''}
        </div>
        <div>${statusBadge}</div>
      </div>
    `;
  });

  html += `</div></div>`;
  container.innerHTML = html;
}

function renderEventAssignments() {
  const etId = parseInt(document.getElementById('fe-type').value);
  const et = getEventType(etId);

  document.getElementById('fe-assignments').innerHTML = eventAssignments.map((a,i)=>{
    const pi = placeInfo(et, a.place, document.getElementById('fe-from')?.value);
    const player = a.playerId ? getPlayer(a.playerId) : null;
    const officerOptions = player
      ? player.officers.map(o=>{
          const c = getCatalogOfficer(o.catalogId);
          const typeStr = c?.type ? `${c.type}, ` : '';
          return `<option value="${o.id}" ${o.id===a.officerId?'selected':''}>${officerLabel(o)} (${typeStr}ур.${fmtNum(o.level)})</option>`;
        }).join('')
      : '';

    let efficiencyBadge = `<span class="badge badge-none" style="font-size:10px">Свободно</span>`;
    if (a.playerId) {
      const o = player?.officers?.find(x => x.id === a.officerId) || player?.officers?.[0];
      const cat = o ? getCatalogOfficer(o.catalogId) : null;
      if (o && cat) {
        const couponsPrize = a.actualCoupons ?? pi?.coupons ?? 0;
        const def = calculateOfficerDeficit({ officer: o, catalogItem: cat, player, targetLevel: MAX_LEVEL });
        if (def.costPerPuzzle === 0) {
          efficiencyBadge = `<span class="badge badge-warning" style="font-size:10px" title="Офицер качается только пазлами!">Только пазлы</span>`;
        } else if (def.deficitCoupons < couponsPrize) {
          const overflow = couponsPrize - def.deficitCoupons;
          efficiencyBadge = `<span class="badge badge-warning" style="font-size:10px" title="Дефицит ${fmtNum(def.deficitCoupons)} куп.">Перерасход: +${fmtNum(overflow)}</span>`;
        } else {
          efficiencyBadge = `<span class="badge badge-success" style="font-size:10px" title="Дефицит ${fmtNum(def.deficitCoupons)} куп.">✓ 100% полезно</span>`;
        }
      }
    }

    let regBadge = '';
    if (a.playerId && currentEventRegistrations && currentEventRegistrations.length) {
      const reg = currentEventRegistrations.find(r => Number(r.playerId) === Number(a.playerId));
      if (reg) {
        const desired = Number(reg.desiredPlace) || 0;
        if (desired === Number(a.place) || desired === 0) {
          regBadge = `<span class="badge badge-success" style="font-size:10px" title="Заявка игрока совпала с назначением">Заявка учтена ✓</span>`;
        } else {
          regBadge = `<span class="badge badge-none" style="font-size:10px" title="Желаемое место было: ${desired}">Заявка: место ${desired}</span>`;
        }
      }
    }

    let cooldownBadge = '';
    if (a.isCooldown) {
      cooldownBadge = `<span class="cooldown-badge badge" style="font-size:10px" title="Кулдаун после победы на предыдущем ивенте (Fair Play)">⏳ Кулдаун после Топ-1</span>`;
    }

    return `<div class="assign-card">
      <span class="assign-place">${pi?.label || 'Место ' + a.place}</span>
      <input type="number" value="${a.actualCoupons ?? pi?.coupons ?? 0}" min="0" step="500" title="Фактические купоны" oninput="eventAssignments[${i}].actualCoupons=parseInt(this.value)||0;renderEventAssignments()">
      <select onchange="onAssignPlayerChange(${i},this.value)">
        <option value="">— Игрок —</option>
        ${state.players.map(p=>'<option value="' + p.id + '" ' + (p.id===a.playerId?'selected':'') + '>' + p.name + '</option>').join('')}
      </select>
      <select ${!player?'disabled':''} onchange="eventAssignments[${i}].officerId=this.value;renderEventAssignments()">
        <option value="">— Офицер —</option>
        ${officerOptions}
      </select>
      <div style="display:flex;flex-direction:column;gap:3px;align-items:flex-start">${efficiencyBadge}${regBadge}${cooldownBadge}</div>
      <button class="action-btn danger" onclick="eventAssignments.splice(${i},1);renderEventAssignments()">✕</button>
    </div>`;
  }).join('');
}

function onAssignPlayerChange(idx, val) {
  const playerId = val ? parseInt(val) : null;
  const player = playerId ? getPlayer(playerId) : null;
  eventAssignments[idx].playerId = playerId;
  eventAssignments[idx].officerId = player?.officers?.[0]?.id || null;
  renderEventAssignments();
}

function addAssignmentRow() {
  const etId = parseInt(document.getElementById('fe-type').value);
  const et = getEventType(etId);
  const maxPlace = eventAssignments.length ? Math.max(...eventAssignments.map(a=>a.place)) : 0;
  const nextPlace = maxPlace + 1;
  eventAssignments.push({ place: nextPlace, playerId: null, officerId: null });
  renderEventAssignments();
}

function autoPickAssignments() {
  const etId = parseInt(document.getElementById('fe-type').value);
  const et = getEventType(etId);
  const eventDate = document.getElementById('fe-from')?.value || new Date().toISOString().slice(0, 10);
  eventAssignments = smartAutoPick({
    places: eventAssignments.length ? eventAssignments : resolveEventPlaces(et, eventDate),
    players: state.players,
    officerCatalog: state.officerCatalog,
    eventDate,
  });
  toast('Автоподбор выполнен (с защитой от перерасхода)');
  renderEventAssignments();
  renderEventRegistrationsBlock();
}

async function autoPickWithRegistrationsServer() {
  if (!editEventId) {
    const etId = parseInt(document.getElementById('fe-type').value);
    const et = getEventType(etId);
    const eventDate = document.getElementById('fe-from')?.value || new Date().toISOString().slice(0, 10);
    const result = typeof smartAutoPickWithRegistrations === 'function'
      ? smartAutoPickWithRegistrations({
          event: { places: eventAssignments.length ? eventAssignments : resolveEventPlaces(et, eventDate) },
          players: state.players,
          registrations: currentEventRegistrations,
          officerCatalog: state.officerCatalog,
          eventDate
        })
      : { assignments: [] };
    eventAssignments = result.assignments;
    toast('⚡ Автоподбор с учетом заявок выполнен');
    renderEventAssignments();
    renderEventRegistrationsBlock();
    return;
  }

  try {
    const res = await apiFetch(`/api/events/${editEventId}/autopick`, { method: 'POST' });
    if (res && res.assignments) {
      eventAssignments = res.assignments;
      const ev = getEvent(editEventId);
      if (ev) ev.assignments = res.assignments;
      save();
      toast('⚡ Автоподбор с учетом заявок успешно выполнен!');
      renderEventAssignments();
      renderEventRegistrationsBlock();
    }
  } catch (err) {
    toast('Ошибка автоподбора: ' + err.message, 'error');
  }
}

async function saveEvent() {
  const typeId = parseInt(document.getElementById('fe-type').value);
  const dateFrom = document.getElementById('fe-from').value;
  const dateTo = document.getElementById('fe-to').value;
  const note = document.getElementById('fe-note').value.trim();

  if (!typeId) { toast('Выберите тип ивента','error'); return; }
  if (!dateFrom || !dateTo) { toast('Укажите даты','error'); return; }

  const assignments = eventAssignments.filter(a=>a.playerId).map(a=>({
    place: a.place,
    playerId: parseInt(a.playerId),
    officerId: a.officerId || null,
    actualCoupons: a.actualCoupons,
  }));

  const payload = {
    ...(editEventId ? { id: editEventId } : {}),
    typeId,
    dateFrom,
    dateTo,
    note,
    assignments
  };

  try {
    const saved = await apiFetch('/api/events', { method: 'POST', body: payload });
    if (editEventId) {
      Object.assign(getEvent(editEventId), saved || payload);
      toast('Ивент обновлён');
    } else {
      state.events.push(saved || { ...payload, id: state.nextId++ });
      toast('Ивент создан');
    }
    save();
    closeAllModals();
    await loadDataFromServer();
    navigate('calendar');
  } catch (err) {
    toast('Ошибка сохранения ивента: ' + err.message, 'error');
  }
}

function confirmDeleteEvent(id) {
  const ev = getEvent(id);
  const et = getEventType(ev?.typeId);
  document.getElementById('confirm-text').textContent = `Удалить ивент «${et?.name||'?'}» (${formatDateShort(ev?.dateFrom)})?`;
  document.getElementById('confirm-btn').onclick = async () => {
    try {
      await apiFetch(`/api/events/${id}`, { method: 'DELETE' }).catch(() => {});
    } finally {
      state.events = state.events.filter(x=>x.id!==id);
      save();
      closeAllModals();
      toast('Удалено','info');
      navigate('calendar');
    }
  };
  openModal('modal-confirm');
}

function submitR3Result(eventId, place) {
  const ev = getEvent(eventId);
  const p = getPlayer(state.currentPlayerId);
  if (!ev || !p || !canR3SubmitResult({ event: ev, place, nowIso: new Date().toISOString(), players: state.players })) {
    toast('Место сейчас нельзя указать','error');
    return;
  }
  const best = [...p.officers].sort((a,b)=>{
    const ca = getCatalogOfficer(a.catalogId), cb = getCatalogOfficer(b.catalogId);
    return (cb?.generation||0) - (ca?.generation||0) || b.level - a.level;
  })[0];
  if (!best) { toast('У игрока нет офицеров','error'); return; }
  const et = getEventType(ev.typeId);
  const pi = placeInfo(et, place, ev.dateFrom);
  ev.assignments = ev.assignments.filter(a=>a.place!==place);
  ev.assignments.push({ place, playerId:p.id, officerId:best.id, actualCoupons:pi?.coupons||0, submittedBy:'r3' });
  save();
  toast('Место отправлено');
  renderEventDetail(eventId);
}

function accrueEventRewards(id) {
  const ev = getEvent(id);
  const et = getEventType(ev.typeId);
  ev.assignments.forEach(a => {
    const p = getPlayer(a.playerId);
    const o = p?.officers.find(x=>x.id===a.officerId);
    if (!p || !o) return;
    const pi = placeInfo(et, a.place, ev.dateFrom);
    const coupons = a.actualCoupons ?? pi?.coupons ?? 0;
    const before = {...p.stock};
    p.stock.coupons += coupons;
    const afterTraining = applyEvent(o, coupons);
    Object.assign(o, afterTraining);
    state.stockHistory.push({ id:state.nextId++, playerId:p.id, eventId:id, date:new Date().toISOString(), before, after:{...p.stock} });
  });
  ev.accrued = true;
  save();
  toast('Награды начислены');
  renderEventDetail(id);
}

// ─── EXPORT / IMPORT ─────────────────────────────────────────
function exportExcel() {
  if (typeof XLSX === 'undefined') { toast('XLSX не загружен','error'); return; }
  const wb = XLSX.utils.book_new();

  // Players sheet
  const pData = [['Игрок','Имя','Ранг','VIP','Конфиденциальность','Купоны','Пазлы','Сундуки','Сила','Убито','Очки за убийство']];
  state.players.forEach(p=>pData.push([p.name,p.realName,p.rank,p.sector.vipLevel,p.sector.confidentialityLevel,p.stock.coupons,p.stock.puzzles,p.stock.chests,p.sector.power,p.sector.kills,p.sector.killPoints]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pData), 'Игроки');

  const oData = [['Игрок','Офицер','Тип','Поколение','Уровень','Купонов','Звезды','Купонов за пазл']];
  state.players.forEach(p=>p.officers.forEach(o=>{
    const cat = getCatalogOfficer(o.catalogId);
    oData.push([p.name, officerLabel(o), cat?.type||'', cat?.generation||'', o.level, o.coupons, o.stars, cat?.couponPerPuzzle ?? COUPON_PER_PUZZLE]);
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(oData), 'Офицеры');

  const hData = [['Дата','Игрок','Купоны было','Пазлы было','Сундуки было','Купоны стало','Пазлы стало','Сундуки стало','Ивент']];
  state.stockHistory.forEach(h=>{
    const p = getPlayer(h.playerId);
    hData.push([h.date, p?.name||'', h.before.coupons, h.before.puzzles, h.before.chests, h.after.coupons, h.after.puzzles, h.after.chests, h.eventId||'']);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hData), 'История');

  // Events sheet
  const eData = [['Ивент','Дата начала','Дата конца','Место','Игрок','Офицер','Купонов']];
  state.events.forEach(ev=>{
    const et = getEventType(ev.typeId);
    ev.assignments.forEach(a=>{
      const p = getPlayer(a.playerId);
      const o = p?.officers.find(x=>x.id===a.officerId);
      const pi = placeInfo(et,a.place, ev.dateFrom);
      eData.push([et?.name||'—', ev.dateFrom, ev.dateTo, pi?.label||`Место ${a.place}`, p?.name||'—', o?officerLabel(o):'—', a.actualCoupons??pi?.coupons??0]);
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(eData), 'Ивенты');

  const fData = [['Игрок','Офицер','Дата максимума','Дней','1 место','2 место','3 место','4-10 место']];
  state.players.forEach(p=>p.officers.forEach(o=>{
    const f = forecastOfficer({ today:new Date().toISOString().slice(0,10), officer:o, player:p, officerCatalog:state.officerCatalog, events:state.events, eventTypes:state.eventTypes });
    const variants = forecastOfficerVariants({ today:new Date().toISOString().slice(0,10), officer:o, player:p, officerCatalog:state.officerCatalog, eventType:state.eventTypes[0]||{} });
    fData.push([p.name, officerLabel(o), f.date||'', f.days??'', variants.top1.date||'', variants.top2.date||'', variants.top3.date||'', variants.top4to10.date||'']);
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fData), 'Прогнозы');

  XLSX.writeFile(wb, `KoW_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast('Excel экспортирован!');
}

function importData() { document.getElementById('import-file').click(); }
function exportJson() {
  const blob = new Blob([JSON.stringify({ ...state, version: 3 }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `KoW_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('JSON экспортирован');
}
function handleImport(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      const valid = validateImportData(data);
      if (valid.ok) { state = migrateState(data); save(); toast('Импортировано!'); navigate('calendar'); }
      else toast(valid.error,'error');
    } catch { toast('Ошибка чтения','error'); }
  };
  reader.readAsText(file); e.target.value='';
}

// ─── SMART SCANNER (OCR) ─────────────────────────────────────
let activeScannerContext = 'my_cabinet'; // 'my_cabinet' | 'player'
let lastScanResults = null;
let isScannerRunning = false;

function openSmartScannerModal(targetContext = 'my_cabinet') {
  activeScannerContext = targetContext || 'my_cabinet';
  lastScanResults = null;
  isScannerRunning = false;

  const btnApply = document.getElementById('scanner-btn-apply');
  if (btnApply) btnApply.disabled = true;

  const fileInput = document.getElementById('scanner-file-input');
  if (fileInput) fileInput.value = '';

  const dropzone = document.getElementById('scanner-dropzone');
  if (dropzone) {
    dropzone.style.display = 'block';
    dropzone.classList.remove('dragover');
  }

  const progressCont = document.getElementById('scanner-progress-container');
  if (progressCont) progressCont.style.display = 'none';

  const resultsCont = document.getElementById('scanner-results-container');
  if (resultsCont) resultsCont.style.display = 'none';

  const barEl = document.getElementById('scanner-progress-bar');
  if (barEl) barEl.style.width = '0%';
  const percentEl = document.getElementById('scanner-progress-percent');
  if (percentEl) percentEl.textContent = '0%';
  const statusEl = document.getElementById('scanner-progress-status');
  if (statusEl) statusEl.textContent = 'Подготовка OCR...';
  const detailsEl = document.getElementById('scanner-progress-details');
  if (detailsEl) detailsEl.textContent = '';

  openModal('modal-smart-scanner');
}

function closeSmartScannerModal() {
  const modal = document.getElementById('modal-smart-scanner');
  if (modal) modal.classList.remove('open');

  const otherOpenModal = document.querySelector('.modal.open:not(#modal-smart-scanner)');
  if (!otherOpenModal) {
    document.getElementById('overlay')?.classList.remove('open');
  }
}

function updateScannerPreviewStarPoints() {
  const s1 = Math.max(0, parseInt(document.getElementById('scanner-preview-stars-1')?.value) || 0);
  const s2 = Math.max(0, parseInt(document.getElementById('scanner-preview-stars-2')?.value) || 0);
  const s3 = Math.max(0, parseInt(document.getElementById('scanner-preview-stars-3')?.value) || 0);
  const calcFn = (typeof logic !== 'undefined' && logic.calculateTotalStarPoints) ? logic.calculateTotalStarPoints : null;
  const total = calcFn ? calcFn({ legendaryStars1: s1, legendaryStars2: s2, legendaryStars3: s3 }) : ((s1 * 110) + (s2 * 420) + (s3 * 960));
  const badge = document.getElementById('scanner-preview-star-points-badge');
  if (badge) {
    badge.textContent = `✨ Итого очков звезд: ${fmtNum(total)}`;
  }
}

async function handleScannerFiles(fileList) {
  if (isScannerRunning) return;
  const files = Array.from(fileList || []).filter(f => {
    return f && (f.type?.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif)$/i.test(f.name || ''));
  });

  if (!files.length) {
    toast('Пожалуйста, выберите файлы изображений (PNG, JPG, WebP)', 'error');
    return;
  }

  const progressCont = document.getElementById('scanner-progress-container');
  const resultsCont = document.getElementById('scanner-results-container');
  const statusEl = document.getElementById('scanner-progress-status');
  const percentEl = document.getElementById('scanner-progress-percent');
  const barEl = document.getElementById('scanner-progress-bar');
  const detailsEl = document.getElementById('scanner-progress-details');
  const btnApply = document.getElementById('scanner-btn-apply');

  if (progressCont) progressCont.style.display = 'flex';
  if (resultsCont) resultsCont.style.display = 'none';
  if (btnApply) btnApply.disabled = true;

  isScannerRunning = true;

  try {
    const scanner = (typeof window !== 'undefined' && window.smartScanner) || (typeof smartScanner !== 'undefined' ? smartScanner : null);
    if (!scanner || typeof scanner.runSmartOcr !== 'function') {
      throw new Error('Модуль Smart Scanner (ocr.js) не загружен. Проверьте подключение скрипта.');
    }

    const onProgress = (info) => {
      const pct = Math.min(100, Math.max(0, Number(info.percent) || 0));
      if (barEl) barEl.style.width = `${pct}%`;
      if (percentEl) percentEl.textContent = `${pct}%`;
      if (statusEl) statusEl.textContent = info.stage === 'done' ? '✓ Готово!' : (info.details || 'Распознавание...');
      if (detailsEl) {
        if (info.total && info.total > 1) {
          detailsEl.textContent = `Обработка скриншота ${info.current || 1} из ${info.total}`;
        } else {
          detailsEl.textContent = info.stage === 'done' ? 'Данные успешно извлечены' : '';
        }
      }
    };

    const activeLogic = (typeof logic !== 'undefined' ? logic : null) ||
      (typeof window !== 'undefined' && (window.logic || (typeof window.parseProfileScreenshotText === 'function' ? window : null))) ||
      (typeof globalThis !== 'undefined' && (globalThis.logic || (typeof globalThis.parseProfileScreenshotText === 'function' ? globalThis : null)));

    const result = await scanner.runSmartOcr(files, onProgress, { logic: activeLogic });
    lastScanResults = result;
    displayScannerResults(result);
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Ошибка распознавания';
    toast('Ошибка сканера: ' + (err.message || 'не удалось распознать скриншоты'), 'error');
  } finally {
    isScannerRunning = false;
  }
}

function displayScannerResults(result) {
  const resultsCont = document.getElementById('scanner-results-container');
  if (!resultsCont) return;

  resultsCont.style.display = 'flex';

  const summaryEl = document.getElementById('scanner-results-summary');
  if (summaryEl) {
    const count = result.imagesProcessed || 1;
    summaryEl.className = 'scanner-results-summary';
    summaryEl.textContent = `✓ Успешно обработано скриншотов: ${count}. Проверьте значения перед применением:`;
  }

  let currentSector = {};
  let currentStock = {};
  let currentName = '';

  if (activeScannerContext === 'my_cabinet') {
    currentSector = myCabinetProfile?.sector || {};
    currentStock = myCabinetProfile?.stock || {};
    currentName = myCabinetProfile?.name || '';
  } else if (activeScannerContext === 'player') {
    currentSector = {
      power: parseInt(document.getElementById('fp-power')?.value) || 0,
      kills: parseInt(document.getElementById('fp-kills')?.value) || 0,
      killPoints: parseFloat(document.getElementById('fp-kill-points')?.value) || 0,
    };
    currentStock = {
      coupons: parseInt(document.getElementById('fp-stock-coupons')?.value) || 0,
      puzzles: parseInt(document.getElementById('fp-stock-puzzles')?.value) || 0,
      starCoupons: parseInt(document.getElementById('fp-stock-star-coupons')?.value) || 0,
      legendaryStars1: parseInt(document.getElementById('fp-stock-legendary-stars-1')?.value) || 0,
      legendaryStars2: parseInt(document.getElementById('fp-stock-legendary-stars-2')?.value) || 0,
      legendaryStars3: parseInt(document.getElementById('fp-stock-legendary-stars-3')?.value) || 0,
      chests: parseInt(document.getElementById('fp-stock-chests')?.value) || 0,
    };
    currentName = document.getElementById('fp-name')?.value || '';
  }

  const s = result.sector || {};
  const st = result.stock || {};

  const nickInput = document.getElementById('scanner-preview-nickname');
  const updateNickCheck = document.getElementById('scanner-preview-update-nickname');
  const detectedName = s.name || s.nickname || '';
  if (nickInput) {
    nickInput.value = detectedName || currentName || '';
  }
  if (updateNickCheck) {
    updateNickCheck.checked = Boolean(detectedName);
  }

  const powerInput = document.getElementById('scanner-preview-power');
  if (powerInput) {
    const val = s.power !== undefined ? s.power : (currentSector.power || 0);
    powerInput.value = formatInputNumber(val);
  }
  const killsInput = document.getElementById('scanner-preview-kills');
  if (killsInput) {
    const val = s.kills !== undefined ? s.kills : (currentSector.kills || 0);
    killsInput.value = formatInputNumber(val);
  }
  const kpInput = document.getElementById('scanner-preview-kill-points');
  if (kpInput) {
    const val = s.killPoints !== undefined ? s.killPoints : (currentSector.killPoints || 0);
    kpInput.value = formatInputNumber(val, true);
  }

  const couponsInput = document.getElementById('scanner-preview-coupons');
  if (couponsInput) {
    const val = st.coupons !== undefined ? st.coupons : (currentStock.coupons || 0);
    couponsInput.value = formatInputNumber(val);
  }
  const puzzlesInput = document.getElementById('scanner-preview-puzzles');
  if (puzzlesInput) {
    const val = st.puzzles !== undefined ? st.puzzles : (currentStock.puzzles || 0);
    puzzlesInput.value = formatInputNumber(val);
  }
  const starCouponsInput = document.getElementById('scanner-preview-star-coupons');
  if (starCouponsInput) {
    const val = st.starCoupons !== undefined ? st.starCoupons : (currentStock.starCoupons || 0);
    starCouponsInput.value = formatInputNumber(val);
  }
  const stars1Input = document.getElementById('scanner-preview-stars-1');
  if (stars1Input) {
    const val = st.legendaryStars1 !== undefined ? st.legendaryStars1 : (currentStock.legendaryStars1 || 0);
    stars1Input.value = formatInputNumber(val);
  }
  const stars2Input = document.getElementById('scanner-preview-stars-2');
  if (stars2Input) {
    const val = st.legendaryStars2 !== undefined ? st.legendaryStars2 : (currentStock.legendaryStars2 || 0);
    stars2Input.value = formatInputNumber(val);
  }
  const stars3Input = document.getElementById('scanner-preview-stars-3');
  if (stars3Input) {
    const val = st.legendaryStars3 !== undefined ? st.legendaryStars3 : (currentStock.legendaryStars3 || 0);
    stars3Input.value = formatInputNumber(val);
  }

  bindAllNumericInputs(resultsCont);

  updateScannerPreviewStarPoints();

  const btnApply = document.getElementById('scanner-btn-apply');
  if (btnApply) btnApply.disabled = false;
}

async function applyScanResultsToProfile() {
  const btnApply = document.getElementById('scanner-btn-apply');
  const updateNick = document.getElementById('scanner-preview-update-nickname')?.checked;
  const nick = document.getElementById('scanner-preview-nickname')?.value?.trim();
  const power = Math.max(0, parseInputNumber(document.getElementById('scanner-preview-power')?.value || 0));
  const kills = Math.max(0, parseInputNumber(document.getElementById('scanner-preview-kills')?.value || 0));
  const killPoints = Math.max(0, parseInputNumber(document.getElementById('scanner-preview-kill-points')?.value || 0, true));

  const coupons = Math.max(0, parseInputNumber(document.getElementById('scanner-preview-coupons')?.value || 0));
  const puzzles = Math.max(0, parseInputNumber(document.getElementById('scanner-preview-puzzles')?.value || 0));
  const starCoupons = Math.max(0, parseInputNumber(document.getElementById('scanner-preview-star-coupons')?.value || 0));
  const legendaryStars1 = Math.max(0, parseInputNumber(document.getElementById('scanner-preview-stars-1')?.value || 0));
  const legendaryStars2 = Math.max(0, parseInputNumber(document.getElementById('scanner-preview-stars-2')?.value || 0));
  const legendaryStars3 = Math.max(0, parseInputNumber(document.getElementById('scanner-preview-stars-3')?.value || 0));

  if (activeScannerContext === 'my_cabinet') {
    if (document.getElementById('my-sector-power')) document.getElementById('my-sector-power').value = formatInputNumber(power);
    if (document.getElementById('my-sector-kills')) document.getElementById('my-sector-kills').value = formatInputNumber(kills);
    if (document.getElementById('my-sector-kill-points')) document.getElementById('my-sector-kill-points').value = formatInputNumber(killPoints, true);

    if (document.getElementById('my-stock-coupons')) document.getElementById('my-stock-coupons').value = formatInputNumber(coupons);
    if (document.getElementById('my-stock-puzzles')) document.getElementById('my-stock-puzzles').value = formatInputNumber(puzzles);
    if (document.getElementById('my-stock-star-coupons')) document.getElementById('my-stock-star-coupons').value = formatInputNumber(starCoupons);
    if (document.getElementById('my-stock-legendary-stars-1')) document.getElementById('my-stock-legendary-stars-1').value = formatInputNumber(legendaryStars1);
    if (document.getElementById('my-stock-legendary-stars-2')) document.getElementById('my-stock-legendary-stars-2').value = formatInputNumber(legendaryStars2);
    if (document.getElementById('my-stock-legendary-stars-3')) document.getElementById('my-stock-legendary-stars-3').value = formatInputNumber(legendaryStars3);
    updateCabinetTotalStarPoints();

    const vipLevel = myCabinetProfile?.sector?.vipLevel || 0;
    const vipPoints = myCabinetProfile?.sector?.vipPoints || 0;
    const confidentialityLevel = myCabinetProfile?.sector?.confidentialityLevel || 0;
    const chests = myCabinetProfile?.stock?.chests || 0;

    const payload = {
      sector: { vipLevel, vipPoints, confidentialityLevel, power, kills, killPoints },
      stock: { coupons, puzzles, starCoupons, legendaryStars1, legendaryStars2, legendaryStars3, chests }
    };
    if (updateNick && nick) {
      payload.name = nick;
    }

    try {
      if (btnApply) {
        btnApply.disabled = true;
        btnApply.textContent = 'Применение...';
      }
      await apiFetch('/api/my-profile', {
        method: 'PUT',
        body: payload
      });
      toast('Данные Smart Scanner успешно применены в профиль!');
      closeSmartScannerModal();
      await renderMyCabinet();
    } catch (err) {
      toast('Ошибка сохранения профиля: ' + err.message, 'error');
    } finally {
      if (btnApply) {
        btnApply.disabled = false;
        btnApply.textContent = '✓ Применить в профиль';
      }
    }
  } else if (activeScannerContext === 'player') {
    if (updateNick && nick && document.getElementById('fp-name')) {
      document.getElementById('fp-name').value = nick;
    }
    if (document.getElementById('fp-power')) document.getElementById('fp-power').value = formatInputNumber(power);
    if (document.getElementById('fp-kills')) document.getElementById('fp-kills').value = formatInputNumber(kills);
    if (document.getElementById('fp-kill-points')) document.getElementById('fp-kill-points').value = formatInputNumber(killPoints, true);

    if (document.getElementById('fp-stock-coupons')) document.getElementById('fp-stock-coupons').value = formatInputNumber(coupons);
    if (document.getElementById('fp-stock-puzzles')) document.getElementById('fp-stock-puzzles').value = formatInputNumber(puzzles);
    if (document.getElementById('fp-stock-star-coupons')) document.getElementById('fp-stock-star-coupons').value = formatInputNumber(starCoupons);
    if (document.getElementById('fp-stock-legendary-stars-1')) document.getElementById('fp-stock-legendary-stars-1').value = formatInputNumber(legendaryStars1);
    if (document.getElementById('fp-stock-legendary-stars-2')) document.getElementById('fp-stock-legendary-stars-2').value = formatInputNumber(legendaryStars2);
    if (document.getElementById('fp-stock-legendary-stars-3')) document.getElementById('fp-stock-legendary-stars-3').value = formatInputNumber(legendaryStars3);
    updatePlayerModalStarPoints();
    toast('Данные Smart Scanner перенесены в карточку игрока!');
    closeSmartScannerModal();
  }
}

function handleScannerGlobalPaste(e) {
  const smartModal = document.getElementById('modal-smart-scanner');
  const exchangeModal = document.getElementById('modal-exchange-ocr');

  const isSmartOpen = smartModal && smartModal.classList.contains('open');
  const isExchangeOpen = exchangeModal && exchangeModal.classList.contains('open');

  if (!isSmartOpen && !isExchangeOpen) return;
  if (isSmartOpen && isScannerRunning) return;
  if (isExchangeOpen && isExchangeOcrRunning) return;

  const clipboardData = e.clipboardData || (typeof window !== 'undefined' ? window.clipboardData : null);
  if (!clipboardData || !clipboardData.items) return;

  const imageFiles = [];
  for (let i = 0; i < clipboardData.items.length; i++) {
    const item = clipboardData.items[i];
    if (item.type && item.type.startsWith('image/')) {
      const blob = item.getAsFile();
      if (blob) {
        imageFiles.push(blob);
      }
    }
  }

  if (imageFiles.length > 0) {
    e.preventDefault();
    if (isSmartOpen) {
      handleScannerFiles(imageFiles);
    } else if (isExchangeOpen) {
      handleExchangeFiles(imageFiles);
    }
  }
}

function initSmartScanner() {
  const dropzone = document.getElementById('scanner-dropzone');
  const fileInput = document.getElementById('scanner-file-input');

  if (dropzone && !dropzone.dataset.initialized) {
    dropzone.dataset.initialized = 'true';

    dropzone.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
      const files = e.dataTransfer ? e.dataTransfer.files : null;
      if (files && files.length > 0) {
        handleScannerFiles(files);
      }
    });
  }

  if (fileInput && !fileInput.dataset.initialized) {
    fileInput.dataset.initialized = 'true';
    fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (files.length > 0) {
        handleScannerFiles(files);
      }
    });
  }

  if (typeof window !== 'undefined' && !window.__scannerPasteInitialized) {
    window.__scannerPasteInitialized = true;
    window.addEventListener('paste', handleScannerGlobalPaste);
  }
}

function updateSidebarVersion(ver) {
  const v = ver || APP_VERSION;
  const textEl = document.getElementById('sidebar-app-version');
  if (textEl) {
    const rawNum = v.replace(/^v/, '');
    textEl.textContent = `Версия ${rawNum}`;
  }
}

async function fetchAndApplyAppVersion() {
  updateSidebarVersion(APP_VERSION);
  try {
    const res = await fetch('/api/version');
    if (res.ok) {
      const data = await res.json();
      if (data && data.version) {
        updateSidebarVersion(data.version);
      }
    }
  } catch (_) {
    // В оффлайн-режиме остаётся fallback значение APP_VERSION
  }
}

function initApp() {
  load();
  renderSidebarNav();
  renderTopbarProfile();
  updateNetworkStatusUI();
  fetchAndApplyAppVersion();
  checkPwaInstallable();
  initSmartScanner();
  initExchangeOcr();
  checkAuth().then(isAuth => {
    if (isAuth) {
      if (currentUser?.rank === 'r3') {
        navigate('my_cabinet');
      } else {
        navigate('calendar');
      }
      if (typeof navigator === 'undefined' || navigator.onLine) {
        flushOutboxQueue();
      }
    }
  });

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    const registerSW = () => {
      navigator.serviceWorker.register('/sw.js')
        .then(() => {})
        .catch(err => {
          console.warn('ServiceWorker registration failed:', err);
        });
    };
    if (document.readyState === 'complete') {
      registerSW();
    } else {
      window.addEventListener('load', registerSW);
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = document.getElementById('pwa-install-btn');
    if (btn) btn.style.display = 'inline-flex';
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    const btn = document.getElementById('pwa-install-btn');
    if (btn) btn.style.display = 'none';
    toast('Приложение KoW Tracker успешно установлено!', 'success');
  });

  window.addEventListener('online', () => {
    updateNetworkStatusUI();
    flushOutboxQueue();
  });
  window.addEventListener('offline', () => {
    updateNetworkStatusUI();
  });
  window.addEventListener('focus', () => {
    if (typeof navigator === 'undefined' || navigator.onLine) {
      flushOutboxQueue();
    }
  });
  setInterval(() => {
    if (typeof navigator === 'undefined' || navigator.onLine) {
      flushOutboxQueue();
    }
  }, 30000);
}

// ─── INIT ────────────────────────────────────────────────────
initApp();

if (typeof window !== 'undefined') {
  window.saveMyCabinetProfile = saveMyCabinetProfile;
  window.renderOfficerRows = renderOfficerRows;
  window.updateVipProgressHint = updateVipProgressHint;
  window.openSeasonSchedulerModal = openSeasonSchedulerModal;
  window.submitSeasonSchedule = submitSeasonSchedule;
  window.setSeasonDurationWeeks = setSeasonDurationWeeks;
  window.onSeasonTotalWeeksInputChange = onSeasonTotalWeeksInputChange;
  window.updateSeasonSchedulePreview = updateSeasonSchedulePreview;
  window.removeSeasonPreviewEvent = removeSeasonPreviewEvent;
  window.getOutboxQueue = getOutboxQueue;
  window.saveOutboxQueue = saveOutboxQueue;
  window.flushOutboxQueue = flushOutboxQueue;
  window.updateNetworkStatusUI = updateNetworkStatusUI;
  window.handleNetworkBadgeClick = handleNetworkBadgeClick;
  window.handleInstallPwaClick = handleInstallPwaClick;
  window.checkPwaInstallable = checkPwaInstallable;
  window.openSmartScannerModal = openSmartScannerModal;
  window.closeSmartScannerModal = closeSmartScannerModal;
  window.handleScannerFiles = handleScannerFiles;
  window.applyScanResultsToProfile = applyScanResultsToProfile;
  window.updateCabinetTotalStarPoints = updateCabinetTotalStarPoints;
  window.updatePlayerModalStarPoints = updatePlayerModalStarPoints;
  window.updateScannerPreviewStarPoints = updateScannerPreviewStarPoints;
  window.initSmartScanner = initSmartScanner;

  window.openPlayerModal = openPlayerModal;
  window.savePlayer = savePlayer;
  window.openAddSectorOfficerModal = openAddSectorOfficerModal;
  window.onAsoCatalogChange = onAsoCatalogChange;
  window.renderAsoStarsPicker = renderAsoStarsPicker;
  window.renderAsoSkillsPicker = renderAsoSkillsPicker;
  window.setAsoSkill = setAsoSkill;
  window.submitAddSectorOfficer = submitAddSectorOfficer;
  window.openEditSectorOfficerModal = openEditSectorOfficerModal;
  window.renderSoStarsPicker = renderSoStarsPicker;
  window.renderSoSkillsPicker = renderSoSkillsPicker;
  window.setSoSkill = setSoSkill;
  window.submitEditSectorOfficer = submitEditSectorOfficer;
  window.confirmDeleteSectorOfficer = confirmDeleteSectorOfficer;
  window.handleQuickChangeStars = handleQuickChangeStars;
  window.openChangeSectorOwnerModal = openChangeSectorOwnerModal;
  window.submitChangeSectorOwner = submitChangeSectorOwner;
  window.openExchangeOcrModal = openExchangeOcrModal;
  window.closeExchangeOcrModal = closeExchangeOcrModal;
  window.closeModal = closeModal;
}
