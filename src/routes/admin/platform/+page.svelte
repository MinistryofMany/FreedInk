<script lang="ts">
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
</script>

<svelte:head>
	<title>Platform admin</title>
</svelte:head>

<header>
	<h2>Platform operator dashboard</h2>
	<p class="meta">Signed in as <code>{operator.username}</code></p>
	<nav>
		<a href="/admin/platform">Overview</a>
		<a href="/admin/platform/users">Users</a>
		<a href="/admin/platform/reports">Reports</a>
		<a href="/admin/platform/flags">Flags</a>
		<a href="/admin/platform/audit">Audit log</a>
	</nav>
</header>

<section class="stats" aria-label="Platform overview">
	<a class="card" href="/admin/platform/users">
		<div class="label">Users</div>
		<div class="num">{stats.users}</div>
	</a>
	<a class="card" href="/admin/platform/users">
		<div class="label">Active (7d)</div>
		<div class="num">{stats.activeUsers}</div>
	</a>
	<div class="card">
		<div class="label">Blogs</div>
		<div class="num">{stats.blogs}</div>
	</div>
	<div class="card">
		<div class="label">Published posts</div>
		<div class="num">{stats.publishedPosts}</div>
	</div>
	<div class="card">
		<div class="label">Reviews (7d)</div>
		<div class="num">{stats.reviews7d}</div>
	</div>
	<div class="card">
		<div class="label">Comments (7d)</div>
		<div class="num">{stats.comments7d}</div>
		<div class="sub">{stats.comments} total</div>
	</div>
	<a class="card" class:alert={stats.reportsOpen > 0} href="/admin/platform/reports">
		<div class="label">Open reports</div>
		<div class="num">{stats.reportsOpen}</div>
	</a>
</section>

<section class="sparklines" aria-label="30-day trends">
	<h3>Last 30 days</h3>
	<div class="spark-grid">
		<article class="spark">
			<div class="spark-head">
				<span class="spark-label">New users</span>
				<span class="spark-total">{seriesTotal(sparklines.users)}</span>
			</div>
			<svg viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label="New users per day, last 30 days">
				<polyline points={polylinePoints(sparklines.users)} fill="none" stroke="currentColor" stroke-width="1" />
			</svg>
		</article>
		<article class="spark">
			<div class="spark-head">
				<span class="spark-label">New posts</span>
				<span class="spark-total">{seriesTotal(sparklines.posts)}</span>
			</div>
			<svg viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label="New posts per day, last 30 days">
				<polyline points={polylinePoints(sparklines.posts)} fill="none" stroke="currentColor" stroke-width="1" />
			</svg>
		</article>
		<article class="spark">
			<div class="spark-head">
				<span class="spark-label">New comments</span>
				<span class="spark-total">{seriesTotal(sparklines.comments)}</span>
			</div>
			<svg viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label="New comments per day, last 30 days">
				<polyline points={polylinePoints(sparklines.comments)} fill="none" stroke="currentColor" stroke-width="1" />
			</svg>
		</article>
	</div>
</section>

<section>
	<div class="audit-head">
		<h3>Recent audit log</h3>
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
	{#if audit.length === 0}
		<p>No audit entries{eventFilter ? ` for "${eventFilter}"` : ''}.</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th>When</th>
					<th>Event</th>
					<th>Actor</th>
					<th>Subject blog</th>
				</tr>
			</thead>
			<tbody>
				{#each audit as a}
					<tr>
						<td>{new Date(a.createdAt).toLocaleString()}</td>
						<td><code>{a.event}</code></td>
						<td><code>{a.actorUserId ?? '—'}</code></td>
						<td><code>{a.subjectBlogId ?? '—'}</code></td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<style>
	header {
		margin-bottom: 1.5rem;
	}
	.meta {
		color: #666;
		font-size: 0.85rem;
	}
	nav {
		display: flex;
		gap: 1rem;
		margin-top: 0.5rem;
		flex-wrap: wrap;
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 0.75rem;
		margin-bottom: 2rem;
	}
	.card {
		border: 1px solid #ddd;
		padding: 1rem;
		border-radius: 0.25rem;
		text-align: center;
		text-decoration: none;
		color: inherit;
		display: block;
	}
	a.card:hover {
		background: #f6f6f6;
	}
	.card.alert {
		border-color: #c33;
	}
	.card.alert .num {
		color: #c33;
	}
	.label {
		color: #666;
		font-size: 0.85rem;
	}
	.num {
		font-size: 2rem;
		font-weight: 600;
	}
	.sub {
		color: #888;
		font-size: 0.75rem;
		margin-top: 0.15rem;
	}
	.sparklines {
		margin-bottom: 2rem;
	}
	.spark-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.75rem;
	}
	.spark {
		border: 1px solid #ddd;
		border-radius: 0.25rem;
		padding: 0.75rem 1rem;
	}
	.spark-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: 0.4rem;
	}
	.spark-label {
		font-size: 0.85rem;
		color: #666;
	}
	.spark-total {
		font-size: 1.1rem;
		font-weight: 600;
	}
	.spark svg {
		width: 100%;
		height: 50px;
		color: #2a6ed4;
		display: block;
	}
	.audit-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		margin-bottom: 0.5rem;
		flex-wrap: wrap;
	}
	.filter select {
		padding: 0.3rem 0.5rem;
		border: 1px solid #ccc;
		border-radius: 0.25rem;
		background: white;
		font-size: 0.85rem;
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
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}
	th,
	td {
		border-bottom: 1px solid #eee;
		padding: 0.5rem;
		text-align: left;
		vertical-align: top;
	}
	code {
		font-size: 0.8rem;
	}
</style>
