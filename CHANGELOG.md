# CHANGELOG — Orascom BIM Digital Delivery Hub

## 2026-10-03 — Phase A baseline (branch `hub/phase-a-baseline`, not merged, not deployed)
- Change: linked empty local folder to `https://github.com/itsmgendy1/orascom-bim-hub` (`origin/main` @ `896b1d2`); created baseline branch; hardened `.gitignore` (`.env*`, `*.pem`, selection files); added `AI_CONTEXT.md`.
- Reason: establish safe GitHub workflow (never `main`), prevent secret leaks, record Verified architecture for future sessions.
- Files: `.gitignore`, `AI_CONTEXT.md`, `CHANGELOG.md`.
- Tests: `git fetch origin`, `git ls-files` (31 files), live fetch `orascom-bim-hub.pages.dev` shell `?v=` match — pass.
- Deployment: none (local branch only). Rollback: `main @ 896b1d2` untouched.
- Remaining: Phase B Audit Report approval; XSS P1s; CSP/HSTS; README/automation mismatch; MODON ref pending; exposed PAT revocation pending.
