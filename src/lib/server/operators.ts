// Platform-operator gate. The operator list is configured via the
// PLATFORM_OPERATORS env var as a comma-separated set of usernames or user
// UUIDs. Empty/unset means no operators (the dashboard is inaccessible).
//
// Why env-driven rather than a DB role? The platform operator is a deploy-
// level concept (you/Tyler), not a user-managed one. Putting it in the env
// keeps it out of the schema (which is frozen for this wave) and prevents a
// compromised DB write from elevating to operator.
import { env } from '$env/dynamic/private';
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
