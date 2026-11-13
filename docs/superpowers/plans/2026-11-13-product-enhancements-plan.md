# Product Enhancements & Automation (v3.42.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать ключевые продуктовые улучшения по итогам Product Lens: приём скриншотов склада прямо в Telegram-бот (Zero-touch Data Ingestion), управление часовыми поясами бойцов в Личном кабинете и автоматические утренние напоминания в 09:00 по местному времени игрока в день ивента, генерацию графической инфографики сетки ивента для чатов и архитектурную изоляцию вспомогательного Mieru-модуля.

**Architecture:** Нативный стек Node.js 22 (zero external npm dependencies), SQLite база данных с миграцией таймзон пользователей, Telegram Bot API webhook с поддержкой медиа-файлов и команд `/stock`, адаптивный планировщик утренних напоминаний на бэкенде с учётом персонального времени бойцов (09:00 local time) и защитой от ночного спама при старте ивентов в 00:00 UTC, Canvas-генератор постеров на клиенте с отправкой через `sendPhoto`.

**Tech Stack:** Vanilla JavaScript (ES2022+), Node.js native (`node:http`, `node:sqlite`, `node:crypto`, `node:fs`), HTML5 Canvas, SQLite (`kow.db`), Telegram Bot API, i18next (RU, EN, DE).

**Spec:** `PRODUCT-BRIEF.md`

## Global Constraints

- Нулевые внешние npm-зависимости бэкенда (`node:http`, `node:sqlite`, `node:crypto`, `node:fs`, `node:path`, native `fetch`).
- Строгая методология GitFlow: разработка ведётся в ветке `feature/product-enhancements-v3.42`, запрещены прямые коммиты в `main`.
- Ролевая модель RBAC (R5 admin, R4/R5 staff, R3 personal). Обычный боец через Telegram-бот может обновлять только свой склад и получать свои напоминания.
- Безопасность путей: загружаемые через Telegram скриншоты валидируются по MIME-типу и сохраняются исключительно в `data/screenshots/YYYY-MM/` с генерацией криптографического UUID.
- Мультиязычность: 100% паритет ключей в словарях `ru`, `en`, `de` в `i18n.js`.
- Все тесты проекта (`npm test`) должны проходить без единого сбоя.

## Review Focus

1. *Предотвращение флуда и DoS при отправке фото в Telegram-бот*: ограничение на размер входящих файлов (до 10 МБ), обработка только первого фото из альбома, таймаут на скачивание (10 сек).
2. *Защита сна бойцов и учёт часового пояса (09:00 местное время)*: все ивенты в Kiss of War стартуют в 00:00 по UTC (03:00 МСК, глубокой ночью во многих регионах). Отправка ночных алертов строго запрещена. Планировщик обязан сверять текущий час в часовом поясе конкретного игрока и отправлять утреннее уведомление строго в 09:00 утра в день проведения события, исключая дубликаты повторным флагом за дату.
3. *Гибкая смена часового пояса игроком*: игрок должен иметь возможность в любой момент в Личном кабинете увидеть текущее определенное время, скорректировать часовой пояс вручную (из списка) или обновить в 1 клик по текущему браузеру (при поездках/командировках).
4. *Безопасность генерации инфографики*: валидация параметров и санитизация текста на холсте (Canvas), ограничение размера загружаемого PNG постера в эндпоинте `/api/events/:id/share-grid`.
5. *Парсинг чисел из Telegram-команд*: строгое экранирование и валидация положительных целых чисел в командах `/stock` и `/склад`, защита от NaN и отрицательных балансов.

---

### Task 1: Telegram Warehouse Updates & Zero-Touch Data Ingestion

**Files:**
- Modify: `telegram.js` (добавление методов `getTelegramFile`, `downloadTelegramFile`, `sendTelegramPhoto`)
- Modify: `logic.js` (парсер команд `/stock`, `/склад`, вспомогательные функции форматирования ответа по складу)
- Modify: `db.js` (запись истории склада с источником `telegram_photo` и `telegram_command`)
- Modify: `server.js` (обработка входящих `message.photo`, `message.document` и текстовых команд в `/api/telegram/webhook`)
- Test: `logic.test.js`, `telegram.test.js`, `api.test.js`

