import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    safeText,
    candidateDossierFileName,
    buildCandidateDossierPdf,
} from './src/utils/candidateDossierPdf.js';

const MOCK_DOSSIER = {
    candidate: {
        id: 42,
        name: 'Suprit Roy',
        email: 'suprit.roy@example.com',
        phone: '+1 555-0199',
        registered_at: '2026-10-25T10:30:00Z',
        contact_verified: false,
    },
    job_role: {
        id: 7,
        title: 'Senior Full Stack Engineer',
        company_name: 'ThirdEye Data',
    },
    status: 'COMPLETED',
    session: {
        state: 'COMPLETED',
        started_at: '2026-10-25T11:00:00Z',
        finalized_at: '2026-10-25T12:15:00Z',
        rules_acknowledged_at: '2026-10-25T10:59:00Z',
        incident_reference_id: null,
    },
    report: {
        scoring_model: 'EQUAL_WEIGHT',
        overall_score: 87.5,
        sections: {
            aptitude: {
                score: 85.0,
                status: 'EVALUATED',
                proctoring: { count: 0, events: [] },
                details: {
                    total: 10,
                    correct: 8,
                    questions: [
                        { id: 1, question: 'What is the time complexity of binary search?', selected: 'O(log n)', correct_key: 'O(log n)', is_correct: true },
                        { id: 2, question: 'Which data structure uses LIFO order?', selected: 'Queue', correct_key: 'Stack', is_correct: false },
                    ],
                },
            },
            coding: {
                score: 90.0,
                status: 'EVALUATED',
                proctoring: {
                    count: 1,
                    events: [{ type: 'FULLSCREEN_EXIT', timestamp: '2026-10-25T11:25:00Z' }],
                },
                details: {
                    problems: [
                        {
                            id: 101,
                            title: 'Two Sum Problem',
                            language: 'python',
                            score: 100,
                            passed_tests: 10,
                            total_tests: 10,
                            classification: 'ALL_PASSED',
                            message: null,
                            code: 'def twoSum(nums, target):\n    lookup = {}\n    for i, n in enumerate(nums):\n        diff = target - n\n        if diff in lookup:\n            return [lookup[diff], i]\n        lookup[n] = i\n    return []',
                        },
                    ],
                },
            },
            interview: {
                score: 87.5,
                status: 'EVALUATED',
                proctoring: { count: 0, events: [] },
                details: {
                    summary: 'Demonstrated deep conceptual knowledge of distributed systems and clean API design.',
                    questions: [
                        {
                            id: 201,
                            question_text: 'Explain how you approach optimistic locking in database transactions.',
                            score: 90,
                            response: 'I use a version column or timestamp to verify record state before committing updates.',
                            explanation: 'Clear, accurate explanation covering retry semantics and trade-offs.',
                        },
                    ],
                    transcript: [
                        { role: 'ai', text: 'Welcome Suprit. Let us start by discussing database transaction isolation levels.' },
                        { role: 'candidate', text: 'Thank you. Isolation levels specify how transaction integrity is visible to other users.' },
                    ],
                },
            },
        },
    },
    timeline: [
        { section: 'aptitude', status: 'EVALUATED', started_at: '2026-10-25T11:00:00Z', submitted_at: '2026-10-25T11:20:00Z', time_spent_seconds: 1200 },
        { section: 'coding', status: 'EVALUATED', started_at: '2026-10-25T11:21:00Z', submitted_at: '2026-10-25T11:51:00Z', time_spent_seconds: 1800 },
        { section: 'interview', status: 'EVALUATED', started_at: '2026-10-25T11:52:00Z', submitted_at: '2026-10-25T12:15:00Z', time_spent_seconds: 1380 },
    ],
    retests: [
        {
            retest_uuid: 'ret-123',
            label: 'Aptitude Round',
            status: 'COMPLETED',
            original_score: 60.0,
            retest_score: 85.0,
            assigned_at: '2026-10-24T09:00:00Z',
            assigned_by: 'admin@thirdeyedata.io',
            completed_at: '2026-10-24T10:00:00Z',
            reason: 'Network disconnect during initial attempt',
        },
    ],
    actions: { can_revoke: false, can_authorize_retake: false },
};

