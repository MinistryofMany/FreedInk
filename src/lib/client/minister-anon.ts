import { browser } from '$app/environment';
import { extractMinisterAppSecret, decideAnonAction } from '@ministryofmany/identity/link';

// Ministry → FreedInk anonymous-identity handoff (one-root model). When
// FreedInk's OIDC client is anon-enabled on Minister, the consent page appends
// the user's FreedInk BRANCH of the identity tree (a 32-byte per-app secret) to
// the callback redirect as a URL fragment (`#minister_anon=v1.…`). The fragment
// survives the server-side 3xx hops because browsers re-attach the original
// fragment across redirects, and it never reaches any server — fragments aren't
// sent in HTTP requests.
//
// The branch is delivered at EVERY Ministry login, so a re-key (Ministry mints a
// new root, bumps the signed `minister_anon_epoch`) propagates on the user's next
// sign-in with no push. From the branch FreedInk derives one Semaphore identity
// PER BLOG locally, forever, without asking again (see blog-identity.ts). There is
// no password, no vault, and no mix secret: the root on the user's own devices is
// the only backup.
//
// Two-phase, browser-local consumption:
//
//   1. `captureMinisterAppSecret()` — hooks.client.ts calls this FIRST at client
//      boot, before Sentry loads and before any router navigation can read or
//      destroy the fragment. It reads the branch into module memory and scrubs it
//      from the URL/history. No epoch is available this early.
//   2. `reconcileBranch(tokenEpoch)` — the root layout calls this once it has the
//      user's server-verified `anonEpoch`. The signed epoch is the authority: the
//      branch is adopted/re-keyed into localStorage only when the epoch strictly
//      advances (`decideAnonAction`), never on a bare fragment presence. A stale
//      or replayed login can therefore never clobber the current branch.
//
// Nothing here is ever sent to the FreedInk server — the branch and everything
// derived from it are browser-local by construction.

const BRANCH_KEY = 'freedink.minister.branch';
const EPOCH_KEY = 'freedink.minister.epoch';

// The branch captured from the fragment this document load, in module memory.
// Only set on the OIDC callback-landing full navigation; persists across SPA
// navigations, lost on a full reload (which is why reconcile persists it).
let capturedBranch: Uint8Array | null = null;
let captured = false;

// Read + scrub the `minister_anon` fragment. Idempotent per document load;
// hooks.client.ts calls it before anything else touches the URL. A fragment only
// arrives on a full-document navigation (the OIDC callback redirect chain), which
// always re-evaluates this module, so once per load is correct.
export function captureMinisterAppSecret(): void {
	if (!browser || captured) return;
	captured = true;
	try {
		capturedBranch = extractMinisterAppSecret();
	} catch (err) {
		// extract throws only when it cannot scrub (history.replaceState missing).
		// Breaking client boot would break every login, so fail closed on the anon
		// identity instead and keep the app alive.
		capturedBranch = null;
		console.warn('minister anon fragment could not be captured', err);
	}
}

function toBase64url(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(s: string): Uint8Array | null {
	if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
	const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
	const pad = '='.repeat((4 - (b64.length % 4)) % 4);
	try {
		const bin = atob(b64 + pad);
		const out = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
		return out;
	} catch {
		return null;
	}
}

function readStoredEpoch(): number | undefined {
	const raw = localStorage.getItem(EPOCH_KEY);
	if (raw === null) return undefined;
	const n = Number(raw);
	return Number.isInteger(n) ? n : undefined;
}

// Reconcile the freshly-captured branch (if any) against the server-authoritative
// epoch. Persists a new branch to localStorage only when the signed epoch strictly
// advances past the epoch we last keyed at — adopt (first identity) or rekey. On
// "none" (no fragment this load, or a non-advancing epoch) the stored branch is
// left untouched. Safe to call on every authenticated navigation.
export function reconcileBranch(tokenEpoch: number | null | undefined): void {
	if (!browser) return;
	const action = decideAnonAction({
		branch: capturedBranch,
		tokenEpoch: tokenEpoch ?? undefined,
		storedEpoch: readStoredEpoch()
	});
	if (action.action === 'none') return;
	// adopt | rekey: persist the new branch + the epoch it was keyed at.
	localStorage.setItem(BRANCH_KEY, toBase64url(action.branch));
	localStorage.setItem(EPOCH_KEY, String(action.epoch));
	// The module copy has done its job; zero it so the branch does not sit in two
	// places longer than necessary.
	capturedBranch?.fill(0);
	capturedBranch = null;
}

// The persisted FreedInk branch (32 bytes), or null when the user has never
// connected their Ministry identity on this device. Callers that get null must
// prompt the user to sign in with Minister rather than invent a secret.
export function getStoredBranch(): Uint8Array | null {
	if (!browser) return null;
	const raw = localStorage.getItem(BRANCH_KEY);
	if (raw === null) return capturedBranch;
	return fromBase64url(raw) ?? capturedBranch;
}
