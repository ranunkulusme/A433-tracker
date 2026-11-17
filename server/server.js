const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const db = require('./db.js');
const logic = require('../shared/logic.js');
const s3 = require('./s3.js');
const telegram = require('./telegram.js');
const mieru = require('./mieru.js');
const { createEventOperations } = require('./event-ops.js');
const { createTelegramBotController } = require('./bot-controller.js');
const { createOfficerProgression } = require('./officer-progression.js');
const { createNotificationEngine } = require('./notification-engine.js');
const { createAuthGuard } = require('./auth-guard.js');
const { createSeasonPlanner } = require('./season-planner.js');

const authGuard = createAuthGuard({ db, logic });

let APP_VERSION = '3.21.0';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  if (pkg.version) APP_VERSION = pkg.version;
} catch (_) {}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm'
};

let customOcrRunner = null;
function setServerOcrRunner(runner) {
  customOcrRunner = runner;
}

async function tryServerOcr(imageBufferOrPath) {
  if (typeof customOcrRunner === 'function') {
    try {
      const res = await customOcrRunner(imageBufferOrPath);
      return res;
    } catch (err) {
      console.warn('[OCR] Custom OCR runner error:', err.message);
      return null;
    }
  }

  try {
    const { execFile } = require('node:child_process');
    const os = require('node:os');

    let filePath = imageBufferOrPath;
    let tempCreated = false;
    if (Buffer.isBuffer(imageBufferOrPath)) {
      filePath = path.join(os.tmpdir(), `ocr_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
      await fs.promises.writeFile(filePath, imageBufferOrPath);
      tempCreated = true;
    }

    try {
      const ocrText = await new Promise((resolve, reject) => {
        execFile('tesseract', [filePath, 'stdout', '-l', 'eng+rus'], { timeout: 15000 }, (error, stdout) => {
          if (error) return reject(error);
          resolve(stdout || '');
        });
      });

      if (ocrText && ocrText.trim()) {
        const parsedStock = logic.parseWarehouseScreenshotText(ocrText);
        if (parsedStock && (parsedStock.coupons > 0 || parsedStock.puzzles > 0 || parsedStock.starCoupons > 0)) {
          return parsedStock;
        }
      }
      return null;
    } finally {
      if (tempCreated) {
        fs.promises.unlink(filePath).catch(() => {});
      }
    }
  } catch (ocrErr) {
    return null;
  }
}

function sendJson(res, statusCode, data) {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cache-Control, Pragma'
  });
  res.end(json);
}

function sendError(res, statusCode, code, message) {
  sendJson(res, statusCode, { error: code, message: message || code });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 50 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!data.trim()) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function authenticate(req) {
  return authGuard.authenticate(req);
}

function sanitizeSkills(skills) {
  if (!Array.isArray(skills)) return [1, 1, 1, 1];
  const arr = skills.slice(0, 4);
  while (arr.length < 4) arr.push(1);
  return arr.map(n => Math.max(1, Math.min(5, Math.floor(Number(n) || 1))));
}

function sanitizeInvested(invested) {
  if (!invested || typeof invested !== 'object') return { ...logic.INVESTED_ZERO };
  return logic.normalizeInvested(invested);
}

function sanitizeVipPoints(pts) {
  return Math.max(0, Math.floor(Number(pts) || 0));
}

function sanitizeStock(stock) {
  if (!stock || typeof stock !== 'object') return stock;
  if (stock.starCoupons !== undefined) {
    stock.starCoupons = Math.max(0, parseInt(stock.starCoupons, 10) || 0);
  }
  if (stock.legendaryStars1 !== undefined) {
    stock.legendaryStars1 = Math.max(0, parseInt(stock.legendaryStars1, 10) || 0);
  }
  if (stock.legendaryStars2 !== undefined) {
    stock.legendaryStars2 = Math.max(0, parseInt(stock.legendaryStars2, 10) || 0);
  }
  if (stock.legendaryStars3 !== undefined) {
    stock.legendaryStars3 = Math.max(0, parseInt(stock.legendaryStars3, 10) || 0);
  }
  if (stock.coupons !== undefined) {
    stock.coupons = Math.max(0, parseInt(stock.coupons, 10) || 0);
  }
  if (stock.puzzles !== undefined) {
    stock.puzzles = Math.max(0, parseInt(stock.puzzles, 10) || 0);
  }
  if (stock.chests !== undefined) {
    stock.chests = Math.max(0, parseInt(stock.chests, 10) || 0);
  }
  return stock;
}

function sanitizePersonalPuzzles(val) {
  const num = parseInt(val, 10);
  return isNaN(num) || num < 0 ? 0 : num;
}

function sanitizeEventTypePlaces(places) {
  if (!Array.isArray(places)) return [];
  return places.map((p, idx) => ({
    place: Math.max(1, parseInt(p.place) || (idx + 1)),
    label: String(p.label || `${p.place || (idx + 1)} место`).trim(),
    coupons: Math.max(0, parseInt(p.coupons) || 0)
  }));
}

function sanitizeEventType(data) {
  if (!data || typeof data !== 'object') return {};
  const isPeriodic = data.isPeriodic !== undefined ? (data.isPeriodic ? 1 : 0) : (data.is_periodic !== undefined ? (data.is_periodic ? 1 : 0) : 1);
  const startDayOfWeek = Math.max(1, Math.min(7, parseInt(data.startDayOfWeek ?? data.start_day_of_week) || 2));
  const endDayOfWeek = Math.max(1, Math.min(7, parseInt(data.endDayOfWeek ?? data.end_day_of_week) || 3));
  const activeWeeks = Math.max(1, parseInt(data.activeWeeks ?? data.active_weeks) || 1);
  const breakWeeks = Math.max(0, parseInt(data.breakWeeks ?? data.break_weeks) || 1);
  const weekOffset = Math.max(0, parseInt(data.weekOffset ?? data.week_offset) || 0);
  const places = data.places !== undefined ? sanitizeEventTypePlaces(data.places) : undefined;

  const result = {
    ...data,
    isPeriodic,
    startDayOfWeek,
    endDayOfWeek,
    activeWeeks,
    breakWeeks,
    weekOffset
  };
  if (places !== undefined) {
    result.places = places;
  }
  return result;
}

function requireAuth(req, res) {
  if (!req.user) {
    sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
    return false;
  }
  return true;
}

function requireRole(roles) {
  return (req, res) => {
    if (!req.user) authenticate(req);
    if (!req.user) {
      sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      return false;
    }
    if (!authGuard.hasRole(req.user, roles)) {
      sendError(res, 403, 'FORBIDDEN', `Доступ запрещен для ранга ${req.user.rank}`);
      return false;
    }
    return true;
  };
}

function requirePermission(reqOrPerm, res, permission) {
  if (typeof reqOrPerm === 'string') {
    const perm = reqOrPerm;
    return (req, res) => requirePermission(req, res, perm);
  }
  const req = reqOrPerm;
  if (!req.user) {
    authenticate(req);
  }
  if (!req.user) {
    sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
    return false;
  }
  if (authGuard.hasPermission(req.user, permission)) {
    return true;
  }
  sendError(res, 403, 'FORBIDDEN', `Недостаточно прав: требуется разрешение ${permission}`);
  return false;
}

function maskPlayerStockIfNeeded(player, user) {
  return authGuard.maskPlayerStockIfNeeded(player, user);
}

function getAppBaseUrl(req = null) {
  const settingUrl = db.getAppSetting('app_base_url');
  if (settingUrl) return settingUrl.replace(/\/+$/, '');
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/+$/, '');
  if (req && req.headers && req.headers.host) {
    const proto = req.headers['x-forwarded-proto'] || 'http';
    return `${proto}://${req.headers.host}`;
  }
  return 'http://localhost:3000';
}

const notificationEngine = createNotificationEngine({
  db,
  logic,
  telegram,
  getAppBaseUrl
});

const seasonPlanner = createSeasonPlanner({
  db,
  logic,
  notificationEngine,
  getAppBaseUrl
});

function dispatchNotification(...args) {
  return notificationEngine.dispatchNotification(...args);
}

const eventOps = createEventOperations({
  db,
  logic,
  dispatchNotification,
  telegram,
  getAppBaseUrl
});

const botController = createTelegramBotController({
  db,
  logic,
  telegram,
  eventOps,
  notificationEngine,
  tryServerOcr,
  dispatchNotification,
  getAppBaseUrl,
  checkStaleStockReminders: (...args) => checkStaleStockReminders(...args)
});

const officerProgression = createOfficerProgression({ db, logic });

function checkStaleStockReminders(...args) {
  return notificationEngine.checkStaleStockReminders(...args);
}

function checkScheduledStaleStockReminders(...args) {
  return notificationEngine.checkScheduledStaleStockReminders(...args);
}

function checkScheduledEventMorningReminders(...args) {
  return notificationEngine.checkScheduledEventMorningReminders(...args);
}

function getPlayerTargetOfficerDeficit(player) {
  return botController.getPlayerTargetOfficerDeficit(player);
}

// ─── TELEGRAM BOT MESSAGE & UPDATE PROCESSOR ─────────────────────────

async function handleTelegramUpdate(update) {
  return botController.handleUpdate(update);
}

async function syncTelegramBotInfoAndPolling() {
  const token = db.getAppSetting('telegram_bot_token');
  if (!token) {
    telegram.stopTelegramPolling();
    return;
  }

  try {
    const meRes = await telegram.getTelegramMe(token);
    if (meRes.ok && meRes.result && meRes.result.username) {
      const liveUsername = meRes.result.username.replace(/^@+/, '');
      const existingUsername = db.getAppSetting('telegram_bot_username');
      if (!existingUsername || existingUsername !== liveUsername) {
        db.setAppSetting('telegram_bot_username', liveUsername);
      }
    }

    const rawWebAppUrl = db.getAppSetting('telegram_webapp_url') || db.getAppSetting('app_base_url');
    const webAppUrl = logic.formatTmaUrl ? logic.formatTmaUrl(rawWebAppUrl) : rawWebAppUrl;
    if (webAppUrl && /^https:\/\//i.test(webAppUrl)) {
      telegram.setTelegramChatMenuButton(token, {
        text: 'KoW Tracker',
        url: webAppUrl
      }).catch(err => {
        console.warn('[Telegram] Could not set chat menu button:', err.message);
      });
    }
  } catch (err) {
    console.warn('[Telegram] Could not sync bot info:', err.message);
  }

  telegram.startTelegramPolling({
    getBotToken: () => db.getAppSetting('telegram_bot_token'),
    getProxyUrl: () => telegram.getDefaultProxyUrl(),
    onUpdate: async (update) => {
      await handleTelegramUpdate(update);
    },
    onError: (err) => {
      console.warn('[Telegram Polling] Warning:', err.message || err);
    }
  });
}

const FORBIDDEN_FILES = new Set([
  'package.json',
  'package-lock.json',
  'server.js',
  'db.js',
  's3.js',
  'dockerfile',
  'docker-compose.yml',
  'readme.md'
]);

function isForbiddenFile(basename) {
  const lower = basename.toLowerCase();
  if (lower.startsWith('.')) return true;
  if (lower.endsWith('.db') || lower.endsWith('.test.js') || lower.endsWith('.md')) return true;
  return FORBIDDEN_FILES.has(lower);
}

function serveStaticFile(req, res, staticDir, pathname) {
  const rawUrl = req.url || '';
  if (rawUrl.includes('..') || rawUrl.includes('%2e%2e') || rawUrl.includes('%2E%2E')) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }

  const safeBase = path.resolve(staticDir || path.join(__dirname, '..', 'client'));
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let targetPath = path.resolve(safeBase, relativePath);

  // If file doesn't exist in client staticDir, check shared directory (e.g. logic.js)
  const sharedBase = path.resolve(__dirname, '..', 'shared');
  if (!fs.existsSync(targetPath)) {
    const sharedTarget = path.resolve(sharedBase, relativePath);
    if (sharedTarget.startsWith(sharedBase) && fs.existsSync(sharedTarget) && !isForbiddenFile(path.basename(sharedTarget))) {
      targetPath = sharedTarget;
    }
  }

  // Path traversal protection
  if (!targetPath.startsWith(safeBase) && !targetPath.startsWith(sharedBase)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }

  // Prevent serving sensitive backend files
  if (isForbiddenFile(path.basename(targetPath))) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }

  fs.stat(targetPath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }

    const ext = path.extname(targetPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const headers = {
      'Content-Type': contentType,
      'Content-Length': stats.size
    };

    if (pathname === '/sw.js') {
      headers['Content-Type'] = 'application/javascript; charset=UTF-8';
      headers['Service-Worker-Allowed'] = '/';
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    } else if (pathname === '/manifest.json') {
      headers['Content-Type'] = 'application/manifest+json; charset=UTF-8';
    } else if (ext === '.html' || ext === '.js' || ext === '.css') {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    }

    res.writeHead(200, headers);

    if (req.method === 'HEAD') {
      return res.end();
    }

    const stream = fs.createReadStream(targetPath);
    stream.pipe(res);
  });
}

// Sliding in-memory cache for deduplicating rapid duplicate event creation requests (double-clicks / retries)
const recentCreatedEventsCache = [];

function getRecentCreatedEvent(dedupeKey, ttlMs = 5000) {
  const now = Date.now();
  while (recentCreatedEventsCache.length > 0 && (now - recentCreatedEventsCache[0].timestamp > 15000)) {
    recentCreatedEventsCache.shift();
  }
  const found = recentCreatedEventsCache.find(r => r.key === dedupeKey && (now - r.timestamp < ttlMs));
  if (!found || !found.saved || !found.saved.id) return null;
  try {
    const existingInDb = db.getEventById(Number(found.saved.id));
    if (!existingInDb) return null;
  } catch (e) {
    return null;
  }
  return found;
}

