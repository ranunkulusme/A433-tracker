# Audit Log, Screenshot Retention & Telegram Bot Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Module 3 (Warehouse Audit Log, screenshot upload & 30-day retention cleanup) and Module 2 (Telegram Bot API, personal/staff notifications, RBAC inline approval, and notification template editor with live preview) for KoW Tracker.

**Architecture:** Pure Node.js 22+ with zero external npm dependencies (`node:http`, `node:sqlite`, `node:crypto`, `node:fs`, native `fetch` for Telegram Bot API). SQLite storage for audit records and templates with backward-compatible migrations. Client-side compressed WebP/JPEG screenshot uploads and responsive UI with i18n support (RU, EN, DE).

**Tech Stack:** Vanilla JavaScript (ES2022+), Node.js native standard library (`node:http`, `node:sqlite`, `node:crypto`, `node:fs`), SQLite, HTML5, CSS3, `i18next`.

**Spec:** `docs/superpowers/specs/2026-11-02-events-telegram-audit-specs.md`

## Global Constraints

- Zero external npm dependencies on the backend (native `node:http`, `node:sqlite`, `node:crypto`, `node:fs`, `node:path`, native `fetch`).
- Strict Zero Trust & RBAC: R5-only administrative actions (bot token, staff chat linking, export/import); R4/R5 staff actions (template editor, view all audit logs); R3 access restricted to their own sector's audit history and personal Telegram binding.
- Screenshot storage in `data/screenshots/YYYY-MM/` with strictly 30-day retention policy (physical file unlinked, database path set to NULL, numeric change log preserved permanently).
- Backward compatibility: existing `kow_v2` / `kow_v3` export/import dumps must remain fully functional.
- Multilingual support: 100% dictionary key parity across `ru`, `en`, and `de` in `i18n.js`.
- Strictly no remote git push (`git push origin` forbidden); follow GitFlow locally.

## Review Focus

1. *Unauthenticated/unauthorized access to screenshot files*: prevent path traversal, ensure `/api/screenshots/:filename` verifies user authentication and sector ownership/permission before serving images.
2. *Telegram Bot API rate limits and network errors*: ensure all `fetch` calls to `api.telegram.org` are wrapped in try-catch with timeout, logging errors gracefully without crashing the server or hanging client HTTP responses.
3. *Telegram inline button RBAC spoofing*: ensure `callback_query.from.id` is verified against the database to confirm the user has rank R4/R5 or `approve_users` permission before approving or rejecting registrations.
4. *Screenshot retention cleanup safety*: ensure `cleanupExpiredScreenshots` safely verifies file paths are strictly within `data/screenshots/` before calling `unlink`, avoiding accidental file deletion.
5. *Template placeholder rendering safety*: ensure `renderTemplate(template, data)` handles missing or undefined values gracefully without emitting `undefined` in messages, and escapes HTML characters when needed.

---

### Task 1: Module 3 — Database schema, audit logic & screenshot retention (db.js, logic.js, server.js)

**Files:**
- Modify: `db.js:1500-1762` (migrations for `stock_history_records`, `stock_updated_at`, `stock_update_source`)
- Modify: `logic.js:1-1200` (pure helpers `calculateStockDiff`, `getStockFreshness`)
- Modify: `server.js:1-1200` (API endpoints for stock history, screenshot serving, and retention cleanup)
- Test: `db.test.js`, `logic.test.js`, `api.test.js`

- [ ] **Step 1: Write failing tests in `logic.test.js`**
  Add unit tests for `calculateStockDiff(before, after)` (returning diff chips and human-readable summary, e.g. `+500 куп., -10 пазл., +2★ II`) and `getStockFreshness(updatedAt, now)` (returning `fresh` <= 7d, `warning` 7-14d, `stale` > 14d, and days count).
- [ ] **Step 2: Implement logic functions in `logic.js`**
  Implement `calculateStockDiff` and `getStockFreshness`, export via UMD/CommonJS.
- [ ] **Step 3: Write failing tests in `db.test.js`**
  Add tests for `stock_history_records` table creation, `recordStockHistory`, `getStockHistoryByPlayerId`, and `cleanupExpiredScreenshots(db, baseDir)`.
