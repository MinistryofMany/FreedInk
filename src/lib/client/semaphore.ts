import type { Identity } from '@semaphore-protocol/identity';
import { hashToField } from '$lib/utils';

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

// snark-artifacts CDN — used only as a last-resort fallback. We vendor a copy
// of every depth-N artifact at /snark-artifacts/semaphore/<N>/semaphore-<N>.*
// (fetched via `npm run snark:fetch`, gitignored, served by adapter-node from
// `static/`). Same-origin keeps proof generation off the network.
const LOCAL_BASE = '/snark-artifacts/semaphore';
const CDN_BASE = 'https://snark-artifacts.pse.dev/semaphore/latest';

function localArtifactUrls(depth: number) {
	return {
		wasm: `${LOCAL_BASE}/${depth}/semaphore-${depth}.wasm`,
		zkey: `${LOCAL_BASE}/${depth}/semaphore-${depth}.zkey`
	};
}

function cdnArtifactUrls(depth: number) {
	return {
		wasm: `${CDN_BASE}/semaphore-${depth}.wasm`,
		zkey: `${CDN_BASE}/semaphore-${depth}.zkey`
	};
}

async function urlExists(url: string): Promise<boolean> {
	try {
		const res = await fetch(url, { method: 'HEAD' });
		return res.ok;
	} catch {
		return false;
	}
}

async function chooseArtifacts(depth: number): Promise<{ wasm: string; zkey: string }> {
	const local = localArtifactUrls(depth);
	// HEAD both files in parallel; if either is missing locally, fall back to
	// the CDN for both to keep them version-paired.
	const [hasWasm, hasZkey] = await Promise.all([urlExists(local.wasm), urlExists(local.zkey)]);
	if (hasWasm && hasZkey) return local;
	if (typeof console !== 'undefined' && typeof console.warn === 'function') {
		console.warn(
			`[semaphore] local artifacts for depth ${depth} not found, falling back to CDN — ` +
				`run \`npm run snark:fetch\` to vendor them.`
		);
	}
	return cdnArtifactUrls(depth);
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
	const artifacts = await chooseArtifacts(depth);

	const proof = await generateProof(
		opts.identity,
		merkleProof,
		messageField,
		scopeField,
		depth,
		artifacts
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

export async function fetchGroup(blogSlug: string): Promise<{
	root: string;
	identities: string[];
	eligible_count: number;
}> {
	const res = await fetch('/api/blog/group', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ blog_slug: blogSlug })
	});
	if (!res.ok) throw new Error(await res.text());
	return res.json();
}
