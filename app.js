// ─── CONSTANTS ───────────────────────────────────────────────
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
  nextId: 1,
};

let currentUser = null;
let pendingRequestsCount = 0;
let myCabinetProfile = null;
let myCabinetSim = {
  officerId: null,
  targetLevel: 180,
  planned: { top1: 0, top2: 0, top3: 0, top4: 0 }
};
let myOfficerEditId = null;
let regModalEventId = null;
let currentEventRegistrations = [];

// ─── API HELPER ──────────────────────────────────────────────
async function apiFetch(url, options = {}) {
  const token = localStorage.getItem('kow_token');
  const headers = { ...(options.headers || {}) };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    localStorage.removeItem('kow_token');
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
    const [cat, et, evs] = await Promise.all([
      apiFetch('/api/catalog').catch(() => null),
      apiFetch('/api/event-types').catch(() => null),
      apiFetch('/api/events').catch(() => null)
    ]);
    if (Array.isArray(cat)) state.officerCatalog = cat;
    if (Array.isArray(et)) state.eventTypes = et;
    if (Array.isArray(evs)) state.events = evs;

    if (canManage()) {
      const pl = await apiFetch('/api/players').catch(() => null);
      if (Array.isArray(pl)) state.players = pl;
      await updatePendingCount();
    } else if (currentUser?.playerId) {
      const myPl = await apiFetch('/api/my-profile').catch(() => null);
      if (myPl) {
        const existingIdx = state.players.findIndex(p => p.id === myPl.id);
        if (existingIdx >= 0) state.players[existingIdx] = myPl;
        else state.players.push(myPl);
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
  return (Number(value) || 0).toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/\u00a0/g, ' ');
}
function fmtOne(value) { return fmtNum(value, 1); }
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
    'Гарнизон': { cls: 'badge-troop-garrison', icon: '🏰' },
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
  document.getElementById('overlay').classList.add('open');
  document.getElementById(id).classList.add('open');
}
function closeAllModals() {
  if (!currentUser && document.getElementById('modal-auth')?.classList.contains('open')) {
    return;
  }
  document.getElementById('overlay').classList.remove('open');
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

// ─── AUTH & SESSION ──────────────────────────────────────────
function openAuthModal(tab = 'login', alertMessage = null) {
  openModal('modal-auth');
  switchAuthTab(tab);
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
    loadCandidatePlayers();
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

async function loadCandidatePlayers() {
  const select = document.getElementById('auth-reg-player-select');
  if (!select) return;
  select.innerHTML = '<option value="">— Новый персонаж (ввести имя) —</option>';
  try {
    let list = await fetch('/api/auth/candidate-players').then(r => r.ok ? r.json() : null).catch(() => null);
    if (!list || !Array.isArray(list)) {
      list = await fetch('/api/players').then(r => r.ok ? r.json() : null).catch(() => null);
    }
    if (Array.isArray(list) && list.length > 0) {
      list.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        select.appendChild(opt);
      });
    }
  } catch (e) {}
}

