# CHANGELOG — Orascom BIM Digital Delivery Hub

## 2026-10-03 — P1 security (branch `hub/p1-security`, unmerged)
- Change: XSS escaping in workset-validator (11 sites), model-quality sidebar (DOM build), parameter tooltip (textContent); hub.js team/GIS string-in-onclick → encodeURIComponent/data-attribute; same-origin postMessage Hub<->6 modules (file:// behavior preserved); HSTS header; README structure/deploy rewrite to match repo reality.
- Reason: Audit P1 (X1, X2, M1, H1, D1). No scoring/import/export logic touched.
- Files: modules/*.html (6), assets/js/hub.js, _headers, README.md.
- Tests: bridge-post/guard grep counts, diff review; browser + preview verification pending (no local browser).
- Deployment: none yet. Rollback: `main @ 6c08140`.
- Remaining: CSP (P2, needs per-module preview testing), P2/P3 items.

## 2026-10-03 — Phase A baseline (branch `hub/phase-a-baseline`, not merged, not deployed)
- Change: linked empty local folder to `https://github.com/itsmgendy1/orascom-bim-hub` (`origin/main` @ `896b1d2`); created baseline branch; hardened `.gitignore` (`.env*`, `*.pem`, selection files); added `AI_CONTEXT.md`.
- Reason: establish safe GitHub workflow (never `main`), prevent secret leaks, record Verified architecture for future sessions.
- Files: `.gitignore`, `AI_CONTEXT.md`, `CHANGELOG.md`.
- Tests: `git fetch origin`, `git ls-files` (31 files), live fetch `orascom-bim-hub.pages.dev` shell `?v=` match — pass.
- Deployment: none (local branch only). Rollback: `main @ 896b1d2` untouched.
- Remaining: Phase B Audit Report approval; XSS P1s; CSP/HSTS; README/automation mismatch; MODON ref pending; exposed PAT revocation pending.
