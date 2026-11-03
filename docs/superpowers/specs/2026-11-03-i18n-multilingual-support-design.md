# Спецификация: Перевод интерфейса KoW Tracker на английский и немецкий языки на базе i18next (RU, EN, DE)

## 1. Контекст и цели (Intent & Why)

KoW Tracker активно используется не только русскоязычными участниками, но и международными офицерами и рядовыми игроками (Р3) альянсов в игре Kiss of War / Sea War: Raid. В настоящее время весь пользовательский интерфейс, системные уведомления, навигация и игровые справочники жестко зашиты на русском языке в `index.html`, `app.js` и `logic.js`. Это создает языковой барьер для англо- и немецкоязычных пользователей при координации на ивентах, распределении наград и работе в личном кабинете.

### Цель
Реализовать полноценную мультиязычность приложения с поддержкой трех языков (**Русский**, **Английский**, **Немецкий**) и динамическим переключателем языка в шапке приложения. По прямому согласованию с пользователем в качестве архитектурного исключения из правила zero-dependency для клиентской части утверждается использование проверенной библиотеки **i18next**.

---

## 2. Цели, не-цели и анти-цели

### Цели (Goals)
1. **Поддержка трех языков**: Русский (`ru` — базовый), Английский (`en`), Немецкий (`de`).
2. **Использование i18next**: Подключение библиотеки `i18next` (v23.x) для управления словарями, интерполяцией и плюрализацией.
3. **UI-переключатель языков**: Компактный переключатель в шапке (`topbar`) с отображением текущего языка (🇷🇺 RU / 🇬🇧 EN / 🇩🇪 DE).
4. **Мгновенное переключение (Hot Swap)**: Смена языка интерфейса «на лету» без принудительной перезагрузки страницы (F5): обновление статических элементов DOM и перерисовка активного представления.
5. **Сохранение и автоопределение**:
   - Автоматическое определение языка пользователя при первом запуске через `navigator.language` (с приоритетом EN/DE, иначе fallback на RU).
   - Сохранение выбранного языка в `localStorage` (`kow_lang`).
6. **Офлайн-совместимость (PWA)**: Библиотека `i18next` и файлы локализации кешируются в Service Worker (`sw.js`), обеспечивая бесперебойную работу без интернета.
7. **100% покрытие словарей**: Обеспечение синхронности ключей между `ru`, `en` и `de` с автоматическим fallback на русский язык при отсутствии перевода.

### Не-цели (Non-Goals)
1. Перевод динамических пользовательских данных (ники игроков, текстовые заметки, пользовательские комментарии к секторам).
2. Перевод серверных логов и системных таблиц базы данных SQLite (в БД сохраняются внутренние идентификаторы и введенные пользователем данные).

### Анти-цели (Anti-Goals)
1. Поломка офлайн-режима PWA из-за недоступности CDN (библиотека и словари должны иметь локальный кеш / fallback).
2. Нарушение обратной совместимости импорта и экспорта `kow_v2` (в JSON-дампах внутренние ключи типов офицеров и ролей должны оставаться стабильными).
3. Снижение производительности рендеринга и переключения страниц при локализации.

---

## 3. Ограничения (Constraints)

- **Библиотека локализации**: Клиентская библиотека `i18next` (v23.x). Допустимо подключение через CDN с обязательным включением в кеш Service Worker (`sw.js`) и наличием локальной копии/fallback в проекте.
- **Бэкенд**: Нативные модули Node.js (`node:http`, `node:sqlite`, `node:crypto`) без внешних npm-пакетов.
- **База данных**: Обратная совместимость с SQLite `data/kow.db` и форматом экспорта `kow_v2`.
- **GitFlow**: Разработка в ветке `feature/i18n-multilingual-support`, релизный цикл в `release/vX.Y.Z`, мерж `--no-ff` в `master` с аннотированным тегом версии.
- **TDD**: 100% прохождение тестов (`npm test`), включая новый тестовый набор `i18n.test.js`.

---

## 4. Рассмотренные подходы (Approaches)

1. **Подход 1: Нативный легковесный модуль без внешних библиотек (Zero-dependency)**
   - Собственный словарь и функция `t()`.
   - *Вердикт*: Рассмотрен, отклонен пользователем в пользу готовой индустриальной библиотеки.
2. **Подход 2: Использование библиотеки i18next (ВЫБРАН ПОЛЬЗОВАТЕЛЕМ)**
   - Полнофункциональный движок интернационализации с поддержкой интерполяции, вложенных пространств имен (namespaces) и плюрализации.
   - Делается официальное согласованное исключение из общего правила zero-dependency для фронтенда.

---

## 5. Архитектура и спецификация реализации

### 5.1. Подключение библиотеки и кеширование PWA

