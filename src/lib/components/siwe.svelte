<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';

	export let address: string | null = null;
	let busy = false;
	let error = '';

	async function signInWithEthereum() {
		if (!browser) return;
		busy = true;
		error = '';
		try {
			const { BrowserProvider } = await import('ethers');
			const { SiweMessage } = await import('siwe');
			if (!(window as any).ethereum) {
				error = 'No injected wallet detected (MetaMask, Rabby, etc.).';
				return;
			}
			const provider = new BrowserProvider((window as any).ethereum);
			await provider.send('eth_requestAccounts', []);
			const signer = await provider.getSigner();
			const addr = await signer.getAddress();
			const network = await provider.getNetwork();

			const nonce = await (await fetch('/api/nonce', { credentials: 'include' })).text();
			const message = new SiweMessage({
				scheme: document.location.protocol.replace(':', ''),
				domain: document.location.host,
				address: addr,
				statement: 'Sign into Freed.Ink with Ethereum.',
				uri: document.location.origin,
				version: '1',
				chainId: Number(network.chainId),
				nonce
			}).prepareMessage();
			const signature = await signer.signMessage(message);
			const res = await fetch('/api/verify', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ message, signature }),
				credentials: 'include'
			});
			if (!res.ok) {
				error = await res.text();
				return;
			}
			const json = await res.json();
			goto(json.needs_identity ? '/signup/identity' : '/admin');
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	async function signOut() {
		const res = await fetch('/api/signout', { method: 'POST' });
		if (res.ok) {
			window.location.href = '/';
		}
	}
</script>

<div id="siwe_state">
	{#if address}
		<div title={address} class="address">{address}</div>
		<button on:click={signOut}>Sign out</button>
	{:else}
		<button on:click={signInWithEthereum} disabled={busy}>
			{busy ? 'Signing…' : 'Sign-in with Ethereum'}
		</button>
	{/if}
	{#if error}
		<span style="color: var(--color-red)">{error}</span>
	{/if}
</div>

<style>
	#siwe_state {
		display: flex;
		gap: 1rem;
		align-items: center;
	}
	.address {
		max-width: 12ch;
		text-overflow: ellipsis;
		white-space: nowrap;
		overflow: hidden;
	}
</style>
