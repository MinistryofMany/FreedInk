// Pure renderer tests for the Prometheus exposition format. No DB calls —
// we mock `$lib/db/client` so the SUT imports cleanly without a pool.
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/db/client', () => ({
	db: {} as unknown,
	schema: {} as unknown
}));

import {
	renderPrometheus,
	escapeLabelValue,
	escapeHelp,
	buildDbLatencyHistogram,
	type Metric
} from './metrics';

describe('escapeLabelValue', () => {
	it('escapes backslash, double-quote, and newline', () => {
		expect(escapeLabelValue('plain')).toBe('plain');
		expect(escapeLabelValue('a"b')).toBe('a\\"b');
		expect(escapeLabelValue('a\\b')).toBe('a\\\\b');
		expect(escapeLabelValue('a\nb')).toBe('a\\nb');
		// Backslash must be escaped first so escaping a quote doesn't introduce
		// a stray un-escaped backslash.
		expect(escapeLabelValue('a"\\b')).toBe('a\\"\\\\b');
	});
});

describe('escapeHelp', () => {
	it('escapes backslash and newline but leaves quotes intact', () => {
		expect(escapeHelp('hello world')).toBe('hello world');
		expect(escapeHelp('a\nb')).toBe('a\\nb');
		expect(escapeHelp('a\\b')).toBe('a\\\\b');
		// Quotes are allowed verbatim in HELP lines per spec.
		expect(escapeHelp('say "hi"')).toBe('say "hi"');
	});
});

describe('renderPrometheus: basic gauge', () => {
	it('emits HELP, TYPE, and a single sample line in order', () => {
		const out = renderPrometheus([
			{
				name: 'freedink_widgets_total',
				help: 'How many widgets exist.',
				type: 'gauge',
				samples: [{ value: 42 }]
			}
		]);
		const lines = out.trimEnd().split('\n');
		expect(lines[0]).toBe('# HELP freedink_widgets_total How many widgets exist.');
		expect(lines[1]).toBe('# TYPE freedink_widgets_total gauge');
		expect(lines[2]).toBe('freedink_widgets_total 42');
		expect(out.endsWith('\n')).toBe(true);
	});

	it('emits zero samples cleanly (just HELP+TYPE)', () => {
		const out = renderPrometheus([
			{ name: 'm', help: 'h', type: 'counter', samples: [] }
		]);
		expect(out).toBe('# HELP m h\n# TYPE m counter\n');
	});
});

describe('renderPrometheus: labels', () => {
	it('emits multiple labels sorted alphabetically', () => {
		const out = renderPrometheus([
			{
				name: 'x',
				help: 'h',
				type: 'gauge',
				samples: [{ labels: { z: '1', a: '2', m: '3' }, value: 7 }]
			}
		]);
		expect(out).toContain('x{a="2",m="3",z="1"} 7');
	});

	it('escapes quotes in label values', () => {
		const out = renderPrometheus([
			{
				name: 'evt',
				help: 'events',
				type: 'counter',
				samples: [{ labels: { event: 'login "click"' }, value: 1 }]
			}
		]);
		expect(out).toContain('evt{event="login \\"click\\""} 1');
	});

	it('escapes backslashes and newlines in label values', () => {
		const out = renderPrometheus([
			{
				name: 'p',
				help: 'h',
				type: 'gauge',
				samples: [{ labels: { path: 'a\\b\nc' }, value: 1 }]
			}
		]);
		expect(out).toContain('p{path="a\\\\b\\nc"} 1');
	});

	it('omits the brace block entirely when the labels object is empty', () => {
		const out = renderPrometheus([
			{ name: 'x', help: 'h', type: 'gauge', samples: [{ labels: {}, value: 9 }] }
		]);
		expect(out).toContain('x 9');
		expect(out).not.toContain('x{}');
	});
});

describe('renderPrometheus: multiple metrics', () => {
	it('renders them back-to-back, each with its own HELP/TYPE block', () => {
		const out = renderPrometheus([
			{ name: 'a', help: 'A', type: 'gauge', samples: [{ value: 1 }] },
			{ name: 'b', help: 'B', type: 'counter', samples: [{ value: 2 }] }
		]);
		const lines = out.trimEnd().split('\n');
		expect(lines).toEqual([
			'# HELP a A',
			'# TYPE a gauge',
			'a 1',
			'# HELP b B',
			'# TYPE b counter',
			'b 2'
		]);
	});
});

describe('renderPrometheus: rejects unknown metric type', () => {
	it('throws when the metric type is not gauge/counter/histogram', () => {
		const bad = {
			name: 'x',
			help: 'h',
			// Deliberately invalid — caller mistyped a constant.
			type: 'summary' as unknown as Metric['type'],
			samples: [{ value: 1 }]
		};
		expect(() => renderPrometheus([bad])).toThrow(/unknown metric type/i);
	});
});

describe('renderPrometheus: histogram', () => {
	it('emits _bucket, _sum, and _count lines for each sample', () => {
		const out = renderPrometheus([
			{
				name: 'lat',
				help: 'Latency',
				type: 'histogram',
				samples: [
					{
						buckets: [
							{ le: 0.005, count: 1 },
							{ le: 0.05, count: 1 },
							{ le: '+Inf', count: 1 }
						],
						sum: 0.003,
						count: 1
					}
				]
			}
		]);
		expect(out).toContain('# TYPE lat histogram');
		expect(out).toContain('lat_bucket{le="0.005"} 1');
		expect(out).toContain('lat_bucket{le="0.05"} 1');
		expect(out).toContain('lat_bucket{le="+Inf"} 1');
		expect(out).toContain('lat_sum 0.003');
		expect(out).toContain('lat_count 1');
	});
});

describe('buildDbLatencyHistogram', () => {
	it('puts fast probes in both 5ms and 50ms buckets', () => {
		const m = buildDbLatencyHistogram(0.002);
		const out = renderPrometheus([m]);
		expect(out).toContain('le="0.005"} 1');
		expect(out).toContain('le="0.05"} 1');
		expect(out).toContain('le="+Inf"} 1');
		expect(out).toContain('freedink_db_query_duration_seconds_sum 0.002');
		expect(out).toContain('freedink_db_query_duration_seconds_count 1');
	});

	it('puts slow probes only in the +Inf bucket', () => {
		const m = buildDbLatencyHistogram(0.5);
		const out = renderPrometheus([m]);
		expect(out).toContain('le="0.005"} 0');
		expect(out).toContain('le="0.05"} 0');
		expect(out).toContain('le="+Inf"} 1');
	});
});
