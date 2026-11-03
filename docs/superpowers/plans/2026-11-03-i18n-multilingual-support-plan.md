# План реализации: Мультиязычность интерфейса KoW Tracker (RU, EN, DE) на базе i18next

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать поддержку трех языков интерфейса (Русский, Английский, Немецкий) с переключателем в шапке, автоопределением языка, мгновенным переключением без перезагрузки страницы (Hot Swap) и полной офлайн-работой в PWA на базе библиотеки `i18next`.

**Architecture:** Подключение клиентской библиотеки `i18next` с вендорингом локальной копии для автономной работы PWA. Модуль `i18n.js` со словарями ресурсов `I18N_RESOURCES` (`ru`, `en`, `de`), функцией инициализации и хелпером перевода. Разметка статических узлов `index.html` через `data-i18n` / `data-i18n-attr`, динамический селектор в `.topbar-right` и оборачивание динамических строк `app.js` в `t()`. Комплексные тесты полноты словарей и интерполяции в `i18n.test.js`.

**Tech Stack:** `i18next` (v23.x), Vanilla JavaScript (ES6+), HTML5, CSS3, Service Worker Cache (`sw.js`), Node.js для TDD-тестов (`i18n.test.js`).

**Spec:** `docs/superpowers/specs/2026-11-03-i18n-multilingual-support-design.md`

---

## Global Constraints

- **Языки интерфейса:** Русский (`ru` — язык по умолчанию), Английский (`en`), Немецкий (`de`).
- **Зависимости:** По прямому согласованию с пользователем внедряется библиотека `i18next` (клиентская часть и dev-зависимость для тестов). Серверный слой (`server.js`, `db.js`) сохраняет независимость и нативные модули Node.js.
- **Офлайн и PWA:** Библиотека и словари должны гарантированно работать без доступа к интернету (локальное кэширование в `sw.js`).
- **Обратная совместимость:** Данные SQLite (`data/kow.db`) и форматы JSON-бэкапов (`kow_v2`) не модифицируются; внутренние системные ключи типов войск и ролей остаются неизменными.
- **GitFlow:** Разработка в ветке `feature/i18n-multilingual-support`, релиз `release/v3.24.0`, мерж `--no-ff` в `main`. **В удаленный репозиторий (`git push origin`) не пушить** согласно явному указанию пользователя.

---

## Review Focus

1. **Паритет словарей (Dictionary Parity):** Все ключи, определенные в `ru`, обязаны присутствовать в `en` и `de`, возвращая осмысленный перевод, а не пустые строки или сырые ключи.
2. **Мгновенное переключение (Hot Swap):** Смена языка в селекторе не должна вызывать полную перезагрузку страницы (`location.reload()`) — обновляется статический DOM (`updateStaticDOMTranslations`) и перерисовывается активный экран (`renderCurrentPage`).
3. **Безопасность интерполяции (XSS):** Параметры интерполяции (например, имя пользователя или название ивента) должны экранироваться при вставке в HTML-разметку.
4. **Сохранение и автоопределение:** Язык сохраняется в `localStorage['kow_lang']`; при первом входе проверяется `navigator.language` (если язык браузера `en` или `de` — активируется он, иначе fallback на `ru`).
5. **Сохранение работоспособности существующих тестов:** 100% существующих тестов (`logic.test.js`, `db.test.js`, `api.test.js`, `deploy.test.js`) должны оставаться полностью зелеными.

---

### Task 1: Инфраструктура i18n, вендоринг библиотеки и модуль словарей (`i18n.js`, `i18n.test.js`)

**Files:**
- Create: `i18n.js`
- Create: `vendor/i18next.min.js`
- Create: `i18n.test.js`
- Modify: `package.json`

