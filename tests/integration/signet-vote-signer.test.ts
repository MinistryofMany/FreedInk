// Signet-mode VoteSigner — end-to-end proof against a REAL running Signet.
//
// This suite is ENV-GATED: it only runs when the production SIGNET_URL (+ the
// mTLS cert env) are set IN THE SHELL BEFORE vitest starts. With them unset it is
// skipped, so the default test run (local mode) is unaffected.
//
// IMPORTANT — env must be set in the SHELL, not mutated at runtime:
// `$env/dynamic/private` is snapshotted at module-import time under vitest (NOT a
// live proxy over process.env), so the SIGNET_* vars must already be present when
// signet.ts is first imported. Export them on the vitest command line. The
// scripts/run-signet-test.sh helper wires this up (start Signet + export env +
// run this file).
//
//   SIGNET_URL=https://127.0.0.1:8443 \
//   SIGNET_CLIENT_CERT=../Signet/deploy/certs/client.pem \
//   SIGNET_CLIENT_KEY=../Signet/deploy/certs/client.key \
//   SIGNET_CA_CERT=../Signet/deploy/certs/ca.pem \
//   npx vitest run --project integration tests/integration/signet-vote-signer.test.ts
//
// What it proves (the deliverable's "SIGNET mode works end-to-end"):
//   - mTLS round-trips (a configured client cert reaches the signer);
//   - the abstraction SELECTS Signet from env (getVoteSigner().backend==='signet');
//   - async key pre-gen: ensureKey() enqueues, getPublicKey() polls to ready;
//   - the WIRE SCHEME IS UNCHANGED: a nonce blinded with @cloudflare/blindrsa-ts
//     under freedink-vote:<version>, blind-signed by Signet, finalized, and then
//     verified with FreedInk's own verifyVoteToken() under the Signet-served
//     public key — byte-for-byte the same scheme as local mode;
//   - cross-version binding: a token for v1 does NOT verify under v2;
//   - one-signature-per-(group,participant,version) is enforced at the signer;
//   - the raw nonce is never sent (only the blinded message is).

import { describe, it, expect, beforeAll } from 'vitest';
import { RSAPBSSA } from '@cloudflare/blindrsa-ts';
import { verifyToken } from '@ministryofmany/blind-token/server';
import { getVoteSigner, voteActionInfo } from '$lib/server/vote-signer';
import type { Signer } from '$lib/server/vote-signer';

// Gate on the SAME production env the runtime selection uses, so a configured
// SIGNET_URL both runs this suite AND drives getVoteSigner() to the Signet path.
const SIGNET_URL = process.env.SIGNET_URL;
const run = SIGNET_URL ? describe : describe.skip;

const suite = RSAPBSSA.SHA384.PSS.Randomized();
const info = (versionId: string) => new TextEncoder().encode(`freedink-vote:${versionId}`);

async function importPub(spki: Uint8Array): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'spki',
		spki as unknown as ArrayBuffer,
		{ name: 'RSA-PSS', hash: 'SHA-384' },
		true,
		['verify']
	);
}

// Poll getPublicKey until it's ready (async keygen). Bounded so a stuck signer
// fails the test instead of hanging. Polls every 5s: Signet rate-limits /key*
// (default 10 per identity per 60s), so an aggressive sub-second poll would burn
// the read budget and self-throttle. 5s keeps us within budget while keygen
// (~10-20s) completes.
const KEY_POLL_MS = 5000;
async function waitForKey(signer: Signer, blogId: string): Promise<Uint8Array> {
	for (let i = 0; i < 24; i++) {
		const pk = await signer.getPublicKey(blogId);
		if (pk.status === 'ready') return pk.publicKeySpki;
		await new Promise((r) => setTimeout(r, KEY_POLL_MS));
	}
	throw new Error('Signet key never became ready within ~120s');
}

