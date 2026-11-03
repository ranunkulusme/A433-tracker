# План реализации: Интеграция симулятора прокачки офицеров с календарем ивентов (Event-Driven Simulation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать динамическое моделирование даты завершения прокачки навыков и уровней офицеров (до 5-5-5-5 / ур. 180) с привязкой к реальным событиям календаря альянса, расчетом чистой экономии дней и визуальным таймлайном этапов.

**Architecture:** Расширение слоя чистой логики `logic.js` функциями извлечения наград сектора из календаря (`extractSectorCalendarEvents`) и посуточного моделирования (`simulateCalendarEventProgress`) с поддержкой гарантированного (утвержденные места) и оптимистичного (с учетом поданных заявок) сценариев. Интеграция в UI Личного кабинета и Калькулятора (`app.js`, `style.css`) со сравнительной карточкой экономии времени и хронологическим таймлайном этапов.

**Tech Stack:** Node.js (чистый JavaScript без внешних npm-зависимостей), Vanilla JS (ES6+), HTML5, CSS3, TDD (`logic.test.js`, `api.test.js`).

**Spec:** `docs/superpowers/specs/2026-11-02-events-telegram-audit-specs.md` (Раздел 3, Модуль 1)

---

## Global Constraints

- Zero external npm dependencies on server (нативные возможности Node.js, браузерный чистый JS).
- Звёзды командира (0–6★) не зависят от ивентов и рассчитываются строго от запасов звёздного склада. Ивенты влияют исключительно на дефицит купонов/медалей для навыков (5-5-5-5) и уровней подготовки (0–180).
- Сохранение 100% обратной совместимости с существующей функцией `simulateEventProgress` и ручным счетчиком ивентов.
- Весь интерфейс, подписи бейджей и подсказки строго на русском языке.
- Строгое следование методологии GitFlow (`feature/event-driven-simulation` -> `release/v3.23.0` -> `main`) и TDD (RED -> GREEN).

---

## Review Focus

1. **Обработка дат событий:** события должны учитываться строго в хронологическом порядке от текущего дня (`today`), исключая завершенные прошедшие ивенты.
2. **Гарантированный vs Оптимистичный сценарии:** если боец назначен на место в `assignments`, оно учитывается всегда; если не назначен, но зарегистрирован (`registrations`), оно учитывается только в оптимистичном режиме по `desiredPlace` (или топ-1 при любом подходящем).
3. **Офицеры только за пазлы / персональные:** если офицер `puzzle-only` или имеет флаг `onlyPersonalPuzzles`, универсальные купоны с ивентов не могут сокращать его дефицит (выводится соответствующая информационная плашка).
4. **Финиш прокачки в день ивента:** если призовые купоны с ивента полностью закрывают дефицит, дата финиша фиксируется ровно в день наступления ивента, а не на следующий день.
5. **Безопасное переключение секторов и офицеров:** при смене активного сектора или целевого командира симулятор мгновенно пересчитывает таймлайн без падений при пустом календаре (`events = []`).

---

### Task 1: Слой чистой расчетной логики симулятора (`logic.js`, `logic.test.js`)

**Files:**
- Modify: `logic.js:1080-1150`
- Test: `logic.test.js`

**Interfaces:**
- `extractSectorCalendarEvents({ events, eventTypes, playerId, officerId, today, mode = 'guaranteed' })`:
  - Вход: массив событий `events`, типы событий `eventTypes`, идентификатор игрока `playerId`, офицера `officerId`, текущая дата `today` (ISO `YYYY-MM-DD`), режим `mode` (`'guaranteed'` | `'optimistic'`).
  - Выход: отсортированный массив будущих наград:
    ```javascript
    [{
      eventId: number,
      eventName: string,
      date: string, // YYYY-MM-DD
      place: number,
      coupons: number,
      status: 'assigned' | 'registered',
      color: string
    }]
    ```
- `simulateCalendarEventProgress({ deficitPuzzles, costPerPuzzle, dailyIncome, calendarEvents = [], today, maxDays = 3650 })`:
  - Вход: исходный дефицит пазлов, курс купонов к пазлу, ежедневный доход пазлов/день (VIP + конф.), список наград календаря, дата отсчета.
  - Посуточный расчет ($T = 0...maxDays$): начисление призов в даты ивентов + ежедневный пассивный доход.
  - Выход:
    ```javascript
    {
      baseDays: number | null,
      baseDate: string | null,
      simulatedDays: number | null,
      simulatedDate: string | null,
      savedDays: number,
      totalCouponsFromEvents: number,
      totalPuzzlesFromEvents: number,
      remainingDeficitPuzzles: number,
      remainingDeficitCoupons: number,
      timeline: [{
        date: string,
        type: 'event' | 'finish',
        eventName: string,
        place: number,
        coupons: number,
        puzzlesGained: number,
        remainingDeficitPuzzles: number,
        progressPct: number
      }]
    }
    ```

- [ ] **Step 1: Написать падающие юнит-тесты в `logic.test.js`**
  - Тест 1: `extractSectorCalendarEvents` извлекает только будущие ивенты с утвержденным местом в режиме `guaranteed`.
  - Тест 2: `extractSectorCalendarEvents` в режиме `optimistic` учитывает поданные заявки с `desiredPlace`.
  - Тест 3: `simulateCalendarEventProgress` правильно моделирует сокращение дефицита в дату ивента и рассчитывает `savedDays`.
  - Тест 4: финиш прокачки ровно в день события, если купонов достаточно.
  - Тест 5: обработка нулевого дефицита и офицеров с `costPerPuzzle = 0`.

