// Minimal RSS 2.0 builder. Pure string templating with strict entity escaping
// and CDATA-free output (so we don't have to think about ]]> in user content).
// One dependency removed by writing this inline — we don't need a feed library.

export type RssChannel = {
	title: string;
	link: string;
	description: string;
	language?: string;
	lastBuildDate?: Date;
	selfLink?: string;
};

export type RssItem = {
	title: string;
	link: string;
	guid: string;
	description?: string;
	pubDate?: Date;
};

// Escape characters that have meaning in XML element content / attributes.
// We never emit raw HTML — text-only content keeps RSS readers happy and
// avoids the "is this allowed inside <description>?" question.
function xmlEscape(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function dateRFC822(d: Date): string {
	return d.toUTCString();
}

function dateISO(d: Date): string {
	return d.toISOString();
}

function renderItem(item: RssItem): string {
	const parts = [
		`      <title>${xmlEscape(item.title)}</title>`,
		`      <link>${xmlEscape(item.link)}</link>`,
		`      <guid isPermaLink="true">${xmlEscape(item.guid)}</guid>`
	];
	if (item.pubDate) {
		parts.push(`      <pubDate>${dateRFC822(item.pubDate)}</pubDate>`);
		parts.push(
			`      <dc:date xmlns:dc="http://purl.org/dc/elements/1.1/">${dateISO(item.pubDate)}</dc:date>`
		);
	}
	if (item.description) {
		parts.push(`      <description>${xmlEscape(item.description)}</description>`);
	}
	return ['    <item>', ...parts, '    </item>'].join('\n');
}

export function buildRss(channel: RssChannel, items: RssItem[]): string {
	const channelParts = [
		`    <title>${xmlEscape(channel.title)}</title>`,
		`    <link>${xmlEscape(channel.link)}</link>`,
		`    <description>${xmlEscape(channel.description)}</description>`,
		`    <language>${xmlEscape(channel.language ?? 'en')}</language>`,
		`    <lastBuildDate>${dateRFC822(channel.lastBuildDate ?? new Date())}</lastBuildDate>`,
		`    <generator>FreedInk</generator>`
	];
	if (channel.selfLink) {
		channelParts.push(
			`    <atom:link href="${xmlEscape(channel.selfLink)}" rel="self" type="application/rss+xml" />`
		);
	}
	const xml =
		'<?xml version="1.0" encoding="UTF-8"?>\n' +
		'<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n' +
		'  <channel>\n' +
		channelParts.join('\n') +
		(items.length ? '\n' + items.map(renderItem).join('\n') : '') +
		'\n  </channel>\n' +
		'</rss>\n';
	return xml;
}

// Truncate post content to a short plain-text description for the RSS item.
export function rssExcerpt(content: string, maxLen = 280): string {
	const collapsed = content.replace(/\s+/g, ' ').trim();
	if (collapsed.length <= maxLen) return collapsed;
	return collapsed.slice(0, maxLen - 1).trimEnd() + '…';
}
