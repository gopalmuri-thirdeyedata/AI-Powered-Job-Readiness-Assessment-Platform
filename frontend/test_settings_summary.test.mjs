import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

describe('HiringAI Settings — Real-Time Resume Screening Summary Suite', () => {
    const settingsPath = path.resolve('src/pages/GlobalSettings.jsx');
    const content = fs.readFileSync(settingsPath, 'utf8');

    test('1. Real-Time Resume Screening Title & Description in Settings', () => {
        assert.ok(content.includes('Real-Time Resume Screening'), 'Title "Real-Time Resume Screening" must be present');
        assert.ok(content.includes('Resume screening now processes candidates sequentially and displays results progressively'), 
            'Feature description must explain sequential and progressive processing');
        assert.ok(content.includes('allowing recruiters to see candidate results without waiting for the entire batch to finish'),
            'Benefit for recruiters must be clearly stated');
    });

    test('2. 5 Processing Stages Pipeline (Parsing -> Extracting -> Matching -> Scoring -> Candidate Result)', () => {
        assert.ok(content.includes('Sequential Processing Pipeline'), 'Pipeline heading must exist');
        assert.ok(content.includes("'Parsing'"), 'Stage 1: Parsing must exist');
        assert.ok(content.includes("'Extracting'"), 'Stage 2: Extracting must exist');
        assert.ok(content.includes("'Matching'"), 'Stage 3: Matching must exist');
        assert.ok(content.includes("'Scoring'"), 'Stage 4: Scoring must exist');
        assert.ok(content.includes("'Candidate Result'"), 'Stage 5: Candidate Result must exist');
    });

    test('3. Progressive Results & Live Advancements Specifications', () => {
        assert.ok(content.includes('Progressive Candidate Results'), 'Progressive Candidate Results header must exist');
        assert.ok(content.includes('Completed candidates appear immediately in the screening results while the remaining resumes continue processing'),
            'Immediate appearance of candidates must be documented');
        assert.ok(content.includes('Results are automatically sorted by match score'),
            'Automatic score sorting must be documented');
        assert.ok(content.includes('The active processing indicator advances to the next resume'),
            'Active indicator advancement must be documented');
        assert.ok(content.includes('The processing state closes automatically after all resumes are completed'),
            'Automatic closure of processing state must be documented');
    });

    test('4. Candidate Email Validation & Security Rules', () => {
        assert.ok(content.includes('Candidate Email Validation'), 'Candidate Email Validation section must exist');
        assert.ok(content.includes('Invalid or placeholder candidate email addresses are rejected and are not saved as candidate records'),
            'Email validation and non-saving behavior must be documented');
    });

    test('5. Backward Compatibility Documentation', () => {
        assert.ok(content.includes('Backward Compatible'), 'Backward Compatible section must exist');
        assert.ok(content.includes('Existing resume screening functionality remains available, including the standard screening workflow'),
            'Preservation of standard screening workflow must be documented');
    });

    test('6. System Verification Status Badges', () => {
        assert.ok(content.includes('Verification Status'), 'Verification Status section must exist');
        assert.ok(content.includes("'Resume Streaming'"), 'Resume Streaming verification must exist');
        assert.ok(content.includes("'Progressive Results'"), 'Progressive Results verification must exist');
        assert.ok(content.includes("'Candidate Validation'"), 'Candidate Validation verification must exist');
        assert.ok(content.includes("'Score Ranking'"), 'Score Ranking verification must exist');
        assert.ok(content.includes("'Production Build'"), 'Production Build verification must exist');
    });

    test('7. Responsive Navigation & No Duplicate Cards', () => {
        assert.ok(content.includes("id: 'system', label: 'System Summary'"), 'System Summary tab must be registered');
        assert.ok(content.includes("id: 'scoring', label: 'AI Resume Screening'"), 'Scoring tab must reflect AI Resume Screening');
        // Check that RealTimeResumeScreeningCard component is defined once
        const occurrences = (content.match(/const RealTimeResumeScreeningCard =/g) || []).length;
        assert.strictEqual(occurrences, 1, 'RealTimeResumeScreeningCard component must only be defined once');
    });
});
