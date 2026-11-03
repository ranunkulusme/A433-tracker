/**
 * KoW Tracker - Telegram Bot API Service
 * Pure Node.js native fetch client for Telegram Bot API.
 * Zero external dependencies.
 */

const DEFAULT_TELEGRAM_API_BASE = 'https://api.telegram.org';

let customTelegramFetch = null;

function setTelegramFetch(fn) {
  customTelegramFetch = fn;
}

/**
 * Execute Telegram Bot API request safely without throwing uncaught exceptions.
 */
async function callTelegramApi(token, method, payload = null, options = {}) {
  if (!token || typeof token !== 'string') {
    return { ok: false, error: 'MISSING_BOT_TOKEN' };
  }

  const baseUrl = options.baseUrl || DEFAULT_TELEGRAM_API_BASE;
  const url = `${baseUrl.replace(/\/+$/, '')}/bot${token}/${method}`;
  const fetchFn = options.fetchFn || customTelegramFetch || globalThis.fetch;

  if (typeof fetchFn !== 'function') {
    return { ok: false, error: 'FETCH_NOT_AVAILABLE' };
  }

  try {
    const fetchOptions = {
      method: payload !== null ? 'POST' : 'GET',
      headers: {
        'Accept': 'application/json'
      },
      signal: options.signal || (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(options.timeoutMs || 10000) : undefined)
    };

    if (payload !== null) {
      fetchOptions.headers['Content-Type'] = 'application/json; charset=utf-8';
      fetchOptions.body = JSON.stringify(payload);
    }

    const response = await fetchFn(url, fetchOptions);
    const data = await response.json().catch(err => ({
      ok: false,
      error: `JSON parse error: ${err.message}`
    }));

    if (!response.ok || !data.ok) {
      const errorMsg = data.description || data.error || `HTTP ${response.status}`;
      console.warn(`[Telegram] ${method} error (${response.status}): ${errorMsg}`);
      return {
        ok: false,
        error: errorMsg,
        errorCode: data.error_code || response.status
      };
    }

    return {
      ok: true,
      result: data.result
    };
  } catch (err) {
    console.warn(`[Telegram] Network error calling ${method}: ${err.message}`);
    return {
      ok: false,
      error: err.message
    };
  }
}

/**
 * Get information about the bot (testing token & retrieving username).
 */
async function getTelegramMe(token, options = {}) {
  return callTelegramApi(token, 'getMe', null, options);
}

/**
 * Send a message to a Telegram chat.
 */
async function sendTelegramMessage({
  token,
  chatId,
  text,
  parseMode = 'HTML',
  replyMarkup = undefined,
  disableWebPagePreview = true
}, options = {}) {
  if (!chatId) {
    return { ok: false, error: 'MISSING_CHAT_ID' };
  }
  if (!text || typeof text !== 'string') {
    return { ok: false, error: 'MISSING_TEXT' };
  }

  const payload = {
    chat_id: chatId,
    text: text
  };

  if (parseMode && parseMode !== 'none') {
    payload.parse_mode = parseMode;
  }
  if (replyMarkup !== undefined && replyMarkup !== null) {
    payload.reply_markup = replyMarkup;
  }
  if (disableWebPagePreview !== undefined) {
    payload.disable_web_page_preview = Boolean(disableWebPagePreview);
  }

  return callTelegramApi(token, 'sendMessage', payload, options);
}

/**
 * Edit an existing message text.
 */
async function editTelegramMessageText({
  token,
  chatId,
  messageId,
  text,
  parseMode = 'HTML',
  replyMarkup = undefined,
  disableWebPagePreview = true
}, options = {}) {
  if (!chatId) {
    return { ok: false, error: 'MISSING_CHAT_ID' };
  }
  if (!messageId) {
    return { ok: false, error: 'MISSING_MESSAGE_ID' };
  }
  if (!text || typeof text !== 'string') {
    return { ok: false, error: 'MISSING_TEXT' };
  }

  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: text
  };

  if (parseMode && parseMode !== 'none') {
    payload.parse_mode = parseMode;
  }
  if (replyMarkup !== undefined && replyMarkup !== null) {
    payload.reply_markup = replyMarkup;
  }
  if (disableWebPagePreview !== undefined) {
    payload.disable_web_page_preview = Boolean(disableWebPagePreview);
  }

  return callTelegramApi(token, 'editMessageText', payload, options);
}

/**
 * Answer a callback query (inline button click).
 */
async function answerTelegramCallback({
  token,
  callbackQueryId,
  text = '',
  showAlert = false
}, options = {}) {
  if (!callbackQueryId) {
    return { ok: false, error: 'MISSING_CALLBACK_QUERY_ID' };
  }

  const payload = {
    callback_query_id: callbackQueryId
  };

  if (text) {
    payload.text = text;
  }
  if (showAlert) {
    payload.show_alert = Boolean(showAlert);
  }

  return callTelegramApi(token, 'answerCallbackQuery', payload, options);
}

module.exports = {
  callTelegramApi,
  getTelegramMe,
  sendTelegramMessage,
  editTelegramMessageText,
  answerTelegramCallback,
  setTelegramFetch,
  DEFAULT_TELEGRAM_API_BASE
};
