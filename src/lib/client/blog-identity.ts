import type { Identity } from '@semaphore-protocol/identity';
import { getStoredBranch } from './minister-anon';

// Per-blog Semaphore identity, derived client-side from the Ministry branch.
//
// The heavy derivation lives behind a lazy import: `@ministryofmany/identity`'s
// root entry pulls in `@semaphore-protocol/identity` (the commitment math), which
// we keep out of SSR and the initial chunk — only pages that actually prove need
// it. The branch itself never leaves the browser; only the resulting commitment
// (a public value) is sent to the server to enroll into the blog's Merkle tree.

// Derive the caller's Semaphore identity for one blog from the cached Ministry
// branch. Returns null when no branch is cached (the user must sign in with
// Minister to connect their private identity — never fabricate a secret).
export async function deriveBlogIdentity(blogId: string): Promise<Identity | null> {
	const branch = getStoredBranch();
	if (!branch) return null;
	const { deriveIdentity } = await import('@ministryofmany/identity');
	const derived = await deriveIdentity(branch, { kind: 'blog', id: blogId });
	return derived.identity;
}

// Derive the per-blog identity AND ensure its commitment is enrolled in the
// blog's membership trees server-side, then return it ready to prove with.
//
// Enrollment is idempotent (re-enrolling the same commitment is a no-op) and the
// replacement of a DIFFERENT commitment is gated server-side on the signed
// Ministry epoch strictly advancing (C1) — the client never supplies its old
// commitment; the server resolves the row from the authenticated session.
//
// Returns null when no branch is cached; throws with the server's message on an
// enrollment failure (e.g. not a member, or a stale-epoch replacement).
export async function getEnrolledBlogIdentity(
	blogId: string,
	blogSlug: string
): Promise<Identity | null> {
	const identity = await deriveBlogIdentity(blogId);
	if (!identity) return null;
	const res = await fetch('/api/identity/enroll', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ blog_slug: blogSlug, idc: identity.commitment.toString() })
	});
	if (!res.ok) throw new Error((await res.text()) || 'could not enroll your identity for this blog');
	return identity;
}
