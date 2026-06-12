// Integration tests for the blog-settings DB helper. Threshold validation is
// the safety-critical bit — tally.ts trusts whatever we store, so we must not
// let through nonsense like 5/3 or 0/10.
import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { updateBlogSettings } from '$lib/db/blog-settings';
import { makeUser, makeBlogWith } from '../setup/factories';

describe('updateBlogSettings: thresholds', () => {
	it('accepts a valid (num <= den, both >= 1) threshold change', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		const updated = await updateBlogSettings(blogId, {
			approvalNumerator: 1,
			approvalDenominator: 2
		});
		expect(updated.approvalNumerator).toBe(1);
		expect(updated.approvalDenominator).toBe(2);
	});

	it('rejects num > den with 422', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		await expect(
			updateBlogSettings(blogId, { approvalNumerator: 5, approvalDenominator: 3 })
		).rejects.toMatchObject({ status: 422 });
	});

	it('rejects denominator = 0 with 422', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		await expect(
			updateBlogSettings(blogId, { approvalNumerator: 1, approvalDenominator: 0 })
		).rejects.toMatchObject({ status: 422 });
	});

	it('rejects denominator > 100 with 422', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		await expect(
			updateBlogSettings(blogId, { approvalNumerator: 1, approvalDenominator: 101 })
		).rejects.toMatchObject({ status: 422 });
	});

	it('rejects negative numerator with 422', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		await expect(
			updateBlogSettings(blogId, { approvalNumerator: -1, approvalDenominator: 3 })
		).rejects.toMatchObject({ status: 422 });
	});

	it('rejects non-integer thresholds with 422', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		await expect(
			updateBlogSettings(blogId, { approvalNumerator: 1.5, approvalDenominator: 3 })
		).rejects.toMatchObject({ status: 422 });
	});

	it('partial update (only numerator) validates against the existing denominator', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		// Default is 2/3. Try to push numerator to 4 — should fail (4 > 3).
		await expect(updateBlogSettings(blogId, { approvalNumerator: 4 })).rejects.toMatchObject({
			status: 422
		});
	});
});

describe('updateBlogSettings: title + description', () => {
	it('updates description without touching threshold', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		const updated = await updateBlogSettings(blogId, { description: 'hello' });
		expect(updated.description).toBe('hello');
		expect(updated.approvalNumerator).toBe(2);
		expect(updated.approvalDenominator).toBe(3);
	});

	it('updates slug when title changes', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner, title: 'Old Name' });
		const updated = await updateBlogSettings(blogId, { title: 'New Fancy Name' });
		expect(updated.title).toBe('New Fancy Name');
		expect(updated.slug).toBe('new-fancy-name');

		// Confirm the DB row reflects it.
		const fresh = await db.select().from(schema.blogs).where(eq(schema.blogs.id, blogId)).limit(1);
		expect(fresh[0].slug).toBe('new-fancy-name');
	});

	it('rejects empty/whitespace-only title with 422', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		await expect(updateBlogSettings(blogId, { title: '   ' })).rejects.toMatchObject({
			status: 422
		});
	});

	it('throws 404 for an unknown blog', async () => {
		await expect(
			updateBlogSettings('00000000-0000-0000-0000-000000000000', { description: 'x' })
		).rejects.toMatchObject({ status: 404 });
	});

	it('no-op when patch is empty returns the current row unchanged', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner, title: 'Stable' });
		const before = await db.select().from(schema.blogs).where(eq(schema.blogs.id, blogId)).limit(1);
		const after = await updateBlogSettings(blogId, {});
		expect(after.title).toBe(before[0].title);
		expect(after.approvalNumerator).toBe(before[0].approvalNumerator);
	});
});
