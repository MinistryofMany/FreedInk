// Feature flags admin UI loader. Lists all flags + the operator's own
// overrides + a small user-search action for the overrides form. Writes
// go through ?/createFlag, ?/saveFlag, ?/setOverride, ?/removeOverride
// SvelteKit actions; they all audit `feature_flag.changed`.
import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import {
	createFlag,
	listFlags,
	setFlag,
	setOverride,
	removeOverride,
	listOverridesForUser,
	isValidFlagKey
} from '$lib/server/flags';
import { db, schema } from '$lib/db/client';
import { sql, desc } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
	const flags = await listFlags();
	const myOverrides = locals.user ? await listOverridesForUser(locals.user.id) : [];

	// Provide a small recent-users list so the override picker has
	// something to autocomplete against on first load; the search action
	// can do a full LIKE if the operator types a partial name.
	const recentUsers = await db
		.select({
			id: schema.users.id,
			username: schema.users.username
		})
		.from(schema.users)
		.orderBy(desc(schema.users.createdAt))
		.limit(50);

	return { flags, myOverrides, recentUsers };
};

const CreateFlagBody = z.object({
	key: z.string().min(2).max(64),
	description: z.string().max(500).optional()
});

const SaveFlagBody = z.object({
	key: z.string().min(1),
	enabled: z.string().optional(), // "true" / "false" from form
	rollout_percentage: z.string().optional(),
	description: z.string().max(500).optional()
});

const SetOverrideBody = z.object({
	flag_key: z.string().min(1),
	user_query: z.string().min(1), // username or uuid
	enabled: z.enum(['true', 'false'])
});

const RemoveOverrideBody = z.object({
	flag_key: z.string().min(1),
	user_id: z.string().uuid()
});

function parseBool(v: string | undefined): boolean | undefined {
	if (v === undefined) return undefined;
	if (v === 'true' || v === 'on' || v === '1') return true;
	if (v === 'false' || v === 'off' || v === '0' || v === '') return false;
	return undefined;
}

async function resolveUserByQuery(q: string): Promise<{ id: string } | null> {
	// Accept either a UUID or a username.
	const uuidParsed = z.string().uuid().safeParse(q);
	if (uuidParsed.success) {
		const rows = await db
			.select({ id: schema.users.id })
			.from(schema.users)
			.where(sql`${schema.users.id} = ${uuidParsed.data}`)
			.limit(1);
		return rows[0] ?? null;
	}
	const rows = await db
		.select({ id: schema.users.id })
		.from(schema.users)
		.where(sql`${schema.users.username} = ${q}`)
		.limit(1);
	return rows[0] ?? null;
}

export const actions: Actions = {
	createFlag: async (event) => {
		const form = await event.request.formData();
		const parsed = CreateFlagBody.safeParse({
			key: String(form.get('key') ?? ''),
			description: form.get('description') ? String(form.get('description')) : undefined
		});
		if (!parsed.success) return fail(422, { error: parsed.error.message });
		if (!isValidFlagKey(parsed.data.key)) {
			return fail(422, { error: 'invalid flag key format' });
		}
		try {
			await createFlag(
				parsed.data.key,
				parsed.data.description ?? null,
				event.locals.user?.id ?? null
			);
		} catch (err) {
			const code = (err as { code?: string }).code;
			if (code === '23505') return fail(409, { error: 'flag already exists' });
			throw err;
		}
		return { ok: true };
	},

	saveFlag: async (event) => {
		const form = await event.request.formData();
		const parsed = SaveFlagBody.safeParse({
			key: String(form.get('key') ?? ''),
			enabled: form.get('enabled') !== null ? String(form.get('enabled')) : undefined,
			rollout_percentage:
				form.get('rollout_percentage') !== null
					? String(form.get('rollout_percentage'))
					: undefined,
			description: form.get('description') ? String(form.get('description')) : undefined
		});
		if (!parsed.success) return fail(422, { error: parsed.error.message });

		const rollout = parsed.data.rollout_percentage
			? Number(parsed.data.rollout_percentage)
			: undefined;
		if (rollout !== undefined && (Number.isNaN(rollout) || rollout < 0 || rollout > 100)) {
			return fail(422, { error: 'rollout_percentage must be 0..100' });
		}

		const row = await setFlag(
			parsed.data.key,
			{
				enabled: parseBool(parsed.data.enabled),
				rolloutPercentage: rollout,
				description: parsed.data.description
			},
			event.locals.user?.id ?? null
		);
		if (!row) return fail(404, { error: 'flag not found' });
		return { ok: true };
	},

	setOverride: async (event) => {
		const form = await event.request.formData();
		const parsed = SetOverrideBody.safeParse({
			flag_key: String(form.get('flag_key') ?? ''),
			user_query: String(form.get('user_query') ?? ''),
			enabled: String(form.get('enabled') ?? 'true')
		});
		if (!parsed.success) return fail(422, { error: parsed.error.message });

		const user = await resolveUserByQuery(parsed.data.user_query);
		if (!user) return fail(404, { error: 'user not found' });

		await setOverride(
			parsed.data.flag_key,
			user.id,
			parsed.data.enabled === 'true',
			event.locals.user?.id ?? null
		);
		return { ok: true };
	},

	removeOverride: async (event) => {
		const form = await event.request.formData();
		const parsed = RemoveOverrideBody.safeParse({
			flag_key: String(form.get('flag_key') ?? ''),
			user_id: String(form.get('user_id') ?? '')
		});
		if (!parsed.success) return fail(422, { error: parsed.error.message });

		await removeOverride(parsed.data.flag_key, parsed.data.user_id, event.locals.user?.id ?? null);
		return { ok: true };
	}
};
