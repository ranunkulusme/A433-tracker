# Telegram Bot Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the KoW Tracker Telegram Bot into an autonomous self-service assistant for fighters (R3) and an operational command center for officers (R4/R5), with inline event registrations, server screenshot processing, multi-chat support, and Telegram Mini App HMAC-SHA256 validation.

**Architecture Constraints:**
- Zero external dependencies for backend (`node:http`, `node:sqlite`, `node:crypto`, `node:child_process`, `node:net`, `node:tls`).
- Pure native client in [telegram.js](file:///Users/ranunkulus/Downloads/KOW/telegram.js).
- Full RBAC enforcement: R3 personal commands vs R4/R5 officer commands.
- GitFlow discipline: work in `feature/telegram-bot-suite`, do NOT commit to `main`, do NOT create release tag.
- TDD: Test first, minimal code to pass, verify 100% green.

---

## File Structure & Responsibilities

| File | Primary Responsibility |
| :--- | :--- |
| `logic.js` | Pure business logic, message formatting (`/me`, `/deficit`, `/events`, `/who`, `/stale`, `/digest`), keyboard generators, and Telegram WebApp `initData` validation logic. |
| `logic.test.js` | Unit tests for new logic functions, formatters, and calculations. |
| `server.js` | Telegram update dispatcher (`handleTelegramUpdate`), command handlers, callback handlers (`reg_event`, `unreg_event`, `confirm_ocr_stock`), OCR processor, and API endpoints (`POST /api/auth/telegram-webapp`, `POST /api/telegram/channel-bind-token`). |
| `telegram.js` | Telegram Bot API client methods (`setMyCommands`, `setChatMenuButton`, existing methods). |
| `telegram.test.js` | Mock tests for bot handlers, callback queries, commands, and security checks. |
| `db.js` | Database queries for user lookup, event registration, staff/channel chat binding, and stock updates. |
| `api.test.js` | API endpoint integration tests including WebApp authentication. |

---

## Tasks

### Task 1: Git Branch Setup and Verification
- [ ] Create and checkout git branch `feature/telegram-bot-suite` from `main`.
- [ ] Run current test suite to confirm baseline green state (`logic.test.js`, `db.test.js`, `api.test.js`).
- [ ] Commit branch initialization.

---

### Task 2: Fighter Suite Logic & Formatters (TDD)
- [ ] **Write failing tests** in `logic.test.js`:
  - `formatTelegramMeMessage({ user, player, freshness, targetOfficer })` formats markdown/HTML with sector stats, stock counters, freshness badge, and officer progress.
  - `formatTelegramDeficitMessage({ player, targetOfficer, dailyVipCoupons, dailyVipPuzzles })` formats remaining coupons/puzzles to max 5-5-5-5, star requirements, and days estimate.
  - `formatTelegramEventsListMessage({ events, playerId })` formats list of upcoming events with participant status (assigned, registered, open).
  - `getTelegramMainMenuKeyboard({ isStaff })` returns inline keyboard with quick buttons (`👤 Мой сектор`, `📊 Дефицит`, `📅 Ивенты`, `📦 Склад`).
- [ ] **Implement formatters** in `logic.js`:
  - Implement `formatTelegramMeMessage`.
  - Implement `formatTelegramDeficitMessage`.
  - Implement `formatTelegramEventsListMessage`.
  - Implement `getTelegramMainMenuKeyboard`.
  - Export functions from `logic.js`.
- [ ] Run `node logic.test.js` to ensure all tests pass.
- [ ] Commit changes with message `feat(telegram): add fighter suite formatters and keyboards`.

---

### Task 3: Fighter Suite Command Handlers in `server.js`
- [ ] **Write failing tests** in `telegram.test.js` for commands:
  - Command `/me` or `/профиль` returns formatted player profile and inline keyboard.
  - Command `/me` for unbound user sends friendly binding guide.
  - Command `/deficit` or `/дефицит` returns deficit calculation.
  - Command `/events` or `/ивенты` returns upcoming events.
  - Command `/menu` sends main menu keyboard.
- [ ] **Implement handlers** in `server.js` (`handleTelegramUpdate`):
  - Handle `/me` / `/профиль`.
  - Handle `/deficit` / `/дефицит`.
  - Handle `/events` / `/ивенты`.
  - Handle `/menu`.
  - Update `/help` command to list all new commands.
- [ ] Run `node telegram.test.js` and `node logic.test.js` to verify.
- [ ] Commit changes with message `feat(telegram): implement /me, /deficit, /events and /menu command handlers`.

---

### Task 4: Interactive Event Registration & Desired Place Selection
- [ ] **Write failing tests** in `logic.test.js` and `telegram.test.js`:
  - `formatEventRegistrationKeyboard(eventId, places)` creates inline keyboard with places (#1, #2, #3, 4-10, Any).
  - Callback query `reg_event:<eventId>:<place>` registers player in event, saves to DB, edits message to show confirmed badge and `[❌ Отозвать заявку]` button.
  - Callback query `unreg_event:<eventId>` removes registration from event and restores selection keyboard.
- [ ] **Implement in `logic.js` & `server.js`**:
  - Add registration keyboard helpers in `logic.js`.
  - Add callback query handlers for `reg_event` and `unreg_event` in `handleTelegramUpdate` in `server.js`.
  - Update `event_registration_opened` notification dispatcher to attach registration buttons.
- [ ] Run `node telegram.test.js` to verify registration and unregistration workflows.
- [ ] Commit changes with message `feat(telegram): add interactive event registration via inline buttons`.

---

### Task 5: Officer Suite Commands (`/who`, `/stale`, `/ping_stale`, `/digest`)
- [ ] **Write failing tests** in `logic.test.js` and `telegram.test.js`:
  - `formatTelegramWhoMessage({ targetPlayer, targetUser, recentEvents })` formats player dossier.
  - `formatTelegramStaleReport({ stalePlayers })` formats list of sectors with stale warehouse data (>14 days) and TG handles.
  - `formatTelegramDigestMessage({ totalSectors, freshnessStats, nextEvent, pendingUsers })` formats alliance snapshot.
  - RBAC checks: `/who`, `/stale`, `/ping_stale`, `/digest` reject unauthorized R3 users and allow R4/R5 and staff chat.
  - `/ping_stale` sends reminders and returns summary.
- [ ] **Implement in `logic.js` & `server.js`**:
  - Implement formatters in `logic.js`.
  - Implement command routing in `handleTelegramUpdate` in `server.js`:
    - `/who <query>`
    - `/stale`
    - `/ping_stale [force]`
    - `/digest`
- [ ] Run `node logic.test.js` and `node telegram.test.js` to ensure 100% green.
- [ ] Commit changes with message `feat(telegram): implement officer command suite /who, /stale, /ping_stale, /digest`.

---

### Task 6: Server Screenshot Processing with OCR & Confirmation Fallback
- [ ] **Write failing tests** in `telegram.test.js`:
  - When photo has no caption numbers:
    - If OCR returns parsed stock numbers, send confirmation prompt with `[✅ Применить изменения]` callback.
    - If OCR is not available, save screenshot, record audit entry, and send interactive prompt `[✅ Текущие остатки актуальны]` or `/stock`.
  - Handle `callback_query`: `confirm_ocr_stock:<id>` and `confirm_current_stock`.
- [ ] **Implement in `server.js`**:
  - Implement `tryServerOcr(imageBuffer)`: checks for `tesseract` binary via `which tesseract` / `child_process.execFile`; if found, runs OCR and calls `logic.parseWarehouseScreenshotText`.
  - Add confirmation callback query handlers in `handleTelegramUpdate`.
- [ ] Run `node telegram.test.js` to verify screenshot handling.
- [ ] Commit changes with message `feat(telegram): add server screenshot OCR and interactive confirmation`.

---

### Task 7: Multi-Chat Channels & Telegram Mini App HMAC-SHA256 Authentication
- [ ] **Write failing tests** in `telegram.test.js` and `api.test.js`:
  - `logic.validateTelegramWebAppData(initData, botToken)` validates HMAC-SHA256 signature according to Telegram specification.
  - Rejects tampered data or expired auth_date (>24h).
  - API endpoint `POST /api/auth/telegram-webapp` successfully creates session for matched user.
  - Settings and command `/connect_channel <PIN>` binds `telegram_announcement_chat_id`.
- [ ] **Implement in `logic.js`, `db.js`, `server.js`**:
  - Implement `validateTelegramWebAppData` in `logic.js`.
  - Add `POST /api/auth/telegram-webapp` in `server.js`.
  - Add `telegram_announcement_chat_id` setting in `db.js` and `/connect_channel` command.
  - Add `setChatMenuButton` call in `telegram.js` / `syncTelegramBotInfoAndPolling` to configure WebApp button.
- [ ] Run `node telegram.test.js` and `node api.test.js` to verify.
- [ ] Commit changes with message `feat(telegram): add WebApp HMAC authentication and announcement channel support`.

---

### Task 8: Full Test Suite Verification and Acceptance Check
- [ ] Run all test suites:
  - `node logic.test.js`
  - `node db.test.js`
  - `node s3.test.js`
  - `node telegram.test.js`
  - `node api.test.js`
  - `node deploy.test.js`
  - `node i18n.test.js`
- [ ] Check syntax of all JavaScript files (`node -c server.js && node -c telegram.js && node -c logic.js && node -c db.js`).
- [ ] Verify `git status` shows clean branch `feature/telegram-bot-suite`.
- [ ] **Do NOT merge to `main` and do NOT create release tag** (per user instruction).
- [ ] Report completion to user with verification logs.
