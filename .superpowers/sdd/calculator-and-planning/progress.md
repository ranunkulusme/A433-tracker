# SDD ledger — plan: docs/superpowers/plans/2026-10-24-calculator-and-event-planning.md

## Pre-flight
- Pre-flight: no shared interface conflicts.

Task 1: complete (OFFICER_TYPES exported, tests pass: node logic.test.js -> 12 ok)
Task 2: complete (calculateOfficerDeficit and simulateEventProgress implemented, tests pass: node logic.test.js -> 14 ok)
Task 3: complete (smartAutoPick implemented and tested, tests pass: node logic.test.js -> 15 ok)
Task 4: complete (renderCalculator UI added with Personal Simulator and Guild Matrix, tests pass: node logic.test.js -> 15 ok)
Task 5: complete (smartAutoPick and efficiency badges integrated into event modal, node -c app.js clean, node logic.test.js -> 15 ok)

Final Review Fixes:
- Critical 1 fixed: smartAutoPick strict full-deficit check (c.deficitCoupons >= p.coupons) verified with TDD (RED->GREEN).
- Important 2 fixed: calculateOfficerDeficit includeStock: false for guild matrix view to prevent stock duplication across officers (RED->GREEN).
- Important 3 fixed: smartAutoPick uses slotIndex to avoid key collision on duplicate place numbers (RED->GREEN).
- Important 4 fixed: Personal Simulator dynamically resolves rewards from active event type via resolveEventPlaces.
- Minors addressed: Troop type badge in simulator, dynamic generation list in matrix filter, default officerId assignment in event modal.
- Troop icons polish: Replaced tractor (🚜) with SVG tank icon for 'Танк', and shield (🛡️) with military helmet (🪖) for 'Пехота'.
All 18 unit tests green.
