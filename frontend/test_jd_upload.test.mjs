import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './test_support/bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf-8');
const inputSrc = read('src/components/admin/JobDescriptionInput.jsx');
const rolesSrc = read('src/components/admin/JobRoleManager.jsx');

describe('Job description file validation (client side; the server repeats it)', () => {
    test('1. accepts pdf, docx and txt in any case', async () => {
        const { validateJdFile } = await loadModule('src/utils/jdUpload.js');
        for (const name of ['jd.pdf', 'JD.DOCX', 'notes.Txt', 'my.job.description.pdf']) assert.equal(validateJdFile({ name, size: 2048 }), null, name);
    });

    test('2. rejects unsupported, legacy, empty and oversized files with a useful message', async () => {
        const { validateJdFile, JD_MAX_BYTES } = await loadModule('src/utils/jdUpload.js');
        assert.match(validateJdFile({ name: 'jd.exe', size: 10 }), /Unsupported file type/);
        assert.match(validateJdFile({ name: 'jd', size: 10 }), /Unsupported file type/);
        assert.match(validateJdFile({ name: 'jd.png', size: 10 }), /\.pdf, \.docx or \.txt/);
        assert.match(validateJdFile({ name: 'old.doc', size: 10 }), /\.docx or \.pdf/);
        assert.match(validateJdFile({ name: 'jd.pdf', size: 0 }), /empty/);
        assert.equal(JD_MAX_BYTES, 10 * 1024 * 1024);
        assert.equal(validateJdFile({ name: 'jd.pdf', size: JD_MAX_BYTES }), null, 'exactly the limit is fine');
        assert.match(validateJdFile({ name: 'jd.pdf', size: JD_MAX_BYTES + 1 }), /limit is 10 MB/);
        assert.ok(validateJdFile(null));
    });

    test('3. file sizes are shown in readable units', async () => {
        const { formatBytes } = await loadModule('src/utils/jdUpload.js');
        assert.equal(formatBytes(512), '512 B');
        assert.equal(formatBytes(2048), '2.0 KB');
        assert.equal(formatBytes(150 * 1024), '150 KB');
        assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB');
    });
});

describe('Upload API client', () => {
    beforeEach(() => { (globalThis.__axiosCalls ||= []).length = 0; globalThis.__axiosResponse = { text: 'Backend Engineer', filename: 'jd.txt' }; });

    test('4. sends the file as multipart to the admin endpoint with cookie auth (no bearer header) and no JSON content type', async () => {
        const { adminApi } = await loadModule('src/services/recruitmentApi.js');
        const file = new File(['Backend Engineer'], 'jd.txt', { type: 'text/plain' });
        const res = await adminApi.extractDescription(file, { onUploadProgress: () => {} });
        const call = globalThis.__axiosCalls.at(-1);
        assert.equal(call.method, 'post');
        assert.equal(call.url, 'http://api.test/api/admin/job-roles/extract-description');
        assert.ok(call.body instanceof FormData && call.body.get('file').name === 'jd.txt');
        assert.ok(!('Authorization' in call.headers), 'the HttpOnly session cookie is the credential; no bearer header');
        assert.ok(!('Content-Type' in call.headers), 'axios/the browser must set the multipart boundary');
        assert.ok(call.timeout >= 30000);
        assert.equal(res.text, 'Backend Engineer');
    });
});