**Interfaces:**
- `telegram.getTelegramFile(token, fileId)` -> `{ file_id, file_path, file_size }`
- `telegram.downloadTelegramFile(token, filePath)` -> `Buffer`
- `logic.parseTelegramStockCommand(text)` -> `{ coupons, puzzles, starCoupons, stars1, stars2, stars3 } | null`
- `logic.formatStockUpdateSuccessMessage(diff, newStock, targetDeficit)` -> `string (HTML)`

- [ ] **Step 1: Write failing tests in `logic.test.js` for Telegram stock command parser**
  Тестирование разбора команд:
  - `/stock 15000 350` -> `{ coupons: 15000, puzzles: 350 }`
  - `/склад 25000` -> `{ coupons: 25000 }`
  - `/stock 50000 400 120 10 5 2` -> полный расклад со звездами
  - Некорректный ввод: `/stock abc`, `/stock -100` -> `null`.

- [ ] **Step 2: Implement `parseTelegramStockCommand` in `logic.js`**
  Реализовать регулярные выражения для команд `/stock` и `/склад` с очисткой пробелов и разделителей тысяч.

- [ ] **Step 3: Write tests in `telegram.test.js` for file downloading and photo sending**
  Тестирование вызовов `getFile`, скачивания бинарного содержимого и вызова `sendPhoto` через мок `setTelegramFetch`.

- [ ] **Step 4: Implement `getTelegramFile`, `downloadTelegramFile`, `sendTelegramPhoto` in `telegram.js`**
  Реализовать запросы к `https://api.telegram.org/bot<token>/getFile` и скачивание из `https://api.telegram.org/file/bot<token>/<file_path>`.

- [ ] **Step 5: Write API integration tests in `api.test.js` for Telegram photo and stock commands**
  - Пользователь отправляет `/stock 12500 300` -> склад игрока обновляется, создается запись в `stock_history_records`, бот присылает ответ с дельтой.
  - Пользователь отправляет скриншот инвентаря -> бот скачивает фото, распознает числа, сохраняет в `data/screenshots/YYYY-MM/` и обновляет склад.

- [ ] **Step 6: Implement photo & command handlers in `server.js` (`/api/telegram/webhook`)**
  Интегрировать в вебхук обработку `message.photo` и текстовых команд, связывая их с авторизованным сектором бойца.

- [ ] **Step 7: Verify all tests pass**
  Run: `export PATH=$PATH:/usr/local/bin:/opt/homebrew/bin; node logic.test.js && node telegram.test.js && node api.test.js`
  Expected: PASS (0 failures).

- [ ] **Step 8: Commit Task 1**
  `git commit -m "feat(telegram): add direct warehouse photo ingestion and stock text commands"`

---

### Task 2: Player Timezone Management & 09:00 AM Morning Event Briefings

**Files:**
- Modify: `db.js` (миграция таблицы `users`: добавление полей `timezone` и `timezone_offset`; таблица/лог `event_reminders_log`)
- Modify: `logic.js` (шаблон `event_morning_briefing`, логика `shouldSendMorningEventReminder`, форматирование времени)
- Modify: `server.js` (эндпоинт `PUT /api/my-profile/timezone`, планировщик `checkScheduledEventMorningReminders()`)
- Modify: `index.html` (блок настройки часового пояса в `#page-my-cabinet`)
- Modify: `app.js` (компонент выбора таймзоны, автоопределение через `Intl.DateTimeFormat`, отображение текущего времени и сохранение)
- Test: `logic.test.js`, `db.test.js`, `api.test.js`

**Interfaces:**
- `db.updateUserTimezone(userId, { timezone, timezoneOffset })` -> `boolean`
- `logic.shouldSendMorningEventReminder({ eventDateFrom, nowIso, userTimezone, targetHour = 9, lastSentDate })` -> `boolean`
- `logic.DEFAULT_NOTIFICATION_TEMPLATES.event_morning_briefing` -> шаблон:
  `☀️ <b>Доброе утро, {sectorName}!</b>\n\n📅 Сегодня стартует событие: <b>{eventName}</b>\n🎯 Ваше назначенное место: <b>#{place}</b> ({coupons} куп.)\n🎖 Офицер: <b>{officerName}</b>\n\n<i>Событие уже активно на игровом сервере (старт в 00:00 UTC). Желаем побед!</i>\n\n🔗 <a href="{link}">Открыть событие в трекере</a>`
- `PUT /api/my-profile/timezone` (body: `{ timezone: 'Europe/Moscow', timezoneOffset: 3 }`) -> `{ success: true, timezone, timezoneOffset }`

