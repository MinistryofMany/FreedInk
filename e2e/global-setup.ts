// Reset the test DB before Playwright starts. The webServer is then booted by
// Playwright pointed at the same DATABASE_URL.
import '../tests/setup/load-env';
import { ensureMigrated, resetDb } from '../tests/setup/db';

export default async function () {
	await ensureMigrated();
	await resetDb();
}
