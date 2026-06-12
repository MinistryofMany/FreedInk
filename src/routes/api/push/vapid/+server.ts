// Exposes the public half of the server's VAPID key. The browser needs this
// to subscribe; without it, pushManager.subscribe() throws. No auth: the key
// is meant to be public (it's how the push service identifies us). Cached
// for an hour because keys are stable for the life of `data/vapid.json`.
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getOrCreateVapidKeys } from '$lib/server/vapid';

export const GET: RequestHandler = async () => {
	const { publicKey } = getOrCreateVapidKeys();
	return json(
		{ publicKey },
		{
			headers: {
				'cache-control': 'public, max-age=3600'
			}
		}
	);
};
