import { describe, it, expect, vi, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/pg-proxy';

// Capture the SQL the search query builder emits without a live Postgres.
// A pg-proxy drizzle instance routes every query through our callback, where
// we record the rendered SQL string and hand back an empty result set. We
// mock `$lib/db/client` so the module under test (tags.ts) builds its queries
// against this capturing db.
const captured: { sql: string; params: unknown[] }[] = [];

vi.mock('./client', async () => {
	const realSchema = await import('./schema');
	const db = drizzle(
		async (query, params) => {
			captured.push({ sql: query, params });
			return { rows: [] };
		},
		{ schema: realSchema }
	);
	return { db, schema: realSchema };
});

// Import after the mock is registered so tags.ts picks up the proxy db.
const { searchPublishedPosts, searchPublishedPostsPage } = await import('./tags');

beforeEach(() => {
	captured.length = 0;
});

function lastSql(): string {
	const row = captured.at(-1);
	if (!row) throw new Error('no SQL captured');
	return row.sql;
}

describe('searchPublishedPosts ordering', () => {
	it('ranks by ts_rank before recency when a query is present', async () => {
		await searchPublishedPosts({ query: 'zero knowledge' });
		const sql = lastSql();

		// Relevance ranking must be in the ORDER BY.
		expect(sql).toMatch(/ts_rank\(/i);

		// ts_rank must come *before* the published_at tiebreak in the ORDER BY,
		// i.e. rank is the primary sort key and recency only breaks ties.
		const orderByIdx = sql.toLowerCase().lastIndexOf('order by');
		expect(orderByIdx).toBeGreaterThan(-1);
		const orderClause = sql.slice(orderByIdx);
		const rankPos = orderClause.toLowerCase().indexOf('ts_rank');
		const publishedPos = orderClause.toLowerCase().indexOf('published_at');
		expect(rankPos).toBeGreaterThan(-1);
		expect(publishedPos).toBeGreaterThan(-1);
		expect(rankPos).toBeLessThan(publishedPos);
	});

	it('keeps a stable (published_at, id) tiebreak after rank', async () => {
		await searchPublishedPosts({ query: 'zero knowledge' });
		const orderClause = lastSql().slice(lastSql().toLowerCase().lastIndexOf('order by'));
		const lc = orderClause.toLowerCase();
		expect(lc.indexOf('published_at')).toBeLessThan(lc.lastIndexOf('"id"'));
	});

	it('orders purely by recency when there is no text query', async () => {
		await searchPublishedPosts({});
		const sql = lastSql();
		expect(sql).not.toMatch(/ts_rank\(/i);
		expect(sql.toLowerCase()).toContain('order by');
		expect(sql.toLowerCase()).toContain('published_at');
	});

	it('applies the same rank-first ordering on the tag-filtered branch', async () => {
		await searchPublishedPosts({ query: 'zk', tagSlug: 'cryptography' });
		const sql = lastSql();
		expect(sql).toMatch(/ts_rank\(/i);
		const orderClause = sql.slice(sql.toLowerCase().lastIndexOf('order by')).toLowerCase();
		expect(orderClause.indexOf('ts_rank')).toBeLessThan(orderClause.indexOf('published_at'));
	});
});

describe('searchPublishedPostsPage keyset ordering', () => {
	// The paginated variant must stay recency-keyset (published_at, id) so the
	// cursor predicate matches the ORDER BY. It deliberately does NOT rank by
	// ts_rank (see the caveat in tags.ts).
	it('orders by (published_at, id) and not by ts_rank', async () => {
		await searchPublishedPostsPage({ query: 'zero knowledge', limit: 10 });
		const sql = lastSql();
		const orderClause = sql.slice(sql.toLowerCase().lastIndexOf('order by')).toLowerCase();
		expect(orderClause).toContain('published_at');
		expect(orderClause).not.toContain('ts_rank');
	});
});
