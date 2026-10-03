# Hub Auth+Data Worker (D1 + sessions + RBAC + audit)

Additive backend for per-user accounts and user-isolated data. The Pages Hub
and the old KV workspace sync are untouched.

## Provision (once)

Needs a token with **Workers Edit + D1 Edit** (the read-only audit token
cannot do this):

```powershell
$env:CLOUDFLARE_API_TOKEN="<workers+d1 token>"
winget install OpenJS.NodeJS.LTS   # once per machine
npm i -g wrangler
wrangler d1 create orascom-hub-db   # copy id -> wrangler.toml database_id
wrangler d1 execute orascom-hub-db --file=./schema.sql --remote
wrangler secret put BOOTSTRAP_KEY   # random 32+ chars, one-time admin setup
wrangler deploy                     # -> https://orascom-hub-auth.<account>.workers.dev
```

## First admin (once)

```powershell
Invoke-RestMethod -Method Post "$WORKER/api/admin/bootstrap" `
  -Body (@{setupKey="<BOOTSTRAP_KEY>"; username="admin"; password="<12+ chars>"} | ConvertTo-Json) `
  -ContentType "application/json"
```

Then login on the Hub with the team-server URL set to the Worker URL
(Settings → Cloud sync no longer used for this lane; Login → team server
field or the new account UI). Rotate BOOTSTRAP_KEY / keep it offline.

## API (cookie `ohub_sid`, CORS: Pages origins + localhost)

Public: `POST /api/auth/request|login`, `POST /api/auth/logout`,
`GET /api/auth/me`, `POST /api/auth/password`.
Own data: `GET|PUT|DELETE /api/data/:store` (stores: projects scores issues
deliverables models gates weights thresholds activity reports history dark).
Admin: `GET|POST /api/admin/users`, `PATCH|DELETE /api/admin/users/:id`,
`GET /api/admin/data/:uid[/:store]`, `GET /api/admin/audit`,
`GET|PUT /api/admin/settings` (registration_open 0/1).

Isolation rule: every row is keyed by the **session's** user_id; a forged
userId in the body is ignored (there is no such parameter).
