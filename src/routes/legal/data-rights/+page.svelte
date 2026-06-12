<svelte:head>
	<title>Data rights — FreedInk</title>
	<meta
		name="description"
		content="How to access, export, and delete your data on FreedInk under the GDPR and similar laws."
	/>
	<meta property="og:title" content="Data rights — FreedInk" />
	<meta
		property="og:description"
		content="How to access, export, and delete your data on FreedInk."
	/>
	<meta property="og:type" content="article" />
</svelte:head>

<h1>Data rights</h1>

<p>
	FreedInk gives every user direct, programmatic access to the personal data we
	hold about them. You don't need to email us to access or delete your data
	— the tools are built into the product.
</p>

<h2>Download my data (access &amp; portability)</h2>

<p>
	From your <a href="/settings">/settings</a> page, click <strong>"Download my
	data"</strong> in the <em>Data rights</em> section. Or send an authenticated
	<code>POST</code> to <code>/api/gdpr/export</code>.
</p>

<p>The response is a JSON document containing, for the requesting user:</p>

<ul>
	<li>Your <strong>profile row</strong> (username, display name, email,
		created-at, updated-at, email-verified-at).</li>
	<li>Your linked <strong>wallet addresses</strong>.</li>
	<li>Your <strong>passkey credentials</strong> as metadata only (nickname,
		credential id, created-at, last-used-at) — public keys are omitted because
		they are useless to you in isolation and we want to minimize what leaks
		from an export file.</li>
	<li>Your <strong>Semaphore identities</strong> (commitment, public key,
		status, created-at, revoked-at). The encrypted ciphertext is <em>not</em>
		included because you already have it on your devices and we want exports
		to be safe to email or store.</li>
	<li>Your <strong>blog memberships</strong> (blog id, slug, role, added-at,
		removed-at).</li>
	<li>Your <strong>sessions</strong> as metadata (created-at, last-seen-at,
		expires-at, user-agent, IP).</li>
</ul>

<p>
	The file is sent with
	<code>Content-Disposition: attachment</code> so your browser saves it as
	<code>freedink-export-&lt;userid&gt;-&lt;timestamp&gt;.json</code>.
</p>

<h2>Delete my account (erasure)</h2>

<p>
	From your <a href="/settings">/settings</a> page, click <strong>"Delete my
	account"</strong> in the <em>Data rights</em> section. A confirmation modal
	asks you to <strong>type your username</strong> exactly to confirm. Or send
	an authenticated <code>POST</code> to <code>/api/gdpr/delete</code> with body
	<code>{`{"confirm": "<your-username>"}`}</code>.
</p>

<p>Deletion is a cascading <code>DELETE</code> that removes:</p>

<ul>
	<li>Your user row.</li>
	<li>All your <strong>sessions</strong>, so every device is signed out.</li>
	<li>All your <strong>passkey credentials</strong>.</li>
	<li>All your <strong>linked wallets</strong>.</li>
	<li>All your <strong>Semaphore identity blobs</strong> (encrypted vault
		copies).</li>
	<li>All your <strong>blog memberships</strong>. Future proofs you generated
		from these memberships will no longer verify against the most recent
		snapshot, but historical proofs continue to verify against the snapshot
		they were issued under.</li>
</ul>

<h3>What deletion does <em>not</em> remove</h3>

<p>
	<strong>Posts and comments you authored are not deleted.</strong> They were
	submitted with Semaphore proofs that are mathematically unlinkable from
	your account — there is no column anywhere in our database that links a
	post or comment to a user_id. Two consequences:
</p>

<ul>
	<li>We <em>cannot</em> find which posts or comments were yours, even if we
		wanted to.</li>
	<li>If we deleted them somehow, we'd break the verifiability of historical
		votes and comments for everyone else reading the blog.</li>
</ul>

<p>
	If you want a specific post or comment removed, you can ask a member of the
	blog (yourself, while still a member) to delete it through the blog's
	moderation tools.
</p>

<h2>Audit log entries</h2>

<p>
	Audit log entries that reference you as the <em>actor</em> are removed
	indirectly: the foreign-key relationship is set to <code>NULL</code> on
	user deletion, so the events remain in the log (so we can investigate abuse)
	but cannot be linked back to your account. The full audit log is purged on
	a 90-day rolling window.
</p>

<h2>Other rights</h2>

<p>
	For correction, restriction, objection, or any other GDPR / CCPA right not
	covered by the in-app controls, write to
	<a href="mailto:privacy@freed.ink">privacy@freed.ink</a>.
</p>
