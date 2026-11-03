/**
 * KoW Tracker - i18n Multilingual Support (RU, EN, DE)
 * Built on top of i18next (v23.x).
 * Supports browser environment (window.i18next) and Node.js runtime.
 */

const I18N_RESOURCES = {
  ru: {
    translation: {
      common: {
        save: "Сохранить",
        cancel: "Отмена",
        delete: "Удалить",
        edit: "Редактировать",
        close: "Закрыть",
        online: "Онлайн",
        offline: "Офлайн",
        loading: "Загрузка...",
        search: "Поиск...",
        all: "Все",
        actions: "Действия",
        back: "Назад",
        confirm: "Подтвердить",
        yes: "Да",
        no: "Нет",
        status: "Статус",
        date: "Дата",
        version: "Версия"
      },
      nav: {
        calendar: "Календарь",
        sectors: "Секторы",
        officers: "Каталог офицеров",
        event_types: "Типы ивентов",
        calculator: "Калькулятор",
        users_rights: "Пользователи и права",
        my_cabinet: "Личный кабинет",
        export_excel: "Экспорт Excel",
        export_json: "Экспорт JSON",
        import_json: "Импорт JSON"
      },
      roles: {
        r5: "Р5 — Лидер",
        r4: "Р4 — Офицер",
        r3: "Р3 — Рядовой",
        owner: "Владелец",
        no_owner: "Без владельца",
        change_owner: "Сменить владельца"
      },
      game: {
        officer_types: {
          tank: "Танк",
          infantry: "Пехота",
          tank_destroyer: "ПТ-САУ",
          garrison: "Гарнизон",
          siege: "Осада"
        },
        awards: {
          place_1: "1 место",
          place_2: "2 место",
          place_3: "3 место",
          place_4: "4 место",
          top_1: "ТОП-1",
          top_2: "ТОП-2",
          top_3: "ТОП-3",
          top_4: "ТОП-4"
        },
        resources: {
          coupons: "Купоны",
          puzzles: "Пазлы",
          chests: "Сундуки",
          stars: "Звезды",
          star_coupons: "Звездные купоны",
          legendary_stars: "Легендарные звезды"
        },
        items: {
          coupons: "Купоны",
          puzzles: "Пазлы",
          chests: "Сундуки",
          stars: "Звезды",
          star_coupons: "Звездные купоны",
          legendary_stars: "Легендарные звезды"
        },
        sim: {
          guaranteed_mode: "Гарантированный режим",
          optimistic_mode: "Оптимистичный режим",
          manual_mode: "Ручной ввод",
          target_level: "Целевой уровень",
          daily_income: "Ежедневный доход",
          savings_badge: "⚡ Экономия: {{days}} дн.!",
          timeline_title: "График прогресса",
          finish_reached: "Цель достигнута",
          deficit: "Дефицит",
          current_progress: "Текущий прогресс",
          without_events: "Без учета ивентов",
          with_events: "С учетом ивентов",
          no_events_guaranteed: "Без ивентов (гарант.)",
          no_events_optimistic: "Без ивентов (оптим.)"
        }
      },
      toasts: {
        saved_success: "Изменения успешно сохранены",
        saved_successfully: "Изменения успешно сохранены",
        error_occurred: "Произошла ошибка: {{error}}",
        access_denied: "Доступ ограничен правами ранга",
        import_success: "Импортировано {{count}} записей",
        export_success: "Данные успешно экспортированы"
      }
    }
  },
  en: {
    translation: {
      common: {
        save: "Save",
        cancel: "Cancel",
        delete: "Delete",
        edit: "Edit",
        close: "Close",
        online: "Online",
        offline: "Offline",
        loading: "Loading...",
        search: "Search...",
        all: "All",
        actions: "Actions",
        back: "Back",
        confirm: "Confirm",
        yes: "Yes",
        no: "No",
        status: "Status",
        date: "Date",
        version: "Version"
      },
      nav: {
        calendar: "Calendar",
        sectors: "Sectors",
        officers: "Officer Catalog",
        event_types: "Event Types",
        calculator: "Calculator",
        users_rights: "Users & Rights",
        my_cabinet: "My Cabinet",
        export_excel: "Export Excel",
        export_json: "Export JSON",
        import_json: "Import JSON"
      },
      roles: {
        r5: "R5 — Leader",
        r4: "R4 — Officer",
        r3: "R3 — Member",
        owner: "Owner",
        no_owner: "No Owner",
        change_owner: "Change Owner"
      },
      game: {
        officer_types: {
          tank: "Tank",
          infantry: "Infantry",
          tank_destroyer: "Tank Destroyer",
          garrison: "Garrison",
          siege: "Siege"
        },
        awards: {
          place_1: "1st Place",
          place_2: "2nd Place",
          place_3: "3rd Place",
          place_4: "4th Place",
          top_1: "TOP-1",
          top_2: "TOP-2",
          top_3: "TOP-3",
          top_4: "TOP-4"
        },
        resources: {
          coupons: "Coupons",
          puzzles: "Puzzles",
          chests: "Chests",
          stars: "Stars",
          star_coupons: "Star Coupons",
          legendary_stars: "Legendary Stars"
        },
        items: {
          coupons: "Coupons",
          puzzles: "Puzzles",
          chests: "Chests",
          stars: "Stars",
          star_coupons: "Star Coupons",
          legendary_stars: "Legendary Stars"
        },
        sim: {
          guaranteed_mode: "Guaranteed Mode",
          optimistic_mode: "Optimistic Mode",
          manual_mode: "Manual Mode",
          target_level: "Target Level",
          daily_income: "Daily Income",
          savings_badge: "⚡ Savings: {{days}} days!",
          timeline_title: "Progress Timeline",
          finish_reached: "Goal Reached",
          deficit: "Deficit",
          current_progress: "Current Progress",
          without_events: "Without Events",
          with_events: "With Events",
          no_events_guaranteed: "No Events (Guaranteed)",
          no_events_optimistic: "No Events (Optimistic)"
        }
      },
      toasts: {
        saved_success: "Changes saved successfully",
        saved_successfully: "Changes saved successfully",
        error_occurred: "An error occurred: {{error}}",
        access_denied: "Access denied by rank permissions",
        import_success: "Imported {{count}} records",
        export_success: "Data exported successfully"
      }
    }
  },
  de: {
    translation: {
      common: {
        save: "Speichern",
        cancel: "Abbrechen",
        delete: "Löschen",
        edit: "Bearbeiten",
        close: "Schließen",
        online: "Online",
        offline: "Offline",
        loading: "Wird geladen...",
        search: "Suchen...",
        all: "Alle",
        actions: "Aktionen",
        back: "Zurück",
        confirm: "Bestätigen",
        yes: "Ja",
        no: "Nein",
        status: "Status",
        date: "Datum",
        version: "Version"
      },
      nav: {
        calendar: "Kalender",
        sectors: "Sektoren",
        officers: "Offizierskatalog",
        event_types: "Event-Typen",
        calculator: "Rechner",
        users_rights: "Benutzer & Rechte",
        my_cabinet: "Mein Kabinett",
        export_excel: "Excel-Export",
        export_json: "JSON-Export",
        import_json: "JSON-Import"
      },
      roles: {
        r5: "R5 — Anführer",
        r4: "R4 — Offizier",
        r3: "R3 — Mitglied",
        owner: "Besitzer",
        no_owner: "Kein Besitzer",
        change_owner: "Besitzer wechseln"
      },
      game: {
        officer_types: {
          tank: "Panzer",
          infantry: "Infanterie",
          tank_destroyer: "Jagdpanzer",
          garrison: "Garnison",
          siege: "Belagerung"
        },
        awards: {
          place_1: "1. Platz",
          place_2: "2. Platz",
          place_3: "3. Platz",
          place_4: "4. Platz",
          top_1: "TOP-1",
          top_2: "TOP-2",
          top_3: "TOP-3",
          top_4: "TOP-4"
        },
        resources: {
          coupons: "Coupons",
          puzzles: "Puzzles",
          chests: "Kisten",
          stars: "Sterne",
          star_coupons: "Stern-Coupons",
          legendary_stars: "Legendäre Sterne"
        },
        items: {
          coupons: "Coupons",
          puzzles: "Puzzles",
          chests: "Kisten",
          stars: "Sterne",
          star_coupons: "Stern-Coupons",
          legendary_stars: "Legendäre Sterne"
        },
        sim: {
          guaranteed_mode: "Garantierter Modus",
          optimistic_mode: "Optimistischer Modus",
          manual_mode: "Manueller Modus",
          target_level: "Zielstufe",
          daily_income: "Tägliches Einkommen",
          savings_badge: "⚡ Ersparnis: {{days}} Tage!",
          timeline_title: "Fortschritts-Zeitachse",
          finish_reached: "Ziel erreicht",
          deficit: "Defizit",
          current_progress: "Aktueller Fortschritt",
          without_events: "Ohne Events",
          with_events: "Mit Events",
          no_events_guaranteed: "Ohne Events (Garantiert)",
          no_events_optimistic: "Ohne Events (Optimistisch)"
        }
      },
      toasts: {
        saved_success: "Änderungen erfolgreich gespeichert",
        saved_successfully: "Änderungen erfolgreich gespeichert",
        error_occurred: "Ein Fehler ist aufgetreten: {{error}}",
        access_denied: "Zugriff durch Rangberechtigungen verweigert",
        import_success: "{{count}} Datensätze importiert",
        export_success: "Daten erfolgreich exportiert"
      }
    }
  }
};

