import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';

// Dev-only component showcase. Returns 404 in production builds.
export const load = () => {
	if (!dev) error(404);
};
