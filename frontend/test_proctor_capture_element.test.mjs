// Regression: Chrome / Edge do not decode a 1px, transparent or off-screen <video>, so frames drawn from it are completely BLACK
// (verified in headed Edge with a fake camera: mean luminance 0 with the old style, ~88 with the current one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('./src/hooks/useFaceProctoring.js', import.meta.url), 'utf-8');

test('the capture <video> is really rendered: not 1px, not fully transparent, not off-screen, and it never takes the mouse', () => {
    const css = (src.match(/video\.style\.cssText = '([^']+)'/) || [])[1];
    assert.ok(css, 'the capture video has an explicit style');
    assert.doesNotMatch(css, /-9999px/, 'not off-screen');
    assert.doesNotMatch(css, /opacity:\s*0(?![.\d])/, 'not fully transparent');
    assert.doesNotMatch(css, /(?:width|height):\s*1px/, 'not 1px');
    assert.match(css, /pointer-events:\s*none/, 'clicks pass through it');
    assert.match(css, /z-index:\s*-1/, 'it sits behind the page');
    assert.match(src, /await video\.play\(\)/, 'playback is started explicitly');
});
