// Paginated audit-log viewer. Cursorless offset pagination is fine here —
// volumes are small, the operator dashboard is rare-use, and cursor pagination
// over a monotonic created_at would mostly add code without a real benefit.
import type { PageServerLoad } from './$types';
import { db, schema } from '$lib/db/client';
import { desc, sql } from 'drizzle-orm';

const PAGE_SIZE = 50;

export const load: PageServerLoad = async ({ url }) => {
	const pageParam = Number(url.searchParams.get('page') ?? '1');
	const page = Number.isFinite(pageParam) && pageParam >= 1 ? Math.floor(pageParam) : 1;
	const offset = (page - 1) * PAGE_SIZE;

	const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.auditLog);
	const totalPages = Math.max(1, Math.ceil((count?.n ?? 0) / PAGE_SIZE));

	const rows = await db
		.select()
		.from(schema.auditLog)
		.orderBy(desc(schema.auditLog.createdAt))
		.limit(PAGE_SIZE)
		.offset(offset);

	return {
		entries: rows,
		page,
		totalPages,
		total: count?.n ?? 0
	};
};
