# Гибкая настройка расписания событий в Типах ивентов и динамический Конструктор сезонов: План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перенести настройки расписания и ритма событий (дни начала и окончания, ритм активности, смещение недели, флаг периодичности) в справочник «Типы ивентов» (`event_types`), реализовать расчет длительности по дням недели с поддержкой перехода через выходные, и перевести Конструктор сезонов альянса на полностью динамический список типов событий с возможностью добавления новых периодических событий.

**Architecture:**
- **Бизнес-логика (`logic.js`):** Функции `calculateDurationDays(startDay, endDay)`, `formatDayRange(startDay, endDay)` и расширенный `generateSeasonSchedule` с поддержкой пар `startDayOfWeek` + `endDayOfWeek`, вычислением длительности и строковых меток дней недели.
- **База данных SQLite (`db.js`):** Расширение таблицы `event_types` колонками `is_periodic`, `start_day_of_week`, `end_day_of_week`, `active_weeks`, `break_weeks`, `week_offset`. Безопасная миграция существующих баз данных. CRUD и экспорт/импорт.
- **Серверный REST API (`server.js`):** Обновление эндпоинтов `/api/event-types` (валидация и санитизация новых полей расписания) и `/api/events/schedule-season` (генерация по динамическим правилам типов событий) с защитой ролевой модели R4/R5.
- **Интерфейс пользователя (`index.html`, `app.js`, `style.css`):**
  - Обновление модального окна типа ивента `#modal-et` (селекторы дня начала и окончания с живым бейджем длительности, ритм активности, смещение, флаг периодичности).
  - Отображение расписания в карточках типов событий на странице «Типы ивентов».
  - Динамический рендеринг карточек в Конструкторе сезонов `#modal-season-scheduler` с кнопкой «+ Добавить тип события» и интерактивным предпросмотром расписания.

**Tech Stack:** Vanilla JavaScript (ES2022 / UMD), Node.js (нативные `node:http`, `node:sqlite`, `node:crypto`), HTML5, CSS3. Нулевые внешние npm-зависимости.