run('RemoteSigner (live Signet, mTLS)', () => {
	let signer: Signer;

	beforeAll(() => {
		// The abstraction selects Signet purely from env (set in the shell before
		// import). This asserts the real selection path, not a hand-built signer.
		signer = getVoteSigner();
		expect(signer.backend).toBe('remote');
	});

	it('mints a token through Signet that verifies under the Signet-served key (wire scheme unchanged)', async () => {
		// Unique group so a re-run starts from a fresh key.
		const blogId = `e2e-blog-${Date.now()}`;
		const versionId = '11111111-1111-1111-1111-111111111111';
		const participantId = 'user-alice';

		// Pre-gen, then wait for the key (async keygen on a worker pool).
		await signer.ensureKey(blogId);
		const spki = await waitForKey(signer, blogId);
		const pub = await importPub(spki);

		// CLIENT: fresh nonce → prepare → blind under the version metadata. The raw
		// nonce stays here; only `blindedMsg` is ever sent to Signet.
		const nonce = crypto.getRandomValues(new Uint8Array(32));
		const prepared = suite.prepare(nonce);
		const { blindedMsg, inv } = await suite.blind(pub, prepared, info(versionId));

		// SIGNER (Signet, over mTLS): blind-sign the ALREADY-BLINDED message.
		let blindSig: Uint8Array | null = null;
		for (let i = 0; i < 30; i++) {
			const out = await signer.sign({
				group: blogId,
				participant: participantId,
				info: voteActionInfo(versionId),
				blindedMessage: blindedMsg
			});
			if (out.status === 'ok') {
				blindSig = out.blindSignature;
				break;
			}
			// pending (keygen) — wait and retry. rate_limited shouldn't happen on the
			// first sign for a participant, but back off if it does.
			await new Promise((r) => setTimeout(r, 3000));
		}
		expect(blindSig, 'Signet eventually returned a blind signature').not.toBeNull();

		// CLIENT: finalize to an unblinded signature. Node's WebCrypto has no large-
		// exponent bound, so the library's own finalize is fine here (the browser
		// uses the Chromium-safe finalize, which is byte-identical).
		const signature = await suite.finalize(pub, prepared, info(versionId), blindSig!, inv);

		// REDEMPTION verify path — FreedInk's own verifier, unchanged, under the
		// Signet-served public key. This is the byte-identical-token proof.
		const ok = await verifyToken({
			publicKeySpki: spki,
			signature,
			preparedNonce: prepared,
			info: voteActionInfo(versionId)
		});
		expect(ok).toBe(true);
	}, 180_000);

	it('enforces cross-version binding: a v1 token does not verify under v2', async () => {
		const blogId = `e2e-blog-xv-${Date.now()}`;
		const v1 = '22222222-2222-2222-2222-222222222222';
		const v2 = '33333333-3333-3333-3333-333333333333';

		await signer.ensureKey(blogId);
		const spki = await waitForKey(signer, blogId);
		const pub = await importPub(spki);

		const nonce = crypto.getRandomValues(new Uint8Array(32));
		const prepared = suite.prepare(nonce);
		const { blindedMsg, inv } = await suite.blind(pub, prepared, info(v1));

		let blindSig: Uint8Array | null = null;
		for (let i = 0; i < 30; i++) {
			const out = await signer.sign({
				group: blogId,
				participant: 'user-bob',
				info: voteActionInfo(v1),
				blindedMessage: blindedMsg
			});
			if (out.status === 'ok') {
				blindSig = out.blindSignature;
				break;
			}
			await new Promise((r) => setTimeout(r, 3000));
		}
		expect(blindSig).not.toBeNull();
		const signature = await suite.finalize(pub, prepared, info(v1), blindSig!, inv);

		// Verifies under v1 …
		expect(
			await verifyToken({
				publicKeySpki: spki,
				signature,
				preparedNonce: prepared,
				info: voteActionInfo(v1)
			})
		).toBe(true);
		// … but NOT under v2 (the public metadata binds the signature to the version).
		expect(
			await verifyToken({
				publicKeySpki: spki,
				signature,
				preparedNonce: prepared,
				info: voteActionInfo(v2)
			})
		).toBe(false);
	}, 180_000);

	it('enforces one signature per (group, participant, version) at the signer', async () => {
		const blogId = `e2e-blog-cap-${Date.now()}`;
		const versionId = '44444444-4444-4444-4444-444444444444';
		const participantId = 'user-carol';

		await signer.ensureKey(blogId);
		const spki = await waitForKey(signer, blogId);
		const pub = await importPub(spki);

		const sign1 = async () => {
			const nonce = crypto.getRandomValues(new Uint8Array(32));
			const prepared = suite.prepare(nonce);
			const { blindedMsg } = await suite.blind(pub, prepared, info(versionId));
			for (let i = 0; i < 30; i++) {
				const out = await signer.sign({
					group: blogId,
					participant: participantId,
					info: voteActionInfo(versionId),
					blindedMessage: blindedMsg
				});
				if (out.status === 'ok') return { ok: true as const };
				if (out.status === 'rate_limited') return { ok: false as const, reason: 'rate_limited' };
				await new Promise((r) => setTimeout(r, 3000));
			}
			return { ok: false as const, reason: 'never-ok' };
		};

		// First sign for (group, participant, version) succeeds.
		const first = await sign1();
		expect(first.ok).toBe(true);

		// A SECOND sign for the SAME tuple must be refused by Signet (record-first +
		// UNIQUE index). The signetSign wrapper throws on the 409, so we assert it
		// rejects rather than returning a fresh signature.
		const nonce2 = crypto.getRandomValues(new Uint8Array(32));
		const prepared2 = suite.prepare(nonce2);
		const { blindedMsg: blinded2 } = await suite.blind(pub, prepared2, info(versionId));
		await expect(
			signer.sign({
				group: blogId,
				participant: participantId,
				info: voteActionInfo(versionId),
				blindedMessage: blinded2
			})
		).rejects.toThrow();
	}, 180_000);
});
