# AI_CONTEXT — Orascom BIM Digital Delivery Hub

Source: `https://github.com/itsmgendy1/orascom-bim-hub`, branch `main` @ `896b1d2` (Verified 2026-10-03 via `git fetch`).
Production: `https://orascom-bim-hub.pages.dev/` — shell `?v=` hashes match `main` (Verified via live fetch).

## Architecture
- Static, no build, no backend. Entry `index.html` (hero + login) → `hub.html` (shell, 17 views, 6 iframes in `modules/*.html`).
- Vanilla JS `window.OHub` (`assets/js/hub.js`); auth `ohub-auth.js` (local SHA-256 + Worker team login); Forma `forma.js` (PKCE, `data:read`); plots `site-plots.js`.
- Validators run isolated in same-origin iframes; scores via `postMessage {source:'orascom-hub-module',type:'score-update'}` → `applyModuleScore()` (missing modules excluded, hand-entered `auto:false` never clobbered).
- Health defaults (configurable in Settings, not hard-coded): midp 20 / naming 15 / qaqc 25 / workset 15 / parameters 15 / clash 10. Thresholds ok 90 / warn 75.
- Storage: `localStorage ohub_*` (17 keys) + module keys (`occ_naming_rules`, `bim_*`, `param_*`, `wv-dark`) + IndexedDB (`ohub_acc`, `ParamValidatorDB`). Single-browser, last-write-wins cloud sync to `orascom-hub-sync.*.workers.dev`.
- CDN (offline-degraded): Leaflet 1.9.4, ExcelJS, jsPDF+autotable, Chart.js, PapaParse/xlsx/html2canvas/jszip/pptx (per module), Google Fonts, Three.js 0.160.0 (landing only).

## Conventions
- Never push to `main`. Work on `hub/<topic>`, open PR, preview-test, prod only after explicit approval + rollback ref.
- Secrets via env/connector only, never chat, never client-side. `.gitignore` covers `.env*`, `*.pem`, selection files.
- Headers in `_headers` (no global CSP by design — would break module CDNs; `X-Frame-Options:SAMEORIGIN`).

## Known issues (Verified unless noted)
- Fixed P1 (live): workset/model-quality/parameter/hub.js XSS escaping; same-origin postMessage Hub<->6 modules; HSTS; README structure/deploy rewritten to repo truth.
- Fixed P2 (live): auth honesty (demo-grade labels, 12+ setup, plain$ auto-upgrade); Forma session-only refresh option; module CSP connect-src +cdnjs; tests/fixtures ladder.
- Routing observation (2026-10-03): all `*.html` URLs 308 to extensionless (`/hub.html`→`/hub`); no `_redirects` in repo or deploy; owner unknown — browsers follow transparently, app verified working.
- Remaining: full CSP enforcement (needs per-module preview testing), import/export unification, Playwright runner (no runner here), P3 (AI/API/AIM); MODON benchmark: no access.
- Local-only `Backup/` + `Sources/` dirs are untracked and git-ignored; never commit.

## Session handoff (2026-10-03, continued on company PC next)
- `main` = `f7228c6` (live on Pages). Open branches: `hub/login-ux @ ac49253`
  (cloud-first login, gate label removed, request link above ENTER — needs merge
  approval, rollback `main @ f7228c6`), older merged-branch heads remain remote.
- Auth backend LIVE: worker `orascom-hub-auth` + D1 `orascom-hub-db`, 35/35 API
  pass. Admin user `admin` (password set privately, never in repo).
- Tokens live in-session ONLY on this machine — company PC needs them again
  (GitHub fine-grained + Cloudflare Workers/D1/Pages). gh CLI + node/wrangler
  install steps are in chat history.
- Blocked on user: login-ux merge, browser smoke (4 modules + Incognito),
  308-redirect owner, P3/CSP/unification/Playwright scoping.

## How to run/test/deploy
- Run: open `index.html` or `python -m http.server` → `http://localhost:8000/`.
- Test (planned): Playwright e2e + unit (scoring) + Lighthouse + axe; fixtures `0/1/10/100/1000+`, corrupt/empty/large/unexpected-column.
- Deploy: Pages manual upload or `wrangler pages deploy` (no config in repo — confirm method before prod).
