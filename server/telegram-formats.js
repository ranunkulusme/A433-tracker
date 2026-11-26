/**
 * KoW Tracker - Server Telegram Message & Keyboard Formatters
 *
 * Extracted from shared/logic.js so server-only HTML messages, keyboards,
 * and /stock command parsers are not bundled into browser code.
 */
const { escapeHtml, formatInputNumber } = require('../shared/logic.js');

function parseTelegramStockCommand(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  const cmdMatch = trimmed.match(/^\/(?:stock|склад)(?:@\w+)?(?:\s+(.*))?$/i);
  if (!cmdMatch) return null;

  const argsStr = cmdMatch[1];
  if (!argsStr || !argsStr.trim()) return null;

  const normalizedArgs = argsStr.replace(/\b(\d{1,3})\s+(000)\b/g, '$1$2').trim();
  const tokens = normalizedArgs.split(/[\s,]+/).filter(Boolean);
  if (!tokens.length) return null;

  const numbers = [];
  for (const token of tokens) {
    let val = null;
    const lower = token.toLowerCase();
    if (/^\d+k$/i.test(lower)) val = parseInt(lower, 10) * 1000;
    else if (/^\d+m$/i.test(lower)) val = parseInt(lower, 10) * 1000000;
    else if (/^\d+$/.test(token)) val = parseInt(token, 10);
    if (val === null || isNaN(val) || val < 0) return null;
    numbers.push(val);
  }
  if (!numbers.length) return null;

  const result = {
    coupons: numbers[0],
    puzzles: numbers.length > 1 ? numbers[1] : 0
  };
  if (numbers.length > 2) result.starCoupons = numbers[2];
  if (numbers.length > 3) result.legendaryStars1 = numbers[3];
  if (numbers.length > 4) result.legendaryStars2 = numbers[4];
  if (numbers.length > 5) result.legendaryStars3 = numbers[5];
  return result;
}

function formatStockUpdateSuccessMessage(diff, newStock, options = {}) {
  const parts = [];
  parts.push('✅ <b>Склад успешно обновлен!</b>');

  const sectorName = typeof options === 'string' ? options : (options && options.sectorName);
  if (sectorName) parts.push(`👤 Сектор: <b>${escapeHtml(sectorName)}</b>`);

  parts.push('\n📦 <b>Текущие запасы:</b>');
  const coupons = newStock ? (newStock.coupons || 0) : 0;
  parts.push(`• Купоны: <b>${formatInputNumber(coupons)}</b>`);

  if (newStock && newStock.puzzles !== undefined) {
    parts.push(`• Пазлы: <b>${formatInputNumber(newStock.puzzles)}</b>`);
  }
  if (newStock && newStock.starCoupons) {
    parts.push(`• Звездные купоны: <b>${formatInputNumber(newStock.starCoupons)}</b>`);
  }
  if (newStock && (newStock.legendaryStars1 || newStock.legendaryStars2 || newStock.legendaryStars3)) {
    const stars = [
      newStock.legendaryStars1 || 0,
      newStock.legendaryStars2 || 0,
      newStock.legendaryStars3 || 0
    ].join(' / ');
    parts.push(`• Звезды (I/II/III): <b>${stars}</b>`);
  }

  if (diff && diff.summary && diff.summary !== 'Без изменений') {
    parts.push(`\n📊 <b>Изменения:</b> ${escapeHtml(diff.summary)}`);
  }

  const targetDeficit = typeof options === 'number' ? options : (options && options.targetDeficit);
  const targetOfficer = options && options.targetOfficer;
  if (targetOfficer && targetDeficit !== undefined) {
    if (targetDeficit <= 0) {
      parts.push(`\n🎉 <b>${escapeHtml(targetOfficer)}</b>: дефицит закрыт! Готов к максимальной прокачке.`);
    } else {
      parts.push(`\n🎯 <b>${escapeHtml(targetOfficer)}</b>: осталось собрать <b>${formatInputNumber(targetDeficit)}</b> купонов.`);
    }
  }
  return parts.join('\n');
}

