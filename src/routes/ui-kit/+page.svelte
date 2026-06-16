<script lang="ts">
	import {
		AlertDialog,
		Badge,
		Button,
		Byline,
		Card,
		Dialog,
		DropdownMenu,
		EmptyState,
		Field,
		Kicker,
		Pagination,
		PullQuote,
		Rule,
		SegmentedControl,
		Stepper,
		Tabs,
		Tag,
		ThemeToggle,
		Tooltip,
		Wordmark
	} from '$lib/components/ui';
	import Tray from 'phosphor-svelte/lib/Tray';
	import PencilSimple from 'phosphor-svelte/lib/PencilSimple';
	import Trash from 'phosphor-svelte/lib/Trash';

	let seg = $state('medium');
	let size = $state(17);
	let tab = $state('one');
	let page = $state(2);
	let dialogOpen = $state(false);
	let alertOpen = $state(false);
	let fieldVal = $state('');
</script>

<div class="kit">
	<header class="kit-head">
		<Wordmark />
		<div class="row">
			<span>Component kit</span>
			<ThemeToggle />
		</div>
	</header>

	<section>
		<Kicker>Buttons</Kicker>
		<div class="row">
			<Button>Primary</Button>
			<Button variant="ghost">Ghost</Button>
			<Button variant="danger">Danger</Button>
			<Button size="sm">Small</Button>
			<Button href="/ui-kit">Link</Button>
			<Button disabled>Disabled</Button>
			<Button loading>Loading</Button>
		</div>
	</section>

	<section>
		<Kicker>Tags &amp; badges</Kicker>
		<div class="row">
			<Tag>Outline</Tag>
			<Tag variant="solid">Solid</Tag>
			<Tag variant="muted">Muted</Tag>
			<Badge tone="neutral">Neutral</Badge>
			<Badge tone="success">Published</Badge>
			<Badge tone="warning">Pending</Badge>
			<Badge tone="danger">Rejected</Badge>
		</div>
	</section>

	<section>
		<Kicker>Form</Kicker>
		<div class="col" style="max-width: 28rem">
			<Field label="Display name" placeholder="The Roundtable" bind:value={fieldVal} />
			<Field label="Bio" multiline help="Shown on your profile." placeholder="A few words…" />
			<Field label="Email" type="email" required error="Enter a valid email address." />
		</div>
	</section>

	<section>
		<Kicker>Reader controls (segmented + stepper)</Kicker>
		<div class="col" style="gap: var(--space-4); max-width: 22rem">
			<SegmentedControl
				ariaLabel="Width"
				options={[
					{ value: 'narrow', label: 'Narrow' },
					{ value: 'medium', label: 'Medium' },
					{ value: 'wide', label: 'Wide' }
				]}
				bind:value={seg}
			/>
			<Stepper
				ariaLabel="Text size"
				bind:value={size}
				min={14}
				max={24}
				format={(n) => `${n} px`}
			/>
			<p class="muted">width = {seg} · size = {size}px</p>
		</div>
	</section>

	<section>
		<Kicker>Editorial</Kicker>
		<Card>
			<Kicker>Essay · The Roundtable</Kicker>
			<h2 class="head">What we couldn't say with our names on it</h2>
			<Byline
				author="The Roundtable"
				meta={['14 authors · anonymous', 'June 2026', '7 min read']}
			/>
			<Rule />
			<p>Twelve novelists agreed to one rule before the first word was written.</p>
			<PullQuote
				>The byline is the group. No reader will ever know which hand held the pen.</PullQuote
			>
		</Card>
	</section>

	<section>
		<Kicker>Cards</Kicker>
		<div class="row">
			<Card padding="sm">Small padding</Card>
			<Card>Medium padding</Card>
			<Card padding="lg" elevated>Large + elevated</Card>
		</div>
	</section>

	<section>
		<Kicker>Tabs</Kicker>
		<Tabs
			bind:value={tab}
			tabs={[
				{ value: 'one', label: 'Posts' },
				{ value: 'two', label: 'Members' },
				{ value: 'three', label: 'Settings' }
			]}
		>
			{#snippet panel(v)}
				<p style="padding-top: var(--space-3)">Panel content for <strong>{v}</strong>.</p>
			{/snippet}
		</Tabs>
	</section>

	<section>
		<Kicker>Overlays</Kicker>
		<div class="row">
			<Dialog
				bind:open={dialogOpen}
				title="Invite a member"
				description="Send a one-time invite link."
			>
				{#snippet trigger()}<Button variant="ghost">Open dialog</Button>{/snippet}
				<p style="margin-top: var(--space-3)">Dialog body content goes here.</p>
			</Dialog>

			<AlertDialog
				bind:open={alertOpen}
				title="Delete this post?"
				description="This action cannot be undone."
				confirmLabel="Delete"
				tone="danger"
				onConfirm={() => {}}
			>
				{#snippet trigger()}<Button variant="danger">Delete…</Button>{/snippet}
			</AlertDialog>

			<DropdownMenu
				items={[
					{ label: 'Edit', icon: PencilSimple, onSelect: () => {} },
					{ label: 'Delete', icon: Trash, danger: true, onSelect: () => {} }
				]}
			/>

			<Tooltip text="Helpful hint">
				<Button variant="ghost">Hover me</Button>
			</Tooltip>
		</div>
	</section>

	<section>
		<Kicker>Empty state &amp; pagination</Kicker>
		<Card>
			<EmptyState icon={Tray} title="No posts yet" description="Proposed posts will appear here.">
				{#snippet action()}<Button size="sm">Propose a post</Button>{/snippet}
			</EmptyState>
		</Card>
		<div style="margin-top: var(--space-4)">
			<Pagination {page} pageCount={5} onchange={(p) => (page = p)} />
		</div>
	</section>
</div>

<style>
	.kit {
		max-width: 64rem;
		margin: 0 auto;
		padding: var(--space-6) var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
	}
	.kit-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		border-bottom: var(--border-1) solid var(--color-border);
		padding-bottom: var(--space-4);
	}
	section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}
	.col {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.head {
		font-family: var(--font-display);
		font-size: var(--text-2xl);
		color: var(--color-text);
		margin: var(--space-2) 0;
	}
	.muted {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
</style>
