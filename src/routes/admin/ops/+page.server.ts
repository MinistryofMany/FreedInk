// Operator overview: every blog on the instance (owned or not), each with links
// into its per-blog admin sections. Access is already gated by the parent
// +layout.server.ts (isFreedinkOperator); this load only reads data.
import type { PageServerLoad } from './$types';
import { listBlogs } from '$lib/db/blogs';
import { listReports } from '$lib/db/reports';

export const load: PageServerLoad = async () => {
	const blogs = await listBlogs();
	// Cheap open-report count for the overview badge.
	const openReports = await listReports({ status: 'open', limit: 1 });
	return {
		blogs: blogs.map((b) => ({
			id: b.id,
			slug: b.slug,
			title: b.title,
			description: b.description,
			createdAt: b.createdAt.toISOString()
		})),
		openReportCount: openReports.total
	};
};
