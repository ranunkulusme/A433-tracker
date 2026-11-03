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
    assert.equal(t('nav.calendar'), 'Календарь');
    assert.equal(t('roles.r5'), 'Р5 — Лидер');
  });

  await test('language switching to en and de with setAppLanguage', async () => {
    await setAppLanguage('en');
    assert.equal(getAppLanguage(), 'en');
    assert.equal(t('common.save'), 'Save');
    assert.equal(t('common.cancel'), 'Cancel');
    assert.equal(t('nav.calendar'), 'Calendar');
    assert.equal(t('roles.r5'), 'R5 — Leader');

    await setAppLanguage('de');
    assert.equal(getAppLanguage(), 'de');
    assert.equal(t('common.save'), 'Speichern');
    assert.equal(t('common.cancel'), 'Abbrechen');
    assert.equal(t('nav.calendar'), 'Kalender');
    assert.equal(t('roles.r5'), 'R5 — Anführer');

    // Switch back to ru
    await setAppLanguage('ru');
    assert.equal(getAppLanguage(), 'ru');
    assert.equal(t('common.save'), 'Сохранить');
  });

  await test('interpolation of toast messages and sim parameters in all languages', async () => {
    await setAppLanguage('ru');
    assert.equal(t('toasts.import_success', { count: 12 }), 'Импортировано 12 записей');
    assert.equal(t('toasts.error_occurred', { error: '500' }), 'Произошла ошибка: 500');
    assert.equal(t('game.sim.savings_badge', { days: 7 }), '⚡ Экономия: 7 дн.!');

    await setAppLanguage('en');
    assert.equal(t('toasts.import_success', { count: 12 }), 'Imported 12 records');
    assert.equal(t('toasts.error_occurred', { error: '500' }), 'An error occurred: 500');
    assert.equal(t('game.sim.savings_badge', { days: 7 }), '⚡ Savings: 7 days!');

    await setAppLanguage('de');
    assert.equal(t('toasts.import_success', { count: 12 }), '12 Datensätze importiert');
    assert.equal(t('toasts.error_occurred', { error: '500' }), 'Ein Fehler ist aufgetreten: 500');
    assert.equal(t('game.sim.savings_badge', { days: 7 }), '⚡ Ersparnis: 7 Tage!');

    // Reset back to ru
    await setAppLanguage('ru');
  });

  await test('safe fallback when key does not exist or translation is missing', () => {
    assert.equal(t('non_existent.super_key'), 'non_existent.super_key');
  });

  await test('getLocalizedOfficerType translates types across ru, en, de', async () => {
    await setAppLanguage('ru');
    assert.equal(getLocalizedOfficerType('tank'), 'Танк');
    assert.equal(getLocalizedOfficerType('Танк'), 'Танк');
    assert.equal(getLocalizedOfficerType('Пехота'), 'Пехота');
    assert.equal(getLocalizedOfficerType('ПТ-Сау'), 'ПТ-САУ');
    assert.equal(getLocalizedOfficerType('Горнизон'), 'Гарнизон');
    assert.equal(getLocalizedOfficerType('Осада'), 'Осада');

    await setAppLanguage('en');
    assert.equal(getLocalizedOfficerType('tank'), 'Tank');
    assert.equal(getLocalizedOfficerType('Танк'), 'Tank');
    assert.equal(getLocalizedOfficerType('Пехота'), 'Infantry');
    assert.equal(getLocalizedOfficerType('ПТ-Сау'), 'Tank Destroyer');
    assert.equal(getLocalizedOfficerType('Горнизон'), 'Garrison');
    assert.equal(getLocalizedOfficerType('Осада'), 'Siege');

    await setAppLanguage('de');
    assert.equal(getLocalizedOfficerType('tank'), 'Panzer');
    assert.equal(getLocalizedOfficerType('Танк'), 'Panzer');
    assert.equal(getLocalizedOfficerType('Пехота'), 'Infanterie');
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

  console.log(`\nTests finished. Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