function formatTelegramMeMessage({ user, player, freshness, targetOfficer, targetDeficit, deficitSummary }) {
  const parts = [];
  const rankMap = { r5: 'Р5', r4: 'Р4', r3: 'Р3', r2: 'Р2', r1: 'Р1' };
  const rankLabel = rankMap[(user?.rank || '').toLowerCase()] || (user?.rank || 'Р3').toUpperCase();
  const sectorName = player?.name || user?.username || 'Сектор';
  parts.push(`👤 <b>Ваш профиль:</b> <b>${escapeHtml(sectorName)}</b> [${rankLabel}]`);

  const power = player?.sector?.power ?? player?.power ?? 0;
  const vip = player?.sector?.vipLevel !== undefined ? player.sector.vipLevel : (player?.vip !== undefined ? player.vip : (user?.vip !== undefined ? user.vip : '—'));
  parts.push(`📊 Сила: <b>${formatInputNumber(power)}</b> | VIP: <b>${vip}</b>`);

  parts.push('\n📦 <b>Запасы склада:</b>');
  const stock = player?.stock || {};
  parts.push(`• Купоны: <b>${formatInputNumber(stock.coupons || 0)}</b> 🎟️`);
  parts.push(`• Пазлы: <b>${formatInputNumber(stock.puzzles || 0)}</b> 🧩`);
  if (stock.starCoupons) {
    parts.push(`• Звездные купоны: <b>${formatInputNumber(stock.starCoupons)}</b> ⭐`);
  }
  if (stock.legendaryStars1 || stock.legendaryStars2 || stock.legendaryStars3) {
    const stars = [stock.legendaryStars1 || 0, stock.legendaryStars2 || 0, stock.legendaryStars3 || 0].join(' / ');
    parts.push(`• Звезды (I/II/III): <b>${stars}</b> ✨`);
  }

  if (freshness) {
    const badgeIcon = freshness.status === 'fresh' ? '🟢' : (freshness.status === 'warning' ? '🟡' : '🔴');
    parts.push(`• Актуальность: ${badgeIcon} ${freshness.label || (freshness.days + ' дн. назад')}`);
  }

  if (targetOfficer) {
    const offName = typeof targetOfficer === 'string' ? targetOfficer : targetOfficer.name;
    parts.push(`\n🎯 <b>Целевой офицер:</b> <b>${escapeHtml(offName)}</b>`);
    const isMaxed = Boolean(targetOfficer?.isMaxed) || (Array.isArray(targetOfficer?.skills) && targetOfficer.skills.length >= 4 && targetOfficer.skills.every(s => Number(s) >= 5));
    if (deficitSummary) {
      if (deficitSummary.isFull || isMaxed) {
        parts.push('• Дефицит: <b>0</b> (готов к максимальной прокачке! 🎉)');
      } else {
        parts.push(`• Остаточный дефицит: <b>${deficitSummary.deficitShort || (formatInputNumber(deficitSummary.deficitValue) + ' ' + deficitSummary.unit)}</b>`);
      }
    } else if (targetDeficit !== undefined && targetDeficit !== null) {
      if (targetDeficit <= 0 || isMaxed) {
        parts.push('• Дефицит: <b>0</b> (готов к максимальной прокачке! 🎉)');
      } else {
        parts.push(`• Остаточный дефицит: <b>${formatInputNumber(targetDeficit)}</b> купонов`);
      }
    }
  }
  return parts.join('\n');
}