**Функционал:**
- Подключение и вендоринг `i18next` (автономный UMD-бандл).
- Структура словарей `I18N_RESOURCES` в `i18n.js` для `ru`, `en`, `de`:
  - `common`: `save`, `cancel`, `delete`, `edit`, `close`, `online`, `offline`, `loading`, `search`, `all`, `actions`, `back`, `confirm`.
  - `nav`: `calendar`, `sectors`, `officers`, `event_types`, `calculator`, `users_rights`, `my_cabinet`, `export_excel`, `export_json`, `import_json`.
  - `roles`: `r5`, `r4`, `r3`, `owner`, `no_owner`.
  - `game`:
    - `officer_types`: `tank`, `infantry`, `tank_destroyer`, `garrison`, `siege`.
    - `resources`: `coupons`, `puzzles`, `chests`, `stars`, `star_coupons`, `legendary_stars`.
    - `sim`: `guaranteed_mode`, `optimistic_mode`, `manual_mode`, `target_level`, `daily_income`, `savings_badge`, `timeline_title`, `finish_reached`.
  - `toasts`: `saved_success`, `error_occurred`, `access_denied`, `import_success`, `export_success`.
- Функции:
  - `initI18n()`: инициализация `i18next` с автоопределением и fallback на `'ru'`.
  - `t(key, options)`: сокращенный вызов перевода с безопасным fallback.
  - `getAppLanguage()` / `setAppLanguage(lang)`.
  - `updateStaticDOMTranslations()`: обновление узлов с атрибутами `data-i18n` и `data-i18n-attr`.

- [ ] **Step 1: Написать падающие тесты в `i18n.test.js`**
  - Тест 1: Инициализация модуля и доступность словарей для `ru`, `en`, `de`.
  - Тест 2: Проверка 100% паритета ключей между `ru`, `en`, `de` (рекурсивный обход, отсутствие пропущенных ключей).
  - Тест 3: Проверка интерполяции параметров (`t('toasts.import_success', { count: 5 })`).
  - Тест 4: Проверка fallback на `ru` при запросе несуществующего перевода.
  - Тест 5: Проверка справочника типов войск (`tank` -> `Танк` / `Tank` / `Panzer`).

- [ ] **Step 2: Запустить тест и убедиться в падении (RED)**
  - Run: `node i18n.test.js`
  - Expected: FAIL (`i18n.js` не найден).

- [ ] **Step 3: Скачать/вендорить `i18next.min.js` и реализовать `i18n.js`**
  - Разместить автономную версию `vendor/i18next.min.js`.
  - Сформировать полные словари `ru`, `en`, `de` в `i18n.js`.
  - Реализовать API модуля с поддержкой браузера и Node.js (`module.exports`).
  - Добавить `node i18n.test.js` в скрипт `test` в `package.json`.

- [ ] **Step 4: Запустить тесты и убедиться в успехе (GREEN)**
  - Run: `node i18n.test.js`
  - Expected: PASS (все тесты локализации проходят со 100% успехом).

- [ ] **Step 5: Коммит**
  - Run:
    ```bash
    git add package.json vendor/ i18n.js i18n.test.js
    git commit -m "feat(i18n): introduce i18next runtime, dictionaries and parity tests"
    ```

---

### Task 2: UI переключателя языков в шапке и разметка статики (`index.html`, `style.css`, `sw.js`)

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Modify: `sw.js`

**Функционал:**
- Размещение кнопки-переключателя с выпадающим меню языков в `.topbar-right`:
  - Иконка флага текущего языка (🇷🇺 / 🇬🇧 / 🇩🇪) и краткий код (`RU`, `EN`, `DE`).
  - Выпадающий список выбора языка с подсветкой активного.
- Разметка всех статических элементов меню и сайдбара в `index.html` атрибутами `data-i18n` и `data-i18n-attr`.
- Подключение `<script src="vendor/i18next.min.js"></script>` и `<script src="i18n.js"></script>` в `<head>`.
- Стилизация селектора языка в `style.css` (адаптивность, hover-эффекты, позиционирование выпадающего меню).
- Добавление `vendor/i18next.min.js` и `i18n.js` в список `STATIC_ASSETS` в `sw.js`.

- [ ] **Step 1: Реализовать CSS-стили селектора языков в `style.css`**
  - Стили для `.lang-switcher-container`, `.btn-lang-toggle`, `.lang-dropdown-menu`, `.lang-option`.
  - Адаптивные медиа-запросы для мобильных экранов.

