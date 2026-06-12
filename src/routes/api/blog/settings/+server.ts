// Owner-only blog settings: approval threshold (num/den), description,
// title (+ slug). Validation lives in updateBlogSettings; the route is
// auth + audit + 422-on-zod-fail.
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getBlogById } from '$lib/db/blogs';
import { updateBlogSettings } from '$lib/db/blog-settings';
import { requireRole, ROLES_MANAGING } from '$lib/server/auth';
import { audit } from '$lib/server/audit';

const Body = z.object({
	blog_id: z.string().uuid(),
	approval_numerator: z.number().int().min(1).max(100).optional(),
	approval_denominator: z.number().int().min(1).max(100).optional(),
	description: z.string().max(2000).nullable().optional(),
	title: z.string().min(1).max(300).optional(),
	default_language: z.string().optional()
});

export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	if (!locals.user) throw error(401, 'sign in required');
	const parsed = Body.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);
	const { blog_id, approval_numerator, approval_denominator, description, title, default_language } =
		parsed.data;

	const blog = await getBlogById(blog_id);
	if (!blog) throw error(404, 'blog not found');
	await requireRole(blog_id, locals.user.id, ROLES_MANAGING);

	const updated = await updateBlogSettings(blog_id, {
		approvalNumerator: approval_numerator,
		approvalDenominator: approval_denominator,
		description: description ?? undefined,
		title,
		defaultLanguage: default_language
	});

	const thresholdChanged =
		(approval_numerator !== undefined && approval_numerator !== blog.approvalNumerator) ||
		(approval_denominator !== undefined && approval_denominator !== blog.approvalDenominator);

	if (thresholdChanged) {
		await audit(event, {
			event: 'blog.threshold_changed',
			actorUserId: locals.user.id,
			subjectBlogId: blog_id,
			metadata: {
				previous: { num: blog.approvalNumerator, den: blog.approvalDenominator },
				next: { num: updated.approvalNumerator, den: updated.approvalDenominator }
			}
		});
	}

	return json({
		ok: true,
		blog: {
			id: updated.id,
			slug: updated.slug,
			title: updated.title,
			description: updated.description,
			approval_numerator: updated.approvalNumerator,
			approval_denominator: updated.approvalDenominator,
			default_language: updated.defaultLanguage
		}
	});
};
