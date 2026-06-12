// Per-file integration test setup: reset DB before every test.
import { beforeEach } from 'vitest';
import { resetDb } from './db';

beforeEach(async () => {
	await resetDb();
});
