# GoYacht

Boat and yacht rental platform: private charters, scheduled departures (seats and private areas), all-in packages, Midtrans payments with deposits, refunds and partner settlements.

- Product spec: [`docs/PRD.md`](docs/PRD.md); agreed amendments: [`docs/decisions.md`](docs/decisions.md)
- Engineering rules: [`AGENTS.md`](AGENTS.md)
- API reference: [`docs/openapi.yaml`](docs/openapi.yaml)

## Architecture

| Component | Path | Notes |
| --- | --- | --- |
| API | `backend/cmd/api` | Go, Chi, pgx/sqlc. All business logic. `/api/v1`, `/healthz`, `/readyz`, metrics on `:9090` (internal only) |
| Worker | `backend/cmd/worker` | River jobs: email, media conversion, holds, reminders, reconciliation, retention |
| CLI | `backend/cmd/cli` | migrations, first admin, reference data, key generation, health checks |
| Frontend | `frontend/` | React Router (framework mode, SSR), Tailwind. Renders only; calls the API |
| Database | PostgreSQL 18 + btree_gist | Source of truth for inventory (exclusion constraints) and the job queue |
| Storage | SeaweedFS (S3 API) | Public bucket served at `/media`, private bucket streamed by the API to admins |
| Proxy | Caddy | HTTPS, `/api/*` → API, `/media/*` → public bucket, rest → SSR |

## Local development

Requirements: Docker with Compose.

```sh
git config core.hooksPath .githooks          # rejects AI attribution trailers
docker compose -f compose.dev.yml up --build
```

- App: http://localhost:8000 (Caddy → Vite dev server and API with hot reload)
- Mailpit (captured email): http://localhost:8025
- PostgreSQL: `localhost:5432` (goyacht/goyacht)

Google login needs `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` in your shell or a `.env` next to `compose.dev.yml`, with `http://localhost:8000/api/v1/auth/google/callback` as an authorized redirect URI. Midtrans sandbox keys are read the same way.

First-time data setup:

```sh
docker compose -f compose.dev.yml exec api go run ./cmd/cli seed reference        # payment methods, default policies, settings
docker compose -f compose.dev.yml exec api go run ./cmd/cli admin grant you@example.com
```

`admin grant` allowlists the email; the account becomes ADMIN on its first Google login (or immediately if it already exists). Further admins are invited from the admin dashboard.

### Running without Docker

- Backend: Go 1.27.3, `libvips-dev`, a PostgreSQL and an S3-compatible store. Copy the variables from `compose.dev.yml` into your environment, then `go run ./cmd/cli migrate up`, `go run ./cmd/api`, `go run ./cmd/worker`.
- Frontend: Node.js 24.22.2, `npm ci`, `npm run dev` (Vite proxies `/api` to `API_INTERNAL_URL`, default `http://localhost:8080`).

## Environment variables

All variables are listed with placeholders in [`.env.example`](.env.example). The API and worker validate configuration at startup and refuse to start on missing or malformed values. Production requires Google, Midtrans, SMTP and Turnstile settings; development allows them to be empty (the related features then return clear errors).

| Variable | Used by | Purpose |
| --- | --- | --- |
| `APP_URL`, `APP_DOMAIN`, `ACME_EMAIL` | all, Caddy | public origin and TLS certificate |
| `DATABASE_URL` / `POSTGRES_*` | api, worker | database |
| `IDENTITY_ENCRYPTION_KEYS`, `IDENTITY_ENCRYPTION_ACTIVE_KEY` | api, worker | AES-256-GCM keys `id:base64(32 bytes)`, comma-separated for rotation |
| `S3_*`, `MEDIA_PUBLIC_URL` | api, worker | object storage |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | api | Google OIDC login |
| `MIDTRANS_*` | api, worker | Snap, Status API, refunds; `MIDTRANS_PRODUCTION=false` uses the sandbox |
| `SMTP_*`, `MAIL_FROM_*`, `ADMIN_NOTIFY_EMAILS` | worker | email through any SMTP provider |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | frontend, api | bot protection on public booking tracking |
| `BACKUP_*` | backup | off-site copy target |