function formatTelegramDeficitMessage({ player, targetOfficer, deficit, dailyRewards, daysEstimate }) {
  const parts = [];
  const sectorName = player?.name || 'Сектор';
  const offName = typeof targetOfficer === 'string' ? targetOfficer : (targetOfficer?.name || 'Офицер');
  parts.push(`📊 <b>Расчет дефицита прокачки</b>`);
  parts.push(`👤 Сектор: <b>${escapeHtml(sectorName)}</b>`);
  parts.push(`🎯 Офицер: <b>${escapeHtml(offName)}</b>`);

  if (deficit) {
    parts.push('\n🎯 <b>Необходимо ресурсов:</b>');
    const defPuzzles = deficit.deficitPuzzles ?? deficit.puzzles;
    const defCoupons = deficit.deficitCoupons ?? deficit.coupons;
    const isPersonalOnly = Boolean(deficit.isOnlyPersonalPuzzles || deficit.deficitSummary?.isOnlyPersonalPuzzles);

    if (isPersonalOnly) {
      if (defPuzzles !== undefined && defPuzzles > 0) parts.push(`• Личные пазлы: <b>${formatInputNumber(defPuzzles)}</b> 🧩`);
      parts.push(`• Ресурс прокачки: <b>Личные медали</b> 🧩 (купоны не применимы)`);
    } else {
      if (defCoupons !== undefined) parts.push(`• Купоны: <b>${formatInputNumber(defCoupons)}</b> 🎟️`);
      if (defPuzzles !== undefined && defPuzzles > 0) parts.push(`• Пазлы: <b>${formatInputNumber(defPuzzles)}</b> 🧩`);
    }
    if (deficit.medalsRemaining !== undefined) {
      parts.push(`• Медалей до максимума (5-5-5-5): <b>${deficit.medalsRemaining}</b>`);
    }
  }

  if (dailyRewards && (dailyRewards.coupons || dailyRewards.puzzles)) {
    parts.push('\n👑 <b>Ежедневный доход (VIP):</b>');
    if (dailyRewards.coupons) parts.push(`• +${formatInputNumber(dailyRewards.coupons)} купонов/день`);
    if (dailyRewards.puzzles) parts.push(`• +${dailyRewards.puzzles} пазлов/день`);
  }

  if (daysEstimate !== undefined && daysEstimate !== null) {
    parts.push(`\n⏳ <b>Прогноз завершения:</b> ~<b>${daysEstimate} дн.</b>`);
  } else if (deficit && (deficit.isOnlyPersonalPuzzles || deficit.deficitSummary?.isOnlyPersonalPuzzles)) {
    parts.push(`\n⏳ <b>Прогноз завершения:</b> <i>Зависит от личных наград (ивенты купонов не ускоряют)</i>`);
  }
  return parts.join('\n');
}

function formatTelegramEventsListMessage({ events, playerId, mode = 'upcoming' }) {
  const parts = [];
  parts.push(mode === 'past' ? '🏁 <b>Прошедшие события альянса:</b>\n' : '📅 <b>Ближайшие события альянса:</b>\n');

  if (!events || !events.length) {
    parts.push(mode === 'past' ? 'Завершённых событий пока нет.' : 'В ближайшее время активных событий не запланировано.');
    return parts.join('\n');
  }

  events.slice(0, 5).forEach((ev, idx) => {
    const title = ev.title || ev.name || ev.eventTypeName || `Событие #${ev.id}`;
    const dateStr = ev.dateFrom ? new Date(ev.dateFrom).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '—';
    const dateToStr = ev.dateTo ? new Date(ev.dateTo).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '';
    const fullDate = dateToStr ? `${dateStr} — ${dateToStr}` : dateStr;

    const assignment = (ev.assignments || []).find(a => Number(a.playerId) === Number(playerId));
    const registration = (ev.registrations || []).find(r => Number(r.playerId) === Number(playerId));

    let statusLine = '📢 <i>Открыта регистрация (выберите кнопку записи ниже)</i>';
    if (mode === 'past') {
      if (assignment) {
        const finalPlace = assignment.actualPlace || assignment.place;
        const coup = (assignment.actualCoupons ?? assignment.coupons) ? ` (+${assignment.actualCoupons ?? assignment.coupons} куп.)` : '';
        statusLine = `🎯 <b>Итог: Место #${finalPlace}</b>${coup}`;
      } else {
        statusLine = '◌ <i>Событие завершено</i>';
      }
    } else if (assignment) {
      const coup = assignment.coupons ? ` (+${assignment.coupons} куп.)` : '';
      const rsvp = assignment.rsvpStatus === 'confirmed' ? ' [✅ подтверждено]' : (assignment.rsvpStatus === 'declined' ? ' [❌ отказ]' : ' [⏳ ожидает RSVP]');
      statusLine = `🎯 <b>Вам назначено Место #${assignment.place}</b>${coup}${rsvp}`;
    } else if (registration) {
      const desPlace = registration.desiredPlace ? `#${registration.desiredPlace}` : 'любое';
      statusLine = `✓ <b>Заявка подана</b> (желаемое место: ${desPlace})`;
    }

    parts.push(`${idx + 1}. 🏆 <b>${escapeHtml(title)}</b> (${fullDate})`);
    parts.push(`   ${statusLine}\n`);
  });

  return parts.join('\n').trim();
}

