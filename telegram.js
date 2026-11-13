/**
 * KoW Tracker - Telegram Bot API Service
 * Pure Node.js native fetch client for Telegram Bot API.
 * Zero external dependencies.
 */

const net = require('node:net');
const tls = require('node:tls');
const { URL } = require('node:url');

const DEFAULT_TELEGRAM_API_BASE = 'https://api.telegram.org';

let customTelegramFetch = null;
let defaultProxyUrl = null;

function setTelegramFetch(fn) {
  customTelegramFetch = fn;
}

function setDefaultProxyUrl(proxyUrl) {
  defaultProxyUrl = proxyUrl ? String(proxyUrl).trim() : null;
}

function getDefaultProxyUrl() {
  return defaultProxyUrl || process.env.TELEGRAM_PROXY || null;
}

/**
 * Perform an HTTP/HTTPS request via a SOCKS5 or HTTP CONNECT proxy using pure native Node.js.
 * Zero external dependencies.
 */
function requestViaProxy({
  url,
  method = 'GET',
  headers = {},
  body = null,
  proxyUrl,
  timeoutMs = 10000,
  skipTls = false
}) {
  return new Promise((resolve, reject) => {
    let timer = null;
    let settled = false;

    function cleanup(err, res) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (err) reject(err);
      else resolve(res);
    }

    timer = setTimeout(() => {
      cleanup(new Error(`Proxy request timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    let pUrl, tUrl;
    try {
      pUrl = new URL(proxyUrl);
      tUrl = new URL(url);
    } catch (err) {
      return cleanup(new Error(`Invalid URL: ${err.message}`));
    }

    const isSocks = pUrl.protocol === 'socks5:' || pUrl.protocol === 'socks5h:' || pUrl.protocol === 'socks:';
    const isHttpProxy = pUrl.protocol === 'http:' || pUrl.protocol === 'https:';

    if (!isSocks && !isHttpProxy) {
      return cleanup(new Error(`Unsupported proxy protocol: ${pUrl.protocol}`));
    }

    const proxyPort = parseInt(pUrl.port, 10) || (isSocks ? 1080 : 8080);
    const targetPort = parseInt(tUrl.port, 10) || (tUrl.protocol === 'https:' ? 443 : 80);
    const targetHost = tUrl.hostname;
    const targetPath = `${tUrl.pathname || '/'}${tUrl.search || ''}`;

    const socket = net.connect({
      host: pUrl.hostname,
      port: proxyPort
    });

    socket.on('error', err => cleanup(err));

    socket.on('connect', () => {
      if (isSocks) {
        handleSocks5Handshake();
      } else {
        handleHttpConnect();
      }
    });

    // ─── SOCKS5 HANDSHAKE ──────────────────────────────────────────
    function handleSocks5Handshake() {
      const hasAuth = Boolean(pUrl.username || pUrl.password);
      const greeting = hasAuth
        ? Buffer.from([0x05, 0x02, 0x00, 0x02]) // Methods: NO_AUTH (0), USER_PASS (2)
        : Buffer.from([0x05, 0x01, 0x00]);

      socket.write(greeting);

      socket.once('data', greetReply => {
        if (greetReply.length < 2 || greetReply[0] !== 0x05) {
          socket.destroy();
          return cleanup(new Error('Invalid SOCKS5 greeting reply from proxy'));
        }

        const selectedMethod = greetReply[1];
        if (selectedMethod === 0x02) {
          // Username/password authentication
          const uBuf = Buffer.from(pUrl.username || '', 'utf8');
          const pBuf = Buffer.from(pUrl.password || '', 'utf8');
          const authReq = Buffer.concat([
            Buffer.from([0x01, uBuf.length]),
            uBuf,
            Buffer.from([pBuf.length]),
            pBuf
          ]);
          socket.write(authReq);

          socket.once('data', authReply => {
            if (authReply.length < 2 || authReply[1] !== 0x00) {
              socket.destroy();
              return cleanup(new Error('SOCKS5 authentication failed'));
            }
            sendSocks5Connect();
          });
        } else if (selectedMethod === 0x00) {
          sendSocks5Connect();
        } else {
          socket.destroy();
          return cleanup(new Error(`SOCKS5 authentication method 0x${selectedMethod.toString(16)} rejected`));
        }
      });
    }

    function sendSocks5Connect() {
      const hostBuf = Buffer.from(targetHost, 'utf8');
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(targetPort, 0);

      const connReq = Buffer.concat([
        Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
        hostBuf,
        portBuf
      ]);

      socket.write(connReq);

      socket.once('data', connReply => {
        if (connReply.length < 2 || connReply[0] !== 0x05 || connReply[1] !== 0x00) {
          const repCode = connReply.length >= 2 ? connReply[1] : -1;
          socket.destroy();
          return cleanup(new Error(`SOCKS5 connection rejected with code ${repCode}`));
        }

        // Connection established, proceed to TLS/HTTP
        upgradeAndSendRequest(socket);
      });
    }

    // ─── HTTP CONNECT ──────────────────────────────────────────────
    function handleHttpConnect() {
      let connectReq = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\nProxy-Connection: keep-alive\r\n`;
      if (pUrl.username || pUrl.password) {
        const auth = Buffer.from(`${pUrl.username}:${pUrl.password}`).toString('base64');
        connectReq += `Proxy-Authorization: Basic ${auth}\r\n`;
      }
      connectReq += '\r\n';

      socket.write(connectReq);

      let buf = '';
      function onConnectData(chunk) {
        buf += chunk.toString('latin1');
        const headerEnd = buf.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
          socket.removeListener('data', onConnectData);
          const statusLine = buf.split('\r\n')[0] || '';
          if (!statusLine.includes(' 200')) {
            socket.destroy();
            return cleanup(new Error(`HTTP proxy CONNECT failed: ${statusLine}`));
          }
          upgradeAndSendRequest(socket);
        }
      }
      socket.on('data', onConnectData);
    }

    // ─── TLS UPGRADE & HTTP REQUEST ────────────────────────────────
    function upgradeAndSendRequest(rawSocket) {
      const isHttps = tUrl.protocol === 'https:' && !skipTls;

      let activeSocket = rawSocket;
      if (isHttps) {
        activeSocket = tls.connect({
          socket: rawSocket,
          servername: targetHost,
          rejectUnauthorized: true
        });

        activeSocket.on('error', err => cleanup(err));
      }

      function executeHttp() {
        const payloadBuf = body ? (Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8')) : null;

        const reqHeaders = {
          'Host': targetHost,
          'User-Agent': 'KoW-Tracker-Telegram/3.26.0',
          'Accept': 'application/json',
          'Connection': 'close',
          ...(headers || {})
        };

        if (payloadBuf) {
          if (!reqHeaders['Content-Type'] && !reqHeaders['content-type']) {
            reqHeaders['Content-Type'] = 'application/json; charset=utf-8';
          }
          reqHeaders['Content-Length'] = payloadBuf.length;
        }

        let headText = `${method} ${targetPath} HTTP/1.1\r\n`;
        for (const [k, v] of Object.entries(reqHeaders)) {
          headText += `${k}: ${v}\r\n`;
        }
        headText += '\r\n';

        activeSocket.write(headText);
        if (payloadBuf) {
          activeSocket.write(payloadBuf);
        }

        let respRaw = Buffer.alloc(0);
        activeSocket.on('data', chunk => {
          respRaw = Buffer.concat([respRaw, chunk]);
        });

        activeSocket.on('end', () => {
          parseHttpResponse(respRaw);
        });

        activeSocket.on('close', () => {
          if (!settled && respRaw.length > 0) {
            parseHttpResponse(respRaw);
          }
        });
      }

      if (isHttps) {
        activeSocket.once('secureConnect', executeHttp);
      } else {
        executeHttp();
      }
    }

    function parseHttpResponse(buffer) {
      const headerEndIdx = buffer.indexOf(Buffer.from('\r\n\r\n'));
      if (headerEndIdx === -1) {
        return cleanup(new Error('Incomplete HTTP response from server'));
      }

      const headPart = buffer.slice(0, headerEndIdx).toString('utf8');
      const bodyPart = buffer.slice(headerEndIdx + 4);

      const [statusLine, ...headerLines] = headPart.split('\r\n');
      const statusParts = statusLine.split(' ');
      const statusCode = parseInt(statusParts[1], 10) || 500;

      const respHeaders = {};
      for (const line of headerLines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          const key = line.slice(0, colonIdx).trim().toLowerCase();
          const val = line.slice(colonIdx + 1).trim();
          respHeaders[key] = val;
        }
      }

      // Check Transfer-Encoding: chunked
      let finalBody = bodyPart;
      if (respHeaders['transfer-encoding'] === 'chunked') {
        finalBody = decodeChunked(bodyPart);
      }

      const textBody = finalBody.toString('utf8');

      const responseObj = {
        ok: statusCode >= 200 && statusCode < 300,
        status: statusCode,
        headers: {
          get: (k) => respHeaders[String(k).toLowerCase()] || null
        },
        text: async () => textBody,
        json: async () => {
          try {
            return JSON.parse(textBody);
          } catch (e) {
            return { ok: false, error: e.message };
          }
        },
        arrayBuffer: async () => finalBody.buffer.slice(finalBody.byteOffset, finalBody.byteOffset + finalBody.byteLength),
        buffer: async () => Buffer.from(finalBody)
      };

      cleanup(null, responseObj);
    }

    function decodeChunked(buf) {
      const chunks = [];
      let idx = 0;
      while (idx < buf.length) {
        const lineEnd = buf.indexOf(Buffer.from('\r\n'), idx);
        if (lineEnd === -1) break;
        const lenHex = buf.slice(idx, lineEnd).toString('utf8').trim();
        const chunkSize = parseInt(lenHex, 16);
        if (isNaN(chunkSize) || chunkSize === 0) break;
        const dataStart = lineEnd + 2;
        const dataEnd = dataStart + chunkSize;
        chunks.push(buf.slice(dataStart, dataEnd));
        idx = dataEnd + 2; // skip trailing \r\n
      }
      return Buffer.concat(chunks);
    }
  });
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
  const proxyUrl = options.proxyUrl || getDefaultProxyUrl();

  try {
    let response;

    if (proxyUrl && !options.fetchFn) {
      let reqBody = null;
      const reqHeaders = { 'Accept': 'application/json' };
      if (payload !== null) {
        if (typeof FormData !== 'undefined' && payload instanceof FormData) {
          if (typeof Response !== 'undefined') {
            const formResp = new Response(payload);
            reqBody = Buffer.from(await formResp.arrayBuffer());
            const ct = formResp.headers.get('content-type');
            if (ct) reqHeaders['Content-Type'] = ct;
          } else {
            reqBody = payload;
          }
        } else {
          reqHeaders['Content-Type'] = 'application/json';
          reqBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
        }
      }

      response = await requestViaProxy({
        url,
        method: payload !== null ? 'POST' : 'GET',
        headers: reqHeaders,
        body: reqBody,
        proxyUrl,
        timeoutMs: options.timeoutMs || 10000,
        skipTls: Boolean(options.skipTls)
      });
    } else {
      const fetchFn = options.fetchFn || customTelegramFetch || globalThis.fetch;
      if (typeof fetchFn !== 'function') {
        return { ok: false, error: 'FETCH_NOT_AVAILABLE' };
      }

      const fetchOptions = {
        method: payload !== null ? 'POST' : 'GET',
        headers: {
          'Accept': 'application/json'
        },
        signal: options.signal || (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(options.timeoutMs || 10000) : undefined)
      };

      if (payload !== null) {
        if (typeof FormData !== 'undefined' && payload instanceof FormData) {
          fetchOptions.body = payload;
        } else {
          fetchOptions.headers['Content-Type'] = 'application/json; charset=utf-8';
          fetchOptions.body = JSON.stringify(payload);
        }
      }

      response = await fetchFn(url, fetchOptions);
    }
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
 * Send a photo to a Telegram chat.
 * `photo` can be a URL string, a Telegram file_id, a data-URL base64 string, or a Buffer.
 */
async function sendTelegramPhoto({
  token,
  chatId,
  photo,
  caption,
  parseMode = 'HTML',
  replyMarkup = undefined
}, options = {}) {
  if (!chatId) {
    return { ok: false, error: 'MISSING_CHAT_ID' };
  }
  if (!photo) {
    return { ok: false, error: 'MISSING_PHOTO' };
  }

  let isBuffer = Buffer.isBuffer(photo) || (typeof Uint8Array !== 'undefined' && photo instanceof Uint8Array);
  let photoBuffer = isBuffer ? photo : null;
  let filename = options.filename || 'photo.png';
  let mimeType = options.mimeType || 'image/png';

  if (typeof photo === 'string' && photo.startsWith('data:')) {
    const match = photo.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      mimeType = match[1];
      photoBuffer = Buffer.from(match[2], 'base64');
      filename = `photo.${mimeType.split('/')[1] || 'png'}`;
      isBuffer = true;
    }
  }

  if (isBuffer && photoBuffer) {
    if (typeof FormData === 'undefined') {
      return { ok: false, error: 'FORMDATA_NOT_AVAILABLE' };
    }
    const formData = new FormData();
    formData.append('chat_id', String(chatId));
    const blob = new Blob([photoBuffer], { type: mimeType });
    formData.append('photo', blob, filename);
    if (caption) formData.append('caption', caption);
    if (parseMode && parseMode !== 'none') formData.append('parse_mode', parseMode);
    if (replyMarkup !== undefined && replyMarkup !== null) {
      formData.append('reply_markup', typeof replyMarkup === 'string' ? replyMarkup : JSON.stringify(replyMarkup));
    }
    return callTelegramApi(token, 'sendPhoto', formData, options);
  }

  const payload = {
    chat_id: chatId,
    photo: photo
  };
  if (caption) payload.caption = caption;
  if (parseMode && parseMode !== 'none') payload.parse_mode = parseMode;
  if (replyMarkup !== undefined && replyMarkup !== null) payload.reply_markup = replyMarkup;

  return callTelegramApi(token, 'sendPhoto', payload, options);
}

/**
 * Get file information by file_id from Telegram Bot API.
 */
async function getTelegramFile(token, fileId, options = {}) {
  if (!fileId || typeof fileId !== 'string') {
    return { ok: false, error: 'MISSING_FILE_ID' };
  }
  return callTelegramApi(token, 'getFile', { file_id: fileId }, options);
}

/**
 * Download a file from Telegram by file_path.
 * Returns a Buffer.
 */
async function downloadTelegramFile(token, filePath, options = {}) {
  if (!token) throw new Error('MISSING_BOT_TOKEN');
  if (!filePath) throw new Error('MISSING_FILE_PATH');

  const baseUrl = (options.baseUrl || DEFAULT_TELEGRAM_API_BASE).replace(/\/+$/, '');
  const cleanPath = filePath.replace(/^\/+/, '');
  const url = `${baseUrl}/file/bot${token}/${cleanPath}`;
  const proxyUrl = options.proxyUrl || getDefaultProxyUrl();

  let response;
  if (proxyUrl && !options.fetchFn && !customTelegramFetch) {
    response = await requestViaProxy({
      url,
      method: 'GET',
      proxyUrl,
      timeoutMs: options.timeoutMs || 15000,
      skipTls: Boolean(options.skipTls)
    });
  } else {
    const fetchFn = options.fetchFn || customTelegramFetch || globalThis.fetch;
    if (typeof fetchFn !== 'function') {
      throw new Error('FETCH_NOT_AVAILABLE');
    }
    const signal = options.signal || (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(options.timeoutMs || 15000) : undefined);
    response = await fetchFn(url, { method: 'GET', signal });
  }

  if (!response.ok) {
    throw new Error(`Failed to download file from Telegram: HTTP ${response.status}`);
  }

  if (typeof response.arrayBuffer === 'function') {
    const ab = await response.arrayBuffer();
    return Buffer.from(ab);
  } else if (typeof response.buffer === 'function') {
    return await response.buffer();
  } else if (typeof response.text === 'function') {
    const txt = await response.text();
    return Buffer.from(txt, 'utf8');
  }
  throw new Error('Unsupported response body type');
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

/**
 * Configure chat menu button (e.g. for opening Telegram Mini App WebApp).
 */
async function setTelegramChatMenuButton(token, { text = 'KoW Tracker', url = null, chatId = null } = {}, options = {}) {
  if (!token) return { ok: false, error: 'MISSING_BOT_TOKEN' };
  const payload = {};
  if (chatId) {
    payload.chat_id = chatId;
  }
  if (url) {
    payload.menu_button = {
      type: 'web_app',
      text: text || 'KoW Tracker',
      web_app: { url }
    };
  } else {
    payload.menu_button = { type: 'default' };
  }
  return callTelegramApi(token, 'setChatMenuButton', payload, options);
}

/**
 * Retrieve updates via long polling (getUpdates).
 */
async function getTelegramUpdates(token, {
  offset = 0,
  limit = 100,
  timeout = 20,
  allowedUpdates = ['message', 'callback_query']
} = {}, options = {}) {
  const payload = {
    timeout: Math.max(0, parseInt(timeout, 10) || 0),
    limit: Math.min(100, Math.max(1, parseInt(limit, 10) || 100))
  };
  if (offset !== undefined && offset !== null) {
    payload.offset = Number(offset);
  }
  if (Array.isArray(allowedUpdates)) {
    payload.allowed_updates = allowedUpdates;
  }

  // HTTP timeout must be larger than long polling timeout (timeout + 15 seconds)
  const reqTimeoutMs = options.timeoutMs || ((payload.timeout + 15) * 1000);

  return callTelegramApi(token, 'getUpdates', payload, {
    timeoutMs: reqTimeoutMs,
    ...options
  });
}

/**
 * Delete webhook to enable long polling.
 */
async function deleteTelegramWebhook(token, { dropPendingUpdates = false } = {}, options = {}) {
  const payload = {
    drop_pending_updates: Boolean(dropPendingUpdates)
  };
  return callTelegramApi(token, 'deleteWebhook', payload, options);
}

/**
 * Set webhook.
 */
async function setTelegramWebhook(token, { url, secretToken = null, dropPendingUpdates = false } = {}, options = {}) {
  if (!url) return { ok: false, error: 'MISSING_WEBHOOK_URL' };
  const payload = {
    url,
    drop_pending_updates: Boolean(dropPendingUpdates)
  };
  if (secretToken) {
    payload.secret_token = secretToken;
  }
  return callTelegramApi(token, 'setWebhook', payload, options);
}

/**
 * Get webhook info.
 */
async function getTelegramWebhookInfo(token, options = {}) {
  return callTelegramApi(token, 'getWebhookInfo', null, options);
}

// ─── TELEGRAM LONG POLLING RUNNER ──────────────────────────────────────────

let pollingActive = false;
let pollingAbortController = null;
let pollingTimer = null;
let pollingOffset = 0;
let pollingInFlight = false;
const pollingStatus = {
  running: false,
  lastPollTime: null,
  lastSuccessTime: null,
  lastError: null,
  updatesCount: 0,
  consecutiveErrors: 0
};

function getTelegramPollingStatus() {
  return {
    running: pollingActive,
    lastPollTime: pollingStatus.lastPollTime,
    lastSuccessTime: pollingStatus.lastSuccessTime,
    lastError: pollingStatus.lastError,
    updatesCount: pollingStatus.updatesCount,
    consecutiveErrors: pollingStatus.consecutiveErrors
  };
}

function stopTelegramPolling() {
  pollingActive = false;
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }
  if (pollingAbortController) {
    try {
      pollingAbortController.abort();
    } catch (_) {}
    pollingAbortController = null;
  }
  pollingInFlight = false;
  pollingStatus.running = false;
}

function startTelegramPolling({
  getBotToken,
  getProxyUrl,
  onUpdate,
  onError,
  timeoutSec = 20,
  intervalMs = 500
}) {
  stopTelegramPolling();

  pollingActive = true;
  pollingStatus.running = true;
  pollingStatus.consecutiveErrors = 0;
  let webhookDeleted = false;

  async function pollLoop() {
    if (!pollingActive) return;

    const token = typeof getBotToken === 'function' ? getBotToken() : getBotToken;
    if (!token) {
      pollingTimer = setTimeout(pollLoop, 5000);
      return;
    }

    const proxy = typeof getProxyUrl === 'function' ? getProxyUrl() : (getProxyUrl || getDefaultProxyUrl());

    // 1. Delete any existing webhook once on startup so getUpdates works
    if (!webhookDeleted) {
      try {
        const delRes = await deleteTelegramWebhook(token, { dropPendingUpdates: false }, { proxyUrl: proxy, timeoutMs: 10000 });
        if (delRes.ok) {
          webhookDeleted = true;
        }
      } catch (e) {
        // Continue anyway; error handled in getUpdates if conflict
      }
    }

    pollingStatus.lastPollTime = new Date().toISOString();
    pollingAbortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
    pollingInFlight = true;

    try {
      const res = await getTelegramUpdates(
        token,
        {
          offset: pollingOffset,
          timeout: timeoutSec,
          allowedUpdates: ['message', 'callback_query']
        },
        {
          proxyUrl: proxy,
          signal: pollingAbortController ? pollingAbortController.signal : undefined
        }
      );

      pollingInFlight = false;
      if (!pollingActive) return;

      if (res.ok && Array.isArray(res.result)) {
        pollingStatus.lastSuccessTime = new Date().toISOString();
        pollingStatus.lastError = null;
        pollingStatus.consecutiveErrors = 0;

        for (const update of res.result) {
          if (!pollingActive) break;
          if (update && typeof update.update_id === 'number') {
            pollingOffset = Math.max(pollingOffset, update.update_id + 1);
            pollingStatus.updatesCount++;
            if (typeof onUpdate === 'function') {
              try {
                await onUpdate(update);
              } catch (updErr) {
                if (typeof onError === 'function') onError(updErr);
              }
            }
          }
        }

        if (pollingActive) {
          pollingTimer = setTimeout(pollLoop, intervalMs);
        }
      } else {
        const errDesc = res.error || 'Unknown getUpdates error';
        pollingStatus.lastError = errDesc;
        pollingStatus.consecutiveErrors++;

        if (String(errDesc).toLowerCase().includes('webhook') || res.errorCode === 409) {
          webhookDeleted = false;
        }

        if (typeof onError === 'function') {
          onError(new Error(errDesc));
        }

        const delay = Math.min(10000, 2000 * Math.min(5, pollingStatus.consecutiveErrors));
        if (pollingActive) {
          pollingTimer = setTimeout(pollLoop, delay);
        }
      }
    } catch (err) {
      pollingInFlight = false;
      if (!pollingActive) return;

      if (err.name === 'AbortError') return;

      pollingStatus.lastError = err.message;
      pollingStatus.consecutiveErrors++;

      if (typeof onError === 'function') {
        onError(err);
      }

      const delay = Math.min(10000, 2000 * Math.min(5, pollingStatus.consecutiveErrors));
      if (pollingActive) {
        pollingTimer = setTimeout(pollLoop, delay);
      }
    }
  }

  pollingTimer = setTimeout(pollLoop, 100);
  return {
    stop: stopTelegramPolling,
    getStatus: getTelegramPollingStatus
  };
}

module.exports = {
  callTelegramApi,
  getTelegramMe,
  sendTelegramMessage,
  sendTelegramPhoto,
  getTelegramFile,
  downloadTelegramFile,
  editTelegramMessageText,
  answerTelegramCallback,
  setTelegramChatMenuButton,
  getTelegramUpdates,
  deleteTelegramWebhook,
  setTelegramWebhook,
  getTelegramWebhookInfo,
  startTelegramPolling,
  stopTelegramPolling,
  getTelegramPollingStatus,
  setTelegramFetch,
  setDefaultProxyUrl,
  getDefaultProxyUrl,
  requestViaProxy,
  DEFAULT_TELEGRAM_API_BASE
};