function onAuthRegPlayerSelectChange(val) {
  const nameInput = document.getElementById('auth-reg-player-name');
  if (!nameInput) return;
  if (val) {
    nameInput.style.display = 'none';
  } else {
    nameInput.style.display = 'block';
    nameInput.focus();
  }
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
    state.currentRole = currentUser.rank;
    state.currentPlayerId = currentUser.playerId || null;
    toast(`Добро пожаловать, ${currentUser.playerName || currentUser.username}!`);
    closeAllModals();
    renderTopbarProfile();
    renderSidebarNav();
    await loadDataFromServer();
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
  const playerSelect = document.getElementById('auth-reg-player-select');
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

  const playerId = playerSelect?.value ? Number(playerSelect.value) : null;
  const playerName = playerNameInput?.value.trim() || '';

  if (!playerId && !playerName) {
    showAuthAlert('Выберите персонажа из списка или введите имя', 'error');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Отправка...';
  }
  hideAuthAlert();

  try {
    const body = { username, password };
    if (playerId) body.playerId = playerId;
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
    currentUser = null;
    toast('Вы вышли из системы', 'info');
    renderTopbarProfile();
    renderSidebarNav();
    openAuthModal('login');
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
  try {
    const data = await apiFetch('/api/auth/me');
    if (data && data.user) {
      currentUser = data.user;
      if (data.player) {
        currentUser.player = data.player;
        currentUser.playerName = data.player.name;
      }
      state.currentRole = currentUser.rank;
      state.currentPlayerId = currentUser.playerId || null;
      renderTopbarProfile();
      renderSidebarNav();
      await loadDataFromServer();
      closeAllModals();
      return true;
    }
  } catch (err) {
    localStorage.removeItem('kow_token');
    currentUser = null;
    renderTopbarProfile();
    renderSidebarNav();
    openAuthModal('login');
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
      topbarBadge.innerHTML = `<span class="badge-alert">🔔 ${pendingRequestsCount} ${pluralizeRequests(pendingRequestsCount)}</span>`;
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
      <span class="badge-alert">🔔 ${pendingRequestsCount} ${pluralizeRequests(pendingRequestsCount)}</span>
    </button>
    <div class="user-profile-badge">
      <span class="badge badge-rank badge-rank-${currentUser.rank || 'r3'}">[${role}]</span>
      <span class="user-profile-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
    </div>
    <button class="btn-ghost btn-sm btn-logout" onclick="logout()" title="Выйти из аккаунта">
      🚪 Выйти
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
      { page: 'players', label: 'Игроки', icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>` },
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
      c.innerHTML = `
        <div class="section-header">
          <div class="section-title">👤 Мой кабинет</div>
        </div>
        <div class="sim-box">
          <div class="auth-alert warning" style="display:block;margin-bottom:14px">
            ⚠️ К вашему аккаунту не привязан игровой персонаж. Обратитесь к руководству гильдии (Р4/Р5) для привязки персонажа к вашему логину.
          </div>
          <p style="color:var(--text2);font-size:13px">Вы вошли как <strong>${escapeHtml(currentUser.username)}</strong> (роль: ${(currentUser.rank || 'r3').toUpperCase()}).</p>
          <div style="margin-top:16px;display:flex;gap:10px">
            <button class="btn-primary" onclick="navigate('calendar')">📅 Календарь ивентов</button>
          </div>
        </div>
      `;
      return;
    }
    c.innerHTML = `<div class="empty-state"><p>Ошибка загрузки профиля: ${escapeHtml(err.message)}</p></div>`;
    return;
  }

  myCabinetProfile = profile;
  const pIdx = state.players.findIndex(p => p.id === profile.id);
  if (pIdx >= 0) state.players[pIdx] = profile;
  else state.players.push(profile);

  const rewards = dailyRewards(profile.sector);
  const today = new Date().toISOString().slice(0, 10);
  const rankLabel = (profile.rank || currentUser.rank || 'r3').toUpperCase();

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
      <div style="display:flex;gap:8px">
        <button class="btn-ghost btn-sm" onclick="renderMyCabinet()">🔄 Обновить</button>
      </div>
    </div>

    <!-- SECTOR & STOCK -->
    <div class="cabinet-grid">
      <!-- Sector Card -->
      <div class="cabinet-card">
        <div class="cabinet-card-title">
          <span>⚙️ Параметры сектора</span>
          <span class="badge badge-none">+${fmtNum(rewards.puzzlesPerDay, 2)} пазл/день</span>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="my-sector-vip">Уровень VIP (0-30)</label>
            <input type="number" id="my-sector-vip" min="0" max="30" value="${profile.sector.vipLevel}">
          </div>
          <div class="form-group">
            <label for="my-sector-conf">Конфиденциальность</label>
            <input type="number" id="my-sector-conf" min="0" value="${profile.sector.confidentialityLevel}">
          </div>
        </div>
        <div class="form-row form-row-3">
          <div class="form-group">
            <label for="my-sector-power">Мощь / Сила</label>
            <input type="number" id="my-sector-power" min="0" value="${profile.sector.power}">
          </div>
          <div class="form-group">
            <label for="my-sector-kills">Убито</label>
            <input type="number" id="my-sector-kills" min="0" value="${profile.sector.kills}">
          </div>
          <div class="form-group">
            <label for="my-sector-kill-points">Очки за убийство</label>
            <input type="number" id="my-sector-kill-points" min="0" step="0.1" value="${profile.sector.killPoints}">
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
          <span style="font-size:11px;color:var(--text3)">Быстрое обновление</span>
        </div>
        <div class="stock-grid" style="margin-bottom:0">
          <div class="stock-card" style="padding:10px">
            <div class="label">🎟️ Купоны</div>
            <div class="value" style="font-size:17px">${fmtNum(profile.stock.coupons)}</div>
          </div>
          <div class="stock-card" style="padding:10px">
            <div class="label">🧩 Пазлы</div>
            <div class="value" style="font-size:17px">${fmtNum(profile.stock.puzzles)}</div>
          </div>
          <div class="stock-card" style="padding:10px">
            <div class="label">📦 Сундуки</div>
            <div class="value" style="font-size:17px">${fmtNum(profile.stock.chests)}</div>
          </div>
        </div>
        <div class="form-row form-row-3">
          <div class="form-group">
            <label for="my-stock-coupons">Новые купоны</label>
            <input type="number" id="my-stock-coupons" min="0" value="${profile.stock.coupons}">
          </div>
          <div class="form-group">
            <label for="my-stock-puzzles">Новые пазлы</label>
            <input type="number" id="my-stock-puzzles" min="0" value="${profile.stock.puzzles}">
          </div>
          <div class="form-group">
            <label for="my-stock-chests">Новые сундуки</label>
            <input type="number" id="my-stock-chests" min="0" value="${profile.stock.chests}">
          </div>
        </div>
        <div>
          <button type="button" class="btn-primary btn-sm" onclick="saveMyStock()">💾 Сохранить запасы</button>
        </div>
      </div>
    </div>

    <!-- OFFICERS LIST -->
    <div class="section-header" style="margin-top:20px">
      <div class="section-title">🎖️ Мои офицеры (${profile.officers.length})</div>
      <button class="btn-primary btn-sm" onclick="openAddMyOfficerModal()">+ Добавить офицера</button>
    </div>

    ${profile.officers.length ? `
      <div class="cabinet-officers-grid">
        ${profile.officers.map(o => {
          const cat = getCatalogOfficer(o.catalogId) || { couponPerPuzzle: 500, generation: 7, type: 'Пехота' };
          const def = calculateOfficerDeficit({ officer: o, catalogItem: cat, player: profile, targetLevel: 180, today });
          const targetPuz = 180 * PUZZLES_PER_LEVEL;
          const currPuz = def.currentPuzzles;
          const pctVal = Math.min(100, Math.round((currPuz / targetPuz) * 100));

          return `
            <div class="cabinet-officer-card">
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

              <!-- Interactive Stars -->
              <div style="display:flex;align-items:center;justify-content:space-between;background:var(--bg3);padding:6px 10px;border-radius:6px">
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
        }).join('')}
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
  const targetLevel = Math.max(1, Math.min(180, myCabinetSim.targetLevel || 180));
  const today = new Date().toISOString().slice(0, 10);

  const def = calculateOfficerDeficit({
    officer: selectedOfficer,
    catalogItem: cat,
    player: myCabinetProfile,
    targetLevel,
    today
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
  const simProgressPct = Math.min(100, Math.round(((currentPuzTotal + sim.puzzlesFromEvents) / Math.max(1, targetPuz)) * 100));

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
            ${def.costPerPuzzle > 0 ? `${fmtNum(sim.remainingDeficitCoupons)} купонов` : 'Только пазлы'}
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
          <strong>${simProgressPct}% (${fmtNum(currentPuzTotal + sim.puzzlesFromEvents)} / ${fmtNum(targetPuz)} пазлов)</strong>
        </div>
        <div class="progress-container">
          <div class="progress-fill green" style="width:${simProgressPct}%"></div>
        </div>
      </div>

      <div style="font-size:13px;font-weight:600;margin:16px 0 8px">Планируемые призовые места в ивентах:</div>
      <div class="sim-counter-grid">
        <div class="sim-counter-card">
          <div class="sim-counter-info">
            <span class="sim-counter-title">🥇 1 место</span>
            <span class="sim-counter-desc">${fmtNum(top1Coupons)} купонов (+${fmtNum(Math.floor(top1Coupons/COUPON_PER_PUZZLE))} пазл.)</span>
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
            <span class="sim-counter-desc">${fmtNum(top2Coupons)} купонов (+${fmtNum(Math.floor(top2Coupons/COUPON_PER_PUZZLE))} пазл.)</span>
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
            <span class="sim-counter-desc">${fmtNum(top3Coupons)} купонов (+${fmtNum(Math.floor(top3Coupons/COUPON_PER_PUZZLE))} пазл.)</span>
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
            <span class="sim-counter-desc">${fmtNum(top4Coupons)} купонов (+${fmtNum(Math.floor(top4Coupons/COUPON_PER_PUZZLE))} пазл.)</span>
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

async function saveMySector() {
  const vipLevel = Math.max(0, parseInt(document.getElementById('my-sector-vip').value) || 0);
  const confidentialityLevel = Math.max(0, parseInt(document.getElementById('my-sector-conf').value) || 0);
  const power = Math.max(0, parseInt(document.getElementById('my-sector-power').value) || 0);
  const kills = Math.max(0, parseInt(document.getElementById('my-sector-kills').value) || 0);
  const killPoints = Math.max(0, parseFloat(document.getElementById('my-sector-kill-points').value) || 0);

  try {
    await apiFetch('/api/my-profile', {
      method: 'PUT',
      body: {
        sector: { vipLevel, confidentialityLevel, power, kills, killPoints }
      }
    });
    toast('Параметры сектора успешно сохранены');
    await renderMyCabinet();
  } catch (err) {
    toast('Ошибка сохранения сектора: ' + err.message, 'error');
  }
}

async function saveMyStock() {
  const coupons = Math.max(0, parseInt(document.getElementById('my-stock-coupons').value) || 0);
  const puzzles = Math.max(0, parseInt(document.getElementById('my-stock-puzzles').value) || 0);
  const chests = Math.max(0, parseInt(document.getElementById('my-stock-chests').value) || 0);

  try {
    await apiFetch('/api/my-profile', {
      method: 'PUT',
      body: {
        stock: { coupons, puzzles, chests }
      }
    });
    toast('Запасы успешно сохранены');
    await renderMyCabinet();
  } catch (err) {
    toast('Ошибка сохранения запасов: ' + err.message, 'error');
  }
}

function renderInteractiveStars(officer) {
  const count = Number(officer.stars) || 0;
  return `<span class="stars">${Array.from({length:6},(_,i)=>{
    const star = i + 1;
    const cost = starCostFor(star);
    const title = star < 6
      ? `${fmtNum(cost)} звезд до ${star}★ (нажмите, чтобы установить)`
      : `Итого ${fmtNum(cost)} звезд (нажмите, чтобы установить 6★)`;
    return `<button type="button" class="star-btn ${count>=star?'active':''}" title="${title}" onclick="setMyOfficerStars('${officer.id}', ${star === count ? star - 1 : star})">${count>=star?'★':'☆'}</button>`;
  }).join('')}</span>`;
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

  openModal('modal-my-officer');
}

async function saveMyOfficerSubmit() {
  const level = Math.max(0, Math.min(180, parseInt(document.getElementById('my-officer-level').value) || 0));
  const coupons = Math.max(0, parseInt(document.getElementById('my-officer-coupons').value) || 0);
  const stars = Math.max(0, Math.min(6, parseInt(document.getElementById('my-officer-stars').value) || 0));

  try {
    if (myOfficerEditId) {
      await apiFetch(`/api/my-profile/officers/${myOfficerEditId}`, {
        method: 'PUT',
        body: { level, coupons, stars }
      });
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
        body: { catalogId, name: cat?.name || '', level, coupons, stars }
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
  try {
    await apiFetch(`/api/my-profile/officers/${officerId}`, {
      method: 'PUT',
      body: { stars: count }
    });
    toast(`Звёзды обновлены: ${count}★`);
    await renderMyCabinet();
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
    players: 'Игроки',
    officers: 'Офицеры',
    officer_detail: 'Офицер',
    event_types: 'Настройка ивентов',
    event_detail: 'Ивент',
    player_detail: 'Игрок',
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
      ${canManage() ? `<button class="btn-primary" onclick="openEventModal()">+ Создать ивент</button>` : ''}
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
  if (status === 'upcoming' && currentUser?.playerId) {
    if (ev.myRegistration) {
      const myPlace = Number(ev.myRegistration.desiredPlace) || 0;
      const placeLabel = myPlace === 0 ? 'Любое подходящее' : (placeInfo(et, myPlace, ev.dateFrom)?.label || `Место ${myPlace}`);
      const allOffs = state.players.flatMap(p => p.officers || []);
      const regOff = allOffs.find(o => o.id === ev.myRegistration.officerId)
        || (myCabinetProfile?.officers || []).find(o => o.id === ev.myRegistration.officerId);
      const regOfficerName = regOff ? officerLabel(regOff) : (ev.myRegistration.officerId || '—');
      regHtml = `
        <div class="cal-reg-badge" onclick="event.stopPropagation()">
          <div>✓ Заявка: <strong>${escapeHtml(regOfficerName)}</strong> (${escapeHtml(placeLabel)})</div>
          <button class="action-btn" onclick="event.stopPropagation();openRegisterModal(${ev.id})">✏️ Изменить</button>
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
  if (isEventUpcoming(ev) && currentUser?.playerId) {
    if (ev.myRegistration) {
      const myPlace = Number(ev.myRegistration.desiredPlace) || 0;
      const placeLabel = myPlace === 0 ? 'Любое подходящее' : (placeInfo(et, myPlace, ev.dateFrom)?.label || `Место ${myPlace}`);
      const allOffs = state.players.flatMap(p => p.officers || []);
      const regOff = allOffs.find(o => o.id === ev.myRegistration.officerId) || (myCabinetProfile?.officers || []).find(o => o.id === ev.myRegistration.officerId);
      const regOfficerName = regOff ? officerLabel(regOff) : (ev.myRegistration.officerId || '—');
      regBanner = `
        <div class="cal-reg-badge" style="margin-top:14px;padding:12px 16px;font-size:13px">
          <div>
            <span>✓ Вы подали заявку: <strong>${escapeHtml(regOfficerName)}</strong></span>
            <span class="badge badge-none" style="margin-left:6px">${escapeHtml(placeLabel)}</span>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn-ghost btn-sm" onclick="openRegisterModal(${ev.id})">✏️ Изменить</button>
            <button class="btn-ghost btn-sm btn-danger" onclick="cancelRegistrationFromDetail(${ev.id})">✕ Отменить заявку</button>
          </div>
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
function openRegisterModal(eventId) {
  const ev = getEvent(eventId);
  if (!ev) return;
  const et = getEventType(ev.typeId);

  const player = getPlayer(currentUser?.playerId) || myCabinetProfile;
  if (!player || !player.officers || !player.officers.length) {
    toast('У вас нет офицеров в профиле. Сначала добавьте офицера в личном кабинете!', 'warning');
    return;
  }

  regModalEventId = eventId;
  const isEditing = !!ev.myRegistration;

  document.getElementById('modal-event-register-title').textContent = isEditing
    ? `Изменить заявку на «${et?.name || 'Ивент'}»`
    : `Регистрация на «${et?.name || 'Ивент'}»`;

  document.getElementById('reg-event-info').innerHTML = `
    📅 Даты: <strong>${formatDate(ev.dateFrom)} — ${formatDate(ev.dateTo)}</strong> · Ивент: <strong>${escapeHtml(et?.name || '—')}</strong>
  `;

  // populate officers
  const offSelect = document.getElementById('reg-officer-select');
  offSelect.innerHTML = player.officers.map(o => {
    const c = getCatalogOfficer(o.catalogId);
    return `<option value="${o.id}" ${ev.myRegistration?.officerId === o.id ? 'selected' : ''}>${escapeHtml(officerLabel(o))} (ур. ${o.level}, ${c?.type || '—'})</option>`;
  }).join('');

  // populate places
  const placeSelect = document.getElementById('reg-place-select');
  const places = resolveEventPlaces(et, ev.dateFrom);
  let placeOptions = `<option value="0" ${ev.myRegistration?.desiredPlace === 0 ? 'selected' : ''}>Любое подходящее место (автоподбор)</option>`;

  places.forEach(p => {
    const sel = ev.myRegistration && Number(ev.myRegistration.desiredPlace) === Number(p.place);
    placeOptions += `<option value="${p.place}" ${sel ? 'selected' : ''}>${escapeHtml(p.label || `Место ${p.place}`)} (${fmtNum(p.coupons)} купонов)</option>`;
  });
  placeSelect.innerHTML = placeOptions;

  const cancelBtn = document.getElementById('reg-btn-cancel');
  if (cancelBtn) {
    cancelBtn.style.display = isEditing ? 'inline-block' : 'none';
  }

  const submitBtn = document.getElementById('reg-btn-submit');
  if (submitBtn) {
    submitBtn.textContent = isEditing ? 'Обновить заявку' : 'Подать заявку';
  }

  onRegisterModalChange();
  openModal('modal-event-register');
}

function onRegisterModalChange() {
  const ev = getEvent(regModalEventId);
  if (!ev) return;
  const et = getEventType(ev.typeId);
  const player = getPlayer(currentUser?.playerId) || myCabinetProfile;
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
      body: { officerId, desiredPlace }
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
  if (!confirm('Вы уверены, что хотите отменить свою заявку на этот ивент?')) return;

  try {
    await apiFetch(`/api/events/${eventId}/register`, { method: 'DELETE' });
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

async function cancelRegistrationFromDetail(eventId) {
  if (!confirm('Отменить заявку на этот ивент?')) return;
  try {
    await apiFetch(`/api/events/${eventId}/register`, { method: 'DELETE' });
    toast('Заявка отменена', 'info');
    await loadDataFromServer();
    renderEventDetail(eventId);
  } catch (err) {
    toast('Ошибка отмены: ' + err.message, 'error');
  }
}

// ─── PAGE: PLAYERS ───────────────────────────────────────────
function renderPlayers() {
  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="section-header">
      <div class="section-title">Игроки (${state.players.length})</div>
      ${canManage() ? `<button class="btn-primary" onclick="openPlayerModal()">+ Добавить игрока</button>` : ''}
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Игрок</th><th>Ранг</th><th>Сектор</th><th>Офицеры</th><th>Запасы</th><th></th></tr></thead>
        <tbody>
          ${!state.players.length ? `<tr><td colspan="6" class="empty-state"><p>Нет игроков</p></td></tr>` : ''}
          ${state.players.map(p=>{
            const rewards = dailyRewards(p.sector);
            const stock = canSeeStock(p.id) ? `${fmtNum(p.stock.coupons)} куп. · ${fmtNum(p.stock.puzzles)} пазл. · ${fmtNum(p.stock.chests)} сун.` : 'Скрыто';
            return `<tr>
              <td>
                <strong>${playerLink(p)}</strong>
                ${p.realName ? `<div style="color:var(--text3);font-size:12px">${p.realName}</div>` : ''}
              </td>
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

function renderStars(count=0) {
  return `<span class="stars">${Array.from({length:6},(_,i)=>{
    const star = i + 1;
    const cost = starCostFor(star);
    return `<span class="star-readonly ${count>=star?'active':''}" title="${star < 6 ? `${fmtNum(cost)} звезд до ${star}★` : `Итого ${fmtNum(cost)} звезд`}">${count>=star?'★':'☆'}</span>`;
  }).join('')}</span>`;
}

function renderPlayerDetail(playerId) {
  const p = getPlayer(playerId);
  if (!p) { navigate('players'); return; }
  const rewards = dailyRewards(p.sector);
  const history = state.stockHistory.filter(h=>h.playerId===p.id).slice(-8).reverse();
  const stockVisible = canSeeStock(p.id);
  const c = document.getElementById('content');
  c.innerHTML = `
    <div style="margin-bottom:20px">
      <button class="btn-ghost btn-sm" onclick="navigate('players')">← Игроки</button>
    </div>
    <div class="section-header">
      <div>
        <div class="section-title">${p.name} ${p.realName ? `<span style="color:var(--text3)">· ${p.realName}</span>` : ''} <span class="player-meta-pill">VIP ${fmtNum(p.sector.vipLevel)}</span> <span class="player-meta-pill">Конф. ${fmtNum(p.sector.confidentialityLevel)}</span> <span class="player-meta-pill">Сила ${fmtNum(p.sector.power)}</span></div>
        <div style="color:var(--text3);font-size:12px;margin-top:4px">Ранг ${p.rank} · убито ${fmtNum(p.sector.kills)} · очки за убийство ${fmtOne(p.sector.killPoints)}</div>
      </div>
      ${canManage() || state.currentPlayerId === p.id ? `<button class="btn-primary btn-sm" onclick="openPlayerModal(${p.id})">Редактировать</button>` : ''}
    </div>
    ${stockVisible ? `
      <div class="stock-grid">
        <div class="stock-card"><div class="label">Купоны</div><div class="value">${fmtNum(p.stock.coupons)}</div></div>
        <div class="stock-card"><div class="label">Пазлы</div><div class="value">${fmtNum(p.stock.puzzles)}</div></div>
        <div class="stock-card"><div class="label">Сундуки</div><div class="value">${fmtNum(p.stock.chests)}</div></div>
        <div class="stock-card"><div class="label">Ежедневно</div><div class="value">+${fmtNum(rewards.puzzlesPerDay, 2)}</div></div>
      </div>
      <div class="section-header"><div class="section-title">Корректировка запасов</div></div>
      <div class="form-row form-row-3" style="margin-bottom:12px">
        <input type="number" id="stock-coupons" placeholder="Купоны" value="${p.stock.coupons}">
        <input type="number" id="stock-puzzles" placeholder="Пазлы" value="${p.stock.puzzles}">
        <input type="number" id="stock-chests" placeholder="Сундуки" value="${p.stock.chests}">
      </div>
      <div style="display:flex;gap:8px;margin-bottom:20px">
        <button class="btn-primary btn-sm" onclick="saveStockCorrection(${p.id})">Сохранить запасы</button>
        <button class="btn-ghost btn-sm" onclick="rollbackLastStock(${p.id})">Откатить последнюю</button>
      </div>` : `<div class="empty-state"><p>Запасы скрыты для роли ${state.currentRole}</p></div>`}
    <div class="section-header"><div class="section-title">Офицеры и прогноз</div></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Офицер</th><th>Тип</th><th>Поколение</th><th>Уровень</th><th>Звезды</th><th>До максимума</th><th>Сценарии</th></tr></thead>
        <tbody>${p.officers.map(o=>{
          const cat = getCatalogOfficer(o.catalogId);
          const forecast = forecastOfficer({ today:new Date().toISOString().slice(0,10), officer:o, player:p, officerCatalog:state.officerCatalog, events:state.events, eventTypes:state.eventTypes });
          const variants = forecastOfficerVariants({ today:new Date().toISOString().slice(0,10), officer:o, player:p, officerCatalog:state.officerCatalog, eventType:state.eventTypes[0]||{} });
          return `<tr><td><strong>${officerLink(o)}</strong></td><td>${cat ? troopBadge(cat.type) : '—'}</td><td>${cat ? fmtNum(cat.generation) : '—'}</td><td>${fmtNum(o.level)}</td><td>${renderStars(o.stars)}</td><td>${forecast.date || 'за пределами прогноза'}</td><td style="font-size:12px;color:var(--text2)">1: ${variants.top1.date||'—'} · 2: ${variants.top2.date||'—'} · 3: ${variants.top3.date||'—'} · 4-10: ${variants.top4to10.date||'—'}</td></tr>`;
        }).join('')}</tbody>
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

function saveStockCorrection(playerId) {
  const p = getPlayer(playerId);
  const before = {...p.stock};
  const after = {
    coupons: Math.max(0,parseInt(document.getElementById('stock-coupons').value)||0),
    puzzles: Math.max(0,parseInt(document.getElementById('stock-puzzles').value)||0),
    chests: Math.max(0,parseInt(document.getElementById('stock-chests').value)||0),
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

// ─── PAGE: OFFICERS ──────────────────────────────────────────
function renderOfficers() {
  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="section-header">
      <div class="section-title">Базовые офицеры (${state.officerCatalog.length})</div>
      ${canManage() ? `<button class="btn-primary" onclick="openOfficerCatalogModal()">+ Добавить офицера</button>` : ''}
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Имя</th><th>Тип</th><th>Поколение</th><th>Купонов за пазл</th><th>Медали</th><th></th></tr></thead>
        <tbody>${state.officerCatalog.map(o=>`<tr>
          <td><strong>${catalogOfficerLink(o)}</strong></td>
          <td>${troopBadge(o.type)}</td>
          <td style="font-family:var(--mono)">${fmtNum(o.generation)}</td>
          <td style="font-family:var(--mono)">${fmtNum(o.couponPerPuzzle)}</td>
          <td style="font-family:var(--mono)">${fmtNum(o.medalsBeforeTraining)}+${fmtNum(o.medalsTraining)}=${fmtNum(o.medalsTotal)}</td>
          <td>
            <div style="display:flex;gap:4px">
              ${canManage()?`<button class="action-btn" onclick="openOfficerCatalogModal('${o.id}')">✏️</button><button class="action-btn danger" onclick="confirmDeleteOfficerCatalog('${o.id}')">🗑</button>`:''}
            </div>
          </td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
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

  document.getElementById('content').innerHTML = `
    <div style="margin-bottom:20px">
      <button class="btn-ghost btn-sm" onclick="navigate('officers')">← Офицеры</button>
    </div>
    <div class="section-header">
      <div>
        <div class="section-title">${officer.name}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
          ${troopBadge(officer.type)}
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

    <div class="section-header"><div class="section-title">Игроки, которые качают офицера</div></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Игрок</th><th>Уровень</th><th>Купоны</th><th>Звезды</th><th>Запасы</th><th>Прогноз</th></tr></thead>
        <tbody>${users.flatMap(p=>p.officers.filter(o=>o.catalogId===catalogId).map(o=>{
          const f = forecastOfficer({ today:new Date().toISOString().slice(0,10), officer:o, player:p, officerCatalog:state.officerCatalog });
          return `<tr><td><strong>${playerLink(p)}</strong></td><td>${fmtNum(o.level)}</td><td>${fmtNum(o.coupons)}</td><td>${renderStars(o.stars)}</td><td>${canSeeStock(p.id)?`${fmtNum(p.stock.coupons)}/${fmtNum(p.stock.puzzles)}/${fmtNum(p.stock.chests)}`:'Скрыто'}</td><td>${f.date || 'за пределами прогноза'}</td></tr>`;
        })).join('') || '<tr><td colspan="6" class="empty-state">Никто не качает этого офицера</td></tr>'}</tbody>
      </table>
    </div>

    <div class="section-header"><div class="section-title">История участия в ивентах</div></div>
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

function openPlayerModal(playerId=null) {
  editPlayerId = playerId;
  document.getElementById('modal-player-title').textContent = playerId ? 'Редактировать игрока' : 'Новый игрок';
  const p = playerId ? getPlayer(playerId) : null;
  document.getElementById('fp-name').value = p?.name || '';
  document.getElementById('fp-real-name').value = p?.realName || '';
  document.getElementById('fp-rank').value = p?.rank || 'r3';
  document.getElementById('fp-vip').value = p?.sector?.vipLevel || 0;
  document.getElementById('fp-conf').value = p?.sector?.confidentialityLevel || 0;
  document.getElementById('fp-stock-coupons').value = p?.stock?.coupons || 0;
  document.getElementById('fp-stock-puzzles').value = p?.stock?.puzzles || 0;
  document.getElementById('fp-stock-chests').value = p?.stock?.chests || 0;
  document.getElementById('fp-power').value = p?.sector?.power || 0;
  document.getElementById('fp-kills').value = p?.sector?.kills || 0;
  document.getElementById('fp-kill-points').value = p?.sector?.killPoints || 0;
  officerRows = p ? p.officers.map(o=>({...o})) : [{ id:'new_'+Date.now(), catalogId:state.officerCatalog[0]?.id, level:0, coupons:0, stars:0 }];
  renderOfficerRows();
  openModal('modal-player');
}

function renderOfficerRows() {
  document.getElementById('fp-officers-list').innerHTML = officerRows.map((o,i)=>`
    <div class="officer-row">
      <select onchange="officerRows[${i}].catalogId=this.value">
        ${state.officerCatalog.map(co=>`<option value="${co.id}" ${co.id===o.catalogId?'selected':''}>${co.name}</option>`).join('')}
      </select>
      <input type="number" placeholder="Уровень" value="${o.level}" min="0" max="179" style="width:80px" oninput="officerRows[${i}].level=parseInt(this.value)||0">
      <input type="number" placeholder="Купонов" value="${o.coupons}" min="0" step="500" style="width:100px" oninput="officerRows[${i}].coupons=parseInt(this.value)||0">
      <span class="stars">${Array.from({length:6},(_,s)=>{
        const star = s + 1;
        const cost = starCostFor(star);
        const label = star < 6 ? `${fmtNum(cost)} звезд до ${star}★` : `Итого ${fmtNum(cost)} звезд`;
        return `<button type="button" class="star-btn ${(o.stars||0)>s?'active':''}" title="${label}" aria-label="${label}" onclick="setOfficerStars(${i},${star})">${(o.stars||0)>s?'★':'☆'}</button>`;
      }).join('')}</span>
      <button class="action-btn danger" onclick="officerRows.splice(${i},1);renderOfficerRows()">✕</button>
    </div>`).join('');
}

function addOfficerRow() {
  officerRows.push({ id:'new_'+Date.now(), catalogId:state.officerCatalog[0]?.id, level:0, coupons:0, stars:0 });
  renderOfficerRows();
}

function setOfficerStars(index, stars) {
  officerRows[index].stars = officerRows[index].stars === stars ? stars - 1 : stars;
  renderOfficerRows();
}

function savePlayer() {
  const name = document.getElementById('fp-name').value.trim();
  if (!name) { toast('Введите имя игрока','error'); return; }
  const realName = document.getElementById('fp-real-name').value.trim();
  const rank = document.getElementById('fp-rank').value;
  const sector = {
    vipLevel: Math.max(0,parseInt(document.getElementById('fp-vip').value)||0),
    confidentialityLevel: Math.max(0,parseInt(document.getElementById('fp-conf').value)||0),
    power: Math.max(0,parseInt(document.getElementById('fp-power').value)||0),
    kills: Math.max(0,parseInt(document.getElementById('fp-kills').value)||0),
    killPoints: Math.round(Math.max(0,parseFloat(document.getElementById('fp-kill-points').value)||0) * 10) / 10,
  };
  const stock = {
    coupons: Math.max(0,parseInt(document.getElementById('fp-stock-coupons').value)||0),
    puzzles: Math.max(0,parseInt(document.getElementById('fp-stock-puzzles').value)||0),
    chests: Math.max(0,parseInt(document.getElementById('fp-stock-chests').value)||0),
  };
  const officers = officerRows.filter(o=>o.catalogId).map(o=>({
    id: o.id.startsWith('new_') ? 'o'+state.nextId++ : o.id,
    catalogId: o.catalogId,
    name: getCatalogOfficer(o.catalogId)?.name || '',
    level: Math.max(0,Math.min(MAX_LEVEL-1,parseInt(o.level)||0)),
    coupons: Math.max(0,parseInt(o.coupons)||0),
    stars: Math.max(0,Math.min(6,parseInt(o.stars)||0)),
  }));
  if (editPlayerId) {
    Object.assign(getPlayer(editPlayerId), { name, realName, rank, sector, stock, officers });
    toast(`Игрок «${name}» обновлён`);
  } else {
    const id = state.nextId++;
    state.players.push({ id, name, realName, rank, sector, stock, officers });
    state.currentPlayerId ||= id;
    toast(`Игрок «${name}» добавлён`);
  }
  save(); closeAllModals(); navigate('players');
}

function confirmDeletePlayer(id) {
  const p = getPlayer(id);
  document.getElementById('confirm-text').textContent = `Удалить игрока «${p.name}»?`;
  document.getElementById('confirm-btn').onclick = ()=>{ state.players = state.players.filter(x=>x.id!==id); save(); closeAllModals(); toast('Удалено','info'); navigate('players'); };
  openModal('modal-confirm');
}

// ─── OFFICER CATALOG MODAL ───────────────────────────────────
let editCatalogOfficerId = null;

function openOfficerCatalogModal(id=null) {
  editCatalogOfficerId = id;
  const officer = id ? getCatalogOfficer(id) : null;
  document.getElementById('modal-officer-title').textContent = id ? 'Редактировать офицера' : 'Новый офицер';
  document.getElementById('fo-name').value = officer?.name || '';
  document.getElementById('fo-type').value = officer?.type || 'Танк';
  document.getElementById('fo-generation').value = officer?.generation || 7;
  document.getElementById('fo-coupon-per-puzzle').value = officer?.couponPerPuzzle ?? 500;
  openModal('modal-officer');
}

function saveOfficerCatalog() {
  const name = document.getElementById('fo-name').value.trim();
  if (!name) { toast('Введите имя офицера','error'); return; }
  const data = {
    name,
    type: document.getElementById('fo-type').value,
    generation: Math.max(1,parseInt(document.getElementById('fo-generation').value)||7),
    couponPerPuzzle: Math.max(0,parseInt(document.getElementById('fo-coupon-per-puzzle').value)||0),
    medalsBeforeTraining: 690,
    medalsTraining: 900,
    medalsTotal: 1590,
  };
  if (editCatalogOfficerId) Object.assign(getCatalogOfficer(editCatalogOfficerId), data);
  else state.officerCatalog.push({ id:'catalog-'+state.nextId++, ...data });
  save(); closeAllModals(); toast('Офицер сохранён'); navigate('officers');
}

function confirmDeleteOfficerCatalog(id) {
  const officer = getCatalogOfficer(id);
  const result = canDeleteOfficer(id, state.players);
  if (!result.ok) {
    toast(`Нельзя удалить: используют ${result.blockers.map(p=>p.name).join(', ')}`,'error');
    return;
  }
  document.getElementById('confirm-text').textContent = `Удалить офицера «${officer.name}»?`;
  document.getElementById('confirm-btn').onclick = ()=>{
    state.officerCatalog = state.officerCatalog.filter(o=>o.id!==id);
    save(); closeAllModals(); toast('Офицер удалён','info'); navigate('officers');
  };
  openModal('modal-confirm');
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

function saveEventType() {
  const name = document.getElementById('fet-name').value.trim();
  if (!name) { toast('Введите название','error'); return; }
  const color = document.getElementById('fet-color').value;
  const places = etPlaceRows.filter(p=>p.label.trim()).sort((a,b)=>a.place-b.place);
  if (!places.length) { toast('Добавьте хотя бы одно место','error'); return; }
  if (editEtId) {
    const et = getEventType(editEtId);
    const prizeHistory = [...(et.prizeHistory || []), { date:new Date().toISOString().slice(0,10), places:places.map(p=>({...p})) }];
    Object.assign(et, { name, color, places, prizeHistory });
    toast(`Тип «${name}» обновлён`);
  } else {
    state.eventTypes.push({ id:state.nextId++, name, color, places, prizeHistory:[{ date:new Date().toISOString().slice(0,10), places:places.map(p=>({...p})) }] });
    toast(`Тип «${name}» добавлен`);
  }
  save(); closeAllModals(); navigate('event_types');
}

function confirmDeleteEventType(id) {
  const et = getEventType(id);
  document.getElementById('confirm-text').textContent = `Удалить тип ивента «${et.name}»? Все ивенты этого типа потеряют привязку.`;
  document.getElementById('confirm-btn').onclick = ()=>{ state.eventTypes = state.eventTypes.filter(x=>x.id!==id); save(); closeAllModals(); toast('Удалено','info'); navigate('event_types'); };
  openModal('modal-confirm');
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
      <div style="display:flex;flex-direction:column;gap:3px;align-items:flex-start">${efficiencyBadge}${regBadge}</div>
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

// ─── INIT ────────────────────────────────────────────────────
load();
renderSidebarNav();
renderTopbarProfile();
checkAuth().then(isAuth => {
  if (isAuth) {
    if (currentUser?.rank === 'r3') {
      navigate('my_cabinet');
    } else {
      navigate('calendar');
    }
  }
});