function getTelegramEventsKeyboard({ events = [], mode = 'upcoming' } = {}) {
  const keyboard = [];
  if (mode === 'upcoming' && events && events.length) {
    events.slice(0, 4).forEach(ev => {
      const title = ev.title || ev.name || ev.eventTypeName || `Событие #${ev.id}`;
      keyboard.push([{ text: `📝 Записаться: ${title}`, callback_data: `cmd_ev_view:${ev.id}` }]);
    });
  }
  keyboard.push([
    mode === 'past'
      ? { text: '◎ Предстоящие события', callback_data: 'cmd_events_upcoming' }
      : { text: '◌ Прошедшие события', callback_data: 'cmd_events_past' }
  ]);
  keyboard.push([{ text: '◀️ Главное меню', callback_data: 'cmd_menu' }]);
  return { inline_keyboard: keyboard };
}

function formatTelegramEventDetailMessage({ event, eventType, registration, assignment }) {
  const title = event.title || event.name || eventType?.name || `Событие #${event.id}`;
  const dateStr = event.dateFrom ? new Date(event.dateFrom).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '—';
  const dateToStr = event.dateTo ? new Date(event.dateTo).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '';
  const fullDate = dateToStr ? `${dateStr} — ${dateToStr}` : dateStr;

  const parts = [`🏆 <b>${escapeHtml(title)}</b> (${fullDate})\n`];
  if (event.note) parts.push(`📝 <i>${escapeHtml(event.note)}</i>\n`);

  const places = eventType?.places || [];
  if (places.length) {
    parts.push('<b>Регламент наград (купоны):</b>');
    places.slice(0, 5).forEach((p, idx) => {
      const placeNum = p.place || (idx + 1);
      const coupons = p.coupons ? `${p.coupons.toLocaleString('ru-RU')} 🎟️` : '—';
      const label = p.label ? ` (${escapeHtml(p.label)})` : '';
      parts.push(`• Место #${placeNum}: <b>+${coupons}</b>${label}`);
    });
    parts.push('');
  }

  if (assignment) {
    const coup = assignment.coupons ? ` (+${assignment.coupons} куп.)` : '';
    const rsvp = assignment.rsvpStatus === 'confirmed' ? ' [✅ подтверждено]' : (assignment.rsvpStatus === 'declined' ? ' [❌ отказ]' : ' [⏳ ожидает RSVP]');
    parts.push(`🎯 <b>Вам назначено Место #${assignment.place}</b>${coup}${rsvp}`);
  } else if (registration) {
    const desPlace = registration.desiredPlace ? `#${registration.desiredPlace}` : 'любое';
    parts.push(`✓ <b>Ваша заявка принята!</b> Желаемое место: <b>${desPlace}</b>`);
    parts.push('<i>Вы можете изменить желаемое место или отозвать заявку кнопками ниже.</i>');
  } else {
    parts.push('📢 <i>Вы ещё не подали заявку на этот ивент.</i>');
    parts.push('Выберите желаемое место для регистрации:');
  }

  return parts.join('\n').trim();
}

