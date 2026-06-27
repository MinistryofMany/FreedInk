import type { Identity } from '@semaphore-protocol/identity';
import { hashToField } from '$lib/utils';
import snarkLock from '../../../snark-artifacts.lock.json';

// The Semaphore prover bundle (snarkjs + group + proof) is ~250–300 KB
// gzipped. We don't want it in the initial chunk of any route — most users
// of the public post page will never actually generate a proof. Defer the
// heavy imports to first proof-gen call; afterwards the chunk is cached by
// the browser for the rest of the session.
type GroupCtor = typeof import('@semaphore-protocol/group').Group;
type GenerateProof = typeof import('@semaphore-protocol/proof').generateProof;

let proverLoad: Promise<{ Group: GroupCtor; generateProof: GenerateProof }> | null = null;

function loadProver() {
	proverLoad ??= (async () => {
		const [{ Group }, { generateProof }] = await Promise.all([
			import('@semaphore-protocol/group'),
			import('@semaphore-protocol/proof')
		]);
		return { Group, generateProof };
	})();
	return proverLoad;
}

// Optional hook for "this user is likely to prove soon" UI moments
// (focus into the post-body textarea, hover the Approve button, etc.) so
// the chunk download overlaps with the user's typing instead of blocking
// the click.
export function prewarmProver(): Promise<void> {
	return loadProver().then(() => undefined);
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
// check we fail loudly instead. (The build-time fetch script still uses the
// CDN; that path is hash-pinned by the lockfile and runs offline of users.)
const LOCAL_BASE = '/snark-artifacts/semaphore';

function localArtifactUrls(depth: number) {
	return {
		wasm: `${LOCAL_BASE}/${depth}/semaphore-${depth}.wasm`,
		zkey: `${LOCAL_BASE}/${depth}/semaphore-${depth}.zkey`
	};
}

// Pinned SHA-256 digests, keyed by depth, from snark-artifacts.lock.json - the
// same lockfile `scripts/fetch-snark-artifacts.ts` writes. Verifying fetched
// bytes against these before handing them to the prover stops a tampered or
// drifted artifact (compromised origin, stale cache, MITM) from silently
// producing proofs against a different circuit than verifiers expect.
type LockArtifact = { sha256: string };
type LockEntry = { wasm: LockArtifact; zkey: LockArtifact };
const PINNED_HASHES = snarkLock.artifacts as Record<string, LockEntry>;

// Bytes paired with their source URL, ready to feed the prover. snarkjs'
// fastfile reader accepts a Uint8Array directly (wrapped as an in-memory
// file), so we pass verified bytes rather than a URL the prover would re-fetch
// unchecked.
type VerifiedArtifacts = { wasm: Uint8Array; zkey: Uint8Array };

function toHex(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let hex = '';
	for (const b of bytes) hex += b.toString(16).padStart(2, '0');
	return hex;
}

async function fetchAndVerify(url: string, expectedSha256: string): Promise<Uint8Array> {
	const res = await fetch(url, { cache: 'force-cache' });
	if (!res.ok) {
		throw new Error(`[semaphore] failed to fetch artifact ${url}: ${res.status} ${res.statusText}`);
	}
	// Keep one Uint8Array view over the body and digest the *view* (a TypedArray
	// is accepted by SubtleCrypto.digest everywhere; passing a bare ArrayBuffer
	// can trip cross-realm checks). The same view is returned to the prover.
	const bytes = new Uint8Array(await res.arrayBuffer());
	const digest = toHex(await crypto.subtle.digest('SHA-256', bytes));
	if (digest !== expectedSha256) {
		// Refuse to prove against bytes we can't pin. Don't fall back to a
		// live CDN - that would just move the unverified-bytes problem.
		throw new Error(
			`[semaphore] artifact integrity check failed for ${url}: ` +
				`expected sha256 ${expectedSha256}, got ${digest}`
		);
	}
	return bytes;
}

async function loadArtifacts(depth: number): Promise<VerifiedArtifacts> {
	const pinned = PINNED_HASHES[String(depth)];
	if (!pinned) {
		throw new Error(
			`[semaphore] no pinned hashes for depth ${depth} in snark-artifacts.lock.json - ` +
				`run \`npm run snark:fetch\` to vendor and pin this depth.`
		);
	}
	const urls = localArtifactUrls(depth);
	const [wasm, zkey] = await Promise.all([
		fetchAndVerify(urls.wasm, pinned.wasm.sha256),
		fetchAndVerify(urls.zkey, pinned.zkey.sha256)
	]);
	return { wasm, zkey };
}

// Build a Semaphore proof against the snapshot identities the server gave us.
// `scope` and `message` are hashed into the BN254 field so the values we sign
// always fit. The server re-derives the same hashes when verifying.
export async function buildProof(opts: {
	identity: Identity;
	identities: string[];
	scope: string;
	message: string;
}): Promise<ProofPayload> {
	const { Group, generateProof } = await loadProver();
	const group = new Group();
	// IMPORTANT: do NOT re-sort here. The server returns identities in
	// canonical order (sorted by user creation date, see
	// `src/lib/db/snapshots.ts`). Re-sorting client-side would produce a
	// different Merkle root than the one the server stored, and the proof
	// would be rejected with "proof references unknown membership snapshot".
	for (const idc of opts.identities) group.addMember(BigInt(idc));
	const scopeField = await hashToField(opts.scope);
	const messageField = await hashToField(opts.message);

	// Semaphore would default to merkleProof.siblings.length when undefined; we
	// resolve it eagerly so we can pick the matching set of artifacts.
	const leafIndex = group.indexOf(opts.identity.commitment);
	const merkleProof = group.generateMerkleProof(leafIndex);
	const depth = merkleProof.siblings.length || 1;
	const artifacts = await loadArtifacts(depth);

	const proof = await generateProof(
		opts.identity,
		merkleProof,
		messageField,
		scopeField,
		depth,
		// @zk-kit/artifacts types SnarkArtifacts as Record<'wasm'|'zkey', string>
		// (URLs only), but the underlying snarkjs fastfile reader also accepts a
		// Uint8Array (treated as an in-memory file). We pass integrity-verified
		// bytes, so this cast reflects the real runtime contract.
		artifacts as unknown as { wasm: string; zkey: string }
	);
	return {
		merkleTreeDepth: Number(proof.merkleTreeDepth),
		merkleTreeRoot: proof.merkleTreeRoot.toString(),
		nullifier: proof.nullifier.toString(),
		message: proof.message.toString(),
		scope: proof.scope.toString(),
		points: proof.points.map((p) => p.toString())
	};
}

// The capability tree to fetch. Mirrors the server's TreeCapability:
//   'author'  — writers tree (submit post, edit/revise)
//   'comment' — commenters tree
// Votes use blind tokens, not a tree (see $lib/client/vote-token).
export type GroupCapability = 'author' | 'comment';

// Fetch the current identity set + root for ONE capability tree of a blog. The
// caller MUST request the tree matching the action it is about to prove (author
// for post/edit, comment for comments, review for votes) — proving against the
// wrong tree fails server-side verification (design R1).
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
