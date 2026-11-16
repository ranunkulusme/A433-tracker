/**
 * KoW Tracker - Telegram Mini App (TMA) Client Module
 *
 * Encapsulates all mobile Telegram WebApp tabs, navigation, modals,
 * haptics, responsive views, and Mini App authentication flows.
 * Decoupled from desktop desktop application monolith.
 */

// ─── TELEGRAM MINI APP (TMA) SAFE RUNTIME & FALLBACKS ─────────────
let activeTmaTab = 'cabinet';
let tmaEventsSubTab = 'upcoming';

// Standalone safe doTmaApiFetch (independent of script load/execution order)
async function doTmaApiFetch(url, options = {}) {
  // If app.js is loaded and defined __appApiFetch, delegate to it
  if (typeof window !== 'undefined' && typeof window.__appApiFetch === 'function') {
    return window.__appApiFetch(url, options);
  }
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('kow_token') : null;
  const headers = { ...(options.headers || {}) };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  headers['Pragma'] = 'no-cache';
  headers['Cache-Control'] = 'no-cache';

  let body = options.body;
  if (body && typeof body === 'object' && !(typeof FormData !== 'undefined' && body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(url, { ...options, headers, body });
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const message = (data && data.message) || (data && data.error) || res.statusText || 'API Error';
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Global fallback so apiFetch, toast, state, currentUser are safely accessible without lexical identifier collisions
const _tmaGlobal = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this);
if (_tmaGlobal) {
  if (typeof _tmaGlobal.apiFetch === 'undefined') {
    _tmaGlobal.apiFetch = doTmaApiFetch;
  }
  if (typeof _tmaGlobal.currentUser === 'undefined') {
    _tmaGlobal.currentUser = null;
  }
  if (typeof _tmaGlobal.state === 'undefined') {
    _tmaGlobal.state = { players: [], catalog: [], events: [], currentRole: 'r3' };
  }
}
if (typeof window !== 'undefined') {
  if (typeof window.apiFetch === 'undefined') window.apiFetch = doTmaApiFetch;
  if (typeof window.currentUser === 'undefined') window.currentUser = _tmaGlobal?.currentUser || null;
  if (typeof window.state === 'undefined') window.state = _tmaGlobal?.state || { players: [], catalog: [], events: [], currentRole: 'r3' };
}

// Safe fallback for toast notifications
function doTmaToast(msg, type = 'success') {
  if (typeof window !== 'undefined' && typeof window.toast === 'function' && window.toast !== doTmaToast) {
    return window.toast(msg, type);
  }
  if (typeof document !== 'undefined') {
    const container = document.getElementById('toasts') || document.body;
    const t = document.createElement('div');
    t.className = `toast ${type || 'info'}`;
    t.textContent = msg;
    container.appendChild(t);
    setTimeout(() => { try { t.remove(); } catch (_) {} }, 3500);
  }
}
if (_tmaGlobal && typeof _tmaGlobal.toast === 'undefined') {
  _tmaGlobal.toast = doTmaToast;
}
if (typeof window !== 'undefined' && typeof window.toast === 'undefined') {
  window.toast = doTmaToast;
}

function isTmaMode() {
  if (typeof sessionStorage !== 'undefined') {
    try {
      if (sessionStorage.getItem('kow_tma') === '1') return true;
    } catch (_) {}
  }
  if (typeof document !== 'undefined') {
    if (document.documentElement?.classList.contains('tma-mode') || document.body?.classList.contains('tma-mode')) {
      try { sessionStorage.setItem('kow_tma', '1'); } catch (_) {}
      return true;
    }
  }
  if (typeof window === 'undefined') return false;
  if (window.TelegramWebviewProxy || window.TelegramGameProxy) {
    try { sessionStorage.setItem('kow_tma', '1'); } catch (_) {}
    return true;
  }
  if (typeof navigator !== 'undefined' && /Telegram/i.test(navigator.userAgent || '')) {
    try { sessionStorage.setItem('kow_tma', '1'); } catch (_) {}
    return true;
  }
  try {
    const s = window.location.search || '';
    const params = new URLSearchParams(s);
    if (params.get('tma') === '1' || params.has('tma') || s.includes('tma=1') || s.includes('tma=')) {
      try { sessionStorage.setItem('kow_tma', '1'); } catch (_) {}
      return true;
    }
  } catch (_) {}
  try {
    const h = window.location.hash || '';
    if (h.includes('tma=1') || h.includes('tma') || h.includes('tgWebAppData') || h.includes('tgWebAppPlatform') || h.includes('tgWebAppVersion')) {
      try { sessionStorage.setItem('kow_tma', '1'); } catch (_) {}
      return true;
    }
  } catch (_) {}
  const tg = window.Telegram?.WebApp;
  if (tg) {
    if (tg.initData && typeof tg.initData === 'string' && tg.initData.length > 0) {
      try { sessionStorage.setItem('kow_tma', '1'); } catch (_) {}
      return true;
    }
    if (tg.initDataUnsafe && (tg.initDataUnsafe.user || tg.initDataUnsafe.query_id || tg.initDataUnsafe.start_param)) {
      try { sessionStorage.setItem('kow_tma', '1'); } catch (_) {}
      return true;
    }
    if (tg.platform && typeof tg.platform === 'string' && tg.platform !== 'unknown') {
      try { sessionStorage.setItem('kow_tma', '1'); } catch (_) {}
      return true;
    }
  }
  return false;
}

function enableTmaView() {
  if (typeof document === 'undefined') return;
  if (typeof sessionStorage !== 'undefined') {
    try { sessionStorage.setItem('kow_tma', '1'); } catch (_) {}
  }
  if (document.documentElement) {
    document.documentElement.classList.add('tma-mode');
  }
  if (document.body) {
    document.body.classList.add('tma-mode');
  }
  const tmaEl = document.getElementById('tma-app');
  if (tmaEl) {
    tmaEl.style.display = 'flex';
  }
  const appEl = document.getElementById('app');
  if (appEl) {
    appEl.style.display = 'none';
  }
  const authModal = document.getElementById('modal-auth');
  if (authModal) {
    authModal.classList.remove('open');
    authModal.style.display = 'none';
  }
  const overlay = document.getElementById('overlay');
  if (overlay) {
    overlay.classList.remove('open');
    overlay.style.display = 'none';
  }
}

function setupTmaEnvironment() {
  const tg = window.Telegram?.WebApp;
  if (!tg) return;
  try {
    if (typeof tg.ready === 'function') tg.ready();
    if (typeof tg.expand === 'function') tg.expand();
    if (typeof tg.setHeaderColor === 'function') tg.setHeaderColor('#171b22');
    if (typeof tg.setBackgroundColor === 'function') tg.setBackgroundColor('#090a0f');
    if (typeof tg.enableClosingConfirmation === 'function') tg.enableClosingConfirmation();
  } catch (err) {
    console.warn('TMA SDK init error:', err);
  }
}

function tmaHaptic(type = 'light') {
  try {
    const hf = window.Telegram?.WebApp?.HapticFeedback;
    if (!hf) return;
    if (type === 'success' || type === 'error' || type === 'warning') {
      hf.notificationOccurred(type);
    } else {
      hf.impactOccurred(type);
    }
  } catch (_) {}
}

async function doTmaLoadData() {
  if (typeof window !== 'undefined' && typeof window.loadDataFromServer === 'function') {
    return window.loadDataFromServer().catch(() => {});
  }
  if (typeof loadDataFromServer === 'function') {
    return loadDataFromServer().catch(() => {});
  }
}

let tmaAuthPromise = null;
async function initTmaAuth() {
  if (tmaAuthPromise) return tmaAuthPromise;
  tmaAuthPromise = (async () => {
    const tg = window.Telegram?.WebApp;
    const initData = tg?.initData;

    // 1. If Telegram initData is present, attempt WebApp auto-auth
    if (initData) {
      try {
        const res = await doTmaApiFetch('/api/auth/telegram-webapp', {
          method: 'POST',
          body: { initData }
        });
        if (res && res.token && res.user) {
          localStorage.setItem('kow_token', res.token);
          currentUser = res.user;
          if (typeof window !== 'undefined') window.currentUser = currentUser;
          if (res.player) {
            currentUser.player = res.player;
            currentUser.playerName = res.player.name;
          }
          try { localStorage.setItem('kow_user', JSON.stringify(currentUser)); } catch (_) {}
          if (typeof state !== 'undefined' && state) {
            state.currentRole = currentUser.rank;
            state.currentPlayerId = currentUser.playerId || null;
          }
          if (typeof window !== 'undefined' && window.state) {
            window.state.currentRole = currentUser.rank;
            window.state.currentPlayerId = currentUser.playerId || null;
          }
          await doTmaLoadData();
          renderTmaApp();
          return true;
        }
      } catch (err) {
        console.warn('TMA telegram-webapp auth failed:', err);
        if (err && (err.status === 403 || err.message?.includes('PENDING_APPROVAL') || err.error === 'PENDING_APPROVAL')) {
          renderTmaUnboundScreen(err);
          tmaAuthPromise = null;
          return false;
        }
        // For 404 USER_NOT_BOUND, fall through to step 2 to check existing token or self-heal binding
      }
    }

    // 2. Check if user has an existing valid JWT token in localStorage (self-heal binding)
    const existingToken = localStorage.getItem('kow_token');
    if (existingToken) {
      try {
        const data = await doTmaApiFetch('/api/auth/me');
        if (data && data.user) {
          currentUser = data.user;
          if (typeof window !== 'undefined') window.currentUser = currentUser;
          if (data.player) {
            currentUser.player = data.player;
            currentUser.playerName = data.player.name;
          }
          try { localStorage.setItem('kow_user', JSON.stringify(currentUser)); } catch (_) {}
          if (typeof state !== 'undefined' && state) {
            state.currentRole = currentUser.rank;
            state.currentPlayerId = currentUser.playerId || null;
          }
          if (typeof window !== 'undefined' && window.state) {
            window.state.currentRole = currentUser.rank;
            window.state.currentPlayerId = currentUser.playerId || null;
          }

          // If we have initData, bind this telegram account right now so next time it logs in via Step 1!
          if (initData) {
            try {
              await doTmaApiFetch('/api/telegram/bind-webapp', {
                method: 'POST',
                body: { initData }
              });
            } catch (bindErr) {
              console.warn('Self-heal Telegram bind failed:', bindErr);
            }
          }

          await doTmaLoadData();
          renderTmaApp();
          return true;
        }
      } catch (err) {
        console.warn('TMA session check failed:', err);
        localStorage.removeItem('kow_token');
        localStorage.removeItem('kow_user');
      }
    }

    // 3. Fallback: Show unbound screen inside TMA
    tmaAuthPromise = null;
    renderTmaUnboundScreen();
    return false;
  })().catch(e => {
    tmaAuthPromise = null;
    renderTmaUnboundScreen(e);
    return false;
  });
  return tmaAuthPromise;
}

function renderTmaUnboundScreen(err = null) {
  const unboundEl = document.getElementById('tma-unbound-screen');
  if (!unboundEl) return;

  // Hide tabs and action bar
  const tabs = ['cabinet', 'events', 'matrix'];
  tabs.forEach(t => {
    const el = document.getElementById('tma-tab-' + t);
    if (el) el.style.display = 'none';
  });
  const actBar = document.getElementById('tma-action-bar');
  if (actBar) actBar.style.display = 'none';
  const botNav = document.getElementById('tma-bottom-nav');
  if (botNav) botNav.style.display = 'none';

  unboundEl.style.display = 'block';

  const tg = window.Telegram?.WebApp;
  const tgUser = tg?.initDataUnsafe?.user;

  if (err && (err.error === 'PENDING_APPROVAL' || err.status === 403)) {
    unboundEl.innerHTML = `
      <div class="tma-card tma-card-gold" style="text-align:center;padding:28px 16px">
        <div style="font-size:44px;margin-bottom:12px">⏳</div>
        <h3 style="font-size:16px;font-weight:700;color:#fff;margin-bottom:8px">Аккаунт ожидает подтверждения</h3>
        <p style="font-size:13px;color:#9ca3af;line-height:1.5;margin-bottom:20px">
          Ваша заявка зарегистрирована и находится на рассмотрении офицеров штаба (Р4/Р5). Пожалуйста, свяжитесь с руководством альянса.
        </p>
        <button class="tma-main-btn" onclick="initTmaAuth()" type="button" style="margin-bottom:8px">
          🔄 Проверить статус
        </button>
      </div>
    `;
    return;
  }

  unboundEl.innerHTML = `
    <div class="tma-card tma-card-gold" style="padding:20px 16px;position:relative">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <div class="tma-gold-gradient" style="width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;color:#000;box-shadow:0 4px 12px rgba(245,158,11,0.3)">
          🔗
        </div>
        <div>
          <h3 style="font-size:15px;font-weight:700;color:#fff;margin:0">Привязка Telegram</h3>
          <p style="font-size:11.5px;color:#9ca3af;margin:2px 0 0 0">
            ${tgUser ? `Вы: ${escapeHtml(tgUser.first_name || '')} (@${escapeHtml(tgUser.username || String(tgUser.id))})` : 'Войдите для доступа к KoW Tracker'}
          </p>
        </div>
      </div>

      <p style="font-size:12.5px;color:#d1d5db;margin-bottom:14px;line-height:1.45">
        Ваш аккаунт Telegram еще не привязан к профилю в <strong>KoW Tracker</strong>. Войдите, указав логин аккаунта (или название вашего сектора) и пароль для привязки.
      </p>

      <div id="tma-auth-alert" style="${err && (err.message || typeof err === 'string') ? 'display:block;' : 'display:none;'}padding:10px 12px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#fca5a5;font-size:12px;border-radius:10px;margin-bottom:12px">${err ? escapeHtml(typeof err === 'string' ? err : err.message || '') : ''}</div>

      <!-- Quick Login Form -->
      <form id="tma-login-form" onsubmit="handleTmaLoginSubmit(event)" style="display:flex;flex-direction:column;gap:10px">
        <div>
          <label style="display:block;font-size:11px;color:#9ca3af;margin-bottom:4px;font-weight:600">ЛОГИН ИЛИ ИМЯ СЕКТОРА</label>
          <input type="text" id="tma-login-user" required autocomplete="username" placeholder="Логин аккаунта или название сектора" class="tma-input" style="padding:10px 12px">
        </div>
        <div>
          <label style="display:block;font-size:11px;color:#9ca3af;margin-bottom:4px;font-weight:600">ПАРОЛЬ</label>
          <input type="password" id="tma-login-pass" required autocomplete="current-password" placeholder="Пароль" class="tma-input" style="padding:10px 12px">
        </div>
        <button type="submit" id="tma-login-btn" class="tma-main-btn" style="margin-top:4px">
          🔑 Войти и привязать Telegram
        </button>
      </form>

      <!-- Toggle registration -->
      <div style="margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.08);text-align:center">
        <button type="button" onclick="toggleTmaRegisterSection()" style="background:none;border:none;color:#fbbf24;font-size:12px;font-weight:600;cursor:pointer">
          ✨ Новый игрок? Создать аккаунт
        </button>
      </div>

      <!-- Registration Form (Hidden by default) -->
      <form id="tma-register-form" onsubmit="handleTmaRegisterSubmit(event)" style="display:none;flex-direction:column;gap:10px;margin-top:12px">
        <div>
          <label style="display:block;font-size:11px;color:#9ca3af;margin-bottom:4px;font-weight:600">ЖЕЛАЕМЫЙ ЛОГИН</label>
          <input type="text" id="tma-reg-user" required placeholder="Например, Commander7" class="tma-input" style="padding:10px 12px">
        </div>
        <div>
          <label style="display:block;font-size:11px;color:#9ca3af;margin-bottom:4px;font-weight:600">ПАРОЛЬ</label>
          <input type="password" id="tma-reg-pass" required placeholder="Придумайте пароль" class="tma-input" style="padding:10px 12px">
        </div>
        <div>
          <label style="display:block;font-size:11px;color:#9ca3af;margin-bottom:4px;font-weight:600">ИМЯ ПЕРСОНАЖА / СЕКТОРА</label>
          <input type="text" id="tma-reg-player" required placeholder="Например, Sector 7" class="tma-input" style="padding:10px 12px">
        </div>
        <button type="submit" id="tma-reg-btn" class="tma-main-btn" style="margin-top:4px">
          📝 Зарегистрироваться
        </button>
      </form>
    </div>

    <!-- Bot instruction hint -->
    <div class="tma-card" style="font-size:12px;color:#9ca3af;line-height:1.45">
      💡 <strong>Совет:</strong> Вы также можете привязать аккаунт прямо в чате с ботом, отправив команду:<br>
      <code style="display:inline-block;margin-top:6px;padding:4px 8px;background:#1f242e;border-radius:6px;color:#fbbf24;font-family:monospace;font-size:12px">/bind ваш_логин ваш_пароль</code>
    </div>
  `;
}

function toggleTmaRegisterSection() {
  const form = document.getElementById('tma-register-form');
  if (form) {
    const isHidden = form.style.display === 'none';
    form.style.display = isHidden ? 'flex' : 'none';
  }
}

async function handleTmaLoginSubmit(event) {
  if (event) event.preventDefault();
  const alertEl = document.getElementById('tma-auth-alert');
  const userInp = document.getElementById('tma-login-user');
  const passInp = document.getElementById('tma-login-pass');
  const btn = document.getElementById('tma-login-btn');

  if (!userInp || !passInp) return;
  const username = userInp.value.trim();
  const password = passInp.value;
  if (!username || !password) return;

  if (btn) { btn.disabled = true; btn.textContent = 'Вход...'; }
  if (alertEl) alertEl.style.display = 'none';

  try {
    const tg = window.Telegram?.WebApp;
    const initData = tg?.initData || '';
    const body = { username, password };
    if (initData) body.initData = initData;

    const res = await doTmaApiFetch('/api/auth/login', {
      method: 'POST',
      body
    });

    if (res && res.token && res.user) {
      localStorage.setItem('kow_token', res.token);
      currentUser = res.user;
      if (typeof window !== 'undefined') window.currentUser = currentUser;
      if (res.player) {
        currentUser.player = res.player;
        currentUser.playerName = res.player.name;
      }
      try { localStorage.setItem('kow_user', JSON.stringify(currentUser)); } catch (_) {}
      if (typeof state !== 'undefined' && state) {
        state.currentRole = currentUser.rank;
        state.currentPlayerId = currentUser.playerId || null;
      }
      if (typeof window !== 'undefined' && window.state) {
        window.state.currentRole = currentUser.rank;
        window.state.currentPlayerId = currentUser.playerId || null;
      }

      // Auto-bind Telegram if WebApp initData is present!
      if (initData) {
        try {
          await doTmaApiFetch('/api/telegram/bind-webapp', {
            method: 'POST',
            body: { initData }
          });
        } catch (bindErr) {
          console.warn('Auto bind Telegram failed:', bindErr);
        }
      }

      tmaAuthPromise = null;
      await doTmaLoadData();
      tmaHaptic('success');
      toast('Вход успешно выполнен!', 'success');
      renderTmaApp();
    } else {
      throw new Error(res?.message || 'Неверный логин или пароль');
    }
  } catch (err) {
    tmaAuthPromise = null;
    tmaHaptic('error');
    if (alertEl) {
      alertEl.textContent = err.message || 'Ошибка входа в систему';
      alertEl.style.display = 'block';
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔑 Войти и привязать Telegram'; }
  }
}

async function handleTmaRegisterSubmit(event) {
  if (event) event.preventDefault();
  const alertEl = document.getElementById('tma-auth-alert');
  const userInp = document.getElementById('tma-reg-user');
  const passInp = document.getElementById('tma-reg-pass');
  const playerInp = document.getElementById('tma-reg-player');
  const btn = document.getElementById('tma-reg-btn');

  if (!userInp || !passInp || !playerInp) return;
  const username = userInp.value.trim();
  const password = passInp.value;
  const playerName = playerInp.value.trim();
  if (!username || !password || !playerName) return;

  if (btn) { btn.disabled = true; btn.textContent = 'Регистрация...'; }
  if (alertEl) alertEl.style.display = 'none';

  try {
    const tg = window.Telegram?.WebApp;
    const initData = tg?.initData || '';
    const regBody = { username, password, playerName };
    if (initData) regBody.initData = initData;

    const regRes = await doTmaApiFetch('/api/auth/register', {
      method: 'POST',
      body: regBody
    });

    if (regRes.pendingApproval || !regRes.is_approved) {
      renderTmaUnboundScreen({ error: 'PENDING_APPROVAL' });
      tmaHaptic('warning');
      return;
    }

    // Auto login
    const loginBody = { username, password };
    if (initData) loginBody.initData = initData;
    const loginRes = await doTmaApiFetch('/api/auth/login', {
      method: 'POST',
      body: loginBody
    });

    if (loginRes && loginRes.token && loginRes.user) {
      localStorage.setItem('kow_token', loginRes.token);
      currentUser = loginRes.user;
      if (typeof window !== 'undefined') window.currentUser = currentUser;
      if (loginRes.player) {
        currentUser.player = loginRes.player;
        currentUser.playerName = loginRes.player.name;
      }
      try { localStorage.setItem('kow_user', JSON.stringify(currentUser)); } catch (_) {}
      if (typeof state !== 'undefined' && state) {
        state.currentRole = currentUser.rank;
        state.currentPlayerId = currentUser.playerId || null;
      }
      if (typeof window !== 'undefined' && window.state) {
        window.state.currentRole = currentUser.rank;
        window.state.currentPlayerId = currentUser.playerId || null;
      }

      // Auto bind telegram if WebApp initData is present
      if (initData) {
        try {
          await doTmaApiFetch('/api/telegram/bind-webapp', {
            method: 'POST',
            body: { initData }
          });
        } catch (_) {}
      }

      tmaAuthPromise = null;
      await doTmaLoadData();
      tmaHaptic('success');
      toast('Регистрация завершена!', 'success');
      renderTmaApp();
    }
  } catch (err) {
    tmaAuthPromise = null;
    tmaHaptic('error');
    if (alertEl) {
      alertEl.textContent = err.message || 'Ошибка регистрации';
      alertEl.style.display = 'block';
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📝 Зарегистрироваться'; }
  }
}

function renderTmaApp() {
  const unboundEl = document.getElementById('tma-unbound-screen');
  if (unboundEl) unboundEl.style.display = 'none';

  const actBar = document.getElementById('tma-action-bar');
  if (actBar) actBar.style.display = 'block';
  const botNav = document.getElementById('tma-bottom-nav');
  if (botNav) botNav.style.display = 'flex';

  // Update Role badge in header
  const roleBadge = document.getElementById('tma-user-role-badge');
  if (roleBadge) {
    const role = (currentUser?.rank || 'r3').toUpperCase();
    roleBadge.textContent = role;
    roleBadge.className = role === 'R5' ? 'badge badge-danger' : (role === 'R4' ? 'badge badge-primary' : 'badge badge-warning');
  }

  switchTmaTab(activeTmaTab || 'cabinet');
}

function formatTmaCouponsShort(n) {
  if (!n) return '0';
  if (n >= 1000) {
    const k = n / 1000;
    return (Number.isInteger(k) ? k : k.toFixed(1)) + 'к';
  }
  return String(n);
}

function updateTmaMainButton() {
  const mainBtnIcon = document.getElementById('tma-main-btn-icon');
  const mainBtnText = document.getElementById('tma-main-btn-text');
  if (!mainBtnIcon || !mainBtnText) return;

  if (activeTmaTab === 'cabinet') {
    mainBtnIcon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
    mainBtnText.textContent = 'Сканировать склад (OCR)';
  } else if (activeTmaTab === 'events') {
    if (tmaEventsSubTab === 'upcoming') {
      mainBtnIcon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
      mainBtnText.textContent = 'Подать заявку на событие';
    } else {
      mainBtnIcon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`;
      mainBtnText.textContent = 'Сетка результатов';
    }
  } else if (activeTmaTab === 'matrix') {
    mainBtnIcon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
    mainBtnText.textContent = 'Обновить сводку гильдии';
  }
}

function switchTmaTab(tab) {
  activeTmaTab = tab || 'cabinet';
  tmaHaptic('light');

  const tabs = ['cabinet', 'events', 'matrix'];
  tabs.forEach(t => {
    const pane = document.getElementById('tma-tab-' + t);
    if (pane) pane.style.display = (t === activeTmaTab) ? 'block' : 'none';

    const btn = document.getElementById('tma-tab-btn-' + t);
    if (btn) {
      if (t === activeTmaTab) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
  });

  updateTmaMainButton();

  if (activeTmaTab === 'cabinet') {
    renderTmaCabinet();
  } else if (activeTmaTab === 'events') {
    renderTmaEvents();
  } else if (activeTmaTab === 'matrix') {
    renderTmaMatrix();
  }
}

function switchTmaEventsSubTab(subTab) {
  tmaEventsSubTab = subTab;
  tmaHaptic('light');

  const isUp = subTab === 'upcoming';
  const listUp = document.getElementById('tma-events-list-upcoming');
  const listPast = document.getElementById('tma-events-list-past');
  if (listUp) listUp.style.display = isUp ? 'block' : 'none';
  if (listPast) listPast.style.display = isUp ? 'none' : 'block';

  const btnUp = document.getElementById('tma-events-subtab-upcoming');
  const btnPast = document.getElementById('tma-events-subtab-past');
  if (btnUp && btnPast) {
    if (isUp) {
      btnUp.style.backgroundColor = 'rgba(245, 158, 11, 0.2)';
      btnUp.style.color = '#fbbf24';
      btnUp.style.borderColor = 'rgba(245, 158, 11, 0.3)';
      btnPast.style.backgroundColor = 'transparent';
      btnPast.style.color = '#9ca3af';
      btnPast.style.borderColor = 'transparent';
    } else {
      btnPast.style.backgroundColor = 'rgba(245, 158, 11, 0.2)';
      btnPast.style.color = '#fbbf24';
      btnPast.style.borderColor = 'rgba(245, 158, 11, 0.3)';
      btnUp.style.backgroundColor = 'transparent';
      btnUp.style.color = '#9ca3af';
      btnUp.style.borderColor = 'transparent';
    }
  }

  updateTmaMainButton();
}

function renderTmaCabinet() {
  const container = document.getElementById('tma-tab-cabinet');
  if (!container) return;

  const player = state.players.find(p => Number(p.id) === Number(currentUser?.playerId))
    || myCabinetProfile
    || (currentUser?.player ? currentUser.player : null)
    || state.players[0]
    || {};

  const sector = player.sector || {};
  const stock = player.stock || {};
  const role = (player.rank || currentUser?.rank || 'r3').toUpperCase();
  const playerName = player.name || currentUser?.username || 'Sector 7';
  const playerPower = player?.sector?.power ?? player?.power ?? 0;
  const playerVip = player?.sector?.vipLevel ?? player?.vip ?? '—';

  // Freshness calculation
  const updatedAt = stock.updatedAt || player.updatedAt || player.created_at;
  let daysAgo = 0;
  if (updatedAt) {
    daysAgo = Math.floor((Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24));
  }
  const isFresh = daysAgo <= 3;

  // Ensure myCabinetProfile points to active player
  if (!myCabinetProfile || Number(myCabinetProfile.id) !== Number(player.id)) {
    myCabinetProfile = player;
  }

  // Target Officer & Progression calculation
  const officers = player.officers || [];
  const customTargetId = state.tmaTargetOfficerId || (typeof localStorage !== 'undefined' ? localStorage.getItem('kow_tma_target_' + (player.id || currentUser?.playerId)) : null);
  let targetOfficer = null;
  if (customTargetId) {
    targetOfficer = officers.find(o => String(o.id) === String(customTargetId));
  }
  if (!targetOfficer) {
    targetOfficer = officers.find(o => !o.isMaxed && (o.isTarget || o.priority))
      || officers.find(o => o.isTarget)
      || officers[0]
      || null;
  }
  let officerName = 'Офицер';
  let offType = 'Пехота';
  let offGen = '';
  let offLevel = 0;
  let skillsStr = '1-1-1-1';
  let progressPct = 0;
  let remainingCoupons = 0;
  let remainingDays = 0;
  let isFull = false;

  if (targetOfficer) {
    const cat = getCatalogOfficer(targetOfficer.catalogId) || { couponPerPuzzle: 500, generation: 7, type: 'Пехота' };
    officerName = targetOfficer.name || cat?.name || 'Офицер';
    offType = cat?.type || 'Пехота';
    offGen = cat?.generation ? `G${cat.generation}` : '';
    offLevel = Math.max(0, Number(targetOfficer.level) || 0);

    const skills = (Array.isArray(targetOfficer.skills) && targetOfficer.skills.length === 4)
      ? targetOfficer.skills.map(s => Number(s) || 1)
      : [1, 1, 1, 1];
    skillsStr = skills.join('-');
    const sumSkills = skills.reduce((a, b) => a + Number(b || 0), 0);
    const skillsFull = skills.every(s => Number(s) >= 5);

    const rawCost = Number(cat?.couponPerPuzzle);
    const costPerPuzzle = rawCost === 0
      ? (cat?.upgradeType === 'special' ? 0 : 500)
      : (rawCost || (cat?.generation === 7 ? 600 : (cat?.generation >= 8 ? 720 : 500)));
    const today = new Date().toISOString().slice(0, 10);

    const def = (typeof logic !== 'undefined' && logic.calculateOfficerDeficit)
      ? logic.calculateOfficerDeficit({
          officer: targetOfficer,
          catalogItem: { ...cat, couponPerPuzzle: costPerPuzzle },
          player,
          targetLevel: 180,
          today
        })
      : null;

    if (def) {
      if (def.isOnlyPersonalPuzzles) {
        remainingCoupons = 0;
        remainingDays = 0;
        isFull = (def.deficitPuzzles === 0);
        const currentPuz = (def.currentPuzzles || 0);
        const targetPuz = def.targetPuzzles || 900;
        progressPct = isFull ? 100 : Math.min(100, Math.max(0, Math.round((currentPuz / Math.max(1, targetPuz)) * 100)));
      } else {
        remainingCoupons = def.deficitCoupons || 0;
        remainingDays = def.daysWithoutEvents !== null ? def.daysWithoutEvents : 0;
        isFull = (def.deficitPuzzles === 0 && remainingCoupons === 0);
        const currentPuz = (def.currentPuzzles || 0) + (def.stockPuzzles || 0);
        const targetPuz = def.targetPuzzles || 900;
        progressPct = isFull ? 100 : Math.min(100, Math.max(0, Math.round((currentPuz / Math.max(1, targetPuz)) * 100)));
      }
    } else {
      isFull = (offLevel >= 180 && skillsFull);
      progressPct = isFull ? 100 : Math.min(100, Math.max(0, Math.round((offLevel / 180) * 100)));
    }
  }

  // Next Upcoming Event
  const upcomingEvents = (state.events || [])
    .filter(e => !e.isCompleted && e.status !== 'completed')
    .sort((a, b) => new Date(a.startDate || a.dateStart || 0) - new Date(b.startDate || b.dateStart || 0));
  const nextEvent = upcomingEvents[0] || null;

  let nextEventHtml = '';
  if (nextEvent) {
    const evDateStr = (nextEvent.startDate || nextEvent.dateStart)
      ? new Date(nextEvent.startDate || nextEvent.dateStart).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ', 00:00 UTC'
      : 'Скоро';
    const myReg = (nextEvent.registrations || []).find(r => Number(r.playerId || r.sectorId) === Number(player.id || currentUser?.playerId));

    let regStatusSnippet = '';
    if (myReg) {
      const placeText = (myReg.desiredPlace === 0 || !myReg.desiredPlace) ? 'Любое' : `#${myReg.desiredPlace}`;
      regStatusSnippet = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding-top:6px">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:16px">🥇</span>
            <span style="font-size:12px;font-weight:700;color:#fde68a">Ваша заявка: Место ${placeText}</span>
          </div>
          <span style="font-size:11px;font-weight:700;color:#fbbf24;background:rgba(245,158,11,0.15);padding:2px 8px;border-radius:6px;border:1px solid rgba(245,158,11,0.25)">Записан</span>
        </div>
      `;
    } else {
      regStatusSnippet = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding-top:6px">
          <span style="font-size:12px;color:#9ca3af">Регистрация открыта</span>
          <button type="button" onclick="event.stopPropagation();openTmaEventDetail(${nextEvent.id})" class="tma-event-reg-btn" style="padding:4px 12px;font-size:11.5px">
            Записаться
          </button>
        </div>
      `;
    }

    nextEventHtml = `
      <!-- Next Event Quick Card -->
      <div class="tma-card" onclick="openTmaEventDetail(${nextEvent.id})" style="background:linear-gradient(135deg,#17202e 0%,#161a22 100%);border-color:rgba(14,165,233,0.3);cursor:pointer">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <span style="padding:2px 8px;font-size:10px;font-weight:700;background:rgba(14,165,233,0.2);color:#38bdf8;border-radius:6px;border:1px solid rgba(14,165,233,0.3)">
            Ближайший ивент • Подробнее ↗
          </span>
          <span style="font-size:11.5px;color:#9ca3af">${escapeHtml(evDateStr)}</span>
        </div>
        <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:4px">
          ${escapeHtml(nextEvent.title || nextEvent.name || 'Событие #' + nextEvent.id)}
        </div>
        ${regStatusSnippet}
      </div>
    `;
  } else {
    nextEventHtml = `
      <div class="tma-card" style="font-size:12.5px;color:#9ca3af;text-align:center;padding:16px">
        Нет запланированных событий в ближайшие дни
      </div>
    `;
  }

  const userSectors = getUserSectors();
  let sectorSwitcherHtml = '';
  if (userSectors.length > 1) {
    const activeId = Number(player.id || currentUser?.playerId);
    sectorSwitcherHtml = `
      <div class="tma-sector-chips" id="tma-sector-switcher">
        ${userSectors.map(s => {
          const sId = Number(s.id);
          const isActive = sId === activeId;
          const sVip = s.sector?.vipLevel ?? s.vip ?? 0;
          return `
            <button type="button" class="tma-sector-chip ${isActive ? 'active' : ''}" onclick="handleTmaSwitchSector(${sId})">
              <span>👑</span>
              <span>${escapeHtml(s.name || 'Сектор #' + sId)}</span>
              <span style="opacity:0.75;font-size:10px">(VIP ${sVip})</span>
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  container.innerHTML = `
    ${sectorSwitcherHtml}

    <!-- Player Badge Card -->
    <div class="tma-card tma-card-gold" style="position:relative;overflow:hidden">
      <div style="position:absolute;right:-20px;bottom:-20px;width:100px;height:100px;background:rgba(245,158,11,0.1);border-radius:999px;filter:blur(24px);pointer-events:none"></div>
      
      <!-- Upper part: click to edit sector parameters -->
      <div class="tma-card-clickable" onclick="openTmaSectorEditModal()" title="Нажмите для редактирования параметров сектора" style="display:flex;align-items:flex-start;justify-content:space-between;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.08)">
        <div style="display:flex;align-items:center;gap:12px">
          <div class="tma-gold-gradient" style="width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#000;font-weight:900;font-size:15px;box-shadow:0 4px 12px rgba(245,158,11,0.3)">
            KOW
          </div>
          <div>
            <div style="display:flex;align-items:center;gap:8px">
              <h2 style="font-size:14.5px;font-weight:700;color:#fff;margin:0">${escapeHtml(playerName)}</h2>
              <span class="tma-badge-rank">${escapeHtml(role)}</span>
              <span style="font-size:11px;opacity:0.75" title="Редактировать параметры сектора">✏️</span>
            </div>
            <p style="font-size:12px;color:#9ca3af;margin:2px 0 0 0">
              Сила: <strong style="color:#fff">${fmtNum(playerPower)}</strong> • VIP: <strong style="color:#fbbf24">${playerVip}</strong>
            </p>
          </div>
        </div>

        <span style="padding:2px 8px;border-radius:999px;font-size:10px;font-weight:600;display:inline-flex;align-items:center;gap:4px;border:1px solid;${isFresh ? 'background:rgba(16,185,129,0.15);color:#34d399;border-color:rgba(16,185,129,0.3)' : 'background:rgba(239,68,68,0.15);color:#f87171;border-color:rgba(239,68,68,0.3)'}">
          <span style="width:6px;height:6px;border-radius:999px;background:currentColor"></span>
          ${isFresh ? (daysAgo === 0 ? 'Свежий' : `${daysAgo}д назад`) : `Устарел (${daysAgo}д)`}
        </span>
      </div>

      <!-- Stock Grid: click to edit stock reserves -->
      <div class="tma-card-clickable" onclick="openTmaStockEditModal()" title="Нажмите для изменения запасов склада" style="padding-top:10px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:10.5px;color:#9ca3af;font-weight:600">Складские запасы</span>
          <span style="font-size:10.5px;color:#fbbf24;font-weight:600">✏️ Изменить</span>
        </div>
        <div class="tma-stock-grid">
          <div class="tma-stock-cell">
            <div class="tma-stock-label">🎟️ Купон офицера</div>
            <div class="tma-stock-val" style="color:#fbbf24">${fmtNum(stock.coupons || 0)}</div>
          </div>
          <div class="tma-stock-cell">
            <div class="tma-stock-label">🧩 Медаль офицера</div>
            <div class="tma-stock-val" style="color:#38bdf8">${fmtNum(stock.puzzles || 0)}</div>
          </div>
          <div class="tma-stock-cell">
            <div class="tma-stock-label">🌟 Звезды I / II / III</div>
            <div class="tma-stock-val" style="color:#c084fc">
              ${stock.legendaryStars1 || 0} / ${stock.legendaryStars2 || 0} / ${stock.legendaryStars3 || 0}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Target Officer Progression Simulator -->
    ${targetOfficer ? `
    <div class="tma-card tma-card-clickable" onclick="openTmaOfficersPickerModal()" style="border-color:rgba(245,158,11,0.25);cursor:pointer" title="Нажмите, чтобы выбрать офицера в калькулятор">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:36px;height:36px;border-radius:10px;background:#fbbf24;color:#000;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:14px;box-shadow:0 2px 8px rgba(245,158,11,0.4)">
            ${escapeHtml(officerName.charAt(0))}
          </div>
          <div>
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:13.5px;font-weight:800;color:#fff">${escapeHtml(officerName)}</span>
              <span style="font-size:10px;color:#fbbf24;background:rgba(245,158,11,0.15);padding:1px 6px;border-radius:4px;border:1px solid rgba(245,158,11,0.3);font-weight:700">★ Цель</span>
            </div>
            <span style="font-size:11px;color:#9ca3af;margin-top:1px;display:block">
              ${escapeHtml(offType)}${offGen ? ` • ${offGen}` : ''} • Ур. ${offLevel} (${escapeHtml(skillsStr)})
            </span>
          </div>
        </div>
        <span style="font-size:11px;color:#fbbf24;font-weight:700;background:rgba(245,158,11,0.1);padding:3px 8px;border-radius:6px;border:1px solid rgba(245,158,11,0.2)">Сменить ⭐</span>
      </div>

      <!-- Progress Track -->
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px">
          <span style="color:#9ca3af;font-weight:600">Прогресс прокачки (Ур. ${offLevel}/180)</span>
          <span style="color:#fff;font-weight:800">${progressPct}%</span>
        </div>
        <div class="tma-progress-track">
          <div class="tma-progress-fill" style="width:${progressPct}%"></div>
        </div>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;background:#1f242e;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,0.04)">
        <div>
          <div style="font-size:10px;color:#9ca3af">Остаточный дефицит:</div>
          <div style="font-weight:800;color:${isFull ? '#34d399' : '#fbbf24'};font-size:13px;margin-top:1px">
            ${isFull ? '0 (готов к прокачке! 🎉)' : fmtNum(remainingCoupons) + ' куп.'}
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-size:10px;color:#9ca3af">${isFull ? 'Статус:' : `Срок (с VIP ${playerVip}):`}</div>
          <div style="font-weight:800;color:#34d399;font-size:13px;margin-top:1px">
            ${isFull ? 'Фулл прокачка! 🎉' : (remainingDays !== null && remainingDays !== undefined ? `~${remainingDays} дней` : '—')}
          </div>
        </div>
      </div>
    </div>
    ` : `
    <div class="tma-card tma-card-clickable" onclick="openTmaOfficersPickerModal()" style="border-color:rgba(245,158,11,0.25);cursor:pointer;padding:16px;text-align:center" title="Нажмите, чтобы выбрать офицера в калькулятор">
      <div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;margin-bottom:8px">
        <span style="color:#9ca3af;font-weight:600">🎯 Калькулятор прокачки</span>
        <span style="font-size:11px;color:#fbbf24;font-weight:700">+ Выбрать офицера</span>
      </div>
      <p style="font-size:12px;color:#9ca3af;margin:6px 0 0 0">
        Добавьте или выберите офицера для расчета дефицита и срока прокачки ⭐
      </p>
    </div>
    `}

    <!-- Sector Officers Section -->
    ${renderTmaOfficersSectionHtml(officers, targetOfficer, player)}

    ${nextEventHtml}
  `;
}

function getTmaEventIcon(title = '') {
  const low = (title || '').toLowerCase();
  if (low.includes('сил') || low.includes('войн') || low.includes('битв') || low.includes('war')) return '⚔️';
  if (low.includes('врем') || low.includes('time')) return '⏳';
  if (low.includes('огн') || low.includes('fire')) return '🔥';
  if (low.includes('звезд') || low.includes('star')) return '⭐';
  return '🏆';
}

function renderTmaEvents() {
  const container = document.getElementById('tma-tab-events');
  if (!container) return;

  const player = state.players.find(p => Number(p.id) === Number(currentUser?.playerId))
    || myCabinetProfile
    || (currentUser?.player ? currentUser.player : null)
    || state.players[0]
    || {};

  const myPlayerId = player.id || currentUser?.playerId;
  const isStaff = currentUser?.rank === 'r4' || currentUser?.rank === 'r5' || (typeof logic !== 'undefined' && logic.hasUserPermission(currentUser, 'manage_events'));

  // Sort upcoming and past events
  const upcomingEvents = (state.events || [])
    .filter(e => !e.isCompleted && e.status !== 'completed')
    .sort((a, b) => new Date(a.startDate || a.dateStart || 0) - new Date(b.startDate || b.dateStart || 0));

  const pastEvents = (state.events || [])
    .filter(e => e.isCompleted || e.status === 'completed')
    .sort((a, b) => new Date(b.startDate || b.dateStart || 0) - new Date(a.startDate || a.dateStart || 0));

  // Upcoming HTML
  let upcomingHtml = '';
  if (upcomingEvents.length === 0) {
    upcomingHtml = `
      <div class="tma-card" style="text-align:center;padding:24px 16px;color:#9ca3af;font-size:13px">
        <div style="font-size:32px;margin-bottom:8px">📅</div>
        Нет активных предстоящих событий
      </div>
    `;
  } else {
    upcomingHtml = upcomingEvents.map(ev => {
      const myReg = (ev.registrations || []).find(r => Number(r.playerId || r.sectorId) === Number(myPlayerId));
      const evTitle = ev.title || ev.name || ('Событие #' + ev.id);
      const evIcon = getTmaEventIcon(evTitle);

      const dStart = ev.startDate || ev.dateStart || ev.dateFrom;
      const dEnd = ev.endDate || ev.dateEnd || ev.dateTo;
      let evDateRange = '';
      if (dStart) {
        const sStr = new Date(dStart).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
        if (dEnd) {
          const eStr = new Date(dEnd).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
          evDateRange = `${sStr} — ${eStr}`;
        } else {
          evDateRange = sStr;
        }
      } else {
        evDateRange = 'Дата уточняется';
      }

      const maxPlaces = (ev.places && ev.places.length) || ev.placesCount || ev.maxPlaces || 5;

      // Status badge
      let statusBadgeHtml = '';
      if (myReg) {
        const placeStr = (myReg.desiredPlace === 0 || !myReg.desiredPlace) ? 'Любое' : `#${myReg.desiredPlace}`;
        statusBadgeHtml = `
          <span class="tma-badge-status is-gold">
            Вы записаны (${placeStr})
          </span>
        `;
      } else {
        statusBadgeHtml = `
          <span class="tma-badge-status is-green">
            Запись
          </span>
        `;
      }

      const staffPencilHtml = isStaff ? `
        <button type="button" onclick="event.stopPropagation();openTmaEventEditor(${ev.id})" class="tma-quick-btn" style="padding:4px 8px;font-size:11.5px" title="Редактировать событие">
          ✏️
        </button>
      ` : '';

      // Top-3 prizes snippet
      const placesArr = (ev.places && ev.places.length > 0) ? ev.places : (ev.eventType?.places || []);
      const top3 = placesArr.slice(0, 3);
      let prizesSnippetHtml = '';
      if (top3.length > 0) {
        prizesSnippetHtml = `
          <div style="display:grid;grid-template-columns:repeat(${Math.min(3, top3.length)}, 1fr);gap:6px;margin:10px 0">
            ${top3.map(p => `
              <div style="background:#1f242e;padding:6px;border-radius:8px;text-align:center;border:1px solid rgba(255,255,255,0.04)">
                <span style="font-size:9.5px;color:#9ca3af;display:block">#${p.place} место</span>
                <span style="font-size:11.5px;font-weight:800;color:#fbbf24">${fmtNum(p.coupons || 0)} 🎟️</span>
              </div>
            `).join('')}
          </div>
        `;
      }

      // My registration row if registered
      let myRegBanner = '';
      if (myReg) {
        const placeStr = (myReg.desiredPlace === 0 || !myReg.desiredPlace) ? 'Любое' : `#${myReg.desiredPlace}`;
        myRegBanner = `
          <div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.25);border-radius:10px;padding:6px 10px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:13px">🎯</span>
              <span style="font-size:11px;font-weight:700;color:#fde68a">Ваша заявка: Место ${placeStr}</span>
            </div>
            <button type="button" onclick="event.stopPropagation();handleTmaUnregisterEvent(${ev.id})" style="background:none;border:none;color:#ef4444;font-size:10.5px;font-weight:700;cursor:pointer;padding:2px 4px">
              ✕ Отменить
            </button>
          </div>
        `;
      }

      const regCount = (ev.registrations || []).length;

      return `
        <div class="tma-card" onclick="openTmaEventDetail(${ev.id})" style="padding:14px;border-radius:16px;background:#1f242e;border:1px solid rgba(255,255,255,0.08);margin-bottom:10px;cursor:pointer">
          <div style="display:flex;align-items:flex-start;justify-content:space-between">
            <div>
              <div style="display:flex;align-items:center;gap:6px">
                <span style="font-size:14px">${evIcon}</span>
                <h3 style="font-size:13px;font-weight:800;color:#fff;margin:0">${escapeHtml(evTitle)}</h3>
              </div>
              <p style="font-size:11px;color:#9ca3af;margin:2px 0 0 0">${escapeHtml(evDateRange)} • ${maxPlaces} призовых мест</p>
            </div>
            <div style="display:flex;align-items:center;gap:6px">
              ${staffPencilHtml}
              ${statusBadgeHtml}
            </div>
          </div>

          ${prizesSnippetHtml}
          ${myRegBanner}

          <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;color:#9ca3af;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06)">
            <span>Заявок бойцов: <strong style="color:#fff">${regCount}</strong></span>
            <span style="color:#fbbf24;font-weight:700;display:flex;align-items:center;gap:2px">
              Участники и назначения ↗
            </span>
          </div>
        </div>
      `;
    }).join('');
  }

  // Past HTML
  let pastHtml = '';
  if (pastEvents.length === 0) {
    pastHtml = `
      <div class="tma-card" style="text-align:center;padding:24px 16px;color:#9ca3af;font-size:13px">
        <div style="font-size:32px;margin-bottom:8px">📜</div>
        Нет завершенных событий
      </div>
    `;
  } else {
    pastHtml = pastEvents.map(ev => {
      const evTitle = ev.title || ev.name || ('Событие #' + ev.id);
      const evIcon = getTmaEventIcon(evTitle);
      const evDate = (ev.startDate || ev.dateStart || ev.dateFrom)
        ? new Date(ev.startDate || ev.dateStart || ev.dateFrom).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
        : '';
      const myRes = (ev.results || []).find(r => Number(r.playerId || r.sectorId) === Number(myPlayerId));

      let myResBlock = '';
      if (myRes) {
        myResBlock = `
          <div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:10px;padding:8px 10px;display:flex;align-items:center;justify-content:space-between;margin:8px 0">
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:15px">🎯</span>
              <div>
                <div style="font-size:11.5px;font-weight:700;color:#fde68a">Ваш результат: Место #${myRes.place || myRes.actualPlace || 1}</div>
              </div>
            </div>
            <span style="font-size:11.5px;font-weight:800;color:#fbbf24">
              +${fmtNum(myRes.couponsWon || myRes.prizeCoupons || 40000)} 🎟️
            </span>
          </div>
        `;
      }

      let winnerHtml = '';
      if (ev.results && ev.results.length > 0) {
        const first = ev.results[0];
        const pName = first.playerName || first.sectorName || `Sector ${first.playerId || first.sectorId}`;
        winnerHtml = `
          <div style="margin-top:6px;font-size:11.5px;color:#fbbf24;font-weight:700">
            🏆 Победитель: ${escapeHtml(pName)} (+${fmtNum(first.couponsWon || 30000)} 🎟️)
          </div>
        `;
      }

      return `
        <div class="tma-card" onclick="openTmaEventDetail(${ev.id})" style="padding:14px;border-radius:16px;background:#1f242e;border:1px solid rgba(255,255,255,0.08);margin-bottom:10px;cursor:pointer">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:14px">${evIcon}</span>
              <div>
                <h3 style="font-size:13px;font-weight:800;color:#d1d5db;margin:0">${escapeHtml(evTitle)}</h3>
                <p style="font-size:10.5px;color:#6b7280;margin:2px 0 0 0">${escapeHtml(evDate)}</p>
              </div>
            </div>
            <span style="font-size:10px;padding:2px 6px;background:#1f242e;color:#9ca3af;border-radius:4px;border:1px solid rgba(255,255,255,0.04)">
              Архив
            </span>
          </div>
          ${winnerHtml}
          ${myResBlock}
          <div style="display:flex;align-items:center;justify-content:flex-end;font-size:11px;color:#fbbf24;font-weight:700;padding-top:6px;margin-top:8px;border-top:1px solid rgba(255,255,255,0.06)">
            <span>Результаты и участники ↗</span>
          </div>
        </div>
      `;
    }).join('');
  }

  const isUp = tmaEventsSubTab === 'upcoming';
  container.innerHTML = `
    ${isStaff ? `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding:0 2px">
        <span style="font-size:11px;font-weight:800;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px">
          Управление событиями (Р4/Р5)
        </span>
        <button type="button" onclick="openTmaEventEditor(null)" class="tma-btn-primary" style="padding:6px 14px;font-size:11.5px">
          <span style="font-size:13px;font-weight:900;line-height:1">+</span> Создать событие
        </button>
      </div>
    ` : ''}

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding:0 2px">
      <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px">
        Календарь событий
      </div>
      <div style="display:inline-flex;padding:2px;background:#161a22;border:1px solid rgba(255,255,255,0.08);border-radius:10px">
        <button id="tma-events-subtab-upcoming" onclick="switchTmaEventsSubTab('upcoming')" type="button" style="padding:4px 10px;border-radius:8px;font-size:11px;font-weight:700;border:1px solid;cursor:pointer;transition:all 0.15s;${isUp ? 'background:rgba(245,158,11,0.2);color:#fbbf24;border-color:rgba(245,158,11,0.3)' : 'background:transparent;color:#9ca3af;border-color:transparent'}">
          ◎ Предстоящие (${upcomingEvents.length})
        </button>
        <button id="tma-events-subtab-past" onclick="switchTmaEventsSubTab('past')" type="button" style="padding:4px 10px;border-radius:8px;font-size:11px;font-weight:700;border:1px solid;cursor:pointer;transition:all 0.15s;${!isUp ? 'background:rgba(245,158,11,0.2);color:#fbbf24;border-color:rgba(245,158,11,0.3)' : 'background:transparent;color:#9ca3af;border-color:transparent'}">
          ◌ Прошедшие (${pastEvents.length})
        </button>
      </div>
    </div>

    <div id="tma-events-list-upcoming" style="display:${isUp ? 'block' : 'none'}">
      ${upcomingHtml}
    </div>

    <div id="tma-events-list-past" style="display:${isUp ? 'none' : 'block'}">
      ${pastHtml}
    </div>
  `;
}

function renderTmaMatrix() {
  const container = document.getElementById('tma-tab-matrix');
  if (!container) return;

  const player = state.players.find(p => Number(p.id) === Number(currentUser?.playerId))
    || myCabinetProfile
    || (currentUser?.player ? currentUser.player : null)
    || state.players[0]
    || {};

  const myPlayerId = player.id || currentUser?.playerId;
  const sorted = [...(state.players || [])].sort((a, b) => {
    return (b.sector?.power || 0) - (a.sector?.power || 0);
  });

  const rowsHtml = sorted.map((p, idx) => {
    const isMe = Number(p.id) === Number(myPlayerId) || Number(p.userId) === Number(currentUser?.id);
    const sec = p.sector || {};
    const stock = p.stock || {};
    const updatedAt = stock.updatedAt || p.updatedAt;
    let daysAgo = 0;
    if (updatedAt) {
      daysAgo = Math.floor((Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24));
    }
    const isFresh = daysAgo <= 3;

    return `
      <div class="tma-card" onclick="openTmaSectorDetail(${p.id})" style="padding:10px 12px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;${isMe ? 'border-color:rgba(245,158,11,0.4);background:rgba(245,158,11,0.06)' : ''}">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:12px;font-weight:800;color:${idx === 0 ? '#fbbf24' : (idx === 1 ? '#d1d5db' : (idx === 2 ? '#b45309' : '#6b7280'))};width:18px;text-align:center">
            ${idx + 1}
          </span>
          <div>
            <div style="font-size:12.5px;font-weight:700;color:#fff;display:flex;align-items:center;gap:6px">
              ${escapeHtml(p.name || 'Сектор')}
              ${isMe ? '<span style="font-size:9px;font-weight:800;color:#fbbf24;background:rgba(245,158,11,0.25);padding:1px 5px;border-radius:4px">Вы</span>' : ''}
            </div>
            <div style="font-size:11px;color:#9ca3af">
              Сила: ${fmtNum(sec.power || 0)} • VIP ${sec.vipLevel || 0}
            </div>
          </div>
        </div>

        <div style="text-align:right">
          <div style="font-size:12.5px;font-weight:700;color:#fbbf24">
            ${fmtNum(stock.coupons || 0)} 🎟️
          </div>
          <div style="font-size:10px;color:${isFresh ? '#34d399' : '#f87171'}">
            ${isFresh ? '🟢 ' + (daysAgo === 0 ? 'сегодня' : daysAgo + 'д назад') : '🔴 ' + daysAgo + 'д назад'}
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding:0 2px">
      <span style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px">
        Сводка гильдии (Рейтинг)
      </span>
      <span style="font-size:11.5px;color:#fbbf24;font-weight:600">
        ${sorted.length} секторов
      </span>
    </div>

    <div>
      ${rowsHtml || '<div class="tma-card" style="text-align:center;color:#9ca3af">Нет данных о секторах</div>'}
    </div>
  `;
}

async function handleTmaRegisterEvent(eventId, desiredPlace = 0) {
  tmaHaptic('medium');
  const player = state.players.find(p => Number(p.id) === Number(currentUser?.playerId))
    || myCabinetProfile
    || (currentUser?.player ? currentUser.player : null)
    || state.players[0];

  const sectorId = player ? player.id : currentUser?.playerId;
  try {
    await doTmaApiFetch(`/api/events/${eventId}/register`, {
      method: 'POST',
      body: { desiredPlace, sectorId }
    });
    tmaHaptic('success');
    toast('Заявка на ивент успешно принята!', 'success');
    await doTmaLoadData();
    renderTmaEvents();
    if (activeTmaTab === 'cabinet') renderTmaCabinet();
    const modal = document.getElementById('tma-event-modal');
    if (modal && modal.style.display !== 'none') {
      openTmaEventDetail(eventId);
    }
  } catch (err) {
    tmaHaptic('error');
    toast('Ошибка регистрации: ' + (err.message || 'попробуйте позже'), 'error');
  }
}

async function handleTmaUnregisterEvent(eventId) {
  tmaHaptic('medium');
  const player = state.players.find(p => Number(p.id) === Number(currentUser?.playerId))
    || myCabinetProfile
    || (currentUser?.player ? currentUser.player : null)
    || state.players[0];

  const sectorId = player ? player.id : currentUser?.playerId;
  try {
    const url = sectorId
      ? `/api/events/${eventId}/register?sectorId=${sectorId}`
      : `/api/events/${eventId}/register`;
    await doTmaApiFetch(url, { method: 'DELETE' });
    tmaHaptic('success');
    toast('Заявка отменена', 'info');
    await doTmaLoadData();
    renderTmaEvents();
    if (activeTmaTab === 'cabinet') renderTmaCabinet();
    const modal = document.getElementById('tma-event-modal');
    if (modal && modal.style.display !== 'none') {
      openTmaEventDetail(eventId);
    }
  } catch (err) {
    tmaHaptic('error');
    toast('Ошибка отмены: ' + (err.message || 'попробуйте позже'), 'error');
  }
}

async function openTmaEventDetail(eventId) {
  tmaHaptic('light');
  const modal = document.getElementById('tma-event-modal');
  const sheet = document.getElementById('tma-event-modal-sheet');
  if (!modal || !sheet) return;

  let ev = (state.events || []).find(e => Number(e.id) === Number(eventId));
  try {
    const fetched = await doTmaApiFetch(`/api/events/${eventId}`);
    if (fetched && fetched.id) {
      ev = fetched;
      const idx = (state.events || []).findIndex(e => Number(e.id) === Number(eventId));
      if (idx !== -1) state.events[idx] = fetched;
      else if (state.events) state.events.push(fetched);
    }
  } catch (_) {}

  if (!ev) {
    toast('Событие не найдено', 'error');
    return;
  }

  const isStaff = currentUser?.rank === 'r4' || currentUser?.rank === 'r5' || (typeof logic !== 'undefined' && logic.hasUserPermission(currentUser, 'manage_events'));
  const player = state.players.find(p => Number(p.id) === Number(currentUser?.playerId))
    || myCabinetProfile
    || (currentUser?.player ? currentUser.player : null)
    || state.players[0]
    || {};
  const myPlayerId = player.id || currentUser?.playerId;

  const evTitle = ev.title || ev.name || `Событие #${ev.id}`;
  const evDateStr = (ev.startDate || ev.dateStart || ev.dateFrom)
    ? new Date(ev.startDate || ev.dateStart || ev.dateFrom).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    : 'Дата уточняется';

  const places = (ev.places && ev.places.length > 0) ? ev.places : (ev.eventType?.places || []);
  const registrations = Array.isArray(ev.registrations) ? ev.registrations : [];
  const assignments = Array.isArray(ev.assignments) ? ev.assignments : [];

  const playerMap = new Map((state.players || []).map(p => [Number(p.id), p]));

  const registeredSectors = registrations.map(reg => {
    const pId = Number(reg.playerId || reg.sectorId);
    const p = playerMap.get(pId) || {};
    const assign = assignments.find(a => Number(a.playerId) === pId);
    return {
      reg,
      player: p,
      playerId: pId,
      name: p.name || `Сектор #${pId}`,
      power: p.sector?.power ?? p.power ?? 0,
      vip: p.sector?.vipLevel ?? p.vip ?? '—',
      desiredPlace: reg.desiredPlace,
      assignedPlace: assign ? assign.place : null,
      rsvpStatus: assign ? assign.rsvpStatus : null
    };
  });

  const registeredIds = new Set(registeredSectors.map(r => r.playerId));
  const unRegisteredSectors = (state.players || []).filter(p => !registeredIds.has(Number(p.id)));

  const myReg = registrations.find(r => Number(r.playerId || r.sectorId) === Number(myPlayerId));
  const myAssignment = assignments.find(a => Number(a.playerId) === Number(myPlayerId));

  let placesTableHtml = '';
  if (places.length > 0) {
    placesTableHtml = `
      <div style="margin-bottom:14px">
        <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;margin-bottom:6px">
          🏆 Призовые места и награды:
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(105px, 1fr));gap:6px">
          ${places.map(p => `
            <div style="background:#1f242e;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:8px 10px;text-align:center">
              <div style="font-size:11px;color:#9ca3af">Место #${p.place}</div>
              <div style="font-size:13px;font-weight:800;color:#fbbf24">${fmtNum(p.coupons || 0)} 🎟️</div>
              ${p.points ? `<div style="font-size:9.5px;color:#38bdf8">${fmtNum(p.points)} очков</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  let regActionHtml = '';
  if (myReg) {
    const placeText = (myReg.desiredPlace === 0 || !myReg.desiredPlace) ? 'Любое место' : `Место #${myReg.desiredPlace}`;
    const assignText = myAssignment ? ` (Назначено: #${myAssignment.place})` : ' (Ожидает распределения)';
    regActionHtml = `
      <div style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.3);border-radius:12px;padding:12px;margin-bottom:14px">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:12.5px;font-weight:700;color:#fde68a">✅ Вы записаны на событие</div>
            <div style="font-size:11px;color:#9ca3af;margin-top:2px">Желаемое: <strong>${placeText}</strong>${assignText}</div>
          </div>
          <button type="button" onclick="handleTmaUnregisterEvent(${ev.id})" class="tma-btn-danger" style="padding:6px 12px;font-size:11px">
            ✕ Отозвать
          </button>
        </div>
      </div>
    `;
  } else {
    const placesButtons = (places.length > 0 ? places : [{ place: 1 }, { place: 2 }, { place: 3 }]).map(p => {
      const cStr = p.coupons ? ` (${formatTmaCouponsShort(p.coupons)})` : '';
      return `<button type="button" onclick="handleTmaRegisterEvent(${ev.id}, ${p.place})" class="tma-event-reg-btn">#${p.place}${cStr}</button>`;
    });
    placesButtons.push(`<button type="button" onclick="handleTmaRegisterEvent(${ev.id}, 0)" class="tma-event-reg-btn">Любое</button>`);

    regActionHtml = `
      <div style="background:#1f242e;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px;margin-bottom:14px">
        <div style="font-size:12px;font-weight:700;color:#fff;margin-bottom:8px">Подать заявку на участие:</div>
        <div style="display:grid;grid-template-columns:repeat(${Math.min(4, placesButtons.length)}, 1fr);gap:6px">
          ${placesButtons.join('')}
        </div>
      </div>
    `;
  }

  let rosterHtml = '';
  if (registeredSectors.length === 0) {
    rosterHtml = `
      <div style="text-align:center;padding:16px;color:#9ca3af;font-size:12px;background:#1f242e;border-radius:12px;border:1px solid rgba(255,255,255,0.08)">
        Пока нет поданных заявок на это событие
      </div>
    `;
  } else {
    rosterHtml = registeredSectors.map((item, idx) => {
      const isMe = Number(item.playerId) === Number(myPlayerId);
      const placeText = (item.desiredPlace === 0 || !item.desiredPlace) ? 'Любое' : `#${item.desiredPlace}`;

      let staffControlsHtml = '';
      if (isStaff) {
        const maxPlaceNum = places.length > 0 ? places.length : 5;
        let placeOptions = `<option value="0" ${!item.assignedPlace ? 'selected' : ''}>Не назначено</option>`;
        for (let pNum = 1; pNum <= maxPlaceNum; pNum++) {
          const isSelected = Number(item.assignedPlace) === pNum;
          placeOptions += `<option value="${pNum}" ${isSelected ? 'selected' : ''}>Место #${pNum}</option>`;
        }

        staffControlsHtml = `
          <div style="display:flex;align-items:center;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06)">
            <label style="font-size:10.5px;color:#9ca3af;white-space:nowrap">Назначить:</label>
            <select onchange="handleTmaAssignPlace(${ev.id}, ${item.playerId}, this.value)" style="background:#1f242e;color:#fbbf24;border:1px solid rgba(245,158,11,0.3);border-radius:6px;font-size:11px;padding:3px 6px;cursor:pointer">
              ${placeOptions}
            </select>
            ${item.assignedPlace ? `
              <button type="button" onclick="handleTmaConfirmRsvp(${ev.id}, ${item.assignedPlace})" style="background:rgba(16,185,129,0.2);color:#34d399;border:1px solid rgba(16,185,129,0.3);border-radius:6px;font-size:10.5px;font-weight:700;padding:3px 6px;cursor:pointer">
                ✓ Подтвердить
              </button>
            ` : ''}
            <button type="button" onclick="handleTmaStaffRemoveParticipant(${ev.id}, ${item.playerId})" style="background:none;border:none;color:#ef4444;font-size:10.5px;cursor:pointer;padding:3px 6px;margin-left:auto">
              ✕ Снять
            </button>
          </div>
        `;
      }

      return `
        <div style="background:#1f242e;border:1px solid ${isMe ? 'rgba(245,158,11,0.4)' : 'rgba(255,255,255,0.06)'};border-radius:10px;padding:10px 12px;margin-bottom:6px">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-size:12.5px;font-weight:700;color:#fff;display:flex;align-items:center;gap:6px">
                ${idx + 1}. ${escapeHtml(item.name)}
                ${isMe ? '<span style="font-size:9px;color:#fbbf24;background:rgba(245,158,11,0.25);padding:1px 5px;border-radius:4px">Вы</span>' : ''}
              </div>
              <div style="font-size:11px;color:#9ca3af;margin-top:1px">
                Сила: ${fmtNum(item.power)} • VIP ${item.vip}
              </div>
            </div>
            <div style="text-align:right">
              <span style="font-size:11px;font-weight:700;color:#fbbf24;background:rgba(245,158,11,0.15);padding:2px 8px;border-radius:6px;border:1px solid rgba(245,158,11,0.25)">
                Заявка: ${placeText}
              </span>
              ${item.assignedPlace ? `
                <div style="font-size:10px;font-weight:700;color:#34d399;margin-top:2px">
                  Назначено: #${item.assignedPlace} ${item.rsvpStatus === 'confirmed' ? '✓' : ''}
                </div>
              ` : ''}
            </div>
          </div>
          ${staffControlsHtml}
        </div>
      `;
    }).join('');
  }

  let notRegisteredHtml = '';
  if (unRegisteredSectors.length > 0) {
    notRegisteredHtml = `
      <details style="margin-top:12px;background:#1f242e;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:10px 12px">
        <summary style="font-size:11.5px;font-weight:700;color:#9ca3af;cursor:pointer;user-select:none">
          Не подали заявку (${unRegisteredSectors.length} секторов)
        </summary>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px">
          ${unRegisteredSectors.map(p => `
            <span style="font-size:10.5px;background:#1f242e;color:#d1d5db;padding:3px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.04)">
              ${escapeHtml(p.name || `Сектор #${p.id}`)}
            </span>
          `).join('')}
        </div>
      </details>
    `;
  }

  sheet.innerHTML = `
    <div class="tma-modal-header">
      <div>
        <div style="font-size:10px;font-weight:700;color:#fbbf24;text-transform:uppercase;letter-spacing:0.5px">Событие альянса</div>
        <h3 style="font-size:15px;font-weight:800;color:#fff;margin:2px 0 0 0">${escapeHtml(evTitle)}</h3>
      </div>
      <button type="button" onclick="closeTmaEventModal()" class="tma-modal-close-btn">✕</button>
    </div>
    <div class="tma-modal-body">
      ${isStaff ? `
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.08)">
          <button type="button" onclick="openTmaEventEditor(${ev.id})" class="tma-btn-ghost" style="flex:1;padding:7px 10px;font-size:11.5px;color:#fbbf24;border-color:rgba(245,158,11,0.35);background:rgba(245,158,11,0.15)">
            ✏️ Редактировать
          </button>
          <button type="button" onclick="handleTmaRunAutopick(${ev.id})" class="tma-btn-ghost" style="flex:1;padding:7px 10px;font-size:11.5px;color:#38bdf8;border-color:rgba(56,189,248,0.35);background:rgba(56,189,248,0.15)">
            ⚡ Автоподбор
          </button>
          <button type="button" onclick="handleTmaDeleteEvent(${ev.id})" class="tma-btn-danger" style="padding:7px 10px;font-size:11.5px" title="Удалить событие">
            🗑️
          </button>
        </div>
      ` : ''}
      <div style="font-size:11.5px;color:#9ca3af;margin-bottom:12px">
        📅 ${escapeHtml(evDateStr)} • Мест: <strong style="color:#fff">${places.length || 5}</strong>
      </div>
      ${placesTableHtml}
      ${regActionHtml}
      <div style="font-size:11.5px;font-weight:700;color:#fbbf24;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">
        Заявки и участники (${registeredSectors.length})
      </div>
      ${rosterHtml}
      ${notRegisteredHtml}
    </div>
  `;

  modal.style.display = 'flex';
}

function closeTmaModals() {
  const ids = ['tma-sector-modal', 'tma-stock-modal', 'tma-event-modal', 'tma-officers-picker-modal', 'tma-officer-modal', 'tma-event-editor-modal', 'tma-sector-detail-modal'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  tmaEditEventId = null;
}

function closeTmaEventModal() {
  closeTmaModals();
}

function closeTmaEventEditorModal() {
  const modal = document.getElementById('tma-event-editor-modal');
  if (modal) modal.style.display = 'none';
  tmaEditEventId = null;
}

function closeTmaSectorDetailModal() {
  const modal = document.getElementById('tma-sector-detail-modal');
  if (modal) modal.style.display = 'none';
}

// ─── TMA EVENTS CRUD & AUTOPICK (R4/R5) ─────────────────────────
let tmaEditEventId = null;
let tmaEventEditorPlaces = [];

function openTmaEventEditor(eventId = null) {
  tmaHaptic('light');
  tmaEditEventId = eventId ? Number(eventId) : null;
  const modal = document.getElementById('tma-event-editor-modal');
  const title = document.getElementById('tma-event-editor-title');
  const typeSelect = document.getElementById('tma-ee-type');
  const dateFromInput = document.getElementById('tma-ee-date-from');
  const dateToInput = document.getElementById('tma-ee-date-to');
  const noteInput = document.getElementById('tma-ee-note');
  const deleteBtn = document.getElementById('tma-ee-delete-btn');
  if (!modal) return;
  modal.style.zIndex = '120';

  const types = state.eventTypes || [];
  typeSelect.innerHTML = types.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');

  if (tmaEditEventId) {
    const ev = (state.events || []).find(e => Number(e.id) === tmaEditEventId);
    if (!ev) { toast('Событие не найдено', 'error'); return; }
    title.textContent = '✏️ Редактировать событие';
    typeSelect.value = ev.typeId || (types[0]?.id || 1);

    const fromDate = ev.startDate || ev.dateStart || ev.dateFrom;
    const toDate = ev.endDate || ev.dateEnd || ev.dateTo;
    dateFromInput.value = fromDate ? new Date(fromDate).toISOString().slice(0, 16) : '';
    dateToInput.value = toDate ? new Date(toDate).toISOString().slice(0, 16) : '';
    noteInput.value = ev.note || '';
    if (deleteBtn) deleteBtn.style.display = 'block';

    const evPlaces = (ev.places && ev.places.length > 0) ? ev.places : (ev.eventType?.places || []);
    const assignments = ev.assignments || [];
    tmaEventEditorPlaces = evPlaces.map(p => {
      const assign = assignments.find(a => Number(a.place) === Number(p.place));
      return {
        place: p.place,
        coupons: p.coupons || 0,
        playerId: assign ? assign.playerId : null
      };
    });
  } else {
    title.textContent = '✨ Создать событие';
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
    tomorrow.setUTCHours(0, 0, 0, 0);
    const dayAfter = new Date(tomorrow.getTime() + 48 * 3600 * 1000);
    dateFromInput.value = tomorrow.toISOString().slice(0, 16);
    dateToInput.value = dayAfter.toISOString().slice(0, 16);
    noteInput.value = '';
    if (deleteBtn) deleteBtn.style.display = 'none';

    const et = types[0];
    const defPlaces = (et?.places && et.places.length > 0) ? et.places : [
      { place: 1, coupons: 30000 },
      { place: 2, coupons: 20000 },
      { place: 3, coupons: 10000 }
    ];
    tmaEventEditorPlaces = defPlaces.map(p => ({
      place: p.place,
      coupons: p.coupons || 0,
      playerId: null
    }));
  }

  renderTmaEventEditorPlaces();
  const modalBody = modal.querySelector('.tma-modal-body');
  if (modalBody) modalBody.scrollTop = 0;
  modal.style.display = 'flex';
}

function onTmaEventTypeChange() {
  const typeId = Number(document.getElementById('tma-ee-type').value);
  const et = (state.eventTypes || []).find(t => t.id === typeId);
  if (!et) return;
  const defPlaces = (et.places && et.places.length > 0) ? et.places : [
    { place: 1, coupons: 30000 },
    { place: 2, coupons: 20000 },
    { place: 3, coupons: 10000 }
  ];
  tmaEventEditorPlaces = defPlaces.map(p => ({
    place: p.place,
    coupons: p.coupons || 0,
    playerId: null
  }));
  renderTmaEventEditorPlaces();
}

function renderTmaEventEditorPlaces() {
  const list = document.getElementById('tma-ee-places-list');
  const countBadge = document.getElementById('tma-ee-places-count');
  if (!list) return;
  if (countBadge) countBadge.textContent = tmaEventEditorPlaces.length;

  list.innerHTML = tmaEventEditorPlaces.map((p, idx) => {
    return `
      <div style="background:#1f242e;border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:12px;font-weight:800;color:#fbbf24">Место #${p.place}</span>
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:11px;color:#9ca3af">Купоны:</span>
            <input type="number" min="0" value="${p.coupons || 0}" onchange="tmaEventEditorPlaces[${idx}].coupons = Number(this.value)" style="width:75px;background:#1f242e;border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:3px 6px;color:#fff;font-size:11.5px;font-weight:700;text-align:right">
            ${tmaEventEditorPlaces.length > 1 ? `
              <button type="button" onclick="removeTmaEventPlaceRow(${idx})" style="background:none;border:none;color:#ef4444;font-size:13px;cursor:pointer;padding:2px 4px">✕</button>
            ` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <label style="font-size:10.5px;color:#9ca3af;white-space:nowrap">Назначен:</label>
          <select onchange="tmaEventEditorPlaces[${idx}].playerId = this.value ? Number(this.value) : null" style="flex:1;background:#1f242e;border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:4px 6px;color:#fff;font-size:11px">
            <option value="" ${!p.playerId ? 'selected' : ''}>— Не назначен —</option>
            ${(state.players || []).map(pl => {
              const sel = Number(pl.id) === Number(p.playerId) ? 'selected' : '';
              return `<option value="${pl.id}" ${sel}>${escapeHtml(pl.name || 'Сектор #' + pl.id)} (VIP ${pl.sector?.vipLevel || pl.vip || 0})</option>`;
            }).join('')}
          </select>
        </div>
      </div>
    `;
  }).join('');
}

function addTmaEventPlaceRow() {
  const nextNum = tmaEventEditorPlaces.length > 0
    ? Math.max(...tmaEventEditorPlaces.map(p => p.place)) + 1
    : 1;
  tmaEventEditorPlaces.push({
    place: nextNum,
    coupons: 10000,
    playerId: null
  });
  renderTmaEventEditorPlaces();
}

function removeTmaEventPlaceRow(index) {
  if (tmaEventEditorPlaces.length <= 1) return;
  tmaEventEditorPlaces.splice(index, 1);
  renderTmaEventEditorPlaces();
}

async function runTmaEventAutopick() {
  tmaHaptic('medium');
  if (tmaEditEventId) {
    try {
      const res = await doTmaApiFetch(`/api/events/${tmaEditEventId}/autopick`, { method: 'POST' });
      if (res && res.assignments) {
        for (const a of res.assignments) {
          const p = tmaEventEditorPlaces.find(pl => Number(pl.place) === Number(a.place));
          if (p) p.playerId = a.playerId;
        }
        renderTmaEventEditorPlaces();
        tmaHaptic('success');
        toast('⚡ Автоподбор успешно выполнен!', 'success');
        return;
      }
    } catch (_) {}
  }

  try {
    const typeId = Number(document.getElementById('tma-ee-type').value);
    const dateFrom = document.getElementById('tma-ee-date-from').value;
    const et = (state.eventTypes || []).find(t => t.id === typeId);
    const mockEvent = {
      id: tmaEditEventId || 0,
      typeId,
      places: tmaEventEditorPlaces,
      eventType: et
    };
    if (typeof logic !== 'undefined' && typeof logic.smartAutoPickWithRegistrations === 'function') {
      const res = logic.smartAutoPickWithRegistrations({
        event: mockEvent,
        players: state.players || [],
        registrations: (tmaEditEventId ? ((state.events || []).find(e => e.id === tmaEditEventId)?.registrations) : []) || [],
        officerCatalog: state.officerCatalog || [],
        eventDate: dateFrom || new Date().toISOString()
      });
      if (res && res.assignments) {
        for (const a of res.assignments) {
          const p = tmaEventEditorPlaces.find(pl => Number(pl.place) === Number(a.place));
          if (p) p.playerId = a.playerId;
        }
        renderTmaEventEditorPlaces();
        tmaHaptic('success');
        toast('⚡ Автоподбор успешно рассчитан!', 'success');
        return;
      }
    }
  } catch (err) {
    toast('Ошибка автоподбора: ' + err.message, 'error');
  }
}

async function submitTmaEventEditor() {
  tmaHaptic('medium');
  const typeId = Number(document.getElementById('tma-ee-type').value);
  const dateFrom = document.getElementById('tma-ee-date-from').value;
  const dateTo = document.getElementById('tma-ee-date-to').value;
  const note = document.getElementById('tma-ee-note').value.trim();

  if (!typeId) { toast('Выберите тип события', 'error'); return; }
  if (!dateFrom || !dateTo) { toast('Укажите даты начала и окончания', 'error'); return; }

  const saveBtn = document.getElementById('tma-ee-save-btn');
  if (saveBtn) saveBtn.disabled = true;

  const assignments = tmaEventEditorPlaces
    .filter(p => p.playerId)
    .map(p => ({
      place: p.place,
      playerId: Number(p.playerId),
      actualCoupons: p.coupons || 0
    }));

  const payload = {
    ...(tmaEditEventId ? { id: tmaEditEventId } : {}),
    typeId,
    dateFrom,
    dateTo,
    note,
    places: tmaEventEditorPlaces.map(p => ({ place: p.place, coupons: p.coupons })),
    assignments
  };

  const isEditingExisting = Boolean(tmaEditEventId);
  const targetEventId = tmaEditEventId;

  try {
    const saved = await doTmaApiFetch('/api/events', { method: 'POST', body: payload });
    tmaHaptic('success');
    toast(isEditingExisting ? '✅ Событие обновлено' : '✅ Событие создано', 'success');
    const finalEventId = targetEventId || saved?.id;
    closeTmaEventEditorModal();
    await doTmaLoadData();
    renderTmaEvents();
    if (activeTmaTab === 'cabinet') renderTmaCabinet();

    const eventModal = document.getElementById('tma-event-modal');
    if (finalEventId && (isEditingExisting || (eventModal && eventModal.style.display !== 'none'))) {
      await openTmaEventDetail(finalEventId);
    }
  } catch (err) {
    tmaHaptic('error');
    toast('Ошибка сохранения: ' + (err.message || 'попробуйте позже'), 'error');
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function handleTmaDeleteEvent(eventId) {
  if (!confirm('Удалить это событие альянса?')) return;
  tmaHaptic('medium');
  try {
    await doTmaApiFetch(`/api/events/${eventId}`, { method: 'DELETE' });
    tmaHaptic('success');
    toast('🗑️ Событие удалено', 'info');
    closeTmaEventEditorModal();
    closeTmaEventModal();
    await doTmaLoadData();
    renderTmaEvents();
    if (activeTmaTab === 'cabinet') renderTmaCabinet();
  } catch (err) {
    tmaHaptic('error');
    toast('Ошибка удаления: ' + (err.message || 'попробуйте позже'), 'error');
  }
}

async function handleTmaRunAutopick(eventId) {
  tmaHaptic('medium');
  try {
    await doTmaApiFetch(`/api/events/${eventId}/autopick`, { method: 'POST' });
    tmaHaptic('success');
    toast('⚡ Автоподбор выполнен штабом!', 'success');
    await doTmaLoadData();
    renderTmaEvents();
    openTmaEventDetail(eventId);
  } catch (err) {
    tmaHaptic('error');
    toast('Ошибка автоподбора: ' + (err.message || 'попробуйте позже'), 'error');
  }
}

function deleteTmaCurrentEvent() {
  if (tmaEditEventId) handleTmaDeleteEvent(tmaEditEventId);
}

// ─── TMA SECTOR DOSSIER (Matrix Sector Detail) ──────────────────
async function openTmaSectorDetail(playerId) {
  tmaHaptic('light');
  const modal = document.getElementById('tma-sector-detail-modal');
  const nameEl = document.getElementById('tma-sd-name');
  const content = document.getElementById('tma-sd-content');
  if (!modal || !content) return;
  modal.style.zIndex = '120';

  const p = (state.players || []).find(pl => Number(pl.id) === Number(playerId));
  if (!p) { toast('Сектор не найден', 'error'); return; }

  if (nameEl) nameEl.textContent = p.name || `Сектор #${p.id}`;

  const sec = p.sector || {};
  const stock = p.stock || {};
  const isStaff = currentUser?.rank === 'r4' || currentUser?.rank === 'r5' || (typeof logic !== 'undefined' && logic.hasUserPermission(currentUser, 'manage_events'));
  const isSelf = Number(p.id) === Number(currentUser?.playerId) || (p.userId && Number(p.userId) === Number(currentUser?.id));
  const canViewStock = isStaff || isSelf || (typeof canSeeStock === 'function' ? canSeeStock(p.id) : false);

  const power = sec.power || p.power || 0;
  const vip = (sec.vipLevel !== undefined && sec.vipLevel !== null) ? sec.vipLevel : (p.vip || 0);
  const hq = sec.hqLevel || p.hq || '—';
  const kp = sec.killPoints || p.killPoints || 0;
  const ownerStr = p.username ? `@${escapeHtml(p.username)}` : 'Без владельца';
  const rankStr = p.rank || 'Р3';

  // Stock Freshness
  const updatedAt = stock.updatedAt || p.updatedAt;
  let daysAgo = 0;
  if (updatedAt) {
    daysAgo = Math.floor((Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24));
  }
  const isFresh = daysAgo <= 3;
  const freshnessText = isFresh
    ? `🟢 Свежий (${daysAgo === 0 ? 'сегодня' : daysAgo + 'д назад'})`
    : `🔴 Устарел (${daysAgo}д назад)`;

  // Officers list in dossier
  const officers = p.officers || [];
  const today = new Date().toISOString().slice(0, 10);
  let officersListHtml = '';
  if (!officers.length) {
    officersListHtml = `
      <div style="text-align:center;padding:12px;color:#9ca3af;font-size:11.5px;background:#1f242e;border:1px solid rgba(255,255,255,0.08);border-radius:10px">
        Офицеры не добавлены
      </div>
    `;
  } else {
    officersListHtml = officers.map(off => {
      const cat = getCatalogOfficer(off.catalogId) || { couponPerPuzzle: 500, generation: 7, type: 'Пехота' };
      const offStars = Math.max(0, Math.min(5, Number(off.stars) || 0));
      const offSkills = Array.isArray(off.skills) && off.skills.length === 4 ? off.skills : [1, 1, 1, 1];
      const offName = off.name || cat?.name || 'Офицер #' + off.id;
      const offType = cat?.type || 'Пехота';
      const offGen = cat?.generation ? `G${cat.generation}` : '';

      let deficitStr = '0 куп.';
      let forecastStr = '✓ Фулл';
      let isFull = true;
      try {
        const calcDefFn = (typeof logic !== 'undefined' && logic.calculateOfficerDeficit) || (typeof calculateOfficerDeficit === 'function' ? calculateOfficerDeficit : null);
        if (calcDefFn) {
          const def = calcDefFn({ officer: off, catalogItem: cat, player: p, targetLevel: 180, today });
          if (def.isOnlyPersonalPuzzles) {
            deficitStr = '0 куп.';
            forecastStr = def.deficitPuzzles === 0 ? '✓ Фулл' : '🧩 Личные';
            isFull = def.deficitPuzzles === 0;
          } else if (def.deficitCoupons > 0) {
            deficitStr = `${fmtNum(def.deficitCoupons)}`;
            isFull = false;
            if (def.forecastDate) {
              const d = new Date(def.forecastDate);
              forecastStr = `📅 ${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`;
            } else {
              forecastStr = '📅 —';
            }
          }
        }
      } catch (_) {}

      return `
        <div class="tma-officer-card-compact" style="margin-bottom:6px;padding:8px 10px">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div style="display:flex;align-items:center;gap:8px">
              <div style="width:36px;height:36px;border-radius:10px;background:#262626;border:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;font-weight:900;color:#fbbf24;font-size:12px">
                ${offGen || escapeHtml(offName.charAt(0))}
              </div>
              <div>
                <div style="display:flex;align-items:center;gap:4px">
                  <span style="font-size:12.5px;font-weight:700;color:#fff">${escapeHtml(offName)}</span>
                  <span class="tma-badge-troop">${escapeHtml(offType)}</span>
                </div>
                <div style="font-size:10.5px;color:#9ca3af;margin-top:1px">
                  Ур. ${off.level || 0} • ${'★'.repeat(offStars)}${'☆'.repeat(5 - offStars)}
                </div>
              </div>
            </div>
            <div style="text-align:right">
              <span class="tma-badge-skills">
                [${offSkills.join('-')}]
              </span>
              <div style="font-size:10px;color:#9ca3af;margin-top:2px">
                Дефицит: <strong style="color:${isFull ? '#34d399' : '#fbbf24'}">${deficitStr}</strong>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  let stockSectionHtml = '';
  if (canViewStock) {
    stockSectionHtml = `
      <div class="tma-stock-edit-card" style="padding:10px 12px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <span style="font-size:12px;font-weight:700;color:#fbbf24">📦 Складские запасы</span>
          <span style="font-size:10px;font-weight:700;color:${isFresh ? '#34d399' : '#f87171'}">${freshnessText}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          <div style="background:#1f242e;border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:6px 8px">
            <div style="font-size:9.5px;color:#9ca3af">Купоны офицера</div>
            <div style="font-size:12.5px;font-weight:800;color:#fbbf24;margin-top:1px">${fmtNum(stock.coupons || 0)} 🎟️</div>
          </div>
          <div style="background:#1f242e;border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:6px 8px">
            <div style="font-size:9.5px;color:#9ca3af">Медали офицера</div>
            <div style="font-size:12.5px;font-weight:800;color:#38bdf8;margin-top:1px">${fmtNum(stock.puzzles || 0)} 🧩</div>
          </div>
          <div style="background:#1f242e;border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:6px 8px">
            <div style="font-size:9.5px;color:#9ca3af">Сундуки выбора</div>
            <div style="font-size:12.5px;font-weight:800;color:#fde68a;margin-top:1px">${fmtNum(stock.chests || 0)} 📦</div>
          </div>
          <div style="background:#1f242e;border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:6px 8px">
            <div style="font-size:9.5px;color:#9ca3af">Купоны звезды</div>
            <div style="font-size:12.5px;font-weight:800;color:#fbbf24;margin-top:1px">${fmtNum(stock.starCoupons || 0)} 🎟️⭐</div>
          </div>
          <div style="background:#1f242e;border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:6px 8px">
            <div style="font-size:9.5px;color:#9ca3af">Звезды I / II / III</div>
            <div style="font-size:11.5px;font-weight:800;color:#c084fc;margin-top:1px">${stock.legendaryStars1 || 0} / ${stock.legendaryStars2 || 0} / ${stock.legendaryStars3 || 0}</div>
          </div>
          <div style="background:#1f242e;border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:6px 8px">
            <div style="font-size:9.5px;color:#9ca3af">Очки звезд</div>
            <div style="font-size:12.5px;font-weight:800;color:#c084fc;margin-top:1px">${fmtNum(stock.starPoints || 0)} ✨</div>
          </div>
        </div>
      </div>
    `;
  } else {
    stockSectionHtml = `
      <div style="text-align:center;padding:16px;background:rgba(255,255,255,0.03);border:1px dashed rgba(255,255,255,0.1);border-radius:12px;color:#9ca3af;font-size:11.5px">
        🔒 Запасы склада скрыты настройками приватности альянса
      </div>
    `;
  }

  content.innerHTML = `
    <!-- Top Metadata Card -->
    <div class="tma-stock-edit-card" style="padding:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="tma-badge-rank">
            ${escapeHtml(rankStr)}
          </span>
          <span style="font-size:12px;color:#9ca3af">
            👤 Владелец: <strong style="color:#fff">${ownerStr}</strong>
          </span>
        </div>
        ${(isStaff || isSelf) ? `
          <button type="button" onclick="closeTmaModals();openTmaSectorEditModal(${p.id})" class="tma-quick-btn" style="padding:4px 10px;font-size:11px">
            ✏️ Изменить
          </button>
        ` : ''}
      </div>

      <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:6px;text-align:center">
        <div style="background:#1f242e;border-radius:8px;padding:6px 4px">
          <div style="font-size:9.5px;color:#9ca3af">Мощь</div>
          <div style="font-size:11.5px;font-weight:800;color:#fff;margin-top:2px">${fmtNum(power)}</div>
        </div>
        <div style="background:#1f242e;border-radius:8px;padding:6px 4px">
          <div style="font-size:9.5px;color:#9ca3af">VIP</div>
          <div style="font-size:11.5px;font-weight:800;color:#fbbf24;margin-top:2px">${vip}</div>
        </div>
        <div style="background:#1f242e;border-radius:8px;padding:6px 4px">
          <div style="font-size:9.5px;color:#9ca3af">Штаб</div>
          <div style="font-size:11.5px;font-weight:800;color:#38bdf8;margin-top:2px">${hq}</div>
        </div>
        <div style="background:#1f242e;border-radius:8px;padding:6px 4px">
          <div style="font-size:9.5px;color:#9ca3af">Очки за уб.</div>
          <div style="font-size:11.5px;font-weight:800;color:#c084fc;margin-top:2px">${fmtNum(kp)}</div>
        </div>
      </div>
    </div>

    <!-- Stock Section (with RBAC) -->
    ${stockSectionHtml}

    <!-- Officers Section -->
    <div class="tma-stock-edit-card" style="padding:10px 12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:12px;font-weight:700;color:#fbbf24">🎖️ Офицеры сектора (${officers.length})</span>
      </div>
      <div>
        ${officersListHtml}
      </div>
    </div>
  `;

  modal.style.display = 'flex';
}

async function handleTmaSwitchSector(sectorId) {
  tmaHaptic('selection');
  try {
    const sId = Number(sectorId);
    if (!sId) return;
    await doTmaApiFetch('/api/my-profile/active-sector', {
      method: 'POST',
      body: { sectorId: sId }
    });
    if (currentUser) {
      currentUser.playerId = sId;
    }
    state.currentPlayerId = sId;
    const nextSector = (state.players || []).find(p => Number(p.id) === sId);
    if (nextSector) {
      myCabinetProfile = nextSector;
    }
    tmaHaptic('success');
    toast('Сектор переключен', 'success');
    renderTmaCabinet();
    if (typeof renderMyCabinet === 'function') {
      renderMyCabinet().catch(() => {});
    }
  } catch (err) {
    tmaHaptic('error');
    toast('Ошибка переключения сектора: ' + (err.message || err), 'error');
  }
}

let tmaEditingSectorId = null;

function openTmaSectorEditModal(playerId = null) {
  tmaHaptic('light');
  tmaEditingSectorId = playerId ? Number(playerId) : Number(currentUser?.playerId || myCabinetProfile?.id);
  const player = (tmaEditingSectorId ? state.players.find(p => Number(p.id) === tmaEditingSectorId) : null)
    || state.players.find(p => Number(p.id) === Number(currentUser?.playerId))
    || myCabinetProfile
    || (currentUser?.player ? currentUser.player : null)
    || state.players[0]
    || {};
  const sec = player.sector || {};

  const nameEl = document.getElementById('tma-sec-name');
  if (nameEl) nameEl.value = player.name || '';

  const vipEl = document.getElementById('tma-sec-vip');
  if (vipEl) vipEl.value = (sec.vipLevel !== undefined && sec.vipLevel !== null) ? sec.vipLevel : (player.vip || 0);

  const vipPtsEl = document.getElementById('tma-sec-vip-points');
  if (vipPtsEl) vipPtsEl.value = formatInputNumber(sec.vipPoints || 0);

  const hqEl = document.getElementById('tma-sec-hq');
  if (hqEl) hqEl.value = sec.hqLevel || '';

  const confEl = document.getElementById('tma-sec-conf');
  if (confEl) confEl.value = sec.confidentialityLevel || 0;

  const powerEl = document.getElementById('tma-sec-power');
  if (powerEl) powerEl.value = formatInputNumber(sec.power || player.power || 0);

  const killsEl = document.getElementById('tma-sec-kills');
  if (killsEl) killsEl.value = formatInputNumber(sec.kills || player.kills || 0);

  const killPtsEl = document.getElementById('tma-sec-kill-points');
  if (killPtsEl) killPtsEl.value = formatInputNumber(sec.killPoints || player.killPoints || 0);

  const modal = document.getElementById('tma-sector-modal');
  if (modal) {
    modal.style.display = 'flex';
    bindAllNumericInputs(modal);
  }
}

async function submitTmaSectorEdit() {
  tmaHaptic('medium');
  const name = document.getElementById('tma-sec-name')?.value?.trim();
  const vipLevel = Math.max(0, Math.min(17, parseInt(document.getElementById('tma-sec-vip')?.value, 10) || 0));
  const vipPoints = Math.max(0, parseInputNumber(document.getElementById('tma-sec-vip-points')?.value));
  const hqVal = document.getElementById('tma-sec-hq')?.value;
  const hqLevel = (hqVal !== undefined && hqVal !== '' && !isNaN(parseInt(hqVal, 10))) ? Math.max(1, parseInt(hqVal, 10)) : null;
  const confidentialityLevel = Math.max(0, parseInt(document.getElementById('tma-sec-conf')?.value, 10) || 0);
  const power = Math.max(0, parseInputNumber(document.getElementById('tma-sec-power')?.value));
  const kills = Math.max(0, parseInputNumber(document.getElementById('tma-sec-kills')?.value));
  const killPoints = Math.max(0, parseInputNumber(document.getElementById('tma-sec-kill-points')?.value, true));

  if (!name) {
    toast('Укажите ник в игре', 'error');
    return;
  }

  const isSelf = !tmaEditingSectorId || Number(tmaEditingSectorId) === Number(currentUser?.playerId || myCabinetProfile?.id);
  const endpoint = isSelf ? '/api/my-profile' : `/api/players/${tmaEditingSectorId}`;
  const targetId = tmaEditingSectorId || Number(currentUser?.playerId || myCabinetProfile?.id);

  try {
    await doTmaApiFetch(endpoint, {
      method: 'PUT',
      body: {
        name,
        sector: { vipLevel, hqLevel, vipPoints, confidentialityLevel, power, kills, killPoints }
      }
    });

    const p = state.players.find(x => Number(x.id) === targetId);
    if (p) {
      p.name = name;
      p.power = power;
      p.vip = vipLevel;
      p.sector = { ...(p.sector || {}), vipLevel, hqLevel, vipPoints, confidentialityLevel, power, kills, killPoints };
    }
    if (isSelf && myCabinetProfile && Number(myCabinetProfile.id) === targetId) {
      myCabinetProfile.name = name;
      myCabinetProfile.sector = { ...(myCabinetProfile.sector || {}), vipLevel, hqLevel, vipPoints, confidentialityLevel, power, kills, killPoints };
    }

    tmaHaptic('success');
    closeTmaModals();
    toast('Параметры сектора сохранены', 'success');
    renderTmaCabinet();
    if (activeTmaTab === 'matrix') renderTmaMatrix();
    if (typeof renderMyCabinet === 'function') {
      renderMyCabinet().catch(() => {});
    }
  } catch (err) {
    tmaHaptic('error');
    toast('Ошибка сохранения параметров: ' + (err.message || err), 'error');
  }
}

function openTmaStockEditModal() {
  tmaHaptic('light');
  const player = state.players.find(p => Number(p.id) === Number(currentUser?.playerId))
    || myCabinetProfile
    || (currentUser?.player ? currentUser.player : null)
    || state.players[0]
    || {};
  const stock = player.stock || {};

  const coupEl = document.getElementById('tma-stock-coupons');
  if (coupEl) coupEl.value = formatInputNumber(stock.coupons || 0);

  const puzEl = document.getElementById('tma-stock-puzzles');
  if (puzEl) puzEl.value = formatInputNumber(stock.puzzles || 0);

  const chEl = document.getElementById('tma-stock-chests');
  if (chEl) chEl.value = formatInputNumber(stock.chests || 0);

  const starCoupEl = document.getElementById('tma-stock-star-coupons');
  if (starCoupEl) starCoupEl.value = formatInputNumber(stock.starCoupons || 0);

  const s1El = document.getElementById('tma-stock-stars-1');
  if (s1El) s1El.value = formatInputNumber(stock.legendaryStars1 || 0);

  const s2El = document.getElementById('tma-stock-stars-2');
  if (s2El) s2El.value = formatInputNumber(stock.legendaryStars2 || 0);

  const s3El = document.getElementById('tma-stock-stars-3');
  if (s3El) s3El.value = formatInputNumber(stock.legendaryStars3 || 0);

  const lblEl = document.getElementById('tma-stock-star-coupon-label');
  if (lblEl) {
    lblEl.innerHTML = `${renderStarCouponIconHtml(16)} Купон звезды`;
  }

  updateTmaLiveStarPoints();

  const modal = document.getElementById('tma-stock-modal');
  if (modal) {
    modal.style.display = 'flex';
    bindAllNumericInputs(modal);
  }
}

function adjustTmaStockValue(field, delta) {
  tmaHaptic('selection');
  let elId = 'tma-stock-' + field;
  if (field === 'starCoupons') elId = 'tma-stock-star-coupons';
  const el = document.getElementById(elId);
  if (!el) return;
  const current = parseInputNumber(el.value);
  const next = Math.max(0, current + Number(delta || 0));
  el.value = formatInputNumber(next);
  if (field.startsWith('stars')) {
    updateTmaLiveStarPoints();
  }
}

function updateTmaLiveStarPoints() {
  const s1 = parseInputNumber(document.getElementById('tma-stock-stars-1')?.value);
  const s2 = parseInputNumber(document.getElementById('tma-stock-stars-2')?.value);
  const s3 = parseInputNumber(document.getElementById('tma-stock-stars-3')?.value);
  const calcFn = (typeof logic !== 'undefined' && logic.calculateTotalStarPoints) ? logic.calculateTotalStarPoints : null;
  const total = calcFn ? calcFn({ legendaryStars1: s1, legendaryStars2: s2, legendaryStars3: s3 }) : ((s1 * 110) + (s2 * 420) + (s3 * 960));
  const badge = document.getElementById('tma-stock-star-points-badge');
  if (badge) {
    badge.textContent = `✨ Итого очков звезд: ${fmtNum(total)}`;
  }
}

async function confirmTmaStockFreshness() {
  tmaHaptic('medium');
  try {
    await confirmMyStock();
    tmaHaptic('success');
    closeTmaModals();
    renderTmaCabinet();
  } catch (err) {
    tmaHaptic('error');
    toast('Ошибка подтверждения: ' + (err.message || err), 'error');
  }
}

async function submitTmaStockEdit() {
  tmaHaptic('medium');
  const coupons = Math.max(0, parseInputNumber(document.getElementById('tma-stock-coupons')?.value));
  const puzzles = Math.max(0, parseInputNumber(document.getElementById('tma-stock-puzzles')?.value));
  const chests = Math.max(0, parseInputNumber(document.getElementById('tma-stock-chests')?.value));
  const starCoupons = Math.max(0, parseInputNumber(document.getElementById('tma-stock-star-coupons')?.value));
  const legendaryStars1 = Math.max(0, parseInputNumber(document.getElementById('tma-stock-stars-1')?.value));
  const legendaryStars2 = Math.max(0, parseInputNumber(document.getElementById('tma-stock-stars-2')?.value));
  const legendaryStars3 = Math.max(0, parseInputNumber(document.getElementById('tma-stock-stars-3')?.value));

  const stock = { coupons, puzzles, chests, starCoupons, legendaryStars1, legendaryStars2, legendaryStars3 };

  try {
    await doTmaApiFetch('/api/my-profile', {
      method: 'PUT',
      body: { stock }
    });

    const activePlayerId = Number(currentUser?.playerId || myCabinetProfile?.id);
    const p = state.players.find(x => Number(x.id) === activePlayerId);
    if (p) {
      p.stock = { ...(p.stock || {}), ...stock, updatedAt: new Date().toISOString() };
    }
    if (myCabinetProfile && Number(myCabinetProfile.id) === activePlayerId) {
      myCabinetProfile.stock = { ...(myCabinetProfile.stock || {}), ...stock, updatedAt: new Date().toISOString() };
    }

    tmaHaptic('success');
    closeTmaModals();
    toast('Запасы склада успешно обновлены', 'success');
    renderTmaCabinet();
    if (typeof renderMyCabinet === 'function') {
      renderMyCabinet().catch(() => {});
    }
  } catch (err) {
    tmaHaptic('error');
    toast('Ошибка сохранения запасов: ' + (err.message || err), 'error');
  }
}

// ─── TMA OFFICERS MANAGEMENT & CALCULATOR TARGET SELECTION ───────
let tmaOfficerModalEditId = null;
let tmaOfficerModalSkills = [1, 1, 1, 1];
let tmaOfficerModalStars = 0;
let tmaOfficerModalMode = 'retro';

let isTmaOfficersCollapsed = true;

function toggleTmaOfficersAccordion() {
  tmaHaptic('selection');
  isTmaOfficersCollapsed = !isTmaOfficersCollapsed;
  const content = document.getElementById('tma-officers-accordion-content');
  const arrow = document.getElementById('tma-officers-arrow');
  if (content) content.style.display = isTmaOfficersCollapsed ? 'none' : 'block';
  if (arrow) arrow.textContent = isTmaOfficersCollapsed ? '▶' : '▼';
}

function renderTmaOfficersSectionHtml(officers, targetOfficer, player) {
  const count = (officers || []).length;
  const isTargetId = (offId) => targetOfficer && String(targetOfficer.id) === String(offId);
  const today = new Date().toISOString().slice(0, 10);

  let cardsHtml = '';
  if (!officers || officers.length === 0) {
    cardsHtml = `
      <div style="background:#1f242e;border:1px dashed rgba(255,255,255,0.15);border-radius:14px;padding:20px;text-align:center;color:#9ca3af">
        <div style="font-size:28px;margin-bottom:6px">🎖️</div>
        <div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:4px">Нет офицеров в секторе</div>
        <div style="font-size:11.5px;margin-bottom:12px">Добавьте офицеров для отслеживания прокачки и расчета дефицита</div>
        <button type="button" class="tma-btn-primary" onclick="openTmaAddOfficerModal()" style="padding:8px 16px">
          + Добавить первого офицера
        </button>
      </div>
    `;
  } else {
    cardsHtml = officers.map(off => {
      const isTarget = isTargetId(off.id);
      const cat = getCatalogOfficer(off.catalogId) || { couponPerPuzzle: 500, generation: 7, type: 'Пехота' };
      const offMode = getOfficerMode(off.id);
      const isRetro = offMode === 'retro';
      const offStars = Math.max(0, Math.min(5, Number(off.stars) || 0));
      const offSkills = Array.isArray(off.skills) && off.skills.length === 4 ? off.skills : [1, 1, 1, 1];
      const offName = off.name || cat?.name || 'Офицер #' + off.id;
      const offType = cat?.type || 'Пехота';
      const offGen = cat?.generation ? `G${cat.generation}` : '';

      let deficitStr = '0 куп.';
      let forecastStr = '✓ Фулл';
      let isFull = true;
      try {
        const calcDefFn = (typeof logic !== 'undefined' && logic.calculateOfficerDeficit) || (typeof calculateOfficerDeficit === 'function' ? calculateOfficerDeficit : null);
        if (calcDefFn) {
          const def = calcDefFn({ officer: off, catalogItem: cat, player, targetLevel: 180, today });
          if (def.isOnlyPersonalPuzzles) {
            deficitStr = '0 куп.';
            forecastStr = def.deficitPuzzles === 0 ? '✓ Фулл' : '🧩 Личные';
            isFull = def.deficitPuzzles === 0;
          } else if (def.deficitCoupons > 0) {
            deficitStr = `${fmtNum(def.deficitCoupons)}`;
            isFull = false;
            if (def.forecastDate) {
              const d = new Date(def.forecastDate);
              forecastStr = `📅 ${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`;
            } else {
              forecastStr = '📅 —';
            }
          }
        }
      } catch (_) {}

      const starsGold = '★'.repeat(offStars);
      const starsGray = '☆'.repeat(5 - offStars);

      return `
        <div class="tma-officer-card-compact" id="tma-officer-card-${off.id}" onclick="openTmaEditOfficerModal('${off.id}')" style="cursor:pointer;background:#1f242e;border:1px solid ${
          isTarget ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.08)'
        };border-radius:14px;padding:10px 12px;margin-bottom:8px;${
          isTarget ? 'box-shadow:0 2px 10px rgba(245,158,11,0.15);' : ''
        }">
          <!-- Top Row -->
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div style="display:flex;align-items:center;gap:10px">
              <div style="width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;${
                isTarget
                  ? 'background:#fbbf24;color:#000;box-shadow:0 2px 8px rgba(245,158,11,0.35);'
                  : 'background:#262626;color:#d1d5db;border:1px solid rgba(255,255,255,0.1)'
              }">
                ${offGen || escapeHtml(offName.charAt(0))}
              </div>
              <div>
                <div style="display:flex;align-items:center;gap:6px">
                  <span style="font-size:13.5px;font-weight:800;color:#fff">${escapeHtml(offName)}</span>
                  <span class="tma-badge-troop">
                    ${escapeHtml(offType)}
                  </span>
                  ${(off.personalPuzzles || off.personal_puzzles) ? `<span style="font-size:9.5px;color:#fde68a;background:rgba(245,158,11,0.1);padding:1px 4px;border-radius:4px">🧩 ${off.personalPuzzles || off.personal_puzzles}</span>` : ''}
                </div>
                <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
                  <span style="font-size:11px;color:#38bdf8;font-weight:700">Ур. ${off.level || 0}</span>
                  <span style="color:#6b7280;font-size:10px">•</span>
                  <span style="color:#fbbf24;font-size:11px;letter-spacing:1px">${starsGold}${starsGray}</span>
                  <span style="font-size:10px;color:#9ca3af;font-weight:700">${offStars}★</span>
                </div>
              </div>
            </div>

            <!-- Controls: Mode, Target Star, Edit -->
            <div style="display:flex;align-items:center;gap:6px">
              <button type="button" onclick="event.stopPropagation();toggleTmaOfficerMode('${off.id}')" style="font-size:10px;padding:2px 7px;border-radius:6px;font-weight:800;cursor:pointer;${
                isRetro ? 'background:rgba(156,163,175,0.15);color:#9ca3af;border:1px solid rgba(156,163,175,0.25)' : 'background:rgba(245,158,11,0.15);color:#fbbf24;border:1px solid rgba(245,158,11,0.3)'
              }" title="Режим: ${isRetro ? 'Ретро (без списания)' : 'Списание со склада'}">
                ${isRetro ? '📜 Ретро' : '⚡ Склад'}
              </button>

              <button type="button" onclick="event.stopPropagation();selectTmaTargetOfficer('${off.id}')" class="tma-target-star-btn ${isTarget ? 'active' : ''}" title="${isTarget ? 'Текущая цель в калькуляторе' : 'Сделать целью в калькуляторе'}">
                ${isTarget ? '⭐' : '☆'}
              </button>

              <button type="button" onclick="event.stopPropagation();openTmaEditOfficerModal('${off.id}')" class="tma-quick-btn" style="padding:4px 8px;font-size:11.5px" title="Редактировать параметры офицера">
                ✏️
              </button>
            </div>
          </div>

          <!-- Bottom Row: Skills, Deficit, Forecast -->
          <div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:space-between;font-size:11px">
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:9.5px;color:#9ca3af;font-weight:600">Навыки:</span>
              <span class="tma-badge-skills">
                [${offSkills.join('-')}]
              </span>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="color:#9ca3af;font-size:10.5px">Дефицит: <strong style="color:${isFull ? '#34d399' : '#fbbf24'}">${deficitStr}</strong></span>
              <span style="color:#34d399;font-weight:700;font-size:10.5px">${forecastStr}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  return `
    <div class="tma-card" style="margin-top:14px;padding:0;overflow:hidden">
      <!-- Accordion Header -->
      <div onclick="toggleTmaOfficersAccordion()" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;cursor:pointer;user-select:none">
        <div style="font-size:13.5px;font-weight:700;color:#fff;display:flex;align-items:center;gap:6px">
          <span>🎖️ Офицеры сектора</span>
          <span style="font-size:11px;color:#fbbf24;background:rgba(245,158,11,0.2);padding:1px 7px;border-radius:6px;font-weight:700">${count}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <button type="button" class="tma-btn-add" onclick="event.stopPropagation();openTmaAddOfficerModal()">
            + Добавить
          </button>
          <span id="tma-officers-arrow" style="font-size:12px;color:#fbbf24;font-weight:800;transition:transform 0.2s">
            ${isTmaOfficersCollapsed ? '▶' : '▼'}
          </span>
        </div>
      </div>

      <!-- Accordion Body -->
      <div id="tma-officers-accordion-content" style="display:${isTmaOfficersCollapsed ? 'none' : 'block'};padding:0 14px 14px 14px">
        ${cardsHtml}
      </div>
    </div>
  `;
}

function openTmaOfficersPickerModal() {
  tmaHaptic('light');
  renderTmaOfficersPickerList();
  const modal = document.getElementById('tma-officers-picker-modal');
  if (modal) modal.style.display = 'flex';
}

function renderTmaOfficersPickerList() {
  const container = document.getElementById('tma-officers-picker-list');
  if (!container) return;

  const player = state.players.find(p => Number(p.id) === Number(currentUser?.playerId))
    || myCabinetProfile
    || (currentUser?.player ? currentUser.player : null)
    || state.players[0]
    || {};

  const officers = player.officers || [];
  const customTargetId = state.tmaTargetOfficerId || (typeof localStorage !== 'undefined' ? localStorage.getItem('kow_tma_target_' + (player.id || currentUser?.playerId)) : null);
  let targetOfficer = null;
  if (customTargetId) {
    targetOfficer = officers.find(o => String(o.id) === String(customTargetId));
  }
  if (!targetOfficer) {
    targetOfficer = officers.find(o => !o.isMaxed && (o.isTarget || o.priority))
      || officers.find(o => o.isTarget)
      || officers[0]
      || null;
  }

  if (officers.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:24px 16px;color:#9ca3af;font-size:12.5px">
        <div style="font-size:28px;margin-bottom:6px">🎖️</div>
        <p style="font-weight:700;color:#fff;margin:0 0 4px 0">Нет офицеров в секторе</p>
        <p style="font-size:11.5px;color:#9ca3af;margin:0 0 12px 0">Нажмите «+ Добавить», чтобы добавить первого офицера</p>
        <button type="button" class="tma-btn-primary" onclick="openTmaAddOfficerModal()" style="padding:8px 16px">
          + Добавить офицера
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = officers.map(off => {
    const isTarget = targetOfficer && String(targetOfficer.id) === String(off.id);
    const cat = getCatalogOfficer(off.catalogId);
    const offName = off.name || cat?.name || 'Офицер #' + off.id;
    const offType = cat?.type || 'Пехота';
    const offGen = cat?.generation ? `G${cat.generation}` : '';
    const offStars = Math.max(0, Math.min(5, Number(off.stars) || 0));
    const starsGold = '★'.repeat(offStars);
    const starsGray = '☆'.repeat(5 - offStars);
    const skills = Array.isArray(off.skills) && off.skills.length === 4 ? off.skills : [1, 1, 1, 1];
    const skillsStr = skills.join('-');

    const rawCost = Number(cat?.couponPerPuzzle);
    const costPerPuzzle = rawCost === 0
      ? (cat?.upgradeType === 'special' ? 0 : 500)
      : (rawCost || (cat?.generation === 7 ? 600 : (cat?.generation >= 8 ? 720 : 500)));
    const today = new Date().toISOString().slice(0, 10);

    const def = (typeof logic !== 'undefined' && logic.calculateOfficerDeficit)
      ? logic.calculateOfficerDeficit({
          officer: off,
          catalogItem: { ...cat, couponPerPuzzle: costPerPuzzle },
          player,
          targetLevel: 180,
          today
        })
      : null;
    const isFull = def
      ? (def.deficitPuzzles === 0 && (def.deficitCoupons || 0) === 0)
      : ((off.level || 0) >= 180 && skills.every(s => Number(s) >= 5));
    const remCoupons = isFull ? 0 : (def?.deficitCoupons ?? def?.remainingCoupons ?? 0);

    return `
      <div class="tma-officer-card-compact tma-card-clickable" onclick="selectTmaTargetOfficer('${off.id}')" style="margin-bottom:8px;padding:10px 12px;background:#1f242e;border:1px solid ${
        isTarget ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.08)'
      };border-radius:14px;${
        isTarget ? 'box-shadow:0 2px 10px rgba(245,158,11,0.15);' : ''
      }">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;${
              isTarget
                ? 'background:#fbbf24;color:#000;box-shadow:0 2px 8px rgba(245,158,11,0.35);'
                : 'background:#262626;color:#d1d5db;border:1px solid rgba(255,255,255,0.1)'
            }">
              ${offGen || escapeHtml(offName.charAt(0))}
            </div>
            <div>
              <div style="display:flex;align-items:center;gap:6px">
                <span style="font-size:13.5px;font-weight:800;color:#fff">${escapeHtml(offName)}</span>
                <span class="tma-badge-troop">
                  ${escapeHtml(offType)}
                </span>
              </div>
              <div style="display:flex;align-items:center;gap:8px;margin-top:2px;font-size:11px">
                <span class="tma-badge-skills">[${skillsStr}]</span>
                <span style="color:#fbbf24;letter-spacing:1px">${starsGold}${starsGray}</span>
                <span style="color:#38bdf8;font-weight:700">Ур. ${off.level || 0}</span>
              </div>
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:8px">
            <div style="text-align:right">
              <div style="font-size:11.5px;font-weight:700;color:${isFull ? '#34d399' : '#fbbf24'}">
                ${isFull ? 'Фулл (0)' : fmtNum(remCoupons) + ' куп.'}
              </div>
              <div style="font-size:10px;color:#9ca3af">дефицит</div>
            </div>

            <!-- Target Star toggle button -->
            <button type="button" onclick="event.stopPropagation();selectTmaTargetOfficer('${off.id}')" class="tma-target-star-btn ${isTarget ? 'active' : ''}" title="${isTarget ? 'Текущая цель в калькуляторе' : 'Сделать целью в калькуляторе'}">
              ${isTarget ? '⭐' : '☆'}
            </button>

            <!-- Edit button -->
            <button type="button" onclick="event.stopPropagation();openTmaEditOfficerModal('${off.id}')" class="tma-quick-btn" style="padding:4px 8px;font-size:11.5px" title="Редактировать">
              ✏️
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function selectTmaTargetOfficer(officerId) {
  tmaHaptic('selection');
  state.tmaTargetOfficerId = officerId;
  const pId = currentUser?.playerId || myCabinetProfile?.id;
  if (pId && typeof localStorage !== 'undefined') {
    localStorage.setItem('kow_tma_target_' + pId, String(officerId));
  }
  if (typeof myCabinetSim !== 'undefined') {
    myCabinetSim.officerId = officerId;
  }
  const off = (myCabinetProfile?.officers || []).find(o => String(o.id) === String(officerId));
  const offName = off?.name || 'Офицер';

  renderTmaCabinet();
  renderTmaOfficersPickerList();
  closeTmaModals();
  tmaHaptic('success');
  toast(`Офицер «${offName}» выбран целью калькулятора ⭐`, 'success');
}

function toggleTmaOfficerMode(officerId) {
  tmaHaptic('selection');
  const current = getOfficerMode(officerId);
  const next = (current === 'normal') ? 'retro' : 'normal';
  setOfficerMode(officerId, next);
  renderTmaCabinet();
}

async function handleTmaStarClick(officerId, stars) {
  tmaHaptic('selection');
  await setMyOfficerStars(officerId, stars);
  renderTmaCabinet();
}

async function handleTmaSkillClick(officerId, skillIdx, level) {
  tmaHaptic('selection');
  await setMyOfficerSkill(officerId, skillIdx, level);
  renderTmaCabinet();
}

function onTmaOfficerModeChange(mode) {
  tmaOfficerModalMode = (mode === 'normal') ? 'normal' : 'retro';
  const lblRetro = document.getElementById('tma-off-lbl-retro');
  const lblNormal = document.getElementById('tma-off-lbl-normal');
  const hint = document.getElementById('tma-off-mode-hint');
  if (lblRetro) lblRetro.classList.toggle('active', tmaOfficerModalMode === 'retro');
  if (lblNormal) lblNormal.classList.toggle('active', tmaOfficerModalMode === 'normal');
  if (hint) hint.textContent = (tmaOfficerModalMode === 'retro') ? 'Без списания ресурсов' : 'Списание со склада трекера';
  tmaHaptic('selection');
}

function setTmaOfficerModalLevel(lvl) {
  const el = document.getElementById('tma-off-level');
  if (el) el.value = Math.max(0, Math.min(180, Number(lvl) || 0));
  tmaHaptic('selection');
}

function setTmaOfficerModalStar(stars) {
  tmaOfficerModalStars = Math.max(0, Math.min(5, Number(stars) || 0));
  renderTmaOfficerModalStars();
  tmaHaptic('selection');
}

function renderTmaOfficerModalStars() {
  const container = document.getElementById('tma-off-stars-container');
  const label = document.getElementById('tma-off-stars-label');
  if (label) label.textContent = `${tmaOfficerModalStars}★`;
  if (!container) return;
  container.innerHTML = [0, 1, 2, 3, 4, 5].map(s => `
    <button type="button" class="tma-star-btn ${tmaOfficerModalStars === s ? 'active' : ''}" onclick="setTmaOfficerModalStar(${s})">
      ${s === 0 ? '0★' : `${s}★`}
    </button>
  `).join('');
}

function setTmaOfficerModalSkill(skillIdx, lvl) {
  tmaOfficerModalSkills[skillIdx] = Math.max(1, Math.min(5, Number(lvl) || 1));
  renderTmaOfficerModalSkills();
  tmaHaptic('selection');
}

function renderTmaOfficerModalSkills() {
  const container = document.getElementById('tma-off-skills-container');
  const medalsBadge = document.getElementById('tma-off-skills-medals');
  if (medalsBadge) {
    const calcFn = (typeof logic !== 'undefined' && logic.calculateSkillMedalsProgress) ? logic.calculateSkillMedalsProgress : null;
    const spent = calcFn ? calcFn(tmaOfficerModalSkills) : 0;
    medalsBadge.textContent = `${fmtNum(spent)} / 690 медалей`;
  }
  if (!container) return;
  container.innerHTML = [0, 1, 2, 3].map(sIdx => `
    <div class="tma-skill-row">
      <span class="tma-skill-name">Н${sIdx + 1}</span>
      <div class="tma-skill-btn-group">
        ${[1, 2, 3, 4, 5].map(lvl => `
          <button type="button" class="tma-skill-btn ${tmaOfficerModalSkills[sIdx] === lvl ? 'active' : ''}" onclick="setTmaOfficerModalSkill(${sIdx}, ${lvl})">${lvl}</button>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function onTmaOfficerCatalogChange() {
  const select = document.getElementById('tma-off-catalog-select');
  if (!select) return;
  const cat = getCatalogOfficer(select.value);
  if (cat) {
    const medalsBadge = document.getElementById('tma-off-skills-medals');
    const maxMedals = cat.medalsBeforeTraining || cat.medals_before_training || 690;
    const calcFn = (typeof logic !== 'undefined' && logic.calculateSkillMedalsProgress) ? logic.calculateSkillMedalsProgress : null;
    const spent = calcFn ? calcFn(tmaOfficerModalSkills) : 0;
    if (medalsBadge) medalsBadge.textContent = `${fmtNum(spent)} / ${maxMedals} медалей`;
  }
}

function openTmaAddOfficerModal() {
  tmaHaptic('light');
  tmaOfficerModalEditId = null;
  tmaOfficerModalSkills = [1, 1, 1, 1];
  tmaOfficerModalStars = 0;
  tmaOfficerModalMode = getOfficerStockMode() || 'retro';

  const titleEl = document.getElementById('tma-officer-modal-title');
  if (titleEl) titleEl.textContent = '🎖️ Добавить офицера';
  const subtitleEl = document.getElementById('tma-officer-modal-subtitle');
  if (subtitleEl) subtitleEl.textContent = 'Новый офицер сектора';

  const catGroup = document.getElementById('tma-off-catalog-group');
  if (catGroup) catGroup.style.display = 'block';

  const select = document.getElementById('tma-off-catalog-select');
  if (select) {
    const existingCatalogIds = new Set((myCabinetProfile?.officers || []).map(o => o.catalogId));
    select.innerHTML = (state.officerCatalog || []).map(cat => {
      const already = existingCatalogIds.has(cat.id);
      return `<option value="${cat.id}" ${already ? 'disabled' : ''}>${escapeHtml(cat.name)} (${cat.type || 'Пехота'}, Ген. ${cat.generation || 1})${already ? ' — уже добавлен' : ''}</option>`;
    }).join('');
  }

  const lvlEl = document.getElementById('tma-off-level');
  if (lvlEl) lvlEl.value = 0;
  const puzEl = document.getElementById('tma-off-personal-puzzles');
  if (puzEl) puzEl.value = 0;
  const onlyEl = document.getElementById('tma-off-only-personal');
  if (onlyEl) onlyEl.checked = false;

  const delBtn = document.getElementById('tma-off-delete-btn');
  if (delBtn) delBtn.style.display = 'none';

  onTmaOfficerModeChange(tmaOfficerModalMode);
  renderTmaOfficerModalStars();
  renderTmaOfficerModalSkills();

  const modal = document.getElementById('tma-officer-modal');
  if (modal) modal.style.display = 'flex';
}

function openTmaEditOfficerModal(officerId) {
  tmaHaptic('light');
  tmaOfficerModalEditId = officerId;
  const off = (myCabinetProfile?.officers || []).find(o => String(o.id) === String(officerId));
  if (!off) return;

  const cat = getCatalogOfficer(off.catalogId);
  const titleEl = document.getElementById('tma-officer-modal-title');
  if (titleEl) titleEl.textContent = `🎖️ Редактировать: ${escapeHtml(off.name || cat?.name || '')}`;
  const subtitleEl = document.getElementById('tma-officer-modal-subtitle');
  if (subtitleEl) subtitleEl.textContent = `${cat?.type || 'Офицер'} • Ген. ${cat?.generation || 1}`;

  const catGroup = document.getElementById('tma-off-catalog-group');
  if (catGroup) catGroup.style.display = 'none';

  tmaOfficerModalSkills = Array.isArray(off.skills) && off.skills.length === 4 ? [...off.skills] : [1, 1, 1, 1];
  tmaOfficerModalStars = Math.max(0, Math.min(5, Number(off.stars) || 0));
  tmaOfficerModalMode = getOfficerMode(officerId);

  const lvlEl = document.getElementById('tma-off-level');
  if (lvlEl) lvlEl.value = off.level || 0;
  const puzEl = document.getElementById('tma-off-personal-puzzles');
  if (puzEl) puzEl.value = off.personalPuzzles || off.personal_puzzles || 0;
  const onlyEl = document.getElementById('tma-off-only-personal');
  if (onlyEl) onlyEl.checked = Boolean(off.onlyPersonalPuzzles || off.only_personal_puzzles);

  const delBtn = document.getElementById('tma-off-delete-btn');
  if (delBtn) delBtn.style.display = 'block';

  onTmaOfficerModeChange(tmaOfficerModalMode);
  renderTmaOfficerModalStars();
  renderTmaOfficerModalSkills();

  const modal = document.getElementById('tma-officer-modal');
  if (modal) modal.style.display = 'flex';
}

async function deleteTmaCurrentOfficer() {
  if (!tmaOfficerModalEditId) return;
  const off = (myCabinetProfile?.officers || []).find(o => String(o.id) === String(tmaOfficerModalEditId));
  const offName = off?.name || 'офицера';
  if (!confirm(`Удалить офицера «${offName}» из сектора?`)) return;

  tmaHaptic('medium');
  try {
    await deleteMyOfficer(tmaOfficerModalEditId, offName);
    tmaHaptic('success');
    closeTmaModals();
    renderTmaCabinet();
    renderTmaOfficersPickerList();
  } catch (err) {
    tmaHaptic('error');
    toast('Ошибка удаления: ' + (err.message || err), 'error');
  }
}

async function submitTmaOfficerEdit() {
  tmaHaptic('medium');
  const level = Math.max(0, Math.min(180, parseInt(document.getElementById('tma-off-level')?.value) || 0));
  const personalPuzzles = Math.max(0, parseInt(document.getElementById('tma-off-personal-puzzles')?.value) || 0);
  const onlyPersonalPuzzles = Boolean(document.getElementById('tma-off-only-personal')?.checked);
  const stars = tmaOfficerModalStars;
  const skills = Array.isArray(tmaOfficerModalSkills) && tmaOfficerModalSkills.length === 4
    ? tmaOfficerModalSkills.map(s => Math.max(1, Math.min(5, parseInt(s) || 1)))
    : [1, 1, 1, 1];
  const isRetro = (tmaOfficerModalMode === 'retro');

  let newStock = null;
  let newInvested = null;

  if (!isRetro && myCabinetProfile?.stock) {
    if (tmaOfficerModalEditId) {
      const oldOff = myCabinetProfile.officers?.find(o => String(o.id) === String(tmaOfficerModalEditId));
      if (oldOff) {
        const cat = getCatalogOfficer(oldOff.catalogId);
        const rawCost = Number(cat?.couponPerPuzzle);
        const costPerPuzzle = rawCost === 0 ? (cat?.upgradeType === 'special' ? 0 : 500) : (rawCost || (cat?.generation === 7 ? 600 : (cat?.generation >= 8 ? 720 : 500)));
        const upgradeType = cat?.upgradeType || 'standard';
        const starCouponCost = cat?.starCouponCost || (cat?.generation === 7 ? 300 : (cat?.generation <= 6 ? 250 : 360));
        const maxMedals = (cat && (cat.medalsBeforeTraining || cat.medals_before_training)) || 690;

        let curStock = { ...myCabinetProfile.stock };
        const normInvFn = (typeof logic !== 'undefined' && logic.normalizeInvested) ? logic.normalizeInvested : normalizeInvested;
        let curInv = normInvFn ? normInvFn(oldOff.invested || oldOff.invested_json) : { ...(oldOff.invested || {}) };
        let hasChanges = false;

        // 1. Level
        if (oldOff.level !== level) {
          const deltaFn = (typeof logic !== 'undefined' && logic.calculateLevelStockDelta) ? logic.calculateLevelStockDelta : calculateLevelStockDelta;
          const levelStockDelta = deltaFn(oldOff.level, level, curStock, costPerPuzzle, upgradeType, curInv);
          if (!levelStockDelta.canAfford) {
            tmaHaptic('error');
            toast(`❌ Недостаточно ресурсов на складе для изменения уровня (не хватает ${fmtNum(levelStockDelta.deficitPuzzles || 0)} пазл.). Изменение отменено.`, 'error');
            return;
          }
          curStock.coupons = Math.max(0, (curStock.coupons || 0) + (levelStockDelta.delta.coupons || 0));
          curStock.puzzles = Math.max(0, (curStock.puzzles || 0) + (levelStockDelta.delta.puzzles || 0));
          if (levelStockDelta.newInvested) curInv = levelStockDelta.newInvested;
          hasChanges = true;
        }

        // 2. Stars
        const oldStars = Number(oldOff.stars) || 0;
        if (oldStars !== stars) {
          const deltaStarFn = (typeof logic !== 'undefined' && logic.calculateStarStockDelta) ? logic.calculateStarStockDelta : calculateStarStockDelta;
          const starRes = deltaStarFn(oldStars, stars, curStock, starCouponCost, curInv);
          if (!starRes.canAfford) {
            tmaHaptic('error');
            toast(`❌ Недостаточно ресурсов на складе для изменения звёзд. Изменение отменено.`, 'error');
            return;
          }
          curStock.starCoupons = Math.max(0, (curStock.starCoupons || 0) + (starRes.delta.starCoupons || 0));
          curStock.legendaryStars1 = Math.max(0, (curStock.legendaryStars1 || 0) + (starRes.delta.legendaryStars1 || 0));
          curStock.legendaryStars2 = Math.max(0, (curStock.legendaryStars2 || 0) + (starRes.delta.legendaryStars2 || 0));
          curStock.legendaryStars3 = Math.max(0, (curStock.legendaryStars3 || 0) + (starRes.delta.legendaryStars3 || 0));
          if (starRes.newInvested) curInv = starRes.newInvested;
          hasChanges = true;
        }

        // 3. Skills
        const oldSkills = Array.isArray(oldOff.skills) && oldOff.skills.length === 4 ? oldOff.skills : [1, 1, 1, 1];
        const hasSkillDiff = skills.some((s, idx) => s !== oldSkills[idx]);
        if (hasSkillDiff) {
          const deltaSkillFn = (typeof logic !== 'undefined' && logic.calculateSkillStockDelta) ? logic.calculateSkillStockDelta : calculateSkillStockDelta;
          const skillRes = deltaSkillFn(oldSkills, skills, curStock, costPerPuzzle, upgradeType, maxMedals, curInv);
          if (!skillRes.canAfford) {
            tmaHaptic('error');
            toast(`❌ Недостаточно ресурсов на складе для изменения навыков (не хватает ${fmtNum(skillRes.deficitMedals || 0)} медалей). Изменение отменено.`, 'error');
            return;
          }
          curStock.coupons = Math.max(0, (curStock.coupons || 0) + (skillRes.delta.coupons || 0));
          curStock.puzzles = Math.max(0, (curStock.puzzles || 0) + (skillRes.delta.puzzles || 0));
          if (skillRes.newInvested) curInv = skillRes.newInvested;
          hasChanges = true;
        }

        if (hasChanges) {
          newStock = curStock;
          newInvested = curInv;
        }
      }
    }
  }

  try {
    if (tmaOfficerModalEditId) {
      const updatedOffData = await doTmaApiFetch(`/api/my-profile/officers/${tmaOfficerModalEditId}`, {
        method: 'PUT',
        body: {
          level,
          stars,
          skills,
          personalPuzzles,
          onlyPersonalPuzzles,
          deductStock: !isRetro,
          ...(newInvested ? { invested: newInvested } : {})
        }
      });

      if (updatedOffData && updatedOffData.newStock) {
        myCabinetProfile.stock = updatedOffData.newStock;
        if (state.players) {
          const me = state.players.find(p => p.id === myCabinetProfile.id);
          if (me) me.stock = updatedOffData.newStock;
        }
      } else if (newStock) {
        myCabinetProfile.stock = newStock;
        if (state.players) {
          const me = state.players.find(p => p.id === myCabinetProfile.id);
          if (me) me.stock = newStock;
        }
      }

      const off = myCabinetProfile?.officers?.find(o => String(o.id) === String(tmaOfficerModalEditId));
      if (off) {
        if (updatedOffData && updatedOffData.id) Object.assign(off, updatedOffData);
        else {
          off.level = level;
          off.stars = stars;
          off.skills = skills;
          off.personalPuzzles = personalPuzzles;
          off.onlyPersonalPuzzles = onlyPersonalPuzzles;
        }
        if (newInvested) off.invested = newInvested;
      }
      if (state.players) {
        for (const p of state.players) {
          if (p.id === myCabinetProfile?.id && p.officers) {
            const po = p.officers.find(o => String(o.id) === String(tmaOfficerModalEditId));
            if (po) {
              if (updatedOffData && updatedOffData.id) Object.assign(po, updatedOffData);
              else {
                po.level = level;
                po.stars = stars;
                po.skills = skills;
                po.personalPuzzles = personalPuzzles;
                po.onlyPersonalPuzzles = onlyPersonalPuzzles;
              }
              if (newInvested) po.invested = newInvested;
            }
          }
        }
      }

      setOfficerMode(tmaOfficerModalEditId, isRetro ? 'retro' : 'normal', { silent: true });
      tmaHaptic('success');
      closeTmaModals();
      toast('Офицер обновлен', 'success');
      renderTmaCabinet();
      renderTmaOfficersPickerList();
      if (typeof renderMyCabinet === 'function') renderMyCabinet().catch(() => {});
    } else {
      const catalogId = document.getElementById('tma-off-catalog-select')?.value;
      if (!catalogId) {
        tmaHaptic('error');
        toast('Выберите офицера из каталога', 'error');
        return;
      }
      const cat = getCatalogOfficer(catalogId);

      let initialStockDeduction = null;
      if (!isRetro && myCabinetProfile?.stock) {
        const initialFn = (typeof logic !== 'undefined' && logic.calculateInitialOfficerStockDeduction)
          ? logic.calculateInitialOfficerStockDeduction
          : calculateInitialOfficerStockDeduction;
        if (initialFn) {
          initialStockDeduction = initialFn({
            officer: { level, stars, skills },
            stock: myCabinetProfile.stock,
            catalogOfficer: cat,
            isRetrospective: false
          });
          if (!initialStockDeduction.canAfford) {
            tmaHaptic('error');
            toast(initialStockDeduction.error || '❌ Недостаточно ресурсов на складе для прокачки офицера', 'error');
            return;
          }
        }
      }

      const payload = {
        catalogId,
        name: cat?.name || '',
        level,
        coupons: 0,
        stars,
        skills,
        personalPuzzles,
        onlyPersonalPuzzles,
        deductStock: !isRetro,
        ...(initialStockDeduction?.invested ? { invested: initialStockDeduction.invested } : {})
      };

      const createdOff = await doTmaApiFetch('/api/my-profile/officers', {
        method: 'POST',
        body: payload
      });

      if (createdOff && createdOff.id) {
        setOfficerMode(createdOff.id, isRetro ? 'retro' : 'normal', { silent: true });
      }

      if (createdOff && createdOff.newStock) {
        myCabinetProfile.stock = createdOff.newStock;
        if (state.players) {
          const me = state.players.find(p => p.id === myCabinetProfile.id);
          if (me) me.stock = createdOff.newStock;
        }
      } else if (initialStockDeduction && initialStockDeduction.deductStock && initialStockDeduction.newStock) {
        myCabinetProfile.stock = initialStockDeduction.newStock;
        if (state.players) {
          const me = state.players.find(p => p.id === myCabinetProfile.id);
          if (me) me.stock = initialStockDeduction.newStock;
        }
      }

      if (myCabinetProfile) {
        myCabinetProfile.officers = myCabinetProfile.officers || [];
        if (createdOff && createdOff.id && !myCabinetProfile.officers.some(o => String(o.id) === String(createdOff.id))) {
          myCabinetProfile.officers.push(createdOff);
        }
      }

      tmaHaptic('success');
      closeTmaModals();
      toast('Офицер добавлен в сектор' + (initialStockDeduction?.deductStock ? ' (ресурсы списаны)' : ''), 'success');
      renderTmaCabinet();
      renderTmaOfficersPickerList();
      if (typeof renderMyCabinet === 'function') renderMyCabinet().catch(() => {});
    }
  } catch (err) {
    tmaHaptic('error');
    toast('Ошибка сохранения офицера: ' + (err.message || err), 'error');
  }
}

function closeTmaEventModal() {
  const modal = document.getElementById('tma-event-modal');
  if (modal) modal.style.display = 'none';
}

async function handleTmaConfirmRsvp(eventId, placeNum) {
  tmaHaptic('medium');
  try {
    await doTmaApiFetch(`/api/events/${eventId}/rsvp`, {
      method: 'POST',
      body: { place: Number(placeNum), status: 'confirmed' }
    });
    tmaHaptic('success');
    toast(`Место #${placeNum} подтверждено!`, 'success');
    await doTmaLoadData();
    openTmaEventDetail(eventId);
    renderTmaEvents();
  } catch (err) {
    tmaHaptic('error');
    toast('Ошибка подтверждения: ' + (err.message || 'попробуйте позже'), 'error');
  }
}

async function handleTmaAssignPlace(eventId, playerId, newPlace) {
  tmaHaptic('medium');
  try {
    const ev = (state.events || []).find(e => Number(e.id) === Number(eventId)) || {};
    let assignments = Array.isArray(ev.assignments) ? [...ev.assignments] : [];
    const pId = Number(playerId);
    const placeNum = Number(newPlace);

    assignments = assignments.filter(a => Number(a.playerId) !== pId);

    if (placeNum > 0) {
      assignments = assignments.filter(a => Number(a.place) !== placeNum);
      assignments.push({
        place: placeNum,
        playerId: pId,
        rsvpStatus: 'confirmed',
        assignedAt: new Date().toISOString()
      });
    }

    const payload = {
      id: ev.id,
      typeId: ev.typeId || ev.type_id,
      dateFrom: ev.dateFrom || ev.startDate || ev.dateStart,
      dateTo: ev.dateTo || ev.endDate || ev.dateEnd,
      note: ev.note || '',
      assignments
    };

    await doTmaApiFetch(`/api/events/${eventId}`, {
      method: 'PUT',
      body: payload
    });

    tmaHaptic('success');
    toast(placeNum > 0 ? `Место #${placeNum} назначено!` : 'Назначение отменено', 'success');
    await doTmaLoadData();
    openTmaEventDetail(eventId);
    renderTmaEvents();
  } catch (err) {
    tmaHaptic('error');
    toast('Ошибка назначения: ' + (err.message || 'попробуйте позже'), 'error');
  }
}

async function handleTmaStaffRemoveParticipant(eventId, playerId) {
  tmaHaptic('medium');
  if (!confirm('Снять участника с события?')) return;
  try {
    await doTmaApiFetch(`/api/events/${eventId}/register?sectorId=${playerId}`, {
      method: 'DELETE'
    });

    const ev = (state.events || []).find(e => Number(e.id) === Number(eventId));
    if (ev && Array.isArray(ev.assignments) && ev.assignments.some(a => Number(a.playerId) === Number(playerId))) {
      const assignments = ev.assignments.filter(a => Number(a.playerId) !== Number(playerId));
      await doTmaApiFetch(`/api/events/${eventId}`, {
        method: 'PUT',
        body: {
          id: ev.id,
          typeId: ev.typeId || ev.type_id,
          dateFrom: ev.dateFrom || ev.startDate || ev.dateStart,
          dateTo: ev.dateTo || ev.endDate || ev.dateEnd,
          note: ev.note || '',
          assignments
        }
      }).catch(() => {});
    }

    tmaHaptic('success');
    toast('Игрок снят с события', 'info');
    await doTmaLoadData();
    openTmaEventDetail(eventId);
    renderTmaEvents();
  } catch (err) {
    tmaHaptic('error');
    toast('Ошибка снятия: ' + (err.message || 'попробуйте позже'), 'error');
  }
}

function handleTmaMainAction() {
  tmaHaptic('light');
  if (activeTmaTab === 'cabinet') {
    const fileInput = document.getElementById('tma-ocr-input');
    if (fileInput) {
      fileInput.click();
    } else {
      openSmartScannerModal('my_cabinet');
    }
  } else if (activeTmaTab === 'events') {
    if (tmaEventsSubTab !== 'upcoming') {
      switchTmaEventsSubTab('upcoming');
    }
    const upcomingEvents = (state.events || [])
      .filter(e => !e.isCompleted && e.status !== 'completed')
      .sort((a, b) => new Date(a.startDate || a.dateStart || 0) - new Date(b.startDate || b.dateStart || 0));
    if (upcomingEvents.length > 0) {
      openTmaEventDetail(upcomingEvents[0].id);
    } else {
      toast('Нет активных предстоящих событий для записи', 'info');
    }
  } else if (activeTmaTab === 'matrix') {
    refreshTmaCurrentTab();
  }
}

function handleTmaOcrFileInput(event) {
  const files = event.target.files;
  if (!files || !files.length) return;
  openSmartScannerModal('my_cabinet');
  if (typeof handleScannerFiles === 'function') {
    handleScannerFiles(files);
  }
}

async function refreshTmaCurrentTab() {
  tmaHaptic('light');
  try {
    await doTmaLoadData();
    if (activeTmaTab === 'cabinet') renderTmaCabinet();
    else if (activeTmaTab === 'events') renderTmaEvents();
    else if (activeTmaTab === 'matrix') renderTmaMatrix();
    toast('Данные обновлены', 'success');
  } catch (err) {
    toast('Ошибка обновления: ' + err.message, 'error');
  }
}


if (typeof window !== "undefined") {
  window.isTmaMode = isTmaMode;
  window.enableTmaView = enableTmaView;
  window.setupTmaEnvironment = setupTmaEnvironment;
  window.initTmaAuth = initTmaAuth;
  window.renderTmaApp = renderTmaApp;
  window.renderTmaUnboundScreen = renderTmaUnboundScreen;
  window.switchTmaTab = switchTmaTab;
  window.switchTmaEventsSubTab = switchTmaEventsSubTab;
  window.handleTmaMainAction = handleTmaMainAction;
  window.handleTmaOcrFileInput = handleTmaOcrFileInput;
  window.handleTmaRegisterEvent = handleTmaRegisterEvent;
  window.handleTmaUnregisterEvent = handleTmaUnregisterEvent;
  window.openTmaEventDetail = openTmaEventDetail;
  window.closeTmaEventModal = closeTmaEventModal;
  window.handleTmaAssignPlace = handleTmaAssignPlace;
  window.handleTmaStaffRemoveParticipant = handleTmaStaffRemoveParticipant;
  window.handleTmaConfirmRsvp = handleTmaConfirmRsvp;
  window.formatTmaCouponsShort = formatTmaCouponsShort;
  window.updateTmaMainButton = updateTmaMainButton;
  window.handleTmaLoginSubmit = handleTmaLoginSubmit;
  window.handleTmaRegisterSubmit = handleTmaRegisterSubmit;
  window.toggleTmaRegisterSection = toggleTmaRegisterSection;
  window.refreshTmaCurrentTab = refreshTmaCurrentTab;
  window.tmaHaptic = tmaHaptic;

  window.openTmaOfficersPickerModal = openTmaOfficersPickerModal;
  window.renderTmaOfficersPickerList = renderTmaOfficersPickerList;
  window.selectTmaTargetOfficer = selectTmaTargetOfficer;
  window.toggleTmaOfficerMode = toggleTmaOfficerMode;
  window.handleTmaStarClick = handleTmaStarClick;
  window.handleTmaSkillClick = handleTmaSkillClick;
  window.openTmaAddOfficerModal = openTmaAddOfficerModal;
  window.openTmaEditOfficerModal = openTmaEditOfficerModal;
  window.onTmaOfficerCatalogChange = onTmaOfficerCatalogChange;
  window.onTmaOfficerModeChange = onTmaOfficerModeChange;
  window.setTmaOfficerModalLevel = setTmaOfficerModalLevel;
  window.setTmaOfficerModalStar = setTmaOfficerModalStar;
  window.setTmaOfficerModalSkill = setTmaOfficerModalSkill;
  window.deleteTmaCurrentOfficer = deleteTmaCurrentOfficer;
  window.submitTmaOfficerEdit = submitTmaOfficerEdit;

  window.toggleTmaOfficersAccordion = toggleTmaOfficersAccordion;
  window.openTmaEventEditor = openTmaEventEditor;
  window.onTmaEventTypeChange = onTmaEventTypeChange;
  window.renderTmaEventEditorPlaces = renderTmaEventEditorPlaces;
  window.addTmaEventPlaceRow = addTmaEventPlaceRow;
  window.removeTmaEventPlaceRow = removeTmaEventPlaceRow;
  window.runTmaEventAutopick = runTmaEventAutopick;
  window.submitTmaEventEditor = submitTmaEventEditor;
  window.handleTmaDeleteEvent = handleTmaDeleteEvent;
  window.handleTmaRunAutopick = handleTmaRunAutopick;
  window.deleteTmaCurrentEvent = deleteTmaCurrentEvent;
  window.openTmaSectorDetail = openTmaSectorDetail;
  window.closeTmaEventEditorModal = closeTmaEventEditorModal;
  window.closeTmaSectorDetailModal = closeTmaSectorDetailModal;
}

// Auto-initialize TMA if launched inside Telegram WebApp
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  let tmaAutoLaunched = false;
  const launchTmaIfActive = async () => {
    if (tmaAutoLaunched) return;
    if (typeof isTmaMode === 'function' && isTmaMode()) {
      tmaAutoLaunched = true;
      enableTmaView();
      setupTmaEnvironment();
      try {
        await initTmaAuth();
      } catch (err) {
        console.warn('[TMA] Auto-auth failed on launch:', err);
        if (typeof renderTmaUnboundScreen === 'function') {
          renderTmaUnboundScreen(err);
        }
      }
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', launchTmaIfActive);
  } else {
    launchTmaIfActive();
  }
}
