// Pure helpers for the multi-language assessment coding round (no React, no network), so they can be unit tested on their own.
//
// A "new-style" problem carries a typed signature (`params`, `returns`), per-language `starter_code`, and examples with `args`.
// An "old-style" problem (the Student self-start flow) has none of that and stays Python only, exactly as before.

export const DEFAULT_LANGUAGE = 'python';

export const LANGUAGE_OPTIONS = {
    python: { label: 'Python3', monaco: 'python', comment: '#' },
    java: { label: 'Java', monaco: 'java', comment: '//' },
    cpp: { label: 'C++', monaco: 'cpp', comment: '//' },
    c: { label: 'C', monaco: 'c', comment: '//' },
};

export const languageLabel = (language) => LANGUAGE_OPTIONS[language]?.label || String(language || 'Python3');
export const monacoLanguage = (language) => LANGUAGE_OPTIONS[language]?.monaco || 'plaintext';

/** Languages a problem offers, in dropdown order: `languages` if sent, else the keys of `starter_code`, else Python alone. */
export const problemLanguages = (problem) => {
    const declared = Array.isArray(problem?.languages) && problem.languages.length
        ? problem.languages
        : Object.keys(problem?.starter_code || {});
    const known = [...new Set(declared.filter((l) => LANGUAGE_OPTIONS[l]))];
    return known.length ? known : [DEFAULT_LANGUAGE];
};

/** The dropdown entries for a problem, in its own order: the Assessment's list (Python3, Java, C++, C) restricted to what the problem offers. */
export const languageOptionsFor = (problem) => problemLanguages(problem).map((l) => ({ value: l, label: LANGUAGE_OPTIONS[l].label }));

/** Python when the problem offers it (every problem does today), otherwise its first language. */
export const defaultLanguage = (problem) => {
    const offered = problemLanguages(problem);
    return offered.includes(DEFAULT_LANGUAGE) ? DEFAULT_LANGUAGE : offered[0];
};

/** What the editor starts with: the server's LeetCode-style starter, or a comment-only stub when the server sent none. */
export const starterFor = (problem, language) => {
    const sent = problem?.starter_code?.[language];
    if (typeof sent === 'string' && sent.trim()) return sent;
    const title = problem?.title || 'this problem';
    if (language === 'python') return `# Write your Python solution for ${title}\ndef solve():\n    pass\n`;
    const option = LANGUAGE_OPTIONS[language];
    return `${option?.comment || '//'} Write your ${option?.label || language} solution for ${title}\n`;
};

export const isTypedProblem = (problem) => Array.isArray(problem?.params) && problem.params.length > 0;

// ── Test case inputs ───────────────────────────────────────────────────────────

/** "nums = [2,7]\ntarget = 9" -> [{ name: 'nums', value: '[2,7]' }, { name: 'target', value: '9' }]; null when the text is not in that shape. */
export const parseLabeledInput = (text) => {
    if (typeof text !== 'string' || !text.trim()) return null;
    const pairs = [];
    for (const line of text.split('\n')) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
        if (!m) return null;
        pairs.push({ name: m[1], value: m[2] });
    }
    return pairs.length ? pairs : null;
};

/** The one-line form used in the description, like LeetCode: "nums = [2,7,11,15], target = 9". */
export const inlineInput = (text) => {
    const pairs = parseLabeledInput(text);
    return pairs ? pairs.map((p) => `${p.name} = ${p.value}`).join(', ') : String(text ?? '');
};

/** The values of one example, one per parameter: the structured `args`, else read back from the display text. */
export const exampleValues = (problem, example) => {
    const params = problem?.params || [];
    if (Array.isArray(example?.args) && example.args.length === params.length) return example.args.map((a) => String(a));
    const pairs = parseLabeledInput(example?.input);
    return pairs && pairs.length === params.length ? pairs.map((p) => p.value) : params.map(() => '');
};

const collapse = (value) => String(value ?? '').replace(/\s*\n\s*/g, ' ').trim();

/** Why a custom case cannot be run yet, or null. */
export const customInputIssue = (problem, fields) => {
    const params = problem?.params || [];
    if (!params.length || !Array.isArray(fields)) return null;
    return fields.length !== params.length || fields.some((f) => !collapse(f)) ? 'Fill in every field of the custom case to run it.' : null;
};

/**
 * What Run sends as `customInput`: one JSON value per line, in parameter order. null when there is no custom case, when it is incomplete,
 * or when it equals one of the examples (those already run).
 */
export const customInputFor = (problem, fields) => {
    if (!isTypedProblem(problem) || customInputIssue(problem, fields) || !Array.isArray(fields)) return null;
    const clean = fields.map(collapse);
    const sameAsExample = (problem.public_test_cases || []).some((ex) => {
        const values = exampleValues(problem, ex).map(collapse);
        return values.length === clean.length && values.every((v, i) => v === clean[i]);
    });
    return sameAsExample ? null : clean.join('\n');
};

/** Constraints as separate lines, ready for a bullet list. */
export const constraintLines = (constraints) => String(constraints || '').split('\n').map((l) => l.replace(/^\s*[-*•]\s+/, '').trim()).filter(Boolean);
