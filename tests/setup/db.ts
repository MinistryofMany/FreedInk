// Per-suite test DB helpers. Creates the `freedink_test` DB on first run,
// applies all migrations, and exposes a `resetDb()` that truncates every
// table between tests (fast vs. drop+recreate).
import './load-env';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const url = process.env.DATABASE_URL!;
const parsed = new URL(url);
const targetDb = parsed.pathname.slice(1);
const adminUrl = (() => {
	const u = new URL(url);
	u.pathname = '/postgres';
	return u.toString();
})();

let migrated = false;

async function ensureDatabaseExists() {
	const admin = postgres(adminUrl, { max: 1 });
	try {
		const rows = await admin`SELECT 1 FROM pg_database WHERE datname = ${targetDb}`;
		if (rows.length === 0) {
			await admin.unsafe(`CREATE DATABASE "${targetDb}"`);
		}
	} finally {
		await admin.end();
	}
}

export async function ensureMigrated() {
	if (migrated) return;
	await ensureDatabaseExists();
	const sql = postgres(url, { max: 1, prepare: false });
	const db = drizzle(sql);
	await migrate(db, { migrationsFolder: './migrations' });
	await sql.end();
	migrated = true;
}

// Names of tables that hold per-test state. Truncate in dependency-safe order
// (children first, but CASCADE makes ordering irrelevant — listed for clarity).
// Keep this list in sync with src/lib/db/schema.ts. New tables MUST be added
// here or cross-test pollution will surface as FK violations in unrelated tests.
const TRUNCATE_ORDER = [
	'blog_post_tags',
	'post_comments',
	'post_reviews',
	'vote_token_issuances',
	'blog_vote_token_keys',
	'blog_post_versions',
	'blog_posts',
	'post_submission_nonces',
	'blog_member_snapshots',
	'blog_invitations',
	'permission_changes',
	'blog_members',
	'blogs',
	'tags',
	'audit_log',
	'rate_limits',
	'abuse_reports',
	'media_uploads',
	'push_subscriptions',
	'feature_flag_overrides',
	'feature_flags',
	'status_incident_updates',
	'status_incidents',
	'status_checks',
	'user_identities',
	'sessions',
	'oidc_sessions',
	'oidc_identities',
	'users'
];

export async function resetDb() {
	await ensureMigrated();
	// Use a fresh, short-lived connection so we don't tangle with the app's
	// module-level pool that other test code is using.
	const sql = postgres(url, { max: 1, prepare: false });
	try {
		const list = TRUNCATE_ORDER.map((t) => `"${t}"`).join(', ');
		await sql.unsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
	} finally {
		await sql.end();
	}
}