- [ ] **Step 1: Write failing tests in `logic.test.js` for morning reminder time checks**
  Тестирование `shouldSendMorningEventReminder`:
  - В 09:05 по времени бойца (например, UTC+3, текущий час 9) на дату старта ивента -> `true`.
  - В 03:00 по времени бойца (00:00 UTC) -> `false` (защита сна, ночной спам блокируется).
  - В 14:00 если уже отправлено сегодня -> `false`.
  - Корректная обработка игроков в разных поясах (Калининград UTC+2, Москва UTC+3, Самара UTC+4, Екатеринбург UTC+5, Красноярск UTC+7, Владивосток UTC+10).

- [ ] **Step 2: Implement logic functions and template in `logic.js`**
  - Добавить шаблон `event_morning_briefing` в `DEFAULT_NOTIFICATION_TEMPLATES` и `NOTIFICATION_TEMPLATE_SAMPLE_DATA`.
  - Реализовать функцию `shouldSendMorningEventReminder` с расчетом локального часа через `getZonedDateParts`.

- [ ] **Step 3: Write failing tests in `db.test.js` for user timezone storage & reminder log**
  - Проверка миграции колонок `timezone` (default `'Europe/Moscow'`) и `timezone_offset` (default `3`) в таблице `users`.
  - Тест `db.updateUserTimezone(userId, ...)`.
  - Тест сохранения и проверки лога отправленных утренних напоминаний (`event_reminders_log`).

- [ ] **Step 4: Implement DB migrations and methods in `db.js`**
  - В `migrateSchema(db)`: добавить колонки `timezone` и `timezone_offset` в `users`.
  - Создать таблицу `event_reminders_log (event_id, place, user_id, reminder_date, sent_at)`.
  - Реализовать методы `updateUserTimezone` и `recordEventReminderSent`.

- [ ] **Step 5: Write API integration tests in `api.test.js`**
  - Тест `PUT /api/my-profile/timezone` — боец успешно меняет свой пояс с UTC+3 на UTC+5, время сохраняется в базе.
  - Тест фонового планировщика: боец с UTC+5 получает утреннее напоминание на 2 часа раньше бойца с UTC+3. Никаких сообщений в 00:00 UTC не отправляется.

- [ ] **Step 6: Implement server endpoint and scheduler in `server.js`**
  - Добавить обработчик `PUT /api/my-profile/timezone` с валидацией таймзоны.
  - Внедрить `checkScheduledEventMorningReminders()` в ежеминутный цикл сервера с безопасной обработкой ошибок.
  - Добавить ручной триггер `POST /api/telegram/check-morning-reminders` (для штаба/тестов).

- [ ] **Step 7: Implement timezone UI in Личный кабинет (`app.js` и `index.html`)**
  - В `#page-my-cabinet` добавить карточку «Часовой пояс и утренние напоминания»:
    - Выпадающий список популярных часовых поясов (UTC, Москва, Самара, Екатеринбург, Омск, Новосибирск, Красноярск, Иркутск, Владивосток, Лондон, Берлин, Нью-Йорк и др.).
    - Динамический индикатор: *«Ваше текущее местное время: HH:MM»*.
    - Кнопка *«🔄 Автоопределить по браузеру»* (вызывает `getUserTimezoneInfo()` и подставляет значение).
    - Кнопка *«💾 Сохранить часовой пояс»*.
    - Пояснительный текст: *«💡 Уведомления о старте событий приходят в 09:00 утра по вашему местному времени, чтобы не беспокоить вас ночью, когда на сервере игры наступает полночь по UTC.»*

- [ ] **Step 8: Verify all tests pass**
  Run: `export PATH=$PATH:/usr/local/bin:/opt/homebrew/bin; node -c app.js server.js db.js logic.js && node logic.test.js && node db.test.js && node api.test.js`
  Expected: PASS (0 failures).

- [ ] **Step 9: Commit Task 2**
  `git commit -m "feat(cabinet): add player timezone customization and 09:00 AM local morning event briefings"`

---

### Task 3: Event Grid Infographic Poster & Telegram Share

**Files:**
- Modify: `app.js` (клиентский рендеринг постера на HTML5 Canvas, кнопки скачивания PNG и отправки в штаб)
- Modify: `server.js` (эндпоинт `POST /api/events/:id/share-grid` с авторизацией R4/R5 и вызовом `telegram.sendTelegramPhoto`)
- Modify: `style.css` (стилизация кнопок экспорта сетки и модального окна предпросмотра)
- Test: `api.test.js`

