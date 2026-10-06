# Orascom BIM Digital Delivery / QA-QC Hub

Unified hub for the five BIM validation tools. Open `index.html` (landing page),
then **Enter Hub** → `hub.html` (command center).

## Structure

```text
HUB/
├── index.html                  Homepage / landing (cinematic hero + module cards → hub.html#/view)
├── hub.html                    Main hub shell (sidebar, project picker, dashboard, iframes)
├── assets/css/hub.css          Hub design system (navy/gold, Barlow)
├── assets/js/hub.js            Router, KPI engine, project registry, issues, search (window.OHub)
├── assets/img/orascom-logo.*   Branding
├── modules/
│   ├── delivery-verification.html  MIDP + As-Built + file-exchange audit (from HTMLs/)
│   ├── naming-convention.html      OCC naming rule engine (from HTMLs/)
│   ├── parameter-validator.html    LOIN completeness (from HTMLs/)
│   ├── model-quality.html          Multi-discipline model health (from HTMLs/)
│   ├── workset-validator.html      Workset assignment (from HTMLs/)
│   └── clash.html                  Coordination review (hub-native bonus module)
├── automation/                   Revit→Hub pipeline (pyRevit batch export +
│                                 local CORS export server + nightly .bat)
├── HTMLs/                      Pristine sources (untouched)
├── OC Hub/                     Previous hub iterations (untouched, reference only)
└── README.md
```

## Architecture — why iframes

Each validator is a 300KB–1MB self-contained app with global functions, duplicate
IDs and its own Chart.js/Excel/PDF stack. Merging them into one runtime risks
silently breaking validation logic, so each runs **byte-identical in an isolated
iframe** behind one navigation shell. One validator cannot break another.

Per-module edits vs. its `HTMLs/` source (applied by `build_modules.py` logic,
verified by audit):

1. **Score hook** — one guarded line at the tool's existing point of truth,
   reusing the exact variables its own KPI cards display:
   | Module | Hook site | Score | Issues |
   |---|---|---|---|
   | Delivery | end of `renderKpiRow()` | `pct` delivery rate | `missing` |
   | Naming | end of `runCheck()` | `computeSummary(RESULTS).rate` | `.fail` |
   | Model Quality | end of `launch(data)` | mean `pass_rate` | sum `failed` |
   | Workset | after `renderAll()` in `generateDashboard()` | `SUMMARY.pct` | `invalid+missing` |
   | Parameter | end of `launchDashboard()` | `OVERALL.pct` | `elementCount-completeElements` |
2. **Context bridge** — listens for Hub `postMessage` (`window.OrascomHubContext` +
   `orascom-hub-context` event) and forwards scores via
   `window.OrascomHubReportScore(score, issues, {projectField})` (no-op standalone).
3. **CSP cleanup** — removed the `frame-ancestors 'none'` token (Parameter,
   Workset) so Hub embedding is allowed. No other behavior change.

## Data & scoring

- **BIM Delivery Health = Σ(score × weight) / Σ(weights with data).**
  Weights: Delivery 20 / Naming 15 / Model Quality 25 / Workset 15 /
  Parameters 15 / Clash 10. Editable in Settings; modules with no result are
  excluded (never scored as 0, never faked).
- Hub state (projects, models, scores, issues, deliverables, weights,
  thresholds) lives in this browser's `localStorage` (`ohub_*` keys — no
  collision with module keys such as `occ_naming_rules`, `bim_*`, `param_*`,
  `wv-dark`).
- Modules keep their own imports/exports/tabs/filters — nothing removed.
 - Deep links: `hub.html#/naming`, `#/midp`, `#/qaqc`, `#/workset`, `#/parameters`,
   `#/clash`, `#/models`, `#/dashboard`, `#/quality-center`, `#/reports`, `#/delivery`, `#/stages`, `#/gis`, `#/program`.

## Beyond the five validators (ported from OC Hub)

 - **GIS tab** (`hub.html#/gis`) — plots board: the Orascom plots (DP01 + DP05)
   boundaries on one theme-aware map (assigned plots in health colors,
   unassigned as dashed outlines) plus a register with area/units/population
   and one-click assign to the active project. KPIs are reference figures;
   geometry is what gets stored.
 - **Site boundaries** — paste GeoJSON (or load a `.geojson` file, or pick a
   built-in DP plot) on the project form; the Projects → Map view draws it as a health-toned shaded polygon
   (points capped, validated, stored on the project record and its JSON export).
 - **Stage Gates** (`hub.html#/stages`) — design-stage sign-off matrix per
   package (Concept → As-built); click a cell to advance it. Hand-recorded,
   never inferred; included in the project JSON export.
 - **Models registry** — per-project model list (code, discipline, revision,
  status, owner); issues can reference a model; demo SA39 seeds 3 models
  (project + models only, never scores).
