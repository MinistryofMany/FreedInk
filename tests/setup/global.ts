// Vitest globalSetup: runs once per test run, before any worker boots.
import { ensureMigrated, resetDb } from './db';

export default async function () {
	await ensureMigrated();
	await resetDb();
}
