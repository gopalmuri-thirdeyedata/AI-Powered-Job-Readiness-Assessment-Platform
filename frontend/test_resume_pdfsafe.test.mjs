import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pdfSafe, buildBlocks } from './src/utils/resumeTemplates.js';
import { layoutResume } from './src/utils/resumeLayout.js';
import { getMeasure } from './src/utils/resumeMeasure.js';

const ARROW = '↗';

// every character jsPDF's built-in fonts can draw: printable ASCII, Latin-1, and the Windows-1252 extras
const WIN_ANSI_EXTRAS = new Set(Array.from('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'));
const drawable = (ch) => {
    const code = ch.codePointAt(0);
    return (code >= 32 && code <= 126) || (code >= 161 && code <= 255) || WIN_ANSI_EXTRAS.has(ch);
};

describe('PDF-safe resume text', () => {
    test('1. link arrows and symbols are removed, normal text is untouched', () => {
        assert.equal(pdfSafe(`Certificate ${ARROW}`), 'Certificate ');
        assert.equal(pdfSafe(`Project [GitHub ${ARROW}] - Python`), 'Project [GitHub ] - Python');
        assert.equal(pdfSafe('Plain ASCII text, 100% fine (really)'), 'Plain ASCII text, 100% fine (really)');
        assert.equal(pdfSafe('café résumé'), 'café résumé');
    });

    test('2. characters the PDF fonts do have are kept: bullets, dashes, smart quotes, euro', () => {
        for (const ch of ['•', '–', '—', '‘', '’', '“', '”', '€', '…']) {
            assert.equal(pdfSafe(`a${ch}b`), `a${ch}b`, `U+${ch.codePointAt(0).toString(16)} must survive`);
        }
    });

    test('3. look-alikes are mapped to something drawable instead of dropped', () => {
        assert.equal(pdfSafe('A → B'), 'A -> B');
        assert.equal(pdfSafe('non‑breaking'), 'non-breaking');
        assert.equal(pdfSafe('a b'), 'a b');
        assert.equal(pdfSafe('● item'), '• item');
    });

    test('4. emoji, check marks and non-Latin letters are dropped, whitespace is collapsed, nothing throws', () => {
        assert.equal(pdfSafe('Won 🏆 award'), 'Won award');
        assert.equal(pdfSafe('Done ✓✓'), 'Done ');
        assert.equal(pdfSafe('a\n\tb'), 'a b');
        assert.equal(pdfSafe(null), '');
        assert.equal(pdfSafe(undefined), '');
        assert.equal(pdfSafe(42), '42');
    });

    test('5. every piece of text in every template is drawable, even when the data is full of arrows', async () => {
        const measure = await getMeasure();
        const dirty = {
            name: `Gopal Muri ${ARROW}`,
            contact: { email: 'g@x.com', phone: '1', location: '', links: [`github.com/g ${ARROW}`] },
            summary: `Builds things ${ARROW} fast 🚀`,
            skills: ['Java', `C${'✓'}`],
            experience: [{ title: `Intern ${ARROW}`, company: 'Acme → Corp', dates: 'Jun 2025', bullets: [`Did a thing ${ARROW}`] }],
            projects: [{ name: `Crowd Analytics [GitHub ${ARROW}]`, description: '', bullets: [`Shipped ${ARROW} it`], tech: ['Python'], dates: 'Jul 2025' }],
            education: [{ degree: 'B.E.', institution: 'KLS', dates: '2022 – 2026', details: 'CGPA: 9.00' }],
            certifications: [`Cert ${ARROW}`],
            achievements: [`Top performer ${ARROW}`],
        };
        for (const id of ['classic', 'modern', 'compact']) {
            const { pages } = layoutResume(dirty, id, measure);
            const bad = pages.flatMap((p) => p.items).filter((it) => it.k === 'text').filter((it) => Array.from(it.text).some((c) => !drawable(c)));
            assert.deepEqual(bad, [], `${id}: undrawable characters reached the layout`);
        }
    });

    test('6. project dates and an Achievements section reach the blocks', () => {
        const blocks = buildBlocks({
            name: 'A', projects: [{ name: 'P', dates: 'Jul 2025', bullets: [], tech: [] }], achievements: ['Won a hackathon'],
        });
        assert.equal(blocks.find((b) => b.t === 'entry' && b.left === 'P').right, 'Jul 2025');
        assert.deepEqual(blocks.filter((b) => b.t === 'heading').map((b) => b.text), ['Projects', 'Achievements']);
        assert.equal(blocks.find((b) => b.t === 'bullet').text, 'Won a hackathon');
    });
});
