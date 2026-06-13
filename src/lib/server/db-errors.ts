// Postgres unique_violation (SQLSTATE 23505). drizzle-orm wraps driver
// errors in a DrizzleQueryError whose `.cause` is the postgres-js
// PostgresError, and a surrounding transaction can wrap it again — so we
// walk the `cause` chain rather than checking a single level.
export function isUniqueViolation(e: unknown): boolean {
	let cur: unknown = e;
	for (let depth = 0; depth < 6 && cur && typeof cur === 'object'; depth++) {
		if ('code' in cur && String((cur as { code?: unknown }).code) === '23505') return true;
		cur = (cur as { cause?: unknown }).cause;
	}
	return false;
}