Key rotation: generate a key (`cli keygen`), append it to `IDENTITY_ENCRYPTION_KEYS`, set `IDENTITY_ENCRYPTION_ACTIVE_KEY` to its id and restart. Existing ciphertexts stay readable with their original key; never remove a key while data encrypted with it may still exist (identity numbers are purged 90 days after the trip by default).

## Database migrations

Migrations live in `backend/db/migrations` (goose) and are embedded in the CLI. River's own schema is migrated by the same command.

```sh
docker compose run --rm migrate                         # production: runs `cli migrate up`
docker compose exec api cli migrate status
docker compose exec api cli migrate down                 # rolls back one migration
```

SQL queries are in `backend/db/queries` and compiled with sqlc (`go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1 generate` from `backend/`). CI fails when generated code is out of date.

## Testing

```sh
# backend: unit + integration tests against a real PostgreSQL (one throwaway database per test)
cd backend
TEST_DATABASE_URL=postgres://goyacht:goyacht@localhost:5432/goyacht?sslmode=disable go test -race ./...

# frontend
cd frontend && npm run typecheck && npm run check:i18n && npm test && npm run build
```

`backend/internal/scenarios` contains one automated test per mandatory scenario in PRD section 19 (concurrency, idempotency, webhooks, refunds, uploads, email delivery, login, commit hook). Integration tests are skipped when `TEST_DATABASE_URL` is unset.

## Production deployment (single VPS)

1. Install Docker and the Compose plugin. Point DNS for `APP_DOMAIN` at the VPS and open ports 80 and 443.
2. Clone the repository, `cp .env.example .env`, fill in every value (`openssl rand -base64 32` for passwords; `docker compose run --rm api cli keygen` for the identity key once the image is built).
3. Build and start:

   ```sh
   docker compose build
   docker compose up -d
   docker compose exec api cli seed reference
   docker compose exec api cli admin grant owner@example.com
   ```

4. Configure the Midtrans dashboard notification URL to `https://APP_DOMAIN/api/v1/webhooks/midtrans` and the finish redirect to `https://APP_DOMAIN`.
5. Set SPF, DKIM and DMARC for the sender domain of `MAIL_FROM_ADDRESS`.

Updating: `git pull && docker compose build && docker compose up -d`. The `migrate` service runs before the API and worker start. Expect a few seconds of downtime while containers restart.

Operations:

```sh
docker compose ps                        # health of every service
docker compose logs -f api worker        # JSON logs with request_id
docker compose stop                      # stop everything (data volumes are kept)
docker compose down                      # remove containers, keep volumes
```

## Backup and restore

The `backup` service runs every day at 02:30 WITA:

- `pg_dump` in custom format to the `backups` volume (7 days kept locally), verified with `pg_restore --list`;
- the dump and a mirror of both buckets copied to the off-site S3-compatible target in `BACKUP_*` (dumps kept `BACKUP_RETENTION_DAYS`).

Run a backup now: `docker compose exec backup backup.sh`.

Restore (stop writers first):

```sh
docker compose stop api worker
docker compose exec backup restore.sh /backups/db-20261101T183000Z.dump      # or s3:db-20261101T183000Z.dump
docker compose start api worker
```

Restore media by syncing the off-site `media/<bucket>` folders back into the store, e.g. with `rclone sync`. Test a restore at least once a quarter on a scratch VPS. There is no point-in-time recovery in v1: up to 24 hours of data can be lost (accepted in `docs/decisions.md`).

## Repository layout

```
backend/   Go modules (cmd/, internal/modules/*, internal/platform/*, db/, locales/)
frontend/  React Router app (app/routes, app/components/ui, app/features, app/locales)
docker/    Caddy, SeaweedFS and backup configuration
docs/      PRD, decisions, OpenAPI
.githooks/ commit-msg hook
```
