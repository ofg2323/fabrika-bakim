# AGENTS.md

Turkish-language CMMS (factory maintenance) app: a vanilla-JS PWA SPA plus an Express/PostgreSQL REST API. No bundler, transpiler, linter, typechecker, or build step — files run as-is.

## Layout and entrypoints

- `backend/src/server.js` is the only server entrypoint. It mounts `/api/<domain>` routers, serves `fabrika-bakim.html` and root assets, and serves `/uploads/:filename`. Frontend and API are same-origin (default `http://localhost:3001`).
- `fabrika-bakim.html` is the whole UI (~5.2k lines: markup, CSS, inline JS).
- `api-client.js` is the fetch/JWT wrapper (`window.CMMS_API`); access token lives in `localStorage.cmms_token`.
- `cmms-sync.js` is the live API layer: it reassigns `window.boot`, `loadDB`, `saveX`, `deleteX`, and `reloadX` after the inline script runs. The inline versions in the HTML are the old localStorage implementation (`DB_KEY = 'cmms-db'`).
- `table-sort.js` adds automatic table sorting; `sw.js` + `manifest.json` implement the PWA.
- `backend/src/modules/<domain>/<domain>.routes.js` holds one router per domain. Shared helpers live in `backend/src/utils/` and `backend/src/middleware/`; the schema is `backend/src/db/schema.sql`.

When changing CRUD/persistence behavior, edit `cmms-sync.js` (and `api-client.js`), not only the inline handler in `fabrika-bakim.html`; otherwise the change is shadowed at runtime. Rendering/markup changes still belong in the HTML.

## Commands (run from `backend/`)

```bash
npm install
cp .env.example .env        # DATABASE_URL and JWT_SECRET are required
npm run db:migrate          # apply pending migrations (fresh DB: schema.sql baseline)
npm run db:status           # show applied/pending migrations
npm run db:backup           # Docker deployment: DB + uploads backup to backups/
npm run dev                 # node --watch src/server.js
npm start
npm test                    # creates/uses <db>_test, runs tests on port 3101
npm run test:setup          # create + migrate the test database only
node --test tests/12_realtime_sync.test.js   # single test file (needs TEST_DATABASE_URL or *_test DB)
node scripts/generate-icon.js                # recreate root PWA icons/favicon
```

No lint/typecheck/build script exists. Run backend commands from `backend/` so `UPLOAD_DIR` (default `./uploads`) resolves to `backend/uploads`; `.env` is loaded explicitly from `backend/.env`.

## Data and schema gotchas

- Only three roles exist: `Yönetici`, `Teknisyen`, `Depo Sorumlusu` (DB `CHECK` and `ALLOWED_ROLES`). README mentions of `Bakımcı`/`Operatör` are stale.
- `schema.sql` is the frozen baseline (`0001_initial`). All schema changes go into `src/db/migrations/NNNN_name.sql` and are applied by `npm run db:migrate` (transactional, checksum-tracked, advisory-locked). Never edit `schema.sql` or an applied migration; add a new migration instead. Legacy `scripts/migrate-p0.js`…`migrate-p4.js` are historical and must not be used for new installs.
- Never run `node scripts/setup-db.js` on data you care about: it drops/recreates `fabrika_bakim` and creates `fabrika_user` with a hardcoded password and `SUPERUSER`.
- DB columns are snake_case; API payloads are camelCase. Add/use a `toCamelX` mapper in `backend/src/utils/formatters.js` and do not leak snake_case.
- Tracking numbers (`A`, `B`, `C`, `D`, `K`, `P` + 5 digits) must come from `getNextTrackingNo(kind)` in `src/utils/counters.js`; never generate them client-side.
- PostgreSQL `DATE` (oid 1082) is parsed as a `YYYY-MM-DD` string in `src/db/pool.js` to avoid timezone shifts. Keep date-only values as strings.
- Multi-table writes (purchase → stock → needs, maintenance/fault material consumption, calibration asset links) use `pool.connect()` with `BEGIN`/`COMMIT`.

## API conventions

- Most routers begin with `router.use(requireAuth)`; public endpoints are `/api/health` plus `/api/auth` login, refresh, logout, first-admin, and user-list.
- DELETE is restricted: mostly `requireRole('Yönetici')`; needs-list and stock movements also allow `Depo Sorumlusu`. Tests assert `Teknisyen` receives `403`.
- Lists use `parsePagination`/`setPaginationHeaders`. No `limit` returns 10000 rows (the SPA loads full lists); most modules cap an explicit `limit` at 200 (`assets` allows 10000), and `all=true` bypasses the cap. Responses include `X-Total-Count`, `X-Limit`, `X-Offset`. The README's "default 50" is stale.
- Uploads go through `middleware/upload.js` (`upload.single(...)` includes MIME/extension checks, magic-byte validation, and a 100 MB limit). Store only the generated filename; `/uploads/*` requires auth except `logo-*` and `.ico` files.
- Any successful POST/PUT/PATCH/DELETE automatically bumps the in-memory sync version and notifies SSE clients via middleware in `server.js`; new write routes need no extra wiring. The version resets on restart, with polling fallback on clients.
- Adding a domain touches: schema table → router → mount in `server.js` → `api-client.js` method → `cmms-sync.js` `loadDB`/`reloadX` and `window.db` key → HTML rendering.
- Global frontend state is `window.db` (`users`, `assetGroups`, `assets`, `materials`, `maintenanceRecords`, `faults`, `inspectionRecords`, `extMaintRecords`, `calibrationRecords`, `purchases`, `needsList`, `stockMovements`, `suppliers`, `projects`, `faultNotifications`, `printTemplate`).

## Tests

- Tests use `node:test`, must run serially, and hit the isolated test PostgreSQL from `DATABASE_URL` (set by `scripts/run-tests.js`). If nothing is listening on port 3101, `tests/helpers.js` starts the server in-process; override with `API_BASE`/`TEST_PORT`.
- `helpers.getAdminToken()` finds or creates a user named `Test Yöneticisi` and signs a JWT directly with `JWT_SECRET`; it may rewrite that user's password.
- Tests run against an isolated `<db>_test` database (created/migrated automatically by `npm test`) on port 3101; `tests/helpers.js` refuses to run against a database whose name does not end in `_test` unless `ALLOW_DESTRUCTIVE_TESTS=1`. Some cleanup queries delete rows (for example `faults WHERE title LIKE '%test%'`) and reset counters; use unique names/timestamps and clean up in `after()`.
- There are 13 test files (`01`–`13`); README claims of 10 files/81 tests are outdated.
- PWA tests expect `icon-192.png`, `icon-512.png`, and `favicon.ico` at the repo root. These are gitignored; run `node scripts/generate-icon.js` if missing.

## Frontend and PWA

- All user-facing text and API error messages are Turkish. Display dates as `DD.MM.YYYY`; send `YYYY-MM-DD` to the API. Bulk fault import also accepts Turkish/Excel date formats via `parseDateStr`.
- Escape interpolated values with `esc()` and validate external links with `safeUrl()`.
- Root frontend files are served by hardcoded routes in `server.js`. A new root asset needs a route there and an entry in `sw.js` `PRECACHE_ASSETS`.
- When changing precached frontend assets, bump `CACHE_NAME` in `sw.js` and the `?v=` suffix in `fabrika-bakim.html`.
- `sw.js` is network-first for static files and never caches `/api/*` or `/uploads/*`.
