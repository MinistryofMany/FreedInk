// Minimal email shim. If SMTP_URL is unset, falls back to console logging
// so dev flows still work end-to-end. Swap in nodemailer / Resend when ready.
import { env } from '$env/dynamic/private';

export type Mail = {
	to: string;
	subject: string;
	text: string;
	html?: string;
};

export async function sendMail(mail: Mail): Promise<void> {
	if (!env.SMTP_URL) {
		console.info(
			'[email] (no SMTP_URL configured, logging instead)',
			JSON.stringify({ to: mail.to, subject: mail.subject, text: mail.text }, null, 2)
		);
		return;
	}
	// Lazy-import nodemailer only when needed so it stays out of the dev bundle
	// for users who never configure SMTP. (@types/nodemailer is installed so
	// the import is typed; no @ts-expect-error needed.)
	const { default: nodemailer } = await import('nodemailer');
	const transport = nodemailer.createTransport(env.SMTP_URL);
	await transport.sendMail({
		from: env.SMTP_FROM ?? 'noreply@freed.ink',
		to: mail.to,
		subject: mail.subject,
		text: mail.text,
		html: mail.html
	});
}