- **Validator → issue auto-push** — each score report carries up to ~20 concrete
  findings (missing deliverables, top naming failure reasons, invalid workset
  rows, weakest parameters, failed checks); the Hub files them as `auto` issues,
  de-duplicated and capped at 20 open per module/project.
- **Executive export** — Hub-level Excel workbook (Summary/Models/Issues/
  Deliverables) + Executive PDF, with export history on the Reports view.
- **Export-server loading** — with `automation/serve_exports.py` running,
  Delivery (ACC + MIDP), Workset and Parameter modules offer "Load from Hub
  export server" (latest export per model, no file picker). Naming and Model
  Quality intentionally excluded: their multi-file HTML imports don't fit the
  single-file `/latest` endpoint (same reason QA-QC was left unwired before).
- **Dark mode** (Hub shell; module iframes keep their own theme), **project
  JSON export**, **model-aware search**, **report history**.
- **Delivery timeline** (REH-Gantt-inspired) — KPIs (tracked/on-track/delayed/
  submitted) plus a due-date timeline with today marker and overdue rings on the
  Delivery Overview page. Unscheduled items are listed, never faked.
- **Copy lists** (REH check→element pattern) — Workset/Parameter detect a real
  `Element Id`/`IfcGUID`-style column when the CSV has one and copy IDs, else
  copy filtered rows as TSV with an honest notice; Delivery copies missing
  deliverables; Naming copies filtered results. Model Quality has no
  element-level rows, so nothing to copy there.
- **Clash parity** — Excel import, discipline-pair filter, tolerant Navisworks
  results-XML import (test-definition XMLs get guidance instead of silence),
  and direct **Navisworks HTML report import** (verified field-by-field against
  `P0152-…-000001`: 12,708 listed rows, real Element IDs, test pairing —
  report summaries may claim higher totals since the HTML lists a subset).
  IDs/grid/clash-name are mappable targets carried into table, copy and Excel.
- **Package grouping** — optional package field on models, with filter, column
  and search support (programme-friendly without MODON-specific structure).
- **Data Center** (`hub.html#/datacenter`) — import shared files once, push to
  any validator. Model Checker HTML goes to Naming + Model Quality in one bulk
  action (both auto-run); CSV bulk goes to Workset + Parameter; single files to
  any target incl. Delivery ACC/MIDP roles and Clash. Files live in the tab's
  memory only. Sending opens the module automatically.
- **ACC model picker** (same view, no API/admin) — point it at the Desktop
  Connector synced folder to browse building → discipline → models, tick what
  to test (checks persist per folder), and download `hub_selection.txt`.
  Save it beside `run_rbp_nightly.bat`: the scanner's `--select` keeps only
  matches (suffix-matched, warns on moved files). Folder handle persists in
  IndexedDB for one-click Rescan; Firefox falls back to a folder input.
- **Unified dark mode** — one navy palette (Workset reference) across Hub shell
  and all six modules; the Hub topbar toggle is the single source of truth when
  embedded (in-module toggles report upward), standalone files keep local keys.
  Already-rendered Chart.js canvases recolor on next Generate (Model Quality
  recolors live).
- **Health trend + portfolio compare** — every reported score snapshots into
  capped `ohub_history`; dashboard trend chart (overall + per-module) and a
  Projects Compare view (table + health bars).
- **Guided tour** — first-run spotlight plus topbar replay.
- **Clash parity** — Excel import, discipline-pair filter, Navisworks XML import
  (tolerant parser into the existing mapping flow; verify against a real XML).
- **Naming server-load** — `type=qaqc` with section inference for rbp CSVs
  (server supplies items + Element IDs; scoring stays in-module).

## Run locally

No backend needed. Open `index.html` directly, or serve the folder
(e.g. `python -m http.server`) and visit `http://localhost:8000/`.
Internet is only needed for CDN libraries (Chart.js, ExcelJS, jsPDF, fonts,
Leaflet map); validators otherwise run offline once cached.

## Deploy to Cloudflare Pages

The working tree is ~529MB, but the app is a 21-file / 22MB static subset
(Pages rejects any file over 25MB — the 27.5MB Clash Report HTML alone would
fail the deploy, and sources/archives/automation must not ship).

1. `python tools\build_deploy.py` — assembles `deploy/` and verifies limits.
2. Pages dashboard → Create → Pages → Upload assets → drag `deploy/`,
   **or** `wrangler pages deploy deploy/`. No build command, no output-dir
   tricks, no redirects file (all navigation is `#/` hash routes).
   With the Git bridge connected, pushing/merging to `main` redeploys
   production automatically (plus PR previews).
