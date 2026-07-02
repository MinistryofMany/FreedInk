// Blind-signature voting tokens (Privacy Pass-style), CLIENT side. Runs in the
// browser. The blind-RSA crypto (prepare/blind + the Chromium-safe finalize) now
// lives in @ministryofmany/blind-token/client, lifted byte-for-byte from FreedInk;
// this module keeps FreedInk's fetch ORCHESTRATION around it:
//   1. requestAndBuildToken(versionId): authenticated issuance. Preflight the
//      issuer public key, prepare+blind a fresh nonce (package), ask the server to
//      blind-sign, finalize (package). Sends the session cookie.
//   2. castVote(...): anonymous redemption. POST the signature + prepared nonce +
//      vote with credentials:'omit' (no session) to the vote endpoint, after a
//      small timing-decorrelation jitter.
//
// The heavy crypto (@cloudflare/blindrsa-ts + its bundled sjcl) is lazy-loaded
// INSIDE the package on first prepare/finalize, so it isn't in the initial chunk
// of the post page — most readers never vote.

import {
	prepareToken,
	finalizeToken,
	bytesToB64url,
	b64urlToBytes,
	__testing as pkgTesting
} from '@ministryofmany/blind-token/client';
import type { RedeemableToken, PublicKeySpki, ActionInfo } from '@ministryofmany/blind-token/client';

export type { RedeemableToken };

// The app-wide public-metadata namespace. MUST match the server's VOTE_INFO_PREFIX
// (and the deployed Signet's compiled prefix): buildInfo produces the bytes
// `freedink-vote:<versionId>`, and the single literal colon is what prevents
// cross-version replay. Defined locally so this browser module never imports the
// server wiring.
const VOTE_INFO_PREFIX = 'freedink-vote';

function versionInfo(versionId: string): ActionInfo {
	return { infoPrefix: VOTE_INFO_PREFIX, actionKey: versionId };
}

// Thrown when the issuer key isn't ready yet (async pre-gen still running, or a
// Signet keygen in flight): the key preflight or the issuance POST returned
// HTTP 202 { status: 'pending' }. The caller should show "preparing voting…" and
// retry rather than surface this as a hard error. The user's single
// one-per-(user,version) token is NOT consumed on a pending issuance (the server
// rolls back the reservation), so retrying is safe.
export class VotePendingError extends Error {
	readonly pending = true;
	constructor() {
		super('preparing voting for this post…');
		this.name = 'VotePendingError';
	}
}

// Step 1 — authenticated issuance. Preflight the issuer key, blind a fresh random
// nonce, get it blind-signed, finalize. Sends the session cookie (default
// credentials). Throws VotePendingError if the key is still being generated.
export async function requestAndBuildToken(versionId: string): Promise<RedeemableToken> {
	const info = versionInfo(versionId);

	// blind() needs the issuer public key, so fetch it via a cheap preflight (no
	// token consumed) before blinding. The key is per-blog and stable, so this is
	// effectively a one-time fetch the browser caches. Throws VotePendingError if
	// the key is still being generated (async pre-gen / Signet keygen).
	const publicKey = await fetchIssuerPublicKey(versionId);

	// Prepare + blind (package). `prepared` and `inv` NEVER leave the browser; only
	// `blindedMessage` is sent to the server.
	const { blindedMessage, prepared, inv } = await prepareToken({ publicKey, info });

	// Authenticated issuance: send the blinded message; receive the blind sig.
	const res = await fetch('/api/blog/vote-token', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			post_version_id: versionId,
			blinded_message: bytesToB64url(blindedMessage)
		})
	});
	// 202 = key not ready yet (the reservation was rolled back server-side, so no
	// token was consumed). Signal the caller to show "preparing voting…" + retry.
	if (res.status === 202) throw new VotePendingError();
	if (!res.ok) throw new Error(await res.text());
	const { blind_signature } = await res.json();
	const blindSignature = b64urlToBytes(blind_signature);

	// Finalize (package): the Chromium-safe finalize computes the unblinded
	// signature arithmetically and runs the RFC 9474 self-check. Byte-identical to
	// the library's finalize, so the server verifies with the unmodified library
	// and Signet interop holds. A garbled blind signature throws here, before the
	// user spends their one-per-(user,version) token.
	return finalizeToken({ publicKey, info, prepared, inv, blindSignature });
}

// Preflight: fetch the blog's issuer public key (SPKI bytes) for a version (no
// token consumed). Returns 202 { status: 'pending' } while the key is still being
// generated; we surface that as VotePendingError so the caller shows "preparing
// voting…".
async function fetchIssuerPublicKey(versionId: string): Promise<PublicKeySpki> {
	const res = await fetch(
		`/api/blog/vote-token/key?post_version_id=${encodeURIComponent(versionId)}`
	);
	if (res.status === 202) throw new VotePendingError();
	if (!res.ok) throw new Error(await res.text());
	const { public_key } = await res.json();
	return b64urlToBytes(public_key);
}

// Random redemption jitter (ms). A small client-side delay before the vote POST
// decorrelates the authenticated issuance from the anonymous redemption in time,
// so an operator watching request timestamps cannot trivially pair "user X asked
// for a token at T" with "a vote arrived at ~T". Paired with the server-side
// coarsening of vote_token_issuances.created_at (see recordIssuance), this raises
// the cost of the timing side-channel.
//
// RESIDUAL (documented, not eliminated): in a blog with a single eligible
// reviewer, ANY issuance↔vote pairing is trivial regardless of timing — there is
// only one candidate voter, so the anonymity set is size 1. Jitter only helps
// once the eligible-reviewer set is >1 and several reviewers act in overlapping
// windows; it does not manufacture an anonymity set that the population denies.
// The jitter is also bounded (a few seconds) to stay within the redemption
// rate-limit window and keep the UI responsive, so a patient operator correlating
// over a long quiet period still gains some signal. This is a mitigation, not a
// guarantee.
const REDEEM_JITTER_MAX_MS = 4000;
const REDEEM_JITTER_MIN_MS = 250;

function redeemJitterMs(): number {
	const span = REDEEM_JITTER_MAX_MS - REDEEM_JITTER_MIN_MS;
	const r = crypto.getRandomValues(new Uint32Array(1))[0] / 0x1_0000_0000;
	return REDEEM_JITTER_MIN_MS + Math.floor(r * span);
}

// Step 2 — anonymous redemption (the vote). Session-free: credentials omitted.
export async function castVote(opts: {
	versionId: string;
	token: RedeemableToken;
	vote: 'approve' | 'reject';
	comment?: string;
	rejectionReasons?: string[];
}): Promise<Response> {
	// Decorrelate redemption from issuance in time (see REDEEM_JITTER_MAX_MS).
	await new Promise((resolve) => setTimeout(resolve, redeemJitterMs()));
	return fetch('/api/post/review', {
		method: 'POST',
		// Anonymous redemption: never attach the session cookie.
		credentials: 'omit',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			post_version_id: opts.versionId,
			vote: opts.vote,
			comment: opts.comment,
			rejection_reasons: opts.rejectionReasons,
			signature: opts.token.signature,
			prepared_nonce: opts.token.preparedNonce
		})
	});
}

// Test-only surface. finalizeInBrowser is internal to the package's finalizeToken;
// we re-expose the package's test hook here so the byte-identical finalize test
// keeps proving compatibility with the library's finalize without going through
// fetch. Not part of the public API.
export const __testing = { finalizeInBrowser: pkgTesting.finalizeInBrowser };
