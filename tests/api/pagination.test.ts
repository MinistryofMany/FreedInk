// Black-box API coverage for the cursor pagination on the public listings.
// We hit the rendered SvelteKit pages and parse the cursor out of the
// `<input type="hidden" name="cursor" value="...">` that the "Load more"
// form emits — that's the contract a real browser sees, with or without JS.
import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { api } from './helpers';
import { makeUser, makeBlogWith } from '../setup/factories';
import { createPost, setPostStatus } from '$lib/db/posts';

const rid = () => Math.random().toString(36).slice(2, 8);

/**
 * Pull the `value` attribute of `<input ... name="cursor">` (or any other
 * named hidden input) out of an HTML string. SvelteKit produces simple,
 * predictable markup for hidden inputs — a regex is sufficient and avoids
 * pulling in a DOM parser dependency.
 */
function extractCursor(html: string, name = 'cursor'): string | null {
	// Inputs may be self-closing or not; attribute order may vary.
	const re = new RegExp(
		`<input[^>]*name="${name}"[^>]*value="([^"]*)"|<input[^>]*value="([^"]*)"[^>]*name="${name}"`,
		'i'
	);
	const m = html.match(re);
	return m ? (m[1] ?? m[2] ?? null) : null;
}

async function fetchPage(path: string, extraParams: Record<string, string> = {}, cursor?: string) {
	const params = new URLSearchParams(extraParams);
	if (cursor) params.set('cursor', cursor);
	const url = params.toString() ? `${path}?${params.toString()}` : path;
	const res = await api(url);
	expect(res.status).toBe(200);
	return res.text();
}

async function walk(
	path: string,
	extraParams: Record<string, string>,
	cursorName = 'cursor'
): Promise<string[]> {
	const cursors: string[] = [];
	let cursor: string | undefined = undefined;
	let safety = 0;
	for (;;) {
		const html = await fetchPage(path, extraParams, cursor);
		const next = extractCursor(html, cursorName);
		cursors.push(cursor ?? '');
		if (!next) break;
		cursor = next;
		safety++;
		if (safety > 30) throw new Error('pagination did not terminate');
	}
	return cursors;
}

describe('GET /b?limit=5 cursor chain', () => {
	it('paginates blogs with a follow-able cursor', async () => {
		// Seed 12 blogs. Direct DB insert avoids snapshot/identity work and
		// keeps the test fast.
		const slugBase = `pg-${rid()}`;
		for (let i = 0; i < 12; i++) {
			await db.insert(schema.blogs).values({
				title: `${slugBase}-blog-${i.toString().padStart(2, '0')}`,
				slug: `${slugBase}-blog-${i.toString().padStart(2, '0')}`,
				description: null
			});
		}

		// Walk the chain. We expect at least: page 1 (no cursor) + page 2 (cursor)
		// at limit=5 with 12 rows total.
		const html1 = await fetchPage('/b', { limit: '5' });
		const cursor1 = extractCursor(html1);
		expect(cursor1).not.toBeNull();

		const html2 = await fetchPage('/b', { limit: '5' }, cursor1!);
		// At limit=5, after page 1 (5 rows) and page 2 (5 rows) there are 2
		// remaining — page 3 must NOT have a "Load more" form.
		const cursor2 = extractCursor(html2);
		expect(cursor2).not.toBeNull();

		const html3 = await fetchPage('/b', { limit: '5' }, cursor2!);
		expect(extractCursor(html3)).toBeNull();

		// Cleanup so this test doesn't leak into other API tests.
		for (let i = 0; i < 12; i++) {
			await db
				.delete(schema.blogs)
				.where(eq(schema.blogs.slug, `${slugBase}-blog-${i.toString().padStart(2, '0')}`));
		}
	});

	it('treats a malformed cursor as start-from-top', async () => {
		const res = await api('/b?cursor=!!!not-a-cursor!!!');
		expect(res.status).toBe(200);
		// Body should still render the page (no 500).
		const html = await res.text();
		expect(html).toContain('Featured Blogs');
	});
});

describe('GET /b/<slug>?limit=5 cursor chain (published posts)', () => {
	it('paginates published posts in one blog', async () => {
		const owner = await makeUser({ username: `pgo-${rid()}` });
		const { id: blogId, slug: blogSlug } = await makeBlogWith({
			owner,
			title: `pagination-posts-${rid()}`
		});
		for (let i = 0; i < 11; i++) {
			const r = await createPost({
				blogId,
				title: `published-${i.toString().padStart(2, '0')}-${rid()}`,
				content: 'body',
				proof: {},
				snapshotRoot: 'r',
				nullifier: `n-${i}-${rid()}`,
				status: 'under_review'
			});
			await setPostStatus(r.post.id, r.version.id, 'published');
		}

		const html1 = await fetchPage(`/b/${blogSlug}`, { limit: '5' });
		const cursor1 = extractCursor(html1);
		expect(cursor1).not.toBeNull();

		const html2 = await fetchPage(`/b/${blogSlug}`, { limit: '5' }, cursor1!);
		const cursor2 = extractCursor(html2);
		expect(cursor2).not.toBeNull();

		const html3 = await fetchPage(`/b/${blogSlug}`, { limit: '5' }, cursor2!);
		expect(extractCursor(html3)).toBeNull();
	});
});

describe('GET /search cursor chain', () => {
	it('paginates full-text search results with a follow-able cursor', async () => {
		const owner = await makeUser({ username: `pgs-${rid()}` });
		const { id: blogId } = await makeBlogWith({
			owner,
			title: `search-pg-${rid()}`
		});
		// "ZQXKEYWORD" is unique enough not to collide with other tests' content.
		const keyword = `zqxkeyword${rid()}`;
		for (let i = 0; i < 9; i++) {
			const r = await createPost({
				blogId,
				title: `search-post-${i}-${rid()}`,
				content: `${keyword} discussion content body`,
				proof: {},
				snapshotRoot: 'r',
				nullifier: `s-${i}-${rid()}`,
				status: 'under_review'
			});
			await setPostStatus(r.post.id, r.version.id, 'published');
		}

		const html1 = await fetchPage('/search', { q: keyword, limit: '4' });
		const cursor1 = extractCursor(html1);
		expect(cursor1).not.toBeNull();

		const html2 = await fetchPage('/search', { q: keyword, limit: '4' }, cursor1!);
		const cursor2 = extractCursor(html2);
		expect(cursor2).not.toBeNull();

		// 9 rows at limit=4 = pages of 4, 4, 1. Third page has no cursor.
		const html3 = await fetchPage('/search', { q: keyword, limit: '4' }, cursor2!);
		expect(extractCursor(html3)).toBeNull();
	});

	it('renders the search page without results when q is empty', async () => {
		const res = await api('/search');
		expect(res.status).toBe(200);
	});
});

describe('cursor opacity', () => {
	it('cursor tokens do not leak underlying field values', async () => {
		const slugBase = `op-${rid()}`;
		for (let i = 0; i < 3; i++) {
			await db.insert(schema.blogs).values({
				title: `${slugBase}-${i}`,
				slug: `${slugBase}-${i}`,
				description: null
			});
		}
		const html = await fetchPage('/b', { limit: '1' });
		const cursor = extractCursor(html);
		expect(cursor).not.toBeNull();
		// Cursor is base64url JSON; the inner JSON keys are `key` / `id`.
		// Decoded, they contain a timestamp and a UUID — neither of which
		// should appear in the URL-safe encoded form.
		expect(cursor!).not.toContain(slugBase);
		// base64url alphabet only.
		expect(cursor!).toMatch(/^[A-Za-z0-9_-]+$/);
	});
});
