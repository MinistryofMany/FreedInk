# Privacy Policy

_Last updated: 2026-05-18_

> **NEEDS LEGAL REVIEW.** This page is written in plain English by the
> engineering team to describe how FreedInk handles data. It is not a substitute
> for advice from a lawyer in your jurisdiction. Sections marked _NEEDS LEGAL
> REVIEW_ contain placeholders or claims that should be reviewed by counsel
> before launch.

## TL;DR

FreedInk is an anonymous collaborative blogging platform. We collect only what
we need to run accounts and keep the service safe. Because posts and comments
are submitted with zero-knowledge proofs, **we cannot tell which member of a
blog wrote any particular post or comment** — that anonymity is enforced by
math, not by a promise.

## Who we are

FreedInk is operated at [freed.ink](https://freed.ink). For privacy
questions, write to **privacy@freed.ink**. _(NEEDS LEGAL REVIEW: confirm the
correct controller name and address before launch.)_

## What we collect

### Account data

When you create an account, we store:

- Your **username** (you pick it).
- Optionally, your **email address** (for transactional mail and account
  recovery). Email is required for password-style recovery; it is optional if
  you sign in only with a wallet.
- Optionally, **wallet addresses** you link via Sign-In-With-Ethereum (SIWE).
- A **created-at** timestamp and **last-seen** timestamp.
- The **IP address** and **user agent** on your active sessions, kept for
  abuse-prevention and so you can see "where am I signed in?" in settings.

### Authentication material

- **Passkey public keys** and credential metadata. We cannot impersonate you
  with these — public keys are useless without the matching private key, which
  never leaves your device.
- For account recovery, short-lived **email-verification tokens** and
  **recovery tokens**.

### Encrypted Semaphore identity blobs

To participate anonymously in a blog you generate a **Semaphore identity** in
your browser. The secret part of that identity is encrypted with a password
only you know, and the encrypted blob is stored on our server so you can
restore it on another device. **We cannot decrypt these blobs** — only your
password unlocks them.

We store the public **identity commitment** (`idc`) and **public key** of each
identity so we can build membership snapshots. These are public-by-design and
do not reveal which account owns them; many users can share an identity-set
without their individual accounts being linkable.

### Audit log

We record security-relevant events (sign-in, sign-out, passkey added, blog
membership change, identity rotation, GDPR export/deletion, etc.) for up to
**90 days**. Each entry stores the actor, subject, and the IP and user-agent
of the request, plus an event-specific metadata blob.

### Cookies

- `sid` — your **session cookie**. HTTP-only, `SameSite=Lax`, secure in
  production. Signed with HMAC-SHA-256. Default lifetime: **30 days**.
- Short-lived **nonce cookies / SIWE nonces** issued during sign-in flows and
  consumed within minutes.

We do not set advertising or analytics cookies.

## What we DO NOT collect

- **The link between you and your posts or comments.** Posts and comments
  carry a Semaphore proof that proves the author is _some_ member of the
  blog. The proof is unlinkable — we cannot tell which member it was, and
  neither can anyone else. We could not turn that information over even under
  a court order because we never had it.
- We do not sell data to third parties.
- We do not maintain advertising profiles.

## Third-party services

- **snark-artifacts.pse.dev** — a CDN that can serve Semaphore proving keys
  if our self-hosted copy is unreachable. Your IP would be visible to that CDN
  if it is hit; we prefer to serve artifacts ourselves.
- **SMTP provider** — for transactional email (verification, recovery, blog
  invitations). The provider sees the recipient's email address and the
  message body.
- **Sentry** — optional. If `PUBLIC_SENTRY_DSN` is set in our deployment, we
  send error reports (stack traces, anonymized request paths) to Sentry. The
  current production deployment **does not** ship a Sentry DSN by default;
  the absence of `PUBLIC_SENTRY_DSN` disables it entirely.

## Retention

| Data                                              | Kept for                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| Session rows (`sid` cookie target)                | 30 days, or until you sign out                                            |
| SIWE / email / nonce tokens                       | Minutes (single-use)                                                      |
| Audit log entries                                 | 90 days                                                                   |
| Account profile, identity blobs, blog memberships | Until you delete your account                                             |
| Anonymous posts and comments                      | Indefinitely (deleting your account does **not** remove them — see below) |

## Your rights

- **Access.** You can download a JSON export of everything we have linked to
  your account from `/settings` → "Data rights" → "Download my data" (or by
  POSTing to `/api/gdpr/export`).
- **Erasure.** You can permanently delete your account from `/settings` →
  "Data rights" → "Delete my account" (or by POSTing to `/api/gdpr/delete`
  with your username as confirmation). Cascades remove your sessions,
  passkeys, wallet links, identity blobs and blog memberships.
- **What deletion does not remove.** Posts and comments you authored are
  **anonymous via Semaphore**. There is no link in our database between them
  and your account. We deliberately do **not** delete them when you delete
  your account, because (a) we have no way to identify which ones were yours
  and (b) deleting them would break the verifiability of historical proofs
  for other readers.
- **Portability.** The export is machine-readable JSON.
- **Rectification.** Update your username, display name and email in
  `/settings`.
- **Withdraw consent / opt out.** Stop using the service or delete your
  account.

To exercise any of these rights, you can use the in-app controls or write to
**privacy@freed.ink**.

## Contact

- General: **hello@freed.ink** _(NEEDS LEGAL REVIEW)_
- Privacy: **privacy@freed.ink** _(NEEDS LEGAL REVIEW)_
- DMCA: see [/legal/dmca](/legal/dmca)

## Changes to this policy

We will update the "Last updated" date at the top of this page whenever this
policy changes. Substantive changes will be announced in the app.
