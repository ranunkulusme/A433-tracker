# Calculator and Event Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить в KoW Tracker раздел «Калькулятор и Аналитика» с персональным симулятором прокачки офицеров до 180 уровня, сводной матрицей гильдии, умным автоподбором ивентов с защитой от перерасхода купонов и расширением родов войск (`Танк`, `ПТ`, `Пехота`, `Гарнизон`, `Осада`).

**Architecture:** Расширить вычислительный модуль `logic.js` чистыми функциями расчета дефицита (`calculateOfficerDeficit`), симуляции ивентов (`simulateEventProgress`) и умного автоподбора (`smartAutoPick`). В UI (`app.js`, `index.html`, `style.css`) добавить новую страницу `calculator` с переключением между персональным симулятором и сводной матрицей гильдии, а также обновить модальное окно ивентов индикаторами эффективности купонов.

**Tech Stack:** Vanilla JavaScript (ES6+), HTML5, CSS3, `localStorage`, Node.js для запуска тестов (`logic.test.js`).

**Spec:** [`docs/superpowers/specs/2026-10-24-calculator-and-event-planning-design.md`](file:///Users/ranunkulus/Downloads/KOW/docs/superpowers/specs/2026-10-24-calculator-and-event-planning-design.md)

## Global Constraints

- Сохранять совместимость со схемой хранения `kow_v2` в `localStorage` (без потери существующих данных игроков).
- Рода войск офицеров строго включают: `'Танк'`, `'ПТ'`, `'Пехота'`, `'Гарнизон'`, `'Осада'`.
- Офицеры с `couponPerPuzzle === 0` прокачиваются только пазлами: купоны к ним неприменимы, они исключаются из купонных наград в автоподборе.
- Один игрок не может занимать более одного места в одном ивенте.
- Звёзды (1★–6★) не требуют сундуков в расчетах; 6★ является индикатором готовности для 180 уровня.

## Review Focus

- Игрок с дефицитом меньше размера приза 1-го места не должен ставиться на 1-е место при наличии других кандидатов с полным дефицитом.
- Офицер со стоимостью `couponPerPuzzle === 0` имеет дефицит купонов `0`, а дефицит пазлов покрывается только пазлами со склада/пассивным доходом.
- Если у игрока офицер уже достиг 180 уровня (`level === 180`), его дефицит равен 0, и автоподбор его пропускает.
- Один игрок, имеющий двух офицеров, не должен попадать на два разных призовых места в одном ивенте через автоподбор.
- Симуляция ивентов при нулевом дефиците не должна давать отрицательное число оставшихся дней.

---

### Task 1: Расширение родов войск (`OFFICER_TYPES`)

**Files:**
- Modify: `logic.js`
- Modify: `logic.test.js`
- Modify: `index.html`

**Interfaces:**
- Produces: `OFFICER_TYPES = ['Танк', 'ПТ', 'Пехота', 'Гарнизон', 'Осада']` exported from `logic.js`.

- [ ] **Step 1: Написать падающий тест на `OFFICER_TYPES` в `logic.test.js`**

Добавить в `logic.test.js`:
```javascript
const { OFFICER_TYPES } = require('./logic');
assert.deepStrictEqual(OFFICER_TYPES, ['Танк', 'ПТ', 'Пехота', 'Гарнизон', 'Осада']);
console.log('ok - exports full list of 5 officer types');
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Запуск: `/opt/homebrew/bin/node logic.test.js`  
Ожидается: FAIL (`OFFICER_TYPES is not defined` или `undefined`).

- [ ] **Step 3: Реализовать `OFFICER_TYPES` в `logic.js` и обновить `index.html`**

В `logic.js` объявить:
```javascript
const OFFICER_TYPES = ['Танк', 'ПТ', 'Пехота', 'Гарнизон', 'Осада'];
```
и экспортировать `OFFICER_TYPES`.  
В `index.html` в `<select id="fo-type">` добавить `<option>Гарнизон</option>` и `<option>Осада</option>`.

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Запуск: `/opt/homebrew/bin/node logic.test.js`  
Ожидается: PASS.

- [ ] **Step 5: Сделать git commit**

```bash
git add logic.js logic.test.js index.html
git commit -m "feat: add garrison and siege to officer types"
```

---

### Task 2: Расчет дефицита офицера и симуляция прогресса в `logic.js`

**Files:**
- Modify: `logic.js`
- Modify: `logic.test.js`

**Interfaces:**
- Consumes: `PUZZLES_PER_LEVEL`, `MAX_LEVEL`, `dailyRewards`, `dateAdd` from `logic.js`.
- Produces:
  - `calculateOfficerDeficit({ officer, catalogItem, player, targetLevel = 180, today })`
  - `simulateEventProgress({ deficitPuzzles, costPerPuzzle, dailyIncome, plannedEvents, today })`

- [ ] **Step 1: Написать падающие тесты в `logic.test.js`**

```javascript
// Тест расчета дефицита для стандартного офицера и puzzle-only
const defStandard = calculateOfficerDeficit({
  officer: { level: 100, coupons: 1000, stars: 4 },
  catalogItem: { couponPerPuzzle: 500 },
  player: { stock: { puzzles: 50, coupons: 2500 }, sector: { vipLevel: 12, confidentialityLevel: 25 } },
  targetLevel: 180,
  today: '2026-10-24'
});
// 180 * 5 = 900 целевых пазлов.
// В офицере: 100 * 5 + floor(1000/500) = 502.
// Склад: 50 + floor(2500/500) = 55.
// Дефицит пазлов: 900 - 502 - 55 = 343.
// Дефицит купонов: 343 * 500 = 171500.
// Доход: 3 (VIP 12) + 2/3 (Конф 25) = 3.666...
assert.strictEqual(defStandard.deficitPuzzles, 343);
assert.strictEqual(defStandard.deficitCoupons, 171500);
assert.strictEqual(defStandard.starRequirement.requiredStars, 6);
assert.strictEqual(defStandard.starRequirement.isStarReady, false);

// Тест puzzle-only офицера
const defPuzzleOnly = calculateOfficerDeficit({
  officer: { level: 170, coupons: 0, stars: 6 },
  catalogItem: { couponPerPuzzle: 0 },
  player: { stock: { puzzles: 10, coupons: 100000 }, sector: { vipLevel: 10 } },
  targetLevel: 180,
  today: '2026-10-24'
});
// Дефицит: 900 - 850 - 10 = 40 пазлов. Купоны со склада не учитываются!
assert.strictEqual(defPuzzleOnly.deficitPuzzles, 40);
assert.strictEqual(defPuzzleOnly.deficitCoupons, 0);
assert.strictEqual(defPuzzleOnly.starRequirement.isStarReady, true);

// Тест симуляции ивентов
const sim = simulateEventProgress({
  deficitPuzzles: 343,
  costPerPuzzle: 500,
  dailyIncome: 3.666667,
  plannedEvents: [
    { coupons: 12500, count: 2 }, // 25000 купонов = 50 пазлов
    { coupons: 6500, count: 1 }   // 6500 купонов = 13 пазлов
  ],
  today: '2026-10-24'
});
assert.strictEqual(sim.puzzlesFromEvents, 63);
assert.strictEqual(sim.remainingDeficitPuzzles, 280);
assert.ok(sim.savedDays > 0);
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Запуск: `/opt/homebrew/bin/node logic.test.js`  
Ожидается: FAIL (`calculateOfficerDeficit is not defined`).

- [ ] **Step 3: Реализовать `calculateOfficerDeficit` и `simulateEventProgress` в `logic.js`**

Реализовать функции с соблюдением формул дефицита, пассивного срока и защитой от деления на 0 при `dailyIncome === 0`. Экспортировать обе функции.

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Запуск: `/opt/homebrew/bin/node logic.test.js`  
Ожидается: PASS.

- [ ] **Step 5: Сделать git commit**

```bash
git add logic.js logic.test.js
git commit -m "feat: add deficit calculation and event simulation math"
```

---

### Task 3: Умный автоподбор на ивенты (`smartAutoPick`)

**Files:**
- Modify: `logic.js`
- Modify: `logic.test.js`

**Interfaces:**
- Consumes: `calculateOfficerDeficit`, `resolveEventPlaces` from `logic.js`.
- Produces: `smartAutoPick({ places, players, officerCatalog, eventDate })`
  - Возвращает `assignments: [{ place, playerId, officerId, actualCoupons, deficitCoupons, overflowCoupons, isEfficient }]`

- [ ] **Step 1: Написать падающие тесты на `smartAutoPick` в `logic.test.js`**

Проверить:
1. Исключение игроков/офицеров с `couponPerPuzzle === 0`.
2. Уникальность: 1 игрок не может занять два места.
3. Оптимизацию: сильный игрок А с дефицитом 2 000 купонов смещается на место 4 (2 750 купонов), а место 1 (12 500) достается игроку Б с дефицитом 50 000 купонов.

```javascript
const pick = smartAutoPick({
  places: [
    { place: 1, label: '1 место', coupons: 12500 },
    { place: 2, label: '2 место', coupons: 6500 },
    { place: 4, label: '4-10 место', coupons: 2750 },
  ],
  players: [
    { id: 1, name: 'Топ 1', sector: { killPoints: 100 }, stock: { coupons: 0, puzzles: 0 }, officers: [{ id: 'o1', catalogId: 'cat-std', level: 178, coupons: 0 }] }, // дефицит 10 пазлов = 5000 купонов
    { id: 2, name: 'Топ 2', sector: { killPoints: 80 }, stock: { coupons: 0, puzzles: 0 }, officers: [{ id: 'o2', catalogId: 'cat-std', level: 100, coupons: 0 }] },  // дефицит 400 пазлов = 200000 купонов
  ],
  officerCatalog: [{ id: 'cat-std', name: 'Нейтон', generation: 8, couponPerPuzzle: 500 }],
  eventDate: '2026-10-24'
});
// Игрок 2 должен получить 1 место (дефицит 200к полностью вбирает 12.5к), а игрок 1 - место с меньшим призом.
assert.strictEqual(pick.find(p => p.place === 1).playerId, 2);
assert.strictEqual(pick.filter(p => p.playerId === 1).length, 1);
assert.strictEqual(pick.filter(p => p.playerId === 2).length, 1);
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Запуск: `/opt/homebrew/bin/node logic.test.js`  
Ожидается: FAIL (`smartAutoPick is not defined`).

- [ ] **Step 3: Реализовать `smartAutoPick` в `logic.js`**

Реализовать жадный алгоритм распределения мест с учетом силы кандидата и минимального перерасхода купонов. Экспортировать функцию.

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Запуск: `/opt/homebrew/bin/node logic.test.js`  
Ожидается: PASS.

- [ ] **Step 5: Сделать git commit**

```bash
git add logic.js logic.test.js
git commit -m "feat: add smartAutoPick with overflow protection"
```

---

### Task 4: UI: Раздел «Калькулятор» (Персональный симулятор + Сводная матрица)

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `style.css`

**Interfaces:**
- Consumes: `calculateOfficerDeficit`, `simulateEventProgress`, `OFFICER_TYPES` from `logic.js`.
- Produces: `renderCalculator()` в `app.js`, навигационный пункт `calculator` в `index.html`.

- [ ] **Step 1: Добавить пункт меню «Калькулятор» в `index.html`**

В `.sidebar-nav` добавить:
```html
<a href="#" class="nav-item" data-page="calculator">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/></svg>
  Калькулятор
</a>
```

- [ ] **Step 2: Реализовать страницу `renderCalculator()` в `app.js`**

Создать функцию `renderCalculator()`:
- **Переключатель вкладок:** `Персональный симулятор` / `Матрица гильдии`.
- **Персональный симулятор:**
  - Выбор игрока и офицера.
  - Отображение карточек: Текущий уровень, Звезды (с пометкой `★ Готов к 180` или `☆ Нужно 6★`), Дефицит пазлов/купонов, Дней пассивно.
  - Конструктор будущих ивентов: кнопки `+` / `-` для добавления призовых мест (1-е место, 2-е место, 3-е место, 4–10 место).
  - Динамический расчет: новая дата финиша, количество сэкономленных дней.
- **Сводная матрица гильдии:**
  - Фильтр по роду войск: `Все`, `Танк`, `ПТ`, `Пехота`, `Гарнизон`, `Осада`.
  - Фильтр по поколению (все / от 7 / от 8).
  - Таблица всех офицеров гильдии: Игрок, Офицер, Род войск, Поколение, Уровень, Звёзды, Дефицит купонов, Склад игрока, Дата финиша без ивентов, Рекомендуемый тир.

- [ ] **Step 3: Стилизация компонентов в `style.css`**

Добавить стили для карточек симулятора, счетчиков ивентов, бейджей эффективности и таблицы матрицы.

- [ ] **Step 4: Проверить работу страницы в браузере и отсутствие ошибок в консоли**

Проверить переключение вкладок, интерактивный пересчет при нажатии кнопок симуляции и фильтрацию матрицы по родам войск (`Гарнизон`, `Осада`).

- [ ] **Step 5: Сделать git commit**

```bash
git add index.html app.js style.css
git commit -m "feat: add calculator page with simulator and guild matrix"
```

---

### Task 5: Интеграция Smart Auto-Pick в модальное окно ивента

**Files:**
- Modify: `app.js`
- Modify: `style.css`

**Interfaces:**
- Consumes: `smartAutoPick` from `logic.js`.
- Modifies: `autoPickAssignments()` и `renderEventAssignments()` в `app.js`.

- [ ] **Step 1: Обновить `autoPickAssignments()` в `app.js`**

Заменить вызов `buildAutoPick` на `smartAutoPick`:
```javascript
function autoPickAssignments() {
  const etId = parseInt(document.getElementById('fe-type').value);
  const et = getEventType(etId);
  const eventDate = document.getElementById('fe-from').value || new Date().toISOString().slice(0, 10);
  eventAssignments = smartAutoPick({
    places: eventAssignments.length ? eventAssignments : resolveEventPlaces(et, eventDate),
    players: state.players,
    officerCatalog: state.officerCatalog,
    eventDate,
  });
  renderEventAssignments();
}
```

- [ ] **Step 2: Отображение бейджей эффективности в слотах ивента**

В `renderEventAssignments()` добавить рендеринг бейджа утилизации рядом со строкой каждого слота:
- Если перерасход: `<span class="badge badge-warning" title="Размер приза превышает дефицит офицера">Перерасход: +X куп.</span>`
- Если эффективное распределение: `<span class="badge badge-success">✓ 100% полезно</span>`

- [ ] **Step 3: Проверить запуск unit-тестов**

Запуск: `/opt/homebrew/bin/node logic.test.js`  
Ожидается: All tests passing.

- [ ] **Step 4: Сделать git commit**

```bash
git add app.js style.css
git commit -m "feat: integrate smart auto-pick with efficiency badges into event modal"
```
