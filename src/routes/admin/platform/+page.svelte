<script lang="ts">
	import { Table, Card, Kicker } from '$lib/components/ui';

	export let data;
	$: ({ stats, sparklines, audit, eventFilter, eventTypes, operator } = data);

	// Pure SVG sparkline — no chart lib. We render a polyline on a fixed
	// 100x30 viewBox; the parent constrains visible size via CSS. Empty/zero
	// series collapse to a flat line at the bottom.
	function polylinePoints(series: Array<{ count: number }>): string {
		if (series.length === 0) return '';
		const max = Math.max(1, ...series.map((d) => d.count));
		const stepX = series.length === 1 ? 0 : 100 / (series.length - 1);
		return series
			.map((d, i) => {
				const x = (i * stepX).toFixed(2);
				const y = (30 - (d.count / max) * 28 - 1).toFixed(2);
				return `${x},${y}`;
			})
			.join(' ');
	}

	function seriesTotal(series: Array<{ count: number }>): number {
		return series.reduce((sum, d) => sum + d.count, 0);
	}

	function submitOwnForm(e: Event) {
		const target = e.currentTarget as HTMLSelectElement;
		target.form?.submit();
	}

	const auditColumns = [
		{ key: 'when', label: 'When' },
		{ key: 'event', label: 'Event' },
		{ key: 'actor', label: 'Actor' },
		{ key: 'subject', label: 'Subject blog' }
	];
</script>

<svelte:head>
	<title>Platform admin</title>
</svelte:head>

<div class="page-header">
	<div class="page-header__meta">
		<Kicker>Platform operator</Kicker>
		<h2 class="page-title">Dashboard</h2>
		<p class="operator-line">
			Signed in as <code>{operator.username}</code>
		</p>
	</div>
</div>

<section class="stats" aria-label="Platform overview">
	<a class="stat-card" href="/admin/platform/users">
		<Card padding="sm">
			<div class="stat-inner">
				<span class="stat-label">Users</span>
				<span class="stat-num">{stats.users}</span>
			</div>
		</Card>
	</a>
	<a class="stat-card" href="/admin/platform/users">
		<Card padding="sm">
			<div class="stat-inner">
				<span class="stat-label">Active (7d)</span>
				<span class="stat-num">{stats.activeUsers}</span>
			</div>
		</Card>
	</a>
	<div class="stat-card">
		<Card padding="sm">
			<div class="stat-inner">
				<span class="stat-label">Blogs</span>
				<span class="stat-num">{stats.blogs}</span>
			</div>
		</Card>
	</div>
	<div class="stat-card">
		<Card padding="sm">
			<div class="stat-inner">
				<span class="stat-label">Published posts</span>
				<span class="stat-num">{stats.publishedPosts}</span>
			</div>
		</Card>
	</div>
	<div class="stat-card">
		<Card padding="sm">
			<div class="stat-inner">
				<span class="stat-label">Reviews (7d)</span>
				<span class="stat-num">{stats.reviews7d}</span>
			</div>
		</Card>
	</div>
	<div class="stat-card">
		<Card padding="sm">
			<div class="stat-inner">
				<span class="stat-label">Comments (7d)</span>
				<span class="stat-num">{stats.comments7d}</span>
				<span class="stat-sub">{stats.comments} total</span>
			</div>
		</Card>
	</div>
	<a
		class="stat-card"
		class:stat-card--alert={stats.reportsOpen > 0}
		href="/admin/platform/reports"
	>
		<Card padding="sm">
			<div class="stat-inner">
				<span class="stat-label">Open reports</span>
				<span class="stat-num" class:stat-num--danger={stats.reportsOpen > 0}>
					{stats.reportsOpen}
				</span>
			</div>
		</Card>
	</a>
</section>

