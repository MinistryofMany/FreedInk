// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { mount } from 'svelte';
import BlogCard from './BlogCard.svelte';

afterEach(() => {
	while (document.body.firstChild) {
		document.body.removeChild(document.body.firstChild);
	}
});

interface BlogCardProps {
	title: string;
	slug: string;
	description?: string;
	authorCount?: number;
	latestPostTitle?: string;
}

function mountBlogCard(props: BlogCardProps) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	mount(BlogCard, { target, props });
	return target;
}

describe('BlogCard', () => {
	it('renders the title text', () => {
		const target = mountBlogCard({ title: 'My Blog', slug: 'my-blog' });
		expect(target.textContent).toContain('My Blog');
	});

	it('title link href is /b/{slug}', () => {
		const target = mountBlogCard({ title: 'My Blog', slug: 'my-blog' });
		const link = target.querySelector('a.blog-title');
		expect(link).not.toBeNull();
		expect(link!.getAttribute('href')).toBe('/b/my-blog');
	});

	it('shows author count when provided', () => {
		const target = mountBlogCard({ title: 'My Blog', slug: 'my-blog', authorCount: 3 });
		expect(target.textContent).toContain('3 authors');
	});

	it('omits author count when authorCount is undefined', () => {
		const target = mountBlogCard({ title: 'My Blog', slug: 'my-blog' });
		expect(target.textContent).not.toContain('authors');
		expect(target.textContent).toContain('anonymous');
	});

	it('always renders "anonymous"', () => {
		const target = mountBlogCard({ title: 'My Blog', slug: 'my-blog', authorCount: 5 });
		expect(target.textContent).toContain('anonymous');
	});

	it('renders description when provided', () => {
		const target = mountBlogCard({
			title: 'My Blog',
			slug: 'my-blog',
			description: 'A blog about things'
		});
		expect(target.textContent).toContain('A blog about things');
	});

	it('omits description when not provided', () => {
		const target = mountBlogCard({ title: 'My Blog', slug: 'my-blog' });
		const desc = target.querySelector('.description');
		expect(desc).toBeNull();
	});

	it('renders latestPostTitle when provided', () => {
		const target = mountBlogCard({
			title: 'My Blog',
			slug: 'my-blog',
			latestPostTitle: 'First Post'
		});
		expect(target.textContent).toContain('Latest');
		expect(target.textContent).toContain('First Post');
	});

	it('omits latest section when latestPostTitle is not provided', () => {
		const target = mountBlogCard({ title: 'My Blog', slug: 'my-blog' });
		const latest = target.querySelector('.latest');
		expect(latest).toBeNull();
	});
});
