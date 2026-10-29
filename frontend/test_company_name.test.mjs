import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from './test_support/bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf-8');
const rolesSrc = read('src/components/admin/JobRoleManager.jsx');
const linksSrc = read('src/components/admin/SharedLinkManager.jsx');
const dossierSrc = read('src/components/admin/CandidateReportModal.jsx');
const entrySrc = read('src/pages/candidate/SharedAssessmentEntry.jsx');
const instructionsSrc = read('src/pages/candidate/ExamInstructions.jsx');
const retestSrc = read('src/pages/candidate/RetestAssessmentPage.jsx');

describe('New Job Role form: Company Name (optional) replaces Role / team (optional)', () => {
    test('1. the label and placeholder are replaced; the other fields, layout and wording are unchanged', () => {
        assert.ok(rolesSrc.includes('<span className={labelCls}>Company Name (optional)</span>'));
        assert.ok(rolesSrc.includes('placeholder="e.g. Google, Microsoft, Infosys"'));
        assert.ok(!rolesSrc.includes('Role / team') && !rolesSrc.includes('Platform Engineering') && !rolesSrc.includes('form.role'), 'the old field is gone');
        for (const kept of ['<span className={labelCls}>Job title</span>', 'placeholder="e.g. Senior Backend Engineer"', 'New Job Role', 'Create job role', '<JobDescriptionInput']) assert.ok(rolesSrc.includes(kept), kept);
        assert.ok(rolesSrc.includes('<div className="grid sm:grid-cols-2 gap-4">'), 'same two-column grid');
        assert.ok(rolesSrc.includes('value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} maxLength={200}'), 'same input component and limit');
    });

    test('2. the field is optional: no validation mentions it and an empty value is simply not sent', () => {
        const submit = rolesSrc.slice(rolesSrc.indexOf('const createRole'), rolesSrc.indexOf('setCreating(true)'));
        assert.ok(!/company/i.test(submit), 'no required / format validation for the company name');
        assert.ok(rolesSrc.includes('company_name: form.companyName.trim() || undefined'));
        assert.ok(!rolesSrc.includes('<span className={labelCls}>Company Name (optional)</span>\n                        <input required'));
    });

    let calls;
    beforeEach(() => { globalThis.__axiosResponse = {}; calls = (globalThis.__axiosCalls ||= []); calls.length = 0; });

    test('3. the API call carries company_name when given and omits it when empty (JSON drops undefined)', async () => {
        const { adminApi } = await loadModule('src/services/recruitmentApi.js');
        await adminApi.createRole({ title: 'T', company_name: 'Infosys'.trim() || undefined, description: 'D' });
        await adminApi.createRole({ title: 'T', company_name: ''.trim() || undefined, description: 'D' });
        assert.equal(JSON.parse(JSON.stringify(calls[0].body)).company_name, 'Infosys');
        assert.ok(!('company_name' in JSON.parse(JSON.stringify(calls[1].body))), 'nothing is sent for an empty company name');
        assert.ok(calls.every((c) => c.url.endsWith('/api/admin/job-roles/') && c.method === 'post'));
    });
});

describe('The company name is displayed only where it was provided', () => {
    test('4. admin cards, the dossier header and the candidate pages show it when present, and never print null / undefined', () => {
        assert.ok(rolesSrc.includes('{role.company_name && <span'), 'job role card');
        assert.ok(linksSrc.includes('{role.company_name && <span'), 'shared link card');
        assert.ok(dossierSrc.includes("data.job_role?.company_name ? ` · ${data.job_role.company_name}` : ''"), 'dossier header');
        assert.ok(entrySrc.includes("{meta.company_name || meta.organization_name || 'Hiring Assessment'}"), 'entry page: company, else the existing organization name / fallback');
        assert.ok(instructionsSrc.includes('{meta.company_name || meta.organization_name}') && instructionsSrc.includes('(meta.company_name || meta.organization_name) &&'), 'instructions');
        assert.ok(retestSrc.includes('{info.assessment.company_name || info.assessment.organization_name}'), 'retest page');
        for (const src of [rolesSrc, linksSrc, dossierSrc]) assert.ok(!/\$\{[^}]*company_name\}[^`]*null|company_name\s*\?\?\s*['"]null/.test(src));
    });

    test('5. unrelated parts are untouched: job title, description handling, publishing and link rules are not part of this change', () => {
        assert.ok(rolesSrc.includes('<h3 className="pw-card-title text-[17px] break-words">{role.title}</h3>'), 'title rendering');
        assert.ok(rolesSrc.includes('const MIN_JD_CHARS = 50') && rolesSrc.includes('if (form.title.trim().length < 2)'));
        assert.ok(rolesSrc.includes('adminApi.publishRole') && rolesSrc.includes('adminApi.generateBlueprint'));
    });
});