function formatEventDetailRegistrationKeyboard({ eventId, eventType, registration }) {
  const keyboard = [];
  const places = (eventType?.places || []).slice(0, 4);
  const placeButtons = [];

  if (places.length) {
    places.forEach((p, idx) => {
      const placeNum = p.place || (idx + 1);
      const coup = p.coupons ? (p.coupons >= 1000 ? ` (${Math.round(p.coupons / 1000)}к)` : ` (${p.coupons})`) : '';
      const isCurrent = registration && Number(registration.desiredPlace) === Number(placeNum);
      placeButtons.push({
        text: `${isCurrent ? '✓ ' : ''}#${placeNum}${coup}`,
        callback_data: `reg_event:${eventId}:${placeNum}`
      });
    });
  } else {
    placeButtons.push(
      { text: '#1 (50к)', callback_data: `reg_event:${eventId}:1` },
      { text: '#2 (40к)', callback_data: `reg_event:${eventId}:2` },
      { text: '#3 (30к)', callback_data: `reg_event:${eventId}:3` }
    );
  }
  const isAnyCurrent = registration && Number(registration.desiredPlace) === 0;
  placeButtons.push({
    text: `${isAnyCurrent ? '✓ ' : ''}Любое`,
    callback_data: `reg_event:${eventId}:0`
  });

  for (let i = 0; i < placeButtons.length; i += 2) {
    keyboard.push(placeButtons.slice(i, i + 2));
  }
  if (registration) {
    keyboard.push([{ text: '✕ Отозвать заявку', callback_data: `unreg_event:${eventId}` }]);
  }
  keyboard.push([{ text: '◀️ К списку ивентов', callback_data: 'cmd_events' }]);
  return { inline_keyboard: keyboard };
}

function formatTmaUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    parsed.searchParams.set('tma', '1');
    return parsed.toString();
  } catch (_) {
    if (trimmed.includes('tma=1')) return trimmed;
    return trimmed.includes('?') ? (trimmed + '&tma=1') : (trimmed + '?tma=1');
  }
}

function getTelegramMainMenuKeyboard({ isStaff = false, webAppUrl = null } = {}) {
  const keyboard = [];
  const effectiveUrl = formatTmaUrl(webAppUrl);
  if (effectiveUrl && /^https:\/\//i.test(effectiveUrl)) {
    keyboard.push([{ text: '🚀 Открыть KoW Mini App', web_app: { url: effectiveUrl } }]);
  }
  keyboard.push([
    { text: '👤 Мой сектор', callback_data: 'cmd_me' },
    { text: '📊 Дефицит', callback_data: 'cmd_deficit' }
  ]);
  keyboard.push([
    { text: '📅 Мои ивенты', callback_data: 'cmd_events' },
    { text: '📦 Обновить склад', callback_data: 'cmd_stock_help' }
  ]);
  if (isStaff) {
    keyboard.push([
      { text: '📋 Сводка штаба', callback_data: 'cmd_digest' },
      { text: '⚠️ Должники', callback_data: 'cmd_stale' }
    ]);
  }
  return { inline_keyboard: keyboard };
}

function formatEventRegistrationKeyboard(eventId) {
  const eId = Number(eventId);
  return {
    inline_keyboard: [
      [
        { text: '🏆 Топ-1', callback_data: `reg_event:${eId}:1` },
        { text: '🥈 Топ-2', callback_data: `reg_event:${eId}:2` },
        { text: '🥉 Топ-3', callback_data: `reg_event:${eId}:3` }
      ],
      [
        { text: '🎖 Место 4–10', callback_data: `reg_event:${eId}:4` },
        { text: '🎲 Любое подходящее', callback_data: `reg_event:${eId}:0` }
      ]
    ]
  };
}

function formatEventRegistrationConfirmedKeyboard(eventId, desiredPlace) {
  const eId = Number(eventId);
  const placeNum = Number(desiredPlace);
  const placeLabel = placeNum > 0 ? `#${placeNum}` : 'Любое';
  return {
    inline_keyboard: [
      [{ text: `✅ Заявка подана: Место ${placeLabel}`, callback_data: `noop_reg:${eId}` }],
      [{ text: '❌ Отозвать заявку', callback_data: `unreg_event:${eId}` }]
    ]
  };
}