describe('Job description input behaviour', () => {
    test('5. offers exactly Write Manually and Upload File, defaulting to manual entry with the counter and minimum', async () => {
        const { default: Input } = await loadModule('src/components/admin/JobDescriptionInput.jsx');
        const html = renderToStaticMarkup(React.createElement(Input, { value: '', onChange: () => {}, minChars: 50 }));
        assert.match(html, /role="radiogroup"/);
        assert.match(html, /Write Manually/);
        assert.match(html, /Upload File/);
        assert.match(html, /<textarea/);
        assert.match(html, /0 characters \(minimum 50\)/);
        assert.doesNotMatch(html, /Choose file/, 'the upload area is only shown in upload mode');
    });

    test('6. upload mode shows the drop zone, accepted types and limit; the same text is kept when switching modes', async () => {
        const { default: Input } = await loadModule('src/components/admin/JobDescriptionInput.jsx');
        const empty = renderToStaticMarkup(React.createElement(Input, { value: '', onChange: () => {}, minChars: 50, initialMode: 'upload' }));
        assert.match(empty, /Choose file/);
        assert.match(empty, /PDF, DOCX or TXT, up to 10 MB/);
        assert.match(empty, /accept="\.pdf,\.docx,\.txt"/);
        assert.doesNotMatch(empty, /<textarea/, 'nothing to review yet');
        const typed = 'Typed by hand: Backend Engineer with Python and SQL experience for platform services';
        const manual = renderToStaticMarkup(React.createElement(Input, { value: typed, onChange: () => {}, minChars: 50, initialMode: 'manual' }));
        const upload = renderToStaticMarkup(React.createElement(Input, { value: typed, onChange: () => {}, minChars: 50, initialMode: 'upload' }));
        for (const html of [manual, upload]) {
            assert.ok(html.includes(typed), 'the text is visible and editable in both modes');
            assert.match(html, new RegExp(`${typed.length} characters \\(minimum 50\\)`));
        }
        assert.match(upload, /Choose file/);
    });

    test('7. one controlled value feeds both modes; extraction fills the editable box; typed text is never overwritten silently', () => {
        assert.ok(inputSrc.includes('value={value}') && inputSrc.includes('onChange(e.target.value)'), 'the text area edits the shared value');
        assert.ok(!/useState\(\s*value/.test(inputSrc), 'no private copy of the text that could be lost when switching');
        assert.ok(inputSrc.includes('onChange(res.text)'), 'extracted text populates the same field');
        assert.ok(inputSrc.includes('setPending(res.text)') && inputSrc.includes('Replace with file text') && inputSrc.includes('Keep my text'), 'asks before replacing typed text');
        assert.ok(inputSrc.includes('adminApi.extractDescription') && inputSrc.includes('validateJdFile(picked)'));
        for (const needle of ['Uploading', 'Extracting text', 'Replace', 'Remove', 'formatBytes(file.size)', 'role="alert"', 'if (id !== reqRef.current) return;']) {
            assert.ok(inputSrc.includes(needle), `upload UX: ${needle}`);
        }
        assert.ok(inputSrc.includes('abort()'), 'removing / replacing cancels an in-flight extraction');
    });

    test('8. choosing a file never creates, generates or publishes anything', () => {
        assert.ok(!/createRole|generateBlueprint|publishRole|closeRole|updateRole/.test(inputSrc));
        assert.equal((inputSrc.match(/adminApi\./g) || []).length, 1, 'the only API call is the text extraction');
    });

    test('9. the New Job Role form keeps its fields, validation and the same create call', () => {
        assert.ok(rolesSrc.includes('<JobDescriptionInput'));
        assert.ok(rolesSrc.includes('minChars={MIN_JD_CHARS}') && rolesSrc.includes('const MIN_JD_CHARS = 50'));
        assert.ok(rolesSrc.includes('if (form.description.trim().length < MIN_JD_CHARS)'), 'minimum-length validation is unchanged');
        assert.ok(rolesSrc.includes('adminApi.createRole({ title: form.title.trim(), company_name: form.companyName.trim() || undefined, description: form.description.trim() })'), 'submits the final (edited) description');
        for (const kept of ['Job title', 'Company Name (optional)', 'New Job Role', 'Create job role']) assert.ok(rolesSrc.includes(kept), kept);
        assert.ok(rolesSrc.includes('key={formKey}'), 'the upload state is cleared after a role is created');
    });
});

describe('Blueprint generation errors reach the admin as the server wrote them', () => {
    test('10. structured {code, message} details are shown as the message', async () => {
        const { errorMessage } = await loadModule('src/services/recruitmentApi.js');
        const err = { response: { status: 502, data: { detail: { code: 'quota', message: 'The Gemini account has run out of quota or prepaid credits.' } } } };
        assert.equal(errorMessage(err), 'The Gemini account has run out of quota or prepaid credits.');
    });
});

describe('Job Roles & Blueprints: Gemini is the only way to create a blueprint (the demo template is gone)', () => {
    const rolesSrc2 = fs.readFileSync(path.join(__dirname, 'src/components/admin/JobRoleManager.jsx'), 'utf-8');
    const apiSrc2 = fs.readFileSync(path.join(__dirname, 'src/services/recruitmentApi.js'), 'utf-8');

    test('11. no demo-template button, message, tooltip, state or handler remains on the role cards', () => {
        for (const needle of ['Use Demo Template', 'Demo template is available', 'demo_template', 'demoTemplate', 'useTemplate', 'replaceTarget',
            'LayoutTemplate', 'Replace with demo template', 'supported_roles', 'predefined', 'applyDemoTemplate', 'template_name']) {
            assert.ok(!rolesSrc2.includes(needle), `JobRoleManager must not contain: ${needle}`);
        }
        assert.ok(!/demo/i.test(rolesSrc2), 'no "demo" wording anywhere in the roles screen');
        assert.ok(!apiSrc2.includes('applyDemoTemplate') && !apiSrc2.includes('apply-demo-template'), 'the API client no longer exposes the endpoint');
        assert.ok(!rolesSrc2.includes("from '../ConfirmationModal'") && !rolesSrc2.includes('<ConfirmationModal'), 'its confirmation dialog went with it');
    });

    test('12. the remaining actions are intact: Edit JD, Create/Update Assessment, Preview Assessment, Publish, and the shared-link shortcut', () => {
        assert.ok(rolesSrc2.includes('<Pencil size={14} /> Edit JD'));
        assert.ok(rolesSrc2.includes("'Create Assessment'") && rolesSrc2.includes("'Update Assessment'"));
        assert.ok(rolesSrc2.includes('adminApi.generateBlueprint(role.id)'));
        assert.ok(rolesSrc2.includes('toggleBlueprint(role)') && rolesSrc2.includes('Preview Assessment'));
        assert.ok(rolesSrc2.includes('disabled={!hasValidBlueprint || !!b}') && rolesSrc2.includes('adminApi.publishRole'), 'publishing still needs a valid blueprint');
        assert.ok(rolesSrc2.includes("title={hasValidBlueprint ? '' : 'Create an assessment first'}"), 'the publish hint no longer mentions a template');
        assert.ok(rolesSrc2.includes("onNavigate('links')"));
        // all actions live in one flex-wrap row with a single gap: nothing is left over to misalign
        const row = rolesSrc2.slice(rolesSrc2.indexOf('<div className="flex flex-wrap gap-2">'), rolesSrc2.indexOf('{genErrors[role.id] && ('));
        assert.equal((row.match(/<button/g) || []).length, 5, 'Edit JD, Generate, Review, Publish, link');
    });

    test('13. a Gemini failure is shown as a failure on the card and in a toast, never as success', () => {
        const block = rolesSrc2.slice(rolesSrc2.indexOf('const generate = async'), rolesSrc2.indexOf('const toggleBlueprint'));
        const failure = block.slice(block.indexOf('} catch (err)'));
        assert.ok(failure.includes('setGenErrors(') && failure.includes("type: 'error'") && failure.includes('Nothing was changed'));
        assert.ok(!failure.includes('generated and validated'), 'the success message is only reachable on success');
        assert.ok(block.indexOf('generated and validated') < block.indexOf('} catch (err)'));
        assert.ok(rolesSrc2.includes('genErrors[role.id]') && rolesSrc2.includes('role="alert"'));
    });

    test('14. blueprint provenance badges: Gemini badge is not shown; offline test data is recognised (an unknown or legacy source shows nothing)', () => {
        assert.ok(!rolesSrc2.includes("label: 'Gemini'") && rolesSrc2.includes("offline_fixture: { label: 'Offline test data'"));
        assert.ok(rolesSrc2.includes('return meta ? <span') && rolesSrc2.includes(': null;'));
    });
});
