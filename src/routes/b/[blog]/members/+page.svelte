<script lang="ts">
	import { _ } from '$lib/i18n';
	import { Byline, Rule, Tag } from '$lib/components/ui';
	import type { PageData } from './$types';

	export let data: PageData;

	function displayName(m: { displayName: string | null; username: string }): string {
		return m.displayName?.trim() || m.username;
	}
</script>

<svelte:head>
	<title>{$_('members.title', { values: { blog: data.Blog.title } })} — FreedInk</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="members-page">
	<header class="masthead">
		<h1 class="page-title">{$_('members.heading')}</h1>
		<Byline
			author={data.Blog.title}
			meta={[$_('members.count', { values: { count: data.Members.length } })]}
		/>
		<p class="members-note">{$_('members.note')}</p>
		<p class="back-link">
			<a href="/b/{data.Blog.slug}">{$_('members.back_to_blog')}</a>
		</p>
	</header>

	<Rule />

	{#if data.Members.length === 0}
		<p class="empty">{$_('members.empty')}</p>
	{:else}
		<ul class="member-list" role="list">
			{#each data.Members as member (member.username)}
				<li class="member-item">
					<span class="member-name">{displayName(member)}</span>
					<span class="member-username">@{member.username}</span>
					<Tag>{member.role}</Tag>
					<span class="member-joined">
						{$_('members.joined', {
							values: { date: new Date(member.joinedAt).toLocaleDateString() }
						})}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.members-page {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}

	.masthead {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.page-title {
		font-family: var(--font-display);
		font-size: var(--text-3xl);
		color: var(--color-text);
		line-height: 1.1;
		margin: 0;
	}

	.members-note {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		margin: 0;
		max-width: 64ch;
	}

	.back-link {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		margin: 0;
	}

	.member-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.member-item {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-3);
		padding-bottom: var(--space-3);
		border-bottom: 1px solid var(--color-border);
	}

	.member-item:last-child {
		border-bottom: none;
		padding-bottom: 0;
	}

	.member-name {
		font-family: var(--font-ui);
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--color-text);
	}

	.member-username {
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.member-joined {
		font-family: var(--font-ui);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		margin-left: auto;
	}

	.empty {
		font-family: var(--font-ui);
		color: var(--color-text-muted);
	}
</style>
