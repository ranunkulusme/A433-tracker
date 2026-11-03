# Mieru Tunnel Integration & Native SOCKS5 Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide end-to-end Mieru client tunnel management directly from the KoW Tracker web interface (supporting both individual form fields and raw JSON with bi-directional sync) and route Telegram Bot traffic through an in-house native SOCKS5 proxy with zero external npm dependencies.

**Architecture:** A native SOCKS5/HTTP tunnel connector in `telegram.js` utilizing pure `node:net` and `node:tls`; a Mieru client process supervisor in `mieru.js` managing config file lifecycle and process execution; backend REST endpoints for settings and live connection pinging in `server.js`; and a dual-mode reactive UI in `index.html`/`app.js` with full `ru`/`en`/`de` i18n parity.

**Tech Stack:** Node.js 22 native modules (`node:net`, `node:tls`, `node:http`, `node:crypto`, `node:sqlite`, `node:child_process`), Vanilla JS, HTML5, CSS3, i18next, Alpine Linux, Docker.

**Spec:** [docs/superpowers/specs/2026-11-04-mieru-tunnel-integration-design.md](file:///Users/ranunkulus/Downloads/KOW/docs/superpowers/specs/2026-11-04-mieru-tunnel-integration-design.md)

## Global Constraints

- Zero external npm dependencies added to the backend (`server.js`, `db.js`, `telegram.js`, `mieru.js`).
- Strict adherence to GitFlow: development on `feature/mieru-tunnel-integration`, release on `release/v3.26.0`, merge `--no-ff` into `main`, annotated tag.
- Never push to remote repository (per user explicit rule).
- Strict RBAC: only R5 can save/mutate Mieru configuration; R4/R5 can view settings and run test pings.
- 100% test pass on `npm test` and syntax check `node -c`.
- Complete 100% dictionary key parity across Russian (`ru`), English (`en`), and German (`de`) in `i18n.js`.

## Review Focus

- Malformed or noisy port range inputs (e.g. `10000 - 10050`, single port `443`, or invalid range) must be safely sanitized and validated.
- Raw JSON paste with invalid syntax must be caught gracefully without crashing the server or wiping existing configuration.
- Password masking in `GET /api/mieru/settings` so secret credentials are never exposed in plaintext to the browser once saved.
- SOCKS5 handshake timeout or proxy server unreachable must fail gracefully with a readable error message rather than hanging the server process.
- Clean process shutdown on server restart or disabled toggle (no orphan Mieru processes).

---

### Task 1: Native SOCKS5 & HTTP CONNECT Proxy Client in `telegram.js`

**Files:**
- Modify: `telegram.js`
- Test: `telegram.test.js`

- [ ] Write failing unit tests in `telegram.test.js` for SOCKS5 handshake, HTTP CONNECT tunnel, and proxy error handling.
- [ ] Run `node telegram.test.js` to verify tests fail (RED).
- [ ] Implement `createSocks5Connection({ host, port, proxyHost, proxyPort, timeoutMs })` using pure `node:net` and RFC 1928 handshake.
- [ ] Implement `createHttpConnectConnection({ host, port, proxyHost, proxyPort, timeoutMs })` using pure `node:net` and HTTP `CONNECT`.
- [ ] Update `callTelegramApi` in `telegram.js` to support `options.proxyUrl` (or env/appSetting `telegram_proxy` / `mieru_socks5_port`).
- [ ] Run `node telegram.test.js` and verify all tests pass (GREEN).
- [ ] Verify syntax `node -c telegram.js telegram.test.js`.

---

### Task 2: Mieru Client Manager & Backend API in `mieru.js`, `db.js`, `server.js`

**Files:**
- Create: `mieru.js`
- Modify: `db.js`
- Modify: `server.js`
- Test: `api.test.js`

- [ ] Write failing integration tests in `api.test.js` for `GET /api/mieru/settings`, `PUT /api/mieru/settings` (RBAC R5 vs R3/R4), and `POST /api/mieru/test`.
- [ ] Run `node api.test.js` to verify tests fail (RED).
- [ ] In `db.js`, add helpers for Mieru app settings with defaults (`mieru_enabled`, `mieru_server`, `mieru_port_range`, `mieru_user`, `mieru_password`, `mieru_transport`, `mieru_socks5_port`, `mieru_config_json`).
- [ ] In `mieru.js`, implement `formatMieruConfig`, `parseMieruConfig`, `startMieruProcess`, `stopMieruProcess`, `getMieruStatus`, and `testMieruConnection`.
- [ ] In `server.js`, register `GET /api/mieru/settings`, `PUT /api/mieru/settings`, and `POST /api/mieru/test`.
- [ ] In `server.js`, wire Mieru auto-start on server boot if `mieru_enabled === 'true'` and wire proxy into `dispatchNotification`.
- [ ] Run `node db.test.js && node api.test.js` to verify all tests pass (GREEN).
- [ ] Verify syntax `node -c mieru.js server.js db.js`.

---

### Task 3: UI Editor with Bi-directional Form/JSON Sync in `index.html`, `app.js`, `style.css`

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `style.css`
- Modify: `i18n.js`
- Test: `i18n.test.js`

- [ ] In `i18n.js`, add `mieru` dictionary across `ru`, `en`, `de` with 100% key parity (titles, field labels, tabs, placeholders, tooltips, test results).
- [ ] Run `node i18n.test.js` to verify 100% dictionary key parity.
- [ ] In `index.html`, add `#card-mieru-settings` in `#page-notifications` with toggle, tab switcher (Form vs Raw JSON), fields, JSON textarea, save and test buttons.
- [ ] In `style.css`, add styling for Mieru card, tab controls, JSON textarea with monospace font, ping badge, and status pill.
- [ ] In `app.js`, implement `renderMieruBlock`, `switchMieruTab`, `syncMieruFormToJson`, `syncMieruJsonToForm`, `saveMieruSettings`, and `testMieruConnection`.
- [ ] Export all UI handlers to `window`.
- [ ] Verify syntax `node -c app.js i18n.js`.

---

### Task 4: Dockerfile Packaging, Comprehensive Verification & Release

**Files:**
- Modify: `Dockerfile`
- Modify: `package.json`
- Modify: `CHANGELOG.md`

- [ ] In `Dockerfile`, add multi-arch step to download official `mieru` client binary from GitHub releases into `/usr/local/bin/mieru`.
- [ ] Run full test suite: `npm test` (unit, db, s3, telegram, api, deploy, i18n).
- [ ] Build and test Docker container locally with `docker compose build`.
- [ ] Create release branch `release/v3.26.0`, bump version in `package.json`, update `CHANGELOG.md`.
- [ ] Merge `--no-ff` into `main`, tag `v3.26.0`.
- [ ] Verify `git status` (no remote push per user rule).