let currentLang = 'ru';
let i18nInstance = null;

function getStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch (e) {}
  return null;
}

function resolveI18next() {
  if (typeof window !== 'undefined' && window.i18next) {
    return window.i18next;
  }
  try {
    return require('./vendor/i18next.min.js');
  } catch (e1) {
    try {
      return require('i18next');
    } catch (e2) {
      return null;
    }
  }
}

async function initI18n(options = {}) {
  i18nInstance = options.i18nextInstance || resolveI18next();

  let defaultLang = 'ru';
  const storage = getStorage();
  if (options.lng && ['ru', 'en', 'de'].includes(options.lng)) {
    defaultLang = options.lng;
  } else if (storage) {
    const saved = storage.getItem('kow_lang');
    if (saved && ['ru', 'en', 'de'].includes(saved)) {
      defaultLang = saved;
    } else if (typeof navigator !== 'undefined' && navigator.language) {
      const nav = navigator.language.slice(0, 2).toLowerCase();
      if (['en', 'de'].includes(nav)) {
        defaultLang = nav;
      }
    }
  }

  currentLang = defaultLang;

  if (i18nInstance && typeof i18nInstance.init === 'function') {
    await i18nInstance.init({
      lng: defaultLang,
      fallbackLng: 'ru',
      resources: I18N_RESOURCES,
      interpolation: {
        escapeValue: false
      },
      ...options
    });
  }

  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = defaultLang;
    updateStaticDOMTranslations();
  }

  return i18nInstance;
}

