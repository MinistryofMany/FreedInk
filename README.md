# Freed.Ink

Collaborative anonymous blogging platform. Members of a blog can publish, review, and comment without individual attribution, gated by **Semaphore** zero-knowledge group-membership proofs. Login is **email + passkey** or **Sign-In With Ethereum**, and each user holds a client-side Semaphore identity encrypted with a password (rotatable).

## Quick start (Docker)

```sh
cp .env.example .env
# edit .env, at minimum generate SESSION_SECRET:
#   openssl rand -hex 32
docker compose up --build
```

This brings up Postgres, the SvelteKit app on `:3000`, and Caddy on `:80`/`:443`.

Visit `https://freed.ink.localhost` (accept the local TLS cert Caddy generates) — WebAuthn requires HTTPS so don't use the bare `http://localhost:3000` for passkey flows.

## Local development (without Docker app container)

```sh
npm install
docker compose up -d postgres            # just the DB
cp .env.example .env                     # adjust DATABASE_URL host to localhost
npm run db:migrate                       # apply migrations
npm run dev
```

For passkey testing, use `caddy reverse-proxy --from freed.ink.localhost --to :5173` (or any TLS-terminating proxy).

## Architecture

- **SvelteKit 2** (TypeScript) + `adapter-node`
- **Postgres 16** via `postgres` (postgres.js) + **Drizzle ORM** for schema/migrations
- **WebAuthn** via `@simplewebauthn/{server,browser}`
- **SIWE** via `siwe` + `ethers` (optional, links to a user account alongside passkeys)
- **Semaphore Protocol v4** for anonymous proofs (`@semaphore-protocol/{core,group,proof}`)
- Client-side identity vault: `Identity` secret is AES-GCM encrypted under an Argon2id-derived key from the user's password; ciphertext stored in Postgres. Lost-password = **rotate identity**; old identities are kept revoked so historical proofs still verify against their original snapshot.

## Identity rotation + group snapshots

Every blog has a sequence of **member snapshots**. A snapshot is the exact set of identity commitments eligible to prove membership at one point in time. Whenever a member is added, removed, or an existing member rotates their identity, a new snapshot row is written. Each post / review / comment stores the snapshot root it was proven against, so old proofs remain verifiable forever.

The voting threshold (default `2/3`) is computed against the **eligible count from the snapshot the vote was proven under**, not the current count, so adding members during a vote doesn't move the goalposts.

## Scripts

| script                | what it does                                         |
| --------------------- | ---------------------------------------------------- |
| `npm run dev`         | Vite dev server                                      |
| `npm run build`       | Production build (adapter-node)                      |
| `npm run db:generate` | Generate a migration from `src/lib/db/schema.ts`     |
| `npm run db:migrate`  | Apply pending migrations                             |
| `npm run db:push`     | Push schema without generating migrations (dev only) |
| `npm run db:studio`   | Drizzle Studio (DB browser)                          |
| `npm test`            | Vitest run                                           |

## Project structure

```
src/
  lib/
    db/                  schema, drizzle client, query modules
    server/              node-only helpers (sessions, semaphore verify, webauthn, email)
    client/              browser-only helpers (semaphore proof generation, identity vault)
    components/
  routes/
    api/
      auth/              register / login / link
      identity/          create / rotate
      blog/              create, group, post, role mgmt
      post/              review, comment
    admin/               authenticated authoring + management
    b/                   public reading
migrations/              drizzle-generated SQL
scripts/                 migrate runner, seeds
docker-compose.yml       postgres + app + caddy
```

## Operations

### Health check

`GET /healthz` returns JSON `{status, db, ts}`. 200 when the DB is reachable in
<2s, 503 otherwise. Used by the `app` container's docker healthcheck and by
your external monitor (UptimeRobot, Healthchecks.io, etc.).

### Scheduler / cleanup

A separate `scheduler` container runs `scripts/cleanup.ts` on a loop (default
every 10 min, configurable via `CLEANUP_INTERVAL_SECONDS`). It reaps expired
rows from: `sessions`, `siwe_nonces`, `webauthn_challenges`, `email_verifications`,
`post_submission_nonces`, `account_recoveries`, `rate_limits`, and unaccepted/
revoked `blog_invitations`. Each pass logs one JSON line with per-table counts.

Run a one-off pass:

```sh
npm run cleanup
```

### Backups & restore

The `backup` container runs `scripts/backup.sh` on a loop (default every 6
hours; tune with `BACKUP_INTERVAL_SECONDS`). Each run emits a custom-format
dump file `freedink-YYYYMMDDTHHMMSSZ.dump` into the `freedink_backups`
docker volume mounted at `/backups`. Files older than 14 days
(`BACKUP_RETENTION_DAYS`) are pruned automatically.

**Manual backup from your dev machine** (writes to `./backups/`):

```sh
npm run backup
# requires `pg_dump` on PATH; override with PG_DUMP_BIN=/custom/path/pg_dump
```

**Listing backups from the running stack:**

```sh
docker compose exec backup ls -lh /backups
```

**Restore a dump** into a fresh database (DESTRUCTIVE — wipes existing data):

```sh
# 1. Copy the dump out of the volume (skip if you already have a local copy).
docker compose cp backup:/backups/freedink-20240101T000000Z.dump ./restore.dump

# 2. Drop and recreate the target DB (offline maintenance window!).
docker compose exec postgres dropdb -U freedink freedink
docker compose exec postgres createdb -U freedink freedink

# 3. Restore. --clean --if-exists makes pg_restore tolerant of partial state.
docker compose exec -T postgres pg_restore \
    --username=freedink --dbname=freedink --no-owner --clean --if-exists \
    < ./restore.dump

# 4. Re-run migrations to no-op-check schema is consistent.
npm run db:migrate
```

For a point-in-time restore use the most recent dump _before_ the incident,
then replay any application-level events from the audit log if needed.

### Graceful shutdown

The app honours `SIGTERM`/`SIGINT`: it stops accepting new requests, waits up
to `SHUTDOWN_GRACE_SECONDS` (default 25) for in-flight requests to complete,
closes the Postgres connection pool, and exits 0. Rolling deploys should
prefer SIGTERM over SIGKILL.

### Migration safety

`npm run db:migrate` is wrapped in a Postgres advisory lock. Running it
concurrently (two app instances during a deploy, two operators with their
shells) is safe — only one acquires the lock; the other waits up to 60s,
acquires it, and finds nothing to apply.

## Security model (short)

- Passwords for the identity vault never leave the browser; only the encrypted blob is stored.
- Session cookies: `HttpOnly`, `Secure` (prod), `SameSite=Lax`, signed with `SESSION_SECRET`.
- Every Semaphore proof is verified server-side and its nullifier consumed (UNIQUE constraint) — no replays.
- Anon key / Supabase RLS is no longer relevant; all writes go through SvelteKit endpoints that enforce role + proof.
