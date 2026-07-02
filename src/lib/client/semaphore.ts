import type { Identity } from '@semaphore-protocol/identity';
import type { ProveContext, ArtifactSource } from '@ministryofmany/membership/client';
import snarkLock from '../../../snark-artifacts.lock.json';

// Client-side Semaphore membership proving. The prover engine (group build,
// merkle proof, hashToField, generateProof) now lives in
// @ministryofmany/membership; this module keeps FreedInk's lazy-load discipline,
// its vendored + SHA-256-pinned artifact source, the network I/O (fetchGroup),
// and the UI prewarm hooks.
//
// The Semaphore prover bundle (snarkjs + group + proof) is ~250–300 KB gzipped.
// We don't want it in the initial chunk of any route — most users of the public
// post page never generate a proof. The membership client (and, inside it,
// @semaphore-protocol/proof) is therefore lazy-imported on first proof-gen call;
// afterwards the chunk is cached for the rest of the session.

// The type of the snapshot / identity the membership engine consumes, derived
// from the client ProveContext so we don't import the identity package directly.
type MembershipSnapshot = ProveContext['snapshot'];
type SemaphoreIdentityLike = ProveContext['identity'];

type MembershipClient = typeof import('@ministryofmany/membership/client');

let membershipLoad: Promise<{
	generateMembershipProof: MembershipClient['generateMembershipProof'];
	artifacts: ArtifactSource;
}> | null = null;

function loadMembership() {
	membershipLoad ??= (async () => {
		const { generateMembershipProof, hashPinnedArtifactSource } = await import(
			'@ministryofmany/membership/client'
		);
		// FreedInk's vendored + hash-pinned artifact source: same-origin fetch,
		// SHA-256-verify against the lockfile, NEVER fall back to a live CDN. The
		// package's default urlFor reproduces FreedInk's
		// `<base>/<depth>/semaphore-<depth>.{wasm,zkey}` layout, so LOCAL_BASE is all
		// it needs. fetchImpl reads the LIVE globalThis.fetch each call so a test can
		// override it after this module is imported.
		const artifacts = hashPinnedArtifactSource({
			baseUrl: LOCAL_BASE,
			pins: PINNED_HASHES,
			fetchImpl: (input, init) => globalThis.fetch(input, init)
		});
		return { generateMembershipProof, artifacts };
	})();
	return membershipLoad;
}

// Optional hook for "this user is likely to prove soon" UI moments (focus into
// the post-body textarea, hover the Approve button, etc.) so the chunk download
// overlaps with the user's typing instead of blocking the click. Warms the
// membership client AND the heavy snarkjs prover.
export function prewarmProver(): Promise<void> {
	return Promise.all([loadMembership(), import('@semaphore-protocol/proof')]).then(() => undefined);
}

// Default depths to warm for an authenticated user: covers a single-owner blog
// (depth 1) up through a blog with 16 proving members (depth 4). Picking 4
// rather than 1 means a first comment in a 5-member blog doesn't have to wait
// for a fresh zkey download.
const DEFAULT_PREWARM_DEPTHS = [1, 4];

// Warm the HTTP cache with snark artifacts so the first real proof doesn't
// pay for the wasm+zkey download. Uses `cache: 'force-cache'` + `priority: low`
// so the prefetch is happy to wait behind real network traffic; if local
// artifacts are missing for a depth we silently skip (CDN will serve later).
export async function prewarmArtifacts(depths: number[] = DEFAULT_PREWARM_DEPTHS): Promise<void> {
	if (typeof window === 'undefined' || typeof fetch !== 'function') return;
	const init: RequestInit & { priority?: 'low' | 'high' | 'auto' } = {
		cache: 'force-cache',
		priority: 'low'
	};
	await Promise.allSettled(
		depths.flatMap((d) => {
			const { wasm, zkey } = localArtifactUrls(d);
			return [fetch(wasm, init).catch(() => null), fetch(zkey, init).catch(() => null)];
		})
	);
}

// Convenience: kick off both the prover JS chunk download and the snark
// artifact prefetch on idle-time. Safe to call repeatedly — both inner calls
// memoize.
export function prewarmForAuthedUser(opts: { depths?: number[] } = {}): void {
	if (typeof window === 'undefined') return;
	const run = () => {
		void prewarmProver();
		void prewarmArtifacts(opts.depths);
	};
	const w = window as Window & {
		requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
	};
	if (typeof w.requestIdleCallback === 'function') {
		w.requestIdleCallback(run, { timeout: 4000 });
	} else {
		setTimeout(run, 1500);
	}
}

