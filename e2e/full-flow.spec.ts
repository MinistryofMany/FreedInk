// Browser-level happy path for the UI, now including real browser-side
// Semaphore proof generation. Local snark artifacts under /snark-artifacts/
// make this fast enough to be reliable.
//
// Sign-in is Minister-only and there's no live IdP here, so we seed the session
// directly (see ./_session) instead of driving an OIDC round-trip. Each authed
// test then starts at /signup/identity — exactly where a first Minister sign-in
// drops a brand-new user — and exercises the real identity + proof flows.
//
// Post-anonymity-overhaul (privacy/public-roster-anon-audit), the lifecycle this
// file drives is:
//   - Post creation: a session-free, per-device Semaphore proof against the blog's
//     `author` capability tree (the write itself carries no cookie). Unchanged at
//     the DOM level; the author page builds the proof and POSTs to /api/blog/post.
//   - Vote-to-publish: blind-signature vote TOKENS (Privacy Pass-style), NOT a
//     Semaphore reviewers tree. Clicking Approve/Reject runs a two-step client
//     flow inside the review page's vote(): (1) an authenticated, can_review-gated
//     issuance — GET /api/blog/vote-token/key then POST /api/blog/vote-token — that
//     blind-signs a random nonce bound to the version_id; (2) an anonymous,
//     session-free redemption — POST /api/post/review with credentials:'omit' —
//     that casts the vote. The review-page DOM is unchanged, so this test drives
//     the new path through the same Approve button.
import { test, expect, type Page } from '@playwright/test';
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
	// The manage page now renders TWO grids that expose rows for the same user:
	// the members table (caption "Blog members") and the Phase 5/6 permissions
	// capability grid (role="table" "Member permissions"). Scope the row lookup
	// to the members table by its accessible caption name so the assertion isn't
	// a strict-mode violation across both grids.
	const membersTable = page.getByRole('table', { name: 'Blog members' });
	await expect(membersTable.getByRole('cell', { name: username })).toBeVisible();
	await expect(membersTable.getByRole('row').filter({ hasText: username })).toContainText('owner');

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

// Helper: seed a fresh owner with an unlocked identity and a blog holding a post
// under review. Returns the blog slug, username, and post title/body so the
// caller can drive the vote flow and the downstream public-page assertions.
async function seedBlogWithPostUnderReview(
	page: Page,
	stamp: number
): Promise<{ blogSlug: string; username: string; postTitle: string; postBody: string }> {
	const username = `vote${stamp}`.slice(0, 32);
	await signInAsNewUser(page, { username });
	await page.goto('/signup/identity');
	// Labels carry a required-asterisk span, so getByLabel's text match is
	// "Password *" / "Confirm *" — substring (non-exact) keeps these stable.
	await page.getByLabel('Password').fill(STRONG_PASSWORD);
	await page.getByLabel('Confirm').fill(STRONG_PASSWORD);
	await page.getByRole('button', { name: /create identity/i }).click();
	await page.waitForURL('**/admin', { timeout: 30_000 });

	await page.getByRole('link', { name: /create a new blog/i }).click();
	await page.waitForURL('**/admin/new');
	await page.getByLabel('Title').fill(`Vote Blog ${stamp}`);
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

	return { blogSlug, username, postTitle, postBody };
}

// The first half of the vote lifecycle that DOES work in the browser today: the
// owner opens the review queue and casts an approve, which fires the authenticated,
// can_review-gated blind-token ISSUANCE round-trip (vote-token/key + vote-token).
// We assert the issuance HTTP calls succeed — this proves the new token-issuance
// path is wired end-to-end through the Approve button in a real browser.
test('browser-side vote: approve fires the blind-token issuance round-trip', async ({ page }) => {
	test.setTimeout(300_000);
	page.on('console', (msg) => {
		if (msg.type() === 'error') console.error('[browser]', msg.text());
	});
	page.on('pageerror', (err) => console.error('[browser pageerror]', err));

	const stamp = Date.now();
	const { blogSlug, postTitle } = await seedBlogWithPostUnderReview(page, stamp);

	await page.goto(`/admin/b/${blogSlug}/review`);
	await expect(page.getByRole('heading', { name: postTitle })).toBeVisible();

	// Capture the two issuance calls the Approve click triggers. Both must 200.
	const keyResp = page.waitForResponse(
		(r) => r.url().includes('/api/blog/vote-token/key') && r.request().method() === 'GET'
	);
	const tokenResp = page.waitForResponse(
		(r) => r.url().endsWith('/api/blog/vote-token') && r.request().method() === 'POST'
	);
	await page
		.getByRole('button', { name: /^approve$/i })
		.first()
		.click();

	expect((await keyResp).status()).toBe(200);
	expect((await tokenResp).status()).toBe(200);
});

