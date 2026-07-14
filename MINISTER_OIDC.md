# Sign in with Minister (OIDC)

Adds Minister as a fourth sign-in path on FreedInk, alongside passkeys,
SIWE, and email recovery. Minister is an external OpenID Connect identity
provider; FreedInk is the relying party (authorization-code flow + PKCE).

Built and verified end-to-end against a local Minister dev server: new
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
  stores the pending auth, 302s to Minister.
- `src/routes/api/auth/oidc/callback/+server.ts` — GET: consumes state,
  exchanges code, verifies id_token, links-or-creates a user, issues a
  session, redirects to `/signup/identity` (new) or `/admin`.

Changed:

- `src/lib/db/schema.ts` — two tables: `oidc_sessions` (pending PKCE auths)
  and `oidc_identities` (issuer+subject → user); `usersRelations` updated.
- `src/routes/signup/+page.server.ts` — exposes `ministerEnabled`.
- `src/routes/signup/+page.svelte` — "Sign in with Minister" button (shown
  only when configured).
- `package.json` — adds `jose` (JWT/JWKS verification for OIDC).

## Environment

All four are required to enable the feature (absent → the button hides and
the endpoints return 503):

```
OIDC_MINISTER_ISSUER=http://localhost:3000
OIDC_MINISTER_CLIENT_ID=freedink_dev
OIDC_MINISTER_CLIENT_SECRET=dev-only-freedink-secret-change-me
OIDC_MINISTER_REDIRECT_URI=http://localhost:5173/api/auth/oidc/callback
```

In production set the issuer to your deployed Minister origin and the
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

## Registering FreedInk as a Minister client

On the Minister side, either use the admin UI (`/admin/oidc-clients`) or the
seed script:

```sh
pnpm --filter @minister/app oidc:seed-client \
  --name "FreedInk" \
  --redirect-uri http://localhost:5173/api/auth/oidc/callback \
  --scope openid --scope profile \
  --client-id freedink_dev \
  --client-secret dev-only-freedink-secret-change-me
```

The redirect URI must match exactly (Minister enforces exact match).

## How identities map

Minister discloses a **pairwise** `sub` (unique per relying party) plus an
optional display name/avatar — never an email or username. FreedInk stores
`(issuer, sub)` in `oidc_identities`; the first sign-in creates a user with
a placeholder `minister-…` username (rename-able in settings), and later
sign-ins resolve the same user by that pair. If the user is already signed
in (e.g. via passkey) when they click "Sign in with Minister", the Minister
identity is _linked_ to the existing account instead of creating a new one.

## Security

- PKCE (S256) mandatory; `state` is single-use (row deleted on callback);
  `nonce` checked against the id_token.
- `id_token` signature verified against Minister's JWKS (EdDSA), with
  issuer + audience checks.
- The callback is a GET (CSRF guard only covers unsafe JSON methods), and
  both endpoints are rate-limited (`authStart` / `authFinish`).
- Suspended FreedInk users are refused a session, same as other paths.

## Anonymous-identity handoff (Ministry → FreedInk)

When FreedInk's OIDC client is **anon-enabled** on Minister (the admin sets
`OidcClient.anonAppId`, e.g. `freedink` — immutable thereafter), Minister's
consent page derives a per-app secret from the user's Ministry root seed and
appends it to the callback redirect as a URL fragment:

```
/api/auth/oidc/callback?code=…&state=…#minister_anon=v1.<43 base64url chars>
```

Fragments are never sent to any server and survive the server-side 303s
(`callback` → `/signup/identity`), so the secret arrives only in the browser
on the final landing page. FreedInk then (all client-side, via
`@ministryofmany/identity`):

1. `src/hooks.client.ts` calls `captureMinisterAppSecret()` as the first
   client-side code of the document load — before Sentry and before any
   router navigation — which reads the fragment and immediately scrubs it
   from the URL/history (`$lib/client/minister-anon`).
2. On `/signup/identity`, creating the identity calls
   `ministerIdentitySeed(mixSecret)`: HKDF-SHA-256 mixing
   `MINISTER_ANON_RP_MIX_SECRET` (served to that page by its server load)
   into the per-app secret, yielding a 32-byte seed.
3. The seed becomes the Semaphore identity secret via the existing
   `generateIdentity(password, seed)` path (same `Identity.import` route as
   mnemonic restore). Vault encryption, the recovery phrase, sessionStorage
   caching, and every downstream proof flow are unchanged.

Result: the identity is **deterministic** — signing in with Minister on a new
device re-derives the same seed, so the same commitment can be restored. The
per-app secret and the derived seed never reach the FreedInk server; it keeps
seeing exactly what it sees today (an encrypted vault blob + commitment).

Degradation is fail-open for login, fail-closed for the anonymous identity —
in every one of these cases sign-in completes and identity creation falls
back to today's random generation, byte-identical behavior:

- no fragment (client not anon-enabled, user declined or couldn't unlock);
- malformed / unknown-version fragment;
- `MINISTER_ANON_RP_MIX_SECRET` unset, malformed, or < 32 bytes.

### Operational invariants

- **`MINISTER_ANON_RP_MIX_SECRET` is identity-determining** (anon spec
  invariant I9). Provision `>= 32` CSPRNG bytes (base64url) once, back it up
  with database-grade durability before enabling the flow, and never rotate
  or regenerate it — a changed value silently forks every derived identity
  and no error fires anywhere. See `.env.example` for the provisioning
  command and warning text.
- **No client-side redirect may be added anywhere in the callback chain**
  (`/api/auth/oidc/callback` → landing page). The fragment only survives
  server-side 3xx redirects whose `Location` carries no fragment of its own;
  a `location.assign`, meta refresh, or `goto()` on that path silently
  destroys it (spec §8.4 / finding S3). Loss is fail-closed, but it means no
  user ever receives an anonymous identity.
- The callback/landing routes must not load third-party JS ahead of the
  scrub in `hooks.client.ts` (finding S4).
