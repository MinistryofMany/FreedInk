// @vitest-environment jsdom

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, flushSync } from 'svelte';
import AlertDialog from './AlertDialog.svelte';

afterEach(() => {
	while (document.body.firstChild) {
		document.body.removeChild(document.body.firstChild);
	}
});

describe('AlertDialog', () => {
	it('renders the title in the document when open=true', () => {
		const onConfirm = vi.fn();
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(AlertDialog, {
			target,
			props: { open: true, title: 'Delete item', description: 'This cannot be undone.', onConfirm }
		});
		flushSync();
		expect(document.body.textContent).toContain('Delete item');
	});

	it('renders the description when open=true', () => {
		const onConfirm = vi.fn();
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(AlertDialog, {
			target,
			props: { open: true, title: 'Confirm', description: 'Are you sure?', onConfirm }
		});
		flushSync();
		expect(document.body.textContent).toContain('Are you sure?');
	});

	it('renders confirm and cancel labels', () => {
		const onConfirm = vi.fn();
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(AlertDialog, {
			target,
			props: {
				open: true,
				title: 'Confirm',
				description: 'Proceed?',
				confirmLabel: 'Yes, do it',
				cancelLabel: 'No thanks',
				onConfirm
			}
		});
		flushSync();
		expect(document.body.textContent).toContain('Yes, do it');
		expect(document.body.textContent).toContain('No thanks');
	});

	it('calls onConfirm when the confirm button is clicked', async () => {
		const onConfirm = vi.fn();
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(AlertDialog, {
			target,
			props: {
				open: true,
				title: 'Confirm',
				description: 'Are you sure?',
				confirmLabel: 'Confirm',
				onConfirm
			}
		});
		flushSync();

		// Find the confirm button by label text inside document.body
		const buttons = Array.from(document.body.querySelectorAll('button'));
		const confirmBtn = buttons.find((b) => b.textContent?.trim() === 'Confirm');
		expect(confirmBtn).not.toBeUndefined();
		confirmBtn!.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(onConfirm).toHaveBeenCalledOnce();
	});

	it('does not render content when open=false', () => {
		const onConfirm = vi.fn();
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(AlertDialog, {
			target,
			props: { open: false, title: 'Hidden', description: 'Not shown', onConfirm }
		});
		flushSync();
		expect(document.body.textContent).not.toContain('Hidden');
	});

	it('uses danger variant class on confirm button when tone=danger', () => {
		const onConfirm = vi.fn();
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(AlertDialog, {
			target,
			props: {
				open: true,
				title: 'Delete',
				description: 'Permanent.',
				tone: 'danger',
				confirmLabel: 'Delete',
				onConfirm
			}
		});
		flushSync();
		const buttons = Array.from(document.body.querySelectorAll('button'));
		const confirmBtn = buttons.find((b) => b.textContent?.trim() === 'Delete');
		expect(confirmBtn).not.toBeUndefined();
		expect(confirmBtn!.className).toContain('danger');
	});
});
