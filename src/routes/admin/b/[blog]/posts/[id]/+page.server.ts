// Admin post detail / moderation page. Owner+editor only. Shows every version
// of a post (including soft-deleted ones), the comments thread, and exposes
// hide/restore actions for both posts and comments via form actions that POST
// to the JSON moderation endpoints.
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getBlogBySlug } from '$lib/db/blogs';
import { hasRole } from '$lib/server/auth';
import { db, schema } from '$lib/db/client';
import { desc, eq } from 'drizzle-orm';
import {
	softDeletePostVersion,
	restorePostVersion,
	softDeleteComment,
	restoreComment
} from '$lib/db/moderation';
import { audit } from '$lib/server/audit';

const MODERATING = ['owner', 'editor'] as const;

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) throw redirect(303, '/signup');
	const blog = await getBlogBySlug(params.blog);
	if (!blog) throw error(404, 'blog not found');
	if (!(await hasRole(blog.id, locals.user.id, MODERATING))) throw redirect(303, '/admin');

	const postRows = await db
		.select()
		.from(schema.blogPosts)
		.where(eq(schema.blogPosts.id, params.id))
		.limit(1);
	const post = postRows[0];
	if (!post) throw error(404, 'post not found');
	if (post.blogId !== blog.id) throw error(404, 'post not in this blog');

	const versions = await db
		.select()
		.from(schema.blogPostVersions)
		.where(eq(schema.blogPostVersions.postId, post.id))
		.orderBy(desc(schema.blogPostVersions.createdAt));

	const currentVersionId = post.currentVersionId;
	const comments = currentVersionId
		? await db
				.select()
				.from(schema.postComments)
				.where(eq(schema.postComments.postVersionId, currentVersionId))
				.orderBy(desc(schema.postComments.createdAt))
		: [];

	return {
		blog: { id: blog.id, slug: blog.slug, title: blog.title },
		post: {
			id: post.id,
			status: post.status,
			currentVersionId: post.currentVersionId,
			createdAt: post.createdAt
		},
		versions: versions.map((v) => ({
			id: v.id,
			version: v.version,
			title: v.title,
			content: v.content,
			slug: v.slug,
			status: v.status,
			deletedAt: v.deletedAt,
			publishedAt: v.publishedAt,
			createdAt: v.createdAt
		})),
		comments: comments.map((c) => ({
			id: c.id,
			body: c.body,
			deletedAt: c.deletedAt,
			createdAt: c.createdAt
		}))
	};
};

async function ensureModerator(event: Parameters<Actions[keyof Actions]>[0], blogSlug: string) {
	if (!event.locals.user) throw redirect(303, '/signup');
	const blog = await getBlogBySlug(blogSlug);
	if (!blog) throw error(404, 'blog not found');
	if (!(await hasRole(blog.id, event.locals.user.id, MODERATING))) throw redirect(303, '/admin');
	return blog;
}

export const actions: Actions = {
	hide_post: async (event) => {
		const blog = await ensureModerator(event, event.params.blog!);
		const form = await event.request.formData();
		const versionId = String(form.get('version_id') ?? '');
		if (!versionId) return fail(422, { error: 'version_id required' });
		await softDeletePostVersion(versionId);
		await audit(event, {
			event: 'post.deleted',
			actorUserId: event.locals.user!.id,
			subjectBlogId: blog.id,
			metadata: { post_id: event.params.id, version_id: versionId }
		});
		return { ok: true };
	},
	restore_post: async (event) => {
		const blog = await ensureModerator(event, event.params.blog!);
		const form = await event.request.formData();
		const versionId = String(form.get('version_id') ?? '');
		if (!versionId) return fail(422, { error: 'version_id required' });
		await restorePostVersion(versionId);
		await audit(event, {
			event: 'post.restored',
			actorUserId: event.locals.user!.id,
			subjectBlogId: blog.id,
			metadata: { post_id: event.params.id, version_id: versionId }
		});
		return { ok: true };
	},
	hide_comment: async (event) => {
		const blog = await ensureModerator(event, event.params.blog!);
		const form = await event.request.formData();
		const commentId = String(form.get('comment_id') ?? '');
		if (!commentId) return fail(422, { error: 'comment_id required' });
		await softDeleteComment(commentId);
		await audit(event, {
			event: 'comment.deleted',
			actorUserId: event.locals.user!.id,
			subjectBlogId: blog.id,
			metadata: { post_id: event.params.id, comment_id: commentId }
		});
		return { ok: true };
	},
	restore_comment: async (event) => {
		const blog = await ensureModerator(event, event.params.blog!);
		const form = await event.request.formData();
		const commentId = String(form.get('comment_id') ?? '');
		if (!commentId) return fail(422, { error: 'comment_id required' });
		await restoreComment(commentId);
		await audit(event, {
			event: 'comment.deleted',
			actorUserId: event.locals.user!.id,
			subjectBlogId: blog.id,
			metadata: { post_id: event.params.id, comment_id: commentId, restored: true }
		});
		return { ok: true };
	}
};
