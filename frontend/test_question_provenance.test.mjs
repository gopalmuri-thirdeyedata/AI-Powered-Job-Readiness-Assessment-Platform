import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { provenanceLabels } from './src/utils/questionProvenance.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf-8');
const assessmentCode = read('./src/pages/roleready/RoleReadyAssessment.jsx');
const componentCode = read('./src/components/roleready-ui/QuestionProvenance.jsx');

describe('question provenance badges', () => {
    test('shows nothing without verified source info', () => {
        assert.deepStrictEqual(provenanceLabels(undefined), []);
        assert.deepStrictEqual(provenanceLabels(null), []);
        assert.deepStrictEqual(provenanceLabels({}), []);
        assert.deepStrictEqual(provenanceLabels('Google'), []);
    });

    test('company, times asked and year are each optional', () => {
        const all = provenanceLabels({ company: 'Acme Corp', times_asked: 3, year: 2023 }, 2026);
        assert.deepStrictEqual(all.map((l) => l.text), ['Acme Corp', 'Asked 3 times', '2023']);
        assert.deepStrictEqual(provenanceLabels({ company: 'Acme Corp' }, 2026).map((l) => l.text), ['Acme Corp']);
        assert.deepStrictEqual(provenanceLabels({ year: 2022 }, 2026).map((l) => l.text), ['2022']);
        assert.deepStrictEqual(provenanceLabels({ company: 'Acme', times_asked: 1 }, 2026).map((l) => l.text), ['Acme', 'Asked once']);
    });

    test('a count or a bad year is never shown on its own', () => {
        assert.deepStrictEqual(provenanceLabels({ times_asked: 5 }, 2026), []);
        assert.deepStrictEqual(provenanceLabels({ company: 'Acme', year: 1800, times_asked: 0 }, 2026).map((l) => l.text), ['Acme']);
        assert.deepStrictEqual(provenanceLabels({ year: 2090 }, 2026), []);
    });

    test('every question shows a company: verified "Asked at", otherwise "Company style"', () => {
        assert.deepStrictEqual(provenanceLabels(undefined, 2026, 'Acme Corp').map((l) => l.text), ['Company style: Acme Corp']);
        assert.deepStrictEqual(provenanceLabels({}, 2026, 'Acme Corp').map((l) => l.text), ['Company style: Acme Corp']);
        assert.deepStrictEqual(provenanceLabels({ company: 'Google', year: 2023 }, 2026, 'Acme Corp').map((l) => l.text), ['Google', '2023']);
        assert.deepStrictEqual(provenanceLabels(undefined, 2026, ''), []);
        assert.deepStrictEqual(provenanceLabels(undefined, 2026, '  Acme   Corp '), [{ key: 'style', text: 'Company style: Acme Corp' }]);
    });

    test('aptitude Category row and coding difficulty row render the chips, mobile responsive', () => {
        assert.ok(assessmentCode.includes('<QuestionProvenance provenance={activeQ.provenance} styleCompany={activeQ.style_company} />'));
        assert.ok(assessmentCode.includes('<QuestionProvenance provenance={activeProblem.provenance} styleCompany={activeProblem.style_company} />'));
        assert.ok(componentCode.includes('flex-wrap'));
        assert.ok(componentCode.includes('if (!labels.length) return null'));
    });
});
