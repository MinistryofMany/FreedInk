// VoteSigner — the blind-signing backend abstraction.
//
// ONE interface, TWO implementations, chosen ONCE at startup by whether
// SIGNET_URL is set:
//   - LocalVoteSigner (DEFAULT): per-blog key in blog_vote_token_keys, blind-sign
//     in the FreedInk process. This is exactly today's behavior, refactored behind
//     the interface — not rewritten. Keys stay plaintext-at-rest (the deliberate
//     "simple / less secure" tier; production hardening = run Signet).
//   - SignetVoteSigner: calls the external Signet service over mTLS. FreedInk holds
//     NO private key; group_id = blog id, participant_id = the stable FreedInk user
//     id, version_id = the post version. Signet independently enforces
//     one-token-per-(group,participant,version) + rate limits.
//
// CRITICAL — same wire scheme both ways. Both backends produce byte-identical
// blind signatures under suite RSAPBSSA.SHA384.PSS.Randomized with public
// metadata `freedink-vote:<versionId>`. The browser blinds, the backend signs the
// ALREADY-BLINDED message, the browser finalizes, and redemption verifies the
// unblinded signature against the public key from getPublicKey(). The raw nonce
// NEVER reaches a signer in either mode — that is the anonymity invariant.

import { signetConfig, signetGetKey, signetCreateKey, signetSign } from './signet';
import type { SignetConfig } from './signet';
import {
	getOrCreateVoteTokenKey,
	getVoteTokenPublicKey,
	ensureLocalVoteTokenKey
} from '$lib/db/vote-tokens';
import { blindSignVoteToken } from './vote-token';
import { log } from './log';

// The result of a sign() call. `pending` means the key is still being generated
// (Signet only); the caller should poll/retry rather than treat it as an error.
// `rate_limited` means Signet's per-participant or global ceiling fired.
export type SignOutcome =
	| { status: 'ok'; blindSignature: Uint8Array }
	| { status: 'pending' }
	| { status: 'rate_limited' };

// The result of a getPublicKey() call. `pending` (Signet only) means keygen is
// still running; the issuance preflight surfaces this as "preparing voting".
export type PublicKeyOutcome =
	| { status: 'ready'; publicKeySpki: Uint8Array }
	| { status: 'pending' };

export interface VoteSigner {
	readonly backend: 'local' | 'signet';

	// Fetch the blog's issuer PUBLIC key (SPKI bytes). Used by the client
	// preflight (to blind) and the redemption endpoint (to verify). In Signet mode
	// this can return `pending` while keygen runs.
	getPublicKey(blogId: string): Promise<PublicKeyOutcome>;

	// Blind-sign an ALREADY-BLINDED message for (blog, participant, version). The
	// raw nonce is never passed in. Returns `pending`/`rate_limited` (Signet) or
	// throws on a real error (malformed message, transport failure).
	sign(args: {
		blogId: string;
		participantId: string;
		versionId: string;
		blindedMessage: Uint8Array;
	}): Promise<SignOutcome>;

	// Idempotently ensure a key exists for the blog, kicking off async generation
	// if absent. Pre-gen calls this on the "2nd reviewer" and "enters under_review"
	// triggers. Never blocks on a multi-second keygen; safe to call repeatedly.
	ensureKey(blogId: string): Promise<void>;
}

// ── LocalVoteSigner ──────────────────────────────────────────────────────────

class LocalVoteSigner implements VoteSigner {
	readonly backend = 'local' as const;

	async getPublicKey(blogId: string): Promise<PublicKeyOutcome> {
		// If a key exists, return it. Otherwise create one now (the preflight path
		// already did this historically; getOrCreateVoteTokenKey is concurrency-safe
		// via the partial unique index). Local keygen is ~1s, so we generate inline
		// here rather than returning `pending` — the existing behavior is preserved.
		const existing = await getVoteTokenPublicKey(blogId);
		if (existing) return { status: 'ready', publicKeySpki: existing };
		const key = await getOrCreateVoteTokenKey(blogId);
		return { status: 'ready', publicKeySpki: key.publicKeySpki };
	}

	async sign(args: {
		blogId: string;
		participantId: string;
		versionId: string;
		blindedMessage: Uint8Array;
	}): Promise<SignOutcome> {
		// In-process blind-sign with the blog's private key (exactly as before).
		// participantId is unused locally — FreedInk's vote_token_issuances unique
		// index is the per-(user,version) cap in local mode.
		const key = await getOrCreateVoteTokenKey(args.blogId);
		const blindSignature = await blindSignVoteToken({
			privateKeyPkcs8: key.privateKeyPkcs8,
			blindedMessage: args.blindedMessage,
			versionId: args.versionId
		});
		return { status: 'ok', blindSignature };
	}

