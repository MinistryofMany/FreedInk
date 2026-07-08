import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getBlogBySlug } from '$lib/db/blogs';
import { getPostBySlug, listCommentsPage } from '$lib/db/posts';
import { renderMarkdown } from '$lib/server/markdown';
import { parseLimit } from '$lib/pagination';
import { hasCapability } from '$lib/db/members';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const blog = await getBlogBySlug(params.blog);
	if (!blog) throw error(404, 'blog not found');
	const post = await getPostBySlug(blog.id, params.slug);
	if (!post) throw error(404, 'post not found');

	// Whether the signed-in viewer may comment (holds can_comment on this blog).
	// The composer gates on this so a non-member sees "only members can comment"
	// up front instead of building a proof that the server would reject. A guest
	// is never a member.
	const canComment = locals.user
		? await hasCapability(blog.id, locals.user.id, 'comment')
		: false;

	// Comments use a dedicated `commentsCursor` query param so they don't
	// collide with anything else that might land on this URL later.
	const cursor = url.searchParams.get('commentsCursor');
	const limit = parseLimit(url.searchParams.get('commentsLimit'));
	const page = await listCommentsPage(post.version.id, { cursor, limit });

	// Pre-render the post body server-side so anonymous readers don't have
	// to download marked + DOMPurify just to read text. We keep the raw
	// `content` field too in case any downstream wants the source.
	// renderMarkdown sanitizes via isomorphic-dompurify.
	const bodyHtml = renderMarkdown(post.version.content);

	return {
		Blog: { title: blog.title, slug: blog.slug, defaultLanguage: blog.defaultLanguage },
		Post: {
			id: post.post.id,
			versionId: post.version.id,
			title: post.version.title,
			content: post.version.content,
			bodyHtml,
			slug: post.version.slug,
			publishedAt: post.version.publishedAt,
			status: post.post.status,
			language: post.version.language ?? blog.defaultLanguage ?? 'en'
		},
		Comments: page.items,
		commentsNextCursor: page.nextCursor,
		canComment
	};
};