function recordRecentCreatedEvent(dedupeKey, saved) {
  recentCreatedEventsCache.push({ key: dedupeKey, saved, timestamp: Date.now() });
}

function createRequestHandler(staticDir, s3Manager = null) {
  return async (req, res) => {
    try {
      // Automatic S3 synchronization for mutating API requests
      if (s3Manager && s3Manager.getStatus().enabled) {
        res.on('finish', () => {
          if (
            res.statusCode >= 200 &&
            res.statusCode < 400 &&
            ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
          ) {
            const pathName = req.url ? req.url.split('?')[0] : '';
            if (pathName !== '/api/admin/s3-sync') {
              s3Manager.pushDebounced();
            }
          }
        });
      }

      // CORS Preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        });
        return res.end();
      }

      const parsedUrl = new URL(req.url, 'http://localhost');
      const pathname = parsedUrl.pathname;

      // Attach user from token if present
      authenticate(req);

      // Non-API routes -> Static files
      if (!pathname.startsWith('/api/')) {
        if (req.method === 'GET' || req.method === 'HEAD') {
          return serveStaticFile(req, res, staticDir, pathname);
        }
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Method Not Allowed');
      }

      // Parse body for write operations
      let body = {};
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        try {
          body = await readJsonBody(req);
        } catch (err) {
          return sendError(res, 400, 'INVALID_JSON', 'Некорректный JSON в теле запроса');
        }
      }

      // ─────────────────────────────────────────────────────────
      // AUTH & SYSTEM ENDPOINTS
      // ─────────────────────────────────────────────────────────
      if (pathname === '/api/version' && req.method === 'GET') {
        return sendJson(res, 200, { version: APP_VERSION });
      }

      if (pathname === '/api/auth/status' && req.method === 'GET') {
        const isDefault = db.isDefaultAdminPassword();
        return sendJson(res, 200, {
          hasDefaultAdminPassword: isDefault,
          demoAccessEnabled: isDefault
        });
      }

      if (pathname === '/api/auth/candidate-players' && req.method === 'GET') {
        return sendJson(res, 200, db.getCandidatePlayers());
      }

      if (pathname === '/api/auth/register' && req.method === 'POST') {
        const { username, password, playerId, playerName } = body;
        if (!username || !password) {
          return sendError(res, 400, 'MISSING_FIELDS', 'Логин и пароль обязательны');
        }
        const regRes = db.registerUser({ username, password, playerId, playerName });
        if (regRes.error) {
          return sendError(res, 400, regRes.error, regRes.message || 'Ошибка при регистрации');
        }

        if (regRes.pendingApproval || !regRes.is_approved) {
          try {
            let sectorName = playerName || 'Не привязан';
            let power = '0';
            let vip = '0';
            const targetPlayerId = regRes.playerId || playerId;
            if (targetPlayerId) {
              const p = db.getPlayerById(targetPlayerId);
              if (p) {
                sectorName = p.name || sectorName;
                vip = p.vip !== undefined ? String(p.vip) : '0';
                const rawPower = Number(p.power) || 0;
                if (rawPower >= 1000000) {
                  power = (rawPower / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
                } else if (rawPower >= 1000) {
                  power = (rawPower / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
                } else {
                  power = String(rawPower);
                }
              }
            }

            const baseUrl = getAppBaseUrl(req);
            await dispatchNotification('staff_new_user_pending', {
              username,
              sectorName,
              power,
              vip,
              link: `${baseUrl}/#pending`
            }, {
              replyMarkup: {
                inline_keyboard: [
                  [
                    { text: '🛡️ Одобрить (Р3)', callback_data: `approve_user:${regRes.userId}` },
                    { text: '❌ Отклонить', callback_data: `reject_user:${regRes.userId}` }
                  ]
                ]
              }
            }).catch(err => {
              console.warn('[Notification] Error dispatching staff_new_user_pending:', err.message);
            });
          } catch (notifErr) {
            console.warn('[Notification] Error preparing staff_new_user_pending:', notifErr.message);
          }
        }

        const rawInitData = body && (body.initData || body.init_data);
        if (rawInitData && typeof rawInitData === 'string' && regRes.userId) {
          const botToken = db.getAppSetting('telegram_bot_token');
          if (botToken) {
            const val = logic.validateTelegramWebAppData(rawInitData, botToken);
            if (val && val.valid && val.user?.id) {
              db.bindUserTelegram(regRes.userId, val.user.id, val.user.username || '');
            }
          }
        }

        return sendJson(res, 200, {
          success: true,
          pendingApproval: regRes.pendingApproval,
          userId: regRes.userId,
          is_approved: regRes.is_approved
        });
      }

    if (pathname === '/api/auth/telegram-webapp' && req.method === 'POST') {
      const rawBotToken = db.getAppSetting('telegram_bot_token');
      const botToken = rawBotToken ? String(rawBotToken).trim() : null;
      if (!botToken) {
        return sendError(res, 503, 'BOT_NOT_CONFIGURED', 'Токен Telegram-бота не настроен на сервере');
      }

      const initData = body && (body.initData || body.init_data);
      if (!initData || typeof initData !== 'string') {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Параметр initData обязателен');
      }

      const validation = logic.validateTelegramWebAppData(initData, botToken);
      if (!validation.valid) {
        console.warn('[Telegram WebApp] Validation error:', validation.error);
        return sendError(res, 401, 'INVALID_TELEGRAM_DATA', `Ошибка валидации Telegram WebApp: ${validation.error}`);
      }

      const tgUserId = validation.user?.id;
      if (!tgUserId) {
        return sendError(res, 400, 'MISSING_TELEGRAM_USER', 'Не найден объект пользователя Telegram в initData');
      }

      let user = db.findUserByTelegramChatId(tgUserId);
      if (!user && validation.user?.username) {
        const matched = db.findUserByTelegramUsername(validation.user.username);
        if (matched && (!matched.telegram_chat_id || String(matched.telegram_chat_id) !== String(tgUserId))) {
          db.bindUserTelegram(matched.id, tgUserId, validation.user.username);
          user = (typeof db.getUserById === 'function') ? db.getUserById(matched.id) : matched;
        }
      }
      if (!user && validation.user?.first_name) {
        const matchedFirst = db.findUserByTelegramUsername(validation.user.first_name);
        if (matchedFirst && (!matchedFirst.telegram_chat_id || String(matchedFirst.telegram_chat_id) !== String(tgUserId))) {
          db.bindUserTelegram(matchedFirst.id, tgUserId, validation.user.username || validation.user.first_name);
          user = (typeof db.getUserById === 'function') ? db.getUserById(matchedFirst.id) : matchedFirst;
        }
      }
      if (!user && validation.user?.first_name && validation.user?.last_name) {
        const fullName = `${validation.user.first_name} ${validation.user.last_name}`.trim();
        const matchedFull = db.findUserByTelegramUsername(fullName);
        if (matchedFull && (!matchedFull.telegram_chat_id || String(matchedFull.telegram_chat_id) !== String(tgUserId))) {
          db.bindUserTelegram(matchedFull.id, tgUserId, validation.user.username || fullName);
          user = (typeof db.getUserById === 'function') ? db.getUserById(matchedFull.id) : matchedFull;
        }
      }
      if (!user) {
        console.warn(`[Telegram WebApp] User not bound: tgUserId=${tgUserId}, tgUsername=${validation.user?.username}, firstName=${validation.user?.first_name}`);
        return sendError(res, 404, 'USER_NOT_BOUND', 'Пользователь с данным Telegram ID не найден в KoW Tracker. Привяжите Telegram в личном кабинете.');
      }

      if (user.is_approved === 0) {
        return sendError(res, 403, 'PENDING_APPROVAL', 'Ваш аккаунт ожидает подтверждения офицером');
      }

      if (user.is_active === 0) {
        return sendError(res, 403, 'ACCOUNT_BLOCKED', 'Ваш аккаунт заблокирован администрацией');
      }

      const sessionToken = db.createSession(user.id);
      db.touchUserActive(user.id);

      const cookieHeader = `token=${encodeURIComponent(sessionToken)}; HttpOnly; SameSite=Lax; Path=/`;
      res.setHeader('Set-Cookie', cookieHeader);

      const player = user.player_id ? db.getPlayerById(user.player_id) : (db.getPlayersByUserId(user.id)[0] || null);

      return sendJson(res, 200, {
        success: true,
        token: sessionToken,
        user: {
          id: user.id,
          username: user.username,
          rank: user.rank,
          playerId: user.player_id || (player ? player.id : null),
          permissions: user.permissions || [],
          telegramChatId: user.telegram_chat_id || null,
          telegramUsername: user.telegram_username || null,
          hasDefaultAdminPassword: user.username === 'admin' ? db.isDefaultAdminPassword() : false
        },
        player,
        telegramUser: validation.user
      });
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const { username, password } = body;
      if (!username || !password) {
        return sendError(res, 400, 'MISSING_FIELDS', 'Логин и пароль обязательны');
      }
      const loginRes = db.loginUser(username, password);
      if (loginRes.error === 'ACCOUNT_BLOCKED') {
        return sendError(res, 403, 'ACCOUNT_BLOCKED', 'Доступ к аккаунту заблокирован руководством гильдии');
      }
      if (loginRes.error === 'PENDING_APPROVAL') {
        return sendError(res, 403, 'PENDING_APPROVAL', 'Аккаунт ожидает подтверждения Главой (Р5) или Чиновником (Р4)');
      }
      if (loginRes.error) {
        return sendError(res, 401, loginRes.error, 'Неверный логин или пароль');
      }
      // If Telegram initData is provided, auto-bind Telegram account immediately
      const rawInitData = body && (body.initData || body.init_data);
      if (rawInitData && typeof rawInitData === 'string') {
        const botToken = db.getAppSetting('telegram_bot_token');
        if (botToken) {
          const val = logic.validateTelegramWebAppData(rawInitData, botToken);
          if (val && val.valid && val.user?.id) {
            db.bindUserTelegram(loginRes.user.id, val.user.id, val.user.username || '');
          }
        }
      }

      const updatedUser = (typeof db.getUserById === 'function') ? db.getUserById(loginRes.user.id) : loginRes.user;

      return sendJson(res, 200, {
        token: loginRes.token,
        user: {
          ...(updatedUser || loginRes.user),
          hasDefaultAdminPassword: loginRes.user.username === 'admin' ? db.isDefaultAdminPassword() : false
        }
      });
    }

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      if (req.token) {
        db.deleteSession(req.token);
      }
      return sendJson(res, 200, { success: true });
    }

    if (pathname === '/api/auth/me' && req.method === 'GET') {
      if (!requireAuth(req, res)) return;
      const player = req.user.playerId ? db.getPlayerById(req.user.playerId) : null;
      return sendJson(res, 200, {
        user: {
          ...req.user,
          hasDefaultAdminPassword: req.user.username === 'admin' ? db.isDefaultAdminPassword() : false
        },
        player
      });
    }

    if (pathname === '/api/auth/change-password' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      const { newPassword, oldPassword } = body;
      if (!newPassword) {
        return sendError(res, 400, 'MISSING_PASSWORD', 'Новый пароль обязателен');
      }
      if (oldPassword) {
        const u = db.findUserById(req.user.id);
        if (!u || !db.verifyPassword(oldPassword, u.password_hash)) {
          return sendError(res, 400, 'INVALID_PASSWORD', 'Текущий пароль неверен');
        }
      }
      db.changePassword(req.user.id, newPassword);
      return sendJson(res, 200, { success: true });
    }

    // ─────────────────────────────────────────────────────────
    // USER APPROVALS & USERS (R4, R5)
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/users/pending' && req.method === 'GET') {
      if (!requirePermission(req, res, 'approve_users')) return;
      return sendJson(res, 200, db.getPendingUsers());
    }

    const approveMatch = pathname.match(/^\/api\/users\/(\d+)\/approve$/);
    if (approveMatch && req.method === 'POST') {
      if (!requirePermission(req, res, 'approve_users')) return;
      const targetUserId = Number(approveMatch[1]);
      const guard = authGuard.canApproveUser(req.user, body.rank);
      if (!guard.allowed) {
        return sendJson(res, 403, { error: guard.message || 'Только глава альянса (Р5) может назначать ранг выше Р3' });
      }
      const updatedUser = db.approveUser(targetUserId, guard.rank);
      return sendJson(res, 200, { success: true, user: updatedUser });
    }

    const rejectMatch = pathname.match(/^\/api\/users\/(\d+)\/reject$/);
    if (rejectMatch && req.method === 'POST') {
      if (!requirePermission(req, res, 'approve_users')) return;
      const targetUserId = Number(rejectMatch[1]);
      db.rejectUser(targetUserId);
      return sendJson(res, 200, { success: true });
    }

    if (pathname === '/api/users' && req.method === 'GET') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      return sendJson(res, 200, db.getUsers());
    }

    const userPatchMatch = pathname.match(/^\/api\/users\/(\d+)$/);
    if (userPatchMatch && req.method === 'PATCH') {
      if (!requireRole(['r5'])(req, res)) return;
      const targetUserId = Number(userPatchMatch[1]);
      if (body.password) {
        db.changePassword(targetUserId, body.password);
      }
      const updated = db.updateUser(targetUserId, body);
      if (body.rank && updated && updated.player_id) {
        db.updatePlayer(updated.player_id, { rank: body.rank });
      }
      return sendJson(res, 200, { success: true, user: updated });
    }

    const userBlockMatch = pathname.match(/^\/api\/users\/(\d+)\/block$/);
    if (userBlockMatch && req.method === 'POST') {
      if (!requireRole(['r5'])(req, res)) return;
      const targetUserId = Number(userBlockMatch[1]);
      const guard = authGuard.canBlockUser(req.user, targetUserId);
      if (!guard.allowed) {
        return sendError(res, 400, guard.error, guard.message);
      }
      const targetUser = db.findUserById(targetUserId);
      if (!targetUser) {
        return sendError(res, 404, 'USER_NOT_FOUND', 'Пользователь не найден');
      }
      const isBlocked = body && body.blocked !== undefined ? Boolean(body.blocked) : true;
      const updated = db.blockUser(targetUserId, isBlocked);
      return sendJson(res, 200, { success: true, user: updated });
    }

    const userDeleteMatch = pathname.match(/^\/api\/users\/(\d+)$/);
    if (userDeleteMatch && req.method === 'DELETE') {
      if (!requireRole(['r5'])(req, res)) return;
      const targetUserId = Number(userDeleteMatch[1]);
      const targetUser = db.findUserById(targetUserId);
      const guard = authGuard.canDeleteUser(req.user, targetUser);
      if (!guard.allowed) {
        const statusCode = guard.error === 'USER_NOT_FOUND' ? 404 : 400;
        return sendError(res, statusCode, guard.error, guard.message);
      }
      const deleteSectors = Boolean(body && body.deleteSectors);
      const result = db.deleteUser(targetUserId, { deleteSectors });
      return sendJson(res, 200, result);
    }

    // ─────────────────────────────────────────────────────────
    // PLAYER CABINET & SECTORS (/api/my-profile, /api/my-sectors)
    // ─────────────────────────────────────────────────────────
    function resolveUserPlayerId(req) {
      if (req.user && req.user.playerId) return req.user.playerId;
      if (!req.user || !req.user.id) return null;
      const sectors = db.getPlayersByUserId(req.user.id);
      if (sectors && sectors.length > 0) {
        req.user.playerId = sectors[0].id;
        db.setUserActiveSector(req.user.id, sectors[0].id);
        return req.user.playerId;
      }
      return null;
    }

    if (pathname === '/api/my-profile' && req.method === 'GET') {
      if (!requireAuth(req, res)) return;
      let sectors = db.getPlayersByUserId(req.user.id);
      let activeSector = null;
      const requestedSectorId = parsedUrl.searchParams.get('sectorId')
        ? Number(parsedUrl.searchParams.get('sectorId'))
        : null;

      if (requestedSectorId && sectors.some(s => s.id === requestedSectorId)) {
        activeSector = sectors.find(s => s.id === requestedSectorId);
      } else if (req.user.playerId && sectors.some(s => s.id === req.user.playerId)) {
        activeSector = sectors.find(s => s.id === req.user.playerId);
      } else if (sectors.length > 0) {
        activeSector = sectors[0];
      }

      if (activeSector && req.user.playerId !== activeSector.id) {
        req.user.playerId = activeSector.id;
        db.setUserActiveSector(req.user.id, activeSector.id);
      }

      return sendJson(res, 200, {
        ...(activeSector ? activeSector : {}),
        user: {
          id: req.user.id,
          username: req.user.username,
          rank: req.user.rank,
          permissions: Array.isArray(req.user.permissions) ? req.user.permissions : [],
          telegram_chat_id: req.user.telegram_chat_id,
          telegram_username: req.user.telegram_username,
          telegram_notifications_enabled: req.user.telegram_notifications_enabled !== 0,
          telegramChatId: req.user.telegram_chat_id,
          telegramUsername: req.user.telegram_username,
          telegramNotificationsEnabled: req.user.telegram_notifications_enabled !== 0,
          timezone: req.user.timezone || 'Europe/Moscow',
          timezoneOffset: (req.user.timezoneOffset !== undefined && req.user.timezoneOffset !== null) ? Number(req.user.timezoneOffset) : 3
        },
        sectors,
        activeSectorId: activeSector ? activeSector.id : null,
        sector: activeSector ? activeSector.sector : null,
        stock: activeSector ? activeSector.stock : null,
        officers: activeSector ? (activeSector.officers || []) : []
      });
    }

    if (pathname === '/api/my-profile/timezone' && req.method === 'PUT') {
      if (!requireAuth(req, res)) return;
      const timezone = body.timezone ? String(body.timezone).trim() : 'Europe/Moscow';
      const timezoneOffset = body.timezoneOffset !== undefined && body.timezoneOffset !== null
        ? Number(body.timezoneOffset)
        : (body.timezone_offset !== undefined && body.timezone_offset !== null ? Number(body.timezone_offset) : 3);

      if (isNaN(timezoneOffset) || timezoneOffset < -12 || timezoneOffset > 14) {
        return sendError(res, 400, 'INVALID_TIMEZONE_OFFSET', 'Смещение часового пояса должно быть от -12 до +14');
      }

      db.updateUserTimezone(req.user.id, { timezone, timezoneOffset });
      req.user.timezone = timezone;
      req.user.timezoneOffset = timezoneOffset;
      return sendJson(res, 200, {
        success: true,
        timezone,
        timezoneOffset
      });
    }

    if (pathname === '/api/my-profile/active-sector' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      const sectorId = Number(body.sectorId);
      if (!sectorId) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Укажите ID сектора');
      }
      const result = db.setUserActiveSector(req.user.id, sectorId);
      if (!result.ok) {
        return sendError(res, 403, 'FORBIDDEN', 'Вы не являетесь владельцем этого сектора');
      }
      req.user.playerId = sectorId;
      return sendJson(res, 200, { success: true, activeSectorId: sectorId });
    }

    if (pathname === '/api/my-sectors' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      if (!body.name || !body.name.trim()) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Укажите название сектора');
      }
      if (body.sector && body.sector.vipPoints !== undefined) {
        body.sector.vipPoints = sanitizeVipPoints(body.sector.vipPoints);
      }
      if (body.vipPoints !== undefined) {
        body.vipPoints = sanitizeVipPoints(body.vipPoints);
      }
      if (body.stock) {
        sanitizeStock(body.stock);
      }
      const created = db.createPlayer({
        ...body,
        name: body.name.trim(),
        userId: req.user.id,
        rank: req.user.rank === 'r4' || req.user.rank === 'r5' ? (body.rank || 'r3') : 'r3'
      });

      const currentUser = db.findUserById(req.user.id);
      if (!currentUser || !currentUser.player_id) {
        db.setUserActiveSector(req.user.id, created.id);
        req.user.playerId = created.id;
      }
      return sendJson(res, 201, created);
    }

    if (pathname === '/api/my-profile' && req.method === 'PUT') {
      if (!requireAuth(req, res)) return;
      const activePlayerId = resolveUserPlayerId(req);
      if (!activePlayerId) {
        return sendError(res, 404, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан профиль игрока');
      }
      delete body.rank;
      delete body.id;

      if (body.sector && body.sector.vipPoints !== undefined) {
        body.sector.vipPoints = sanitizeVipPoints(body.sector.vipPoints);
      }
      if (body.vipPoints !== undefined) {
        body.vipPoints = sanitizeVipPoints(body.vipPoints);
      }
      if (body.stock) {
        sanitizeStock(body.stock);
      }

      if (body.telegramNotificationsEnabled !== undefined || body.telegram_notifications_enabled !== undefined) {
        const en = (body.telegramNotificationsEnabled ?? body.telegram_notifications_enabled) !== false;
        db.toggleTelegramNotifications(req.user.id, en);
      }

      if (Array.isArray(body.officers)) {
        for (const o of body.officers) {
          if (o.skills !== undefined) {
            o.skills = sanitizeSkills(o.skills);
          }
          if (o.invested !== undefined) {
            o.invested = sanitizeInvested(o.invested);
          }
          if (o.personalPuzzles !== undefined || o.personal_puzzles !== undefined) {
            o.personalPuzzles = sanitizePersonalPuzzles(o.personalPuzzles ?? o.personal_puzzles);
          }
          if (o.onlyPersonalPuzzles !== undefined || o.only_personal_puzzles !== undefined) {
            o.onlyPersonalPuzzles = Boolean(o.onlyPersonalPuzzles ?? o.only_personal_puzzles);
          }
          if (o.id) {
            const updatedOff = db.updatePlayerOfficer(activePlayerId, o.id, o);
            if (!updatedOff) {
              db.addPlayerOfficer(activePlayerId, o);
            }
          } else {
            db.addPlayerOfficer(activePlayerId, o);
          }
        }
      }

      const updated = db.updatePlayer(activePlayerId, { ...body, editorUserId: req.user.id });
      if (body.stock) {
        db.recordStockHistory(activePlayerId, body.stock);
      }
      return sendJson(res, 200, updated);
    }

    if (pathname === '/api/my-profile/confirm-stock' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      const activePlayerId = resolveUserPlayerId(req);
      if (!activePlayerId) {
        return sendError(res, 404, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан сектор');
      }
      const updated = db.confirmPlayerStock(activePlayerId, req.user.id);
      if (!updated) {
        return sendError(res, 404, 'PLAYER_NOT_FOUND', 'Сектор не найден');
      }
      return sendJson(res, 200, {
        success: true,
        player: updated,
        stockUpdatedAt: updated.stockUpdatedAt,
        stockUpdateSource: updated.stockUpdateSource
      });
    }

    if (pathname === '/api/my-profile/officers' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      const activePlayerId = resolveUserPlayerId(req);
      if (!activePlayerId) {
        return sendError(res, 404, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан профиль игрока');
      }
      const isRetro = body.isRetro !== undefined ? Boolean(body.isRetro) : (body.isRetrospective !== undefined ? Boolean(body.isRetrospective) : false);
      const deductStock = Boolean(body.deductStock || body.deduct_stock);
      const result = officerProgression.addOfficer(activePlayerId, body, {
        isRetro,
        deductStock,
        userId: req.user?.id
      });
      if (!result.ok) {
        return sendError(res, result.status || 400, result.error, result.message);
      }
      return sendJson(res, 200, {
        ...result.officer,
        newStock: result.newStock,
        stockDeducted: result.stockDeducted
      });
    }

    const myOfficerMatch = pathname.match(/^\/api\/my-profile\/officers\/([^/]+)$/);
    if (myOfficerMatch && req.method === 'PUT') {
      if (!requireAuth(req, res)) return;
      const activePlayerId = resolveUserPlayerId(req);
      if (!activePlayerId) {
        return sendError(res, 404, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан профиль игрока');
      }
      const officerId = myOfficerMatch[1];
      const isRetro = body.isRetro !== undefined ? Boolean(body.isRetro) : (body.isRetrospective !== undefined ? Boolean(body.isRetrospective) : false);
      const deductStock = Boolean(body.deductStock || body.deduct_stock);
      const result = officerProgression.updateOfficer(activePlayerId, officerId, body, {
        isRetro,
        deductStock,
        userId: req.user?.id
      });
      if (!result.ok) {
        return sendError(res, result.status || 400, result.error, result.message);
      }
      return sendJson(res, 200, {
        ...result.officer,
        newStock: result.newStock,
        stockDeducted: result.stockDeducted
      });
    }

    if (myOfficerMatch && req.method === 'DELETE') {
      if (!requireAuth(req, res)) return;
      const activePlayerId = resolveUserPlayerId(req);
      if (!activePlayerId) {
        return sendError(res, 404, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан профиль игрока');
      }
      const officerId = myOfficerMatch[1];
      officerProgression.deleteOfficer(activePlayerId, officerId);
      return sendJson(res, 200, { success: true });
    }

    // ─────────────────────────────────────────────────────────
    // PLAYERS MANAGEMENT (R4, R5)
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/players' && req.method === 'GET') {
      if (!requireAuth(req, res)) return;
      const canViewPlayers = logic.hasUserPermission(req.user, 'view_sectors') || logic.hasUserPermission(req.user, 'view_matrix');
      if (!canViewPlayers) {
        return sendError(res, 403, 'FORBIDDEN', 'Требуется разрешение на просмотр секторов или матрицы');
      }
      const players = db.getPlayers().map(p => maskPlayerStockIfNeeded(p, req.user));
      return sendJson(res, 200, players);
    }

    if (pathname === '/api/players' && req.method === 'POST') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      if (body.sector && body.sector.vipPoints !== undefined) {
        body.sector.vipPoints = sanitizeVipPoints(body.sector.vipPoints);
      }
      if (body.vipPoints !== undefined) {
        body.vipPoints = sanitizeVipPoints(body.vipPoints);
      }
      if (body.stock) {
        sanitizeStock(body.stock);
      }
      if (Array.isArray(body.officers)) {
        for (const o of body.officers) {
          if (o.skills !== undefined) {
            o.skills = sanitizeSkills(o.skills);
          }
          if (o.invested !== undefined) {
            o.invested = sanitizeInvested(o.invested);
          }
          if (o.personalPuzzles !== undefined || o.personal_puzzles !== undefined) {
            o.personalPuzzles = sanitizePersonalPuzzles(o.personalPuzzles ?? o.personal_puzzles);
          }
          if (o.onlyPersonalPuzzles !== undefined || o.only_personal_puzzles !== undefined) {
            o.onlyPersonalPuzzles = Boolean(o.onlyPersonalPuzzles ?? o.only_personal_puzzles);
          }
        }
      }
      const created = db.createPlayer(body);
      return sendJson(res, 200, created);
    }

    function checkSectorAccess(targetPlayerId, isRead = false) {
      return authGuard.checkSectorAccess(req.user, targetPlayerId, isRead);
    }

    const playerMatch = pathname.match(/^\/api\/players\/(\d+)$/);
    if (playerMatch && req.method === 'GET') {
      const targetPlayerId = Number(playerMatch[1]);
      const check = checkSectorAccess(targetPlayerId, true);
      if (!check.ok) return sendError(res, check.status, check.error, check.message);
      return sendJson(res, 200, check.player);
    }

    if (playerMatch && req.method === 'PUT') {
      const targetPlayerId = Number(playerMatch[1]);
      const check = checkSectorAccess(targetPlayerId);
      if (!check.ok) return sendError(res, check.status, check.error, check.message);

      if (!check.isLeader) {
        delete body.rank;
        delete body.id;
        delete body.userId;
        delete body.user_id;
      }
      if (body.sector && body.sector.vipPoints !== undefined) {
        body.sector.vipPoints = sanitizeVipPoints(body.sector.vipPoints);
      }
      if (body.vipPoints !== undefined) {
        body.vipPoints = sanitizeVipPoints(body.vipPoints);
      }
      if (body.stock) {
        sanitizeStock(body.stock);
      }
      if (Array.isArray(body.officers)) {
        const existingPlayer = check.player;
        if (existingPlayer && Array.isArray(existingPlayer.officers)) {
          const keepIds = new Set(body.officers.map(o => o && o.id).filter(Boolean));
          for (const oldOff of existingPlayer.officers) {
            if (!keepIds.has(oldOff.id)) {
              db.deletePlayerOfficer(targetPlayerId, oldOff.id);
            }
          }
        }
        for (const o of body.officers) {
          if (o.skills !== undefined) {
            o.skills = sanitizeSkills(o.skills);
          }
          if (o.invested !== undefined) {
            o.invested = sanitizeInvested(o.invested);
          }
          if (o.personalPuzzles !== undefined || o.personal_puzzles !== undefined) {
            o.personalPuzzles = sanitizePersonalPuzzles(o.personalPuzzles ?? o.personal_puzzles);
          }
          if (o.onlyPersonalPuzzles !== undefined || o.only_personal_puzzles !== undefined) {
            o.onlyPersonalPuzzles = Boolean(o.onlyPersonalPuzzles ?? o.only_personal_puzzles);
          }
          if (o.id) {
            const updatedOff = db.updatePlayerOfficer(targetPlayerId, o.id, o);
            if (!updatedOff) {
              db.addPlayerOfficer(targetPlayerId, o);
            }
          } else {
            db.addPlayerOfficer(targetPlayerId, o);
          }
        }
      }
      const updated = db.updatePlayer(targetPlayerId, { ...body, editorUserId: req.user.id });
      if (body.stock) {
        db.recordStockHistory(targetPlayerId, body.stock);
      }
      return sendJson(res, 200, updated);
    }

    if (playerMatch && req.method === 'DELETE') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      db.deletePlayer(Number(playerMatch[1]));
      return sendJson(res, 200, { success: true });
    }

    const stockHistoryMatch = pathname.match(/^\/api\/players\/(\d+)\/stock-history$/);
    if (stockHistoryMatch && req.method === 'GET') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      const targetPlayerId = Number(stockHistoryMatch[1]);
      const player = db.getPlayerById(targetPlayerId);
      if (!player) {
        return sendError(res, 404, 'PLAYER_NOT_FOUND', 'Сектор не найден');
      }

      const isStaff = req.user.rank === 'r4' || req.user.rank === 'r5';
      const isOwner = player.userId === req.user.id || req.user.player_id === targetPlayerId;
      const hasPerm = logic.hasUserPermission(req.user, 'view_sectors') || logic.hasUserPermission(req.user, 'view_stocks');

      if (!isStaff && !isOwner && !hasPerm) {
        return sendError(res, 403, 'FORBIDDEN', 'Недостаточно прав для просмотра истории склада этого сектора');
      }

      const records = db.getStockHistory(targetPlayerId, 50);
      return sendJson(res, 200, { records });
    }

    if (stockHistoryMatch && req.method === 'POST') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      const targetPlayerId = Number(stockHistoryMatch[1]);
      const check = checkSectorAccess(targetPlayerId);
      if (!check.ok) return sendError(res, check.status, check.error, check.message);

      const { source = 'manual_edit', snapshotBefore, snapshotAfter, screenshotBase64 } = body;
      const validSource = source === 'ocr_scan' ? 'ocr_scan' : 'manual_edit';

      const before = snapshotBefore ? logic.normalizeStock(snapshotBefore) : check.player.stock;
      const after = snapshotAfter ? logic.normalizeStock(snapshotAfter) : before;

      const diff = logic.calculateStockDiff(before, after);

      let screenshotPath = null;
      if (screenshotBase64 && typeof screenshotBase64 === 'string' && screenshotBase64.trim()) {
        const yyyyMm = new Date().toISOString().slice(0, 7);
        const screenshotsDir = path.join(__dirname, '..', 'data', 'screenshots', yyyyMm);
        if (!fs.existsSync(screenshotsDir)) {
          fs.mkdirSync(screenshotsDir, { recursive: true });
        }

        let ext = '.jpg';
        let b64 = screenshotBase64;
        const match = screenshotBase64.match(/^data:(image\/(jpeg|jpg|webp|png));base64,(.+)$/);
        if (match) {
          const mime = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
          ext = mime === 'image/webp' ? '.webp' : (mime === 'image/png' ? '.png' : '.jpg');
          b64 = match[3];
        }

        const buf = Buffer.from(b64, 'base64');
        const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
        const filename = `${targetPlayerId}_${Date.now()}_${hash}${ext}`;
        const fullPath = path.join(screenshotsDir, filename);
        fs.writeFileSync(fullPath, buf);
        screenshotPath = `${yyyyMm}/${filename}`;
      }

      const now = new Date().toISOString();
      const record = db.recordStockHistory({
        playerId: targetPlayerId,
        userId: req.user.id,
        source: validSource,
        snapshotBefore: before,
        snapshotAfter: after,
        diffSummary: diff.summary,
        screenshotPath,
        createdAt: now
      });

      if (snapshotAfter) {
        db.updatePlayer(targetPlayerId, {
          stock: after,
          stockUpdatedAt: now,
          stockUpdateSource: validSource,
          recordHistory: false
        });
      }

      return sendJson(res, 201, record);
    }

    const playerOfficersMatch = pathname.match(/^\/api\/players\/(\d+)\/officers$/);
    if (playerOfficersMatch && req.method === 'POST') {
      const targetPlayerId = Number(playerOfficersMatch[1]);
      const check = checkSectorAccess(targetPlayerId);
      if (!check.ok) return sendError(res, check.status, check.error, check.message);

      const isRetro = body.isRetro !== undefined ? Boolean(body.isRetro) : (body.isRetrospective !== undefined ? Boolean(body.isRetrospective) : false);
      const deductStock = Boolean(body.deductStock || body.deduct_stock);
      const result = officerProgression.addOfficer(targetPlayerId, body, {
        isRetro,
        deductStock,
        userId: req.user?.id
      });
      if (!result.ok) {
        return sendError(res, result.status || 400, result.error, result.message);
      }
      return sendJson(res, 201, {
        ...result.officer,
        newStock: result.newStock,
        stockDeducted: result.stockDeducted
      });
    }

    const playerOfficerDetailMatch = pathname.match(/^\/api\/players\/(\d+)\/officers\/([^/]+)$/);
    if (playerOfficerDetailMatch && req.method === 'PUT') {
      const targetPlayerId = Number(playerOfficerDetailMatch[1]);
      const offId = playerOfficerDetailMatch[2];
      const check = checkSectorAccess(targetPlayerId);
      if (!check.ok) return sendError(res, check.status, check.error, check.message);

      const isRetro = body.isRetro !== undefined ? Boolean(body.isRetro) : (body.isRetrospective !== undefined ? Boolean(body.isRetrospective) : false);
      const deductStock = Boolean(body.deductStock || body.deduct_stock);
      const result = officerProgression.updateOfficer(targetPlayerId, offId, body, {
        isRetro,
        deductStock,
        userId: req.user?.id
      });
      if (!result.ok) {
        return sendError(res, result.status || 400, result.error, result.message);
      }
      return sendJson(res, 200, {
        ...result.officer,
        newStock: result.newStock,
        stockDeducted: result.stockDeducted
      });
    }

    if (playerOfficerDetailMatch && req.method === 'DELETE') {
      const targetPlayerId = Number(playerOfficerDetailMatch[1]);
      const offId = playerOfficerDetailMatch[2];
      const check = checkSectorAccess(targetPlayerId);
      if (!check.ok) return sendError(res, check.status, check.error, check.message);

      officerProgression.deleteOfficer(targetPlayerId, offId);
      return sendJson(res, 200, { success: true });
    }

    // ─────────────────────────────────────────────────────────
    // VIP TIERS
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/vip-tiers' && req.method === 'GET') {
      if (!authenticate(req, res)) return;
      return sendJson(res, 200, db.getVipTiers());
    }

    if (pathname === '/api/vip-tiers' && req.method === 'PUT') {
      if (!requirePermission(req, res, 'manage_catalog')) return;
      const tiersInput = Array.isArray(body) ? body : (Array.isArray(body?.tiers) ? body.tiers : null);
      if (!tiersInput) {
        return sendError(res, 400, 'INVALID_PAYLOAD', 'Ожидается массив уровней VIP');
      }
      const updated = db.setVipTiers(tiersInput);
      return sendJson(res, 200, updated);
    }

    // ─────────────────────────────────────────────────────────
    // CATALOG
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/catalog' && req.method === 'GET') {
      return sendJson(res, 200, db.getCatalog());
    }

    if (pathname === '/api/catalog' && req.method === 'POST') {
      if (!requirePermission(req, res, 'manage_catalog')) return;
      const upgradeType = body.upgradeType === 'special' ? 'special' : 'standard';
      const medalsBeforeTraining = Math.max(0, parseInt(body.medalsBeforeTraining ?? body.medals_before_training) || 480);
      const medalsTraining = Math.max(0, parseInt(body.medalsTraining ?? body.medals_training) || 900);
      const medalsTotal = Math.max(0, parseInt(body.medalsTotal ?? body.medals_total) || (medalsBeforeTraining + medalsTraining));
      const starCouponCost = Math.max(0, parseInt(body.starCouponCost ?? body.star_coupon_cost) || 360);
      const couponPerPuzzle = Math.max(0, parseInt(body.couponPerPuzzle ?? body.coupon_per_puzzle) || 720);
      const generation = Math.max(1, parseInt(body.generation) || 8);
      const type = ['Танк', 'Пехота', 'ПТ-Сау', 'Горнизон', 'Осада'].includes(body.type) ? body.type : (body.type || 'Пехота');

      const saved = db.saveCatalogItem({
        ...body,
        id: body.id || ('off_' + Date.now()),
        name: String(body.name || '').trim(),
        type,
        generation,
        couponPerPuzzle,
        starCouponCost,
        medalsBeforeTraining,
        medalsTraining,
        medalsTotal,
        upgradeType
      });
      return sendJson(res, 200, saved);
    }

    if (pathname === '/api/catalog/batch' && req.method === 'POST') {
      if (!requirePermission(req, res, 'manage_catalog')) return;
      const officers = Array.isArray(body) ? body : (Array.isArray(body?.officers) ? body.officers : null);
      if (!officers) {
        return sendError(res, 400, 'INVALID_PAYLOAD', 'Ожидается массив офицеров');
      }
      const savedList = [];
      for (const off of officers) {
        if (!off || !off.name) continue;
        const upgradeType = off.upgradeType === 'special' ? 'special' : 'standard';
        const medalsBeforeTraining = Math.max(0, parseInt(off.medalsBeforeTraining ?? off.medals_before_training) || 480);
        const medalsTraining = Math.max(0, parseInt(off.medalsTraining ?? off.medals_training) || 900);
        const medalsTotal = Math.max(0, parseInt(off.medalsTotal ?? off.medals_total) || (medalsBeforeTraining + medalsTraining));
        const starCouponCost = Math.max(0, parseInt(off.starCouponCost ?? off.star_coupon_cost) || 360);
        const couponPerPuzzle = Math.max(0, parseInt(off.couponPerPuzzle ?? off.coupon_per_puzzle) || 720);
        const generation = Math.max(1, parseInt(off.generation) || 8);
        const type = ['Танк', 'Пехота', 'ПТ-Сау', 'Горнизон', 'Осада'].includes(off.type) ? off.type : (off.type || 'Пехота');

        const saved = db.saveCatalogItem({
          ...off,
          id: off.id || ('off_' + Math.random().toString(36).slice(2, 9)),
          name: String(off.name).trim(),
          type,
          generation,
          couponPerPuzzle,
          starCouponCost,
          medalsBeforeTraining,
          medalsTraining,
          medalsTotal,
          upgradeType
        });
        savedList.push(saved);
      }
      return sendJson(res, 200, { success: true, count: savedList.length, officers: savedList });
    }

    const catMatch = pathname.match(/^\/api\/catalog\/([^/]+)$/);
    if (catMatch && req.method === 'PUT') {
      if (!requirePermission(req, res, 'manage_catalog')) return;
      const upgradeType = body.upgradeType === 'special' ? 'special' : (body.upgradeType || 'standard');
      const medalsBeforeTraining = Math.max(0, parseInt(body.medalsBeforeTraining ?? body.medals_before_training) || 480);
      const medalsTraining = Math.max(0, parseInt(body.medalsTraining ?? body.medals_training) || 900);
      const medalsTotal = Math.max(0, parseInt(body.medalsTotal ?? body.medals_total) || (medalsBeforeTraining + medalsTraining));
      const starCouponCost = Math.max(0, parseInt(body.starCouponCost ?? body.star_coupon_cost) || 360);
      const couponPerPuzzle = Math.max(0, parseInt(body.couponPerPuzzle ?? body.coupon_per_puzzle) || 720);
      const generation = Math.max(1, parseInt(body.generation) || 8);
      const type = ['Танк', 'Пехота', 'ПТ-Сау', 'Горнизон', 'Осада'].includes(body.type) ? body.type : (body.type || 'Пехота');

      const saved = db.saveCatalogItem({
        ...body,
        id: catMatch[1],
        type,
        generation,
        couponPerPuzzle,
        starCouponCost,
        medalsBeforeTraining,
        medalsTraining,
        medalsTotal,
        upgradeType
      });
      return sendJson(res, 200, saved);
    }

    if (catMatch && req.method === 'DELETE') {
      if (!requirePermission(req, res, 'manage_catalog')) return;
      const id = catMatch[1];
      if (!logic.canDeleteOfficer(id, db.getPlayers()).ok) {
        return sendError(res, 400, 'OFFICER_IN_USE', 'Офицер используется игроками');
      }
      db.deleteCatalogItem(id);
      return sendJson(res, 200, { success: true });
    }

    // ─────────────────────────────────────────────────────────
    // EVENT TYPES
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/event-types' && req.method === 'GET') {
      return sendJson(res, 200, db.getEventTypes());
    }

    if (pathname === '/api/event-types/bulk-rewards' && req.method === 'POST') {
      if (!requirePermission(req, res, 'manage_catalog')) return;
      const typeIds = Array.isArray(body?.typeIds) ? body.typeIds.map(Number).filter(n => !isNaN(n) && n > 0) : [];
      if (!typeIds.length) {
        return sendError(res, 400, 'INVALID_PAYLOAD', 'Ожидается непустой массив ID типов событий (typeIds)');
      }
      if (!Array.isArray(body?.places)) {
        return sendError(res, 400, 'INVALID_PAYLOAD', 'Ожидается массив наград (places)');
      }
      const places = sanitizeEventTypePlaces(body.places);
      const updatedCount = db.updateBulkEventTypeRewards(typeIds, places);
      return sendJson(res, 200, { ok: true, success: true, updatedCount, places });
    }

    if (pathname === '/api/event-types' && req.method === 'POST') {
      if (!requirePermission(req, res, 'manage_catalog')) return;
      const sanitized = sanitizeEventType(body);
      const saved = db.saveEventType(sanitized);
      return sendJson(res, 200, saved);
    }

    const etMatch = pathname.match(/^\/api\/event-types\/(\d+)$/);
    if (etMatch && req.method === 'PUT') {
      if (!requirePermission(req, res, 'manage_catalog')) return;
      const sanitized = sanitizeEventType({ ...body, id: Number(etMatch[1]) });
      const saved = db.saveEventType(sanitized);
      return sendJson(res, 200, saved);
    }

    if (etMatch && req.method === 'DELETE') {
      if (!requirePermission(req, res, 'manage_catalog')) return;
      db.deleteEventType(Number(etMatch[1]));
      return sendJson(res, 200, { success: true });
    }

    // ─────────────────────────────────────────────────────────
    // EVENTS & REGISTRATIONS & AUTOPICK
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/events' && req.method === 'GET') {
      const events = db.getEvents();
      const eventTypes = db.getEventTypes();
      const etMap = new Map(eventTypes.map(t => [t.id, t]));
      const canManageEvents = Boolean(req.user && logic.hasUserPermission(req.user, 'manage_events'));
      const userSectors = req.user ? db.getPlayersByUserId(req.user.id) : [];
      const userSectorIds = new Set(userSectors.map(s => s.id));
      const activeSectorId = req.user?.playerId;

      const enriched = events.map(ev => {
        const item = { ...ev };
        const et = etMap.get(ev.typeId);
        item.title = et ? et.name : (ev.title || `Событие #${ev.id}`);
        item.name = item.title;
        item.eventType = et || null;
        item.places = et ? (typeof logic.resolveEventPlaces === 'function' ? logic.resolveEventPlaces(et, ev.dateFrom) : et.places) : [];
        item.startDate = ev.dateFrom;
        item.endDate = ev.dateTo;
        item.dateStart = ev.dateFrom;
        item.dateEnd = ev.dateTo;

        const eventRegs = (canManageEvents || userSectors.length > 0) ? db.getRegistrationsByEventId(ev.id) : [];
        if (canManageEvents) {
          item.registrations = eventRegs;
        }
        if (req.user) {
          item.myRegistrations = eventRegs.filter(r => userSectorIds.has(r.playerId));
          item.myRegistration = item.myRegistrations.find(r => r.playerId === activeSectorId) || item.myRegistrations[0] || null;
        }
        return item;
      });

      return sendJson(res, 200, enriched);
    }

    if (pathname === '/api/events' && req.method === 'POST') {
      if (!requirePermission(req, res, 'manage_events')) return;
      const isNew = !body.id;

      // Idempotent deduplication for rapid double-clicks on event creation
      const dedupeKey = isNew
        ? `${Number(body.typeId)}_${String(body.dateFrom)}_${String(body.dateTo)}_${Number(req.user?.id || 0)}`
        : null;

      if (isNew && dedupeKey) {
        const existing = getRecentCreatedEvent(dedupeKey, 5000);
        if (existing && existing.saved) {
          console.log(`[Events] Deduplicated duplicate creation request for key: ${dedupeKey} (event #${existing.saved.id})`);
          return sendJson(res, 200, existing.saved);
        }
      }

      const previousEvent = body.id ? db.getEventById(Number(body.id)) : null;
      const previousAssignments = previousEvent ? (previousEvent.assignments || []) : [];

      const saved = db.saveEvent(body);

      if (isNew && saved && saved.id) {
        if (dedupeKey) {
          recordRecentCreatedEvent(dedupeKey, saved);
        }
        try {
          const eventTypes = db.getEventTypes();
          const et = eventTypes.find(t => t.id === saved.typeId);
          const effectivePlaces = et ? (typeof logic.resolveEventPlaces === 'function' ? logic.resolveEventPlaces(et, saved.dateFrom) : et.places) : [];
          const totalPlaces = effectivePlaces ? effectivePlaces.length : (et?.places?.length || 0);
          const baseUrl = getAppBaseUrl(req);

          await dispatchNotification('event_registration_opened', {
            eventName: et?.name || 'Событие',
            eventDate: saved.dateFrom || '',
            totalPlaces: String(totalPlaces),
            link: `${baseUrl}/#event/${saved.id}`
          }, { broadcast: true }).catch(err => {
            console.warn('[Notification] Error broadcasting event_registration_opened:', err.message);
          });
        } catch (notifErr) {
          console.warn('[Notification] Error preparing event_registration_opened:', notifErr.message);
        }
      }

      // Notifications on saveEvent: personal alerts for assigned places & staff summary
      try {
        const savedAssignments = (saved && saved.assignments) ? saved.assignments : [];
        const assignedList = savedAssignments.filter(a => a.playerId && Number(a.place) > 0);

        if (assignedList.length > 0) {
          const eventTypes = db.getEventTypes();
          const et = eventTypes.find(t => t.id === saved.typeId);
          const places = et ? (typeof logic.resolveEventPlaces === 'function' ? logic.resolveEventPlaces(et, saved.dateFrom) : et.places) : [];
          const baseUrl = getAppBaseUrl(req);
          const players = db.getPlayers();

          let newAssignmentsCount = 0;
          for (const a of assignedList) {
            const prevA = previousAssignments.find(pa => pa.playerId === a.playerId && Number(pa.place) === Number(a.place));
            if (prevA) continue; // Already assigned to this place earlier
            newAssignmentsCount++;

            const player = db.getPlayerById(a.playerId);
            if (player && player.userId) {
              const user = db.findUserById(player.userId);
              if (user) {
                const coupons = a.coupons !== undefined ? a.coupons : (places.find(p => Number(p.place) === Number(a.place))?.coupons || 0);
                const rsvpMarkup = {
                  inline_keyboard: [
                    [
                      { text: '✅ Подтверждаю участие', callback_data: `rsvp_event:confirm:${saved.id}:${a.place}` },
                      { text: '❌ Не смогу участвовать', callback_data: `rsvp_event:decline:${saved.id}:${a.place}` }
                    ]
                  ]
                };
                await dispatchNotification('event_place_assigned', {
                  username: user.username,
                  sectorName: player.name || a.playerName || 'Сектор',
                  eventName: et?.name || 'Событие',
                  eventDate: saved.dateFrom || '',
                  place: String(a.place),
                  coupons: String(coupons),
                  link: `${baseUrl}/#event/${saved.id}`
                }, { userId: user.id, replyMarkup: rsvpMarkup }).catch(err => {
                  console.warn(`[Notification] Error sending event_place_assigned to user ${user.id}:`, err.message);
                });
              }
            }
          }

          if (newAssignmentsCount > 0 || isNew) {
            const topFormatted = assignedList
              .sort((x, y) => Number(x.place) - Number(y.place))
              .slice(0, 5)
              .map((a, idx) => {
                const p = players.find(pl => pl.id === a.playerId);
                const vipStr = (p && p.vip !== undefined) ? ` (VIP ${p.vip})` : '';
                const safeName = String(a.playerName || p?.name || 'Сектор')
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;');
                return `${idx + 1}. #${a.place}: ${safeName}${vipStr}`;
              })
              .join('\n');

            await dispatchNotification('staff_event_autopick_summary', {
              eventName: et?.name || 'Событие',
              assignedCount: String(assignedList.length),
              availablePlaces: String(places.length),
              topAssignmentsList: topFormatted || 'Назначений нет',
              link: `${baseUrl}/#event/${saved.id}`
            }).catch(err => {
              console.warn('[Notification] Error sending staff_event_autopick_summary:', err.message);
            });
          }
        }
      } catch (assignNotifErr) {
        console.warn('[Notification] Error in assignment notifications on saveEvent:', assignNotifErr.message);
      }

      return sendJson(res, 200, saved);
    }

    if (pathname === '/api/events/schedule-season' && req.method === 'POST') {
      if (!requirePermission(req, res, 'manage_events')) return;
      const result = seasonPlanner.scheduleSeason(body);
      return sendJson(res, 201, result);
    }

    const eventRegMatch = pathname.match(/^\/api\/events\/(\d+)\/register$/);
    if (eventRegMatch && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      const eventId = Number(eventRegMatch[1]);
      const targetSectorId = body.sectorId
        ? Number(body.sectorId)
        : (req.user.playerId ? Number(req.user.playerId) : null);

      if (!targetSectorId) {
        return sendError(res, 400, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан профиль игрока');
      }
      const player = db.getPlayerById(targetSectorId);
      if (!player) {
        return sendError(res, 404, 'PLAYER_NOT_FOUND', 'Сектор не найден');
      }
      const isLeader = req.user.rank === 'r4' || req.user.rank === 'r5';
      if (!isLeader && player.userId !== req.user.id) {
        return sendError(res, 403, 'FORBIDDEN', 'Вы не являетесь владельцем этого сектора');
      }

      const { officerId, desiredPlace } = body;
      if (officerId) {
        const off = (player.officers || []).find(o => String(o.id) === String(officerId));
        if (off && Boolean(off.onlyPersonalPuzzles || off.only_personal_puzzles)) {
          return sendError(res, 400, 'OFFICER_ONLY_PERSONAL_PUZZLES', 'Этот офицер качается только за счет личных пазлов и не участвует в распределении ивентов');
        }
      }

      const reg = db.registerForEvent({
        eventId,
        playerId: targetSectorId,
        officerId: officerId || '',
        desiredPlace: desiredPlace !== undefined ? Number(desiredPlace) : 0
      });

      try {
        const ev = db.getEventById(eventId);
        const et = ev ? (db.getEventTypeById ? db.getEventTypeById(ev.typeId) : null) : null;
        const placeStr = (desiredPlace === undefined || Number(desiredPlace) === 0) ? 'Любое' : `#${desiredPlace}`;
        const baseUrl = getAppBaseUrl(req);
        dispatchNotification('staff_event_registration', {
          eventName: et?.name || `Событие #${eventId}`,
          sectorName: player.name || `Сектор #${player.id}`,
          desiredPlace: placeStr,
          link: `${baseUrl}/#events`
        }).catch(err => {
          console.warn('[Notification] Error dispatching staff_event_registration:', err.message);
        });
      } catch (notifErr) {
        console.warn('[Notification] Failed to prepare staff_event_registration:', notifErr.message);
      }

      return sendJson(res, 200, { success: true, registration: reg });
    }

    if (eventRegMatch && req.method === 'DELETE') {
      if (!requireAuth(req, res)) return;
      const eventId = Number(eventRegMatch[1]);
      const sectorIdParam = parsedUrl.searchParams.get('sectorId');
      const targetSectorId = sectorIdParam
        ? Number(sectorIdParam)
        : (body && body.sectorId ? Number(body.sectorId) : (req.user.playerId ? Number(req.user.playerId) : null));

      if (!targetSectorId) {
        return sendError(res, 400, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан профиль игрока');
      }
      const player = db.getPlayerById(targetSectorId);
      if (!player) {
        return sendError(res, 404, 'PLAYER_NOT_FOUND', 'Сектор не найден');
      }
      const isLeader = req.user.rank === 'r4' || req.user.rank === 'r5';
      if (!isLeader && player.userId !== req.user.id) {
        return sendError(res, 403, 'FORBIDDEN', 'Вы не являетесь владельцем этого сектора');
      }

      db.unregisterFromEvent(eventId, targetSectorId);
      return sendJson(res, 200, { success: true });
    }

    const autopickMatch = pathname.match(/^\/api\/events\/(\d+)\/(?:autopick|auto-pick)$/);
    if (autopickMatch && req.method === 'POST') {
      if (!requirePermission(req, res, 'manage_events')) return;
      const eventId = Number(autopickMatch[1]);
      const result = seasonPlanner.runSmartAutopick(eventId);
      if (!result.success) {
        return sendError(res, 404, result.error, result.message);
      }
      return sendJson(res, 200, {
        success: true,
        assignments: result.assignments,
        unassignedCandidates: result.unassignedCandidates
      });
    }

    const eventMatch = pathname.match(/^\/api\/events\/(\d+)$/);
    if (eventMatch && req.method === 'GET') {
      const ev = db.getEventById(Number(eventMatch[1]));
      if (!ev) return sendError(res, 404, 'EVENT_NOT_FOUND');
      const et = db.getEventTypeById ? db.getEventTypeById(ev.typeId) : null;
      ev.title = et ? et.name : (ev.title || `Событие #${ev.id}`);
      ev.name = ev.title;
      ev.eventType = et || null;
      ev.places = et ? (typeof logic.resolveEventPlaces === 'function' ? logic.resolveEventPlaces(et, ev.dateFrom) : et.places) : [];
      ev.startDate = ev.dateFrom;
      ev.endDate = ev.dateTo;
      ev.dateStart = ev.dateFrom;
      ev.dateEnd = ev.dateTo;

      const canManageEvents = Boolean(req.user && logic.hasUserPermission(req.user, 'manage_events'));
      const userSectors = req.user ? db.getPlayersByUserId(req.user.id) : [];
      const userSectorIds = new Set(userSectors.map(s => s.id));
      const eventRegs = (canManageEvents || userSectors.length > 0) ? db.getRegistrationsByEventId(ev.id) : [];
      if (canManageEvents) {
        ev.registrations = eventRegs;
      }
      if (req.user) {
        ev.myRegistrations = eventRegs.filter(r => userSectorIds.has(r.playerId));
        ev.myRegistration = ev.myRegistrations.find(r => r.playerId === req.user.playerId) || ev.myRegistrations[0] || null;
      }
      return sendJson(res, 200, ev);
    }

    if (eventMatch && req.method === 'PUT') {
      if (!requirePermission(req, res, 'manage_events')) return;
      const eventId = Number(eventMatch[1]);
      const prevEvent = db.getEventById(eventId);
      const prevAssignments = prevEvent?.assignments || [];

      const saved = db.saveEvent({ ...body, id: eventId });

      try {
        const newAssignments = Array.isArray(body.assignments) ? body.assignments : [];
        if (newAssignments.length > 0) {
          const eventTypes = db.getEventTypes();
          const et = eventTypes.find(t => t.id === (saved.typeId || prevEvent?.typeId));
          const places = et ? (typeof logic.resolveEventPlaces === 'function' ? logic.resolveEventPlaces(et, saved.dateFrom || prevEvent?.dateFrom) : et.places) : [];
          const baseUrl = getAppBaseUrl(req);

          for (const a of newAssignments) {
            if (a.playerId && Number(a.place) > 0) {
              const already = prevAssignments.some(pa => pa.playerId === a.playerId && Number(pa.place) === Number(a.place));
              if (!already) {
                const player = db.getPlayerById(a.playerId);
                if (player && player.userId) {
                  const user = db.findUserById(player.userId);
                  if (user) {
                    const coupons = a.coupons !== undefined ? a.coupons : (places.find(p => Number(p.place) === Number(a.place))?.coupons || 0);
                    const rsvpMarkup = {
                      inline_keyboard: [
                        [
                          { text: '✅ Подтверждаю участие', callback_data: `rsvp_event:confirm:${saved.id}:${a.place}` },
                          { text: '❌ Не смогу участвовать', callback_data: `rsvp_event:decline:${saved.id}:${a.place}` }
                        ]
                      ]
                    };
                    await dispatchNotification('event_place_assigned', {
                      username: user.username,
                      sectorName: player.name || a.playerName || 'Сектор',
                      eventName: et?.name || 'Событие',
                      eventDate: saved.dateFrom || prevEvent?.dateFrom || '',
                      place: String(a.place),
                      coupons: String(coupons),
                      link: `${baseUrl}/#event/${saved.id}`
                    }, { userId: user.id, replyMarkup: rsvpMarkup }).catch(() => {});
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn('[Notification] Error in PUT /api/events/:id place notifications:', err.message);
      }

      return sendJson(res, 200, saved);
    }

    if (eventMatch && req.method === 'DELETE') {
      if (!requirePermission(req, res, 'manage_events')) return;
      db.deleteEvent(Number(eventMatch[1]));
      return sendJson(res, 200, { success: true });
    }

    const rsvpEventMatch = pathname.match(/^\/api\/events\/(\d+)\/rsvp$/);
    if (rsvpEventMatch && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      const eventId = Number(rsvpEventMatch[1]);
      const placeNum = Number(body && body.place);
      const status = String(body && body.status); // 'confirmed' | 'declined'

      const opRes = await eventOps.rsvpEvent({
        eventId,
        place: placeNum,
        status,
        user: req.user,
        req
      });

      if (!opRes.ok) {
        return sendError(res, opRes.status || 400, opRes.error, opRes.message);
      }
      return sendJson(res, 200, { success: true, event: opRes.event });
    }

    const submitResultMatch = pathname.match(/^\/api\/events\/(\d+)\/submit-result$/);
    if (submitResultMatch && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      const eventId = Number(submitResultMatch[1]);
      const placeNum = Number(body && body.place);
      const actualPlace = Number(body && body.actualPlace);

      const opRes = await eventOps.submitEventResult({
        eventId,
        place: placeNum,
        actualPlace,
        user: req.user,
        req,
        submittedBy: 'web'
      });

      if (!opRes.ok) {
        return sendError(res, opRes.status || 400, opRes.error, opRes.message);
      }
      return sendJson(res, 200, { success: true, event: opRes.event, accruedCoupons: opRes.prizeCoupons });
    }

    const finishEventMatch = pathname.match(/^\/api\/events\/(\d+)\/finish$/);
    if (finishEventMatch && req.method === 'POST') {
      if (!requirePermission(req, res, 'manage_events')) return;
      const eventId = Number(finishEventMatch[1]);
      const ev = db.getEventById(eventId);
      if (!ev) return sendError(res, 404, 'EVENT_NOT_FOUND', 'Событие не найдено');

      const baseUrl = getAppBaseUrl(req);
      const et = db.getEventTypes().find(t => t.id === ev.typeId);
      let sentCount = 0;

      for (const a of (ev.assignments || [])) {
        if (!a.resultStatus || a.resultStatus === 'pending') {
          const player = db.getPlayerById(a.playerId);
          if (player && player.userId) {
            const user = db.findUserById(player.userId);
            if (user && user.telegram_chat_id && user.telegram_notifications_enabled !== 0) {
              const buttons = {
                inline_keyboard: [
                  [
                    { text: '🥇 1 место', callback_data: `event_result:submit:${ev.id}:1` },
                    { text: '🥈 2 место', callback_data: `event_result:submit:${ev.id}:2` },
                    { text: '🥉 3 место', callback_data: `event_result:submit:${ev.id}:3` }
                  ],
                  [
                    { text: '🏅 4–10 место', callback_data: `event_result:submit:${ev.id}:4` },
                    { text: '❌ Не участвовал', callback_data: `event_result:submit:${ev.id}:0` }
                  ]
                ]
              };
              await dispatchNotification('event_result_prompt', {
                eventName: et?.name || 'Событие',
                sectorName: player.name || 'Сектор',
                assignedPlace: String(a.place),
                link: `${baseUrl}/#event/${ev.id}`
              }, { userId: user.id, replyMarkup: buttons }).catch(() => {});
              sentCount++;
            }
          }
        }
      }

      return sendJson(res, 200, { success: true, sentCount });
    }

    const summaryEventMatch = pathname.match(/^\/api\/events\/(\d+)\/summary$/);
    if (summaryEventMatch && req.method === 'POST') {
      if (!requirePermission(req, res, 'manage_events')) return;
      const eventId = Number(summaryEventMatch[1]);
      const ev = db.getEventById(eventId);
      if (!ev) return sendError(res, 404, 'EVENT_NOT_FOUND', 'Событие не найдено');

      const baseUrl = getAppBaseUrl(req);
      const et = db.getEventTypes().find(t => t.id === ev.typeId);
      const totalAssigned = (ev.assignments || []).length;
      const confirmedCount = (ev.assignments || []).filter(a => a.resultStatus === 'confirmed').length;
      const unconfirmedCount = totalAssigned - confirmedCount;
      const totalCoupons = (ev.assignments || []).reduce((sum, a) => sum + (Number(a.actualCoupons) || 0), 0);

      await dispatchNotification('staff_event_completed_summary', {
        eventName: et?.name || 'Событие',
        totalAssigned: String(totalAssigned),
        confirmedCount: String(confirmedCount),
        unconfirmedCount: String(unconfirmedCount),
        totalCoupons: String(totalCoupons),
        link: `${baseUrl}/#event/${ev.id}`
      });

      return sendJson(res, 200, { success: true, totalAssigned, confirmedCount, unconfirmedCount, totalCoupons });
    }

    const shareGridEventMatch = pathname.match(/^\/api\/events\/(\d+)\/share-grid$/);
    if (shareGridEventMatch && req.method === 'POST') {
      if (!requirePermission(req, res, 'manage_events')) return;
      const eventId = Number(shareGridEventMatch[1]);
      const ev = db.getEventById(eventId);
      if (!ev) return sendError(res, 404, 'EVENT_NOT_FOUND', 'Событие не найдено');

      const imageBase64 = body && (body.imageBase64 || body.image_base64);
      if (!imageBase64 || typeof imageBase64 !== 'string') {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Параметр imageBase64 обязателен');
      }

      const botToken = db.getAppSetting('telegram_bot_token');
      if (!botToken) {
        return sendError(res, 400, 'BOT_TOKEN_NOT_CONFIGURED', 'Токен бота не настроен в системе');
      }

      const target = body && body.target ? String(body.target).trim().toLowerCase() : 'staff';
      const staffChatId = db.getAppSetting('telegram_staff_chat_id');
      const announcementChatId = db.getAppSetting('telegram_announcement_chat_id');

      const targetChats = [];
      if (target === 'staff') {
        if (!staffChatId) {
          return sendError(res, 400, 'STAFF_CHAT_NOT_CONFIGURED', 'Чат штаба не настроен в системе');
        }
        targetChats.push(staffChatId);
      } else if (target === 'channel' || target === 'announcement') {
        if (!announcementChatId) {
          return sendError(res, 400, 'ANNOUNCEMENT_CHAT_NOT_CONFIGURED', 'Канал анонсов не настроен в системе');
        }
        targetChats.push(announcementChatId);
      } else if (target === 'both') {
        if (!staffChatId && !announcementChatId) {
          return sendError(res, 400, 'NO_CHATS_CONFIGURED', 'Ни чат штаба, ни канал анонсов не настроены в системе');
        }
        if (staffChatId) targetChats.push(staffChatId);
        if (announcementChatId) targetChats.push(announcementChatId);
      } else {
        return sendError(res, 400, 'INVALID_TARGET', 'Недопустимый канал назначения (staff, channel, both)');
      }

      const baseUrl = getAppBaseUrl(req);
      const et = db.getEventTypes().find(t => t.id === ev.typeId);
      const eventTitle = ev.title || et?.name || 'Событие';
      const escape = (typeof logic.escapeHtml === 'function') ? logic.escapeHtml : (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
      const defaultCaption = `📊 <b>Сетка события: ${escape(eventTitle)}</b>\n📅 Период: ${escape(ev.dateFrom || '')} — ${escape(ev.dateTo || '')}\n🎖 Назначений: ${(ev.assignments || []).length}`;
      const caption = (body.caption && String(body.caption).trim()) ? String(body.caption).trim() : defaultCaption;

      const replyMarkup = {
        inline_keyboard: [
          [{ text: '🔗 Открыть сетку ивента', url: `${baseUrl}/#event/${ev.id}` }]
        ]
      };

      const sendResults = [];
      for (const destChatId of targetChats) {
        const result = await telegram.sendTelegramPhoto({
          token: botToken,
          chatId: destChatId,
          photo: imageBase64,
          caption,
          parseMode: 'HTML',
          replyMarkup
        });
        if (result.ok) {
          sendResults.push({ chatId: destChatId, messageId: result.result?.message_id });
        }
      }

      if (sendResults.length === 0) {
        return sendError(res, 502, 'TELEGRAM_ERROR', 'Ошибка отправки изображения в Telegram');
      }

      return sendJson(res, 200, {
        success: true,
        sentCount: sendResults.length,
        messageId: sendResults[0].messageId,
        results: sendResults
      });
    }

    // ─────────────────────────────────────────────────────────
    // ADMIN EXPORT & IMPORT
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/admin/export' && req.method === 'GET') {
      if (!requireRole(['r5'])(req, res)) return;
      const backup = db.exportKowJson();
      return sendJson(res, 200, backup);
    }

    if (pathname === '/api/admin/import' && req.method === 'POST') {
      if (!requireRole(['r5'])(req, res)) return;
      try {
        db.importKowJson(body);
        return sendJson(res, 200, { success: true });
      } catch (err) {
        return sendError(res, 400, 'IMPORT_FAILED', err.message);
      }
    }

    // ─────────────────────────────────────────────────────────
    // ADMIN S3 SYNCHRONIZATION & STATUS
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/admin/s3-status' && req.method === 'GET') {
      if (!requireRole(['r4', 'r5'])(req, res)) return;
      const status = s3Manager ? s3Manager.getStatus() : { enabled: false };
      return sendJson(res, 200, status);
    }

    if (pathname === '/api/admin/s3-sync' && req.method === 'POST') {
      if (!requireRole(['r5'])(req, res)) return;
      if (!s3Manager || !s3Manager.getStatus().enabled) {
        return sendError(res, 400, 'S3_NOT_CONFIGURED', 'S3-хранилище не настроено в переменных окружения');
      }
      try {
        const syncRes = await s3Manager.pushImmediate();
        return sendJson(res, 200, { success: true, result: syncRes, status: s3Manager.getStatus() });
      } catch (err) {
        return sendError(res, 500, 'S3_SYNC_FAILED', err.message);
      }
    }

    // ─────────────────────────────────────────────────────────
    // SCREENSHOT STORAGE & SERVING
    // ─────────────────────────────────────────────────────────
    const screenshotMatch = pathname.match(/^\/api\/screenshots\/(.+)$/);
    if (screenshotMatch && (req.method === 'GET' || req.method === 'HEAD')) {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }

      const rawParam = screenshotMatch[1];
      let filename = '';
      try {
        filename = decodeURIComponent(rawParam);
      } catch (e) {
        return sendError(res, 400, 'BAD_REQUEST', 'Некорректное имя файла');
      }

      // Check path traversal: forbid '..' or '/' or '\\'
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return sendError(res, 400, 'BAD_REQUEST', 'Недопустимое имя файла');
      }

      const dbInstance = db.getDb();
      const record = dbInstance.prepare(`
        SELECT shr.*, p.user_id as player_owner_id
        FROM stock_history_records shr
        JOIN players p ON p.id = shr.player_id
        WHERE shr.screenshot_path = ? OR shr.screenshot_path LIKE ('%/' || ?)
      `).get(filename, filename);

      if (!record) {
        return sendError(res, 404, 'NOT_FOUND', 'Скриншот не найден');
      }

      const isStaff = req.user.rank === 'r4' || req.user.rank === 'r5';
      const isOwner = record.player_owner_id === req.user.id || req.user.player_id === record.player_id;
      const hasPerm = logic.hasUserPermission(req.user, 'view_sectors') || logic.hasUserPermission(req.user, 'view_stocks');

      if (!isStaff && !isOwner && !hasPerm) {
        return sendError(res, 403, 'FORBIDDEN', 'Недостаточно прав для просмотра этого скриншота');
      }

      const baseScreenshotsDir = path.resolve(path.join(__dirname, '..', 'data', 'screenshots'));
      const fullFilePath = path.resolve(baseScreenshotsDir, record.screenshot_path);

      if (!fullFilePath.startsWith(baseScreenshotsDir + path.sep)) {
        return sendError(res, 403, 'FORBIDDEN', 'Доступ запрещен');
      }

      if (!fs.existsSync(fullFilePath)) {
        return sendError(res, 404, 'NOT_FOUND', 'Файл скриншота удален или отсутствует');
      }

      const ext = path.extname(fullFilePath).toLowerCase();
      const contentType = ext === '.webp' ? 'image/webp' : (ext === '.png' ? 'image/png' : 'image/jpeg');

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=86400'
      });

      if (req.method === 'HEAD') {
        return res.end();
      }

      const stream = fs.createReadStream(fullFilePath);
      return stream.pipe(res);
    }

    // ─────────────────────────────────────────────────────────
    // TELEGRAM BOT WEBHOOK & MANAGEMENT ENDPOINTS
    // ─────────────────────────────────────────────────────────

    if (pathname === '/api/telegram/webhook' && req.method === 'POST') {
      const configuredSecret = db.getAppSetting('telegram_webhook_secret');
      if (configuredSecret) {
        const incomingSecret = req.headers['x-telegram-bot-api-secret-token'];
        if (incomingSecret !== configuredSecret) {
          return sendError(res, 401, 'UNAUTHORIZED', 'Invalid webhook secret token');
        }
      }

      try {
        const result = await handleTelegramUpdate(body || {});
        return sendJson(res, 200, result);
      } catch (err) {
        console.error('[Telegram Webhook Error]', err);
        return sendError(res, 500, 'WEBHOOK_ERROR', err.message);
      }
    }

    if (pathname === '/api/telegram/settings' && req.method === 'GET') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r4' && req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Требуются права офицера (Р4/Р5)');
      }

      const token = db.getAppSetting('telegram_bot_token');
      const staffChatId = db.getAppSetting('telegram_staff_chat_id');
      const announcementChatId = db.getAppSetting('telegram_announcement_chat_id');
      const botUsername = db.getAppSetting('telegram_bot_username');
      const pollingStatus = telegram.getTelegramPollingStatus();

      let tokenMasked = null;
      if (token && typeof token === 'string') {
        if (token.length > 8) {
          const colonIdx = token.indexOf(':');
          if (colonIdx > 0) {
            tokenMasked = token.slice(0, colonIdx + 1) + '***' + token.slice(-4);
          } else {
            tokenMasked = token.slice(0, 4) + '***' + token.slice(-4);
          }
        } else {
          tokenMasked = '***';
        }
      }

      const webAppUrl = db.getAppSetting('telegram_webapp_url') || db.getAppSetting('app_base_url');

      return sendJson(res, 200, {
        hasToken: Boolean(token),
        tokenMasked,
        staffChatId: staffChatId || null,
        announcementChatId: announcementChatId || null,
        botUsername: botUsername || null,
        webAppUrl: webAppUrl || null,
        polling: pollingStatus
      });
    }

    if (pathname === '/api/telegram/settings' && req.method === 'PUT') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Только Р5 может изменять настройки Telegram бота');
      }

      if (body.token !== undefined) {
        const rawToken = String(body.token).trim();
        db.setAppSetting('telegram_bot_token', rawToken);
      }

      if (body.staffChatId !== undefined) {
        db.setAppSetting('telegram_staff_chat_id', String(body.staffChatId).trim());
      }

      if (body.announcementChatId !== undefined) {
        db.setAppSetting('telegram_announcement_chat_id', String(body.announcementChatId).trim());
      }

      if (body.botUsername !== undefined) {
        const cleanBotUsername = String(body.botUsername).replace(/^@+/, '').trim();
        db.setAppSetting('telegram_bot_username', cleanBotUsername);
      }

      if (body.webAppUrl !== undefined || body.telegram_webapp_url !== undefined) {
        const rawWebAppUrl = String(body.webAppUrl !== undefined ? body.webAppUrl : body.telegram_webapp_url).trim();
        db.setAppSetting('telegram_webapp_url', rawWebAppUrl);
        const liveToken = db.getAppSetting('telegram_bot_token');
        if (liveToken && rawWebAppUrl && /^https:\/\//i.test(rawWebAppUrl)) {
          const effectiveUrl = logic.formatTmaUrl ? logic.formatTmaUrl(rawWebAppUrl) : rawWebAppUrl;
          telegram.setTelegramChatMenuButton(liveToken, {
            text: '🚀 KoW Tracker',
            url: effectiveUrl
          }).catch(err => {
            console.warn('[Telegram] Could not set chat menu button on settings update:', err.message);
          });
        }
      }

      const token = db.getAppSetting('telegram_bot_token');
      const staffChatId = db.getAppSetting('telegram_staff_chat_id');
      const announcementChatId = db.getAppSetting('telegram_announcement_chat_id');
      const botUsername = db.getAppSetting('telegram_bot_username');
      const webAppUrl = db.getAppSetting('telegram_webapp_url') || db.getAppSetting('app_base_url');

      syncTelegramBotInfoAndPolling().catch(err => {
        console.warn('[Telegram] Sync error on settings save:', err.message);
      });

      return sendJson(res, 200, {
        success: true,
        hasToken: Boolean(token),
        staffChatId: staffChatId || null,
        announcementChatId: announcementChatId || null,
        botUsername: botUsername || null,
        webAppUrl: webAppUrl || null,
        polling: telegram.getTelegramPollingStatus()
      });
    }

    // ─────────────────────────────────────────────────────────
    // MIERU TUNNEL SETTINGS & TEST ENDPOINTS
    // ─────────────────────────────────────────────────────────

    if (pathname === '/api/mieru/settings' && req.method === 'GET') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r4' && req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Требуются права офицера (Р4/Р5)');
      }

      const settings = db.getMieruSettings();
      const status = mieru.getMieruStatus();

      return sendJson(res, 200, {
        enabled: settings.enabled,
        server: settings.server,
        serverAddress: settings.server,
        portRange: settings.portRange,
        user: settings.user,
        username: settings.user,
        passwordMasked: mieru.maskSecret(settings.password),
        hasPassword: Boolean(settings.password),
        transport: settings.transport,
        socks5Port: settings.socks5Port,
        configJson: settings.configJson,
        rawJson: settings.configJson,
        isRunning: status.running,
        status
      });
    }

    if (pathname === '/api/mieru/settings' && req.method === 'PUT') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Только Р5 может изменять настройки туннеля Mieru');
      }

      const rawJsonInput = body.configJson || body.rawJson;
      const serverInput = body.server || body.serverAddress;
      const userInput = body.user || body.username;

      let configToApply = null;
      if (rawJsonInput && String(rawJsonInput).trim()) {
        const parsed = mieru.parseMieruConfig(rawJsonInput);
        if (!parsed.ok) {
          return sendError(res, 400, 'INVALID_MIERU_JSON', parsed.message);
        }
        configToApply = parsed.config;
        db.saveMieruSettings({
          ...parsed.fields,
          enabled: body.enabled !== undefined ? Boolean(body.enabled) : true,
          configJson: rawJsonInput
        });
      } else {
        const saved = db.saveMieruSettings({
          enabled: body.enabled !== undefined ? Boolean(body.enabled) : undefined,
          server: serverInput,
          portRange: body.portRange,
          user: userInput,
          password: body.password,
          transport: body.transport,
          socks5Port: body.socks5Port,
          configJson: rawJsonInput || ''
        });
        configToApply = mieru.formatMieruConfig(saved);
      }

      const updated = db.getMieruSettings();
      if (updated.enabled && (updated.server || updated.configJson)) {
        const dataDir = path.join(__dirname, '..', 'data');
        if (mieru.isMieruBinaryAvailable()) {
          mieru.startMieruProcess(configToApply, dataDir);
        }
        telegram.setDefaultProxyUrl(`socks5://127.0.0.1:${updated.socks5Port || 1080}`);
      } else {
        mieru.stopMieruProcess();
        telegram.setDefaultProxyUrl(null);
      }

      // Re-sync Telegram polling with new proxy setting
      syncTelegramBotInfoAndPolling().catch(err => {
        console.warn('[Telegram] Sync error on Mieru update:', err.message);
      });

      const status = mieru.getMieruStatus();
      return sendJson(res, 200, {
        success: true,
        enabled: updated.enabled,
        server: updated.server,
        serverAddress: updated.server,
        portRange: updated.portRange,
        user: updated.user,
        username: updated.user,
        passwordMasked: mieru.maskSecret(updated.password),
        hasPassword: Boolean(updated.password),
        transport: updated.transport,
        socks5Port: updated.socks5Port,
        configJson: updated.configJson,
        rawJson: updated.configJson,
        isRunning: status.running,
        status
      });
    }

    if (pathname === '/api/mieru/test' && req.method === 'POST') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r4' && req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Требуются права офицера (Р4/Р5)');
      }

      const settings = db.getMieruSettings();
      const botToken = db.getAppSetting('telegram_bot_token');
      const socksPort = settings.socks5Port || 1080;
      const proxyUrl = `socks5://127.0.0.1:${socksPort}`;

      // If mieru binary is available and not running, ensure process is started before test
      const status = mieru.getMieruStatus();
      if (!status.running && mieru.isMieruBinaryAvailable() && (settings.server || settings.configJson)) {
        const fullConfig = settings.configJson
          ? (mieru.parseMieruConfig(settings.configJson).config || mieru.formatMieruConfig(settings))
          : mieru.formatMieruConfig(settings);
        mieru.startMieruProcess(fullConfig, path.join(__dirname, '..', 'data'));
        await new Promise(r => setTimeout(r, 600));
      }

      const testResult = await mieru.testMieruConnection(proxyUrl, botToken);
      return sendJson(res, 200, testResult);
    }

    if (pathname === '/api/telegram/bind-webapp' && req.method === 'POST') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      const botToken = db.getAppSetting('telegram_bot_token');
      if (!botToken) {
        return sendError(res, 503, 'BOT_NOT_CONFIGURED', 'Токен Telegram-бота не настроен');
      }
      const initData = body && (body.initData || body.init_data);
      if (!initData || typeof initData !== 'string') {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Параметр initData обязателен');
      }
      const validation = logic.validateTelegramWebAppData(initData, botToken);
      if (!validation.valid || !validation.user?.id) {
        return sendError(res, 401, 'INVALID_TELEGRAM_DATA', 'Ошибка валидации Telegram WebApp');
      }
      db.bindUserTelegram(req.user.id, validation.user.id, validation.user.username || '');
      const updatedUser = (typeof db.getUserById === 'function') ? db.getUserById(req.user.id) : req.user;
      return sendJson(res, 200, { success: true, user: updatedUser });
    }

    if (pathname === '/api/telegram/bind-token' && req.method === 'POST') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }

      const token = crypto.randomBytes(16).toString('hex');
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      db.createTelegramBindToken(req.user.id, token, expiresAt);

      const rawBotUsername = db.getAppSetting('telegram_bot_username');
      let botUsername = String(rawBotUsername || '').replace(/^@+/, '').trim();
      if (!botUsername) {
        const botToken = db.getAppSetting('telegram_bot_token');
        if (botToken) {
          try {
            const me = await telegram.getTelegramMe(botToken, { timeoutMs: 2500 });
            if (me.ok && me.result && me.result.username) {
              botUsername = me.result.username.replace(/^@+/, '');
              db.setAppSetting('telegram_bot_username', botUsername);
            }
          } catch (_) {}
        }
      }
      botUsername = botUsername || 'KoWTrackerBot';
      const deepLink = `https://t.me/${botUsername}?start=bind_${token}`;

      return sendJson(res, 200, {
        token,
        expiresAt,
        deepLink,
        botUsername
      });
    }

    if (pathname === '/api/telegram/bind' && req.method === 'DELETE') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      db.unbindUserTelegram(req.user.id);
      return sendJson(res, 200, { success: true });
    }

    if (pathname === '/api/telegram/notifications' && (req.method === 'PUT' || req.method === 'POST')) {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      const enabled = body.enabled !== false && body.enabled !== 0 && body.enabled !== '0';
      db.toggleTelegramNotifications(req.user.id, enabled);
      return sendJson(res, 200, { success: true, enabled });
    }

    if (pathname === '/api/telegram/staff-bind-token' && req.method === 'POST') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Только Р5 может генерировать код привязки чата штаба');
      }

      const pin = `KOW-STAFF-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      db.createStaffBindToken(pin, expiresAt);

      return sendJson(res, 200, {
        pin,
        expiresAt
      });
    }

    if (pathname === '/api/telegram/channel-bind-token' && req.method === 'POST') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Только Р5 может генерировать код привязки канала анонсов');
      }

      const pin = `KOW-CHAN-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      db.createChannelBindToken(pin, expiresAt);

      return sendJson(res, 200, {
        pin,
        expiresAt
      });
    }

    if (pathname === '/api/telegram/schedule' && req.method === 'GET') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r4' && req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Требуются права офицера (Р4/Р5)');
      }

      const schedule = db.getStaleAlertSchedule();
      const nextRun = logic.calculateNextStaleRun({
        frequency: schedule.frequency,
        time: schedule.time,
        now: new Date(),
        timezoneOffset: schedule.timezoneOffset || 3
      });

      return sendJson(res, 200, {
        success: true,
        schedule,
        nextRun
      });
    }

    if (pathname === '/api/telegram/schedule' && req.method === 'PUT') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Только Р5 может изменять расписание уведомлений');
      }

      const payload = { ...(body || {}) };
      if (payload.time && payload.clientTimezoneOffset !== undefined) {
        const clientOffset = Number(payload.clientTimezoneOffset);
        if (!isNaN(clientOffset) && clientOffset !== 3) {
          payload.time = logic.convertTimeBetweenTimezones(payload.time, clientOffset, 3).time;
        }
      }

      const updated = db.updateStaleAlertSchedule(payload);
      const nextRun = logic.calculateNextStaleRun({
        frequency: updated.frequency,
        time: updated.time,
        now: new Date(),
        timezoneOffset: updated.timezoneOffset || 3
      });

      return sendJson(res, 200, {
        success: true,
        schedule: updated,
        nextRun
      });
    }

    if (pathname === '/api/telegram/check-reminders' && req.method === 'POST') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r4' && req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Требуются права офицера (Р4/Р5)');
      }

      const force = (body && body.force !== undefined) ? Boolean(body.force) : true;
      const forcePersonal = Boolean(body && body.forcePersonal);
      const result = await checkStaleStockReminders(req, { isScheduled: false, force, forcePersonal });
      return sendJson(res, 200, { success: true, ...result });
    }

    if (pathname === '/api/telegram/check-morning-reminders' && req.method === 'POST') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r4' && req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Требуются права офицера (Р4/Р5)');
      }

      const force = Boolean(body && body.force);
      const now = body && body.now ? body.now : null;
      const targetHour = body && body.targetHour !== undefined ? Number(body.targetHour) : 9;
      const result = await checkScheduledEventMorningReminders(req, { force, now, targetHour });
      return sendJson(res, 200, { success: true, ...result });
    }

    // ─────────────────────────────────────────────────────────
    // NOTIFICATION TEMPLATES ENDPOINTS
    // ─────────────────────────────────────────────────────────

    if (pathname === '/api/notification-templates' && req.method === 'GET') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r4' && req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Требуются права офицера (Р4/Р5)');
      }
      const templates = db.getNotificationTemplates();
      return sendJson(res, 200, templates);
    }

    const tplMatch = pathname.match(/^\/api\/notification-templates\/([a-zA-Z0-9_]+)$/);
    if (tplMatch && req.method === 'PUT') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r4' && req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Требуются права офицера (Р4/Р5)');
      }
      const key = tplMatch[1];
      const updated = db.updateNotificationTemplate(key, body);
      if (!updated) {
        return sendError(res, 404, 'NOT_FOUND', 'Шаблон не найден');
      }
      return sendJson(res, 200, { success: true, template: updated });
    }

    const tplResetMatch = pathname.match(/^\/api\/notification-templates\/([a-zA-Z0-9_]+)\/reset$/);
    if (tplResetMatch && req.method === 'POST') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r4' && req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Требуются права офицера (Р4/Р5)');
      }
      const key = tplResetMatch[1];
      const reset = db.resetNotificationTemplate(key);
      if (!reset) {
        return sendError(res, 404, 'NOT_FOUND', 'Шаблон не найден');
      }
      return sendJson(res, 200, { success: true, template: reset });
    }

    const tplTestMatch = pathname.match(/^\/api\/notification-templates\/([a-zA-Z0-9_]+)\/test$/);
    if (tplTestMatch && req.method === 'POST') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r4' && req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Требуются права офицера (Р4/Р5)');
      }
      const key = tplTestMatch[1];
      const tpl = db.getNotificationTemplate(key);
      if (!tpl) {
        return sendError(res, 404, 'NOT_FOUND', 'Шаблон не найден');
      }

      const botToken = db.getAppSetting('telegram_bot_token');
      if (!botToken) {
        return sendError(res, 400, 'NO_BOT_TOKEN', 'Токен Telegram бота не настроен в системе');
      }

      let targetChatId = null;
      if (tpl.channel === 'personal') {
        targetChatId = req.user.telegram_chat_id;
        if (!targetChatId) {
          return sendError(res, 400, 'NO_TELEGRAM_LINKED', 'Привяжите ваш Telegram аккаунт в Личном кабинете для получения тестовых сообщений');
        }
      } else {
        targetChatId = db.getAppSetting('telegram_staff_chat_id');
        if (!targetChatId) {
          return sendError(res, 400, 'NO_STAFF_CHAT_LINKED', 'Чат штаба не привязан. Подключите чат штаба через PIN-код или укажите ID чата в настройках');
        }
        if (targetChatId && !isNaN(Number(targetChatId))) {
          targetChatId = Number(targetChatId);
        }
      }

      const templateText = body.template !== undefined ? body.template : tpl.template;
      const parseMode = body.parseMode || body.parse_mode || tpl.parse_mode || 'HTML';
      const sampleData = logic.NOTIFICATION_TEMPLATE_SAMPLE_DATA[key] || {};
      const renderedText = logic.renderTemplate(templateText, sampleData);

      const sendRes = await telegram.sendTelegramMessage({
        token: botToken,
        chatId: targetChatId,
        text: renderedText,
        parseMode
      });

      if (!sendRes.ok) {
        return sendJson(res, 200, { success: false, error: sendRes.error });
      }

      return sendJson(res, 200, { success: true, messageId: sendRes.result?.message_id });
    }

    // Unmatched API endpoint
    return sendError(res, 404, 'NOT_FOUND', `Endpoint ${pathname} not found`);
    } catch (err) {
      sendError(res, 500, 'INTERNAL_SERVER_ERROR', err.message);
    }
  };
}

