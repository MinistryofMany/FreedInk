// Browser-level happy path for the UI, now including real browser-side
// Semaphore proof generation. Local snark artifacts under /snark-artifacts/
// make this fast enough to be reliable.
import { test, expect } from '@playwright/test';
import { attachVirtualAuthenticator, detachVirtualAuthenticator } from './_utils';

const STRONG_PASSWORD = 'aVeryStrongPassword12345';

function slugify(s: string): string {
	return s
		.toLowerCase()
		.replace(/ /g, '-')
		.replace(/[^a-z0-9-_]/g, '');
}

test('signup → identity → blog → manage', async ({ page }) => {
	test.setTimeout(120_000);
	const { session, authenticatorId } = await attachVirtualAuthenticator(page);
	try {
		const stamp = Date.now();
		const username = `flow${stamp}`.slice(0, 32);

		// 1) Real passkey ceremony.
		await page.goto('/signup');
		await page.getByLabel('Email').fill(`flow${stamp}@example.com`);
		await page.getByLabel('Username').fill(username);
		await page.getByRole('button', { name: /register with passkey/i }).click();
		await page.waitForURL('**/signup/identity', { timeout: 30_000 });

		// 2) Real Argon2id + AES-GCM in the browser.
		await page.getByLabel('Password', { exact: true }).fill(STRONG_PASSWORD);
		await page.getByLabel('Confirm', { exact: true }).fill(STRONG_PASSWORD);
		await page.getByRole('button', { name: /create identity/i }).click();
		await page.waitForURL('**/admin', { timeout: 30_000 });
		await expect(page.getByText(/you don't own any blogs yet/i)).toBeVisible();

		// 3) Create a blog.
		await page.getByRole('link', { name: /create a new blog/i }).click();
		await page.waitForURL('**/admin/new');
		const blogTitle = `Flow Blog ${stamp}`;
		await page.getByLabel('Title').fill(blogTitle);
		await page.getByLabel('Description').fill('A blog created end-to-end');
		await page.getByRole('button', { name: /^create$/i }).click();
		await page.waitForURL(/\/admin\/b\/.+\/manage$/);

		// 4) Manage page reflects ownership.
		await expect(page.getByRole('cell', { name: username })).toBeVisible();
		await expect(page.getByRole('row').filter({ hasText: username })).toContainText('owner');

		// 5) Dashboard "Owned" lists the blog after a fresh load.
		await page.goto('/admin');
		await page.reload();
		await expect(page.getByRole('link', { name: blogTitle }).first()).toBeVisible();
	} finally {
		await detachVirtualAuthenticator(session, authenticatorId);
	}
});

test('public blog page is reachable for a blog with no published posts', async ({ page }) => {
	await page.goto('/b');
	await expect(page.getByRole('heading', { name: /featured blogs/i })).toBeVisible();
});

test('browser-side post creation: real Semaphore proof, post lands in review queue', async ({
	page
}) => {
	test.setTimeout(240_000);
	page.on('console', (msg) => {
		if (msg.type() === 'error') console.error('[browser]', msg.text());
	});
	page.on('pageerror', (err) => console.error('[browser pageerror]', err));
	const { session, authenticatorId } = await attachVirtualAuthenticator(page);
	try {
		const stamp = Date.now();
		await page.goto('/signup');
		await page.getByLabel('Email').fill(`post${stamp}@example.com`);
		await page.getByLabel('Username').fill(`post${stamp}`.slice(0, 32));
		await page.getByRole('button', { name: /register with passkey/i }).click();
		await page.waitForURL('**/signup/identity', { timeout: 30_000 });
		await page.getByLabel('Password', { exact: true }).fill(STRONG_PASSWORD);
		await page.getByLabel('Confirm', { exact: true }).fill(STRONG_PASSWORD);
		await page.getByRole('button', { name: /create identity/i }).click();
		await page.waitForURL('**/admin', { timeout: 30_000 });

		await page.getByRole('link', { name: /create a new blog/i }).click();
		await page.waitForURL('**/admin/new');
		const blogTitle = `Post Blog ${stamp}`;
		await page.getByLabel('Title').fill(blogTitle);
		await page.getByLabel('Description').fill('post-creation flow');
		await page.getByRole('button', { name: /^create$/i }).click();
		await page.waitForURL(/\/admin\/b\/.+\/manage$/);
		const blogSlug = page.url().match(/\/admin\/b\/([^/]+)\/manage/)![1];

		// Write a post. This triggers buildProof in the browser — local snark
		// artifacts served from /snark-artifacts/ make it fast.
		await page.getByRole('link', { name: /write a post/i }).click();
		await page.waitForURL(/\/admin\/b\/.+\/author$/);

		const postTitle = `Post ${stamp}`;
		const postBody = 'The body of a real browser-proven post.';
		await page.getByLabel('Post Title').fill(postTitle);
		await page.getByLabel('Content').fill(postBody);
		await page.getByRole('button', { name: /create post/i }).click();

		// Successful submit redirects to /admin.
		await page.waitForURL('**/admin', { timeout: 180_000 });

		// The post is now in the blog's review queue.
		await page.goto(`/admin/b/${blogSlug}/review`);
		await expect(page.getByRole('heading', { name: postTitle })).toBeVisible();
	} finally {
		await detachVirtualAuthenticator(session, authenticatorId);
	}
});

test('browser-side vote-to-publish: approve in UI, post appears on public page', async ({
	page
}) => {
	test.setTimeout(300_000);
	page.on('console', (msg) => {
		if (msg.type() === 'error') console.error('[browser]', msg.text());
	});
	page.on('pageerror', (err) => console.error('[browser pageerror]', err));
	const { session, authenticatorId } = await attachVirtualAuthenticator(page);
	try {
		const stamp = Date.now();
		await page.goto('/signup');
		await page.getByLabel('Email').fill(`vote${stamp}@example.com`);
		await page.getByLabel('Username').fill(`vote${stamp}`.slice(0, 32));
		await page.getByRole('button', { name: /register with passkey/i }).click();
		await page.waitForURL('**/signup/identity', { timeout: 30_000 });
		await page.getByLabel('Password', { exact: true }).fill(STRONG_PASSWORD);
		await page.getByLabel('Confirm', { exact: true }).fill(STRONG_PASSWORD);
		await page.getByRole('button', { name: /create identity/i }).click();
		await page.waitForURL('**/admin', { timeout: 30_000 });

		await page.getByRole('link', { name: /create a new blog/i }).click();
		await page.waitForURL('**/admin/new');
		const blogTitle = `Vote Blog ${stamp}`;
		await page.getByLabel('Title').fill(blogTitle);
		await page.getByLabel('Description').fill('Voting flow blog');
		await page.getByRole('button', { name: /^create$/i }).click();
		await page.waitForURL(/\/admin\/b\/.+\/manage$/);
		const blogSlug = page.url().match(/\/admin\/b\/([^/]+)\/manage/)![1];

		await page.getByRole('link', { name: /write a post/i }).click();
		await page.waitForURL(/\/admin\/b\/.+\/author$/);
		const postTitle = `Vote Post ${stamp}`;
		const postBody = 'Body to be published.';
		await page.getByLabel('Post Title').fill(postTitle);
		await page.getByLabel('Content').fill(postBody);
		await page.getByRole('button', { name: /create post/i }).click();
		await page.waitForURL('**/admin', { timeout: 180_000 });

		// Owner casts approve. Threshold for a 1-member proving set is
		// ceil(2/3 * 1) = 1, so a single approve auto-publishes.
		await page.goto(`/admin/b/${blogSlug}/review`);
		await expect(page.getByRole('heading', { name: postTitle })).toBeVisible();
		await page.getByRole('button', { name: /^approve$/i }).first().click();

		// After the proof + API round-trip the post leaves the under_review
		// queue (status flips to published).
		await expect(page.getByRole('heading', { name: postTitle })).toBeHidden({
			timeout: 120_000
		});

		// Public page now lists it.
		await page.goto(`/b/${blogSlug}`);
		await expect(page.getByRole('link', { name: postTitle })).toBeVisible();
		await page.getByRole('link', { name: postTitle }).click();
		await expect(page.getByRole('heading', { name: postTitle })).toBeVisible();
		await expect(page.getByText(postBody)).toBeVisible();
	} finally {
		await detachVirtualAuthenticator(session, authenticatorId);
	}
});