- [ ] **Step 2: Запустить тесты и убедиться в падении (RED)**
  - Run: `export PATH=$PATH:/usr/local/bin:/opt/homebrew/bin; node logic.test.js`
  - Expected: FAIL (функции `extractSectorCalendarEvents` и `simulateCalendarEventProgress` не определены).

- [ ] **Step 3: Реализовать функции в `logic.js` и добавить их в UMD/Node.js экспорт**
  - Реализовать `extractSectorCalendarEvents`.
  - Реализовать `simulateCalendarEventProgress` с посуточным циклом и формированием `timeline`.
  - Добавить функции в экспорт объекта `logic`.

- [ ] **Step 4: Запустить тесты и убедиться в успешном прохождении (GREEN)**
  - Run: `export PATH=$PATH:/usr/local/bin:/opt/homebrew/bin; node logic.test.js`
  - Expected: PASS (все тесты logic проходят).

- [ ] **Step 5: Коммит**
  - Run:
    ```bash
    git add logic.js logic.test.js
    git commit -m "feat(logic): add event-driven simulation and calendar reward extraction"
    ```

---

### Task 2: UI симулятора в Личном кабинете бойца (`app.js`, `style.css`)

**Files:**
- Modify: `app.js:1800-1960`
- Modify: `style.css:3200-3350`

**UI компоненты:**
- Свитчер режимов моделирования над симулятором:
  `[ 🛡️ Гарантированный (утвержденные) ]` &nbsp; `[ 🚀 Оптимистичный (+заявки) ]` &nbsp; `[ ⚙️ Ручной подбор ]`.
- Карточка сравнительного эффекта:
  - *«Без ивентов (только VIP): 15 апреля 2027 (160 дн.)»*
  - *«С учетом ивентов: 28 декабря 2026 (56 дн.)»*
  - Акцентный бейдж: **`⚡ Экономия: 104 дня`**.
- Хронологическая шкала этапов (Timeline):
  - Карточки будущих ивентов календаря с бейджем места, призовыми купонами, датой и расчетным уровнем офицера после завершения ивента.
  - Итоговая карточка финиша прокачки с иконкой кубка 🏆 и датой достижения цели.
  - Если в календаре нет запланированных мест: аккуратный информационный блок с призывом подать заявку на ближайшие события.

- [ ] **Step 1: Добавить стили для таймлайна и свитчера сценариев в `style.css`**
  - Классы: `.sim-mode-switcher`, `.sim-mode-btn`, `.sim-timeline`, `.sim-timeline-item`, `.sim-timeline-badge`, `.sim-timeline-content`.

- [ ] **Step 2: Обновить функцию `renderMyCabinetSimulator` в `app.js`**
  - Добавить состояние выбранного режима (`myCabinetSim.mode = 'guaranteed' | 'optimistic' | 'manual'`).
  - Вызов `extractSectorCalendarEvents` и `simulateCalendarEventProgress` при выборе календарных режимов.
  - Отрисовка сравнительного баннера и блока интерактивного таймлайна этапов.
  - Сохранение ручного режима для пользователей, желающих произвольно пощелкать счетчики `top1...top4`.

- [ ] **Step 3: Проверить синтаксис и запустить тесты**
  - Run: `node -c app.js style.css && npm test`
  - Expected: PASS (синтаксис чист, все существующие тесты проходят).

- [ ] **Step 4: Коммит**
  - Run:
    ```bash
    git add app.js style.css
    git commit -m "feat(ui): add calendar event-driven simulator and timeline in cabinet"
    ```

---

### Task 3: UI симулятора в общем Калькуляторе альянса (`app.js`)

**Files:**
- Modify: `app.js:5560-5650`

**Функционал:**
- Перенос свитчера сценариев (Гарантированный / Оптимистичный / Ручной) и таймлайна этапов в общий раздел **«Калькулятор»**.
- Возможность офицерам Р4/Р5 и бойцам рассчитывать календарный эффект для любого выбранного сектора альянса.

- [ ] **Step 1: Обновить `renderCalculator` в `app.js`**
  - Интеграция `extractSectorCalendarEvents` с учетом выбранного `calcPlayerId`.
  - Отрисовка таймлайна этапов и сравнительного бейджа экономии для выбранного игрока.

- [ ] **Step 2: Проверить синтаксис и выполнить проверку тестов**
  - Run: `node -c app.js && npm test`
  - Expected: PASS.

- [ ] **Step 3: Коммит**
  - Run:
    ```bash
    git add app.js
    git commit -m "feat(ui): integrate event calendar simulation into alliance calculator"
    ```

---

### Task 4: Верификация, документация и релиз v3.23.0 по GitFlow

**Files:**
- Modify: `package.json`
- Modify: `index.html`
- Modify: `sw.js`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Полный запуск тестового набора**
  - Run: `npm test`
  - Проверка всех тестов: `logic.test.js`, `db.test.js`, `s3.test.js`, `api.test.js`, `deploy.test.js`.

- [ ] **Step 2: Подготовка релизной ветки `release/v3.23.0`**
  - Повышение версии до `3.23.0` в `package.json`, `index.html` (сайдбар), `sw.js` (`kow-cache-v3.23.0`).
  - Обновление `CHANGELOG.md` по стандарту Keep a Changelog.
  - Коммит: `chore(release): prepare v3.23.0`.

- [ ] **Step 3: Слияние в `main` и тегирование**
  - Merge с флагом `--no-ff` в `main`.
  - Аннотированный тег: `git tag -a v3.23.0 -m "Release v3.23.0: Event-driven leveling simulator and timeline"`.
  - Удаление временных веток разработки.
