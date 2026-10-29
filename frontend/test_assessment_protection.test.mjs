// Content protection for the proctored assessment: the pure decisions are tested directly, the visible layer is rendered.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './test_support/bundle.mjs';

describe('which key presses are blocked', () => {
    test('screenshot, print / save and developer-tools shortcuts are recognised; ordinary typing is not', async () => {
        const { classifyKey } = await loadModule('src/hooks/useAssessmentProtection.js');
        assert.match(classifyKey({ key: 'PrintScreen' }), /Screenshot/);
        assert.match(classifyKey({ key: 'p', ctrlKey: true }), /Print/);
        assert.match(classifyKey({ key: 'S', metaKey: true }), /Print or Save/);
        assert.match(classifyKey({ key: 'F12' }), /Developer tools/);
        assert.match(classifyKey({ key: 'I', ctrlKey: true, shiftKey: true }), /Developer tools/);
        assert.match(classifyKey({ key: 'u', ctrlKey: true }), /Developer tools/);
        for (const harmless of [{ key: 'a' }, { key: 'Enter' }, { key: 'c', ctrlKey: true }, { key: 'v', ctrlKey: true }, { key: 'p' }, { key: 'Tab' }]) {
            assert.equal(classifyKey(harmless), null, JSON.stringify(harmless));
        }
    });

    test('the code editor and text fields count as the candidate\'s own text; the questions do not', async () => {
        const { isEditableTarget } = await loadModule('src/hooks/useAssessmentProtection.js');
        const el = (matches) => ({ closest: (selector) => (matches.some((m) => selector.includes(m)) ? {} : null) });
        assert.equal(isEditableTarget(el(['.monaco-editor'])), true);
        assert.equal(isEditableTarget(el(['textarea'])), true);
        assert.equal(isEditableTarget(el([])), false);
        assert.equal(isEditableTarget(null), false);
    });

    test('protection is ON unless the build explicitly switches it off', async () => {
        const { PROTECTION_TEST_MODE } = await loadModule('src/hooks/useAssessmentProtection.js');
        assert.equal(PROTECTION_TEST_MODE, false);
    });
});

describe('the visible layer', () => {
    const load = async () => (await loadModule('src/components/ProtectionLayer.jsx')).default;

    test('a cover hides the page while the window is not in front, and a watermark names the session', async () => {
        const ProtectionLayer = await load();
        const html = renderToStaticMarkup(React.createElement(ProtectionLayer, { obscured: true, watermark: 'Session ab12cd34', protectionOn: true, testMode: false }));
        assert.match(html, /protection-cover/);
        assert.match(html, /The assessment is hidden/);
        assert.match(html, /protection-watermark/);
        assert.ok((html.match(/Session ab12cd34/g) || []).length > 20, 'the watermark is tiled');
        assert.doesNotMatch(html, /protection-test-badge/);
    });

    test('nothing is drawn when protection is off, except a test-mode badge so it cannot be forgotten', async () => {
        const ProtectionLayer = await load();
        const off = renderToStaticMarkup(React.createElement(ProtectionLayer, { obscured: false, watermark: 'Session x', protectionOn: false, testMode: true }));
        assert.doesNotMatch(off, /protection-cover|protection-watermark/);
        assert.match(off, /protection-test-badge/);
        assert.match(off, /Test mode/);
        const quiet = renderToStaticMarkup(React.createElement(ProtectionLayer, { obscured: false, watermark: '', protectionOn: true, testMode: false }));
        assert.doesNotMatch(quiet, /protection-cover|protection-watermark|protection-test-badge/);
    });
});

describe('the watermark fills the whole window', () => {
    test('the number of tiles grows with the window (it used to be a fixed 70 that only covered the top-left corner)', async () => {
        const { tileCount } = await loadModule('src/components/ProtectionLayer.jsx');
        const small = tileCount('Session ab12cd34', { w: 390, h: 844 });
        const laptop = tileCount('Session ab12cd34', { w: 1366, h: 768 });
        const desktop = tileCount('Session ab12cd34', { w: 1920, h: 1080 });
        assert.ok(small > 70 && laptop > small && desktop > laptop, `${small} < ${laptop} < ${desktop}`);
        assert.ok(laptop >= 300, 'a 1366x768 window needs hundreds of 130px tiles, not 70');
        assert.ok(tileCount('x'.repeat(40), { w: 7680, h: 4320 }) <= 1400, 'bounded on a huge screen');
        assert.equal(tileCount('', { w: 100, h: 100 }) > 0, true);
    });
});
