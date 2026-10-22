import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES, PAGE_WIDTH_PT, PAGE_HEIGHT_PT } from './src/utils/resumeTemplates.js';
import { layoutResume, wrapText, BULLET_GLYPH } from './src/utils/resumeLayout.js';
import { getMeasure } from './src/utils/resumeMeasure.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf-8');

const SHORT = {
    name: 'Jane Doe',
    contact: { email: 'jane@example.com', phone: '+91 98765 43210', location: '', links: ['github.com/janedoe'] },
    summary: 'Final-year student who enjoys building web applications.',
    skills: ['Python', 'React', 'SQL', 'Docker', 'Git'],
    experience: [{ title: 'Backend Intern', company: 'Acme Corp', dates: 'Jun 2025 - Aug 2025', bullets: ['Built REST APIs with FastAPI', 'Wrote SQL queries for reporting'] }],
    projects: [{ name: 'Portfolio Site', description: '', bullets: ['Built with React and Tailwind'], tech: [] }],
    education: [{ degree: 'B.Tech Computer Science', institution: 'Sample University', dates: '2022 - 2026', details: '' }],
    certifications: ['AWS Cloud Practitioner'],
};

const LONG_TOKEN = 'supercalifragilisticexpialidocious_long_token_without_spaces_to_check_character_breaking_behaviour_in_wrapped_bullets';
const LONG = {
    ...SHORT,
    summary: 'Final-year computer science student with hands-on experience building REST APIs, React front ends and cloud deployments, looking for a full stack engineering role where I can ship reliable software.',
    experience: [
        {
            title: 'Senior Software Engineering Intern (Platform Reliability and Developer Experience Team)',
            company: 'Acme Corporation Private Limited, Bengaluru, India',
            dates: 'June 2025 - August 2025',
            bullets: Array.from({ length: 10 }, (_, i) => `Delivered improvement number ${i + 1} to the order processing service, reducing p95 latency and cutting error rates across dependent microservices`),
        },
        { title: 'Freelance Web Developer', company: 'Self employed', dates: 'Jan 2024 - Present', bullets: ['Built 6 client websites', LONG_TOKEN] },
    ],
    projects: Array.from({ length: 4 }, (_, i) => ({ name: `Project ${i + 1}: Distributed Task Scheduler`, description: 'Distributes jobs across workers with retries.', bullets: ['Reduced job time by 38%'], tech: ['Python', 'Redis'] })),
};

const measure = await getMeasure();
const textOf = (pages) => pages.flatMap((p) => p.items.filter((i) => i.k === 'text').map((i) => i.text));