async function startServer({ port = 3000, dbPath = null, staticDir = null, s3Manager = null } = {}) {
  const resolvedDbPath = dbPath || resolveDbPath();
  const effectiveStaticDir = staticDir || path.join(__dirname, '..', 'client');
  let activeS3Manager = s3Manager;
  if (!activeS3Manager && resolvedDbPath !== ':memory:') {
    const s3Config = s3.getS3Config();
    if (s3Config) {
      activeS3Manager = new s3.S3SyncManager({
        config: s3Config,
        dbPath: resolvedDbPath,
        onCheckpoint: () => {
          const currentDb = db.getDb();
          if (currentDb) {
            currentDb.exec('PRAGMA wal_checkpoint(TRUNCATE);');
          }
        }
      });
    }
  }

  if (activeS3Manager && activeS3Manager.getStatus().enabled) {
    try {
      const pullResult = await activeS3Manager.pull(resolvedDbPath);
      db.initDb(resolvedDbPath);
      if (!pullResult.found) {
        await activeS3Manager.pushImmediate().catch(err => {
          console.error('[S3] Initial push error:', err.message);
        });
      }
    } catch (pullErr) {
      console.error('[S3] Pull failed on startup, continuing with local db:', pullErr.message);
      db.initDb(resolvedDbPath);
    }
  } else {
    db.initDb(resolvedDbPath);
  }

  // Ensure screenshots base directory exists
  const screenshotsDir = path.join(__dirname, '..', 'data', 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    try {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    } catch (_) {}
  }

  // Clean up expired screenshots on startup and schedule 24-hour retention interval
  db.cleanupExpiredScreenshots(null, screenshotsDir).catch(() => {});
  const retentionInterval = setInterval(() => {
    db.cleanupExpiredScreenshots(null, screenshotsDir).catch(err => {
      console.error('[Retention] Cleanup error:', err);
    });
  }, 24 * 60 * 60 * 1000);
  if (retentionInterval.unref) retentionInterval.unref();

  // Schedule minute ticker for configurable stale stock reminders
  const staleReminderInterval = setInterval(() => {
    checkScheduledStaleStockReminders().catch(err => {
      console.error('[Reminders] Error in scheduled stale reminder ticker:', err);
    });
  }, 60 * 1000);
  if (staleReminderInterval.unref) staleReminderInterval.unref();

  // Schedule minute ticker for morning event briefings at 09:00 local time
  const morningReminderInterval = setInterval(() => {
    checkScheduledEventMorningReminders().catch(err => {
      console.error('[MorningReminders] Error in scheduled morning ticker:', err);
    });
  }, 60 * 1000);
  if (morningReminderInterval.unref) morningReminderInterval.unref();

  // Auto-start Mieru tunnel client if enabled
  try {
    const mieruSettings = db.getMieruSettings();
    if (mieruSettings.enabled && (mieruSettings.server || mieruSettings.configJson)) {
      if (mieru.isMieruBinaryAvailable()) {
        const fullConfig = mieruSettings.configJson
          ? (mieru.parseMieruConfig(mieruSettings.configJson).config || mieru.formatMieruConfig(mieruSettings))
          : mieru.formatMieruConfig(mieruSettings);
        mieru.startMieruProcess(fullConfig, path.join(__dirname, '..', 'data'));
      }
      telegram.setDefaultProxyUrl(`socks5://127.0.0.1:${mieruSettings.socks5Port || 1080}`);
    }
  } catch (mErr) {
    console.warn('[Mieru] Auto-start on boot warning:', mErr.message);
  }

  // Auto-sync Telegram Bot and start Long Polling
  try {
    syncTelegramBotInfoAndPolling().catch(err => {
      console.warn('[Telegram] Startup polling warning:', err.message);
    });
  } catch (tErr) {
    console.warn('[Telegram] Startup warning:', tErr.message);
  }

  const server = http.createServer(createRequestHandler(effectiveStaticDir, activeS3Manager));
  server.s3Manager = activeS3Manager;

  // Promisify close for clean test teardowns
  const originalClose = server.close.bind(server);
  server.close = function (callback) {
    clearInterval(retentionInterval);
    clearInterval(staleReminderInterval);
    clearInterval(morningReminderInterval);
    mieru.stopMieruProcess();
    telegram.stopTelegramPolling();
    telegram.setDefaultProxyUrl(null);
    recentCreatedEventsCache.length = 0;
    return new Promise((resolve, reject) => {
      originalClose(err => {
        if (callback) callback(err);
        if (err) reject(err);
        else resolve();
      });
    });
  };

  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      resolve(server);
    });
    server.on('error', reject);
  });
}