В [index.html](file:///Users/ranunkulus/Downloads/KOW/index.html) в блоке `<head>` подключается библиотека `i18next`:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/i18next/23.11.5/i18next.min.js"></script>
<script src="i18n.js"></script>
```

В [sw.js](file:///Users/ranunkulus/Downloads/KOW/sw.js) в список `STATIC_ASSETS` добавляются:
- `https://cdnjs.cloudflare.com/ajax/libs/i18next/23.11.5/i18next.min.js`
- `i18n.js`

### 5.2. Структура словарей и файл `i18n.js`

Файл `i18n.js` экспортирует объект ресурсов локализации и инициализирует `i18next`:

```javascript
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
        actions: "Действия"
      },
      nav: {
        calendar: "Календарь",
        sectors: "Секторы",
        officers: "Каталог офицеров",
        event_types: "Типы ивентов",
        calculator: "Калькулятор",
        my_cabinet: "Личный кабинет",
        export_excel: "Экспорт Excel",
        import_json: "Импорт JSON",
        export_json: "Экспорт JSON"
      },
      roles: {
        r5: "Р5 — Лидер",
        r4: "Р4 — Офицер",
        r3: "Р3 — Рядовой"
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
        items: {
          coupons: "Купоны",
          puzzles: "Пазлы",
          stars: "Звезды"
        }
      },
      toasts: {
        saved_successfully: "Изменения успешно сохранены",
        error_occurred: "Произошла ошибка: {{error}}",
        import_success: "Импортировано {{count}} записей",
        access_denied: "Доступ ограничен правами ранга"
      }
      // ... разделы для экранов calendar, sectors, officers, calculator, cabinet
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
        actions: "Actions"
      },
      nav: {
        calendar: "Calendar",
        sectors: "Sectors",
        officers: "Officer Catalog",
        event_types: "Event Types",
        calculator: "Calculator",
        my_cabinet: "My Cabinet",
        export_excel: "Export Excel",
        import_json: "Import JSON",
        export_json: "Export JSON"
      },
      roles: {
        r5: "R5 — Leader",
        r4: "R4 — Officer",
        r3: "R3 — Member"
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
        items: {
          coupons: "Coupons",
          puzzles: "Puzzles",
          stars: "Stars"
        }
      },
      toasts: {
        saved_successfully: "Changes saved successfully",
        error_occurred: "An error occurred: {{error}}",
        import_success: "Imported {{count}} records",
        access_denied: "Access denied by rank permissions"
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
        actions: "Aktionen"
      },
      nav: {
        calendar: "Kalender",
        sectors: "Sektoren",
        officers: "Offizierskatalog",
        event_types: "Event-Typen",
        calculator: "Rechner",
        my_cabinet: "Mein Kabinett",
        export_excel: "Excel-Export",
        import_json: "JSON-Import",
        export_json: "JSON-Export"
      },
      roles: {
        r5: "R5 — Anführer",
        r4: "R4 — Offizier",
        r3: "R3 — Mitglied"
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
        items: {
          coupons: "Coupons",
          puzzles: "Puzzles",
          stars: "Sterne"
        }
      },
      toasts: {
        saved_successfully: "Änderungen erfolgreich gespeichert",
        error_occurred: "Ein Fehler ist aufgetreten: {{error}}",
        import_success: "{{count}} Datensätze importiert",
        access_denied: "Zugriff durch Rangberechtigungen verweigert"
      }
    }
  }
};
```

### 5.3. Инициализация и API модуля

```javascript
async function initI18n() {
  const savedLang = localStorage.getItem('kow_lang');
  let defaultLang = 'ru';

  if (savedLang && ['ru', 'en', 'de'].includes(savedLang)) {
    defaultLang = savedLang;
  } else if (navigator.language) {
    const navLang = navigator.language.slice(0, 2).toLowerCase();
    if (['en', 'de'].includes(navLang)) {
      defaultLang = navLang;
    }
  }

  await i18next.init({
    lng: defaultLang,
    fallbackLng: 'ru',
    resources: I18N_RESOURCES,
    interpolation: {
      escapeValue: false
    }
  });

  document.documentElement.lang = defaultLang;
  updateStaticDOMTranslations();
}
```

### 5.4. Разметка статики в HTML и автоматическое обновление

В `index.html` статические текстовые узлы размечаются атрибутом `data-i18n`, а атрибуты (например, `placeholder`, `title`, `aria-label`) — атрибутом `data-i18n-attr`:

```html
<!-- Пример в sidebar -->
<a href="#" class="nav-item active" data-page="calendar">
  <svg ...></svg>
  <span data-i18n="nav.calendar">Календарь</span>
</a>

<!-- Пример инпута -->
<input type="text" data-i18n-attr="placeholder:common.search;title:common.search" />
```

Функция обновления статики:
```javascript
function updateStaticDOMTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key && i18next.exists(key)) {
      el.textContent = i18next.t(key);
    }
  });

  document.querySelectorAll('[data-i18n-attr]').forEach(el => {
    const mapping = el.getAttribute('data-i18n-attr').split(';');
    for (const rule of mapping) {
      const [attr, key] = rule.split(':');
      if (attr && key && i18next.exists(key)) {
        el.setAttribute(attr.trim(), i18next.t(key.trim()));
      }
    }
  });
}
```

### 5.5. Пользовательский интерфейс переключателя языков (UI Switcher)

- **Размещение**: В [index.html](file:///Users/ranunkulus/Downloads/KOW/index.html) в элементе `.topbar-right`:
```html
<div class="topbar-right">
  <div class="lang-switcher-container" id="lang-switcher">
    <button class="btn-lang-toggle" onclick="toggleLangDropdown()" aria-label="Выбор языка">
      <span class="lang-flag" id="current-lang-flag">🇷🇺</span>
      <span class="lang-code" id="current-lang-code">RU</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 9l6 6 6-6"/></svg>
    </button>
    <div class="lang-dropdown-menu" id="lang-dropdown-menu" style="display:none">
      <button class="lang-option" onclick="changeAppLanguage('ru')">🇷🇺 Русский (RU)</button>
      <button class="lang-option" onclick="changeAppLanguage('en')">🇬🇧 English (EN)</button>
      <button class="lang-option" onclick="changeAppLanguage('de')">🇩🇪 Deutsch (DE)</button>
    </div>
  </div>
  <button id="network-status-badge" ...>
  ...
</div>
```

- **Логика смены языка**:
```javascript
async function changeAppLanguage(lang) {
  if (!['ru', 'en', 'de'].includes(lang)) return;
  await i18next.changeLanguage(lang);
  localStorage.setItem('kow_lang', lang);
  document.documentElement.lang = lang;

  updateLangSwitcherUI(lang);
  updateStaticDOMTranslations();

  // Ре-рендер активной страницы без перезагрузки браузера
  if (typeof renderCurrentPage === 'function') {
    renderCurrentPage();
  }
}
```

### 5.6. Адаптация игровых справочников и динамического рендеринга в `app.js`

1. **Типы офицеров**:
   В `logic.js` типы войск сохраняются как канонические константы (`'tank'`, `'infantry'`, `'tank_destroyer'`, `'garrison'`, `'siege'`), либо нормализуются функцией `formatOfficerType(type)`.
   В UI отображение происходит через:
   ```javascript
   function getLocalizedOfficerType(type) {
     const keyMap = {
       'Танк': 'game.officer_types.tank',
       'Пехота': 'game.officer_types.infantry',
       'ПТ-Сау': 'game.officer_types.tank_destroyer',
       'Горнизон': 'game.officer_types.garrison',
       'Осада': 'game.officer_types.siege'
     };
     const key = keyMap[type] || `game.officer_types.${type}`;
     return i18next.exists(key) ? i18next.t(key) : type;
   }
   ```
2. **Динамические шаблоны**:
   Все строки внутри шаблонных литералов `app.js` оборачиваются в `i18next.t(...)`.

---

## 6. План тестирования (TDD)

Создается отдельный тестовый файл `i18n.test.js` для запуска в Node.js (`npm test`):

1. **Тест полноты словарей (Parity Check)**:
   - Рекурсивный обход словаря `ru`.
   - Проверка наличия соответствующих ключей в `en` и `de`.
   - Проверка отсутствия пустых строк перевода.
2. **Тест интерполяции**:
   - Проверка подстановки параметров (`i18next.t('toasts.import_success', { count: 5 })`).
3. **Тест fallback-механизма**:
   - Запрос несуществующего в `de` ключа должен возвращать перевод из `ru`.
4. **Тест работы справочников**:
   - Проверка локализации типов войск ('Танк' -> 'Tank' -> 'Panzer').
   - Проверка локализации ролей ('r5' -> 'R5 — Leader' / 'R5 — Anführer').
5. **Проверка синтаксиса**:
   - `node -c i18n.js && node -c app.js`.

---

## 7. Этапы реализации

1. **Этап 1: Инфраструктура i18n и PWA**
   - Подключение `i18next.min.js` в `index.html` и регистрация в кеше `sw.js`.
   - Создание структуры `i18n.js` и тестов `i18n.test.js`.
2. **Этап 2: UI переключателя и статическая разметка**
   - Верстка переключателя языков в топбаре (`style.css`, `index.html`).
   - Разметка статических элементов `index.html` атрибутами `data-i18n`.
   - Реализация функции смены языка и обновления DOM.
3. **Этап 3: Локализация динамического контента `app.js`**
   - Навигация и общие диалоги.
   - Справочники офицеров и ивентов.
   - Календарь, Секторы, Каталог, Калькулятор, Личный кабинет.
4. **Этап 4: Верификация и релиз**
   - Прогон полного набора тестов (`npm test`: `logic.test.js`, `db.test.js`, `api.test.js`, `i18n.test.js`).
   - Релизный цикл GitFlow (`release/v3.23.0` -> мерж в `master` с тегом `v3.23.0`).
