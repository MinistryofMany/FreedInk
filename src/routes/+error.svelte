<script lang="ts">
	import { _ } from '$lib/i18n';
</script>

<h2><b>{$_('errors.page_not_found_heading')}</b></h2>
<h6>{$_('errors.page_not_found_hint')}</h6>
<p class="back-home"><a href="/">{$_('errors.back_home')}</a></p>

<style>
	.back-home {
		margin-top: var(--space-4);
	}
</style>
