// Test factories: tiny helpers to build a graph of users/identities/blogs/
// members and produce real Semaphore proofs against the current snapshot.
import { existsSync } from 'node:fs';
import { db, schema } from '$lib/db/client';
import { Identity } from '@semaphore-protocol/identity';
import { Group } from '@semaphore-protocol/group';
import { generateProof } from '@semaphore-protocol/proof';
import { createUserWithEmail } from '$lib/db/users';
import { createBlog } from '$lib/db/blogs';
import { setRole } from '$lib/db/members';
import { refreshSnapshot } from '$lib/db/snapshots';
import { hashToField } from '$lib/utils';
import type { MemberRole, TreeCapability } from '$lib/db/schema';

// Map a proof scope prefix to the capability tree it proves against. Mirrors the
// endpoints: post:/edit: → author (writers tree), comment: → comment. Votes use
// blind tokens (no tree), so there is no review case. Used as the default tree
// for buildTestProof.
function capabilityForScope(scope: string): TreeCapability {
	if (scope.startsWith('comment:')) return 'comment';
	return 'author'; // post:<blog> and edit:<post>:<v>
}

export type TestUser = {
	id: string;
	username: string;
	// The user's BASE identity (seed). Under the one-root model the commitment
	// actually enrolled in a blog is per-(user, blog) — see perBlogIdentity — so
	// this base is never enrolled directly; it is the deterministic seed the
	// per-blog identity (and the matching proof) derive from.
	identity: Identity;
};

// The deterministic per-blog Semaphore identity for a user, mirroring the app's
// per-blog derivation. Enrollment (installIdentity) and proving (buildTestProof)
// both go through this, so a user's proof always uses the commitment enrolled for
// that blog, and two blogs get two distinct commitments (no global-idc collision).
export function perBlogIdentity(base: Identity, blogId: string): Identity {
	return new Identity(`${base.export()}:${blogId}`);
}

// Enroll a user's per-blog commitment into a blog (idc + epoch only — no vault).
export async function installIdentity(userId: string, blogId: string, base: Identity) {
	const identity = perBlogIdentity(base, blogId);
	await db.insert(schema.userIdentities).values({
		userId,
		blogId,
		idc: identity.commitment.toString(),
		anonEpoch: 1,
		status: 'active'
	});
	return identity;
}

export async function makeUser(
	opts: {
		email?: string;
		username?: string;
		seed?: string;
	} = {}
): Promise<TestUser> {
	const username = opts.username ?? `u${Math.random().toString(36).slice(2, 8)}`;
	const email = opts.email ?? `${username}@x.com`;
	const user = await createUserWithEmail(email, username);
	const identity = new Identity(opts.seed ?? username);
	return { id: user.id, username, identity };
}

export async function makeBlogWith(opts: {
	owner: TestUser;
	title?: string;
	members?: Array<{ user: TestUser; role: MemberRole }>;
}): Promise<{ id: string; slug: string }> {
	const title = opts.title ?? `blog ${Math.random().toString(36).slice(2, 8)}`;
	const blog = await createBlog(opts.owner.id, title, null);
	// The owner and every member enroll their per-blog commitment, so each holds a
	// leaf in the trees their capabilities place them in.
	await installIdentity(opts.owner.id, blog.id, opts.owner.identity);
	for (const m of opts.members ?? []) {
		await setRole(blog.id, m.user.id, m.role, opts.owner.id);
		await installIdentity(m.user.id, blog.id, m.user.identity);
	}
	return blog;
}

// In tests we prefer vendored artifacts over CDN downloads — same reasons as
// the client (faster, offline-friendly, version-pinned to the lock file).
function nodeArtifactsForDepth(depth: number): { wasm: string; zkey: string } | undefined {
	const dir = `${process.cwd()}/static/snark-artifacts/semaphore/${depth}`;
	const wasm = `${dir}/semaphore-${depth}.wasm`;
	const zkey = `${dir}/semaphore-${depth}.zkey`;
	return existsSync(wasm) && existsSync(zkey) ? { wasm, zkey } : undefined;
}

// Build a proof against the *current* snapshot for `blogId`. Mirrors the
// client/semaphore.ts buildProof so server expectations line up.
//
// `capability` selects which tree to prove against (author/comment/review). It
// is derived from the scope prefix when omitted: post:/edit: → author,
// comment: → comment, review: → review. Pass it explicitly for adversarial
// "prove against the wrong tree" tests.
export async function buildTestProof(opts: {
	blogId: string;
	identity: Identity;
	scope: string;
	message: string;
	capability?: TreeCapability;
}): Promise<{
	merkleTreeDepth: number;
	merkleTreeRoot: string;
	nullifier: string;
	message: string;
	scope: string;
	points: string[];
}> {
	const capability = opts.capability ?? capabilityForScope(opts.scope);
	const snap = await refreshSnapshot(opts.blogId, capability);
	const group = new Group();
	// Match the server's canonical order (user-creation-date) — refreshSnapshot
	// already returned them in that order. Do NOT re-sort here, or the Merkle
	// root won't match the stored snapshot.
	for (const idc of snap.identities) group.addMember(BigInt(idc));
	const scopeField = await hashToField(opts.scope);
	const messageField = await hashToField(opts.message);

	// Prove with the per-blog identity that was enrolled for this blog.
	const proveIdentity = perBlogIdentity(opts.identity, opts.blogId);
	const leafIndex = group.indexOf(proveIdentity.commitment);
	const merkleProof = group.generateMerkleProof(leafIndex);
	const depth = merkleProof.siblings.length || 1;
	const artifacts = nodeArtifactsForDepth(depth);

	const proof = await generateProof(
		proveIdentity,
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
