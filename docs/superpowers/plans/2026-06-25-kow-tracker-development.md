# KoW Tracker Development Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Довести текущий локальный KoW Officer Tracker до трекера развития игроков по мини-ТЗ из Obsidian.

**Architecture:** Оставить проект простым SPA без сборки: `index.html`, `style.css`, `app.js`, хранение в `localStorage`. Сначала расширить предметную модель и расчеты, затем UI; бэкенд, настоящую авторизацию и drag-and-drop не добавлять до реальной необходимости.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, `localStorage`, SheetJS для Excel export.

---

## Current State

Проект сейчас состоит из:

- `index.html`
- `style.css`
- `app.js`
- `readme.md`

`readme.md` ссылается на Obsidian-файл:

```text
/Users/ranunkulus/Documents/Obsidian Vault/KOW/KOW Tracker.md
```

Текущая модель данных в `app.js` минимальная:

- `players`
- `eventTypes`
- `events`
- `nextId`

Уже есть:

- календарь ивентов;
- статусы активный/предстоящий/прошедший;
- типы ивентов с призовыми местами;
- игроки с вручную заведенными офицерами;
- создание и редактирование ивентов;
- назначение игроков и офицеров на места;
- детальная страница ивента;
- Excel export;
- JSON import.

Главный разрыв с ТЗ: приложение сейчас ведет события и купоны, но еще не является полноценным трекером развития игроков. Нет справочника офицеров, ролей, ежедневных начислений, истории запасов, прогнозов и автоподбора.

## Development Plan

### Task 1: Data Model And Migration

**Files:**

- Modify: `app.js`

- [ ] Expand `state` with these fields:
  - `officerCatalog`
  - `players[].realName`
  - `players[].rank`: `r3 | r4 | r5`
  - `players[].sector`
  - `players[].stock`
  - `players[].officers[]` as player-owned officer progress linked to catalog officers
  - `stockHistory`

- [ ] Add a migration from existing `kow_v2` data so current local data keeps loading.

- [ ] Keep `localStorage` as the only persistence layer for now.

- [ ] Add one small self-check for migration behavior.

### Task 2: Officer Catalog

**Files:**

- Modify: `index.html`
- Modify: `app.js`
- Modify: `style.css`

- [ ] Add an "Офицеры" nav item.

- [ ] Add CRUD for the base officer catalog:
  - name
  - type: `Танк`, `ПТ`, `Пехота`
  - generation, default from 7
  - coupon cost per puzzle; `0` means this officer is upgraded only with puzzles, coupons must not be converted into puzzle progress
  - medal limits: 690 before preparation, 900 for preparation, 1590 total

- [ ] Add safe officer deletion:
  - allow deleting an officer only when no player currently uses this catalog officer;
  - if the officer is used by players, show which players block deletion;
  - keep existing player officer history intact instead of silently removing linked progress.

- [ ] Add officer detail page:
  - route/page: `officer_detail`;
  - open it from the officer catalog table;
  - show base officer fields: name, type, generation, coupon cost per puzzle, medal limits;
  - show all players who are currently training this officer;
  - show each player's level, coupons, stars, stock visibility according to role, and forecast to max preparation;
  - show event participation history for this officer: event name, dates, place, player, coupons, accrued/not accrued;
  - include edit and delete actions for `r4/r5`.

- [ ] Replace free-text officer creation inside player editing with selection from the catalog.

- [ ] Add 6 clickable stars near each player officer. Click sets star progress; repeated click can undo.

### Task 3: Player Profile And Stock

**Files:**

- Modify: `index.html`
- Modify: `app.js`
- Modify: `style.css`

- [ ] Extend player form with:
  - nickname
  - real name
  - rank
  - VIP level
  - confidentiality level
  - current coupons
  - current puzzles
  - current legendary officer medal chests
  - optional sector stats: power, kills, kill points

- [ ] Add player detail page.

- [ ] Show on player detail:
  - player officers
  - current stock
  - event participation history
  - manual stock correction controls

- [ ] Record every manual stock correction in `stockHistory`.

- [ ] Add rollback for the last selected stock correction.

### Task 4: Daily Rewards And Event Calculations

**Files:**

- Modify: `app.js`

- [ ] Keep calculations near the existing math functions.

- [ ] Add VIP daily puzzle calculation:
  - VIP above 10 gives 2 puzzles per day
  - VIP 12 gives 3 puzzles per day
  - continue this rule up to VIP 30 according to the final game rule table

- [ ] Add confidentiality puzzle calculation:
  - level above 24 gives 1 puzzle per 2 days
  - level 25 gives 2 puzzles per 3 days

- [ ] Add daily chest calculation:
  - 1 chest per day

- [ ] Add event reward accrual after event completion.

- [ ] Add one small self-check for reward calculation.

### Task 5: Forecasts

**Files:**

- Modify: `app.js`
- Modify: `style.css`

- [ ] Add a simple day-by-day forecast function.

- [ ] Forecast officer max preparation date using:
  - current stock
  - daily rewards
  - planned future event rewards
  - officer coupon-to-puzzle ratio; when the ratio is `0`, ignore coupon stock/rewards for that officer and use puzzle income only

- [ ] Show forecast on player detail and event detail.

- [ ] Include basic variants:
  - always top 1
  - always top 2
  - always top 3
  - always 4-10

### Task 6: Event Reward History

**Files:**

- Modify: `app.js`
- Modify: `style.css`

- [ ] Add prize history to event types so rewards can change over time.

- [ ] On event creation, resolve rewards from event date.

- [ ] In event detail, show:
  - planned reward
  - actual reward
  - reward confirmed/not confirmed
  - accrued/not accrued

- [ ] Add a confirmation action for actual results.

### Task 7: Roles And Local Permissions

**Files:**

- Modify: `index.html`
- Modify: `app.js`
- Modify: `style.css`

- [ ] Add a local current-role switch for development: `r3`, `r4`, `r5`.

- [ ] Hide or disable UI according to role:
  - `r3`: can edit own data, can view other officers, cannot view other stock
  - `r4`: can manage players, event types, events, and confirmations
  - `r5`: full access

- [ ] After an event ends, allow `r3` to submit their own place after 00:00 UTC on the next day if `r4/r5` did not enter it.

### Task 8: Auto Pick

**Files:**

- Modify: `app.js`
- Modify: `style.css`

- [ ] Add "Автоподбор" to the event modal.

- [ ] Implement simple ranking:
  - higher officer generation first
  - higher preparation level next
  - higher player kill points next
  - stock/forecast as a later tie-breaker

- [ ] Assign best available officers to best places.

- [ ] Keep existing manual select fields as the override UI.

- [ ] Skip drag-and-drop until the basic auto pick is useful.

### Task 9: Export And Import

**Files:**

- Modify: `app.js`

- [ ] Expand Excel export sheets:
  - Игроки
  - Офицеры
  - Запасы
  - История корректировок
  - Ивенты
  - Прогнозы

- [ ] Strengthen JSON import validation beyond `data.players !== undefined`.

- [ ] Add migration/version field to exported JSON.

## Priority

1. Data model and migration.
2. Officer catalog.
3. Officer detail page and safe officer deletion.
4. Player profile and stock.
5. Daily reward calculations.
6. Forecasts.
7. Event reward history.
8. Roles.
9. Auto pick.
10. Export/import expansion.

## Deliberately Skipped

- Backend.
- Real authentication.
- Database.
- Drag-and-drop.
- Multi-user sync.

Add these only when local `localStorage` is no longer enough for real usage.
