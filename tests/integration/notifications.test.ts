// Notification module:
//   1. With no SMTP_URL, sendMail just logs — calling notify* must not throw.
//   2. The previewNew* helpers compute the right recipient list:
//        • reviewers: owner/editor/reviewer with verified email
//        • published: every active member with verified email
//      Users without a verified email are excluded from both lists.
import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { makeUser, makeBlogWith } from '../setup/factories';
import { createPost, setPostStatus } from '$lib/db/posts';
import {
	notifyMembersOfNewPublishedPost,
	notifyReviewersOfNewSubmission,
	previewNewPublishedPost,
	previewNewSubmission
} from '$lib/server/notifications';

async function verifyEmail(userId: string) {
	await db
		.update(schema.users)
		.set({ emailVerifiedAt: new Date() })
		.where(eq(schema.users.id, userId));
}

describe('notifications: smoke', () => {
	it('does not throw when SMTP_URL is unset (logs instead)', async () => {
		const owner = await makeUser({ username: 'no-smtp-owner' });
		await verifyEmail(owner.id);
		const { id: blogId } = await makeBlogWith({ owner });
		const r = await createPost({
			blogId,
			title: 't',
			content: 'c',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'n',
			status: 'under_review'
		});

		// SMTP_URL is unset in .env.test → sendMail is the logging shim.
		await expect(notifyReviewersOfNewSubmission(blogId, r.version.id)).resolves.toBeUndefined();

		await setPostStatus(r.post.id, r.version.id, 'published');
		await expect(
			notifyMembersOfNewPublishedPost(blogId, r.version.id)
		).resolves.toBeUndefined();
	});
});

describe('notifications: recipient list', () => {
	it('reviewer notifications include owner/editor/reviewer with verified email only', async () => {
		const owner = await makeUser({ username: 'owr', email: 'owr@x.com' });
		const editor = await makeUser({ username: 'edr', email: 'edr@x.com' });
		const reviewer = await makeUser({ username: 'rvw', email: 'rvw@x.com' });
		const author = await makeUser({ username: 'auth', email: 'auth@x.com' });
		const commenter = await makeUser({ username: 'comm', email: 'comm@x.com' });
		const unverified = await makeUser({ username: 'unv', email: 'unv@x.com' });

		// Verify everyone except `unverified`.
		await verifyEmail(owner.id);
		await verifyEmail(editor.id);
		await verifyEmail(reviewer.id);
		await verifyEmail(author.id);
		await verifyEmail(commenter.id);

		const { id: blogId } = await makeBlogWith({
			owner,
			members: [
				{ user: editor, role: 'editor' },
				{ user: reviewer, role: 'reviewer' },
				{ user: author, role: 'author' },
				{ user: commenter, role: 'commenter' },
				{ user: unverified, role: 'reviewer' }
			]
		});
		const r = await createPost({
			blogId,
			title: 'recip',
			content: 'c',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'nn',
			status: 'under_review'
		});

		const { recipients } = await previewNewSubmission(blogId, r.version.id);
		const ids = recipients.map((r) => r.id).sort();
		expect(ids).toEqual([owner.id, editor.id, reviewer.id].sort());
	});

	it('published-post notifications include every active member with verified email', async () => {
		const owner = await makeUser({ username: 'po', email: 'po@x.com' });
		const editor = await makeUser({ username: 'pe', email: 'pe@x.com' });
		const reviewer = await makeUser({ username: 'pr', email: 'pr@x.com' });
		const author = await makeUser({ username: 'pa', email: 'pa@x.com' });
		const commenter = await makeUser({ username: 'pc', email: 'pc@x.com' });
		const unverified = await makeUser({ username: 'pu', email: 'pu@x.com' });

		await verifyEmail(owner.id);
		await verifyEmail(editor.id);
		await verifyEmail(reviewer.id);
		await verifyEmail(author.id);
		await verifyEmail(commenter.id);
		// unverified deliberately skipped

		const { id: blogId } = await makeBlogWith({
			owner,
			members: [
				{ user: editor, role: 'editor' },
				{ user: reviewer, role: 'reviewer' },
				{ user: author, role: 'author' },
				{ user: commenter, role: 'commenter' },
				{ user: unverified, role: 'commenter' }
			]
		});
		const r = await createPost({
			blogId,
			title: 'pub',
			content: 'c',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'pp',
			status: 'under_review'
		});
		await setPostStatus(r.post.id, r.version.id, 'published');

		const { recipients } = await previewNewPublishedPost(blogId, r.version.id);
		const ids = recipients.map((r) => r.id).sort();
		expect(ids).toEqual([owner.id, editor.id, reviewer.id, author.id, commenter.id].sort());
		expect(ids).not.toContain(unverified.id);
	});

	it('excludes members with no email or no email_verified_at', async () => {
		const owner = await makeUser({ username: 'nox', email: 'nox@x.com' });
		const noEmail = await makeUser({ username: 'noEmail' });
		// Strip the email entirely.
		await db
			.update(schema.users)
			.set({ email: null })
			.where(eq(schema.users.id, noEmail.id));
		const unverified = await makeUser({ username: 'unv2', email: 'unv2@x.com' });
		// owner verified; others not
		await verifyEmail(owner.id);

		const { id: blogId } = await makeBlogWith({
			owner,
			members: [
				{ user: noEmail, role: 'reviewer' },
				{ user: unverified, role: 'reviewer' }
			]
		});
		const r = await createPost({
			blogId,
			title: 'x',
			content: 'c',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'x',
			status: 'under_review'
		});
		const { recipients } = await previewNewSubmission(blogId, r.version.id);
		expect(recipients.map((r) => r.id)).toEqual([owner.id]);
	});
});