describe('Candidate Dossier PDF Generation & Sanitization', () => {
    test('1. safeText cleans typographic and special characters without throwing', () => {
        assert.equal(safeText('Smart “quotes” & ‘single’ — dash … bullet •'), 'Smart "quotes" & \'single\' - dash ... bullet -');
        assert.equal(safeText(null), '');
        assert.equal(safeText(undefined), '');
        assert.equal(safeText(12345), '12345');
        assert.equal(safeText({ key: 'val' }), '{"key":"val"}');
    });

    test('2. candidateDossierFileName produces properly formatted, sanitized filenames', () => {
        assert.equal(candidateDossierFileName({ candidate: { name: 'Suprit' } }), 'Candidate_Dossier_Suprit.pdf');
        assert.equal(candidateDossierFileName({ candidate: { name: 'Suprit Roy' } }), 'Candidate_Dossier_Suprit_Roy.pdf');
        assert.equal(candidateDossierFileName({ candidate: { name: 'Jane / Doe <Admin>!' } }), 'Candidate_Dossier_Jane_Doe_Admin.pdf');
        assert.equal(candidateDossierFileName({ candidate: { id: 99 } }), 'Candidate_Dossier_Candidate_99.pdf');
        assert.equal(candidateDossierFileName({}), 'Candidate_Dossier_Candidate_Report.pdf');
    });

    test('3. buildCandidateDossierPdf outputs a valid PDF binary buffer (%PDF-)', async () => {
        const doc = await buildCandidateDossierPdf(MOCK_DOSSIER);
        assert.ok(doc, 'returns jsPDF doc instance');
        const buffer = Buffer.from(doc.output('arraybuffer'));
        assert.ok(buffer.length > 1000, 'has non-trivial PDF size');
        assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-');
        assert.ok(doc.getNumberOfPages() >= 1, 'contains at least one page');
    });

    test('4. handles unstarted/registered candidate with null report and no questions gracefully', async () => {
        const unstarted = {
            candidate: {
                id: 10,
                name: 'New Candidate',
                email: 'new@example.com',
                registered_at: '2026-10-26T08:00:00Z',
            },
            job_role: { title: 'Junior QA' },
            status: 'REGISTERED',
            session: null,
            report: null,
            timeline: [],
            retests: [],
        };
        const doc = await buildCandidateDossierPdf(unstarted);
        assert.ok(doc);
        const buffer = Buffer.from(doc.output('arraybuffer'));
        assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-');
    });

    test('5. throws an error when provided invalid/empty data', async () => {
        await assert.rejects(() => buildCandidateDossierPdf(null), /required/i);
        await assert.rejects(() => buildCandidateDossierPdf('string'), /required/i);
    });
});

describe('Candidate Dossier Modal Print & Export Integration', () => {
    const modalSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/admin/CandidateReportModal.jsx'), 'utf-8');

    test('6. dedicated print stylesheet configures A4 page, removes modal clipping and resets backgrounds', () => {
        assert.ok(modalSrc.includes('@page {'), 'defines @page rules');
        assert.ok(modalSrc.includes('size: A4 portrait;'), 'specifies A4 portrait page dimensions');
        assert.ok(modalSrc.includes('@media print {'), 'defines @media print stylesheet');
        assert.ok(modalSrc.includes('overflow: visible !important;'), 'removes overflow clipping');
        assert.ok(modalSrc.includes('max-height: none !important;'), 'removes max-height restrictions');
        assert.ok(modalSrc.includes('.pw-no-print') && modalSrc.includes('display: none !important;'), 'hides UI chrome in print');
    });

    test('7. print layout expands all details accordions and repeats table headers across pages', () => {
        assert.ok(modalSrc.includes('.pw-print-root details {') && modalSrc.includes('display: block !important;'), 'forces all details sections open');
        assert.ok(modalSrc.includes('thead {') && modalSrc.includes('display: table-header-group !important;'), 'repeats table headers on page breaks');
        assert.ok(modalSrc.includes('tr {') && modalSrc.includes('break-inside: avoid !important;'), 'prevents awkward table row breaks');
        assert.ok(modalSrc.includes('handlePrint') && modalSrc.includes("el.setAttribute('open', 'true')"), 'expands details before window.print()');
        assert.ok(modalSrc.includes('beforeprint'), 'registers beforeprint listener for Ctrl+P printing');
    });

    test('8. print view renders official PrepWin branding and report title in dedicated header', () => {
        assert.ok(modalSrc.includes('/logo_main.png'), 'uses official logo asset');
        assert.ok(modalSrc.includes('pw-print-header'), 'has dedicated print header');
        assert.ok(modalSrc.includes('PrepWin'), 'contains PrepWin brand name');
        assert.ok(modalSrc.includes('Candidate Assessment Dossier'), 'contains official report title');
    });

    test('9. export button generates professional candidate dossier PDF with sanitized filename', () => {
        assert.ok(modalSrc.includes('downloadCandidateDossierPdf(data)'), 'calls PDF download generator');
        assert.ok(modalSrc.includes('exportPdf'), 'defines exportPdf handler');
        assert.ok(modalSrc.includes('exportJson'), 'preserves exportJson for backwards compatibility');
        assert.ok(modalSrc.includes('onClick={exportPdf}'), 'wires export button to PDF generation');
    });

    test('10. strict brand color tokens preserved with no stray hex colors', () => {
        assert.ok(!/#[0-9a-f]{6}/i.test(modalSrc.replace(/#5d8c2c|#4c7324|#9fd05a/gi, '')), 'no stray hard-coded hex colors');
    });
});