	async ensureKey(blogId: string): Promise<void> {
		// Local keygen is ~1s with the native safe-prime generator, but we still do
		// it off the request path: a fire-and-forget background insert so a freshly
		// created under_review post (or a blog's 2nd reviewer) warms the key before
		// the first vote. Idempotent: getOrCreateVoteTokenKey no-ops if one exists.
		await ensureLocalVoteTokenKey(blogId);
	}
}

// ── SignetVoteSigner ─────────────────────────────────────────────────────────

class SignetVoteSigner implements VoteSigner {
	readonly backend = 'signet' as const;
	private readonly cfg: SignetConfig;

	// Small in-process cache of READY public keys (SPKI). The Signet public key is
	// stable per group, so once it's ready we don't re-fetch it on every preflight
	// or redemption. Pending keys are never cached. This is NOT a persistence layer
	// (we never write Signet keys into blog_vote_token_keys); it's a per-process
	// memo that a restart simply rebuilds from GET /key.
	private readonly pubKeyCache = new Map<string, Uint8Array>();

	// Groups for which we have already issued a POST /key from a read/sign path in
	// this process. Signet dedups concurrent generations per group, but RE-issuing
	// POST /key on every pending poll thrashes the worker pool and can keep keygen
	// from converging — so we enqueue at most ONCE per group per process here. The
	// pre-gen event triggers also call ensureKey (which always enqueues); that's
	// fine because they fire on discrete events, not in a poll loop.
	private readonly enqueued = new Set<string>();

	constructor(cfg: SignetConfig) {
		this.cfg = cfg;
	}

	async getPublicKey(blogId: string): Promise<PublicKeyOutcome> {
		const cached = this.pubKeyCache.get(blogId);
		if (cached) return { status: 'ready', publicKeySpki: cached };
		const res = await signetGetKey(this.cfg, blogId);
		if (res.status === 'pending') {
			// Ensure the key was enqueued at least once (covers a verify/preflight that
			// arrives before any pre-gen). Enqueue ONCE per process to avoid thrashing
			// Signet's keygen worker on repeated polls.
			this.enqueueOnce(blogId);
			return { status: 'pending' };
		}
		this.pubKeyCache.set(blogId, res.publicKeySpki);
		return { status: 'ready', publicKeySpki: res.publicKeySpki };
	}

	// Fire POST /key at most once per group per process. Best-effort.
	private enqueueOnce(blogId: string): void {
		if (this.enqueued.has(blogId)) return;
		this.enqueued.add(blogId);
		void this.ensureKey(blogId);
	}

	async sign(args: {
		blogId: string;
		participantId: string;
		versionId: string;
		blindedMessage: Uint8Array;
	}): Promise<SignOutcome> {
		const res = await signetSign(this.cfg, {
			groupId: args.blogId,
			participantId: args.participantId,
			versionId: args.versionId,
			blindedMessage: args.blindedMessage
		});
		if (res.status === 'pending') {
			// Key still generating — make sure it's enqueued once, then tell the
			// caller to retry. Signet's /sign waits a bounded time before returning
			// pending; re-enqueueing on every retry would thrash the keygen worker.
			this.enqueueOnce(args.blogId);
			return { status: 'pending' };
		}
		if (res.status === 'rate_limited') return { status: 'rate_limited' };
		return { status: 'ok', blindSignature: res.blindSignature };
	}

	async ensureKey(blogId: string): Promise<void> {
		// Mark enqueued so a subsequent read/sign-path poll won't re-POST /key.
		this.enqueued.add(blogId);
		try {
			const res = await signetCreateKey(this.cfg, blogId);
			if (res.status === 'ready') this.pubKeyCache.set(blogId, res.publicKeySpki);
		} catch (err) {
			// Pre-gen is best-effort; a failed enqueue is logged, not fatal. The hard
			// guarantee is the on-demand path: clear the marker so a later poll can
			// retry the enqueue rather than waiting forever on a transient failure.
			this.enqueued.delete(blogId);
			log.warn({ err, blogId }, 'signet ensureKey failed');
		}
	}
}

// ── Selection (startup-fixed) ────────────────────────────────────────────────

let singleton: VoteSigner | null = null;

// Return the process-wide VoteSigner. Chosen ONCE by whether SIGNET_URL is set:
// configured → SignetVoteSigner (mTLS), else → LocalVoteSigner (in-process).
export function getVoteSigner(): VoteSigner {
	if (singleton) return singleton;
	const cfg = signetConfig();
	singleton = cfg ? new SignetVoteSigner(cfg) : new LocalVoteSigner();
	log.info({ backend: singleton.backend }, 'vote signer selected');
	return singleton;
}

// Test-only: drop the memoized signer so a test can flip SIGNET_URL between cases.
export function _resetVoteSignerForTests(): void {
	singleton = null;
}
