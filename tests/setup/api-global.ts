import { ensureMigrated, resetDb } from './db';
import { startServer, stopServer } from './server';

export default async function () {
	await ensureMigrated();
	await resetDb();
	await startServer();
	return async () => {
		await stopServer();
	};
}
