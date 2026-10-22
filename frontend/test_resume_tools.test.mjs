import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATES, THEMES, buildBlocks, exportFileName } from './src/utils/resumeTemplates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf-8');

const SAMPLE = {
    name: 'Jane Doe',
    contact: { email: 'jane@example.com', phone: '+91 98765 43210', location: '', links: ['github.com/janedoe'] },
    summary: 'Final-year student.',
    skills: ['Python', 'React', 'SQL'],
    experience: [{ title: 'Backend Intern', company: 'Acme Corp', dates: 'Jun 2025 - Aug 2025', bullets: ['Built REST APIs', ''] }],
    projects: [{ name: 'Portfolio', description: 'Personal site', bullets: ['Built with React'], tech: ['React', 'Tailwind'] }],
    education: [{ degree: 'B.Tech CS', institution: 'Sample University', dates: '2022 - 2026', details: '' }],
    certifications: ['AWS Cloud Practitioner'],
};

describe('Resume Formatter templates', () => {
    test('1. exactly three templates, each with a theme', () => {
        assert.deepEqual(TEMPLATES.map((t) => t.id), ['classic', 'modern', 'compact']);
        for (const t of TEMPLATES) assert.ok(THEMES[t.id], `theme for ${t.id}`);
    });

    test('2. blocks use standard ATS section headings in order', () => {
        const headings = buildBlocks(SAMPLE).filter((b) => b.t === 'heading').map((b) => b.text);
        assert.deepEqual(headings, ['Summary', 'Skills', 'Experience', 'Projects', 'Education', 'Certifications']);
    });

    test('3. blocks carry the candidate data and drop empty values', () => {
        const blocks = buildBlocks(SAMPLE);
        assert.equal(blocks[0].text, 'Jane Doe');
        assert.ok(blocks[1].text.includes('jane@example.com') && blocks[1].text.includes('github.com/janedoe'));
        assert.deepEqual(blocks.filter((b) => b.t === 'bullet').map((b) => b.text), ['Built REST APIs', 'Built with React', 'AWS Cloud Practitioner']);
        const job = blocks.find((b) => b.t === 'entry' && b.left === 'Backend Intern');
        assert.equal(job.sub, 'Acme Corp');
        assert.equal(job.right, 'Jun 2025 - Aug 2025');
    });

    test('4. sections with no content are omitted and nothing is invented', () => {
        const blocks = buildBlocks({ name: 'John Smith', skills: ['Go'] });
        assert.deepEqual(blocks.filter((b) => b.t === 'heading').map((b) => b.text), ['Skills']);
        assert.equal(buildBlocks(null).length, 0);
    });

    test('5. export file names are sanitized and include the template', () => {
        assert.equal(exportFileName(SAMPLE, 'modern', 'pdf'), 'Jane_Doe_Resume_Modern.pdf');
        assert.equal(exportFileName({ name: '  ../Évil/Name ' }, 'classic', 'docx'), 'vil_Name_Resume_Classic.docx');
        assert.equal(exportFileName({}, 'compact', 'pdf'), 'Resume_Resume_Compact.pdf');
    });

    test('6. templates are single column ATS layouts (no tables or images in the preview)', () => {
        const preview = read('src', 'components', 'student-ui', 'ResumePreview.jsx');
        assert.ok(!/<table|<img|<canvas/i.test(preview), 'preview must not use tables, images or canvas');
        assert.ok(/<text\b/.test(preview), 'preview text must be real <text> elements, not a picture of text');
    });
});

describe('Resume Analyzer and Formatter wiring', () => {
    test('7. sidebar renames Resume to Resume Analyzer and adds Resume Formatter', () => {
        const layout = read('src', 'layouts', 'StudentLayout.jsx');
        assert.ok(layout.includes("label: 'Resume Analyzer'") && layout.includes("path: '/student/resume'"));
        assert.ok(layout.includes("label: 'Resume Formatter'") && layout.includes("path: '/student/resume-formatter'"));
    });

    test('8. routes registered in both student route blocks', () => {
        const app = read('src', 'App.jsx');
        assert.ok(app.includes("import('./pages/student/StudentResumeFormatter')"));
        assert.ok(app.includes('path="resume-formatter"') && app.includes('path="/student/resume-formatter"'));
    });

    test('9. analyzer page offers both modes and the JD analyzer', () => {
        const page = read('src', 'pages', 'student', 'StudentResumeUpload.jsx');
        assert.ok(page.includes('Analyze Resume Without Job Description'));
        assert.ok(page.includes('Analyze Resume With Job Description'));
        assert.ok(page.includes('<ResumeJdAnalyzer'));
        const jd = read('src', 'components', 'student-ui', 'ResumeJdAnalyzer.jsx');
        for (const needle of ['Matching skills', 'Missing skills', 'fit_verdict', 'Recommendations']) {
            assert.ok(jd.includes(needle), `JD analyzer must show ${needle}`);
        }
    });

    test('10. API client calls the two new endpoints', () => {
        const api = read('src', 'services', 'studentApi.js');
        assert.ok(api.includes('/api/student/resume/analyze-jd') && api.includes('/api/student/resume/format'));
    });

    test('11. formatter page offers three templates with PDF and DOCX downloads', () => {
        const page = read('src', 'pages', 'student', 'StudentResumeFormatter.jsx');
        assert.ok(page.includes('TEMPLATES.map'));
        assert.ok(page.includes('id="fmt-download-pdf"') && page.includes('id="fmt-download-docx"'));
        const exp = read('src', 'utils', 'resumeExport.js');
        assert.ok(exp.includes("import('jspdf')") && exp.includes("import('docx')"));
    });
});
