// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { mount } from 'svelte';
import Stepper from './Stepper.svelte';

afterEach(() => {
	while (document.body.firstChild) {
		document.body.removeChild(document.body.firstChild);
	}
});

describe('Stepper', () => {
	it('renders decrement and increment buttons', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Stepper, { target, props: { value: 16, min: 14, max: 24, ariaLabel: 'Text size' } });
		const buttons = target.querySelectorAll('button');
		expect(buttons.length).toBe(2);
		expect(buttons[0].getAttribute('aria-label')).toBe('Decrease Text size');
		expect(buttons[1].getAttribute('aria-label')).toBe('Increase Text size');
	});

	it('increment increases value', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Stepper, { target, props: { value: 16, min: 14, max: 24, ariaLabel: 'Text size' } });
		const [, inc] = target.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
		inc.click();
		await new Promise((r) => setTimeout(r, 0));
		const display = target.querySelector('[aria-live="polite"]');
		expect(display!.textContent).toBe('17');
	});

	it('decrement decreases value', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Stepper, { target, props: { value: 16, min: 14, max: 24, ariaLabel: 'Text size' } });
		const [dec] = target.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
		dec.click();
		await new Promise((r) => setTimeout(r, 0));
		const display = target.querySelector('[aria-live="polite"]');
		expect(display!.textContent).toBe('15');
	});

	it('clamps at min: decrement disabled and value stays at min', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Stepper, { target, props: { value: 14, min: 14, max: 24, ariaLabel: 'Text size' } });
		const [dec] = target.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
		expect(dec.disabled).toBe(true);
		dec.click();
		await new Promise((r) => setTimeout(r, 0));
		const display = target.querySelector('[aria-live="polite"]');
		expect(display!.textContent).toBe('14');
	});

	it('clamps at max: increment disabled and value stays at max', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Stepper, { target, props: { value: 24, min: 14, max: 24, ariaLabel: 'Text size' } });
		const [, inc] = target.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
		expect(inc.disabled).toBe(true);
		inc.click();
		await new Promise((r) => setTimeout(r, 0));
		const display = target.querySelector('[aria-live="polite"]');
		expect(display!.textContent).toBe('24');
	});

	it('uses the format function when provided', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Stepper, {
			target,
			props: { value: 17, min: 14, max: 24, format: (n) => `${n}px`, ariaLabel: 'Text size' }
		});
		const display = target.querySelector('[aria-live="polite"]');
		expect(display!.textContent).toBe('17px');
	});

	it('has aria-label on the group', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(Stepper, { target, props: { value: 16, min: 14, max: 24, ariaLabel: 'Reading size' } });
		const group = target.querySelector('.stepper');
		expect(group!.getAttribute('aria-label')).toBe('Reading size');
	});
});