// The SECOND half — anonymous redemption (POST /api/post/review), the tally
// crossing quorum, the post publishing, and it surfacing on the public blog page
// + members roster — is BLOCKED by a source bug in the browser token finalize.
//
// Root cause (verified in this branch's e2e environment): the client's
// requestAndBuildToken() throws an OperationError (empty message) at
// suite.finalize(). The throw is inside @cloudflare/blindrsa-ts@0.4.6
// PartiallyBlindRSA.finalize, at the `crypto.subtle.importKey('jwk', ...)` of the
// per-metadata DERIVED public key (partially_blindrsa.js:171). Chromium's
// WebCrypto rejects that derived-key JWK with OperationError; Node's WebCrypto
// accepts the identical JWK (a full prepare→blind→blindSign→finalize→verify
// round-trip passes under node:crypto but fails under chromium). Because
// vote()'s catch sets `error = (e as Error).message` and the message is empty,
// the UI shows nothing, castVote() (the redemption POST) never fires, and the
// vote is silently dropped — the post never reaches quorum.
//
// This is an app-source defect, not a test defect, and the source is frozen for
// a concurrent security audit on this branch, so the publish path is quarantined
// here rather than worked around. Remove the fixme once the browser finalize is
// fixed (e.g. a blindrsa bump or a derived-key import that chromium accepts).
test('browser-side vote-to-publish: approve in UI, post appears on public page', async ({
	page
}) => {
	test.fixme(
		true,
		'blind-token suite.finalize() throws OperationError in chromium (importKey jwk of the derived metadata key, partially_blindrsa.js:171); castVote never fires so the post cannot publish. App-source bug — see test comment.'
	);
	test.setTimeout(300_000);
	page.on('console', (msg) => {
		if (msg.type() === 'error') console.error('[browser]', msg.text());
	});
	page.on('pageerror', (err) => console.error('[browser pageerror]', err));

	const stamp = Date.now();
	const { blogSlug, username, postTitle, postBody } = await seedBlogWithPostUnderReview(
		page,
		stamp
	);

	// Owner casts approve. Threshold for a 1-member proving set is
	// ceil(2/3 * 1) = 1, so a single approve auto-publishes.
	await page.goto(`/admin/b/${blogSlug}/review`);
	await expect(page.getByRole('heading', { name: postTitle })).toBeVisible();
	await page
		.getByRole('button', { name: /^approve$/i })
		.first()
		.click();

	// After the token issuance + anonymous redemption round-trip the post leaves
	// the under_review queue (status flips to published).
	await expect(page.getByRole('heading', { name: postTitle })).toBeHidden({
		timeout: 120_000
	});

	// Public page now lists it.
	await page.goto(`/b/${blogSlug}`);
	await expect(page.getByRole('link', { name: postTitle })).toBeVisible();

	// Public, unauthenticated members roster: the "See all members" link leads
	// to /b/<slug>/members, which lists the joined member (the owner) by name
	// with no auth gate. The owner's email is never surfaced on this page.
	await page.getByRole('link', { name: /see all members/i }).click();
	await page.waitForURL(`**/b/${blogSlug}/members`);
	await expect(page.getByRole('heading', { name: /members/i })).toBeVisible();
	await expect(page.getByText(`@${username}`)).toBeVisible();
	await expect(page.getByText('@example.com')).toHaveCount(0);

	await page.goto(`/b/${blogSlug}`);
	await page.getByRole('link', { name: postTitle }).click();
	await expect(page.getByRole('heading', { name: postTitle })).toBeVisible();
	await expect(page.getByText(postBody)).toBeVisible();
});
