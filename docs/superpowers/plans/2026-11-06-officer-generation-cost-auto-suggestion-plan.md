# Smart Officer Puzzle Cost Suggestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать интеллектуальную автоподстановку базовой стоимости 1 медали офицера при указании поколения и типа войск в модальном окне каталога с опорой на стоимость предыдущего сезона и коэффициент удорожания с округлением в большую сторону.

**Architecture:** Добавление чистой функции расчёта `suggestOfficerPuzzleCost` в `logic.js` с эталонной базой поколений (танки, пехота) и динамическим вычислением коэффициента. Интеграция в интерфейс `app.js` и модальное окно `#modal-officer` с информационным бейджем и автозаполнением для новых офицеров. Локализация в `i18n.js`.

**Tech Stack:** Vanilla JavaScript (Node.js native / Browser ES2020), HTML5, CSS3, i18next, SQLite.

**Spec:** `docs/superpowers/specs/2026-11-06-officer-generation-cost-auto-suggestion-spec.md`

## Global Constraints
- Zero external npm dependencies on the backend (pure Node.js native).
- GitFlow methodology: work in `feature/officer-generation-cost-auto-suggestion`, release `release/v3.37.0`, merge `--no-ff` into `main`, annotated tag `v3.37.0`.
- 100% dictionary key parity across `ru`, `en`, and `de`.
- TDD approach: failing tests in `logic.test.js` before implementation.
- All tests passing (`npm test` 0 failures).

## Review Focus
- S8 Tank cost calculates to 1 050 when S7 is 500 (rounding up to 50 from 1041.67).
- S8 Infantry cost calculates to 1 250 when S7 is 600 (rounding up to 50 from 1245.67).
- Fallback to reference table when catalog is empty or does not have previous generation.
- Manual edit protection: user manual input in coupon field is not overwritten on subsequent type/generation changes unless reset.
- Editing existing officer preserves its saved coupon cost.

---

### Task 1: Математическое ядро `suggestOfficerPuzzleCost` в `logic.js` и тесты TDD

**Files:**
- Modify: `logic.js`
- Test: `logic.test.js`

- [ ] **Step 1.1**: Создать ветку GitFlow `feature/officer-generation-cost-auto-suggestion`
- [ ] **Step 1.2**: Написать падающие модульные тесты в `logic.test.js` для `suggestOfficerPuzzleCost`:
  - Проверка расчёта S8 для Танка на основе S7=500 (ожидается 1050).
  - Проверка расчёта S8 для Пехоты на основе S7=600 (ожидается 1250).
  - Проверка расчёта для поколений S3->S4, S4->S5, S5->S6, S6->S7 для танков.
  - Проверка эталонной таблицы при отсутствии офицера в каталоге.
  - Проверка игнорирования `special` офицеров (стоимость 0).
- [ ] **Step 1.3**: Запустить `node logic.test.js` и убедиться, что тесты падают (RED).
- [ ] **Step 1.4**: Реализовать `suggestOfficerPuzzleCost` и экспортировать в `logic.js` (GREEN).
- [ ] **Step 1.5**: Запустить `node logic.test.js` и убедиться, что тесты проходят на 100%.
- [ ] **Step 1.6**: Закоммитить изменения: `feat(logic): add suggestOfficerPuzzleCost with in-game scaling and upward rounding`.

---

### Task 2: Локализация и UI разметка в `i18n.js`, `index.html` и `style.css`

**Files:**
- Modify: `i18n.js`
- Modify: `index.html`
- Modify: `style.css`
- Test: `i18n.test.js`

- [ ] **Step 2.1**: Добавить ключи локализации в словарь `catalog` для подсказки авторасчёта во всех языках (`ru`, `en`, `de`):
  - `catalog.hint_auto_cost`
  - `catalog.hint_auto_cost_manual`
  - `catalog.btn_reset_auto_cost`
- [ ] **Step 2.2**: Запустить `node i18n.test.js` и подтвердить 100% паритет ключей.
- [ ] **Step 2.3**: Добавить разметку контейнера подсказки `#fo-coupon-hint` под полем `#fo-coupon-per-puzzle` в `index.html`.
- [ ] **Step 2.4**: Добавить стили для бейджа автоподсказки `#fo-coupon-hint` в `style.css`.
- [ ] **Step 2.5**: Закоммитить изменения: `feat(ui): add catalog cost suggestion markup, styles and i18n keys`.

---

### Task 3: Интерактивная логика автоподстановки и подсказок в `app.js`

**Files:**
- Modify: `app.js`

- [ ] **Step 3.1**: Реализовать функцию `updateCatalogOfficerCostSuggestion()` в `app.js`:
  - Вызывает `logic.suggestOfficerPuzzleCost`.
  - Обновляет текст и видимость `#fo-coupon-hint`.
  - Если `!isCouponManuallyEdited` и создаётся новый офицер, автоматически обновляет значение поля `#fo-coupon-per-puzzle`.
- [ ] **Step 3.2**: Подключить обработчики `input` и `change` на `#fo-generation`, `#fo-type`, `#fo-coupon-per-puzzle`.
- [ ] **Step 3.3**: Инициализировать состояние при вызове `openOfficerCatalogModal(id)`.
- [ ] **Step 3.4**: Экспортировать `updateCatalogOfficerCostSuggestion` в `window`.
- [ ] **Step 3.5**: Проверить синтаксис: `node -c app.js logic.js i18n.js`.
- [ ] **Step 3.6**: Закоммитить изменения: `feat(catalog): wire smart cost auto-substitution and reactive hint in officer modal`.

---

### Task 4: Комплексная верификация и GitFlow релиз `v3.37.0`

**Files:**
- Modify: `package.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 4.1**: Запустить полный тестовый набор `npm test` (все наборы: logic, db, s3, telegram, api, deploy, i18n) и убедиться в 0 failures.
- [ ] **Step 4.2**: Создать релизную ветку `release/v3.37.0`.
- [ ] **Step 4.3**: Обновить версию в `package.json` до `3.37.0`.
- [ ] **Step 4.4**: Заполнить `CHANGELOG.md` для версии `[3.37.0] - 2026-11-06`.
- [ ] **Step 4.5**: Закоммитить релиз: `chore(release): prepare release v3.37.0`.
- [ ] **Step 4.6**: Выполнить слияние в `main` через `git merge --no-ff release/v3.37.0`.
- [ ] **Step 4.7**: Создать аннотированный тег `git tag -a v3.37.0 -m "Release v3.37.0: Smart officer puzzle cost suggestion in catalog"`.
- [ ] **Step 4.8**: Удалить временные ветки `feature/...` и `release/...`.
- [ ] **Step 4.9**: Отправить `main` и теги в удалённый репозиторий: `git push origin main --tags`.
- [ ] **Step 4.10**: Опубликовать GitHub Release v3.37.0.
