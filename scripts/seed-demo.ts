// Seed a realistic demo state for screenshots:
//   alice (owner) + bob (reviewer) + carol (reviewer) on "Anonymous Thoughts"
//   3 published posts, 1 post under review with bob already approved, comments,
//   tags.
//
// Uses raw postgres.js + the Semaphore libraries directly so the script can run
// outside SvelteKit's module-resolution context.
import postgres from 'postgres';
import { readFileSync, existsSync } from 'node:fs';
import { Identity } from '@semaphore-protocol/identity';
import { Group } from '@semaphore-protocol/group';
import { generateProof } from '@semaphore-protocol/proof';
import { randomUUID } from 'node:crypto';

if (existsSync('.env')) {
	for (const raw of readFileSync('.env', 'utf8').split('\n')) {
		const line = raw.replace(/\r$/, '');
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
		if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
	}
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');

const sql = postgres(url, { max: 1, prepare: false });

// BN254 scalar field prime — mirror of src/lib/utils.ts:hashToField.
const BN254 = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
async function hashToField(message: string): Promise<bigint> {
	const data = new TextEncoder().encode(message);
	const buf = await crypto.subtle.digest('SHA-256', data);
	const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
	return BigInt('0x' + hex) % BN254;
}

function sluggify(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

function nowMinus(days: number, hours: number = 0): Date {
	return new Date(Date.now() - days * 86_400_000 - hours * 3_600_000);
}

// ───────── wipe + reseed in a single transaction ─────────
console.log('wiping demo state…');
await sql`TRUNCATE TABLE blog_post_tags, post_comments, post_reviews, blog_post_versions, blog_posts,
  post_submission_nonces, blog_member_snapshots, blog_invitations, blog_members, blogs, tags,
  audit_log, rate_limits, account_recoveries, user_identities, sessions, siwe_nonces,
  webauthn_challenges, email_verifications, passkey_credentials, wallet_addresses, users
  RESTART IDENTITY CASCADE`;

async function makeUser(email: string, username: string, seed: string) {
	const id = randomUUID();
	const verifiedAt = new Date();
	await sql`INSERT INTO users (id, username, email, email_verified_at)
	  VALUES (${id}, ${username}, ${email}, ${verifiedAt})`;
	const identity = new Identity(seed);
	const params = JSON.stringify({ name: 'PBKDF2', iterations: 100_000, hash: 'SHA-256' });
	await sql`INSERT INTO user_identities (user_id, idc, public_key, ciphertext, kdf_salt, kdf_params, nonce, status)
	  VALUES (${id}, ${identity.commitment.toString()}, ${identity.publicKey.toString()},
	    ${Buffer.from([0])}, ${Buffer.alloc(16)}, ${params}, ${Buffer.alloc(12)}, 'active')`;
	return { id, username, email, identity };
}

console.log('creating users…');
const alice = await makeUser('alice@example.com', 'alice', 'alice-demo-seed');
const bob = await makeUser('bob@example.com', 'bob', 'bob-demo-seed');
const carol = await makeUser('carol@example.com', 'carol', 'carol-demo-seed');

console.log('creating blog "Anonymous Thoughts"…');
const blogId = randomUUID();
const blogSlug = 'anonymous-thoughts';
await sql`INSERT INTO blogs (id, slug, title, description)
  VALUES (${blogId}, ${blogSlug}, ${'Anonymous Thoughts'},
    ${'A blog about ideas worth saying without consequences. Members publish anonymously via zero-knowledge proofs.'})`;

await sql`INSERT INTO blog_members (blog_id, user_id, role, added_by)
  VALUES (${blogId}, ${alice.id}, 'owner', ${alice.id})`;
await sql`INSERT INTO blog_members (blog_id, user_id, role, added_by)
  VALUES (${blogId}, ${bob.id}, 'reviewer', ${alice.id})`;
await sql`INSERT INTO blog_members (blog_id, user_id, role, added_by)
  VALUES (${blogId}, ${carol.id}, 'reviewer', ${alice.id})`;

// Get actual creation order from DB so the ordering matches what the app would compute.
const orderedUsers = await sql<{ user_id: string; created_at: Date; idc: string }[]>`
  SELECT u.id AS user_id, u.created_at, ui.idc
  FROM users u
  JOIN user_identities ui ON ui.user_id = u.id AND ui.status='active'
  JOIN blog_members bm ON bm.user_id = u.id AND bm.removed_at IS NULL AND bm.role IN ('owner','editor','reviewer','author')
  WHERE bm.blog_id = ${blogId}
  ORDER BY u.created_at ASC, u.id ASC
`;
const snapIdcs = orderedUsers.map((r) => r.idc);
const group = new Group();
for (const idc of snapIdcs) group.addMember(BigInt(idc));
const snapRoot = group.root.toString();
await sql`INSERT INTO blog_member_snapshots (blog_id, root, identities, eligible_count)
  VALUES (${blogId}, ${snapRoot}, ${snapIdcs}, ${snapIdcs.length})`;

async function publishPost(opts: {
	title: string;
	content: string;
	publishedAgoDays: number;
	tags?: string[];
}) {
	const postId = randomUUID();
	const versionId = randomUUID();
	const slug = sluggify(opts.title);
	const submittedAt = nowMinus(opts.publishedAgoDays, 6);
	const publishedAt = nowMinus(opts.publishedAgoDays);
	const createdAt = nowMinus(opts.publishedAgoDays, 8);
	await sql`INSERT INTO blog_posts (id, blog_id, status, current_version_id, created_at)
	  VALUES (${postId}, ${blogId}, 'published', ${versionId}, ${createdAt})`;
	await sql`INSERT INTO blog_post_versions
	  (id, post_id, version, title, content, slug, proof, snapshot_root, nullifier,
	   status, submitted_at, published_at, created_at)
	  VALUES (${versionId}, ${postId}, 1, ${opts.title}, ${opts.content}, ${slug},
	    ${sql.json({ stub: true })}, ${snapRoot}, ${'n-' + randomUUID()},
	    'published', ${submittedAt}, ${publishedAt}, ${createdAt})`;
	for (const name of opts.tags ?? []) {
		const tagSlug = sluggify(name);
		const existing = await sql<{ id: string }[]>`SELECT id FROM tags WHERE slug=${tagSlug}`;
		let tagId = existing[0]?.id;
		if (!tagId) {
			tagId = randomUUID();
			await sql`INSERT INTO tags (id, name, slug) VALUES (${tagId}, ${name}, ${tagSlug})`;
		}
		await sql`INSERT INTO blog_post_tags (post_id, tag_id) VALUES (${postId}, ${tagId})
		  ON CONFLICT DO NOTHING`;
	}
	return { postId, versionId, slug };
}

async function addComment(versionId: string, body: string, agoHours: number) {
	await sql`INSERT INTO post_comments
	  (post_version_id, body, proof, snapshot_root, nullifier, created_at)
	  VALUES (${versionId}, ${body}, ${sql.json({ stub: true })}, ${snapRoot},
	    ${'cn-' + randomUUID()}, ${nowMinus(0, agoHours)})`;
}

console.log('publishing posts…');
const p1 = await publishPost({
	title: 'On the Right to Speak Without a Name',
	content: `Every interesting opinion has a cost.

The cost might be your job, your friendships, the next ten years of being a meme. Often the cost is small but uncertain — which is enough to make most people stop talking.

What we lose is a class of true things that nobody can afford to say. The market for unflattering true statements is broken not because the supply is low, but because the price of speaking is high and the buyer can't compensate the seller.

Anonymous, verifiable speech doesn't fix this on its own. But it changes the cost structure enough that the supply might recover.`,
	publishedAgoDays: 12,
	tags: ['anonymity', 'free-speech']
});

const p2 = await publishPost({
	title: 'Semaphore in Plain Language',
	content: `A Semaphore proof says: I am one of these N people, and here is a thing I want to assert, but I will not tell you which of the N I am.

That's it. Everything else is plumbing.

The plumbing matters: the group is a Merkle tree of identity commitments, the proof is a Groth16 SNARK over a Circom circuit, the nullifier prevents the same person from voting twice. But the user-facing story is the first sentence.

If you're building something where "this voice carries weight because it belongs to a member of this group" is the whole product, Semaphore is the simplest tool that does it correctly.`,
	publishedAgoDays: 7,
	tags: ['cryptography', 'semaphore']
});

const p3 = await publishPost({
	title: 'What Identity Rotation Actually Costs You',
	content: `Forget your vault password? Rotate your identity. Lose a device you trust? Rotate. Suspect leakage? Rotate.

The rotation itself is cheap. The cost is what you give up: every assertion you ever published under the old identity stays attached to it. Your old votes, your old comments, your old posts — verifiable forever against an identity that's revoked and never again provable by you.

This is a feature, not a bug. It means your past speech is permanent, and your future speech is fresh. It also means rotation isn't a panacea: if you said something incriminating last year and someone correlates it to you out-of-band, rotating today doesn't help.

Rotate often. Speak carefully. The cryptography only does what it does.`,
	publishedAgoDays: 2,
	tags: ['identity', 'semaphore']
});

console.log('adding comments…');
await addComment(
	p1.versionId,
	'This is exactly the framing I needed for a conversation I was avoiding.',
	240
);
await addComment(p1.versionId, 'The "supply has recovered" line is going to stay with me.', 18);
await addComment(p2.versionId, 'Best three-paragraph intro to Semaphore I have read.', 96);
await addComment(
	p2.versionId,
	'Worth contrasting with ring signatures for readers who came from Monero.',
	4
);
await addComment(p3.versionId, 'Brutal final line.', 1);

console.log('seeding under-review post with REAL proofs…');
async function buildRealProof(identity: Identity, scope: string, message: string) {
	const g = new Group();
	for (const idc of snapIdcs) g.addMember(BigInt(idc));
	const leafIndex = g.indexOf(identity.commitment);
	const merkleProof = g.generateMerkleProof(leafIndex);
	const depth = merkleProof.siblings.length || 1;
	const scopeField = await hashToField(scope);
	const messageField = await hashToField(message);
	const dir = `${process.cwd()}/static/snark-artifacts/semaphore/${depth}`;
	const artifacts = {
		wasm: `${dir}/semaphore-${depth}.wasm`,
		zkey: `${dir}/semaphore-${depth}.zkey`
	};
	return generateProof(identity, merkleProof, messageField, scopeField, depth, artifacts);
}

const draftTitle = 'When Voting Anonymously Still Tells You Something';
const draftBody = `Anonymous voting hides who voted, not how the room thinks. If 38 of 40 reviewers approve, that's a strong signal even though you can't name a single one.

The interesting cases are the 3-to-2 splits in 5-person groups. The fact that it was close means something. The identities of the splitters are the irrelevant part.

We sometimes mistake the privacy property for an information-theoretic shield over the whole vote. It isn't. It's a shield over the individuals. The tallies are still tallies.`;

const draftPostId = randomUUID();
const draftVersionId = randomUUID();
const submitProof = await buildRealProof(
	alice.identity,
	`post:${blogId}`,
	`${draftTitle}\n\n${draftBody}`
);
await sql`INSERT INTO blog_posts (id, blog_id, status, current_version_id, created_at)
  VALUES (${draftPostId}, ${blogId}, 'under_review', ${draftVersionId}, ${nowMinus(0, 4)})`;
await sql`INSERT INTO blog_post_versions
  (id, post_id, version, title, content, slug, proof, snapshot_root, nullifier,
   status, submitted_at, created_at)
  VALUES (${draftVersionId}, ${draftPostId}, 1, ${draftTitle}, ${draftBody},
    'when-voting-anonymously-still-tells-you-something',
    ${sql.json(submitProof)}, ${submitProof.merkleTreeRoot.toString()}, ${submitProof.nullifier.toString()},
    'under_review', ${nowMinus(0, 4)}, ${nowMinus(0, 4)})`;

const bobApprove = await buildRealProof(bob.identity, `review:${draftVersionId}`, 'approve');
await sql`INSERT INTO post_reviews
  (post_version_id, vote, proof, snapshot_root, nullifier, comment, created_at)
  VALUES (${draftVersionId}, 'approve', ${sql.json(bobApprove)},
    ${bobApprove.merkleTreeRoot.toString()}, ${bobApprove.nullifier.toString()},
    'Strong reframing. Approve.', ${nowMinus(0, 1)})`;

console.log('\n✓ demo data seeded');
console.log(`  blog: /b/${blogSlug}`);
console.log(`  alice (owner)    user_id=${alice.id}`);
console.log(`  bob (reviewer)   user_id=${bob.id}`);
console.log(`  carol (reviewer) user_id=${carol.id}`);
console.log(`  under-review post: ${draftVersionId} (1/2 approvals — carol could push to publish)`);

await sql.end();
process.exit(0);
