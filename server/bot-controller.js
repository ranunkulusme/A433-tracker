/**
 * KoW Tracker - Deep Module: Telegram Bot Controller
 *
 * Encapsulates all bot command dispatching, interactive callback queries,
 * user binding, notification routing, and OCR warehouse confirmation flows.
 * Zero external dependencies.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { hasAnyStockValue } = require('./ocr-adapter.js');

function createTelegramBotController({
  db,
  logic,
  telegram,
  telegramFormats,
  ocrAdapter,
  eventOps,
  notificationEngine,
  tryServerOcr,
  dispatchNotification,
  getAppBaseUrl,
  checkStaleStockReminders
} = {}) {
  if (!db) throw new Error('db is required for TelegramBotController');
  if (!logic) throw new Error('logic is required for TelegramBotController');

  const tg = telegram || require('./telegram.js');
  telegram = tg;
  const tgFmt = telegramFormats || require('./telegram-formats.js');
  const resolveBaseUrl = typeof getAppBaseUrl === 'function'
    ? getAppBaseUrl
    : (() => (typeof db.resolveAppBaseUrl === 'function' ? db.resolveAppBaseUrl() : 'http://localhost:3000'));
  const recognizeStockFn = async (bufOrPath) => {
    if (ocrAdapter && typeof ocrAdapter.recognizeStock === 'function') {
      return ocrAdapter.recognizeStock(bufOrPath);
    }
    if (typeof tryServerOcr === 'function') {
      return tryServerOcr(bufOrPath);
    }
    return null;
  };

  const staleRemindersFn = (notificationEngine && typeof notificationEngine.checkStaleStockReminders === 'function')
    ? ((...args) => notificationEngine.checkStaleStockReminders(...args))
    : checkStaleStockReminders;

  const dispatchNotificationFn = (notificationEngine && typeof notificationEngine.dispatchNotification === 'function')
    ? ((...args) => notificationEngine.dispatchNotification(...args))
    : dispatchNotification;

  function getPlayerTargetOfficerDeficit(player) {
    if (!player) return { targetOfficer: null, targetDeficit: 0, deficitDetails: null };
    const pOfficers = Array.isArray(player.officers) ? player.officers : [];
    if (!pOfficers.length) return { targetOfficer: null, targetDeficit: 0, deficitDetails: null };

    const catalog = db.getCatalog ? db.getCatalog() : [];
    let target = pOfficers.find(o => {
      const skillsSum = Array.isArray(o.skills) ? o.skills.reduce((a, b) => a + Number(b), 0) : 4;
      return skillsSum < 20 || Number(o.stars || 0) < 5;
    }) || pOfficers[0];

    const catEntry = catalog.find(c => c.id === (target.catalogId || target.officerId || target.id)) || { name: target.name || 'Офицер', coupon_cost: 50 };
    const targetName = catEntry.name || target.name || 'Офицер';

    const rawCost = Number(catEntry?.coupon_per_puzzle ?? catEntry?.couponPerPuzzle ?? catEntry?.coupon_cost ?? 500);
    const defRes = logic.calculateOfficerDeficit({
      officer: target,
      catalogItem: { ...catEntry, couponPerPuzzle: rawCost },
      player,
      targetLevel: 180
    });
    return {
      targetOfficer: targetName,
      targetDeficit: defRes ? (defRes.deficitCoupons || defRes.coupons || 0) : 0,
      deficitDetails: defRes,
      deficitSummary: defRes?.deficitSummary || (defRes ? logic.formatOfficerDeficitSummary(defRes) : null)
    };
  }

  const resolveTelegramUser = (fromId, tgUsername) => {
    if (!fromId) return null;
    let user = db.findUserByTelegramChatId(fromId);
    if (!user && tgUsername) {
      const matched = db.findUserByTelegramUsername(tgUsername);
      if (matched && (!matched.telegram_chat_id || String(matched.telegram_chat_id) !== String(fromId))) {
        db.bindUserTelegram(matched.id, fromId, tgUsername);
        user = (typeof db.getUserById === 'function') ? db.getUserById(matched.id) : matched;
      }
    }
    return user;
  };

async function handleTelegramUpdate(update) {
  if (!update || typeof update !== 'object') {
    return { ok: false, error: 'INVALID_UPDATE' };
  }

  const token = db.getAppSetting('telegram_bot_token');

  const resolveTelegramUser = (fromId, tgUsername) => {
    if (!fromId) return null;
    let user = db.findUserByTelegramChatId(fromId);
    if (!user && tgUsername) {
      const matched = db.findUserByTelegramUsername(tgUsername);
      if (matched && (!matched.telegram_chat_id || String(matched.telegram_chat_id) !== String(fromId))) {
        db.bindUserTelegram(matched.id, fromId, tgUsername);
        user = (typeof db.getUserById === 'function') ? db.getUserById(matched.id) : matched;
      }
    }
    return user;
  };

  // 1. Message update
  if (update.message) {
    const msg = update.message;
    const text = (msg.text || '').trim();
    const chatId = msg.chat?.id;

    if (!chatId) return { ok: true, ignored: true };

    // A) /start bind_<token> (also supports /start@bot bind_<token>)
    const bindMatch = text.match(/^\/start(?:@\w+)?\s+bind_([a-zA-Z0-9_-]+)/i);
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
        return { ok: true, bound: true, userId: user.id };
      } else {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '❌ <b>Срок действия ссылки истек или токен недействителен.</b>\nПожалуйста, сгенерируйте новую ссылку для привязки в Личном кабинете KoW Tracker.'
          });
        }
        return { ok: true, bound: false, reason: 'token_expired_or_invalid' };
      }
    }

    // A2) /bind <login> <password> or /login <login> <password>
    const directBindMatch = text.match(/^\/(?:bind|login)(?:@\w+)?\s+(\S+)\s+(\S+)/i);
    if (directBindMatch && msg.chat?.type === 'private') {
      const login = directBindMatch[1].trim();
      const password = directBindMatch[2].trim();

      // Delete message with password for security
      if (token && msg.message_id) {
        try {
          await telegram.deleteTelegramMessage({ token, chatId, messageId: msg.message_id });
        } catch (_) {}
      }

      const authRes = db.loginUser(login, password);
      if (authRes && authRes.user && !authRes.error) {
        const username = msg.from?.username || msg.from?.first_name || '';
        db.bindUserTelegram(authRes.user.id, chatId, username);
        if (token) {
          const webAppUrl = db.getAppSetting('telegram_webapp_url') || db.getAppSetting('app_base_url') || null;
          const isStaff = authRes.user.rank === 'r4' || authRes.user.rank === 'r5';
          const keyboard = tgFmt.getTelegramMainMenuKeyboard({ isStaff, webAppUrl });
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: `✅ <b>Аккаунт «${authRes.user.username}» успешно привязан к вашему Telegram!</b>\n` +
                  `Роль: <b>${(authRes.user.rank || 'r3').toUpperCase()}</b>\n\n` +
                  `Теперь вы будете получать персональные уведомления, сможете просматривать свой сектор и обновлять склад.\n` +
                  `<i>(Сообщение с паролем удалено в целях безопасности).</i>`,
            replyMarkup: keyboard
          });
        }
        return { ok: true, bound: true, userId: authRes.user.id, directBind: true };
      } else {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '❌ <b>Неверный логин или пароль.</b>\n' +
                  'Проверьте правильность введенных данных учетной записи KoW Tracker и повторите попытку:\n' +
                  '<code>/bind &lt;ваш_логин&gt; &lt;ваш_пароль&gt;</code>'
          });
        }
        return { ok: true, bound: false, reason: 'invalid_credentials' };
      }
    }

    // A3) /bind or /login without parameters
    const bindHelpMatch = text.match(/^\/(?:bind|login)(?:@\w+)?(?:\s|$)/i);
    if (bindHelpMatch && msg.chat?.type === 'private') {
      if (token) {
        await telegram.sendTelegramMessage({
          token,
          chatId,
          text: 'ℹ️ <b>Привязка аккаунта KoW Tracker:</b>\n\n' +
                'Отправьте команду с вашим логином и паролем в трекере:\n' +
                '<code>/bind &lt;логин&gt; &lt;пароль&gt;</code>\n\n' +
                '<i>(Бот сразу удалит сообщение с паролем для вашей безопасности).</i>'
        });
      }
      return { ok: true, command: 'bind_help' };
    }

    // B) /connect_staff <PIN> (also supports /connect_staff@bot <PIN>)
    const staffMatch = text.match(/^\/connect_staff(?:@\w+)?\s+([a-zA-Z0-9_-]+)/i);
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
        return { ok: true, staffConnected: true, chatId };
      } else {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '❌ <b>Неверный или истекший код привязки штаба.</b>\nСгенерируйте свежий PIN в настройках KoW Tracker (раздел Настройки ➔ Уведомления).'
          });
        }
        return { ok: true, staffConnected: false, reason: bindRes.reason };
      }
    }

    // B2) /connect_channel <PIN> (also supports /connect_channel@bot <PIN>)
    const channelMatch = text.match(/^\/connect_channel(?:@\w+)?\s+([a-zA-Z0-9_-]+)/i);
    if (channelMatch) {
      const pin = channelMatch[1].trim().toUpperCase();
      const bindRes = db.verifyAndBindChannelChat(pin, chatId);
      if (bindRes.success) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '✅ <b>Канал/чат анонсов успешно подключен к KoW Tracker!</b>\nПубличные анонсы и сетки событий будут транслироваться сюда.'
          });
        }
        return { ok: true, channelConnected: true, chatId };
      } else {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '❌ <b>Неверный или истекший код привязки канала анонсов.</b>\nСгенерируйте свежий PIN в настройках KoW Tracker.'
          });
        }
        return { ok: true, channelConnected: false, reason: bindRes.reason };
      }
    }

    // C) /ping or /status
    if (/^\/(?:ping|status)(?:@\w+)?(?:\s|$)/i.test(text)) {
      if (token) {
        const staffChatId = db.getAppSetting('telegram_staff_chat_id');
        const isStaffChat = String(staffChatId) === String(chatId);
        const roleDesc = isStaffChat ? 'Чат штаба (Р4/Р5)' : (msg.chat?.type === 'private' ? 'Личный диалог' : 'Групповой чат');
        await telegram.sendTelegramMessage({
          token,
          chatId,
          text: `🏓 <b>KoW Tracker Bot онлайн!</b>\n• Статус: 🟢 Активен (Long Polling)\n• Чат ID: <code>${chatId}</code>\n• Тип: ${roleDesc}`
        });
      }
      return { ok: true, command: 'ping', chatId };
    }

    // D) /start or /help (without bind token)
    if (/^\/(?:start|help)(?:@\w+)?(?:\s|$)/i.test(text)) {
      if (token && msg.chat?.type === 'private') {
        const fromId = msg.from?.id;
        const user = fromId ? resolveTelegramUser(fromId, msg.from?.username) : null;
        if (user) {
          const isStaff = user && (user.rank === 'r4' || user.rank === 'r5');
          const webAppUrl = db.getAppSetting('telegram_webapp_url') || db.getAppSetting('app_base_url') || null;
          const keyboard = tgFmt.getTelegramMainMenuKeyboard({ isStaff, webAppUrl });
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: `👋 <b>Здравствуйте, ${user.username}! Я официальный Telegram-бот KoW Tracker.</b>\n` +
                  `✅ Ваш аккаунт KoW Tracker подключен.\n\n` +
                  '📱 <b>Команды бойца:</b>\n' +
                  '• <code>/me</code> — профиль, склад и прогресс офицера\n' +
                  '• <code>/deficit</code> — расчет дефицита до максимума прокачки\n' +
                  '• <code>/events</code> — ваши места и ближайшие события альянса\n' +
                  '• <code>/stock &lt;купоны&gt; &lt;пазлы&gt;</code> — быстрое обновление склада\n' +
                  '• <code>/menu</code> — интерактивное меню кнопок\n\n' +
                  '📦 <b>Скриншоты склада:</b>\n' +
                  'Просто отправьте фото инвентаря для сохранения в журнале аудита.' +
                  (isStaff ? '\n\n🛡️ <b>Подключение чата штаба:</b>\n<code>/connect_staff &lt;PIN&gt;</code>' : ''),
            replyMarkup: keyboard
          });
          return { ok: true, command: 'start', userId: user.id, autoMatched: true, chatId };
        }

        const firstName = msg.from?.first_name || 'боец';
        await telegram.sendTelegramMessage({
          token,
          chatId,
          text: `👋 <b>Здравствуйте, ${firstName}! Я официальный Telegram-бот KoW Tracker.</b>\n\n` +
                '⚠️ <b>Ваш Telegram пока не привязан к аккаунту в KoW Tracker.</b>\n\n' +
                '🔗 <b>Как подключить аккаунт:</b>\n' +
                '1️⃣ <b>В Личном кабинете:</b> откройте трекер, перейдите в Личный кабинет и нажмите кнопку <b>«📱 Подключить Telegram»</b>.\n' +
                '2️⃣ <b>Прямо в этом чате:</b> отправьте команду с логином и паролем:\n' +
                '<code>/bind &lt;ваш_логин&gt; &lt;ваш_пароль&gt;</code>\n' +
                '<i>(Бот сразу удалит сообщение с паролем в целях безопасности).</i>'
        });
        return { ok: true, command: 'help', unbound: true, chatId };
      }
      return { ok: true, command: 'help', chatId };
    }

    // D1) /me or /профиль
    if (/^\/(?:me|профиль|profile)(?:@\w+)?(?:\s|$)/i.test(text)) {
      const fromId = msg.from?.id;
      const user = fromId ? resolveTelegramUser(fromId, msg.from?.username) : null;
      if (!user) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '⚠️ <b>Ваш Telegram не привязан к аккаунту в KoW Tracker.</b>\n\n' +
                  'Откройте <b>Личный кабинет</b> в трекере и нажмите кнопку <b>«📱 Подключить Telegram»</b>, ' +
                  'либо отправьте команду:\n<code>/bind &lt;логин&gt; &lt;пароль&gt;</code>'
          });
        }
        return { ok: true, command: 'me', error: 'user_not_bound' };
      }

      const sectors = db.getPlayersByUserId(user.id);
      const player = (user.player_id ? db.getPlayerById(user.player_id) : null) || sectors[0];
      const freshness = player?.stockUpdatedAt ? logic.getStockFreshness(player.stockUpdatedAt) : null;
      const { targetOfficer, targetDeficit, deficitSummary } = getPlayerTargetOfficerDeficit(player);

      const replyText = tgFmt.formatTelegramMeMessage({
        user,
        player,
        freshness,
        targetOfficer,
        targetDeficit,
        deficitSummary
      });

      const keyboard = tgFmt.getTelegramMainMenuKeyboard({ isStaff: user.rank === 'r4' || user.rank === 'r5' });

      if (token) {
        await telegram.sendTelegramMessage({
          token,
          chatId,
          text: replyText,
          replyMarkup: keyboard
        });
      }
      return { ok: true, command: 'me', userId: user.id, playerId: player?.id };
    }

    // D2) /deficit or /дефицит
    if (/^\/(?:deficit|дефицит)(?:@\w+)?(?:\s|$)/i.test(text)) {
      const fromId = msg.from?.id;
      const user = fromId ? resolveTelegramUser(fromId, msg.from?.username) : null;
      if (!user) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '⚠️ <b>Ваш Telegram не привязан к аккаунту в KoW Tracker.</b>\nПривяжите Telegram в Личном кабинете трекера или отправьте боту: <code>/bind &lt;логин&gt; &lt;пароль&gt;</code>'
          });
        }
        return { ok: true, command: 'deficit', error: 'user_not_bound' };
      }

      const sectors = db.getPlayersByUserId(user.id);
      const player = (user.player_id ? db.getPlayerById(user.player_id) : null) || sectors[0];
      const { targetOfficer, targetDeficit, deficitDetails, deficitSummary } = getPlayerTargetOfficerDeficit(player);

      const vip = player?.vip !== undefined ? Number(player.vip) : (user.vip !== undefined ? Number(user.vip) : 10);
      const daily = logic.dailyRewards(vip, Number(player?.confidentiality || 0));
      const dailyCoupons = (daily?.coupons || 0) + ((daily?.puzzles || 0) * 50);
      const isPersonalOnly = Boolean(deficitDetails?.isOnlyPersonalPuzzles || deficitSummary?.isOnlyPersonalPuzzles);
      const daysEstimate = isPersonalOnly ? null : ((targetDeficit > 0 && dailyCoupons > 0) ? Math.ceil(targetDeficit / dailyCoupons) : (targetDeficit === 0 ? 0 : null));

      const replyText = tgFmt.formatTelegramDeficitMessage({
        player,
        targetOfficer: targetOfficer || 'Офицер',
        deficit: deficitDetails,
        dailyRewards: daily,
        daysEstimate
      });

      const keyboard = tgFmt.getTelegramMainMenuKeyboard({ isStaff: user.rank === 'r4' || user.rank === 'r5' });

      if (token) {
        await telegram.sendTelegramMessage({
          token,
          chatId,
          text: replyText,
          replyMarkup: keyboard
        });
      }
      return { ok: true, command: 'deficit', userId: user.id, playerId: player?.id };
    }

    // D3) /events or /ивенты
    if (/^\/(?:events|ивенты|события)(?:@\w+)?(?:\s|$)/i.test(text)) {
      const fromId = msg.from?.id;
      const user = fromId ? resolveTelegramUser(fromId, msg.from?.username) : null;
      if (!user) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '⚠️ <b>Ваш Telegram не привязан к аккаунту в KoW Tracker.</b>\nПривяжите Telegram в Личном кабинете трекера или отправьте боту: <code>/bind &lt;логин&gt; &lt;пароль&gt;</code>'
          });
        }
        return { ok: true, command: 'events', error: 'user_not_bound' };
      }

      const sectors = db.getPlayersByUserId(user.id);
      const player = (user.player_id ? db.getPlayerById(user.player_id) : null) || sectors[0];

      const allEvents = db.getEvents ? db.getEvents() : [];
      const eventTypes = db.getEventTypes ? db.getEventTypes() : [];
      const typesMap = new Map((eventTypes || []).map(t => [t.id, t]));
      const enrichedEvents = (allEvents || []).map(e => {
        const et = typesMap.get(e.typeId);
        return {
          ...e,
          title: et?.name || e.title || `Событие #${e.id}`,
          eventTypeName: et?.name,
          places: et?.places || []
        };
      });

      const nowIso = new Date().toISOString();
      const isPastRequested = /(?:past|прошедш|завершен|старые)/i.test(text);

      let eventsList = [];
      let mode = 'upcoming';

      if (isPastRequested) {
        mode = 'past';
        eventsList = enrichedEvents
          .filter(e => e.dateTo && e.dateTo < nowIso.slice(0, 10))
          .sort((a, b) => (b.dateFrom || '').localeCompare(a.dateFrom || ''));
      } else {
        eventsList = enrichedEvents
          .filter(e => !e.dateTo || e.dateTo >= nowIso.slice(0, 10))
          .sort((a, b) => (a.dateFrom || '').localeCompare(b.dateFrom || ''));
      }

      const replyText = tgFmt.formatTelegramEventsListMessage({
        events: eventsList,
        playerId: player?.id,
        mode
      });

      const keyboard = tgFmt.getTelegramEventsKeyboard
        ? tgFmt.getTelegramEventsKeyboard({ events: eventsList, mode })
        : tgFmt.getTelegramMainMenuKeyboard({ isStaff: user.rank === 'r4' || user.rank === 'r5' });

      if (token) {
        await telegram.sendTelegramMessage({
          token,
          chatId,
          text: replyText,
          replyMarkup: keyboard
        });
      }
      return { ok: true, command: 'events', userId: user.id, playerId: player?.id, mode };
    }

    // D4) /menu
    if (/^\/(?:menu|меню)(?:@\w+)?(?:\s|$)/i.test(text)) {
      const fromId = msg.from?.id;
      const user = fromId ? resolveTelegramUser(fromId, msg.from?.username) : null;
      const isStaff = user && (user.rank === 'r4' || user.rank === 'r5');
      const webAppUrl = db.getAppSetting('telegram_webapp_url') || db.getAppSetting('app_base_url') || null;
      const keyboard = tgFmt.getTelegramMainMenuKeyboard({ isStaff, webAppUrl });

      if (token) {
        await telegram.sendTelegramMessage({
          token,
          chatId,
          text: '📱 <b>Главное меню KoW Tracker:</b>\nВыберите необходимое действие:',
          replyMarkup: keyboard
        });
      }
      return { ok: true, command: 'menu', userId: user?.id };
    }

    // Helper for checking officer access
    function isOfficerOrStaffChat(senderId, currentChatId) {
      const staffChatId = db.getAppSetting('telegram_staff_chat_id');
      if (staffChatId && String(staffChatId) === String(currentChatId)) {
        return true;
      }
      const user = senderId ? resolveTelegramUser(senderId, msg.from?.username) : null;
      if (!user) return false;
      return user.rank === 'r5' || user.rank === 'r4' || logic.hasUserPermission(user, 'view_sectors');
    }

    // D5) /who or /кто
    if (/^\/(?:who|кто|досье)(?:@\w+)?(?:\s+(.*))?$/i.test(text)) {
      const whoMatch = text.match(/^\/(?:who|кто|досье)(?:@\w+)?(?:\s+(.*))?$/i);
      const query = (whoMatch && whoMatch[1] ? whoMatch[1] : '').trim();

      const fromId = msg.from?.id;
      if (!isOfficerOrStaffChat(fromId, chatId)) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '⛔ <b>Доступ запрещен.</b>\nКоманда доступна только офицерам альянса (Р4/Р5) или в чате штаба.'
          });
        }
        return { ok: true, authorized: false, command: 'who' };
      }

      if (!query) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: 'ℹ️ <b>Использование команды:</b> <code>/who &lt;сектор_или_ник&gt;</code>\n<i>Например: <code>/who Sector 1</code></i>'
          });
        }
        return { ok: true, command: 'who', error: 'missing_query' };
      }

      const allPlayers = db.getPlayers ? db.getPlayers() : [];
      const allUsers = db.getUsers ? db.getUsers() : [];
      const lowerQ = query.toLowerCase();

      let targetPlayer = allPlayers.find(p => (p.name || '').toLowerCase() === lowerQ);
      if (!targetPlayer) {
        targetPlayer = allPlayers.find(p => (p.name || '').toLowerCase().includes(lowerQ));
      }
      if (!targetPlayer) {
        const foundUser = allUsers.find(u => (u.username || '').toLowerCase().includes(lowerQ));
        if (foundUser) {
          const sectors = db.getPlayersByUserId(foundUser.id);
          targetPlayer = (foundUser.player_id ? db.getPlayerById(foundUser.player_id) : null) || sectors[0];
        }
      }

      if (!targetPlayer) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: `⚠️ Сектор или игрок по запросу «<b>${logic.escapeHtml(query)}</b>» не найден.`
          });
        }
        return { ok: true, command: 'who', found: false };
      }

      const targetUser = targetPlayer.userId ? db.findUserById(targetPlayer.userId) : null;
      const freshness = targetPlayer.stockUpdatedAt ? logic.getStockFreshness(targetPlayer.stockUpdatedAt) : null;

      const allEvents = db.getEvents ? db.getEvents() : [];
      const recentEvents = [];
      (allEvents || []).forEach(e => {
        const a = (e.assignments || []).find(asgn => Number(asgn.playerId) === Number(targetPlayer.id));
        if (a) {
          recentEvents.push({
            title: e.title || e.name || 'Ивент',
            place: a.place,
            actualPlace: a.actualPlace,
            coupons: a.actualCoupons || a.coupons || 0
          });
        }
      });

      const whoMsg = tgFmt.formatTelegramWhoMessage({
        player: targetPlayer,
        user: targetUser,
        freshness,
        recentEvents
      });

      if (token) {
        await telegram.sendTelegramMessage({ token, chatId, text: whoMsg });
      }
      return { ok: true, command: 'who', found: true, playerId: targetPlayer.id };
    }

    // D6) /stale or /должники
    if (/^\/(?:stale|должники)(?:@\w+)?(?:\s|$)/i.test(text)) {
      const fromId = msg.from?.id;
      if (!isOfficerOrStaffChat(fromId, chatId)) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '⛔ <b>Доступ запрещен.</b>\nКоманда доступна только офицерам альянса (Р4/Р5) или в чате штаба.'
          });
        }
        return { ok: true, authorized: false, command: 'stale' };
      }

      const allPlayers = db.getPlayers ? db.getPlayers() : [];
      const allUsers = db.getUsers ? db.getUsers() : [];
      const usersById = new Map(allUsers.map(u => [u.id, u]));

      const staleList = [];
      allPlayers.forEach(p => {
        const fr = p.stockUpdatedAt ? logic.getStockFreshness(p.stockUpdatedAt) : { status: 'stale', days: 30 };
        if (fr.status === 'stale') {
          const u = p.userId ? usersById.get(p.userId) : null;
          staleList.push({
            name: p.name,
            days: fr.days,
            username: u?.username || null
          });
        }
      });

      staleList.sort((a, b) => b.days - a.days);
      const staleMsg = tgFmt.formatTelegramStaleReport({ stalePlayers: staleList });

      if (token) {
        await telegram.sendTelegramMessage({ token, chatId, text: staleMsg });
      }
      return { ok: true, command: 'stale', count: staleList.length };
    }

    // D7) /ping_stale or /пинг
    if (/^\/(?:ping_stale|пинг)(?:@\w+)?(?:\s|$)/i.test(text)) {
      const fromId = msg.from?.id;
      if (!isOfficerOrStaffChat(fromId, chatId)) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '⛔ <b>Доступ запрещен.</b>\nКоманда доступна только офицерам альянса (Р4/Р5).'
          });
        }
        return { ok: true, authorized: false, command: 'ping_stale' };
      }

      const res = await staleRemindersFn(null, { force: true, forcePersonal: true });
      const sentCount = res ? (res.personalRemindersSent || 0) : 0;
      const totalStale = res ? (res.staleCount || 0) : 0;

      const replyMsg = `📨 <b>Рассылка напоминаний завершена:</b>\n• Найдено устаревших складов: <b>${totalStale}</b>\n• Отправлено персональных сообщений в ЛС: <b>${sentCount}</b>`;

      if (token) {
        await telegram.sendTelegramMessage({ token, chatId, text: replyMsg });
      }
      return { ok: true, command: 'ping_stale', sentCount, totalStale };
    }

    // D8) /digest or /сводка
    if (/^\/(?:digest|дайджест|сводка)(?:@\w+)?(?:\s|$)/i.test(text)) {
      const fromId = msg.from?.id;
      if (!isOfficerOrStaffChat(fromId, chatId)) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '⛔ <b>Доступ запрещен.</b>\nКоманда доступна только офицерам альянса (Р4/Р5) или в чате штаба.'
          });
        }
        return { ok: true, authorized: false, command: 'digest' };
      }

      const allPlayers = db.getPlayers ? db.getPlayers() : [];
      const freshnessStats = { fresh: 0, warning: 0, stale: 0 };
      allPlayers.forEach(p => {
        const fr = p.stockUpdatedAt ? logic.getStockFreshness(p.stockUpdatedAt) : { status: 'stale' };
        freshnessStats[fr.status] = (freshnessStats[fr.status] || 0) + 1;
      });

      const allEvents = db.getEvents ? db.getEvents() : [];
      const nowIso = new Date().toISOString();
      const nextEv = (allEvents || [])
        .filter(e => !e.dateTo || e.dateTo >= nowIso.slice(0, 10))
        .sort((a, b) => (a.dateFrom || '').localeCompare(b.dateFrom || ''))[0] || null;

      let nextEvInfo = null;
      if (nextEv) {
        const regs = db.getRegistrationsByEventId ? db.getRegistrationsByEventId(nextEv.id) : (nextEv.registrations || []);
        nextEvInfo = {
          title: nextEv.title || nextEv.name,
          dateFrom: nextEv.dateFrom,
          assignedCount: (nextEv.assignments || []).length,
          totalPlaces: 5,
          registrationsCount: regs.length
        };
      }

      const pendingUsers = db.getPendingUsers ? db.getPendingUsers() : [];

      const digestMsg = tgFmt.formatTelegramDigestMessage({
        totalSectors: allPlayers.length,
        freshnessStats,
        nextEvent: nextEvInfo,
        pendingUsersCount: pendingUsers.length
      });

      if (token) {
        await telegram.sendTelegramMessage({ token, chatId, text: digestMsg });
      }
      return { ok: true, command: 'digest' };
    }

    // E) /stock or /склад text command
    const stockParsed = tgFmt.parseTelegramStockCommand(text);
    if (stockParsed) {
      const fromId = msg.from?.id;
      const user = fromId ? resolveTelegramUser(fromId, msg.from?.username) : null;
      if (!user) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '⚠️ <b>Ваш Telegram не привязан к аккаунту в KoW Tracker.</b>\nПривяжите ваш Telegram-аккаунт в Личном кабинете трекера или отправьте: <code>/bind &lt;логин&gt; &lt;пароль&gt;</code>'
          });
        }
        return { ok: true, command: 'stock', error: 'user_not_bound' };
      }

      const sectors = db.getPlayersByUserId(user.id);
      const player = (user.player_id ? db.getPlayerById(user.player_id) : null) || sectors[0];
      if (!player) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '⚠️ <b>Сектор не найден.</b>\nУ вашего аккаунта нет активного сектора в KoW Tracker.'
          });
        }
        return { ok: true, command: 'stock', error: 'no_player' };
      }

      const before = player.stock || {};
      const after = {
        ...before,
        ...stockParsed
      };
      const diff = logic.calculateStockDiff(before, after);
      const now = new Date().toISOString();

      db.recordStockHistory({
        playerId: player.id,
        userId: user.id,
        source: 'telegram_command',
        snapshotBefore: before,
        snapshotAfter: after,
        diffSummary: diff.summary,
        screenshotPath: null,
        createdAt: now
      });

      db.updatePlayer(player.id, {
        stock: after,
        stockUpdatedAt: now,
        stockUpdateSource: 'telegram_command',
        recordHistory: false
      });

      if (token) {
        const replyText = tgFmt.formatStockUpdateSuccessMessage(diff, after, {
          sectorName: player.name
        });
        await telegram.sendTelegramMessage({
          token,
          chatId,
          text: replyText
        });
      }

      return { ok: true, command: 'stock', updated: true, playerId: player.id, stock: after };
    }

    // F) Photo or Document screenshot upload
    const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
    const hasDocImage = msg.document && (
      (msg.document.mime_type && msg.document.mime_type.startsWith('image/')) ||
      (msg.document.file_name && /\.(jpe?g|png|webp)$/i.test(msg.document.file_name))
    );

    if (hasPhoto || hasDocImage) {
      const fromId = msg.from?.id;
      const user = fromId ? resolveTelegramUser(fromId, msg.from?.username) : null;
      if (!user) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '⚠️ <b>Ваш Telegram не привязан к аккаунту в KoW Tracker.</b>\nПривяжите Telegram в Личном кабинете или отправьте боту: <code>/bind &lt;логин&gt; &lt;пароль&gt;</code>'
          });
        }
        return { ok: true, photo: true, error: 'user_not_bound' };
      }

      const sectors = db.getPlayersByUserId(user.id);
      const player = (user.player_id ? db.getPlayerById(user.player_id) : null) || sectors[0];
      if (!player) {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: '⚠️ <b>Сектор не найден.</b>\nУ вашего аккаунта нет активного сектора в KoW Tracker.'
          });
        }
        return { ok: true, photo: true, error: 'no_player' };
      }

      // Pick file_id (highest resolution photo or document)
      const fileId = hasPhoto ? msg.photo[msg.photo.length - 1].file_id : msg.document.file_id;

      let screenshotPath = null;
      let downloadedFileBuf = null;
      if (token && fileId) {
        try {
          const fileInfo = await telegram.getTelegramFile(token, fileId);
          if (fileInfo && fileInfo.ok && fileInfo.result?.file_path) {
            const fileBuf = await telegram.downloadTelegramFile(token, fileInfo.result.file_path);
            if (fileBuf && fileBuf.length > 0) {
              downloadedFileBuf = fileBuf;
              const yyyyMm = new Date().toISOString().slice(0, 7);
              const screenshotsDir = path.join(__dirname, '..', 'data', 'screenshots', yyyyMm);
              if (!fs.existsSync(screenshotsDir)) {
                fs.mkdirSync(screenshotsDir, { recursive: true });
              }

              const rawExt = (path.extname(fileInfo.result.file_path) || '').toLowerCase();
              const ext = ['.jpg', '.jpeg', '.png', '.webp'].includes(rawExt) ? rawExt : '.jpg';
              const hash = crypto.createHash('sha256').update(fileBuf).digest('hex').slice(0, 8);
              const filename = `${player.id}_${Date.now()}_${hash}${ext}`;
              const fullPath = path.join(screenshotsDir, filename);
              await fs.promises.writeFile(fullPath, fileBuf);
              screenshotPath = `${yyyyMm}/${filename}`;
            }
          }
        } catch (downloadErr) {
          console.warn('[Telegram] Error downloading photo:', downloadErr.message);
        }
      }

      const caption = (msg.caption || '').trim();
      let photoStockParsed = tgFmt.parseTelegramStockCommand(caption);
      if (!photoStockParsed && caption) {
        photoStockParsed = tgFmt.parseTelegramStockCommand('/stock ' + caption);
      }

      const before = player.stock || {};
      const now = new Date().toISOString();

      if (photoStockParsed) {
        const after = {
          ...before,
          ...photoStockParsed
        };
        const diff = logic.calculateStockDiff(before, after);

        db.recordStockHistory({
          playerId: player.id,
          userId: user.id,
          source: 'telegram_photo',
          snapshotBefore: before,
          snapshotAfter: after,
          diffSummary: diff.summary,
          screenshotPath,
          createdAt: now
        });

        db.updatePlayer(player.id, {
          stock: after,
          stockUpdatedAt: now,
          stockUpdateSource: 'telegram_photo',
          recordHistory: false
        });

        if (token) {
          const replyText = tgFmt.formatStockUpdateSuccessMessage(diff, after, {
            sectorName: player.name
          });
          await telegram.sendTelegramMessage({
            token,
            chatId,
            text: replyText
          });
        }

        return { ok: true, photo: true, updated: true, playerId: player.id, stock: after };
      } else {
        // Try server-side OCR on downloaded screenshot
        let recognizedStock = null;
        if (downloadedFileBuf && downloadedFileBuf.length > 0) {
          recognizedStock = await recognizeStockFn(downloadedFileBuf);
        }

        if (recognizedStock && hasAnyStockValue(recognizedStock)) {
          const recStockFull = {
            coupons: Number(recognizedStock.coupons) || 0,
            puzzles: Number(recognizedStock.puzzles) || 0,
            starCoupons: Number(recognizedStock.starCoupons) || 0,
            legendaryStars1: Number(recognizedStock.legendaryStars1) || 0,
            legendaryStars2: Number(recognizedStock.legendaryStars2) || 0,
            legendaryStars3: Number(recognizedStock.legendaryStars3) || 0,
            chests: recognizedStock.chests !== undefined ? (Number(recognizedStock.chests) || 0) : (before.chests || 0)
          };

          const diff = logic.calculateStockDiff(before, recStockFull);

          const historyRecord = db.recordStockHistory({
            playerId: player.id,
            userId: user.id,
            source: 'telegram_photo',
            snapshotBefore: before,
            snapshotAfter: recStockFull,
            diffSummary: `${diff.summary} (ожидает подтверждения OCR)`,
            screenshotPath,
            createdAt: now
          });

          if (token) {
            const ocrMsg = tgFmt.formatTelegramOcrConfirmationMessage({
              player,
              recognizedStock: recStockFull
            });
            const ocrKb = tgFmt.getTelegramOcrConfirmationKeyboard(historyRecord.id);
            await telegram.sendTelegramMessage({
              token,
              chatId,
              text: ocrMsg,
              replyMarkup: ocrKb
            });
          }

          return {
            ok: true,
            photo: true,
            ocr: true,
            historyId: historyRecord.id,
            recognizedStock: recStockFull,
            playerId: player.id,
            screenshotPath
          };
        } else {
          db.recordStockHistory({
            playerId: player.id,
            userId: user.id,
            source: 'telegram_photo',
            snapshotBefore: before,
            snapshotAfter: before,
            diffSummary: 'Скриншот склада прикреплен',
            screenshotPath,
            createdAt: now
          });

          if (token) {
            const fallbackKb = tgFmt.getTelegramStockFallbackKeyboard();
            await telegram.sendTelegramMessage({
              token,
              chatId,
              text: `📸 <b>Скриншот склада получен и сохранен в журнале аудита!</b>\n` +
                    `👤 Сектор: <b>${logic.escapeHtml(player.name)}</b>\n\n` +
                    `Если данные склада не изменились, подтвердите их актуальность кнопкой ниже.\n` +
                    `Чтобы обновить остатки вручную, отправьте команду:\n` +
                    `<code>/stock &lt;купоны&gt; &lt;пазлы&gt;</code>\n` +
                    `<i>(Например: <code>/stock 15000 350</code>)</i>`,
              replyMarkup: fallbackKb
            });
          }

          return { ok: true, photo: true, updated: false, fallback: true, playerId: player.id, screenshotPath };
        }
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

    // A) Main Menu callbacks
    if (data === 'cmd_me' || data === 'cmd_deficit' || data === 'cmd_events' || data === 'cmd_events_upcoming' || data === 'cmd_events_past' || data === 'cmd_menu' || data === 'cmd_stock_help' || data === 'cmd_digest' || data === 'cmd_stale' || data.startsWith('cmd_ev_view:')) {
      const user = fromId ? resolveTelegramUser(fromId, cq.from?.username) : null;
      if (!user) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Ваш Telegram не привязан к аккаунту в KoW Tracker. Отправьте боту: /bind <логин> <пароль>',
            showAlert: true
          });
        }
        return { ok: true, action: data, error: 'user_not_bound' };
      }

      if (token) {
        await telegram.answerTelegramCallback({ token, callbackQueryId: cqId });
      }

      const sectors = db.getPlayersByUserId(user.id);
      const player = (user.player_id ? db.getPlayerById(user.player_id) : null) || sectors[0];
      const isStaff = user.rank === 'r4' || user.rank === 'r5';
      const webAppUrl = db.getAppSetting('telegram_webapp_url') || db.getAppSetting('app_base_url') || null;
      const keyboard = tgFmt.getTelegramMainMenuKeyboard({ isStaff, webAppUrl });
      const targetChatId = chatMsg?.chat?.id || fromId;

      if (data === 'cmd_menu') {
        if (token) {
          await telegram.sendTelegramMessage({
            token,
            chatId: targetChatId,
            text: '📱 <b>Главное меню KoW Tracker:</b>\nВыберите необходимое действие:',
            replyMarkup: keyboard
          });
        }
        return { ok: true, action: 'cmd_menu', userId: user.id };
      }

      if (data === 'cmd_me') {
        const freshness = player?.stockUpdatedAt ? logic.getStockFreshness(player.stockUpdatedAt) : null;
        const { targetOfficer, targetDeficit, deficitSummary } = getPlayerTargetOfficerDeficit(player);
        const replyText = tgFmt.formatTelegramMeMessage({ user, player, freshness, targetOfficer, targetDeficit, deficitSummary });
        if (token) {
          await telegram.sendTelegramMessage({ token, chatId: targetChatId, text: replyText, replyMarkup: keyboard });
        }
        return { ok: true, action: 'cmd_me', userId: user.id };
      }

      if (data === 'cmd_deficit') {
        const { targetOfficer, targetDeficit, deficitDetails, deficitSummary } = getPlayerTargetOfficerDeficit(player);
        const vip = player?.vip !== undefined ? Number(player.vip) : (user.vip !== undefined ? Number(user.vip) : 10);
        const daily = logic.dailyRewards(vip, Number(player?.confidentiality || 0));
        const dailyCoupons = (daily?.coupons || 0) + ((daily?.puzzles || 0) * 50);
        const isPersonalOnly = Boolean(deficitDetails?.isOnlyPersonalPuzzles || deficitSummary?.isOnlyPersonalPuzzles);
        const daysEstimate = isPersonalOnly ? null : ((targetDeficit > 0 && dailyCoupons > 0) ? Math.ceil(targetDeficit / dailyCoupons) : (targetDeficit === 0 ? 0 : null));
        const replyText = tgFmt.formatTelegramDeficitMessage({ player, targetOfficer: targetOfficer || 'Офицер', deficit: deficitDetails, dailyRewards: daily, daysEstimate });
        if (token) {
          await telegram.sendTelegramMessage({ token, chatId: targetChatId, text: replyText, replyMarkup: keyboard });
        }
        return { ok: true, action: 'cmd_deficit', userId: user.id };
      }

      if (data === 'cmd_events' || data === 'cmd_events_upcoming') {
        const allEvents = db.getEvents ? db.getEvents() : [];
        const eventTypes = db.getEventTypes ? db.getEventTypes() : [];
        const typesMap = new Map((eventTypes || []).map(t => [t.id, t]));
        const enrichedEvents = (allEvents || []).map(e => {
          const et = typesMap.get(e.typeId);
          return {
            ...e,
            title: et?.name || e.title || `Событие #${e.id}`,
            eventTypeName: et?.name,
            places: et?.places || []
          };
        });

        const nowIso = new Date().toISOString();
        const upcomingEvents = enrichedEvents
          .filter(e => !e.dateTo || e.dateTo >= nowIso.slice(0, 10))
          .sort((a, b) => (a.dateFrom || '').localeCompare(b.dateFrom || ''));
        const replyText = tgFmt.formatTelegramEventsListMessage({ events: upcomingEvents, playerId: player?.id, mode: 'upcoming' });
        const eventsMarkup = tgFmt.getTelegramEventsKeyboard
          ? tgFmt.getTelegramEventsKeyboard({ events: upcomingEvents, mode: 'upcoming' })
          : keyboard;
        if (token) {
          await telegram.sendTelegramMessage({ token, chatId: targetChatId, text: replyText, replyMarkup: eventsMarkup });
        }
        return { ok: true, action: data, userId: user.id };
      }

      if (data === 'cmd_events_past') {
        const allEvents = db.getEvents ? db.getEvents() : [];
        const eventTypes = db.getEventTypes ? db.getEventTypes() : [];
        const typesMap = new Map((eventTypes || []).map(t => [t.id, t]));
        const enrichedEvents = (allEvents || []).map(e => {
          const et = typesMap.get(e.typeId);
          return {
            ...e,
            title: et?.name || e.title || `Событие #${e.id}`,
            eventTypeName: et?.name,
            places: et?.places || []
          };
        });

        const nowIso = new Date().toISOString();
        const pastEvents = enrichedEvents
          .filter(e => e.dateTo && e.dateTo < nowIso.slice(0, 10))
          .sort((a, b) => (b.dateFrom || '').localeCompare(a.dateFrom || ''));
        const replyText = tgFmt.formatTelegramEventsListMessage({ events: pastEvents, playerId: player?.id, mode: 'past' });
        const eventsMarkup = tgFmt.getTelegramEventsKeyboard
          ? tgFmt.getTelegramEventsKeyboard({ events: pastEvents, mode: 'past' })
          : keyboard;
        if (token) {
          await telegram.sendTelegramMessage({ token, chatId: targetChatId, text: replyText, replyMarkup: eventsMarkup });
        }
        return { ok: true, action: 'cmd_events_past', userId: user.id };
      }

      if (data.startsWith('cmd_ev_view:')) {
        const eventId = Number(data.split(':')[1]);
        const ev = db.getEventById ? db.getEventById(eventId) : null;
        if (!ev) {
          if (token) {
            await telegram.sendTelegramMessage({ token, chatId: targetChatId, text: '⚠️ Событие не найдено или было удалено.', replyMarkup: keyboard });
          }
          return { ok: true, action: 'cmd_ev_view', error: 'not_found' };
        }
        const et = db.getEventTypeById ? db.getEventTypeById(ev.typeId) : null;
        const reg = player ? (db.getUserRegistration ? db.getUserRegistration(eventId, player.id) : null) : null;
        const assign = (ev.assignments || []).find(a => Number(a.playerId) === Number(player?.id));
        const detailText = tgFmt.formatTelegramEventDetailMessage({ event: ev, eventType: et, registration: reg, assignment: assign });
        const detailKb = tgFmt.formatEventDetailRegistrationKeyboard({ eventId, eventType: et, registration: reg });
        if (token) {
          await telegram.sendTelegramMessage({ token, chatId: targetChatId, text: detailText, replyMarkup: detailKb });
        }
        return { ok: true, action: 'cmd_ev_view', eventId, userId: user.id };
      }

      if (data === 'cmd_stock_help') {
        const stock = player?.stock || {};
        const freshness = (stock.updatedAt || player?.stockUpdatedAt || player?.updatedAt)
          ? logic.getStockFreshness(stock.updatedAt || player.stockUpdatedAt || player.updatedAt)
          : { label: 'нет данных' };
        const couponsStr = (stock.coupons ?? player?.coupons ?? 0).toLocaleString('ru-RU');
        const puzzlesStr = (stock.puzzles ?? player?.puzzles ?? 0).toLocaleString('ru-RU');
        const starCouponsStr = (stock.starCoupons ?? player?.starCoupons ?? 0).toLocaleString('ru-RU');
        let starsLine = '';
        if (stock.legendaryStars1 || stock.legendaryStars2 || stock.legendaryStars3) {
          starsLine = `• Звёзды (I/II/III): <b>${stock.legendaryStars1 || 0} / ${stock.legendaryStars2 || 0} / ${stock.legendaryStars3 || 0}</b> ✨\n`;
        }
        const helpText = `📦 <b>Склад сектора [${logic.escapeHtml(player?.name || '—')}]:</b>\n\n` +
          `• Универсальные купоны: <b>${couponsStr} 🎟️</b>\n` +
          `• Фрагменты офицеров: <b>${puzzlesStr} 🧩</b>\n` +
          `• Звёздные купоны: <b>${starCouponsStr} ⭐</b>\n` +
          starsLine +
          `• Давность обновления: <i>${freshness.label}</i>\n\n` +
          `<b>Как обновить остатки склада:</b>\n` +
          `1. 📷 <b>Скриншот склада:</b> просто отправьте фото инвентаря в этот диалог — бот распознает остатки через OCR.\n` +
          `2. ⚡ <b>Текстовая команда:</b> <code>/stock &lt;купоны&gt; &lt;пазлы&gt;</code> (например: <code>/stock 15k 350</code>).\n` +
          (webAppUrl ? `3. 🚀 <b>В приложении:</b> нажмите кнопку ниже для ввода через Mini App.` : '');

        const stockKb = [];
        if (webAppUrl && /^https:\/\//i.test(webAppUrl)) {
          stockKb.push([{ text: '🚀 Открыть склад в Mini App', web_app: { url: webAppUrl } }]);
        }
        stockKb.push([{ text: '◀️ Главное меню', callback_data: 'cmd_menu' }]);

        if (token) {
          await telegram.sendTelegramMessage({ token, chatId: targetChatId, text: helpText, replyMarkup: { inline_keyboard: stockKb } });
        }
        return { ok: true, action: 'cmd_stock_help', userId: user.id };
      }

      if (data === 'cmd_digest') {
        if (!isStaff) {
          if (token) {
            await telegram.answerTelegramCallback({ token, callbackQueryId: cqId, text: '⛔ Доступ запрещен (только Р4/Р5)', showAlert: true });
          }
          return { ok: true, action: 'cmd_digest', authorized: false };
        }
        const allPlayers = db.getPlayers ? db.getPlayers() : [];
        const freshnessStats = { fresh: 0, warning: 0, stale: 0 };
        allPlayers.forEach(p => {
          const fr = p.stockUpdatedAt ? logic.getStockFreshness(p.stockUpdatedAt) : { status: 'stale' };
          freshnessStats[fr.status] = (freshnessStats[fr.status] || 0) + 1;
        });
        const allEvents = db.getEvents ? db.getEvents() : [];
        const eventTypes = db.getEventTypes ? db.getEventTypes() : [];
        const typesMap = new Map((eventTypes || []).map(t => [t.id, t]));
        const nowIso = new Date().toISOString();
        const nextEv = (allEvents || [])
          .filter(e => !e.dateTo || e.dateTo >= nowIso.slice(0, 10))
          .sort((a, b) => (a.dateFrom || '').localeCompare(b.dateFrom || ''))[0] || null;

        let nextEvInfo = null;
        if (nextEv) {
          const et = typesMap.get(nextEv.typeId);
          const regs = db.getRegistrationsByEventId ? db.getRegistrationsByEventId(nextEv.id) : (nextEv.registrations || []);
          nextEvInfo = {
            title: et?.name || nextEv.title || nextEv.name,
            dateFrom: nextEv.dateFrom,
            assignedCount: (nextEv.assignments || []).length,
            totalPlaces: (et?.places || []).length || 5,
            registrationsCount: regs.length
          };
        }
        const pendingUsers = db.getPendingUsers ? db.getPendingUsers() : [];
        const digestMsg = tgFmt.formatTelegramDigestMessage({
          totalSectors: allPlayers.length,
          freshnessStats,
          nextEvent: nextEvInfo,
          pendingUsersCount: pendingUsers.length
        });
        if (token) {
          await telegram.sendTelegramMessage({ token, chatId: targetChatId, text: digestMsg, replyMarkup: keyboard });
        }
        return { ok: true, action: 'cmd_digest', userId: user.id };
      }

      if (data === 'cmd_stale') {
        if (!isStaff) {
          if (token) {
            await telegram.answerTelegramCallback({ token, callbackQueryId: cqId, text: '⛔ Доступ запрещен (только Р4/Р5)', showAlert: true });
          }
          return { ok: true, action: 'cmd_stale', authorized: false };
        }
        const allPlayers = db.getPlayers ? db.getPlayers() : [];
        const allUsers = db.getUsers ? db.getUsers() : [];
        const usersById = new Map(allUsers.map(u => [u.id, u]));

        const staleList = [];
        allPlayers.forEach(p => {
          const fr = p.stockUpdatedAt ? logic.getStockFreshness(p.stockUpdatedAt) : { status: 'stale', days: 30 };
          if (fr.status === 'stale') {
            const u = p.userId ? usersById.get(p.userId) : null;
            staleList.push({ name: p.name, days: fr.days, username: u?.username || null });
          }
        });
        staleList.sort((a, b) => b.days - a.days);
        const staleMsg = tgFmt.formatTelegramStaleReport({ stalePlayers: staleList });
        if (token) {
          await telegram.sendTelegramMessage({ token, chatId: targetChatId, text: staleMsg, replyMarkup: keyboard });
        }
        return { ok: true, action: 'cmd_stale', userId: user.id };
      }
    }

    const approveMatch = data.match(/^approve_user:(\d+)$/);
    const rejectMatch = data.match(/^reject_user:(\d+)$/);

    if (approveMatch || rejectMatch) {
      const targetUserId = Number((approveMatch || rejectMatch)[1]);
      const isApprove = Boolean(approveMatch);

      const officer = resolveTelegramUser(fromId, cq.from?.username);
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
        return { ok: true, authorized: false };
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
        return { ok: true, action: 'approved', userId: targetUserId };
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
        return { ok: true, action: 'rejected', userId: targetUserId };
      }
    }

    const regMatch = data.match(/^reg_event:(\d+):(\d+)$/);
    if (regMatch) {
      const eventId = Number(regMatch[1]);
      const desiredPlace = Number(regMatch[2]);

      const user = fromId ? resolveTelegramUser(fromId, cq.from?.username) : null;
      if (!user) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Ваш Telegram не привязан к аккаунту в KoW Tracker.',
            showAlert: true
          });
        }
        return { ok: true, action: 'reg_event', error: 'user_not_bound' };
      }

      const sectors = db.getPlayersByUserId(user.id);
      const player = (user.player_id ? db.getPlayerById(user.player_id) : null) || sectors[0];
      if (!player) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ У вас нет активного сектора в KoW Tracker.',
            showAlert: true
          });
        }
        return { ok: true, action: 'reg_event', error: 'no_player' };
      }

      const ev = db.getEventById(eventId);
      if (!ev) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Событие не найдено или удалено.',
            showAlert: true
          });
        }
        return { ok: true, action: 'reg_event', error: 'event_not_found' };
      }

      const pOfficers = Array.isArray(player.officers) ? player.officers : [];
      const catalog = db.getCatalog ? db.getCatalog() : [];
      let officer = null;
      let officerId = '';
      let optimal = null;
      if (typeof logic.selectOptimalEventOfficer === 'function') {
        optimal = logic.selectOptimalEventOfficer({ player, catalog, eventDate: ev.dateFrom });
        officer = optimal.officer || null;
        officerId = optimal.officerId || '';
      } else {
        const eligibleOfficers = typeof logic.getEventEligibleOfficers === 'function'
          ? logic.getEventEligibleOfficers(pOfficers, catalog)
          : pOfficers.filter(o => !Boolean(o.onlyPersonalPuzzles || o.only_personal_puzzles));
        officer = eligibleOfficers[0] || null;
        officerId = (officer ? (officer.catalogId || officer.id) : '') || '';
      }

      if (eventOps && typeof eventOps.registerForEvent === 'function') {
        const regRes = await eventOps.registerForEvent({
          eventId,
          playerId: player.id,
          officerId,
          desiredPlace,
          user
        });
        if (!regRes.ok) {
          if (token) {
            await telegram.answerTelegramCallback({
              token,
              callbackQueryId: cqId,
              text: regRes.message || 'Ошибка регистрации на событие',
              showAlert: true
            });
          }
          return { ok: true, action: 'reg_event', error: regRes.error };
        }
      } else {
        const existingRegistrations = typeof db.getRegistrationsByEventId === 'function'
          ? db.getRegistrationsByEventId(Number(eventId))
          : (typeof db.getRegistrationsForEvent === 'function' ? db.getRegistrationsForEvent(Number(eventId)) : []);
        const prevReg = (existingRegistrations || []).find(r => Number(r.playerId) === Number(player.id));
        const targetDesiredPlace = Number(desiredPlace) || 0;
        const targetOfficerId = String(officerId || '');
        const isUnchanged = prevReg &&
          Number(prevReg.desiredPlace || 0) === targetDesiredPlace &&
          String(prevReg.officerId || '') === targetOfficerId;

        db.registerForEvent({
          eventId,
          playerId: player.id,
          officerId: targetOfficerId,
          desiredPlace: targetDesiredPlace
        });

        if (!isUnchanged && typeof dispatchNotificationFn === 'function') {
          try {
            const et = db.getEventTypeById ? db.getEventTypeById(ev.typeId) : null;
            const placeStr = targetDesiredPlace > 0 ? `#${targetDesiredPlace}` : 'Любое';
            const baseUrl = resolveBaseUrl();
            dispatchNotificationFn('staff_event_registration', {
              eventId,
              playerId: player.id,
              eventName: et?.name || `Событие #${eventId}`,
              sectorName: player.name || `Сектор #${player.id}`,
              desiredPlace: placeStr,
              link: `${baseUrl}/#event/${eventId}`
            }).catch(err => {
              console.warn('[Notification] Error dispatching staff_event_registration from bot callback:', err.message);
            });
          } catch (_) {}
        }
      }

      if (token) {
        const placeStr = desiredPlace > 0 ? `#${desiredPlace}` : 'любое подходящее';
        let alertMsg = `✅ Заявка принята! Желаемое место: ${placeStr}`;
        if (optimal && optimal.officer) {
          const offName = optimal.officer.name || 'Офицер';
          if (optimal.isAllMaxed) {
            alertMsg += ` · Офицер: ${offName} (все прокачаны!)`;
          } else {
            alertMsg += ` · Офицер: ${offName}`;
          }
        }
        await telegram.answerTelegramCallback({
          token,
          callbackQueryId: cqId,
          text: alertMsg
        });

        if (chatMsg?.chat?.id && chatMsg?.message_id) {
          const et = db.getEventTypeById ? db.getEventTypeById(ev.typeId) : null;
          const reg = db.getUserRegistration ? db.getUserRegistration(eventId, player.id) : null;
          const assign = (ev.assignments || []).find(a => Number(a.playerId) === Number(player?.id));
          const updatedText = tgFmt.formatTelegramEventDetailMessage({ event: ev, eventType: et, registration: reg, assignment: assign });
          const updatedKb = tgFmt.formatEventDetailRegistrationKeyboard({ eventId, eventType: et, registration: reg });
          await telegram.editTelegramMessageText({
            token,
            chatId: chatMsg.chat.id,
            messageId: chatMsg.message_id,
            text: updatedText,
            replyMarkup: updatedKb
          }).catch(() => {});
        }
      }

      return { ok: true, action: 'registered', eventId, desiredPlace, playerId: player.id };
    }

    const unregMatch = data.match(/^unreg_event:(\d+)$/);
    if (unregMatch) {
      const eventId = Number(unregMatch[1]);
      const user = fromId ? resolveTelegramUser(fromId, cq.from?.username) : null;
      if (!user) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Ваш Telegram не привязан к аккаунту в KoW Tracker.',
            showAlert: true
          });
        }
        return { ok: true, action: 'unreg_event', error: 'user_not_bound' };
      }

      const sectors = db.getPlayersByUserId(user.id);
      const player = (user.player_id ? db.getPlayerById(user.player_id) : null) || sectors[0];
      const ev = db.getEventById(eventId);
      if (!ev) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Событие не найдено.',
            showAlert: true
          });
        }
        return { ok: true, action: 'unreg_event', error: 'event_not_found' };
      }

      if (player) {
        if (eventOps && typeof eventOps.unregisterFromEvent === 'function') {
          const unregRes = await eventOps.unregisterFromEvent({
            eventId,
            playerId: player.id,
            user
          });
          if (!unregRes.ok) {
            if (token) {
              await telegram.answerTelegramCallback({
                token,
                callbackQueryId: cqId,
                text: unregRes.message || 'Ошибка отмены регистрации',
                showAlert: true
              });
            }
            return { ok: true, action: 'unreg_event', error: unregRes.error };
          }
        } else {
          db.unregisterFromEvent(eventId, player.id);
        }
      }

      if (token) {
        await telegram.answerTelegramCallback({
          token,
          callbackQueryId: cqId,
          text: '❌ Ваша заявка отозвана.'
        });

        if (chatMsg?.chat?.id && chatMsg?.message_id) {
          const et = db.getEventTypeById ? db.getEventTypeById(ev.typeId) : null;
          const assign = (ev.assignments || []).find(a => Number(a.playerId) === Number(player?.id));
          const updatedText = tgFmt.formatTelegramEventDetailMessage({ event: ev, eventType: et, registration: null, assignment: assign });
          const updatedKb = tgFmt.formatEventDetailRegistrationKeyboard({ eventId, eventType: et, registration: null });
          await telegram.editTelegramMessageText({
            token,
            chatId: chatMsg.chat.id,
            messageId: chatMsg.message_id,
            text: updatedText,
            replyMarkup: updatedKb
          }).catch(() => {});
        }
      }

      return { ok: true, action: 'unregistered', eventId, playerId: player?.id };
    }

    const rsvpMatch = data.match(/^rsvp_event:(confirm|decline):(\d+):(\d+)$/);
    if (rsvpMatch) {
      const action = rsvpMatch[1];
      const eventId = Number(rsvpMatch[2]);
      const placeNum = Number(rsvpMatch[3]);

      const user = resolveTelegramUser(fromId, cq.from?.username);
      if (!user) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Ваш Telegram не привязан к аккаунту в KoW Tracker.',
            showAlert: true
          });
        }
        return { ok: true, error: 'user_not_bound' };
      }

      const ev = db.getEventById(eventId);
      if (!ev) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Событие не найдено или удалено.',
            showAlert: true
          });
        }
        return { ok: true, error: 'event_not_found' };
      }

      const assignment = (ev.assignments || []).find(a => Number(a.place) === placeNum);
      if (!assignment) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Назначение на это место не найдено.',
            showAlert: true
          });
        }
        return { ok: true, error: 'assignment_not_found' };
      }

      const player = db.getPlayerById(assignment.playerId);
      const isOwner = player && player.userId === user.id;
      const isStaff = user.rank === 'r4' || user.rank === 'r5';

      if (!isOwner && !isStaff) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⛔ Вы не назначены на это призовое место.',
            showAlert: true
          });
        }
        return { ok: true, error: 'unauthorized_assignment' };
      }

      const isConfirm = action === 'confirm';
      if (eventOps && typeof eventOps.rsvpEvent === 'function') {
        const rsvpRes = await eventOps.rsvpEvent({
          eventId,
          place: placeNum,
          status: isConfirm ? 'confirmed' : 'declined',
          user
        });
        if (!rsvpRes.ok) {
          if (token) {
            await telegram.answerTelegramCallback({
              token,
              callbackQueryId: cqId,
              text: rsvpRes.message || 'Ошибка RSVP',
              showAlert: true
            });
          }
          return { ok: true, error: rsvpRes.error };
        }
      } else {
        assignment.rsvpStatus = isConfirm ? 'confirmed' : 'declined';
        assignment.rsvpAt = new Date().toISOString();
        db.saveEvent(ev);
      }

      if (token) {
        await telegram.answerTelegramCallback({
          token,
          callbackQueryId: cqId,
          text: isConfirm ? '✅ Участие подтверждено!' : '❌ Вы отказались от участия. Место освобождено.'
        });

        if (chatMsg?.chat?.id && chatMsg?.message_id) {
          const statusText = isConfirm
            ? '\n\n<b>Статус: ✅ Участие подтверждено</b>'
            : '\n\n<b>Статус: ❌ Отказ от участия (место освобождено)</b>';
          const originalText = chatMsg.text || '';
          await telegram.editTelegramMessageText({
            token,
            chatId: chatMsg.chat.id,
            messageId: chatMsg.message_id,
            text: originalText + statusText,
            replyMarkup: { inline_keyboard: [] }
          }).catch(() => {});
        }
      }

      if (!isConfirm) {
        const et = db.getEventTypes().find(t => t.id === ev.typeId);
        let staffChatId = db.getAppSetting('telegram_staff_chat_id');
        if (staffChatId && token) {
          if (!isNaN(Number(staffChatId))) staffChatId = Number(staffChatId);
          const staffAlertText = `⚠️ <b>Отказ от участия в событии!</b>\n\nБоец: <b>@${user.username || 'боец'}</b>\nСектор: <b>${player?.name || 'Сектор'}</b>\nСобытие: <b>${et?.name || 'Событие'}</b>\nОсвобождено место: <b>#${placeNum}</b>\n\n<i>Место свободно для повторного распределения или резервиста!</i>`;
          await telegram.sendTelegramMessage({
            token,
            chatId: staffChatId,
            text: staffAlertText,
            parseMode: 'HTML'
          }).catch(() => {});
        }
      }

      return { ok: true, action: isConfirm ? 'confirmed' : 'declined', eventId, place: placeNum };
    }

    const resultMatch = data.match(/^event_result:submit:(\d+):(\d+)$/);
    if (resultMatch) {
      const eventId = Number(resultMatch[1]);
      const actualPlace = Number(resultMatch[2]);

      const user = resolveTelegramUser(fromId, cq.from?.username);
      if (!user) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Ваш Telegram не привязан к аккаунту в KoW Tracker.',
            showAlert: true
          });
        }
        return { ok: true, error: 'user_not_bound' };
      }

      if (eventOps && typeof eventOps.submitEventResult === 'function') {
        const subRes = await eventOps.submitEventResult({
          eventId,
          actualPlace,
          user,
          submittedBy: 'telegram'
        });
        if (!subRes.ok) {
          if (token) {
            await telegram.answerTelegramCallback({
              token,
              callbackQueryId: cqId,
              text: subRes.message || 'Ошибка фиксации результата',
              showAlert: true
            });
          }
          return { ok: true, error: subRes.error };
        }
        const prizeCoupons = subRes.prizeCoupons || 0;
        if (token) {
          const callbackMsg = actualPlace > 0
            ? `✅ Место #${actualPlace} зафиксировано! Начислено +${prizeCoupons} купонов на склад 🎟️`
            : `✅ Результат зафиксирован (без наград).`;
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: callbackMsg
          });

          if (chatMsg?.chat?.id && chatMsg?.message_id) {
            const appendMsg = actualPlace > 0
              ? `\n\n<b>Результат: место #${actualPlace} (+${prizeCoupons} купонов начислено на склад 🎟️)</b>`
              : `\n\n<b>Результат: не участвовал</b>`;
            await telegram.editTelegramMessageText({
              token,
              chatId: chatMsg.chat.id,
              messageId: chatMsg.message_id,
              text: (chatMsg.text || '') + appendMsg,
              replyMarkup: { inline_keyboard: [] }
            }).catch(() => {});
          }
        }
        return { ok: true, action: 'result_submitted', eventId, actualPlace, prizeCoupons };
      }

      const ev = db.getEventById(eventId);
      if (!ev) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Событие не найдено.',
            showAlert: true
          });
        }
        return { ok: true, error: 'event_not_found' };
      }

      const assignment = (ev.assignments || []).find(a => {
        const p = db.getPlayerById(a.playerId);
        return p && p.userId === user.id;
      });

      if (!assignment) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⛔ Вы не являетесь участником этого события.',
            showAlert: true
          });
        }
        return { ok: true, error: 'not_participant' };
      }

      if (assignment.accrued) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: 'ℹ️ Результат и награды уже зафиксированы ранее.',
            showAlert: true
          });
        }
        return { ok: true, error: 'already_accrued' };
      }

      const player = db.getPlayerById(assignment.playerId);
      const et = db.getEventTypes().find(t => t.id === ev.typeId);
      const places = et ? (typeof logic.resolveEventPlaces === 'function' ? logic.resolveEventPlaces(et, ev.dateFrom) : et.places) : [];
      const placeInfo = actualPlace > 0 ? places.find(p => Number(p.place) === actualPlace) : null;
      const prizeCoupons = placeInfo ? (Number(placeInfo.coupons) || 0) : 0;

      assignment.actualPlace = actualPlace;
      assignment.actualCoupons = prizeCoupons;
      assignment.resultStatus = 'confirmed';
      assignment.accrued = true;
      assignment.resultSubmittedAt = new Date().toISOString();
      assignment.submittedBy = 'telegram';

      if (player && prizeCoupons > 0) {
        const curStock = player.stock || {};
        const oldCoupons = Number(curStock.coupons) || 0;
        const newStock = { ...curStock, coupons: oldCoupons + prizeCoupons };
        db.updatePlayer(player.id, { stock: newStock });
        db.recordStockHistory({
          playerId: player.id,
          userId: user.id,
          source: 'event_reward',
          snapshotBefore: curStock,
          snapshotAfter: newStock,
          diffSummary: `Награда за событие ${et?.name || 'ивент'}: +${prizeCoupons} купонов (место #${actualPlace})`,
          screenshotPath: null,
          createdAt: new Date().toISOString()
        });
      }

      db.saveEvent(ev);

      if (token) {
        const callbackMsg = actualPlace > 0
          ? `✅ Место #${actualPlace} зафиксировано! Начислено +${prizeCoupons} купонов на склад 🎟️`
          : `✅ Результат зафиксирован (без наград).`;
        await telegram.answerTelegramCallback({
          token,
          callbackQueryId: cqId,
          text: callbackMsg
        });

        if (chatMsg?.chat?.id && chatMsg?.message_id) {
          const appendMsg = actualPlace > 0
            ? `\n\n<b>Результат: место #${actualPlace} (+${prizeCoupons} купонов начислено на склад 🎟️)</b>`
            : `\n\n<b>Результат: не участвовал</b>`;
          await telegram.editTelegramMessageText({
            token,
            chatId: chatMsg.chat.id,
            messageId: chatMsg.message_id,
            text: (chatMsg.text || '') + appendMsg,
            replyMarkup: { inline_keyboard: [] }
          }).catch(() => {});
        }
      }

      return { ok: true, action: 'result_submitted', eventId, actualPlace, prizeCoupons };
    }

    const confirmOcrMatch = data.match(/^confirm_ocr_stock:(\d+)$/);
    if (confirmOcrMatch) {
      const historyId = Number(confirmOcrMatch[1]);
      const user = fromId ? resolveTelegramUser(fromId, cq.from?.username) : null;
      if (!user) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Ваш Telegram не привязан к аккаунту в KoW Tracker.',
            showAlert: true
          });
        }
        return { ok: true, action: 'confirm_ocr_stock', error: 'user_not_bound' };
      }

      const rec = db.getStockHistoryRecordById(historyId);
      if (!rec) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Запись распознавания не найдена или устарела.',
            showAlert: true
          });
        }
        return { ok: true, action: 'confirm_ocr_stock', error: 'record_not_found' };
      }

      const isStaff = user.rank === 'r5' || user.rank === 'r4';
      if (rec.userId !== user.id && !isStaff) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⛔ Вы можете подтверждать остатки только для своего сектора.',
            showAlert: true
          });
        }
        return { ok: true, action: 'confirm_ocr_stock', error: 'forbidden' };
      }

      const player = db.getPlayerById(rec.playerId);
      if (!player) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Сектор не найден.',
            showAlert: true
          });
        }
        return { ok: true, action: 'confirm_ocr_stock', error: 'player_not_found' };
      }

      const now = new Date().toISOString();
      const diff = logic.calculateStockDiff(rec.snapshotBefore, rec.snapshotAfter);

      db.updatePlayer(player.id, {
        stock: rec.snapshotAfter,
        stockUpdatedAt: now,
        stockUpdateSource: 'telegram_photo',
        recordHistory: false
      });

      db.updateStockHistoryRecord(rec.id, {
        diffSummary: `${diff.summary} (подтверждено по OCR)`
      });

      if (token) {
        await telegram.answerTelegramCallback({
          token,
          callbackQueryId: cqId,
          text: '✅ Изменения склада успешно применены!'
        });

        if (chatMsg?.chat?.id && chatMsg?.message_id) {
          const successMsg = tgFmt.formatStockUpdateSuccessMessage(diff, rec.snapshotAfter, {
            sectorName: player.name
          });
          await telegram.editTelegramMessageText({
            token,
            chatId: chatMsg.chat.id,
            messageId: chatMsg.message_id,
            text: successMsg,
            replyMarkup: { inline_keyboard: [] }
          }).catch(() => {});
        }
      }

      return { ok: true, action: 'confirm_ocr_stock', historyId, playerId: player.id, stock: rec.snapshotAfter };
    }

    if (data === 'confirm_current_stock') {
      const user = fromId ? resolveTelegramUser(fromId, cq.from?.username) : null;
      if (!user) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Ваш Telegram не привязан к аккаунту в KoW Tracker.',
            showAlert: true
          });
        }
        return { ok: true, action: 'confirm_current_stock', error: 'user_not_bound' };
      }

      const sectors = db.getPlayersByUserId(user.id);
      const player = (user.player_id ? db.getPlayerById(user.player_id) : null) || sectors[0];
      if (!player) {
        if (token) {
          await telegram.answerTelegramCallback({
            token,
            callbackQueryId: cqId,
            text: '⚠️ Сектор не найден.',
            showAlert: true
          });
        }
        return { ok: true, action: 'confirm_current_stock', error: 'no_player' };
      }

      db.confirmPlayerStock(player.id, user.id, 'manual_confirm');

      if (token) {
        await telegram.answerTelegramCallback({
          token,
          callbackQueryId: cqId,
          text: '✅ Склад подтвержден как актуальный!'
        });

        if (chatMsg?.chat?.id && chatMsg?.message_id) {
          const nowFormatted = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
          const confirmedText = `✅ <b>Склад подтвержден как актуальный!</b>\n` +
            `👤 Сектор: <b>${logic.escapeHtml(player.name)}</b>\n` +
            `📅 Дата актуальности: <b>${nowFormatted}</b>\n\n` +
            `<i>Остатки в базе данных не изменялись, таймер устаревания сброшен.</i>`;

          await telegram.editTelegramMessageText({
            token,
            chatId: chatMsg.chat.id,
            messageId: chatMsg.message_id,
            text: confirmedText,
            replyMarkup: { inline_keyboard: [] }
          }).catch(() => {});
        }
      }

      return { ok: true, action: 'confirm_current_stock', playerId: player.id };
    }
  }

  return { ok: true };
}

  return {
    handleUpdate: handleTelegramUpdate,
    resolveTelegramUser,
    getPlayerTargetOfficerDeficit
  };
}

module.exports = {
  createTelegramBotController
};