function t(key, options) {
  if (i18nInstance && typeof i18nInstance.t === 'function') {
    const res = i18nInstance.t(key, options);
    if (res !== undefined && res !== key) {
      return res;
    }
  }

  // Fallback to dictionary lookup directly if i18next uninitialized or returns key
  const activeLang = getAppLanguage();
  const langResources = [activeLang, 'ru'];

  for (const lng of langResources) {
    const dict = I18N_RESOURCES[lng]?.translation;
    if (!dict) continue;

    const parts = String(key).split('.');
    let val = dict;
    for (const part of parts) {
      if (val && typeof val === 'object' && part in val) {
        val = val[part];
      } else {
        val = null;
        break;
      }
    }

    if (typeof val === 'string') {
      if (options && typeof options === 'object') {
        return val.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
          return options[k] !== undefined ? options[k] : `{{${k}}}`;
        });
      }
      return val;
    }
  }

  return key;
}

function getAppLanguage() {
  if (i18nInstance && i18nInstance.language) {
    return i18nInstance.language.slice(0, 2).toLowerCase();
  }
  return currentLang;
}

async function setAppLanguage(lang) {
  if (!['ru', 'en', 'de'].includes(lang)) {
    return currentLang;
  }
  currentLang = lang;
  if (i18nInstance && typeof i18nInstance.changeLanguage === 'function') {
    await i18nInstance.changeLanguage(lang);
  }
  const storage = getStorage();
  if (storage) {
    storage.setItem('kow_lang', lang);
  }
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = lang;
  }
  updateStaticDOMTranslations();
  return currentLang;
}

function getLocalizedOfficerType(type) {
  if (!type) return '';
  const keyMap = {
    'tank': 'game.officer_types.tank',
    'infantry': 'game.officer_types.infantry',
    'tank_destroyer': 'game.officer_types.tank_destroyer',
    'garrison': 'game.officer_types.garrison',
    'siege': 'game.officer_types.siege',
    'Танк': 'game.officer_types.tank',
    'Пехота': 'game.officer_types.infantry',
    'ПТ-Сау': 'game.officer_types.tank_destroyer',
    'ПТ-САУ': 'game.officer_types.tank_destroyer',
    'Горнизон': 'game.officer_types.garrison',
    'Гарнизон': 'game.officer_types.garrison',
    'Осада': 'game.officer_types.siege'
  };

  const str = String(type).trim();
  const key = keyMap[str] || keyMap[str.toLowerCase()] || `game.officer_types.${str}`;
  const translated = t(key);
  if (translated !== key) {
    return translated;
  }
  return type;
}

function updateStaticDOMTranslations(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || typeof d.querySelectorAll !== 'function') return;

  const textNodes = d.querySelectorAll('[data-i18n]');
  if (textNodes && typeof textNodes.forEach === 'function') {
    textNodes.forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (key) {
        el.textContent = t(key);
      }
    });
  }

  const attrNodes = d.querySelectorAll('[data-i18n-attr]');
  if (attrNodes && typeof attrNodes.forEach === 'function') {
    attrNodes.forEach(el => {
      const raw = el.getAttribute('data-i18n-attr');
      if (!raw) return;
      const rules = raw.split(';');
      for (const rule of rules) {
        const idx = rule.indexOf(':');
        if (idx > -1) {
          const attr = rule.slice(0, idx).trim();
          const key = rule.slice(idx + 1).trim();
          if (attr && key) {
            el.setAttribute(attr, t(key));
          }
        }
      }
    });
  }
}

const i18nExports = {
  I18N_RESOURCES,
  initI18n,
  t,
  getAppLanguage,
  setAppLanguage,
  getLocalizedOfficerType,
  updateStaticDOMTranslations
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = i18nExports;
}

if (typeof window !== 'undefined') {
  window.i18n = i18nExports;
  window.I18N_RESOURCES = I18N_RESOURCES;
  window.initI18n = initI18n;
  window.t = t;
  window.getLocalizedOfficerType = getLocalizedOfficerType;
  window.setAppLanguage = setAppLanguage;
  window.getAppLanguage = getAppLanguage;
  window.updateStaticDOMTranslations = updateStaticDOMTranslations;
}
