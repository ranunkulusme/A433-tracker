const assert = require('node:assert/strict');

// Run tests in async-compatible runner
async function runTests() {
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`ok - ${name}`);
      passed++;
    } catch (error) {
      console.error(`not ok - ${name}`);
      console.error(error);
      failed++;
      process.exitCode = 1;
    }
  }

  // Import i18n module
  const {
    initI18n,
    t,
    getAppLanguage,
    setAppLanguage,
    getLocalizedOfficerType,
    updateStaticDOMTranslations,
    I18N_RESOURCES
  } = require('./i18n.js');

  await test('i18n module exports all required APIs and resources', () => {
    assert.equal(typeof initI18n, 'function');
    assert.equal(typeof t, 'function');
    assert.equal(typeof getAppLanguage, 'function');
    assert.equal(typeof setAppLanguage, 'function');
    assert.equal(typeof getLocalizedOfficerType, 'function');
    assert.equal(typeof updateStaticDOMTranslations, 'function');
    assert(I18N_RESOURCES && typeof I18N_RESOURCES === 'object');
    assert(I18N_RESOURCES.ru && I18N_RESOURCES.ru.translation);
    assert(I18N_RESOURCES.en && I18N_RESOURCES.en.translation);
    assert(I18N_RESOURCES.de && I18N_RESOURCES.de.translation);
  });

  await test('100% dictionary key parity between ru, en and de', () => {
    function getAllKeys(obj, prefix = '') {
      let keys = [];
      for (const [key, val] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          keys = keys.concat(getAllKeys(val, fullKey));
        } else {
          keys.push({ key: fullKey, value: val });
        }
      }
      return keys;
    }

    const ruKeys = getAllKeys(I18N_RESOURCES.ru.translation);
    const enKeys = getAllKeys(I18N_RESOURCES.en.translation);
    const deKeys = getAllKeys(I18N_RESOURCES.de.translation);

    const enKeyMap = new Map(enKeys.map(k => [k.key, k.value]));
    const deKeyMap = new Map(deKeys.map(k => [k.key, k.value]));
    const ruKeyMap = new Map(ruKeys.map(k => [k.key, k.value]));

    assert(ruKeys.length > 30, `Expected at least 30 keys in ru dictionary, found ${ruKeys.length}`);

    // Check all RU keys exist in EN and DE
    for (const { key, value } of ruKeys) {
      assert(enKeyMap.has(key), `Missing key in EN: ${key}`);
      assert(deKeyMap.has(key), `Missing key in DE: ${key}`);

      const enVal = enKeyMap.get(key);
      const deVal = deKeyMap.get(key);

      assert.equal(typeof value, 'string', `RU key ${key} must be a string`);
      assert(value.trim().length > 0, `RU key ${key} must not be empty`);

      assert.equal(typeof enVal, 'string', `EN key ${key} must be a string`);
      assert(enVal.trim().length > 0, `EN key ${key} must not be empty`);

      assert.equal(typeof deVal, 'string', `DE key ${key} must be a string`);
      assert(deVal.trim().length > 0, `DE key ${key} must not be empty`);
    }

    // Check no dangling keys in EN or DE that don't exist in RU
    for (const { key } of enKeys) {
      assert(ruKeyMap.has(key), `Dangling key in EN that is missing in RU: ${key}`);
    }
    for (const { key } of deKeys) {
      assert(ruKeyMap.has(key), `Dangling key in DE that is missing in RU: ${key}`);
    }
  });

  await test('initI18n initializes default language ru and provides translations', async () => {
    await initI18n({ lng: 'ru' });
    assert.equal(getAppLanguage(), 'ru');
    assert.equal(t('common.save'), 'Сохранить');
    assert.equal(t('common.cancel'), 'Отмена');
    assert.equal(t('auth.login'), 'Вход');
    assert.equal(t('auth.register'), 'Регистрация');
    assert.equal(t('nav.calendar'), 'Календарь');
    assert.equal(t('roles.r5'), 'Р5 — Лидер');
  });

  await test('language switching to en and de with setAppLanguage', async () => {
    await setAppLanguage('en');
    assert.equal(getAppLanguage(), 'en');
    assert.equal(t('common.save'), 'Save');
    assert.equal(t('common.cancel'), 'Cancel');
    assert.equal(t('auth.login'), 'Login');
    assert.equal(t('auth.register'), 'Register');
    assert.equal(t('nav.calendar'), 'Calendar');
    assert.equal(t('roles.r5'), 'R5 — Leader');

    await setAppLanguage('de');
    assert.equal(getAppLanguage(), 'de');
    assert.equal(t('common.save'), 'Speichern');
    assert.equal(t('common.cancel'), 'Abbrechen');
    assert.equal(t('auth.login'), 'Anmelden');
    assert.equal(t('auth.register'), 'Registrieren');
    assert.equal(t('nav.calendar'), 'Kalender');
    assert.equal(t('roles.r5'), 'R5 — Anführer');

    // Switch back to ru
    await setAppLanguage('ru');
    assert.equal(getAppLanguage(), 'ru');
    assert.equal(t('common.save'), 'Сохранить');
    assert.equal(t('auth.login'), 'Вход');
  });

  await test('interpolation of toast messages and sim parameters in all languages', async () => {
    await setAppLanguage('ru');
    assert.equal(t('toasts.import_success', { count: 12 }), 'Импортировано 12 записей');
    assert.equal(t('toasts.error_occurred', { error: '500' }), 'Произошла ошибка: 500');
    assert.equal(t('toasts.saved_success'), 'Изменения успешно сохранены');
    assert.equal(t('toasts.export_success'), 'Данные успешно экспортированы');
    assert.equal(t('toasts.access_denied'), 'Доступ ограничен правами ранга');
    assert.equal(t('game.sim.guaranteed_mode'), 'Гарантированный режим');
    assert.equal(t('game.sim.optimistic_mode'), 'Оптимистичный режим');
    assert.equal(t('game.sim.manual_mode'), 'Ручной ввод');
    assert.equal(t('game.sim.savings_badge', { days: 7 }), '⚡ Экономия: 7 дн.!');

    await setAppLanguage('en');
    assert.equal(t('toasts.import_success', { count: 12 }), 'Imported 12 records');
    assert.equal(t('toasts.error_occurred', { error: '500' }), 'An error occurred: 500');
    assert.equal(t('toasts.saved_success'), 'Changes saved successfully');
    assert.equal(t('toasts.export_success'), 'Data exported successfully');
    assert.equal(t('toasts.access_denied'), 'Access denied by rank permissions');
    assert.equal(t('game.sim.guaranteed_mode'), 'Guaranteed Mode');
    assert.equal(t('game.sim.optimistic_mode'), 'Optimistic Mode');
    assert.equal(t('game.sim.manual_mode'), 'Manual Mode');
    assert.equal(t('game.sim.savings_badge', { days: 7 }), '⚡ Savings: 7 days!');

    await setAppLanguage('de');
    assert.equal(t('toasts.import_success', { count: 12 }), '12 Datensätze importiert');
    assert.equal(t('toasts.error_occurred', { error: '500' }), 'Ein Fehler ist aufgetreten: 500');
    assert.equal(t('toasts.saved_success'), 'Änderungen erfolgreich gespeichert');
    assert.equal(t('toasts.export_success'), 'Daten erfolgreich exportiert');
    assert.equal(t('toasts.access_denied'), 'Zugriff durch Rangberechtigungen verweigert');
    assert.equal(t('game.sim.guaranteed_mode'), 'Garantierter Modus');
    assert.equal(t('game.sim.optimistic_mode'), 'Optimistischer Modus');
    assert.equal(t('game.sim.manual_mode'), 'Manueller Modus');
    assert.equal(t('game.sim.savings_badge', { days: 7 }), '⚡ Ersparnis: 7 Tage!');

    // Reset back to ru
    await setAppLanguage('ru');
  });

  await test('safe fallback when key does not exist or translation is missing', () => {
    assert.equal(t('non_existent.super_key'), 'non_existent.super_key');
    assert.equal(t('non_existent.with_fallback', 'Fallback value'), 'Fallback value');
  });

  await test('getLocalizedOfficerType translates types across ru, en, de', async () => {
    await setAppLanguage('ru');
    assert.equal(getLocalizedOfficerType('tank'), 'Танк');
    assert.equal(getLocalizedOfficerType('Танк'), 'Танк');
    assert.equal(getLocalizedOfficerType('Пехота'), 'Пехота');
    assert.equal(getLocalizedOfficerType('ПТ'), 'ПТ-САУ');
    assert.equal(getLocalizedOfficerType('пт'), 'ПТ-САУ');
    assert.equal(getLocalizedOfficerType('ПТ-Сау'), 'ПТ-САУ');
    assert.equal(getLocalizedOfficerType('Горнизон'), 'Гарнизон');
    assert.equal(getLocalizedOfficerType('Осада'), 'Осада');

    await setAppLanguage('en');
    assert.equal(getLocalizedOfficerType('tank'), 'Tank');
    assert.equal(getLocalizedOfficerType('Танк'), 'Tank');
    assert.equal(getLocalizedOfficerType('Пехота'), 'Infantry');
    assert.equal(getLocalizedOfficerType('ПТ'), 'Tank Destroyer');
    assert.equal(getLocalizedOfficerType('ПТ-Сау'), 'Tank Destroyer');
    assert.equal(getLocalizedOfficerType('Горнизон'), 'Garrison');
    assert.equal(getLocalizedOfficerType('Осада'), 'Siege');

    await setAppLanguage('de');
    assert.equal(getLocalizedOfficerType('tank'), 'Panzer');
    assert.equal(getLocalizedOfficerType('Танк'), 'Panzer');
    assert.equal(getLocalizedOfficerType('Пехота'), 'Infanterie');
    assert.equal(getLocalizedOfficerType('ПТ'), 'Jagdpanzer');
    assert.equal(getLocalizedOfficerType('ПТ-Сау'), 'Jagdpanzer');
    assert.equal(getLocalizedOfficerType('Горнизон'), 'Garnison');
    assert.equal(getLocalizedOfficerType('Осада'), 'Belagerung');

    // Unknown type returns original
    assert.equal(getLocalizedOfficerType('Космодесант'), 'Космодесант');

    await setAppLanguage('ru');
  });

  await test('updateStaticDOMTranslations does not throw when document is undefined', () => {
    assert.doesNotThrow(() => {
      updateStaticDOMTranslations();
    });
  });

  await test('updateStaticDOMTranslations updates mock DOM elements', async () => {
    await setAppLanguage('en');

    const textNodes = [
      {
        attrs: { 'data-i18n': 'common.save' },
        textContent: 'Сохранить',
        getAttribute(k) { return this.attrs[k]; }
      },
      {
        attrs: { 'data-i18n': 'nav.calendar' },
        textContent: 'Календарь',
        getAttribute(k) { return this.attrs[k]; }
      }
    ];

    const attrNodes = [
      {
        attrs: {
          'data-i18n-attr': 'placeholder:common.search;title:common.search',
          placeholder: 'Поиск...',
          title: 'Поиск...'
        },
        getAttribute(k) { return this.attrs[k]; },
        setAttribute(k, v) { this.attrs[k] = v; }
      }
    ];

    const mockDocument = {
      querySelectorAll(selector) {
        if (selector === '[data-i18n]') return textNodes;
        if (selector === '[data-i18n-attr]') return attrNodes;
        return [];
      }
    };

    updateStaticDOMTranslations(mockDocument);

    assert.equal(textNodes[0].textContent, 'Save');
    assert.equal(textNodes[1].textContent, 'Calendar');
    assert.equal(attrNodes[0].attrs.placeholder, 'Search...');
    assert.equal(attrNodes[0].attrs.title, 'Search...');

    await setAppLanguage('ru');
  });

  await test('audit dictionary provides freshness, history, and source translations across ru, en, de', async () => {
    await setAppLanguage('ru');
    assert.equal(t('audit.freshness_fresh'), 'Свежие данные');
    assert.equal(t('audit.freshness_warning'), 'Требует обновления');
    assert.equal(t('audit.freshness_stale'), 'Склад устарел');
    assert.equal(t('audit.history_title'), 'История изменений склада');
    assert.equal(t('audit.source_manual'), 'Ручная правка');
    assert.equal(t('audit.source_ocr'), 'Скриншот (OCR)');
    assert.equal(t('audit.archived_screenshot_notice'), 'Архив: скриншот удален по истечении 30 дней');
    assert.equal(t('audit.view_screenshot'), 'Посмотреть скриншот');
    assert.equal(t('audit.btn_history'), 'История склада');
    assert.equal(t('audit.empty_history'), 'История изменений пока пуста');
    assert.equal(t('audit.zoom_title'), 'Оригинальный скриншот');

    await setAppLanguage('en');
    assert.equal(t('audit.freshness_fresh'), 'Fresh data');
    assert.equal(t('audit.freshness_warning'), 'Needs update');
    assert.equal(t('audit.freshness_stale'), 'Stock is stale');
    assert.equal(t('audit.history_title'), 'Warehouse Audit History');
    assert.equal(t('audit.source_manual'), 'Manual edit');
    assert.equal(t('audit.source_ocr'), 'Screenshot (OCR)');
    assert.equal(t('audit.archived_screenshot_notice'), 'Archive: screenshot removed after 30 days');
    assert.equal(t('audit.view_screenshot'), 'View screenshot');
    assert.equal(t('audit.btn_history'), 'Stock History');
    assert.equal(t('audit.empty_history'), 'No history recorded yet');
    assert.equal(t('audit.zoom_title'), 'Original Screenshot');

    await setAppLanguage('de');
    assert.equal(t('audit.freshness_fresh'), 'Aktuelle Daten');
    assert.equal(t('audit.freshness_warning'), 'Aktualisierung erforderlich');
    assert.equal(t('audit.freshness_stale'), 'Lager veraltet');
    assert.equal(t('audit.history_title'), 'Lager-Änderungsverlauf');
    assert.equal(t('audit.source_manual'), 'Manuelle Bearbeitung');
    assert.equal(t('audit.source_ocr'), 'Screenshot (OCR)');
    assert.equal(t('audit.archived_screenshot_notice'), 'Archiv: Screenshot nach 30 Tagen gelöscht');
    assert.equal(t('audit.view_screenshot'), 'Screenshot ansehen');
    assert.equal(t('audit.btn_history'), 'Lager-Verlauf');
    assert.equal(t('audit.empty_history'), 'Noch kein Änderungsverlauf vorhanden');
    assert.equal(t('audit.zoom_title'), 'Original-Screenshot');

    await setAppLanguage('ru');
  });

  await test('telegram and templates dictionaries provide required keys across ru, en, de', async () => {
    await setAppLanguage('ru');
    assert.equal(t('telegram.card_title'), 'Интеграция с Telegram');
    assert.equal(t('telegram.status_connected'), 'Подключен');
    assert.equal(t('telegram.status_not_connected'), 'Не привязан');
    assert.equal(t('telegram.btn_connect'), '📱 Подключить Telegram');
    assert.equal(t('telegram.btn_disconnect'), 'Отключить');
    assert.equal(t('telegram.notifications_enabled'), 'Уведомления в Telegram');
    assert.equal(t('telegram.admin_nav_title'), 'Уведомления и шаблоны');
    assert.equal(t('telegram.bot_settings_title'), 'Настройки Telegram-бота');
    assert.equal(t('telegram.bot_token'), 'Токен бота (BotFather)');
    assert.equal(t('telegram.staff_chat_id'), 'ID чата штаба');
    assert.equal(t('telegram.btn_generate_staff_pin'), '🔑 Сгенерировать код привязки штаба');
    assert.equal(t('telegram.staff_pin_modal_title'), 'Код привязки чата штаба');
    assert.equal(t('telegram.staff_pin_hint'), 'Добавьте бота в чат штаба и отправьте команду:');
    assert.equal(t('templates.editor_title'), 'Редактор шаблонов сообщений');
    assert.equal(t('templates.select_template'), 'Выберите событие');
    assert.equal(t('templates.available_placeholders'), 'Доступные переменные (кликните для вставки)');
    assert.equal(t('templates.template_text'), 'Текст шаблона (HTML)');
    assert.equal(t('templates.live_preview'), 'Предпросмотр (стиль Telegram)');
    assert.equal(t('templates.btn_save'), '💾 Сохранить шаблон');
    assert.equal(t('templates.btn_reset'), '↩️ Сбросить к базовому');
    assert.equal(t('templates.btn_test'), '🚀 Отправить тест в Telegram');
    assert.equal(t('templates.save_success'), 'Шаблон успешно сохранен');
    assert.equal(t('templates.reset_success'), 'Шаблон сброшен к базовому');
    assert.equal(t('templates.test_success'), 'Тестовое сообщение отправлено в Telegram');

    await setAppLanguage('en');
    assert.equal(t('telegram.card_title'), 'Telegram Integration');
    assert.equal(t('telegram.status_connected'), 'Connected');
    assert.equal(t('telegram.btn_connect'), '📱 Connect Telegram');
    assert.equal(t('templates.editor_title'), 'Notification Template Editor');
    assert.equal(t('templates.btn_save'), '💾 Save Template');

    await setAppLanguage('de');
    assert.equal(t('telegram.card_title'), 'Telegram-Integration');
    assert.equal(t('telegram.status_connected'), 'Verbunden');
    assert.equal(t('telegram.btn_connect'), '📱 Telegram verbinden');
    assert.equal(t('templates.editor_title'), 'Benachrichtigungsvorlagen-Editor');
    assert.equal(t('templates.btn_save'), '💾 Vorlage speichern');

    await setAppLanguage('ru');
  });

  await test('UI namespaces (cabinet, events, sectors, catalog, pending, users) provide translations across ru, en, de', async () => {
    await setAppLanguage('ru');
    assert.equal(t('cabinet.title'), 'Личный кабинет');
    assert.equal(t('cabinet.sector_params'), 'Параметры сектора');
    assert.equal(t('cabinet.stocks_title'), 'Запасы гильдейца');
    assert.equal(t('cabinet.star_ready'), '5★ Готово');
    assert.equal(t('cabinet.star_needed'), 'Нужно 5★');
    assert.equal(t('events.title'), 'Ивенты');
    assert.equal(t('events.btn_create_season'), '⚡ Создать сезон');
    assert.equal(t('events.btn_create_event'), '+ Создать ивент');
    assert.equal(t('sectors.title'), 'Секторы альянса');
    assert.equal(t('catalog.title'), 'Каталог офицеров');
    assert.equal(t('pending.title'), 'Заявки на регистрацию участников');
    assert.equal(t('users.title'), 'Управление пользователями гильдии');

    await setAppLanguage('en');
    assert.equal(t('cabinet.title'), 'My Cabinet');
    assert.equal(t('cabinet.sector_params'), 'Sector Parameters');
    assert.equal(t('cabinet.stocks_title'), 'Member Stocks');
    assert.equal(t('cabinet.star_ready'), '5★ Ready');
    assert.equal(t('cabinet.star_needed'), 'Need 5★');
    assert.equal(t('events.title'), 'Events');
    assert.equal(t('events.btn_create_season'), '⚡ Create Season');
    assert.equal(t('events.btn_create_event'), '+ Create Event');
    assert.equal(t('sectors.title'), 'Alliance Sectors');
    assert.equal(t('catalog.title'), 'Officer Catalog');
    assert.equal(t('pending.title'), 'Member Registration Requests');
    assert.equal(t('users.title'), 'Guild User Management');

    await setAppLanguage('de');
    assert.equal(t('cabinet.title'), 'Mein Kabinett');
    assert.equal(t('cabinet.sector_params'), 'Sektor-Parameter');
    assert.equal(t('cabinet.stocks_title'), 'Mitglieds-Vorräte');
    assert.equal(t('cabinet.star_ready'), '5★ Bereit');
    assert.equal(t('cabinet.star_needed'), '5★ Benötigt');
    assert.equal(t('events.title'), 'Events');
    assert.equal(t('events.btn_create_season'), '⚡ Saison erstellen');
    assert.equal(t('events.btn_create_event'), '+ Event erstellen');
    assert.equal(t('sectors.title'), 'Allianz-Sektoren');
    assert.equal(t('catalog.title'), 'Offizierskatalog');
    assert.equal(t('pending.title'), 'Mitglieder-Registrierungsanträge');
    assert.equal(t('users.title'), 'Gilden-Benutzerverwaltung');

    await setAppLanguage('ru');
  });

  await test('mieru dictionary provides required keys across ru, en, de', async () => {
    await setAppLanguage('ru');
    assert.equal(t('mieru.card_title'), 'Туннель Mieru (обход блокировок Telegram)');
    assert.equal(t('mieru.toggle_enable'), 'Использовать туннель Mieru для Telegram');
    assert.equal(t('mieru.btn_save'), '💾 Сохранить настройки Mieru');
    assert.equal(t('mieru.btn_test'), '⚡ Проверить туннель Mieru');

    await setAppLanguage('en');
    assert.equal(t('mieru.card_title'), 'Mieru Tunnel (Telegram Anti-Censorship)');
    assert.equal(t('mieru.toggle_enable'), 'Use Mieru tunnel for Telegram');
    assert.equal(t('mieru.btn_save'), '💾 Save Mieru Settings');
    assert.equal(t('mieru.btn_test'), '⚡ Test Mieru Tunnel');

    await setAppLanguage('de');
    assert.equal(t('mieru.card_title'), 'Mieru-Tunnel (Telegram-Zensurumgehung)');
    assert.equal(t('mieru.toggle_enable'), 'Mieru-Tunnel für Telegram verwenden');
    assert.equal(t('mieru.btn_save'), '💾 Mieru-Einstellungen speichern');
    assert.equal(t('mieru.btn_test'), '⚡ Mieru-Tunnel testen');

    await setAppLanguage('ru');
  });

  console.log(`\nTests finished. Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
