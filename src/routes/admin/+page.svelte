<script lang="ts">
	import { getContext } from 'svelte';
	import { _ } from '$lib/i18n';
	const owned = getContext<Array<{ slug: string; title: string }>>('owned');
	const edited = getContext<Array<{ slug: string; title: string }>>('edited');
	const reviewed = getContext<Array<{ slug: string; title: string }>>('reviewed');
	const authored = getContext<Array<{ slug: string; title: string }>>('authored');
</script>

<section>
	<h3>{$_('admin.owned_heading')}</h3>
	{#if owned.length === 0}
		<p>{$_('admin.no_owned')}</p>
	{:else}
		<ul>
			{#each owned as blog}
				<li><a href="/admin/b/{blog.slug}/manage">{blog.title}</a></li>
			{/each}
		</ul>
	{/if}
</section>

<section>
	<h3>{$_('admin.editing_heading')}</h3>
	{#if edited.length === 0}
		<p>{$_('admin.no_editing')}</p>
	{:else}
		<ul>
			{#each edited as blog}
				<li><a href="/admin/b/{blog.slug}/review">{blog.title}</a></li>
			{/each}
		</ul>
	{/if}
</section>

<section>
	<h3>{$_('admin.reviewing_heading')}</h3>
	{#if reviewed.length === 0}
		<p>{$_('admin.no_reviewing')}</p>
	{:else}
		<ul>
			{#each reviewed as blog}
				<li><a href="/admin/b/{blog.slug}/review">{blog.title}</a></li>
			{/each}
		</ul>
	{/if}
</section>

<section>
	<h3>{$_('admin.authoring_heading')}</h3>
	{#if authored.length === 0}
		<p>{$_('admin.no_authoring')}</p>
	{:else}
		<ul>
			{#each authored as blog}
				<li><a href="/admin/b/{blog.slug}/author">{blog.title}</a></li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	section {
		margin-bottom: 1.25rem;
	}
	ul {
		list-style: none;
		padding-left: 0;
	}
	li {
		margin: 0.25rem 0;
	}
</style>