- [ ] **Step 4: Implement DB migrations and helpers in `db.js`**
  In `initDb()`:
  - Add `stock_updated_at TEXT` and `stock_update_source TEXT` to `players` table.
  - Create table `stock_history_records` with indexes on `player_id` and `created_at`.
  - Add helper functions: `recordStockHistory({ playerId, userId, source, snapshotBefore, snapshotAfter, diffSummary, screenshotPath })`, `getStockHistory(playerId, limit = 50)`, `cleanupExpiredScreenshots(db, baseDir)`.
  - Update `updatePlayer` to record history when stock changes, and update `stock_updated_at`.
- [ ] **Step 5: Write failing API tests in `api.test.js`**
  Test `GET /api/players/:id/stock-history` (with RBAC / ownership check), `POST /api/players/:id/stock-history` (with base64 screenshot upload), and `GET /api/screenshots/:filename` (verifying auth and path security).
- [ ] **Step 6: Implement server endpoints and retention scheduler in `server.js`**
  - Implement endpoints: `GET /api/players/:id/stock-history`, `POST /api/players/:id/stock-history` (saving screenshot into `data/screenshots/YYYY-MM/{id}_{hash}.jpg` and creating record), and `GET /api/screenshots/:filename`.
  - Add startup and scheduled (every 24h) call to `cleanupExpiredScreenshots`.
- [ ] **Step 7: Verify all tests pass**
  Run `node -c db.js logic.js server.js && node logic.test.js && node db.test.js && node api.test.js`.
- [ ] **Step 8: Commit Task 1**
  `git commit -m "feat(audit): implement warehouse stock audit log, screenshot upload and 30-day retention cleanup"`

---

### Task 2: Module 3 — UI for audit log, freshness badges & screenshot zoom (index.html, style.css, app.js, ocr.js, i18n.js)

**Files:**
- Modify: `index.html` (modal for audit log `#modal-stock-history`, full-screen zoom modal `#modal-screenshot-zoom`)
- Modify: `style.css` (freshness indicators, diff badges, screenshot thumbnails, zoom modal)
- Modify: `app.js` (history modal rendering, freshness badge rendering, zoom controls)
- Modify: `ocr.js` (compress and attach screenshot payload on OCR apply)
- Modify: `i18n.js` (add audit & freshness dictionary keys to `ru`, `en`, `de`)
- Test: `i18n.test.js`

- [ ] **Step 1: Add translation keys in `i18n.js` and test parity in `i18n.test.js`**
  Add keys under `audit`: `freshness_fresh`, `freshness_warning`, `freshness_stale`, `history_title`, `source_manual`, `source_ocr`, `diff_coupons`, `diff_puzzles`, `diff_stars`, `archived_screenshot_notice`, `view_screenshot`, `close`. Verify `node i18n.test.js`.
- [ ] **Step 2: Add modal markup in `index.html`**
  - Add modal `#modal-stock-history` (header with sector title, scrollable list of history cards with author, timestamp, source badge, diff chips, and screenshot preview or archive note).
  - Add zoom viewer modal `#modal-screenshot-zoom` with close button and pan/zoom container.
- [ ] **Step 3: Add styling in `style.css`**
  - Freshness dots and badges (`.freshness-tag.fresh`, `.warning`, `.stale`).
  - History cards layout (`.history-card`, `.diff-chip.positive`, `.diff-chip.negative`).
  - Screenshot thumbnail (`.history-thumb`) and zoom modal (`.zoom-modal-img`).
- [ ] **Step 4: Update `ocr.js` and `app.js` to send screenshot on apply**
  In `applyScanToProfile()`: compress current canvas/image to WebP/JPEG (85% quality) and pass `screenshotBase64` along with stock payload.
- [ ] **Step 5: Implement UI handlers in `app.js`**
  - `openStockHistoryModal(playerId)`: fetches `/api/players/:id/stock-history` and renders entries.
  - `openScreenshotZoom(url)` / `closeScreenshotZoom()`.
  - Render freshness badge in sectors table (`renderPlayersTable`) and player cabinet (`renderMyCabinet`).
  - Add button `📜 История склада` to sector cards.
- [ ] **Step 6: Verify syntax and test suites**
  Run `node -c app.js ocr.js i18n.js && node i18n.test.js && npm test`.
- [ ] **Step 7: Commit Task 2**
  `git commit -m "feat(ui): add stock freshness badges, audit history modal, screenshot viewer and ocr upload"`

---

### Task 3: Module 2 — Telegram Bot API service, webhook & template models (telegram.js, db.js, server.js)

