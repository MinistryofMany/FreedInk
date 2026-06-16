// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { mount } from 'svelte';
import SegmentedControl from './SegmentedControl.svelte';

const options = [
	{ value: 'a', label: 'Alpha' },
	{ value: 'b', label: 'Beta' },
	{ value: 'c', label: 'Gamma' }
];

afterEach(() => {
	while (document.body.firstChild) {
		document.body.removeChild(document.body.firstChild);
	}
});

describe('SegmentedControl', () => {
	it('renders all options as radio buttons', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(SegmentedControl, { target, props: { options, value: 'a', ariaLabel: 'Test' } });
		const buttons = target.querySelectorAll('[role="radio"]');
		expect(buttons.length).toBe(3);
	});

	it('marks the active option as aria-checked=true', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(SegmentedControl, { target, props: { options, value: 'b', ariaLabel: 'Test' } });
		const buttons = target.querySelectorAll('[role="radio"]');
		expect(buttons[0].getAttribute('aria-checked')).toBe('false');
		expect(buttons[1].getAttribute('aria-checked')).toBe('true');
		expect(buttons[2].getAttribute('aria-checked')).toBe('false');
	});

	it('clicking an option updates aria-checked on the selected button', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(SegmentedControl, { target, props: { options, value: 'a', ariaLabel: 'Test' } });

		const buttons = target.querySelectorAll('[role="radio"]') as NodeListOf<HTMLButtonElement>;
		// Initially first is checked
		expect(buttons[0].getAttribute('aria-checked')).toBe('true');

		// Click second option
		buttons[1].click();

		// Allow Svelte to flush reactivity
		await new Promise((r) => setTimeout(r, 0));

		expect(buttons[1].getAttribute('aria-checked')).toBe('true');
		expect(buttons[0].getAttribute('aria-checked')).toBe('false');
	});

	it('has a radiogroup with the provided aria-label', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(SegmentedControl, { target, props: { options, value: 'a', ariaLabel: 'Font size' } });
		const group = target.querySelector('[role="radiogroup"]');
		expect(group).not.toBeNull();
		expect(group!.getAttribute('aria-label')).toBe('Font size');
	});

	it('roving tabindex: exactly the selected option is tabbable', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(SegmentedControl, { target, props: { options, value: 'b', ariaLabel: 'Test' } });
		const buttons = target.querySelectorAll('[role="radio"]') as NodeListOf<HTMLButtonElement>;
		expect(buttons[0].tabIndex).toBe(-1);
		expect(buttons[1].tabIndex).toBe(0);
		expect(buttons[2].tabIndex).toBe(-1);
	});

	it('arrow keys move both selection and focus, wrapping around', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(SegmentedControl, { target, props: { options, value: 'a', ariaLabel: 'Test' } });
		const buttons = target.querySelectorAll('[role="radio"]') as NodeListOf<HTMLButtonElement>;

		buttons[0].focus();
		expect(document.activeElement).toBe(buttons[0]);

		buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		await new Promise((r) => setTimeout(r, 0));
		expect(buttons[1].getAttribute('aria-checked')).toBe('true');
		expect(document.activeElement).toBe(buttons[1]);

		// last -> first wrap
		buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		await new Promise((r) => setTimeout(r, 0));
		expect(document.activeElement).toBe(buttons[2]);
		buttons[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		await new Promise((r) => setTimeout(r, 0));
		expect(buttons[0].getAttribute('aria-checked')).toBe('true');
		expect(document.activeElement).toBe(buttons[0]);
	});
});