function resolveDbPath() {
  if (process.env.DB_PATH) {
    return process.env.DB_PATH;
  }
  if (fs.existsSync('/app/data')) {
    return '/app/data/kow.db';
  }
  if (fs.existsSync('/data')) {
    return '/data/kow.db';
  }
  return path.join(__dirname, '..', 'data', 'kow.db');
}

if (require.main === module) {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  const dbPath = resolveDbPath();
  startServer({ port, dbPath }).then(server => {
    console.log(`Server started on port ${server.address().port}, db: ${dbPath}`);

    let isShuttingDown = false;
    async function handleShutdown(signal) {
      if (isShuttingDown) return;
      isShuttingDown = true;
      console.log(`Received ${signal}, starting graceful shutdown...`);
      try {
        const currentDb = db.getDb();
        if (currentDb) {
          console.log('Checkpointing SQLite WAL...');
          currentDb.exec('PRAGMA wal_checkpoint(TRUNCATE);');
        }
        if (server.s3Manager && server.s3Manager.getStatus().enabled) {
          console.log('[S3] Syncing final database state to S3...');
          try {
            await server.s3Manager.pushImmediate();
            console.log('[S3] Final sync to S3 complete.');
          } catch (s3Err) {
            console.error('[S3] Final sync failed:', s3Err.message);
          }
        }
        if (currentDb) {
          currentDb.close();
          console.log('SQLite database closed cleanly.');
        }
      } catch (err) {
        console.error('Error during shutdown:', err);
      }
      server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 4000).unref();
    }

    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));
  }).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = {
  startServer,
  createRequestHandler,
  MIME_TYPES,
  dispatchNotification,
  checkStaleStockReminders,
  checkScheduledEventMorningReminders,
  handleTelegramUpdate,
  syncTelegramBotInfoAndPolling,
  setServerOcrRunner,
  tryServerOcr
};