3. Local pipeline keeps working unchanged: run `serve_exports.py` on your
   machine as usual. It now answers Private Network Access preflights, so the
   HTTPS-hosted Hub can still reach your `http://localhost:8787` — verified
   with a simulated Pages-origin preflight (204 + headers).
4. Forma login: add your Pages URL to the APS app callbacks as
   `https://<your-site>.pages.dev/auth.html` (`callbackUrl()` in
   `assets/js/forma.js` builds this automatically from wherever the Hub is
   served — no code change per environment). Keep `http://localhost:8000/auth.html`
   registered too for local use.

## Revit automation (no ACC admin, no API, no tokens)

**Connector flow (recommended — no token, no admin):** install Desktop Connector → Select Projects →
tick the project → right-click each building/discipline folder → *Always keep
on this device* (v16+) so versions stay current on disk → point `SCAN_ROOT` in
`automation/run_rbp_nightly.bat` at the synced Project Files folder → schedule
the bat overnight in Task Scheduler. The scanner skips not-downloaded cloud
stubs and zero-byte files explicitly (`SKIP offline stub` log lines,
`--include-offline` overrides); RBP opens models **detached**, never touching
central. Nine models take minutes — no watcher needed.

**Cloud browser flow (optional, needs a free APS token):** if models aren't
synced locally, run `python automation/browse_acc.py` (one-time setup in
`automation/APS_SETUP.md` — free, ~5 minutes). It signs you in as yourself
(`data:read` only), lets you tick `.rvt` files in your ACC hubs/projects/
folders, and writes `automation/selected_models.json`. Both `automation/
batch_export.py` and the RBP lane read that file alongside `models.txt` / the
scanned tree — you don't need to choose one source, both run in the same batch.

Live-tested 2026-09-09 on `P0152-K00146-OCC-UB02-ZZ-M3-AR-000001.rvt` (Revit
2025, detached): 3,769 schedule elements, 16 real naming findings with Element
IDs, 86/106 Model Checker checks evaluated (20 honest NotRuns), File Size /
Warnings / Worksets metrics verified true (70.2 MB / 61 / 516). Serve +
Hub-fetch verified per type, including folder names with spaces.

1. List models in `automation/models.txt`, set paths in
   `automation/run_nightly_export.bat`, schedule it (Task Scheduler).
2. Wire your real `lib/` export calls into `automation/batch_export.py`
   `export_one()` (call sites are marked).
3. Run `python automation/serve_exports.py`, then use "Load from Hub export
   server" inside the Delivery/Workset/Parameter/Naming/Model-Quality modules
   (`workset`, `parameters`, `qaqc`, `modelhealth-html`, `midp-acc`,
   `midp-list`, `clash`).
4. Headless Model Checker lane: `automation/rbp/task_modelchecker.py` evaluates
   `Revit Model Best Practices for Revit 2026.xml` inside RBP and emits
   `modelhealth-html-<stamp>-<Model>.html`, shaped for the Model Quality
   parser and verified against its patterns (11/11). Output is RBP-labeled,
   never passed off as Autodesk Model Checker output; unsupported checks are
   NotRun, never guessed. Discipline auto-assign follows the module's
   `-LOC-M3-DISC-` filename convention, else falls back gracefully.

## Autodesk Forma (no Autodesk account, no API needed)

The default path is pure file import: export Area metrics / Units from Forma
Site Design as CSV, drop it in the Data Center — the Hub sniffs Forma content
(`forma`, or `proposal` + `gfa`/`site area`), offers **Forma snapshot**, and
pins the figures to the active project. Same dashboard card as the live link,
badged "file import", works offline from `file://`.

Optional live link (still free): Autodesk lists the Forma API, Authentication
and Data Management APIs as **free, no-token APIs** — only heavy compute APIs
(Model Derivative jobs, Design Automation hours…) consume Flex tokens, which a
read-only dashboard never touches. If you want it: free APS app → Client ID in
Settings → serve over HTTP → Connect → link by Forma Project ID. The code stays
in the tree either way; nothing is written back to Forma in any path. File
exports from Forma also drop straight into the Data Center.

## Export-server auto-sync (no clicks)

Settings holds the server URL (default `http://localhost:8787`), the model
folder (defaults to the active project code), and an auto-sync switch.
`Sync now` (Settings or Data Center) pulls every latest export once, stages
each file in the Data Center registry with provenance, and queues it to its
module(s): open modules receive instantly, the rest get theirs from the outbox
on open (a previous lost-message race on back-to-back pushes is fixed via a
true load flag). Naming/Model Quality auto-run; mapping modules wait at their
mapping screen. With auto-sync on, this runs silently ~2.5s after Hub load;
missing types (404) are skipped, failures toast only on manual sync.

## ACC cloud browser (live, inside the Hub)

