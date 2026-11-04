const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const db = require('./db.js');
const logic = require('./logic.js');
const s3 = require('./s3.js');
const telegram = require('./telegram.js');
const mieru = require('./mieru.js');

let APP_VERSION = '3.21.0';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
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

function sendJson(res, statusCode, data) {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
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
  let token = null;
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|;\s*)token=([^;]+)/);
    if (match) {
      token = decodeURIComponent(match[1]);
    }
  }

  if (!token) {
    req.user = null;
    return null;
  }
  const user = db.verifySession(token);
  req.user = user || null;
  req.token = token;
  return req.user;
}

function sanitizeSkills(skills) {
  if (!Array.isArray(skills)) return [1, 1, 1, 1];
  const arr = skills.slice(0, 4);
  while (arr.length < 4) arr.push(1);
  return arr.map(n => Math.max(1, Math.min(5, Math.floor(Number(n) || 1))));
}

function sanitizeInvested(invested) {
  if (!invested || typeof invested !== 'object') return { ...logic.INVESTED_ZERO };
  return {
    starCoupons: Math.max(0, Math.round(Number(invested.starCoupons) || 0)),
    legendaryStars1: Math.max(0, Math.round(Number(invested.legendaryStars1) || 0)),
    legendaryStars2: Math.max(0, Math.round(Number(invested.legendaryStars2) || 0)),
    legendaryStars3: Math.max(0, Math.round(Number(invested.legendaryStars3) || 0)),
    coupons: Math.max(0, Math.round(Number(invested.coupons) || 0)),
    puzzles: Math.max(0, Math.round(Number(invested.puzzles) || 0)),
  };
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
    if (!req.user) {
      sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      return false;
    }
    if (!roles.includes(req.user.rank)) {
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
  if (logic.hasUserPermission(req.user, permission)) {
    return true;
  }
  sendError(res, 403, 'FORBIDDEN', `Недостаточно прав: требуется разрешение ${permission}`);
  return false;
}

function maskPlayerStockIfNeeded(player, user) {
  if (!player) return player;
  const isOwner = user && player.userId === user.id;
  const canViewStocks = user && logic.hasUserPermission(user, 'view_stocks');
  if (isOwner || canViewStocks) {
    return player;
  }
  return {
    ...player,
    stock: {
      coupons: 0,
      puzzles: 0,
      chests: 0,
      starCoupons: 0,
      legendaryStars1: 0,
      legendaryStars2: 0,
      legendaryStars3: 0,
      masked: true
    }
  };
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

async function dispatchNotification(eventKey, data = {}, options = {}) {
  try {
    const template = db.getNotificationTemplate(eventKey);
    if (!template) {
      console.warn(`[Notification] Template "${eventKey}" not found`);
      return { sent: false, reason: 'template_not_found' };
    }

    const token = db.getAppSetting('telegram_bot_token');
    if (!token) {
      return { sent: false, reason: 'no_bot_token' };
    }

    const renderedText = logic.renderTemplate(template.template, data);
    const parseMode = template.parse_mode || 'HTML';
    const replyMarkup = options.replyMarkup || undefined;

    const mieruSettings = db.getMieruSettings();
    const proxyUrl = options.proxyUrl || (mieruSettings.enabled ? `socks5://127.0.0.1:${mieruSettings.socks5Port || 1080}` : undefined);
    const sendOpts = proxyUrl ? { proxyUrl } : {};

    if (template.channel === 'staff') {
      let staffChatId = db.getAppSetting('telegram_staff_chat_id');
      if (!staffChatId) {
        return { sent: false, reason: 'no_staff_chat_id' };
      }
      if (staffChatId && !isNaN(Number(staffChatId))) {
        staffChatId = Number(staffChatId);
      }
      const res = await telegram.sendTelegramMessage({
        token,
        chatId: staffChatId,
        text: renderedText,
        parseMode,
        replyMarkup
      }, sendOpts);
      return { sent: res.ok, result: res };
    }

    if (template.channel === 'personal') {
      if (options.userId) {
        const user = db.findUserById(options.userId);
        if (!user) {
          return { sent: false, reason: 'user_not_found' };
        }
        if (!user.telegram_chat_id || user.telegram_notifications_enabled === 0) {
          return { sent: false, reason: 'notifications_disabled_or_no_chat' };
        }
        const res = await telegram.sendTelegramMessage({
          token,
          chatId: user.telegram_chat_id,
          text: renderedText,
          parseMode,
          replyMarkup
        }, sendOpts);
        return { sent: res.ok, result: res };
      }

      if (options.broadcast) {
        const users = db.getUsers();
        const targets = users.filter(u => u.is_approved !== 0 && u.telegram_chat_id && u.telegram_notifications_enabled !== 0);
        let sentCount = 0;
        for (const u of targets) {
          const res = await telegram.sendTelegramMessage({
            token,
            chatId: u.telegram_chat_id,
            text: renderedText,
            parseMode,
            replyMarkup
          });
          if (res.ok) sentCount++;
        }
        return { sent: true, sentCount, totalTargets: targets.length };
      }

      if (options.chatId) {
        const res = await telegram.sendTelegramMessage({
          token,
          chatId: options.chatId,
          text: renderedText,
          parseMode,
          replyMarkup
        });
        return { sent: res.ok, result: res };
      }

      return { sent: false, reason: 'no_target_specified' };
    }

    return { sent: false, reason: 'unknown_channel' };
  } catch (err) {
    console.warn(`[Notification] Error dispatching "${eventKey}":`, err.message);
    return { sent: false, error: err.message };
  }
}

async function checkStaleStockReminders(req = null) {
  try {
    const players = db.getPlayers();
    const totalSectors = players.length;
    let freshCount = 0;
    let warningCount = 0;
    let staleCount = 0;
    let personalRemindersSent = 0;

    const baseUrl = getAppBaseUrl(req);
    const now = new Date();

    const staleSectors = [];

    for (const player of players) {
      const freshness = logic.getStockFreshness(player.stockUpdatedAt, now);
      if (freshness.status === 'fresh') {
        freshCount++;
      } else if (freshness.status === 'warning') {
        warningCount++;
      } else if (freshness.status === 'stale') {
        staleCount++;
        staleSectors.push({ player, freshness });
      }
    }

    // 1. Personal reminders to owners of stale sectors
    for (const { player, freshness } of staleSectors) {
      if (player.userId) {
        const user = db.findUserById(player.userId);
        if (user && user.telegram_chat_id && user.telegram_notifications_enabled !== 0) {
          const res = await dispatchNotification('stock_reminder_personal', {
            username: user.username,
            sectorName: player.name || 'Сектор',
            daysOverdue: String(freshness.days ?? '14+'),
            link: `${baseUrl}/#cabinet`
          }, { userId: user.id }).catch(err => {
            console.warn(`[Reminders] Error sending reminder to user ${user.id}:`, err.message);
            return { sent: false };
          });
          if (res && res.sent) {
            personalRemindersSent++;
          }
        }
      }
    }

    // 2. Staff alert summary
    let staffAlertSent = false;
    const staffRes = await dispatchNotification('staff_stale_stocks_alert', {
      totalSectors: String(totalSectors),
      freshCount: String(freshCount),
      warningCount: String(warningCount),
      staleCount: String(staleCount),
      link: `${baseUrl}/#matrix`
    }).catch(err => {
      console.warn('[Reminders] Error sending staff_stale_stocks_alert:', err.message);
      return { sent: false };
    });
    if (staffRes && staffRes.sent) {
      staffAlertSent = true;
    }

    return {
      totalSectors,
      freshCount,
      warningCount,
      staleCount,
      personalRemindersSent,
      staffAlertSent
    };
  } catch (err) {
    console.warn('[Reminders] Error in checkStaleStockReminders:', err.message);
    return {
      totalSectors: 0,
      freshCount: 0,
      warningCount: 0,
      staleCount: 0,
      personalRemindersSent: 0,
      staffAlertSent: false,
      error: err.message
    };
  }
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

  const safeBase = path.resolve(staticDir);
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const targetPath = path.resolve(safeBase, relativePath);

  // Path traversal protection
  if (!targetPath.startsWith(safeBase)) {
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
    } else if (pathname === '/manifest.json') {
      headers['Content-Type'] = 'application/manifest+json; charset=UTF-8';
    }

    res.writeHead(200, headers);

    if (req.method === 'HEAD') {
      return res.end();
    }

    const stream = fs.createReadStream(targetPath);
    stream.pipe(res);
  });
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

            await dispatchNotification('staff_new_user_pending', {
              username,
              sectorName,
              power,
              vip
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

        return sendJson(res, 200, {
          success: true,
          pendingApproval: regRes.pendingApproval,
          userId: regRes.userId,
          is_approved: regRes.is_approved
        });
      }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const { username, password } = body;
      if (!username || !password) {
        return sendError(res, 400, 'MISSING_FIELDS', 'Логин и пароль обязательны');
      }
      const loginRes = db.loginUser(username, password);
      if (loginRes.error === 'PENDING_APPROVAL') {
        return sendError(res, 403, 'PENDING_APPROVAL', 'Аккаунт ожидает подтверждения Главой (Р5) или Чиновником (Р4)');
      }
      if (loginRes.error) {
        return sendError(res, 401, loginRes.error, 'Неверный логин или пароль');
      }
      return sendJson(res, 200, {
        token: loginRes.token,
        user: {
          ...loginRes.user,
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
      let rank = body.rank === 'r4' ? 'r4' : 'r3';
      if (req.user.rank !== 'r5' && body.rank && body.rank !== 'r3') {
        return sendJson(res, 403, { error: 'Только глава альянса (Р5) может назначать ранг выше Р3' });
      }
      if (req.user.rank === 'r5' && ['r3', 'r4'].includes(body.rank)) {
        rank = body.rank;
      }
      const updatedUser = db.approveUser(targetUserId, rank);
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

    // ─────────────────────────────────────────────────────────
    // PLAYER CABINET & SECTORS (/api/my-profile, /api/my-sectors)
    // ─────────────────────────────────────────────────────────
    if (pathname === '/api/my-profile' && req.method === 'GET') {
      if (!requireAuth(req, res)) return;
      const sectors = db.getPlayersByUserId(req.user.id);
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
          telegramNotificationsEnabled: req.user.telegram_notifications_enabled !== 0
        },
        sectors,
        activeSectorId: activeSector ? activeSector.id : null,
        sector: activeSector ? activeSector.sector : null,
        stock: activeSector ? activeSector.stock : null,
        officers: activeSector ? (activeSector.officers || []) : []
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
      if (!req.user.playerId) {
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
            const updatedOff = db.updatePlayerOfficer(req.user.playerId, o.id, o);
            if (!updatedOff) {
              db.addPlayerOfficer(req.user.playerId, o);
            }
          } else {
            db.addPlayerOfficer(req.user.playerId, o);
          }
        }
      }

      const updated = db.updatePlayer(req.user.playerId, { ...body, editorUserId: req.user.id });
      if (body.stock) {
        db.recordStockHistory(req.user.playerId, body.stock);
      }
      return sendJson(res, 200, updated);
    }

    if (pathname === '/api/my-profile/officers' && req.method === 'POST') {
      if (!requireAuth(req, res)) return;
      if (!req.user.playerId) {
        return sendError(res, 404, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан профиль игрока');
      }
      if (body.skills !== undefined) {
        body.skills = sanitizeSkills(body.skills);
      }
      if (body.invested !== undefined) {
        body.invested = sanitizeInvested(body.invested);
      }
      if (body.personalPuzzles !== undefined || body.personal_puzzles !== undefined) {
        body.personalPuzzles = sanitizePersonalPuzzles(body.personalPuzzles ?? body.personal_puzzles);
      }
      if (body.onlyPersonalPuzzles !== undefined || body.only_personal_puzzles !== undefined) {
        body.onlyPersonalPuzzles = Boolean(body.onlyPersonalPuzzles ?? body.only_personal_puzzles);
      }
      const off = db.addPlayerOfficer(req.user.playerId, body);
      return sendJson(res, 200, off);
    }

    const myOfficerMatch = pathname.match(/^\/api\/my-profile\/officers\/([^/]+)$/);
    if (myOfficerMatch && req.method === 'PUT') {
      if (!requireAuth(req, res)) return;
      if (!req.user.playerId) {
        return sendError(res, 404, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан профиль игрока');
      }
      const officerId = myOfficerMatch[1];
      if (body.skills !== undefined) {
        body.skills = sanitizeSkills(body.skills);
      }
      if (body.invested !== undefined) {
        body.invested = sanitizeInvested(body.invested);
      }
      if (body.personalPuzzles !== undefined || body.personal_puzzles !== undefined) {
        body.personalPuzzles = sanitizePersonalPuzzles(body.personalPuzzles ?? body.personal_puzzles);
      }
      if (body.onlyPersonalPuzzles !== undefined || body.only_personal_puzzles !== undefined) {
        body.onlyPersonalPuzzles = Boolean(body.onlyPersonalPuzzles ?? body.only_personal_puzzles);
      }
      const off = db.updatePlayerOfficer(req.user.playerId, officerId, body);
      if (!off) {
        return sendError(res, 404, 'OFFICER_NOT_FOUND', 'Офицер не найден');
      }
      return sendJson(res, 200, off);
    }

    if (myOfficerMatch && req.method === 'DELETE') {
      if (!requireAuth(req, res)) return;
      if (!req.user.playerId) {
        return sendError(res, 404, 'NO_LINKED_PLAYER', 'К вашему аккаунту не привязан профиль игрока');
      }
      const officerId = myOfficerMatch[1];
      db.deletePlayerOfficer(req.user.playerId, officerId);
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
      if (!req.user) {
        return { ok: false, status: 401, error: 'UNAUTHORIZED', message: 'Требуется авторизация' };
      }
      const player = db.getPlayerById(targetPlayerId);
      if (!player) {
        return { ok: false, status: 404, error: 'PLAYER_NOT_FOUND', message: 'Сектор не найден' };
      }
      const isLeader = req.user.rank === 'r4' || req.user.rank === 'r5';
      const isOwner = player.userId === req.user.id;
      if (isRead) {
        const canRead = isLeader || isOwner || logic.hasUserPermission(req.user, 'view_sectors');
        if (!canRead) {
          return { ok: false, status: 403, error: 'FORBIDDEN', message: 'Вы не являетесь владельцем этого сектора' };
        }
        const maskedPlayer = maskPlayerStockIfNeeded(player, req.user);
        return { ok: true, player: maskedPlayer, isLeader, isOwner };
      }
      if (!isLeader && !isOwner) {
        return { ok: false, status: 403, error: 'FORBIDDEN', message: 'Вы не являетесь владельцем этого сектора' };
      }
      return { ok: true, player, isLeader, isOwner };
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
        const screenshotsDir = path.join(__dirname, 'data', 'screenshots', yyyyMm);
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

      if (body.skills !== undefined) {
        body.skills = sanitizeSkills(body.skills);
      }
      if (body.invested !== undefined) {
        body.invested = sanitizeInvested(body.invested);
      }
      if (body.personalPuzzles !== undefined || body.personal_puzzles !== undefined) {
        body.personalPuzzles = sanitizePersonalPuzzles(body.personalPuzzles ?? body.personal_puzzles);
      }
      if (body.onlyPersonalPuzzles !== undefined || body.only_personal_puzzles !== undefined) {
        body.onlyPersonalPuzzles = Boolean(body.onlyPersonalPuzzles ?? body.only_personal_puzzles);
      }
      const off = db.addPlayerOfficer(targetPlayerId, body);
      return sendJson(res, 201, off);
    }

    const playerOfficerDetailMatch = pathname.match(/^\/api\/players\/(\d+)\/officers\/([^/]+)$/);
    if (playerOfficerDetailMatch && req.method === 'PUT') {
      const targetPlayerId = Number(playerOfficerDetailMatch[1]);
      const offId = playerOfficerDetailMatch[2];
      const check = checkSectorAccess(targetPlayerId);
      if (!check.ok) return sendError(res, check.status, check.error, check.message);

      if (body.skills !== undefined) {
        body.skills = sanitizeSkills(body.skills);
      }
      if (body.invested !== undefined) {
        body.invested = sanitizeInvested(body.invested);
      }
      if (body.personalPuzzles !== undefined || body.personal_puzzles !== undefined) {
        body.personalPuzzles = sanitizePersonalPuzzles(body.personalPuzzles ?? body.personal_puzzles);
      }
      if (body.onlyPersonalPuzzles !== undefined || body.only_personal_puzzles !== undefined) {
        body.onlyPersonalPuzzles = Boolean(body.onlyPersonalPuzzles ?? body.only_personal_puzzles);
      }
      const off = db.updatePlayerOfficer(targetPlayerId, offId, body);
      if (!off) {
        return sendError(res, 404, 'OFFICER_NOT_FOUND', 'Офицер не найден');
      }
      return sendJson(res, 200, off);
    }

    if (playerOfficerDetailMatch && req.method === 'DELETE') {
      const targetPlayerId = Number(playerOfficerDetailMatch[1]);
      const offId = playerOfficerDetailMatch[2];
      const check = checkSectorAccess(targetPlayerId);
      if (!check.ok) return sendError(res, check.status, check.error, check.message);

      db.deletePlayerOfficer(targetPlayerId, offId);
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
      const canManageEvents = Boolean(req.user && logic.hasUserPermission(req.user, 'manage_events'));
      const userSectors = req.user ? db.getPlayersByUserId(req.user.id) : [];
      const userSectorIds = new Set(userSectors.map(s => s.id));
      const activeSectorId = req.user?.playerId;

      const enriched = events.map(ev => {
        const item = { ...ev };
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
      const saved = db.saveEvent(body);

      if (isNew && saved && saved.id) {
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
            link: `${baseUrl}/#cabinet`
          }, { broadcast: true }).catch(err => {
            console.warn('[Notification] Error broadcasting event_registration_opened:', err.message);
          });
        } catch (notifErr) {
          console.warn('[Notification] Error preparing event_registration_opened:', notifErr.message);
        }
      }

      return sendJson(res, 200, saved);
    }

    if (pathname === '/api/events/schedule-season' && req.method === 'POST') {
      if (!requirePermission(req, res, 'manage_events')) return;

      let cachedEventTypes = db.getEventTypes();
      function ensureEventType(identifier, defaultColor) {
        const search = String(identifier || '').trim().toLowerCase();
        let found = cachedEventTypes.find(t => t.name && t.name.trim().toLowerCase() === search);

        const preset = (logic.EVENT_PRESETS || []).find(p => p.id === search || p.name.trim().toLowerCase() === search);
        if (!found && preset) {
          found = cachedEventTypes.find(t => t.name && t.name.trim().toLowerCase() === preset.name.trim().toLowerCase());
        }

        if (!found) {
          const typeName = preset ? preset.name : (identifier || 'Событие');
          let color = defaultColor || (preset ? preset.color : '#8b5cf6');
          if (preset?.id === 'king-of-war') color = '#8b5cf6';
          else if (preset?.id === 'mighty-forces') color = '#10b981';
          else if (preset?.id === 'power-of-time') color = '#f59e0b';

          found = db.saveEventType({
            name: typeName,
            color: color || '#8b5cf6',
            isPeriodic: 1,
            startDayOfWeek: preset?.startDayOfWeek || 2,
            endDayOfWeek: preset?.endDayOfWeek || 3,
            activeWeeks: preset?.activeWeeks || 1,
            breakWeeks: preset?.breakWeeks || 1,
            weekOffset: preset?.weekOffset || 0,
            places: [
              { place: 1, label: '🥇 1 место', coupons: 12500 },
              { place: 2, label: '🥈 2 место', coupons: 6500 },
              { place: 3, label: '🥉 3 место', coupons: 3500 },
              { place: 4, label: '4–10 место', coupons: 2750 },
            ]
          });
          cachedEventTypes.push(found);
        }
        return found;
      }

      const createdEvents = [];

      if (Array.isArray(body?.events)) {
        // 1. Ready-made events array from UI preview (with possible deletions/edits)
        for (const item of body.events) {
          if (!item || !item.dateFrom || !item.dateTo) continue;
          let et = null;
          if (item.typeId && typeof item.typeId === 'number') {
            const allTypes = db.getEventTypes();
            et = allTypes.find(t => t.id === item.typeId);
          }
          if (!et) {
            et = ensureEventType(item.typeName || item.name || item.typeId, item.color);
          }
          const saved = db.saveEvent({
            typeId: et.id,
            dateFrom: item.dateFrom,
            dateTo: item.dateTo,
            note: item.note || '',
            assignments: []
          });
          createdEvents.push(saved);
        }
      } else if (body?.rules || body?.totalWeeks) {
        // 2. Multi-rule season generation
        const scheduleItems = logic.generateSeasonSchedule({
          startDate: body.startDate || new Date().toISOString().slice(0, 10),
          totalWeeks: body.totalWeeks,
          rules: body.rules
        });

        for (const item of scheduleItems) {
          const et = ensureEventType(item.typeName || item.name || item.typeId, item.color);
          const saved = db.saveEvent({
            typeId: et.id,
            dateFrom: item.dateFrom,
            dateTo: item.dateTo,
            note: item.note || '',
            assignments: []
          });
          createdEvents.push(saved);
        }
      } else {
        // 3. Legacy fallback (presetId, startDate, cyclesCount)
        const { presetId = 'king-of-war', startDate, cyclesCount = 1 } = body || {};
        const preset = (logic.EVENT_PRESETS || []).find(p => p.id === presetId) || (logic.EVENT_PRESETS && logic.EVENT_PRESETS[0]) || {
          id: 'king-of-war',
          name: 'Король Войны',
          cycleDays: 14,
          durationDays: 2
        };

        const eventType = ensureEventType(preset.name, preset.color);
        const count = Math.max(1, Number(cyclesCount) || 1);
        const scheduleItems = logic.generateSeasonSchedule({
          startDate: startDate || new Date().toISOString().slice(0, 10),
          cyclesCount: count,
          presetId: preset.id
        });

        for (const item of scheduleItems) {
          const saved = db.saveEvent({
            typeId: eventType.id,
            dateFrom: item.dateFrom,
            dateTo: item.dateTo,
            note: item.note || '',
            assignments: []
          });
          createdEvents.push(saved);
        }
      }

      return sendJson(res, 201, {
        success: true,
        count: createdEvents.length,
        createdCount: createdEvents.length,
        events: createdEvents
      });
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
      const reg = db.registerForEvent({
        eventId,
        playerId: targetSectorId,
        officerId: officerId || '',
        desiredPlace: desiredPlace !== undefined ? Number(desiredPlace) : 0
      });
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
      const ev = db.getEventById(eventId);
      if (!ev) {
        return sendError(res, 404, 'EVENT_NOT_FOUND', 'Ивент не найден');
      }
      const eventTypes = db.getEventTypes();
      const et = eventTypes.find(t => t.id === ev.typeId);
      const places = et ? (typeof logic.resolveEventPlaces === 'function' ? logic.resolveEventPlaces(et, ev.dateFrom) : et.places) : [];

      const players = db.getPlayers();
      const officerCatalog = db.getCatalog();
      const registrations = db.getRegistrationsByEventId(eventId);
      const recentWinners = typeof db.getRecentWinners === 'function'
        ? db.getRecentWinners(ev.typeId || ev.type_id, 2, ev.id)
        : [];

      const result = logic.smartAutoPickWithRegistrations({
        event: { ...ev, places },
        players,
        registrations,
        officerCatalog,
        eventDate: ev.dateFrom,
        recentWinners
      });

      ev.assignments = result.assignments;
      db.saveEvent(ev);

      // Trigger 3: event_place_assigned & Trigger 4: staff_event_autopick_summary
      try {
        const baseUrl = getAppBaseUrl(req);
        const assignedList = (result.assignments || []).filter(a => a.playerId && Number(a.place) > 0);

        // 1. Personal notifications to each assigned sector owner
        for (const a of assignedList) {
          const player = db.getPlayerById(a.playerId);
          if (player && player.userId) {
            const user = db.findUserById(player.userId);
            if (user) {
              const coupons = a.coupons !== undefined ? a.coupons : (places.find(p => Number(p.place) === Number(a.place))?.coupons || 0);
              await dispatchNotification('event_place_assigned', {
                username: user.username,
                sectorName: player.name || a.playerName || 'Сектор',
                eventName: et?.name || 'Событие',
                eventDate: ev.dateFrom || '',
                place: String(a.place),
                coupons: String(coupons),
                link: `${baseUrl}/#calendar`
              }, { userId: user.id }).catch(err => {
                console.warn(`[Notification] Error sending event_place_assigned to user ${user.id}:`, err.message);
              });
            }
          }
        }

        // 2. Staff autopick summary
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
          link: `${baseUrl}/#events`
        }).catch(err => {
          console.warn('[Notification] Error sending staff_event_autopick_summary:', err.message);
        });
      } catch (autopickNotifErr) {
        console.warn('[Notification] Error in autopick notifications:', autopickNotifErr.message);
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
                    await dispatchNotification('event_place_assigned', {
                      username: user.username,
                      sectorName: player.name || a.playerName || 'Сектор',
                      eventName: et?.name || 'Событие',
                      eventDate: saved.dateFrom || prevEvent?.dateFrom || '',
                      place: String(a.place),
                      coupons: String(coupons),
                      link: `${baseUrl}/#calendar`
                    }, { userId: user.id }).catch(() => {});
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

      const baseScreenshotsDir = path.resolve(path.join(__dirname, 'data', 'screenshots'));
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

      const update = body || {};
      const token = db.getAppSetting('telegram_bot_token');

      // 1. Message update
      if (update.message) {
        const msg = update.message;
        const text = (msg.text || '').trim();
        const chatId = msg.chat?.id;

        // A) /start bind_<token>
        const bindMatch = text.match(/^\/start(?:\s+|@\w+\s+)bind_([a-zA-Z0-9_-]+)/i);
        if (bindMatch) {
          const bindToken = bindMatch[1];
          const user = db.findUserByTelegramBindToken(bindToken);
          if (user) {
            const username = msg.from?.username || msg.from?.first_name || '';
            db.bindUserTelegram(user.id, chatId, username);
            if (token) {
              await telegram.sendTelegramMessage({
                token,
                chatId,
                text: '✅ <b>Ваш аккаунт KoW Tracker успешно подключен!</b>\nТеперь вы будете получать персональные уведомления о распределении мест и событиях альянса.'
              });
            }
            return sendJson(res, 200, { ok: true, bound: true, userId: user.id });
          } else {
            if (token) {
              await telegram.sendTelegramMessage({
                token,
                chatId,
                text: '❌ <b>Срок действия ссылки истек или токен недействителен.</b>\nПожалуйста, сгенерируйте новую ссылку для привязки в Личном кабинете KoW Tracker.'
              });
            }
            return sendJson(res, 200, { ok: true, bound: false, reason: 'token_expired_or_invalid' });
          }
        }

        // B) /connect_staff <PIN>
        const staffMatch = text.match(/^\/connect_staff(?:\s+|@\w+\s+)(KOW-STAFF-[A-Z0-9-]+)/i);
        if (staffMatch) {
          const pin = staffMatch[1].trim().toUpperCase();
          const bindRes = db.verifyAndBindStaffChat(pin, chatId);
          if (bindRes.success) {
            if (token) {
              await telegram.sendTelegramMessage({
                token,
                chatId,
                text: '✅ <b>Чат штаба успешно подключен к KoW Tracker!</b>\nОповещения для офицеров Р4/Р5 активированы.'
              });
            }
            return sendJson(res, 200, { ok: true, staffConnected: true, chatId });
          } else {
            if (token) {
              await telegram.sendTelegramMessage({
                token,
                chatId,
                text: '❌ <b>Неверный или истекший код привязки штаба.</b>\nСгенерируйте свежий PIN в настройках KoW Tracker (раздел Настройки ➔ Уведомления).'
              });
            }
            return sendJson(res, 200, { ok: true, staffConnected: false, reason: bindRes.reason });
          }
        }
      }

      // 2. Callback query update (interactive buttons)
      if (update.callback_query) {
        const cq = update.callback_query;
        const cqId = cq.id;
        const data = cq.data || '';
        const fromId = cq.from?.id;
        const chatMsg = cq.message;

        const approveMatch = data.match(/^approve_user:(\d+)$/);
        const rejectMatch = data.match(/^reject_user:(\d+)$/);

        if (approveMatch || rejectMatch) {
          const targetUserId = Number((approveMatch || rejectMatch)[1]);
          const isApprove = Boolean(approveMatch);

          const officer = db.findUserByTelegramChatId(fromId);
          const isStaff = officer && (officer.rank === 'r5' || officer.rank === 'r4' || logic.hasUserPermission(officer, 'approve_users'));

          if (!isStaff) {
            if (token) {
              await telegram.answerTelegramCallback({
                token,
                callbackQueryId: cqId,
                text: '⛔ Доступ запрещен. У вас нет прав офицера для одобрения новичков.',
                showAlert: true
              });
            }
            return sendJson(res, 200, { ok: true, authorized: false });
          }

          const targetUser = db.findUserById(targetUserId);
          const targetName = targetUser?.username || `ID ${targetUserId}`;
          const officerHandle = cq.from?.username ? `@${cq.from.username}` : (officer.username || 'Офицер');
          const officerRank = (officer.rank || 'r4').toUpperCase();

          if (isApprove) {
            db.approveUser(targetUserId, 'r3');
            if (token) {
              await telegram.answerTelegramCallback({
                token,
                callbackQueryId: cqId,
                text: '✅ Пользователь одобрен (Р3)'
              });
              if (chatMsg?.chat?.id && chatMsg?.message_id) {
                await telegram.editTelegramMessageText({
                  token,
                  chatId: chatMsg.chat.id,
                  messageId: chatMsg.message_id,
                  text: `✅ Пользователь <b>@${targetName}</b> одобрен офицером <b>${officerHandle}</b> (${officerRank})`,
                  replyMarkup: { inline_keyboard: [] }
                });
              }
            }
            return sendJson(res, 200, { ok: true, action: 'approved', userId: targetUserId });
          } else {
            db.rejectUser(targetUserId);
            if (token) {
              await telegram.answerTelegramCallback({
                token,
                callbackQueryId: cqId,
                text: '❌ Пользователь отклонен'
              });
              if (chatMsg?.chat?.id && chatMsg?.message_id) {
                await telegram.editTelegramMessageText({
                  token,
                  chatId: chatMsg.chat.id,
                  messageId: chatMsg.message_id,
                  text: `❌ Пользователь <b>@${targetName}</b> отклонен офицером <b>${officerHandle}</b> (${officerRank})`,
                  replyMarkup: { inline_keyboard: [] }
                });
              }
            }
            return sendJson(res, 200, { ok: true, action: 'rejected', userId: targetUserId });
          }
        }
      }

      return sendJson(res, 200, { ok: true });
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
      const botUsername = db.getAppSetting('telegram_bot_username');

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

      return sendJson(res, 200, {
        hasToken: Boolean(token),
        tokenMasked,
        staffChatId: staffChatId || null,
        botUsername: botUsername || null
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

      if (body.botUsername !== undefined) {
        db.setAppSetting('telegram_bot_username', String(body.botUsername).trim());
      }

      const token = db.getAppSetting('telegram_bot_token');
      const staffChatId = db.getAppSetting('telegram_staff_chat_id');
      const botUsername = db.getAppSetting('telegram_bot_username');

      return sendJson(res, 200, {
        success: true,
        hasToken: Boolean(token),
        staffChatId: staffChatId || null,
        botUsername: botUsername || null
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
        const dataDir = path.join(__dirname, 'data');
        mieru.startMieruProcess(configToApply, dataDir);
      } else {
        mieru.stopMieruProcess();
      }

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
      if (!status.running && (settings.server || settings.configJson)) {
        const fullConfig = settings.configJson
          ? (mieru.parseMieruConfig(settings.configJson).config || mieru.formatMieruConfig(settings))
          : mieru.formatMieruConfig(settings);
        mieru.startMieruProcess(fullConfig, path.join(__dirname, 'data'));
        await new Promise(r => setTimeout(r, 600));
      }

      const testResult = await mieru.testMieruConnection(proxyUrl, botToken);
      return sendJson(res, 200, testResult);
    }

    if (pathname === '/api/telegram/bind-token' && req.method === 'POST') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }

      const token = crypto.randomBytes(16).toString('hex');
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      db.createTelegramBindToken(req.user.id, token, expiresAt);

      const botUsername = db.getAppSetting('telegram_bot_username') || 'KoWTrackerBot';
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

    if (pathname === '/api/telegram/check-reminders' && req.method === 'POST') {
      if (!authenticate(req)) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация');
      }
      if (req.user.rank !== 'r4' && req.user.rank !== 'r5') {
        return sendError(res, 403, 'FORBIDDEN', 'Требуются права офицера (Р4/Р5)');
      }

      const result = await checkStaleStockReminders(req);
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

async function startServer({ port = 3000, dbPath = 'data/kow.db', staticDir = __dirname, s3Manager = null } = {}) {
  let activeS3Manager = s3Manager;
  if (!activeS3Manager && dbPath !== ':memory:') {
    const s3Config = s3.getS3Config();
    if (s3Config) {
      activeS3Manager = new s3.S3SyncManager({
        config: s3Config,
        dbPath,
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
      const pullResult = await activeS3Manager.pull(dbPath);
      db.initDb(dbPath);
      if (!pullResult.found) {
        await activeS3Manager.pushImmediate().catch(err => {
          console.error('[S3] Initial push error:', err.message);
        });
      }
    } catch (pullErr) {
      console.error('[S3] Pull failed on startup, continuing with local db:', pullErr.message);
      db.initDb(dbPath);
    }
  } else {
    db.initDb(dbPath);
  }

  // Ensure screenshots base directory exists
  const screenshotsDir = path.join(__dirname, 'data', 'screenshots');
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

  // Schedule daily stale stock check (24h)
  const staleReminderInterval = setInterval(() => {
    checkStaleStockReminders().catch(err => {
      console.error('[Reminders] Error in scheduled checkStaleStockReminders:', err);
    });
  }, 24 * 60 * 60 * 1000);
  if (staleReminderInterval.unref) staleReminderInterval.unref();

  // Auto-start Mieru tunnel client if enabled
  try {
    const mieruSettings = db.getMieruSettings();
    if (mieruSettings.enabled && (mieruSettings.server || mieruSettings.configJson)) {
      const fullConfig = mieruSettings.configJson
        ? (mieru.parseMieruConfig(mieruSettings.configJson).config || mieru.formatMieruConfig(mieruSettings))
        : mieru.formatMieruConfig(mieruSettings);
      mieru.startMieruProcess(fullConfig, path.join(__dirname, 'data'));
    }
  } catch (mErr) {
    console.warn('[Mieru] Auto-start on boot warning:', mErr.message);
  }

  const server = http.createServer(createRequestHandler(staticDir, activeS3Manager));
  server.s3Manager = activeS3Manager;

  // Promisify close for clean test teardowns
  const originalClose = server.close.bind(server);
  server.close = function (callback) {
    clearInterval(retentionInterval);
    clearInterval(staleReminderInterval);
    mieru.stopMieruProcess();
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
  return path.join(__dirname, 'data', 'kow.db');
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
  checkStaleStockReminders
};
