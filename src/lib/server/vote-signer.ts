// Vote-token signer + issuer wiring over @ministryofmany/blind-token.
//
// The blind-signing crypto core, the Signer interface (local in-process key vs.
// remote Signet mTLS), the record-first/rollback-on-failure Issuer, verify, and
// keygen all live in @ministryofmany/blind-token now — lifted byte-for-byte from
// FreedInk's former vote-token.ts / signet.ts / vote-signer.ts. What stays here is
// the FreedInk-specific WIRING: the env-driven backend selection (SIGNET_URL →
// RemoteSigner, else LocalSigner), the KeyStore/IssuanceStore Drizzle impls
// (injected), the app's info prefix, and the process-wide singletons.
//
// CRITICAL — byte identity. The info prefix is 'freedink-vote', so the metadata
// signed is `freedink-vote:<versionId>` exactly as before; the suite is
// RSAPBSSA.SHA384.PSS.Randomized; the Signet /sign + /key wire is preserved. Every
// existing token and the deployed Signet stay interoperable.

import { createSigner, createIssuer } from '@ministryofmany/blind-token/server';
import type {
	Signer,
	Issuer,
	IssueResult,
	ActionInfo,
	TokenLogger
} from '@ministryofmany/blind-token/server';
import { signetConfig } from './signet';
import { freedinkKeyStore, freedinkIssuanceStore } from '$lib/db/vote-tokens';
import { log } from './log';

export type { Signer, Issuer, IssueResult };

// The app-wide public-metadata namespace. The bytes signed are
// `freedink-vote:<versionId>` — the single literal colon between namespace and
// version is what prevents cross-version replay. This MUST equal the deployed
// Signet's compiled prefix (Signet hard-codes `freedink-vote:`), or every
// signature fails closed at redemption. Do not change it.
export const VOTE_INFO_PREFIX = 'freedink-vote';

// Build the ActionInfo for a post version. buildInfo({infoPrefix, actionKey}) in
// the package produces `freedink-vote:<versionId>` — byte-identical to the former
// versionInfo(versionId).
export function voteActionInfo(versionId: string): ActionInfo {
	return { infoPrefix: VOTE_INFO_PREFIX, actionKey: versionId };
}

// Adapt FreedInk's pino logger to the package's minimal TokenLogger. Used only
// for best-effort warnings (a failed Signet enqueue, a post-sign pubkey fetch
// blip); the package NEVER logs request/response bodies.
const tokenLogger: TokenLogger = {
	warn: (fields, msg) => log.warn(fields, msg),
	info: (fields, msg) => log.info(fields, msg)
};

let signerSingleton: Signer | null = null;

// Return the process-wide Signer. Chosen ONCE by whether SIGNET_URL is set:
// configured → RemoteSigner (mTLS Signet), else → LocalSigner (in-process key).
export function getVoteSigner(): Signer {
	if (signerSingleton) return signerSingleton;
	const cfg = signetConfig();
	signerSingleton = cfg
		? createSigner({
				kind: 'remote',
				remote: {
					baseUrl: cfg.baseUrl,
					clientCert: cfg.clientCert,
					clientKey: cfg.clientKey,
					caCert: cfg.caCert,
					// Must match the deployed Signet's compiled prefix (and the client's
					// info prefix), or every signature fails to verify.
					infoPrefix: VOTE_INFO_PREFIX,
					logger: tokenLogger
				}
			})
		: createSigner({
				kind: 'local',
				// Keygen defaults (2048-bit, Node safe-prime) match FreedInk's former
				// generateVoteTokenKey; the KeyStore is FreedInk's Drizzle impl.
				local: { keyStore: freedinkKeyStore }
			});
	log.info({ backend: signerSingleton.backend }, 'vote signer selected');
	return signerSingleton;
}

let issuerSingleton: Issuer | null = null;

// Return the process-wide Issuer: the record-first → sign → rollback-on-failure
// orchestrator over the Signer + FreedInk's IssuanceStore. The route calls
// issuer.issue() after its own eligibility check; the Issuer guarantees a token is
// issued IFF a fresh reservation was made AND signing returned ok.
export function getVoteIssuer(): Issuer {
	if (issuerSingleton) return issuerSingleton;
	issuerSingleton = createIssuer({
		signer: getVoteSigner(),
		issuanceStore: freedinkIssuanceStore,
		// FreedInk returns the public key alongside a successful blind signature to
		// save the client a round-trip (the former route did this).
		includePublicKeyOnIssue: true,
		logger: tokenLogger
	});
	return issuerSingleton;
}

// Test-only: drop the memoized signer + issuer so a test can flip SIGNET_URL
// between cases.
export function _resetVoteSignerForTests(): void {
	signerSingleton = null;
	issuerSingleton = null;
}