**Files:**
- Create: `telegram.js` (native `fetch` wrapper for Telegram Bot API: `sendMessage`, `editMessageText`, `answerCallbackQuery`)
- Modify: `db.js` (`users` telegram columns, `app_settings` table, `notification_templates` table and default seeds)
- Modify: `logic.js` (`renderTemplate(template, data)`, placeholder registry)
- Modify: `server.js` (webhook handler `/api/telegram/webhook`, template CRUD APIs, staff bind token)
- Test: `db.test.js`, `logic.test.js`, `api.test.js`

- [ ] **Step 1: Write failing tests in `logic.test.js` for `renderTemplate`**
  Test template variable replacement (`{username}`, `{eventName}`, `{place}`, `{coupons}`, `{daysOverdue}`, etc.), HTML tag preservation, and fallback on missing keys.
- [ ] **Step 2: Implement `renderTemplate` in `logic.js`**
  Implement `renderTemplate` with default placeholder registry.
- [ ] **Step 3: Create `telegram.js` with unit mock tests**
  Implement pure native `fetch` client:
  - `sendTelegramMessage({ token, chatId, text, parseMode, replyMarkup })`
  - `editTelegramMessageText({ token, chatId, messageId, text, parseMode, replyMarkup })`
  - `answerTelegramCallback({ token, callbackQueryId, text, showAlert })`
- [ ] **Step 4: Update `db.js` with Telegram & Template schema**
  - Add columns to `users`: `telegram_chat_id`, `telegram_username`, `telegram_notifications_enabled`, `telegram_bind_token`, `telegram_bind_expires_at`.
  - Create table `app_settings` (`key TEXT PRIMARY KEY, value TEXT, updated_at TEXT`).
  - Create table `notification_templates` and seed the 7 baseline templates from the spec (`event_place_assigned`, `event_registration_opened`, `stock_reminder_personal`, `staff_new_user_pending`, `staff_event_deadline_24h`, `staff_event_autopick_summary`, `staff_stale_stocks_alert`).
  - Add DB methods: `getNotificationTemplates()`, `getNotificationTemplate(key)`, `updateNotificationTemplate(key, template)`, `resetNotificationTemplate(key)`, `getSetting(key)`, `setSetting(key, value)`.
- [ ] **Step 5: Implement webhook & Telegram management endpoints in `server.js`**
  - `POST /api/telegram/webhook`: handles `/start bind_<token>` (binds user), `/connect_staff <PIN>` (binds staff chat), and inline callbacks `approve_user:<id>` / `reject_user:<id>` with RBAC verification.
  - `GET /api/telegram/settings` (R4/R5), `PUT /api/telegram/settings` (R5: bot token, staff chat ID).
  - `POST /api/telegram/bind-token`: generates personal 15-minute bind token for current user.
  - `POST /api/telegram/staff-bind-token`: generates 15-minute pin code `KOW-STAFF-XXXX` (R5 only).
  - `GET /api/notification-templates`, `PUT /api/notification-templates/:key`, `POST /api/notification-templates/:key/reset`, `POST /api/notification-templates/:key/test`.
- [ ] **Step 6: Verify API tests pass**
  Run `node -c telegram.js server.js db.js && node db.test.js && node logic.test.js && node api.test.js`.
- [ ] **Step 7: Commit Task 3**
  `git commit -m "feat(telegram): add telegram bot service, webhook router, db migrations and template models"`

---

### Task 4: Module 2 — UI for Telegram integration & Template Editor (index.html, style.css, app.js, i18n.js)

**Files:**
- Modify: `index.html` (Telegram block in cabinet, Admin tab "Уведомления и шаблоны" with template editor and live preview)
- Modify: `style.css` (Telegram message bubble preview, placeholder chips palette, bind status badge)
- Modify: `app.js` (template editor state, live preview rendering, tag insertion, test send handlers, personal binding)
- Modify: `i18n.js` (templates & telegram dictionaries across `ru`, `en`, `de`)
- Test: `i18n.test.js`

- [ ] **Step 1: Add translations in `i18n.js` and verify parity**
  Add keys for Telegram connection, template titles, placeholders, live preview, test send, and reset. Run `node i18n.test.js`.
- [ ] **Step 2: Add Telegram UI to Player Cabinet in `index.html`**
  Add card «Интеграция с Telegram» in Cabinet: status badge (`Подключен: @username` or `Не привязан`), button «📱 Подключить Telegram», notification toggle.
