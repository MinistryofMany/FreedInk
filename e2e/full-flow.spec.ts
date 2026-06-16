// Browser-level happy path for the UI, now including real browser-side
// Semaphore proof generation. Local snark artifacts under /snark-artifacts/
// make this fast enough to be reliable.
//
// Sign-in is Minister-only and there's no live IdP here, so we seed the session
// directly (see ./_session) instead of driving an OIDC round-trip. Each authed
// test then starts at /signup/identity — exactly where a first Minister sign-in
// drops a brand-new user — and exercises the real identity + proof flows.
import { test, expect } from '@playwright/test';
import { signInAsNewUser } from './_session';

const STRONG_PASSWORD = 'aVeryStrongPassword12345';

test('signup → identity → blog → manage', async ({ page }) => {
	test.setTimeout(120_000);
	const stamp = Date.now();
	const username = `flow${stamp}`.slice(0, 32);
	await signInAsNewUser(page, { username });

	// 1) Seeded session lands a brand-new user at identity setup.
	await page.goto('/signup/identity');

	// 2) Real Argon2id + AES-GCM in the browser.
	// Labels carry a required-asterisk span, so getByLabel's text match is
	// "Password *" / "Confirm *" — substring (non-exact) keeps these stable.
	await page.getByLabel('Password').fill(STRONG_PASSWORD);
	await page.getByLabel('Confirm').fill(STRONG_PASSWORD);
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

	const stamp = Date.now();
	await signInAsNewUser(page, { username: `post${stamp}`.slice(0, 32) });
	await page.goto('/signup/identity');
	// Labels carry a required-asterisk span, so getByLabel's text match is
	// "Password *" / "Confirm *" — substring (non-exact) keeps these stable.
	await page.getByLabel('Password').fill(STRONG_PASSWORD);
	await page.getByLabel('Confirm').fill(STRONG_PASSWORD);
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
	// The content field is the Tiptap MarkdownEditor (contenteditable), not a
	// labelable form control, so label-based lookup can't reach it.
	await page
		.getByTestId('markdown-editor-surface')
		.locator('[contenteditable="true"]')
		.fill(postBody);
	await page.getByRole('button', { name: /create post/i }).click();

	// Successful submit redirects to /admin.
	await page.waitForURL('**/admin', { timeout: 180_000 });

	// The post is now in the blog's review queue.
	await page.goto(`/admin/b/${blogSlug}/review`);
	await expect(page.getByRole('heading', { name: postTitle })).toBeVisible();
});

test('browser-side vote-to-publish: approve in UI, post appears on public page', async ({
	page
}) => {
	test.setTimeout(300_000);
	page.on('console', (msg) => {
		if (msg.type() === 'error') console.error('[browser]', msg.text());
	});
	page.on('pageerror', (err) => console.error('[browser pageerror]', err));

	const stamp = Date.now();
	await signInAsNewUser(page, { username: `vote${stamp}`.slice(0, 32) });
	await page.goto('/signup/identity');
	// Labels carry a required-asterisk span, so getByLabel's text match is
	// "Password *" / "Confirm *" — substring (non-exact) keeps these stable.
	await page.getByLabel('Password').fill(STRONG_PASSWORD);
	await page.getByLabel('Confirm').fill(STRONG_PASSWORD);
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
	// The content field is the Tiptap MarkdownEditor (contenteditable), not a
	// labelable form control, so label-based lookup can't reach it.
	await page
		.getByTestId('markdown-editor-surface')
		.locator('[contenteditable="true"]')
		.fill(postBody);
	await page.getByRole('button', { name: /create post/i }).click();
	await page.waitForURL('**/admin', { timeout: 180_000 });

	// Owner casts approve. Threshold for a 1-member proving set is
	// ceil(2/3 * 1) = 1, so a single approve auto-publishes.
	await page.goto(`/admin/b/${blogSlug}/review`);
	await expect(page.getByRole('heading', { name: postTitle })).toBeVisible();
	await page
		.getByRole('button', { name: /^approve$/i })
		.first()
		.click();

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
});
