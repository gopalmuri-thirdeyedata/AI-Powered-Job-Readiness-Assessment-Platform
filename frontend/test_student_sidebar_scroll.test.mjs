// Student sidebar: only the navigation list scrolls; the profile card and Sign Out stay pinned below it.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8');
const layout = read('src/layouts/StudentLayout.jsx');

describe('student sidebar scrolling', () => {
    test('1. the nav is the one scroller: flex-1, min-h-0, vertical scroll, no horizontal scroll, no scroll chaining into the page', () => {
        const nav = layout.match(/<nav className=\{`([^`]*)`\}>/)[1];
        for (const c of ['flex-1', 'min-h-0', 'overflow-y-auto', 'overflow-x-hidden', 'overscroll-contain', 'student-nav-scroll']) assert.ok(nav.split(/\s+/).includes(c), c);
    });

    test('2. profile card + Sign Out sit below the nav in a shrink-0 block, so nothing can overlap them', () => {
        assert.ok(layout.includes('<div className="shrink-0 p-3 border-t border-slate-200/80 dark:border-slate-800">'));
        assert.ok(layout.indexOf('student-nav-scroll') < layout.indexOf('shrink-0 p-3 border-t'));
    });

    test('3. wrappers around the nav clip instead of scrolling (desktop and phone drawer), so there is never a second scrollbar', () => {
        assert.ok(layout.includes('flex flex-col h-full min-h-0 overflow-hidden'));
        assert.ok(layout.includes('flex-1 min-h-0 flex flex-col overflow-hidden'));
        assert.ok(layout.includes('h-[100dvh] max-h-full'), 'the drawer follows the visible viewport height on phones');
        assert.ok(!layout.includes('flex-1 flex flex-col overflow-y-auto'));
    });

    test('4. the desktop sidebar is still fixed under the 4rem header with its width and collapse button', () => {
        assert.ok(layout.includes('fixed left-0 top-16 bottom-0 z-20'));
        assert.ok(layout.includes("title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}"));
    });

    test('5. the demo sidebar uses the same scrolling nav, and the scrollbar style is scoped to the sidebar only', () => {
        assert.ok(read('src/layouts/StudentDemoLayout.jsx').includes('flex-1 min-h-0 py-3 px-2.5 space-y-1 overflow-y-auto overflow-x-hidden overscroll-contain student-nav-scroll'));
        const css = read('src/index.css');
        assert.ok(css.includes('.student-nav-scroll::-webkit-scrollbar-thumb') && css.includes('.student-scrollbar::-webkit-scrollbar-thumb {'), 'the older class (used by the dashboard tab strips) is untouched');
    });
});
