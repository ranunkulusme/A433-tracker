# Community Data and Game Mechanics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Интегрировать в KoW Tracker систематизированные данные сообщества Kiss of War (полный реестр легендарных офицеров Gen 1–9, шкалу очков VIP с расчетом дней до следующего тира, расчет медалей навыков 5-5-5-5, пресеты циклов ивентов, кулдауны побед в автоподборе и мета-связки командиров).

**Architecture:** Расширить чистые функции и константы модуля `logic.js` новыми структурами данных сообщества (`OFFICER_CATALOG_DATA`, `VIP_TIERS_DATA`, `SKILL_UPGRADE_COSTS`, `EVENT_PRESETS`, `OFFICER_PAIRINGS`), функциями расчета дефицита VIP, прогрессии навыков, генерации расписания и автоподбора с защитой от монополизации мест. В интерфейсе (`app.js`, `index.html`, `style.css`) внедрить селекторы навыков, рекомендации связок и генератор сезонных ивентов.

**Tech Stack:** Vanilla JavaScript (ES6+, UMD), HTML5, CSS3, `localStorage`, Node.js для тестов (`/opt/homebrew/bin/node logic.test.js`).

**Spec:** [`docs/superpowers/specs/2026-10-24-community-data-and-game-mechanics-spec.md`](file:///Users/ranunkulus/Downloads/KOW/docs/superpowers/specs/2026-10-24-community-data-and-game-mechanics-spec.md)

## Global Constraints

- Сохранять полную обратную совместимость со структурой состояния `kow_v2` в `localStorage` (все старые профили игроков и офицеров корректно мигрируют).
- Любые новые параметры моделей должны иметь безопасные дефолты (`skills = [1, 1, 1, 1]`, `vipPoints = 0`).
- Офицеры с `couponPerPuzzle === 0` (эксклюзивные/пазловые) не могут получать купонные призы в автоподборе.
- Все расчетные функции в `logic.js` являются чистыми функциями без сайд-эффектов и зависимостей от DOM.
- Прогон тестов выполняется локально через команду `/opt/homebrew/bin/node logic.test.js`.

## Review Focus

- Миграция старых данных: игроки без поля `skills` у офицеров получают массив `[1, 1, 1, 1]`, не ломая существующие расчеты уровней и дефицита.
- Офицеры со специальной прокачкой (`upgradeType === 'special'` или `couponPerPuzzle === 0`): дефицит купонов строго равен 0, расчет идет только в пазлах.
- Расчет очков VIP: при вводе очков, превышающих максимальный уровень (VIP 30), функция возвращает дефицит 0 и не падает с ошибкой переполнения массива.
- Кулдаун автоподбора: если абсолютно все подходящие игроки находятся в кулдауне, автоподбор не должен оставлять места пустыми — он назначает наименее штрафуемого кандидата.
- Пресеты ивентов: генератор расписания проверяет корректность начальной даты и не допускает дублирования ID ивентов в существующей базе.

---

### Task 1: Расширение каталога офицеров реальным ростером (Gen 1–9) и поддержка навыков

**Files:**
- Modify: `logic.js`
- Modify: `logic.test.js`

**Interfaces:**
- Produces:
  - `COMMUNITY_OFFICERS`: массив легендарных офицеров Gen 1–9 с типами войск, стоимостью пазлов и флагом `upgradeType`.
  - Обновленный `DEFAULT_OFFICERS` и `migrateState(raw)` с безопасной инициализацией поля `skills: [1, 1, 1, 1]` для каждого офицера игрока.

- [ ] **Step 1: Написать падающий тест в `logic.test.js`**

Добавить тест проверки расширенного каталога и миграции навыков:
```javascript
const { COMMUNITY_OFFICERS, migrateState } = require('./logic');

assert(Array.isArray(COMMUNITY_OFFICERS) && COMMUNITY_OFFICERS.length >= 10, 'COMMUNITY_OFFICERS should contain at least 10 officers');
const jessica = COMMUNITY_OFFICERS.find(o => o.id === 'jessica');
assert(jessica && jessica.type === 'Танк' && jessica.generation === 1, 'Jessica should be Gen 1 Tank');

const migrated = migrateState({
  players: [{ id: 1, name: 'Ветеран', officers: [{ id: 'o1', name: 'Джессика', level: 50 }] }]
});
assert.deepStrictEqual(migrated.players[0].officers[0].skills, [1, 1, 1, 1], 'Legacy officer should receive default [1, 1, 1, 1] skills');
console.log('ok - community officers catalog and legacy skills migration');
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Запуск: `/opt/homebrew/bin/node logic.test.js`  
Ожидается: FAIL (`COMMUNITY_OFFICERS is not defined`).

- [ ] **Step 3: Реализовать `COMMUNITY_OFFICERS` и обновить `migrateState` в `logic.js`**

В `logic.js` объявить массив `COMMUNITY_OFFICERS`, содержащий ключевых командиров:
- Gen 1: Джессика (Танк), Грейс (Танк), Марджори (Пехота), Эвелин (Пехота), Кэтрин (ПТ), Линда (ПТ).
- Gen 2–3: Ангел (Танк), Мария (Пехота), Келли (ПТ), Белла (Гарнизон), Виктория (Осада).
- Gen 4–6: Оливия (Танк), София (ПТ), Хлоя (Пехота), Зоя (Гарнизон).
- Gen 7–9: Генерал Рекс (Танк, Gen 7), Капитан Блэк (ПТ, Gen 7), Адмирал Нейтон (Пехота, Gen 8), Аврора (Гарнизон, Gen 8), Валькирия (Осада, Gen 9).
Объединить их с `DEFAULT_OFFICERS`.  
В `migrateState` при маппинге офицеров игрока добавить поле:
```javascript
skills: Array.isArray(officer.skills) && officer.skills.length === 4
  ? officer.skills.map(s => Math.max(1, Math.min(5, Number(s) || 1)))
  : [1, 1, 1, 1],
```

- [ ] **Step 4: Запустить тесты и проверить результат**

Запуск: `/opt/homebrew/bin/node logic.test.js`  
Ожидается: PASS для всех тестов, включая новый.

- [ ] **Step 5: Сделать git commit**

```bash
git add logic.js logic.test.js
git commit -m "feat: add community officers roster and skills migration"
```

---

### Task 2: Шкала VIP-очков и калькулятор дефицита до следующего уровня

**Files:**
- Modify: `logic.js`
- Modify: `logic.test.js`

**Interfaces:**
- Produces:
  - `VIP_TIERS_DATA`: таблица порогов очков VIP (1–30) и ежедневных наград пазлами.
  - `calculateVipDeficit({ currentLevel, currentPoints, targetLevel })`: возвращает `{ pointsNeeded, dailyPuzzlesIncrease, targetLevel }`.

- [ ] **Step 1: Написать падающий тест в `logic.test.js`**

```javascript
const { VIP_TIERS_DATA, calculateVipDeficit } = require('./logic');

assert(Array.isArray(VIP_TIERS_DATA) && VIP_TIERS_DATA.length >= 20);
// Игрок VIP 10 с 350,000 очками хочет VIP 12 (порог 750,000)
const vipDeficit = calculateVipDeficit({ currentLevel: 10, currentPoints: 350000, targetLevel: 12 });
assert.strictEqual(vipDeficit.pointsNeeded, 400000);
assert.strictEqual(vipDeficit.dailyPuzzlesIncrease, 2); // VIP 12 дает 3 пазла, VIP 10 дает 1 пазл -> прибавка +2
console.log('ok - vip points table and deficit calculator');
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Запуск: `/opt/homebrew/bin/node logic.test.js`  
Ожидается: FAIL (`VIP_TIERS_DATA is not defined`).

- [ ] **Step 3: Реализовать таблицу `VIP_TIERS_DATA` и функцию `calculateVipDeficit` в `logic.js`**

В `logic.js` определить таблицу порогов очков и суточных пазлов для каждого уровня с 1 по 30.  
Реализовать чистую функцию `calculateVipDeficit`:
1. Нормализовать входные уровни (ограничить от 1 до 30) и очки.
2. Найти целевой порог очков `targetPoints`.
3. Рассчитать `pointsNeeded = Math.max(0, targetPoints - currentPoints)`.
4. Рассчитать разницу в суточных пазлах `dailyPuzzlesIncrease = targetReward - currentReward`.

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Запуск: `/opt/homebrew/bin/node logic.test.js`  
Ожидается: PASS.

- [ ] **Step 5: Сделать git commit**

```bash
git add logic.js logic.test.js
git commit -m "feat: add vip tiers data and calculateVipDeficit"
```

---

### Task 3: Модуль прогрессии прокачки навыков офицера (5-5-5-5)

**Files:**
- Modify: `logic.js`
- Modify: `logic.test.js`

**Interfaces:**
- Produces:
  - `SKILL_UPGRADE_COSTS`: матрица стоимости медалей на каждый шаг навыка 1->5.
  - `calculateSkillMedalsProgress(skills = [1, 1, 1, 1])`: возвращает `{ spentMedals, remainingMedals, isMaxSkills }`, где максимум равен 690 медалям.

- [ ] **Step 1: Написать падающий тест в `logic.test.js`**

```javascript
const { calculateSkillMedalsProgress } = require('./logic');

const base = calculateSkillMedalsProgress([1, 1, 1, 1]);
assert.strictEqual(base.spentMedals, 0);
assert.strictEqual(base.remainingMedals, 690);
assert.strictEqual(base.isMaxSkills, false);

const maxed = calculateSkillMedalsProgress([5, 5, 5, 5]);
assert.strictEqual(maxed.spentMedals, 690);
assert.strictEqual(maxed.remainingMedals, 0);
assert.strictEqual(maxed.isMaxSkills, true);

const half = calculateSkillMedalsProgress([5, 1, 1, 1]);
assert(half.spentMedals > 0 && half.remainingMedals === 690 - half.spentMedals);
console.log('ok - skill progression calculation 5-5-5-5 for 690 medals');
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Запуск: `/opt/homebrew/bin/node logic.test.js`  
Ожидается: FAIL (`calculateSkillMedalsProgress is not defined`).

- [ ] **Step 3: Реализовать `SKILL_UPGRADE_COSTS` и `calculateSkillMedalsProgress` в `logic.js`**

В `logic.js` зафиксировать стоимость шагов каждого из 4 навыков, суммарно дающих 690 медалей.  
Реализовать функцию подсчета потраченных и недостающих медалей.

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Запуск: `/opt/homebrew/bin/node logic.test.js`  
Ожидается: PASS.

- [ ] **Step 5: Сделать git commit**

```bash
git add logic.js logic.test.js
git commit -m "feat: add 5-5-5-5 skill medals progress calculator"
```

---

### Task 4: Шаблоны типовых ивентов и генератор сезонного расписания

**Files:**
- Modify: `logic.js`
- Modify: `logic.test.js`

**Interfaces:**
- Produces:
  - `EVENT_PRESETS`: пресеты «Король Войны» (King of War, 14 дней), «Сильнейший Командир» (Mightiest Commander, 28 дней).
  - `generateSeasonSchedule({ startDate, cyclesCount, presetId, startId })`: генерирует массив объектов ивентов с датами `dateFrom`, `dateTo`, типом и местами.

- [ ] **Step 1: Написать падающий тест в `logic.test.js`**

```javascript
const { EVENT_PRESETS, generateSeasonSchedule } = require('./logic');

assert(EVENT_PRESETS['king-of-war'] && EVENT_PRESETS['mightiest-commander']);
const schedule = generateSeasonSchedule({
  startDate: '2026-11-01',
  cyclesCount: 3,
  presetId: 'king-of-war',
  startId: 100
});
assert.strictEqual(schedule.length, 3);
assert.strictEqual(schedule[0].id, 100);
assert.strictEqual(schedule[0].dateFrom, '2026-11-01');
assert.strictEqual(schedule[1].dateFrom, '2026-11-15'); // через 14 дней
console.log('ok - event presets and schedule generator');
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Запуск: `/opt/homebrew/bin/node logic.test.js`  
Ожидается: FAIL (`generateSeasonSchedule is not defined`).

- [ ] **Step 3: Реализовать `EVENT_PRESETS` и `generateSeasonSchedule` в `logic.js`**

В `logic.js` объявить структуру пресетов с продолжительностью цикла (в днях), названием и призовыми местами.  
Реализовать `generateSeasonSchedule`, которая использует `dateAdd` для вычисления дат начала и окончания каждого ивента цикла.

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Запуск: `/opt/homebrew/bin/node logic.test.js`  
Ожидается: PASS.

- [ ] **Step 5: Сделать git commit**

```bash
git add logic.js logic.test.js
git commit -m "feat: add event presets and season schedule generator"
```

---

### Task 5: Правило кулдауна победителей (Fair Play) в автоподборе `smartAutoPick`

**Files:**
- Modify: `logic.js`
- Modify: `logic.test.js`

**Interfaces:**
- Consumes: `smartAutoPick` из `logic.js`.
- Produces: обновленный `smartAutoPick({ ..., cooldownConfig })` с поддержкой параметра `cooldownEventsCount` и истории недавних победителей `recentEventWinners`.

- [ ] **Step 1: Написать падающий тест в `logic.test.js`**

```javascript
const { smartAutoPick } = require('./logic');

const catalog = [{ id: 'cat-rex', name: 'Рекс', generation: 7, couponPerPuzzle: 500 }];
const places = [{ place: 1, coupons: 12500 }];

// Игрок 1 имеет 100 очков убийств, но победил в прошлом ивенте (кулдаун)
// Игрок 2 имеет 90 очков убийств и свободен от кулдауна
const players = [
  { id: 1, name: 'Игрок 1', sector: { killPoints: 100 }, stock: { coupons: 0, puzzles: 0 }, officers: [{ id: 'o1', catalogId: 'cat-rex', level: 0, coupons: 0 }] },
  { id: 2, name: 'Игрок 2', sector: { killPoints: 90 }, stock: { coupons: 0, puzzles: 0 }, officers: [{ id: 'o2', catalogId: 'cat-rex', level: 0, coupons: 0 }] },
];

const result = smartAutoPick({
  places,
  players,
  officerCatalog: catalog,
  recentWinners: [1], // Игрок 1 выиграл прошлый ивент
  cooldownPenalty: true,
});

assert.strictEqual(result[0].playerId, 2, 'Player 2 should receive Place 1 due to Player 1 cooldown');
console.log('ok - smartAutoPick enforces fair play cooldown for recent winners');
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Запуск: `/opt/homebrew/bin/node logic.test.js`  
Ожидается: FAIL (на 1-е место по-прежнему выбирается Игрок 1).

- [ ] **Step 3: Модифицировать скоринг в `smartAutoPick` в `logic.js`**

В формуле сортировки кандидатов внутри `smartAutoPick`:
- Если передан `recentWinners` и кандидат находится в списке победителей последних `N` ивентов, его ранг смещается вниз (пенальти), если есть другие квалифицированные кандидаты с достаточным дефицитом купонов.

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Запуск: `/opt/homebrew/bin/node logic.test.js`  
Ожидается: PASS.

- [ ] **Step 5: Сделать git commit**

```bash
git add logic.js logic.test.js
git commit -m "feat: implement fair play cooldown penalty in smartAutoPick"
```

---

### Task 6: Справочник боевых связок офицеров (Officer Pairings & Recommendations)

**Files:**
- Modify: `logic.js`
- Modify: `logic.test.js`

**Interfaces:**
- Produces:
  - `OFFICER_PAIRINGS`: справочник рекомендованных пар (Primary + Secondary) по типам войск и тактическим ролям.
  - `getRecommendedPairings(officerId)`: возвращает синергии для переданного офицера.

- [ ] **Step 1: Написать падающий тест в `logic.test.js`**

```javascript
const { OFFICER_PAIRINGS, getRecommendedPairings } = require('./logic');

assert(Array.isArray(OFFICER_PAIRINGS) && OFFICER_PAIRINGS.length >= 5);
const rexPairings = getRecommendedPairings('general-rex');
assert(Array.isArray(rexPairings) && rexPairings.length > 0);
assert(rexPairings.some(p => p.partnerId === 'angel' || p.partnerId === 'jessica'));
console.log('ok - officer pairings and recommendations');
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Запуск: `/opt/homebrew/bin/node logic.test.js`  
Ожидается: FAIL (`getRecommendedPairings is not defined`).

- [ ] **Step 3: Реализовать `OFFICER_PAIRINGS` и `getRecommendedPairings` в `logic.js`**

Добавить реестр связок для Танков, ПТ, Пехоты и Гарнизонов с кратким описанием синергии.  
Реализовать `getRecommendedPairings(officerId)`, находящую все пары, где офицер является ведущим или ведомым.

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Запуск: `/opt/homebrew/bin/node logic.test.js`  
Ожидается: PASS.

- [ ] **Step 5: Сделать git commit**

```bash
git add logic.js logic.test.js
git commit -m "feat: add officer pairings catalog and recommendations query"
```

---

### Task 7: Обновление UI (`app.js`, `index.html`, `style.css`)

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Modify: `app.js`

**Interfaces:**
- Внедрение новых элементов в пользовательский интерфейс:
  - В модальном окне редактирования игрока: ввод 4 уровней навыков офицеров (1–5) и расчет остатка медалей из 690.
  - В карточке сектора игрока: поле ввода текущих очков VIP и динамическая подсказка «До следующего уровня VIP осталось N очков (+X пазлов/день)».
  - В детальной странице офицера: блок «Рекомендуемые связки командиров».
  - В разделе «Календарь»: кнопка «Заполнить по шаблону сезона» (вызов `generateSeasonSchedule`).

- [ ] **Step 1: Добавить разметку полей навыков, VIP-очков и кнопки генератора расписания в `index.html`**

1. В модальное окно офицера добавить селекторы для навыков `[S1, S2, S3, S4]`.
2. В форму сектора игрока добавить `input#fp-vip-points`.
3. В шапку календаря добавить кнопку `btn-outline` «+ Шаблон сезона».
4. В модальное окно деталей офицера добавить контейнер `#officer-synergies`.

- [ ] **Step 2: Добавить стили в `style.css`**

Стилизовать бейджи навыков (`.skill-badge`), сетку связок (`.synergy-card`), прогресс-бар VIP-очков.

- [ ] **Step 3: Связать интерфейс с логикой в `app.js`**

1. В `renderOfficerRows()` отображать 4 селектора навыков и расчет `calculateSkillMedalsProgress`.
2. В карточке сектора игрока вызывать `calculateVipDeficit` при изменении очков VIP.
3. В странице офицера отображать список из `getRecommendedPairings`.
4. Реализовать модальное окно «Заполнить сезон» с выбором пресета и добавлением сгенерированных ивентов в `state.events`.

- [ ] **Step 4: Проверить визуальную работу и отсутствие JS-ошибок**

Запустить `node logic.test.js` и проверить целостность всех модулей.  
Убедиться в отсутствии синтаксических ошибок в `app.js`.

- [ ] **Step 5: Сделать git commit**

```bash
git add index.html style.css app.js
git commit -m "feat: integrate skills UI, vip progress, pairings and season scheduler"
```

---

## Self-Review

1. **Spec coverage:** Все 6 пунктов из спецификации и обсуждения (реестр офицеров, шкала VIP, навыки 5-5-5-5, пресеты ивентов, кулдаун автоподбора, связки командиров) покрыты отдельными задачами с тестами.
2. **Step scan:** Каждый шаг содержит проверяемое действие, команду запуска и ожидаемый результат.
3. **Type consistency:** Имена функций (`calculateVipDeficit`, `calculateSkillMedalsProgress`, `generateSeasonSchedule`, `getRecommendedPairings`) согласованы между спецификацией, тестами и кодом.
4. **Review Focus:** Проверены граничные случаи (миграция старых офицеров без навыков, VIP 30, кулдауны при равных баллах).
5. **Proportion:** План лаконичен, структурирован по TDD и готов для пошагового выполнения субагентом или разработчиком.