<section class="sparklines" aria-label="30-day trends">
	<h3 class="section-heading">Last 30 days</h3>
	<div class="spark-grid">
		<article class="spark">
			<div class="spark-head">
				<span class="spark-label">New users</span>
				<span class="spark-total">{seriesTotal(sparklines.users)}</span>
			</div>
			<svg
				viewBox="0 0 100 30"
				preserveAspectRatio="none"
				role="img"
				aria-label="New users per day, last 30 days"
			>
				<polyline
					points={polylinePoints(sparklines.users)}
					fill="none"
					stroke="currentColor"
					stroke-width="1"
				/>
			</svg>
		</article>
		<article class="spark">
			<div class="spark-head">
				<span class="spark-label">New posts</span>
				<span class="spark-total">{seriesTotal(sparklines.posts)}</span>
			</div>
			<svg
				viewBox="0 0 100 30"
				preserveAspectRatio="none"
				role="img"
				aria-label="New posts per day, last 30 days"
			>
				<polyline
					points={polylinePoints(sparklines.posts)}
					fill="none"
					stroke="currentColor"
					stroke-width="1"
				/>
			</svg>
		</article>
		<article class="spark">
			<div class="spark-head">
				<span class="spark-label">New comments</span>
				<span class="spark-total">{seriesTotal(sparklines.comments)}</span>
			</div>
			<svg
				viewBox="0 0 100 30"
				preserveAspectRatio="none"
				role="img"
				aria-label="New comments per day, last 30 days"
			>
				<polyline
					points={polylinePoints(sparklines.comments)}
					fill="none"
					stroke="currentColor"
					stroke-width="1"
				/>
			</svg>
		</article>
	</div>
</section>

<section class="audit-section">
	<div class="audit-head">
		<h3 class="section-heading">Recent audit log</h3>
		<form method="GET" class="filter">
			<label for="event-filter" class="sr-only">Filter by event type</label>
			<select id="event-filter" name="event" on:change={submitOwnForm}>
				<option value="">All events</option>
				{#each eventTypes as ev}
					<option value={ev} selected={eventFilter === ev}>{ev}</option>
				{/each}
			</select>
			<noscript><button type="submit">Apply</button></noscript>
		</form>
	</div>

	<Table columns={auditColumns} rows={audit} caption="Recent audit log entries">
		{#snippet cell(row, col)}
			{#if col.key === 'when'}
				{new Date(row.createdAt).toLocaleString()}
			{:else if col.key === 'event'}
				<code>{row.event}</code>
			{:else if col.key === 'actor'}
				<code>{row.actorUserId ?? '—'}</code>
			{:else if col.key === 'subject'}
				<code>{row.subjectBlogId ?? '—'}</code>
			{/if}
		{/snippet}
		{#snippet empty()}
			<p class="empty-msg">No audit entries{eventFilter ? ` for "${eventFilter}"` : ''}.</p>
		{/snippet}
	</Table>
</section>

<style>
	.page-header {
		margin-bottom: var(--space-5);
	}

	.page-title {
		font-family: var(--font-display);
		font-size: var(--text-2xl);
		color: var(--color-text);
		margin: var(--space-1) 0 0;
	}

	.operator-line {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		margin: var(--space-1) 0 0;
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: var(--space-3);
		margin-bottom: var(--space-6);
	}

	.stat-card {
		text-decoration: none;
		color: inherit;
		display: block;
	}

	.stat-card--alert :global(.card) {
		border-color: var(--color-danger);
	}

	.stat-inner {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--space-1);
	}

	.stat-label {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
	}

	.stat-num {
		font-family: var(--font-display);
		font-size: var(--text-2xl);
		font-weight: 600;
		color: var(--color-text);
		line-height: 1;
	}

	.stat-num--danger {
		color: var(--color-danger);
	}

	.stat-sub {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.section-heading {
		font-family: var(--font-ui);
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--color-text);
		margin: 0;
	}

	.sparklines {
		margin-bottom: var(--space-6);
	}

	.spark-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: var(--space-3);
		margin-top: var(--space-3);
	}

	.spark {
		background: var(--color-surface);
		border: var(--border-1) solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-3) var(--space-4);
	}

	.spark-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: var(--space-2);
	}

	.spark-label {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
	}

	.spark-total {
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--color-text);
	}

	.spark svg {
		width: 100%;
		height: 50px;
		color: var(--color-accent);
		display: block;
	}

	.audit-section {
		margin-bottom: var(--space-6);
	}

	.audit-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-4);
		margin-bottom: var(--space-3);
		flex-wrap: wrap;
	}

	.filter select {
		padding: var(--space-1) var(--space-2);
		border: var(--border-1) solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text);
		font-family: var(--font-ui);
		font-size: var(--text-sm);
	}

	.empty-msg {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		padding: var(--space-3) 0;
		margin: 0;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	code {
		font-size: var(--text-xs);
	}
</style>