- [ ] **Step 3: Add Template Editor UI in `index.html`**
  Add tab «Уведомления и шаблоны» in Settings/Admin view (available for R4/R5):
  - Bot connection card: token configuration, staff chat ID, button «Сгенерировать код привязки чата штаба», test button.
  - Template selector (7 events with badges `[👤 Личное]` / `[💬 Штаб]`).
  - Placeholder chips palette (clickable tags like `{username}`, `{eventName}`, `{place}`, etc. that insert at cursor).
  - Template textarea with HTML tags support.
  - Live Preview container styled as an authentic Telegram message bubble.
  - Action buttons: «💾 Сохранить шаблон», «↩️ Сбросить к базовому», «🚀 Отправить тест в Telegram».
- [ ] **Step 4: Add styling in `style.css`**
  - Authentic Telegram message bubble styling (`.tg-preview-bubble`, `.tg-meta-time`, checkmarks).
  - Tag chips palette (`.tag-chip`).
  - Telegram integration card in cabinet.
- [ ] **Step 5: Implement handlers in `app.js`**
  - `generateTelegramBindLink()`: requests `/api/telegram/bind-token` and opens `https://t.me/<bot>?start=bind_<token>`.
  - `generateStaffPinCode()`: requests `/api/telegram/staff-bind-token` and shows modal with `KOW-STAFF-XXXX`.
  - `loadNotificationTemplates()`, `selectTemplate(key)`, `insertTemplateTag(tag)`, `updateTemplateLivePreview()`.
  - `saveCurrentTemplate()`, `resetCurrentTemplate()`, `sendTestTemplateMessage()`.
- [ ] **Step 6: Verify syntax and test suites**
  Run `node -c app.js i18n.js && node i18n.test.js && npm test`.
- [ ] **Step 7: Commit Task 4**
  `git commit -m "feat(ui): add telegram binding in cabinet and notification template editor with live preview"`

---

### Task 5: End-to-end Notification Triggers & Automated Reminders (server.js, logic.js, api.test.js)

**Files:**
- Modify: `server.js` (dispatch notifications on event triggers, scheduled daily reminders)
- Modify: `logic.js` (notification formatting helpers)
- Test: `api.test.js` (integration tests for notification triggers)

- [ ] **Step 1: Write integration tests in `api.test.js`**
  Test notification dispatches for:
  - User registration -> sends `staff_new_user_pending` to staff chat with inline buttons.
  - Event place assignment -> sends `event_place_assigned` to assigned player.
  - Stale stock alert check -> identifies sectors >14d and dispatches `stock_reminder_personal` & `staff_stale_stocks_alert`.
- [ ] **Step 2: Implement notification trigger hooks in `server.js`**
  - In `POST /api/auth/register`: trigger `staff_new_user_pending`.
  - In event assignment saving: trigger `event_place_assigned`.
  - In event creation: trigger `event_registration_opened`.
  - In daily cron (at 00:00 UTC): check stale stocks (>14 days) and trigger `stock_reminder_personal` and `staff_stale_stocks_alert`.
- [ ] **Step 3: Verify all test suites pass**
  Run `npm test` and `node api.test.js` (100% pass).
- [ ] **Step 4: Commit Task 5**
  `git commit -m "feat(notifications): connect event triggers, staff inline alerts and automated stale stock reminders"`

---

### Task 6: Whole-Branch Review & Release v3.25.0 Cycle (GitFlow)

**Files:**
- Modify: `package.json` (bump version to 3.25.0)
- Modify: `index.html` (update sidebar version text to 3.25.0)
- Modify: `sw.js` (update cache name to `kow-cache-v3.25.0`)
- Modify: `CHANGELOG.md` (add entry for 3.25.0)

- [ ] **Step 1: Comprehensive Whole-Branch review**
  Review diff against `main` for security, zero-dependency compliance, RBAC, and memory safety.
- [ ] **Step 2: Full test suite pass**
  Verify all unit, DB, i18n, API, and deploy tests pass with 0 errors.
- [ ] **Step 3: Create release branch `release/v3.25.0`**
  Bump versions in `package.json`, `index.html`, `sw.js` and add release notes to `CHANGELOG.md`.
- [ ] **Step 4: Merge to `main` with `--no-ff` and tag `v3.25.0`**
  Merge `release/v3.25.0` into `main`, tag `v3.25.0`, delete temporary branches.
- [ ] **Step 5: Ensure strictly NO git push**
  Verify local repository status.