**Spec:** [`docs/superpowers/specs/2026-10-31-flexible-event-types-and-season-scheduler-design.md`](file:///Users/ranunkulus/Downloads/KOW/docs/superpowers/specs/2026-10-31-flexible-event-types-and-season-scheduler-design.md)

---

## Global Constraints

- **Язык общения:** Русский язык для всех ответов и сообщений пользователю (`RULE[user_global]`).
- **Методология GitFlow:** Ветка разработки `feature/flexible-event-types-scheduler`, релиз через `release/v3.18.0`, слияние `--no-ff` в `main` с аннотированным тегом `v3.18.0` (`RULE[user_global]`, `AGENTS.md`).
- **TDD подход:** Сначала падающий тест (RED), затем реализация (GREEN), затем рефакторинг. Все 44+ теста должны быть зелеными (0 failures).
- **Внешние зависимости:** 0 новых npm-зависимостей на сервере и клиенте (нативные модули Node.js).
- **Ролевая модель:** Только лидеры (ранги `r4` и `r5`) имеют доступ к созданию/редактированию типов событий и сезонов. Для `r3` возвращается `403 Forbidden`.
- **Обратная совместимость:** Существующие тесты `api.test.js`, `db.test.js` и импорт/экспорт должны сохранять полную обратную совместимость.

---

## Tasks Overview

### Task 1: Бизнес-логика расчета дней, расписания сезонов и личных пазлов (`logic.js`, `logic.test.js`)
- [ ] **Step 1:** Написать падающие тесты в `logic.test.js`:
  - `calculateDurationDays`, `formatDayRange` и `generateSeasonSchedule` с днями начала и окончания.
  - `calculateOfficerDeficit` с учетом `personalPuzzles` (личные пазлы уменьшают дефицит командира до 180 уровня).
- [ ] **Step 2:** Реализовать чистые функции в `logic.js`:
  - `calculateDurationDays(startDay, endDay)`: корректный расчет длительности (включая переход через выходные, например Суббота 6 -> Понедельник 1 = 3 дня).
  - `formatDayRange(startDay, endDay)`: форматирование строкового интервала (например `Сб–Пн (3 дня)`).
  - Обновить `generateSeasonSchedule` для работы с парами `startDayOfWeek` и `endDayOfWeek`.
  - Обновить `calculateOfficerDeficit` для включения `personalPuzzles` в текущий прогресс пазлов офицера.
- [ ] **Step 3:** Экспортировать новые функции в UMD-обертке `logic.js`.
- [ ] **Step 4:** Прогнать `node logic.test.js` и убедиться в успешном прохождении тестов.

---

### Task 2: Слой базы данных SQLite: миграции `event_types` и `player_officers` (`db.js`, `db.test.js`)
- [ ] **Step 1:** Написать падающие тесты в `db.test.js`:
  - Сохранение, загрузка и миграция полей расписания в `event_types`.
  - Сохранение и загрузка `personal_puzzles` в `player_officers` через CRUD и экспорт/импорт.
- [ ] **Step 2:** В `db.js` (`initDb`):
  - Добавить безопасную миграцию таблицы `event_types`: колонки `is_periodic`, `start_day_of_week`, `end_day_of_week`, `active_weeks`, `break_weeks`, `week_offset` через `PRAGMA table_info`.
  - Добавить безопасную миграцию таблицы `player_officers`: колонка `personal_puzzles INTEGER NOT NULL DEFAULT 0`.
  - Заполнить стандартные типы событий («Король Войны», «Мощные Силы», «Сила Времени») дефолтными днями начала и окончания.
- [ ] **Step 3:** Обновить функции CRUD офицеров (`addPlayerOfficer`, `updatePlayerOfficer`, `getPlayers`, `getPlayerById`) и `exportKowJson` / `importKowJson`.
- [ ] **Step 4:** Прогнать `node db.test.js && node logic.test.js`.

---

### Task 3: Серверный REST API и интеграционные тесты (`server.js`, `api.test.js`)
- [ ] **Step 1:** Написать тесты в `api.test.js`:
  - Валидация и сохранение параметров расписания в `POST /api/event-types` и `PUT /api/event-types/:id`.
  - Санитизация `personalPuzzles` в эндпоинтах `/api/my-profile/officers` и `/api/players/:id/officers`.
- [ ] **Step 2:** В `server.js`:
  - Обновить валидацию и санитизацию типов ивентов (нормализация `isPeriodic`, `startDayOfWeek`, `endDayOfWeek`, `activeWeeks`, `breakWeeks`, `weekOffset`).
  - Добавить санитизацию `personalPuzzles` (целое число $\ge 0$) для офицеров игрока и сектора.
- [ ] **Step 3:** Обновить `POST /api/events/schedule-season` для использования параметров расписания из переданных правил или базы `event_types`.
- [ ] **Step 4:** Запустить `export PATH=$PATH:/usr/local/bin:/opt/homebrew/bin; node api.test.js && node db.test.js`.

---

### Task 4: UI управления типами ивентов и личными пазлами офицеров (`index.html`, `app.js`, `style.css`)
- [ ] **Step 1:** В `index.html`:
  - В форме `#modal-et`: чекбокс `is_periodic`, селекторы `День начала` и `День окончания` с живым бейджем длительности, поля `Ритм активности` и `Смещение недели`.
  - В формах `#modal-my-officer`, `#modal-sector-officer`, `#modal-add-sector-officer`: преобразовать строку уровня в трёхколоночную сетку `form-row form-row-3`:
    `[ Уровень (0-180) ]` | `[ Купоны на уровне ]` | `[ 🧩 Личные пазлы ]`.
- [ ] **Step 2:** В `app.js`:
  - Обновить `openEventTypeModal`, обработчики живого обновления бейджа длительности и сохранение `saveEventType`.
  - Обновить `openEditMyOfficerModal`, `saveMyOfficerSubmit`, `openEditSectorOfficerModal`, `submitEditSectorOfficer`, `openAddSectorOfficerModal`, `submitAddSectorOfficer` для сохранения и отображения `personalPuzzles`.
  - В `renderCabinetOfficerCardHtml`: над прогресс-баром отображать строку `Уровень: X / 180` · `🧩 Пазлы: N` (если $>0$) · `Купоны: Y`, а процент прогресса рассчитывать с учетом личных пазлов.
- [ ] **Step 3:** В `renderEventTypeCard`:
  - Выводить бейдж расписания периодического события.
  - Удалить устаревшую колонку «Пазлов» (рассчитывавшуюся по жесткому курсу 500), оставив точные призовые купоны за места.
- [ ] **Step 4:** В `style.css` добавить стили для строки дней недели, бейджей периодичности и подсветки личных пазлов.

---

### Task 5: Динамический Конструктор сезонов (`index.html`, `app.js`, `style.css`)
- [ ] **Step 1:** В `index.html` удалить жестко зашитые карточки из `#season-event-cards`, заменив их на динамический контейнер. Добавить кнопку `+ Добавить тип события` над сеткой.
- [ ] **Step 2:** В `app.js` переписать `openSeasonSchedulerModal` и `updateSeasonSchedulePreview`:
  - Рендерить карточки из `state.eventTypes.filter(et => et.isPeriodic)`.
  - Для каждой карточки отображать «День начала» и «День окончания» с живой подсказкой дней.
  - Обработка добавления нового типа события прямо из генератора.
  - Возможность исключения/удаления карточки из текущей генерации.
- [ ] **Step 3:** Проверить живое обновление таблицы предпросмотра при любых изменениях параметров.
- [ ] **Step 4:** Проверить адаптивность сетки карточек на мобильных экранах.

---

### Task 6: Механизм массового обновления наград во всех ивентах за 1 раз (`db.js`, `server.js`, `index.html`, `app.js`)
- [ ] **Step 1:** В `db.js` реализовать функцию `updateBulkEventTypeRewards(typeIds, places)`:
  - В транзакции SQLite обновляет `places_json` (и при необходимости дописывает запись в `prize_history_json`) для переданного массива `typeIds` или для всех периодических ивентов.
  - Добавить тесты в `db.test.js`.
- [ ] **Step 2:** В `server.js` добавить защищенный эндпоинт `POST /api/event-types/bulk-rewards` (RBAC `['r4', 'r5']`):
  - Принимает `{ typeIds, places }` с валидацией массива призовых мест (place, label, coupons).
  - Возвращает `{ success: true, updatedCount: N, eventTypes: [...] }`.
  - Добавить интеграционные тесты в `api.test.js`.
- [ ] **Step 3:** В `index.html` добавить модальное окно `#modal-bulk-rewards`:
  - Пояснение: *«Используйте при выходе нового поколения офицеров для одновременного повышения наград во всех событиях»*.
  - Редактируемая сетка мест (1 место, 2 место, 3 место, 4–10 место...) со строгим указанием купонов (без некорректного фиксированного курса пазлов).
  - Чекбоксы выбора целевых событий (по умолчанию отмечены все периодические ивенты).
  - Кнопка «✓ Применить ко всем выбранным ивентам».
- [ ] **Step 4:** В `app.js` добавить кнопку «⚡ Массовое обновление наград» на страницу «Типы ивентов» и функции `openBulkRewardsModal()`, `submitBulkRewards()`.

---

### Task 7: Комплексная верификация, приемочные тесты и релиз по GitFlow
- [ ] **Step 1:** Добавить новый тест в `test-demo-acceptance.js`, проверяющий:
  - Наличие полей расписания в `event_types`.
  - Корректность вычисления длительности дней недели.
  - Динамическую генерацию расписания в конструкторе сезонов по дням начала и окончания.
  - Работу массового обновления наград во всех ивентах за 1 вызов API.
  - Учет `personalPuzzles` в расчете дефицита офицера и сохранение через API.
- [ ] **Step 2:** Запустить полный цикл тестов:
  - `node logic.test.js`
  - `node db.test.js`
  - `node api.test.js`
  - `node deploy.test.js`
  - `node test-demo-acceptance.js`
  - `node -c app.js && node -c server.js`
- [ ] **Step 3:** Оформить релиз `v3.18.0` по GitFlow:
  - Повысить версию до `3.18.0` в `package.json`, `app.js`, `server.js`, `index.html`.
  - Заполнить `CHANGELOG.md`.
  - Смержить `release/v3.18.0` в `main` через `--no-ff`.
  - Проставить аннотированный тег `v3.18.0`.
  - Отправить в remote: `git push origin main --tags`.