function formatTelegramWhoMessage({ player, user, freshness, recentEvents }) {
  const parts = [];
  const sectorName = player?.name || user?.username || 'Сектор';
  const rankMap = { r5: 'Р5', r4: 'Р4', r3: 'Р3', r2: 'Р2', r1: 'Р1' };
  const rankLabel = rankMap[(user?.rank || '').toLowerCase()] || (user?.rank || 'Р3').toUpperCase();
  const tgHandle = user?.username ? `@${user.username}` : (user?.telegram_chat_id ? `ID ${user.telegram_chat_id}` : 'не привязан');

  parts.push(`🪪 <b>Досье бойца:</b> <b>${escapeHtml(sectorName)}</b>`);
  parts.push(`👤 Владелец: <b>${escapeHtml(tgHandle)}</b> | Ранг: <b>${rankLabel}</b>`);

  const power = player?.sector?.power ?? player?.power ?? 0;
  const vip = player?.sector?.vipLevel !== undefined ? player.sector.vipLevel : (player?.vip !== undefined ? player.vip : (user?.vip !== undefined ? user.vip : '—'));
  parts.push(`📊 Сила: <b>${formatInputNumber(power)}</b> | VIP: <b>${vip}</b>`);

  parts.push('\n📦 <b>Склад:</b>');
  const stock = player?.stock || {};
  parts.push(`• Купоны: <b>${formatInputNumber(stock.coupons || 0)}</b> 🎟️`);
  parts.push(`• Пазлы: <b>${formatInputNumber(stock.puzzles || 0)}</b> 🧩`);
  if (freshness) {
    const badgeIcon = freshness.status === 'fresh' ? '🟢' : (freshness.status === 'warning' ? '🟡' : '🔴');
    parts.push(`• Свежесть: ${badgeIcon} ${freshness.label || (freshness.days + ' дн. назад')}`);
  }

  if (recentEvents && recentEvents.length) {
    parts.push('\n📅 <b>Участие в ивентах:</b>');
    recentEvents.slice(0, 3).forEach(e => {
      const title = e.title || e.name || 'Ивент';
      const pl = e.actualPlace ? `#${e.actualPlace}` : (e.place ? `#${e.place} (план)` : '—');
      const coup = e.coupons ? ` (+${e.coupons} куп.)` : '';
      parts.push(`• ${escapeHtml(title)}: место ${pl}${coup}`);
    });
  }
  return parts.join('\n');
}

function formatTelegramStaleReport({ stalePlayers }) {
  const parts = ['📋 <b>Отчет по устаревшим складам (>14 дн.):</b>\n'];
  if (!stalePlayers || !stalePlayers.length) {
    parts.push('🟢 <b>Все склады альянса актуальны!</b> Устаревших данных нет.');
    return parts.join('\n');
  }

  stalePlayers.slice(0, 25).forEach((p, idx) => {
    const name = p.name || 'Сектор';
    const days = p.days !== undefined ? p.days : (p.freshness?.days || 14);
    const handle = p.username ? `@${p.username}` : (p.tgHandle || 'не привязан');
    parts.push(`${idx + 1}. <b>${escapeHtml(name)}</b> — ${days} дн. назад (${escapeHtml(handle)})`);
  });

  if (stalePlayers.length > 25) {
    parts.push(`\n<i>...и еще ${stalePlayers.length - 25} секторов.</i>`);
  }
  parts.push('\n💡 <i>Отправьте <code>/ping_stale</code> для автоматической рассылки персональных напоминаний должникам.</i>');
  return parts.join('\n');
}

