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

  console.log('ok - all telegram.js unit tests passed');
}

runTests().catch(err => {
  console.error('not ok - telegram unit test runner', err);
  process.exit(1);
});