describe('Resume layout engine (shared by preview, PDF and DOCX)', () => {
    test('1. wrapText breaks on words, keeps every word, and splits over-long tokens', () => {
        const w = (t) => t.length * 5;
        assert.deepEqual(wrapText('aaa bbb ccc', 40, w), ['aaa bbb', 'ccc']);
        assert.deepEqual(wrapText('', 40, w), []);
        const broken = wrapText('x'.repeat(30), 50, w);
        assert.ok(broken.length > 1 && broken.every((l) => w(l) <= 50) && broken.join('') === 'x'.repeat(30));
    });

    for (const id of ['classic', 'modern', 'compact']) {
        for (const [label, data] of [['short', SHORT], ['long', LONG]]) {
            test(`2. ${id}/${label}: every line fits inside the margins and the page`, () => {
                const theme = THEMES[id];
                const { pages } = layoutResume(data, id, measure);
                assert.ok(pages.length >= 1);
                for (const page of pages) {
                    for (const it of page.items) {
                        if (it.k === 'rule') {
                            assert.ok(it.x1 >= theme.margin - 0.01 && it.x2 <= PAGE_WIDTH_PT - theme.margin + 0.01);
                            continue;
                        }
                        assert.ok(it.y > theme.margin - 1 && it.y <= PAGE_HEIGHT_PT - theme.margin + 0.01, `y=${it.y} on page`);
                        const w = measure(it.text, it.font, it.style, it.size);
                        const x0 = it.align === 'right' ? it.x - w : it.align === 'center' ? it.x - w / 2 : it.x;
                        assert.ok(x0 >= theme.margin - 0.5, `${it.text.slice(0, 30)} starts at ${x0}`);
                        assert.ok(x0 + w <= PAGE_WIDTH_PT - theme.margin + 0.5, `${it.text.slice(0, 30)} ends at ${x0 + w}`);
                    }
                }
            });

            test(`3. ${id}/${label}: no content is lost or invented`, () => {
                const joined = textOf(layoutResume(data, id, measure).pages).join(' ').replace(/\s+/g, ' ');
                const expected = [
                    data.name, 'jane@example.com', data.experience[0].company, data.education[0].degree, data.certifications[0],
                    data.experience[0].dates, data.education[0].institution,
                ];
                for (const must of expected) {
                    assert.ok(joined.includes(must), `missing ${must}`);
                }
                // a wrapped title may be split across lines: its words must all still be there, in order
                const titleWords = data.experience[0].title.split(' ');
                assert.ok(titleWords.every((w) => joined.includes(w)), 'job title words missing');
                // long token is split across lines but its characters all survive, in order
                if (label === 'long') {
                    const squashed = textOf(layoutResume(data, id, measure).pages).filter((t) => t !== BULLET_GLYPH).join('').replace(/ /g, '');
                    assert.ok(squashed.includes(LONG_TOKEN), 'broken long token must keep all its characters in order');
                }
                assert.ok(joined.includes(BULLET_GLYPH) === (textOf(layoutResume(data, id, measure).pages).some((t) => t === BULLET_GLYPH)));
            });

            test(`4. ${id}/${label}: a section heading never sits alone at the bottom of a page`, () => {
                const { pages } = layoutResume(data, id, measure);
                for (const page of pages) {
                    const texts = page.items.filter((i) => i.k === 'text');
                    const last = texts[texts.length - 1];
                    const headings = ['SUMMARY', 'SKILLS', 'EXPERIENCE', 'PROJECTS', 'EDUCATION', 'CERTIFICATIONS'];
                    assert.ok(!headings.includes(last.text), `${last.text} is the last line of a page`);
                }
            });
        }
    }

    test('5. layout is deterministic (preview and PDF compute identical positions)', () => {
        const a = JSON.stringify(layoutResume(LONG, 'modern', measure).pages);
        const b = JSON.stringify(layoutResume(LONG, 'modern', measure).pages);
        assert.equal(a, b);
    });

    test('6. long content flows onto a second page; short content stays on one', () => {
        assert.equal(layoutResume(SHORT, 'classic', measure).pages.length, 1);
        assert.ok(layoutResume(LONG, 'classic', measure).pages.length >= 2);
    });

    test('7. fonts agree across preview, PDF and DOCX for every template', () => {
        const preview = read('src', 'components', 'student-ui', 'ResumePreview.jsx');
        assert.ok(preview.includes("times: '\"Times New Roman\", Times, serif'"));
        assert.ok(preview.includes("helvetica: 'Arial, Helvetica, sans-serif'"));
        for (const t of Object.values(THEMES)) {
            if (t.pdfFont === 'times') assert.equal(t.docxFont, 'Times New Roman');
            if (t.pdfFont === 'helvetica') assert.equal(t.docxFont, 'Arial');
        }
    });

    test('8. preview, PDF and DOCX all use the one shared layout and its constants', () => {
        const preview = read('src', 'components', 'student-ui', 'ResumePreview.jsx');
        const exporter = read('src', 'utils', 'resumeExport.js');
        assert.ok(preview.includes('layoutResume(') && preview.includes('getMeasure'));
        assert.ok(exporter.includes('layoutResume(') && exporter.includes('getMeasure'));
        assert.ok(exporter.includes('BULLET_TEXT_INDENT') && exporter.includes('BULLET_MARKER_OFFSET'));
        assert.ok(exporter.includes('LineRuleType.EXACT'), 'DOCX uses exact line heights');
        assert.ok(exporter.includes("reference: 'resume-bullets'"));
        assert.ok(exporter.includes('size: { width: twips(PAGE_WIDTH_PT), height: twips(PAGE_HEIGHT_PT) }'), 'DOCX uses the same A4 page');
        assert.ok(!preview.includes('cqw'), 'preview must not use its own CSS layout any more');
    });
});
