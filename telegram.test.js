const assert = require('node:assert/strict');
const telegram = require('./telegram.js');

function test(name, fn) {
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      res.then(() => console.log(`ok - ${name}`)).catch(err => {
        console.error(`not ok - ${name}`);
        console.error(err);
        process.exitCode = 1;
      });
    } else {
      console.log(`ok - ${name}`);
    }
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

async function runTests() {
  await (async () => {
    // 1. Missing token
    const res = await telegram.getTelegramMe('');
    assert.equal(res.ok, false);
    assert.equal(res.error, 'MISSING_BOT_TOKEN');
  })();

  await (async () => {
    // 2. Mock getTelegramMe success
    const mockFetch = async (url, options) => {
      assert.equal(url, 'https://mock.telegram.org/bot12345/getMe');
      assert.equal(options.method, 'GET');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: { id: 12345, is_bot: true, first_name: 'KoW Bot', username: 'kow_bot' }
        })
      };
    };

    const res = await telegram.getTelegramMe('12345', {
      baseUrl: 'https://mock.telegram.org',
      fetchFn: mockFetch
    });
    assert.equal(res.ok, true);
    assert.equal(res.result.username, 'kow_bot');
  })();

  await (async () => {
    // 3. Mock sendTelegramMessage success
    let capturedBody = null;
    const mockFetch = async (url, options) => {
      assert.equal(url, 'https://mock.telegram.org/bot12345/sendMessage');
      assert.equal(options.method, 'POST');
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: { message_id: 777, chat: { id: 100 } }
        })
      };
    };

    const res = await telegram.sendTelegramMessage({
      token: '12345',
      chatId: 100,
      text: '<b>Hello!</b>',
      replyMarkup: { inline_keyboard: [[{ text: 'OK', callback_data: 'ok' }]] }
    }, {
      baseUrl: 'https://mock.telegram.org',
      fetchFn: mockFetch
    });

    assert.equal(res.ok, true);
    assert.equal(res.result.message_id, 777);
    assert.equal(capturedBody.chat_id, 100);
    assert.equal(capturedBody.text, '<b>Hello!</b>');
    assert.equal(capturedBody.parse_mode, 'HTML');
    assert.equal(capturedBody.disable_web_page_preview, true);
    assert.deepEqual(capturedBody.reply_markup, { inline_keyboard: [[{ text: 'OK', callback_data: 'ok' }]] });
  })();

  await (async () => {
    // 4. Mock editTelegramMessageText
    let capturedBody = null;
    const mockFetch = async (url, options) => {
      assert.equal(url, 'https://mock.telegram.org/bot12345/editMessageText');
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 777, text: 'Edited' } })
      };
    };

    const res = await telegram.editTelegramMessageText({
      token: '12345',
      chatId: 100,
      messageId: 777,
      text: 'Edited'
    }, {
      baseUrl: 'https://mock.telegram.org',
      fetchFn: mockFetch
    });

    assert.equal(res.ok, true);
    assert.equal(capturedBody.message_id, 777);
    assert.equal(capturedBody.text, 'Edited');
  })();

  await (async () => {
    // 5. Mock answerTelegramCallback
    let capturedBody = null;
    const mockFetch = async (url, options) => {
      assert.equal(url, 'https://mock.telegram.org/bot12345/answerCallbackQuery');
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: true })
      };
    };

    const res = await telegram.answerTelegramCallback({
      token: '12345',
      callbackQueryId: 'cb_999',
      text: 'Done!',
      showAlert: true
    }, {
      baseUrl: 'https://mock.telegram.org',
      fetchFn: mockFetch
    });

    assert.equal(res.ok, true);
    assert.equal(capturedBody.callback_query_id, 'cb_999');
    assert.equal(capturedBody.text, 'Done!');
    assert.equal(capturedBody.show_alert, true);
  })();

  await (async () => {
    // 6. Network failure / API error returns graceful { ok: false, error }
    const mockFetchFail = async () => {
      throw new Error('Network connection timeout');
    };

    const res = await telegram.sendTelegramMessage({
      token: '12345',
      chatId: 100,
      text: 'test'
    }, {
      fetchFn: mockFetchFail
    });

    assert.equal(res.ok, false);
    assert.equal(res.error, 'Network connection timeout');
  })();

  await (async () => {
    // 7. Telegram API 400 Bad Request
    const mockFetchApiError = async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        ok: false,
        error_code: 400,
        description: 'Bad Request: chat not found'
      })
    });

    const res = await telegram.sendTelegramMessage({
      token: '12345',
      chatId: 999999,
      text: 'test'
    }, {
      fetchFn: mockFetchApiError
    });

    assert.equal(res.ok, false);
    assert.equal(res.error, 'Bad Request: chat not found');
    assert.equal(res.errorCode, 400);
  })();

  // 8. Native SOCKS5 proxy test (without auth)
  await (async () => {
    const net = require('node:net');
    let socksGreetingReceived = false;
    let socksConnectReceived = false;

    const mockSocksServer = net.createServer(socket => {
      socket.once('data', data => {
        if (data[0] === 5 && data[1] >= 1) {
          socksGreetingReceived = true;
          // Reply NO_AUTH (0x05, 0x00)
          socket.write(Buffer.from([5, 0]));

          socket.once('data', reqData => {
            if (reqData[0] === 5 && reqData[1] === 1) { // CONNECT command
              socksConnectReceived = true;
              // Reply success (0x05, 0x00, 0x00, 0x01, 127.0.0.1:port)
              socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80]));

              // Wait for HTTP request, then send simulated HTTP response
              socket.once('data', () => {
                const httpResp = 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{"ok":true,"result":{"id":999,"username":"proxied_bot"}}';
                socket.end(httpResp);
              });
            }
          });
        }
      });
    });

    await new Promise(r => mockSocksServer.listen(0, '127.0.0.1', r));
    const proxyPort = mockSocksServer.address().port;

    try {
      const res = await telegram.callTelegramApi('12345', 'getMe', null, {
        baseUrl: 'http://api.telegram.org', // plain HTTP for mock socket
        proxyUrl: `socks5://127.0.0.1:${proxyPort}`,
        skipTls: true
      });

      assert.equal(socksGreetingReceived, true, 'SOCKS5 greeting should be received');
      assert.equal(socksConnectReceived, true, 'SOCKS5 connect should be received');
      assert.equal(res.ok, true);
      assert.equal(res.result.username, 'proxied_bot');
    } finally {
      mockSocksServer.close();
    }
  })();

  // 9. Native HTTP CONNECT proxy test
  await (async () => {
    const net = require('node:net');
    let connectReceived = false;

    const mockHttpProxy = net.createServer(socket => {
      socket.once('data', data => {
        const text = data.toString('utf8');
        if (text.startsWith('CONNECT')) {
          connectReceived = true;
          socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          socket.once('data', reqData => {
            const httpResp = 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{"ok":true,"result":{"id":888,"username":"http_proxy_bot"}}';
            socket.end(httpResp);
          });
        }
      });
    });

    await new Promise(r => mockHttpProxy.listen(0, '127.0.0.1', r));
    const proxyPort = mockHttpProxy.address().port;

    try {
      const res = await telegram.callTelegramApi('12345', 'getMe', null, {
        baseUrl: 'http://api.telegram.org',
        proxyUrl: `http://127.0.0.1:${proxyPort}`,
        skipTls: true
      });

      assert.equal(connectReceived, true, 'HTTP CONNECT should be received');
      assert.equal(res.ok, true);
      assert.equal(res.result.username, 'http_proxy_bot');
    } finally {
      mockHttpProxy.close();
    }
  })();

  // 10. SOCKS5 Proxy unreachable error handling
  await (async () => {
    const res = await telegram.callTelegramApi('12345', 'getMe', null, {
      proxyUrl: 'socks5://127.0.0.1:59999',
      timeoutMs: 500
    });
    assert.equal(res.ok, false);
    assert.match(res.error, /ECONNREFUSED|connect|timeout/i);
  })();

  // 11. mieru.testMieruConnection contract verification (ok && success flags)
  await (async () => {
    const mieru = require('./mieru.js');
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        result: { id: 999, is_bot: true, username: 'test_bot' }
      })
    });

    const origCall = telegram.callTelegramApi;
    try {
      telegram.callTelegramApi = async () => ({
        ok: true,
        result: { username: 'test_bot' }
      });
      const resOk = await mieru.testMieruConnection('socks5://127.0.0.1:1080', 'fake_token');
      assert.equal(resOk.ok, true, 'resOk.ok must be true');
      assert.equal(resOk.success, true, 'resOk.success must be true');
      assert.equal(resOk.botUsername, 'test_bot');

      telegram.callTelegramApi = async () => ({
        ok: false,
        errorCode: 401,
        error: 'Unauthorized'
      });
      const res401 = await mieru.testMieruConnection('socks5://127.0.0.1:1080', 'fake_token');
      assert.equal(res401.ok, true, 'res401.ok must be true');
      assert.equal(res401.success, true, 'res401.success must be true');

      telegram.callTelegramApi = async () => ({
        ok: false,
        error: 'Proxy timeout'
      });
      const resFail = await mieru.testMieruConnection('socks5://127.0.0.1:1080', 'fake_token');
      assert.equal(resFail.ok, false, 'resFail.ok must be false');
      assert.equal(resFail.success, false, 'resFail.success must be false');
    } finally {
      telegram.callTelegramApi = origCall;
    }
  })();

  // 12. getTelegramUpdates payload and options
  await (async () => {
    let capturedUrl = null;
    let capturedBody = null;
    const mockFetch = async (url, options) => {
      capturedUrl = url;
      capturedBody = options.body ? JSON.parse(options.body) : null;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: [] })
      };
    };

    const res = await telegram.getTelegramUpdates('tok_123', {
      offset: 42,
      limit: 50,
      timeout: 15
    }, {
      baseUrl: 'https://mock.telegram.org',
      fetchFn: mockFetch
    });
    assert.equal(res.ok, true);
    assert.equal(capturedUrl, 'https://mock.telegram.org/bottok_123/getUpdates');
    assert.equal(capturedBody.offset, 42);
    assert.equal(capturedBody.limit, 50);
    assert.equal(capturedBody.timeout, 15);
    assert.deepEqual(capturedBody.allowed_updates, ['message', 'callback_query']);
  })();

  // 13. deleteTelegramWebhook
  await (async () => {
    let capturedUrl = null;
    let capturedBody = null;
    const mockFetch = async (url, options) => {
      capturedUrl = url;
      capturedBody = options.body ? JSON.parse(options.body) : null;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: true })
      };
    };

    const res = await telegram.deleteTelegramWebhook('tok_123', { dropPendingUpdates: true }, {
      baseUrl: 'https://mock.telegram.org',
      fetchFn: mockFetch
    });
    assert.equal(res.ok, true);
    assert.equal(capturedUrl, 'https://mock.telegram.org/bottok_123/deleteWebhook');
    assert.equal(capturedBody.drop_pending_updates, true);
  })();

  // 14. startTelegramPolling and stopTelegramPolling lifecycle
  await (async () => {
    const receivedUpdates = [];
    let callCount = 0;

    telegram.setTelegramFetch(async (url, options) => {
      if (url.includes('/deleteWebhook')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: true })
        };
      }
      if (url.includes('/getUpdates')) {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              result: [
                { update_id: 100, message: { text: '/start' } },
                { update_id: 101, message: { text: '/connect_staff KOW-STAFF-1234' } }
              ]
            })
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: [] })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true })
      };
    });

    try {
      telegram.startTelegramPolling({
        getBotToken: () => 'poll_tok',
        getProxyUrl: () => null,
        intervalMs: 10,
        timeoutSec: 1,
        onUpdate: async (upd) => {
          receivedUpdates.push(upd);
        }
      });

      // Wait a moment for polling loop to execute
      await new Promise(r => setTimeout(r, 150));

      const status = telegram.getTelegramPollingStatus();
      assert.equal(status.running, true);
      assert.equal(status.updatesCount, 2);
      assert.equal(receivedUpdates.length, 2);
      assert.equal(receivedUpdates[0].update_id, 100);
      assert.equal(receivedUpdates[1].update_id, 101);

      telegram.stopTelegramPolling();
      const stoppedStatus = telegram.getTelegramPollingStatus();
      assert.equal(stoppedStatus.running, false);
    } finally {
      telegram.stopTelegramPolling();
      telegram.setTelegramFetch(null);
    }
  })();

  console.log('ok - all telegram.js unit tests passed');
}

runTests().catch(err => {
  console.error('not ok - telegram unit test runner', err);
  process.exit(1);
});