function formatTelegramDigestMessage({ totalSectors = 0, freshnessStats = {}, nextEvent = null, pendingUsersCount = 0 }) {
  const parts = ['📊 <b>Оперативная сводка альянса:</b>\n'];
  parts.push(`👥 Всего активных секторов: <b>${totalSectors}</b>`);
  parts.push(`📦 Актуальность складов:\n   🟢 Свежие: <b>${freshnessStats.fresh || 0}</b> | 🟡 Внимание: <b>${freshnessStats.warning || 0}</b> | 🔴 Устарели: <b>${freshnessStats.stale || 0}</b>`);

  if (nextEvent) {
    const eTitle = nextEvent.title || nextEvent.name || 'Событие';
    const eDate = nextEvent.dateStr || (nextEvent.dateFrom ? new Date(nextEvent.dateFrom).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '—');
    parts.push(`\n📅 <b>Ближайший ивент:</b> <b>${escapeHtml(eTitle)}</b> (${eDate})`);
    parts.push(`   • Мест распределено: <b>${nextEvent.assignedCount ?? 0}/${nextEvent.totalPlaces ?? 5}</b>`);
    parts.push(`   • Подано заявок: <b>${nextEvent.registrationsCount ?? 0}</b>`);
  } else {
    parts.push('\n📅 Ближайших запланированных событий нет.');
  }

  if (pendingUsersCount > 0) {
    parts.push(`\n🔔 <b>Новые бойцы на модерацию:</b> <b>${pendingUsersCount}</b> чел.`);
  }
  return parts.join('\n');
}

function formatTelegramOcrConfirmationMessage({ player, recognizedStock = {} }) {
  const parts = [
    '📸 <b>Распознаны данные склада со скриншота:</b>',
    `👤 Сектор: <b>${escapeHtml(player?.name || 'Сектор')}</b>\n`,
    `• Купоны: <b>${formatInputNumber(Number(recognizedStock.coupons) || 0)}</b>`,
    `• Пазлы: <b>${formatInputNumber(Number(recognizedStock.puzzles) || 0)}</b>`,
    `• Звездные купоны: <b>${formatInputNumber(Number(recognizedStock.starCoupons) || 0)}</b>`
  ];
  if (Number(recognizedStock.chests) > 0) {
    parts.push(`• Сундуки медалей: <b>${formatInputNumber(Number(recognizedStock.chests))}</b>`);
  }
  parts.push(
    `• Звезды (I / II / III): <b>${Number(recognizedStock.legendaryStars1) || 0} / ${Number(recognizedStock.legendaryStars2) || 0} / ${Number(recognizedStock.legendaryStars3) || 0}</b>\n`,
    '<i>Нажмите кнопку ниже, чтобы применить изменения, или скорректируйте их вручную.</i>'
  );
  return parts.join('\n');
}

function getTelegramOcrConfirmationKeyboard(historyId) {
  return {
    inline_keyboard: [
      [{ text: '✅ Применить изменения', callback_data: `confirm_ocr_stock:${historyId}` }],
      [{ text: '✏️ Ввести остатки /stock', callback_data: 'cmd_stock_help' }]
    ]
  };
}

function getTelegramStockFallbackKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '✅ Текущие остатки актуальны', callback_data: 'confirm_current_stock' }],
      [{ text: '✏️ Ввести остатки /stock', callback_data: 'cmd_stock_help' }]
    ]
  };
}

module.exports = {
  parseTelegramStockCommand,
  formatStockUpdateSuccessMessage,
  formatTelegramMeMessage,
  formatTelegramDeficitMessage,
  formatTelegramEventsListMessage,
  getTelegramEventsKeyboard,
  formatTelegramEventDetailMessage,
  formatEventDetailRegistrationKeyboard,
  formatTmaUrl,
  getTelegramMainMenuKeyboard,
  formatEventRegistrationKeyboard,
  formatEventRegistrationConfirmedKeyboard,
  formatTelegramWhoMessage,
  formatTelegramStaleReport,
  formatTelegramDigestMessage,
  formatTelegramOcrConfirmationMessage,
  getTelegramOcrConfirmationKeyboard,
  getTelegramStockFallbackKeyboard
};
