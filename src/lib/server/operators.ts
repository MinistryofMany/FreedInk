// Platform-operator gate. The operator list is configured via the
// PLATFORM_OPERATORS env var as a comma-separated set of usernames or user
// UUIDs. Empty/unset means no operators (the dashboard is inaccessible).
//
// Why env-driven rather than a DB role? The platform operator is a deploy-
// level concept (you/Tyler), not a user-managed one. Putting it in the env
// keeps it out of the schema (which is frozen for this wave) and prevents a
// compromised DB write from elevating to operator.
import { env } from '$env/dynamic/private';
import { db, schema } from '$lib/db/client';
import { and, eq } from 'drizzle-orm';
import { oidcConfig } from '$lib/server/oidc';
import type { User } from '$lib/db/schema';

function parseList(): Set<string> {
	const raw = env.PLATFORM_OPERATORS ?? '';
	return new Set(
		raw
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
	);
}

export function isPlatformOperator(user: User | null | undefined): boolean {
	if (!user) return false;
	const set = parseList();
	if (set.size === 0) return false;
	return set.has(user.username) || set.has(user.id);
}

// Helper for tests / debug: returns the live operator set.
export function operatorList(): string[] {
	return [...parseList()];
}

// ──────────────────────── FreedInk service-operator gate ────────────────────────
//
// The service runner (the person who deploys and operates this FreedInk
// instance) is identified by their Minister OIDC subject(s), configured via the
// FREEDINK_OPERATOR_SUBS env var as a comma-separated allowlist. This is a
// deploy-level superuser distinct from per-blog admins: it grants cross-blog
// access to every blog's Manage / Settings / Review / moderation surfaces.
//
// Why the Minister `sub` rather than a username/UUID? The operator's own account
// is created lazily on first Minister sign-in with an auto-minted username, so
// the stable, deploy-time-knowable identifier is the pairwise Minister subject.
// The operator finds their value in the ops dashboard / Settings (surfaced there)
// and pins it into FREEDINK_OPERATOR_SUBS.
//
// FAIL CLOSED: an empty/unset allowlist means there are NO operators and the ops
// surface is inaccessible. Never default-open.

export function parseFreedinkOperatorSubs(): Set<string> {
	const raw = env.FREEDINK_OPERATOR_SUBS ?? '';
	return new Set(
		raw
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
	);
}

// Is FREEDINK_OPERATOR_SUBS configured at all? Used only for diagnostics in the
// ops UI (so a misconfigured deploy can tell "unset" from "you're not on it").
export function operatorAllowlistConfigured(): boolean {
	return parseFreedinkOperatorSubs().size > 0;
}

// True iff the given user holds an OIDC subject in the operator allowlist under
// Minister's configured issuer. Fails closed when the allowlist is empty/unset.
//
// The match is pinned to Minister's issuer (`OIDC_MINISTER_ISSUER`, via
// `oidcConfig().issuer`) because the rest of the codebase keys OIDC identities
// on (issuer, subject) — matching a bare subject would let a subject minted by
// some other or future issuer that happens to collide with an allowlisted value
// elevate to operator. Compare (issuer, subject). If Minister OIDC isn't
// configured there can be no operator, so fail closed there too.
export async function isFreedinkOperator(userId: string | null | undefined): Promise<boolean> {
	if (!userId) return false;
	const set = parseFreedinkOperatorSubs();
	if (set.size === 0) return false; // fail closed
	const cfg = oidcConfig();
	if (!cfg) return false; // Minister OIDC not configured → no operators
	const rows = await db
		.select({ subject: schema.oidcIdentities.subject })
		.from(schema.oidcIdentities)
		.where(
			and(
				eq(schema.oidcIdentities.userId, userId),
				eq(schema.oidcIdentities.issuer, cfg.issuer)
			)
		);
	return rows.some((r) => set.has(r.subject));
}