Data Center → **ACC cloud — browse live** talks to the real ACC project
tree with no Desktop Connector involved. The static Hub can't finish APS
OAuth itself, so `serve_exports.py` acts as the bridge: it owns the PKCE
pair, captures the redirect, keeps the token in server memory only
(`data:read`), and proxies hub/project/folder reads (paginated).

- **Connect to ACC** opens the Autodesk sign-in popup; the Hub polls the
  runner and loads your hubs when you're in. Folders expand lazily;
  ticking a folder loads its whole subtree and checks every `.rvt`.
- **Save selection** writes `selected_models.json` beside the automation
  scripts — the exact file `batch_export.py` (pyRevit cloud lane) reads.
  If the server write fails it falls back to a download.
- **Add checked → Models** registers cloud models in the Hub (badged ☁ —
  they belong to the cloud lane, not the local file-path validation run).
- One-time setup (`automation/APS_SETUP.md`): register
  `http://localhost:8787/acc-callback` on the APS app and add the app under
  ACC Account Admin → Custom Integrations. The runner prints the exact
  callback URL on startup; `--aps-client-id` overrides the built-in ID.

## One-click validation from the Models tab (local runner)
With `serve_exports.py` running on your workstation, the Models tab's
"Choose what to validate" bar gains a local runner — no file copying:

1. Tick **Run** on the models to validate.
2. **Check selection** — pushes the selection to the server and resolves every
   path against your Connector tree (`gen_file_list --select`, no Revit).
   Anything that doesn't resolve is listed so you can fix the model's file
   path or re-sync the folder in Desktop Connector.
3. **▶ Run validation now** — pushes the selection as `hub_selection.txt` and
   launches `run_rbp_nightly.bat` on this machine (detached, logging to
   `<exports>/logs/`). Progress streams into the Models tab (~5 s polls);
   when it finishes, pull results via Data Center → Sync from export server.

Start the server with the automation folder wired in (defaults already do
this when launched from `automation/`):

    python automation/serve_exports.py --root C:\OrascomBIM\exports --port 8787

`--hub-dir` (default: the script's folder) tells the runner where
`run_rbp_nightly.bat` and `hub_selection.txt` live; `--scan-root` (default:
read from the batch file's `SCAN_ROOT`) tells **Check selection** which
Connector tree to resolve against. `/run` executes exactly that one batch
file — nothing from the browser is ever executed — so only start the server
on a workstation you trust.

## Full automation (scheduled nightly, zero clicks)

Once the pieces above work on demand, three scheduled bits close the loop —
after that, opening the Hub in the morning shows current health:

1. **Nightly batch (Task Scheduler).** Run `automation/run_rbp_nightly.bat`
   on schedule. It builds the file list from `SCAN_ROOT` filtered by
   `hub_selection.txt` (pushed from the Hub, persists on disk), runs RBP
   `task_all.py`, then runs `automation/rollup_scores.py` (headless,
   non-fatal) which writes `hubscores-<batch>-<Model>.json` per model.
   Example (23:00 daily, workstation time):
   `schtasks /create /tn "OrascomBIM Nightly" /tr "\"C:\…\HUB\automation\run_rbp_nightly.bat\"" /sc daily /st 23:00`
   Revit needs an interactive desktop: run **only when logged on**, never as
   SYSTEM/hidden, and leave the machine on with the user signed in.
2. **Export server at logon.** `serve_exports.py` must be up when the Hub is
   open: add a logon task (or a shortcut in `shell:startup`) running
   `python automation/serve_exports.py --root C:\OrascomBIM\exports`.
3. **Hub auto-sync ON.** Settings → server URL (`http://localhost:8787`) +
   auto-sync switch. ~2.5 s after load the Hub pulls exports AND ingests the
   newest rollup batch: each rollup is matched to the project owning the
   model, multi-model scores are pooled the way a module fed concatenated
   inputs would (pooled valid/total, pooled filled/applicable, pooled
   pass/fail, mean of Model Checker pass rates), and recorded through the
   same path interactive module runs use — findings land in Quality Center
   as `auto` issues.

Score math is a line-by-line port of each module's default path
(`rollup_scores.py` header lists the exact formulas and mirrored defaults),
verified against real exports. Two honest limits: **naming** uses the OCC
segment defaults (per-user custom browser rules can't be seen headlessly —
the JSON records `rule_basis`, and opening the module re-scores with your
rules); **delivery** and **clash** have no headless source and stay manual.
A per-project ledger (`pid|module → batch`) stops the same batch
re-applying on every load, and hand-entered scores are never overwritten —
a newer nightly batch always wins over older auto scores.

## Known limitations

- Project context is one-way (Hub → module); modules don't yet filter by it.
- Hub search covers projects/issues/deliverables/navigation, not rows inside a module.
- No backend: single-browser `localStorage`, no multi-user presence.
