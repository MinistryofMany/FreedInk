# Sign in with Tessera (OIDC)

Adds Tessera as a fourth sign-in path on FreedInk, alongside passkeys,
SIWE, and email recovery. Tessera is an external OpenID Connect identity
provider; FreedInk is the relying party (authorization-code flow + PKCE).

Built and verified end-to-end against a local Tessera dev server: new
account creation, session issuance, audit logging, and idempotent
re-sign-in (the second sign-in reuses the same FreedInk user).

## Files

Added:

- `src/lib/server/oidc.ts` — config from env, PKCE, discovery + JWKS cache,
  authorization-URL builder, code→claims exchange with `id_token`
  signature/iss/aud/nonce verification (via `jose`).
- `src/lib/db/oidc.ts` — `getUserByOidcIdentity`, `linkOidcIdentityToUser`,
  `createUserWithOidcIdentity`.
- `src/routes/api/auth/oidc/start/+server.ts` — GET: mints PKCE+state+nonce,
  stores the pending auth, 302s to Tessera.
- `src/routes/api/auth/oidc/callback/+server.ts` — GET: consumes state,
  exchanges code, verifies id_token, links-or-creates a user, issues a
  session, redirects to `/signup/identity` (new) or `/admin`.

Changed:

- `src/lib/db/schema.ts` — two tables: `oidc_sessions` (pending PKCE auths)
  and `oidc_identities` (issuer+subject → user); `usersRelations` updated.
- `src/routes/signup/+page.server.ts` — exposes `tesseraEnabled`.
- `src/routes/signup/+page.svelte` — "Sign in with Tessera" button (shown
  only when configured).
- `package.json` — adds `jose` (JWT/JWKS verification for OIDC).

## Environment

All four are required to enable the feature (absent → the button hides and
the endpoints return 503):

```
OIDC_TESSERA_ISSUER=http://localhost:3000
OIDC_TESSERA_CLIENT_ID=tc_freedink_dev
OIDC_TESSERA_CLIENT_SECRET=dev-only-freedink-secret-change-me
OIDC_TESSERA_REDIRECT_URI=http://localhost:5173/api/auth/oidc/callback
```

In production set the issuer to your deployed Tessera origin and the
redirect URI to `https://freed.ink/api/auth/oidc/callback`.

## Database

Two additive tables. Apply with `npm run db:push` (diffs `schema.ts`) or
`npm run db:generate` for a migration file. The DDL:

```sql
CREATE TABLE oidc_sessions (
  state         TEXT PRIMARY KEY,
  nonce         TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX oidc_sessions_expires_idx ON oidc_sessions (expires_at);

CREATE TABLE oidc_identities (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issuer    TEXT NOT NULL,
  subject   TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject)
);
CREATE INDEX oidc_identities_user_idx ON oidc_identities (user_id);
```

The cleanup job should also reap expired `oidc_sessions` (same as
`siwe_nonces`).

## Registering FreedInk as a Tessera client

On the Tessera side, either use the admin UI (`/admin/oidc-clients`) or the
seed script:

```sh
pnpm --filter @tessera/app oidc:seed-client \
  --name "FreedInk" \
  --redirect-uri http://localhost:5173/api/auth/oidc/callback \
  --scope openid --scope profile \
  --client-id tc_freedink_dev \
  --client-secret dev-only-freedink-secret-change-me
```

The redirect URI must match exactly (Tessera enforces exact match).

## How identities map

Tessera discloses a **pairwise** `sub` (unique per relying party) plus an
optional display name/avatar — never an email or username. FreedInk stores
`(issuer, sub)` in `oidc_identities`; the first sign-in creates a user with
a placeholder `tessera-…` username (rename-able in settings), and later
sign-ins resolve the same user by that pair. If the user is already signed
in (e.g. via passkey) when they click "Sign in with Tessera", the Tessera
identity is _linked_ to the existing account instead of creating a new one.

## Security

- PKCE (S256) mandatory; `state` is single-use (row deleted on callback);
  `nonce` checked against the id_token.
- `id_token` signature verified against Tessera's JWKS (EdDSA), with
  issuer + audience checks.
- The callback is a GET (CSRF guard only covers unsafe JSON methods), and
  both endpoints are rate-limited (`authStart` / `authFinish`).
- Suspended FreedInk users are refused a session, same as other paths.