export type ProofPayload = {
	merkleTreeDepth: number;
	merkleTreeRoot: string;
	nullifier: string;
	message: string;
	scope: string;
	points: string[];
};

// We vendor a copy of every depth-N artifact at
// /snark-artifacts/semaphore/<N>/semaphore-<N>.* (fetched via
// `npm run snark:fetch`, served by adapter-node from `static/`). Same-origin
// keeps proof generation off the network and within `connect-src 'self'`.
//
// There is no live-CDN fallback at proof time: a silent fall-through to
// snark-artifacts.pse.dev would mean generating a proof against artifacts we
// never integrity-checked. If local artifacts are absent or fail their hash
// check the pinned artifact source fails loudly instead. (The build-time fetch
// script still uses the CDN; that path is hash-pinned by the lockfile and runs
// offline of users.)
const LOCAL_BASE = '/snark-artifacts/semaphore';

function localArtifactUrls(depth: number) {
	return {
		wasm: `${LOCAL_BASE}/${depth}/semaphore-${depth}.wasm`,
		zkey: `${LOCAL_BASE}/${depth}/semaphore-${depth}.zkey`
	};
}

// Pinned SHA-256 digests, keyed by depth, from snark-artifacts.lock.json — the
// same lockfile `scripts/fetch-snark-artifacts.ts` writes. The package's
// hashPinnedArtifactSource verifies fetched bytes against these before handing
// them to the prover, stopping a tampered or drifted artifact (compromised
// origin, stale cache, MITM) from silently producing proofs against a different
// circuit than verifiers expect.
type LockArtifact = { sha256: string };
type LockEntry = { wasm: LockArtifact; zkey: LockArtifact };
const PINNED_HASHES = snarkLock.artifacts as Record<string, LockEntry>;

// Build a Semaphore proof against the snapshot identities the server gave us.
// `scope` and `message` are hashed into the BN254 field (by the engine) so the
// values we sign always fit; the server re-derives the same hashes when verifying.
export async function buildProof(opts: {
	identity: Identity;
	identities: string[];
	scope: string;
	message: string;
}): Promise<ProofPayload> {
	const { generateMembershipProof, artifacts } = await loadMembership();

	// The snapshot the proof binds to. The server returns identities in canonical
	// order (see src/lib/db/snapshots.ts); the engine rebuilds the group from these
	// leaves WITHOUT re-sorting so the Merkle root matches the stored snapshot. The
	// engine derives the root itself from the proof, so `root`/`ref` here are
	// unused by prove — only `leaves` are load-bearing.
	const snapshot: MembershipSnapshot = {
		ref: { context: '', subTree: '' },
		root: '',
		leaves: opts.identities,
		eligibleCount: opts.identities.length,
		shape: { kind: 'dynamic' },
		engine: 'semaphore'
	};

	// Wrap FreedInk's v4 Identity in the structural SemaphoreIdentityLike the engine
	// consumes (it narrows `native` back to a v4 Identity via asV4Identity).
	const identity: SemaphoreIdentityLike = {
		commitment: opts.identity.commitment.toString(),
		native: opts.identity
	};

	const proof = await generateMembershipProof({
		identity,
		snapshot,
		scope: opts.scope,
		message: opts.message,
		artifacts
	});
	if (proof.kind !== 'semaphore') {
		throw new Error(`unexpected membership proof kind: ${proof.kind}`);
	}
	return {
		merkleTreeDepth: proof.merkleTreeDepth,
		merkleTreeRoot: proof.merkleTreeRoot,
		nullifier: proof.nullifier,
		message: proof.message,
		scope: proof.scope,
		points: proof.points
	};
}

// The capability tree to fetch. Mirrors the server's TreeCapability:
//   'author'  — writers tree (submit post, edit/revise)
//   'comment' — commenters tree
// Votes use blind tokens, not a tree (see $lib/client/vote-token).
export type GroupCapability = 'author' | 'comment';

// Fetch the current identity set + root for ONE capability tree of a blog. The
// caller MUST request the tree matching the action it is about to prove (author
// for post/edit, comment for comments) — proving against the wrong tree fails
// server-side verification (design R1).
export async function fetchGroup(
	blogSlug: string,
	capability: GroupCapability
): Promise<{
	root: string;
	identities: string[];
	eligible_count: number;
}> {
	const res = await fetch('/api/blog/group', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ blog_slug: blogSlug, capability })
	});
	if (!res.ok) throw new Error(await res.text());
	return res.json();
}
