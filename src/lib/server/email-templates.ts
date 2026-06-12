// Email rendering helpers. Each function returns {subject, text, html}; the
// text part is the primary one (better deliverability + accessible), html is a
// lightly styled mirror for clients that prefer it.

export type InviteEmailParams = {
	inviterUsername: string;
	blogTitle: string;
	role: string;
	acceptUrl: string;
	expiresAt: Date;
};

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function fmtDate(d: Date): string {
	// ISO with seconds stripped — readable but unambiguous across locales.
	return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function renderInviteEmail(params: InviteEmailParams): {
	subject: string;
	text: string;
	html: string;
} {
	const subject = `${params.inviterUsername} invited you to ${params.blogTitle} on Freed.Ink`;
	const expires = fmtDate(params.expiresAt);

	const text =
		`${params.inviterUsername} invited you to join "${params.blogTitle}" as a ${params.role}.\n\n` +
		`Accept the invitation:\n${params.acceptUrl}\n\n` +
		`The link expires on ${expires}.\n\n` +
		`If you don't have a Freed.Ink account yet, the link will let you sign up first ` +
		`and add you to the blog automatically once you finish.\n\n` +
		`If you don't recognize this invitation, just ignore the email — the token ` +
		`expires automatically and no account is created without your action.\n`;

	const html = `<!DOCTYPE html>
<html lang="en">
	<body style="margin:0;padding:24px;background:#f4f7f1;font-family:system-ui,sans-serif;color:#1d2a1d;">
		<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #d4e2c9;border-radius:6px;padding:24px;">
			<tr><td>
				<h1 style="font-size:1.25rem;margin:0 0 1rem 0;">You're invited to <em>${escapeHtml(params.blogTitle)}</em></h1>
				<p style="margin:0 0 1rem 0;line-height:1.5;">
					<strong>${escapeHtml(params.inviterUsername)}</strong> invited you to join
					<strong>${escapeHtml(params.blogTitle)}</strong> as a
					<strong>${escapeHtml(params.role)}</strong>.
				</p>
				<p style="margin:0 0 1.5rem 0;">
					<a href="${escapeHtml(params.acceptUrl)}"
					   style="display:inline-block;padding:0.6rem 1.1rem;background:#3f6f3f;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:600;">
						Accept invitation
					</a>
				</p>
				<p style="margin:0 0 0.5rem 0;font-size:0.875rem;color:#54635a;">
					The link expires on ${escapeHtml(expires)}.
				</p>
				<p style="margin:0 0 0.5rem 0;font-size:0.875rem;color:#54635a;">
					If you don't already have a Freed.Ink account, the link will let you
					sign up first and then add you to the blog automatically.
				</p>
				<p style="margin:1rem 0 0 0;font-size:0.75rem;color:#7d8b81;word-break:break-all;">
					Or paste this URL into your browser: ${escapeHtml(params.acceptUrl)}
				</p>
			</td></tr>
		</table>
	</body>
</html>
`;
	return { subject, text, html };
}