- [ ] **Step 2: Внедрить переключатель и разметку `data-i18n` в `index.html`**
  - Добавить теги скриптов в `<head>`.
  - Разместить блок переключателя в `.topbar-right`.
  - Разметить атрибутами `data-i18n` пункты сайдбара, кнопки экспорта, статус сети, заголовки модалок.

- [ ] **Step 3: Обновить кэш `sw.js`**
  - Добавить `vendor/i18next.min.js` и `i18n.js` в кэшируемые ассеты PWA.

- [ ] **Step 4: Проверить синтаксис и запустить тесты**
  - Run: `node -c sw.js && node i18n.test.js`
  - Expected: PASS.

- [ ] **Step 5: Коммит**
  - Run:
    ```bash
    git add index.html style.css sw.js
    git commit -m "feat(ui): add topbar language switcher, static i18n markup and pwa caching"
    ```

---

### Task 3: Динамическая локализация интерфейса в `app.js`

**Files:**
- Modify: `app.js`

**Функционал:**
- Вызов `await initI18n()` на старте приложения (`DOMContentLoaded` / `initApp`).
- Реализация обработчика `changeAppLanguage(lang)`:
  - Смена языка в `i18next`.
  - Сохранение в `localStorage`.
  - Вызов `updateStaticDOMTranslations()`.
  - Мгновенная перерисовка текущего экрана (`renderCurrentPage()` / `renderSidebarNav()`).
- Хелпер `getLocalizedOfficerType(type)`: локализация типов войск во всех таблицах и карточках.
- Оборачивание ключевых динамических шаблонов в `t()`:
  - Тосты и уведомления (`toast(t(...))`).
  - Бейджи ролей (`Р5 — Лидер`, `Р4 — Офицер`, `Р3 — Рядовой`).
  - Карточки симулятора (свитчер режимов, заголовки, бейдж экономии `⚡ Экономия: N дней!`).
  - Шапки таблиц и действия.

- [ ] **Step 1: Реализовать интеграцию инициализации и смены языка в `app.js`**
  - Подключить `initI18n()` в цикл старта приложения.
  - Реализовать `toggleLangDropdown()`, `changeAppLanguage(lang)`, `updateLangSwitcherUI(lang)`.
  - Реализовать хелпер `getLocalizedOfficerType(type)`.

- [ ] **Step 2: Обернуть строки ключевых модулей в `t(...)`**
  - Сайдбар, Личный кабинет, Калькулятор, Каталог офицеров, Секторы.

- [ ] **Step 3: Проверить синтаксис и выполнить прогон всех тестов**
  - Run: `node -c app.js && npm test`
  - Expected: PASS (все 140+ существующих тестов и тесты `i18n.test.js` проходят со 100% успехом).

- [ ] **Step 4: Коммит**
  - Run:
    ```bash
    git add app.js
    git commit -m "feat(app): localize dynamic templates, officer types and hot-swap language rendering"
    ```

---

### Task 4: Комплексная верификация, документация и релиз v3.24.0 по GitFlow

**Files:**
- Modify: `package.json`
- Modify: `index.html`
- Modify: `sw.js`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Полный запуск тестового набора проекта**
  - Run: `node logic.test.js && node db.test.js && node api.test.js && node i18n.test.js && node deploy.test.js`
  - Expected: 0 failures, 100% pass.

- [ ] **Step 2: Подготовка релизной ветки `release/v3.24.0`**
  - Повышение версии до `3.24.0` в `package.json`, `index.html`, `sw.js` (`kow-cache-v3.24.0`).
  - Заполнение `CHANGELOG.md` по стандарту Keep a Changelog на трех языках / описанием i18n.
  - Коммит: `chore(release): prepare v3.24.0`.

- [ ] **Step 3: Слияние в `main` и тегирование**
  - Merge с флагом `--no-ff` в ветку `main`.
  - Аннотированный тег: `git tag -a v3.24.0 -m "Release v3.24.0: Multilingual support (RU, EN, DE) with i18next"`.
  - Удаление временных веток разработки.
  - **НЕ ПУШИТЬ в `origin`** согласно правилу пользователя.
