# CHANGELOG — Orascom BIM Digital Delivery Hub

## 2026-10-03 — Login UX (branch `hub/login-ux`, unmerged)
- Change: ENTER tries built-in cloud accounts first, then local (no manual server URL needed); removed "(Browser-local gate.)" suffix; team-server toggle documented (tooltip + inline hint); Request-account link moved above ENTER.
- Reason: admin cloud login failed without a typed server URL; link discoverability.
- Files: index.html.
- Tests: logic review; browser verification pending.
- Deployment: none yet. Rollback: `main @ f7228c6`.

## 2026-10-03 — Auth UX (branch `hub/auth-ux`, unmerged)
- Change: request form email now mandatory (client regex + Worker 400); removed ACCOUNT SERVER field — built-in auth-Worker URL used (saved team URL still wins).
- Reason: simpler signup; one account server.
- Files: index.html, assets/js/ohub-auth.js, worker/src/index.js (redeployed).
- Tests: pending browser + API retest (email-missing 400).
- Deployment: worker redeployed; Pages side none yet. Rollback: `main @ 2fe5e9e`.

## 2026-10-03 — Multi-user auth + user data (branch `hub/multiuser-auth`, unmerged)
- Change: new additive `worker/` backend (D1 schema, session-cookie auth, PBKDF2, RBAC ADMIN/USER+4, per-user stores, audit log, registration toggle, bootstrap); extended existing login card (request-account mode, v2 team login w/ legacy fallback); Hub dataset switch (pull/push/migrate/stash/wipe) + Users & Access view (admin tables, audit, registration, inspector; account card for all).
- Reason: per-user accounts, backend-enforced isolation, admin control. Existing login UI/nav/modules untouched; legacy local + team flows preserved.
- Files: worker/{schema.sql,wrangler.toml,README.md,src/index.js}, assets/js/{ohub-auth,hub}.js, index.html, hub.html.
- Tests: ref-count + diff review; live API + browser verification pending (needs D1/Workers deploy + upgraded token).
- Backend LIVE 2026-10-03: D1 `orascom-hub-db` + worker deployed, first ADMIN bootstrapped, **35/35 API tests pass** (isolation, tamper→403/401, audit, registration, password rotation, disable/enable); test accounts cleaned.
- Deployment: none yet. Rollback: `main @ 962e701`.
- Remaining: provision D1 + deploy worker + bootstrap admin (needs Workers+D1 Edit token); Playwright/security retest (UserA/B tamper, admin perms).

## 2026-10-03 — Asset versions (branch `hub/asset-versions`, unmerged)
- Change: bumped `?v=` cache-busters (content hashes) for all P1/P2-touched assets: hub.js, forma.js, ohub-auth.js (hub.html + auth.html) and all 6 module iframes (MODULES array). Unchanged files (hub.css, site-plots.js) untouched.
- Reason: `/assets/*` serves `immutable, max-age=1y` — without new versions, returning visitors/edge cache would run stale pre-P1/P2 JS.
- Files: hub.html, auth.html, assets/js/hub.js.
- Tests: hash ↔ file match verified; no logic touched.
- Deployment: none yet. Rollback: `main @ 2a1c5f1`.

## 2026-10-03 — P2 standardize (branch `hub/p2-standardize`, unmerged)
- Change: auth honesty (demo-grade labels, 12+ char setup, plain$ auto-upgrade on login); Forma refresh token session-only option + Settings checkbox, strict OAuth state check, safe auth-msg fallback; module meta CSP connect-src +cdnjs (sourcemap noise); tests/fixtures ladder (0/1/10/100/1000, dup, missing, xss, extra-cols).
- Reason: Audit P2 (A1, F1, CSP touch-up, fixtures). No scoring/import/export logic touched.
- Files: assets/js/ohub-auth.js, assets/js/forma.js, assets/js/hub.js, hub.html, index.html, modules/{clash,parameter-validator,workset-validator}.html, tests/fixtures/.
- Tests: diff review per hunk; fixtures generated deterministically (seed 42); browser + preview verification pending.
- Deployment: none yet. Rollback: `main @ c87626e`.
- Remaining: full CSP enforcement, import/export unification, Playwright (no runner here), P3 items.

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
