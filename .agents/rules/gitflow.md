# GitFlow Workflow Rules

## Branch Management
- `master`: Production-only, tagged releases. No direct commits.
- `feature/*`: Feature development, branched from `master`.
- `bugfix/*` / `fix/*`: Bug fixes.
- `release/vX.Y.Z`: Release preparation (SemVer bump, CHANGELOG update, test pass).
- Merges to `master` must use `--no-ff` and be tagged with annotated tag `vX.Y.Z`.
- Always delete feature and release branches after merge.

## Commits
- Use Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.

## Testing
- Run full suite before releases: `node logic.test.js && node db.test.js && node api.test.js`.