**Interfaces:**
- `app.renderEventGridPosterCanvas(event, eventType, players)` -> `HTMLCanvasElement`
- `POST /api/events/:id/share-grid` (body: `{ imageBase64, caption }`) -> `{ success: true, messageId }`

- [ ] **Step 1: Write integration tests in `api.test.js` for `/api/events/:id/share-grid`**
  - Проверка RBAC: R3 получает 403, R4/R5 отправляет валидное изображение -> сервер вызывает `telegram.sendTelegramPhoto` в командирский чат.
  - Защита от слишком больших payload и невалидных форматов base64.

- [ ] **Step 2: Implement endpoint in `server.js`**
  Добавить обработчик `POST /api/events/:id/share-grid`, извлекающий буфер изображения и отправляющий фото в штабной чат с подписью и кнопкой перехода.

- [ ] **Step 3: Implement `renderEventGridPosterCanvas` in `app.js`**
  Создать отрисовку красивого темного постера (1200x800px):
  - Шапка: логотип KoW Tracker, название ивента, даты проведения.
  - Таблица мест: золотые/серебряные/бронзовые плашки, имена бойцов, офицеры и уровни.
  - Футер: «Сетка утверждена штабом альянса».

- [ ] **Step 4: Add UI buttons and handlers in `renderEventDetail` in `app.js`**
  Добавить кнопки «🖼 Скачать сетку (PNG)» и «📤 Отправить сетку в командирский чат» для офицеров.

- [ ] **Step 5: Verify all tests pass and UI renders properly**
  Run: `export PATH=$PATH:/usr/local/bin:/opt/homebrew/bin; node -c app.js server.js && node api.test.js`
  Expected: PASS (0 failures).

- [ ] **Step 6: Commit Task 3**
  `git commit -m "feat(events): add event grid infographic poster generation and staff telegram sharing"`

---

### Task 4: Mieru Proxy Decoupling & Server Startup Hardening

**Files:**
- Modify: `mieru.js` (мягкая изоляция, отключение автоматических попыток запуска при отсутствии бинарника)
- Modify: `server.js` (тихий запуск, отсутствие блокировки старта при недоступности туннеля)
- Test: `api.test.js`, `telegram.test.js`

**Interfaces:**
- `mieru.isMieruAvailable()` -> `boolean`
- `mieru.startMieruClient()` -> `{ started: boolean, reason?: string }`

- [ ] **Step 1: Update `mieru.js`**
  Добавить предварительную проверку существования бинарника `mieru` перед `spawn` без вывода пугающих ошибок `ENOENT` в консоль.

- [ ] **Step 2: Refactor startup sequence in `server.js`**
  Изолировать запуск туннеля: если прокси отключен в настройках или бинарник отсутствует, сервер стартует моментально в стандартном режиме прямого соединения.

- [ ] **Step 3: Verify tests and server startup**
  Run: `export PATH=$PATH:/usr/local/bin:/opt/homebrew/bin; node api.test.js`
  Expected: PASS (0 failures, чистый лог без `spawn ENOENT`).

- [ ] **Step 4: Commit Task 4**
  `git commit -m "refactor(mieru): decouple proxy tunnel and eliminate ENOENT startup warnings"`

---

### Task 5: Multi-language (i18n) & UI Polish

**Files:**
- Modify: `i18n.js` (добавление ключей для всех новых фичей во все 3 языка)
- Test: `i18n.test.js`

- [ ] **Step 1: Add translation keys in `i18n.js`**
  Добавить ключи для Telegram-склада, управления часовыми поясами, утренних напоминаний об ивенте в 09:00 и экспорта сетки в пространства `ru`, `en`, `de` со 100% паритетом.

- [ ] **Step 2: Verify `i18n.test.js`**
  Run: `export PATH=$PATH:/usr/local/bin:/opt/homebrew/bin; node i18n.test.js`
  Expected: 100% dictionary key parity, 0 failures.

- [ ] **Step 3: Commit Task 5**
  `git commit -m "chore(i18n): add translations for v3.42 product enhancements across RU, EN, DE"`

---

## Final Verification Checklist

- [ ] `npm test` проходит без ошибок (100% success).
- [ ] Все новые эндпоинты защищены RBAC.
- [ ] Журнал аудита склада фиксирует источник `telegram_photo` и `telegram_command`.
- [ ] Никаких внешних npm-зависимостей не добавлено в `package.json`.
