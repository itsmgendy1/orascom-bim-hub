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

## Known issues (Phase A/B, Verified unless noted)
- README describes `automation/`, `tools/build_deploy.py`, `HTMLs/`, `OC Hub/`, 529MB tree — absent from repo (31 files). Deploy method undocumented (Not verified).
- XSS High: `modules/workset-validator.html:950,1114-1118,1367-1492` raw CSV → innerHTML. Medium: `model-quality.html:5527`, `parameter-validator.html:2745`, `hub.js:3887` username → onclick. `postMessage '*'` + no `ev.origin` check. Missing CSP/HSTS. Auth demo-grade.
- Perf: modules 329KB–1.2MB single files + 12.9MB `showreel.mp4` + ~6MB hero PNGs. 1000+ row / IndexedDB / import-export stress Not verified.
- MODON benchmark: no access — Not verified.

## How to run/test/deploy
- Run: open `index.html` or `python -m http.server` → `http://localhost:8000/`.
- Test (planned): Playwright e2e + unit (scoring) + Lighthouse + axe; fixtures `0/1/10/100/1000+`, corrupt/empty/large/unexpected-column.
- Deploy: Pages manual upload or `wrangler pages deploy` (no config in repo — confirm method before prod).
