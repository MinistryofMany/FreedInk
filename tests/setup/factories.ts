// Test factories: tiny helpers to build a graph of users/identities/blogs/
// members and produce real Semaphore proofs against the current snapshot.
import { existsSync } from 'node:fs';
import { db, schema } from '$lib/db/client';
import { and, eq } from 'drizzle-orm';
import { Identity } from '@semaphore-protocol/identity';
import { Group } from '@semaphore-protocol/group';
import { generateProof } from '@semaphore-protocol/proof';
import { createUserWithEmail, createUserWithWallet } from '$lib/db/users';
import { createBlog } from '$lib/db/blogs';
import { setRole } from '$lib/db/members';
import { refreshSnapshot } from '$lib/db/snapshots';
import { hashToField } from '$lib/utils';
import type { MemberRole } from '$lib/db/schema';

export type TestUser = {
	id: string;
	username: string;
	identity: Identity;
};

async function installIdentity(userId: string, identity: Identity) {
	await db.insert(schema.userIdentities).values({
		userId,
		idc: identity.commitment.toString(),
		publicKey: identity.publicKey.toString(),
		ciphertext: new Uint8Array([0]),
		kdfSalt: new Uint8Array(16),
		nonce: new Uint8Array(12),
		kdfParams: { name: 'PBKDF2', iterations: 100_000, hash: 'SHA-256' },
		status: 'active'
	});
}

export async function makeUser(
	opts: {
		email?: string;
		username?: string;
		seed?: string;
		wallet?: string;
	} = {}
): Promise<TestUser> {
	const username = opts.username ?? `u${Math.random().toString(36).slice(2, 8)}`;
	const email = opts.email ?? `${username}@x.com`;
	const user = opts.wallet
		? await createUserWithWallet(opts.wallet, username)
		: await createUserWithEmail(email, username);
	const identity = new Identity(opts.seed ?? username);
	await installIdentity(user.id, identity);
	return { id: user.id, username, identity };
}

export async function rotateUserIdentity(userId: string, seed: string): Promise<Identity> {
	const identity = new Identity(seed);
	await db.transaction(async (tx) => {
		await tx
			.update(schema.userIdentities)
			.set({ status: 'revoked', revokedAt: new Date() })
			.where(
				and(eq(schema.userIdentities.userId, userId), eq(schema.userIdentities.status, 'active'))
			);
		await tx.insert(schema.userIdentities).values({
			userId,
			idc: identity.commitment.toString(),
			publicKey: identity.publicKey.toString(),
			ciphertext: new Uint8Array([0]),
			kdfSalt: new Uint8Array(16),
			nonce: new Uint8Array(12),
			kdfParams: { name: 'PBKDF2', iterations: 100_000, hash: 'SHA-256' },
			status: 'active'
		});
	});
	return identity;
}

export async function makeBlogWith(opts: {
	owner: TestUser;
	title?: string;
	members?: Array<{ user: TestUser; role: MemberRole }>;
}): Promise<{ id: string; slug: string }> {
	const title = opts.title ?? `blog ${Math.random().toString(36).slice(2, 8)}`;
	const blog = await createBlog(opts.owner.id, title, null);
	for (const m of opts.members ?? []) {
		await setRole(blog.id, m.user.id, m.role, opts.owner.id);
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
export async function buildTestProof(opts: {
	blogId: string;
	identity: Identity;
	scope: string;
	message: string;
}): Promise<{
	merkleTreeDepth: number;
	merkleTreeRoot: string;
	nullifier: string;
	message: string;
	scope: string;
	points: string[];
}> {
	const snap = await refreshSnapshot(opts.blogId);
	const group = new Group();
	// Match the server's canonical order (user-creation-date) — refreshSnapshot
	// already returned them in that order. Do NOT re-sort here, or the Merkle
	// root won't match the stored snapshot.
	for (const idc of snap.identities) group.addMember(BigInt(idc));
	const scopeField = await hashToField(opts.scope);
	const messageField = await hashToField(opts.message);

	const leafIndex = group.indexOf(opts.identity.commitment);
	const merkleProof = group.generateMerkleProof(leafIndex);
	const depth = merkleProof.siblings.length || 1;
	const artifacts = nodeArtifactsForDepth(depth);

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
