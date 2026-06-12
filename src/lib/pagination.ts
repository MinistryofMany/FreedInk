// Keyset (cursor) pagination helpers. Used across all public listings.
//
// Cursors are opaque base64url-encoded JSON. We never expose underlying field
// values directly in URLs — clients should treat the string as a token.
//
// Keyset pagination > offset because:
//   - cheap with proper indexes (the WHERE clause becomes an index range scan),
//   - doesn't skip/duplicate rows under concurrent writes,
//   - survives arbitrarily large offsets (offset N has to scan N rows).
//
// Convention for *Page DB functions:
//   WHERE (sort_key, id) < ($cursor_key, $cursor_id)
//   ORDER BY sort_key DESC, id DESC LIMIT $limit + 1
// then return N items + nextCursor if N+1 rows came back. The trailing `id` is
// a stable tiebreak so rows with identical sort keys still get a deterministic
// order (UUIDs are unique, so the composite is total-order).

export type Page<T> = {
	items: T[];
	nextCursor: string | null;
};

/** Encode an arbitrary JSON-serializable object to an opaque base64url token. */
export function encodeCursor(payload: object): string {
	const json = JSON.stringify(payload);
	// btoa wants a binary string; build it manually for unicode safety.
	const bytes = new TextEncoder().encode(json);
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(json, 'utf8').toString('base64');
	return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode an opaque cursor produced by `encodeCursor`. Returns `null` for
 * missing input or any decode/parse failure — callers should treat a bad
 * cursor the same as "no cursor" (start from the top).
 */
export function decodeCursor<T = unknown>(s: string | null | undefined): T | null {
	if (!s) return null;
	try {
		// Restore base64 padding/alphabet.
		let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
		while (b64.length % 4 !== 0) b64 += '=';
		let json: string;
		if (typeof atob === 'function') {
			const bin = atob(b64);
			const bytes = new Uint8Array(bin.length);
			for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
			json = new TextDecoder().decode(bytes);
		} else {
			json = Buffer.from(b64, 'base64').toString('utf8');
		}
		const parsed = JSON.parse(json);
		if (parsed === null || typeof parsed !== 'object') return null;
		return parsed as T;
	} catch {
		return null;
	}
}

/**
 * Parse a `?limit=` query param, clamping to `[1, max]` and falling back to
 * `dflt` on missing/invalid input.
 */
export function parseLimit(s: string | null | undefined, dflt = 20, max = 100): number {
	if (s === null || s === undefined || s === '') return dflt;
	const n = Number(s);
	if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return dflt;
	if (n > max) return max;
	return n;
}
