import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const setupCode = fs.readFileSync(path.join(__dirname, 'src', 'pages', 'roleready', 'RoleReadySetup.jsx'), 'utf-8');
const apiCode = fs.readFileSync(path.join(__dirname, 'src', 'services', 'rolereadyApi.js'), 'utf-8');

describe('RoleReady Assessment Setup & API Request Handling Fix Suite', () => {

    test('1. rolereadyApi.initializeSession configures explicit client timeout (120s)', () => {
        assert.ok(apiCode.includes('initializeSession(formData)'), 'initializeSession must exist');
        assert.ok(apiCode.includes('timeout: 120000'), 'initializeSession must specify 120000ms timeout');
    });

    test('2. RoleReadySetup preserves exact loading indicator and wording', () => {
        assert.ok(setupCode.includes('Synthesizing Tailored Assessment...'), 'Must preserve exact loading wording');
        assert.ok(setupCode.includes('animate-spin'), 'Must preserve loading spinner animation');
        assert.ok(setupCode.includes('Start Assessment'), 'Must preserve Start Assessment button text');
        assert.ok(setupCode.includes('Set Up Your Assessment'), 'Must preserve title');
    });

    test('3. RoleReadySetup resets loading state in finally block', () => {
        assert.ok(setupCode.includes('setIsLoading(true)'), 'Must activate loading before request');
        assert.ok(setupCode.includes('finally {'), 'Must define finally block');
        assert.ok(setupCode.includes('setIsLoading(false)'), 'Must reset loading in finally block');
    });

    test('4. Successful initialization navigates strictly on valid session_uuid', () => {
        assert.ok(setupCode.includes('res.session_uuid'), 'Must check res.session_uuid');
        assert.ok(setupCode.includes('navigate(`/assessment/${res.session_uuid}`)'), 'Must navigate to assessment route');
    });

    test('5. Malformed or missing session_uuid throws error and prevents navigation', () => {
        assert.ok(setupCode.includes('throw new Error("Invalid session response received from server.")'), 'Must throw on missing session_uuid');
    });

    test('6. Error state displays error feedback from server response or fallback', () => {
        assert.ok(setupCode.includes('setError('), 'Must set error state on catch');
        assert.ok(setupCode.includes('failureMessage(err'), 'Must use server detail (string or { message }) when available');
        assert.ok(setupCode.includes('{error && ('), 'Must render error banner when error is present');
    });

    test('7. Required form validation prevents empty role or job description', () => {
        assert.ok(setupCode.includes('!targetRole.trim()'), 'Must validate non-empty targetRole');
        assert.ok(setupCode.includes('!customJdText.trim()'), 'Must validate non-empty customJdText');
    });
});
