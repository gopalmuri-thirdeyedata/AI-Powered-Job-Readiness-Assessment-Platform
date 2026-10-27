// Word counting for the mandatory exam review.
//
// MUST stay identical to backend/services/review_policy.py: a word is a maximal run of non-whitespace characters, and
// "whitespace" is this explicit set (what JavaScript's \s matches, spelled out so no language's own definition can drift).
// Both sides are tested against the same vectors (backend/tests/data/word_count_cases.json). The server is the authority;
// this only drives the live counter and the enabled state of the Submit Review button.

export const MIN_REVIEW_WORDS = 30;
export const MAX_REVIEW_CHARS = 5000;

const SEPARATOR = /[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/;

export const countWords = (text) => String(text ?? '').split(SEPARATOR).filter(Boolean).length;

/** The message shown for a review that cannot be submitted, or '' when it can. */
export const reviewProblem = (text) => {
    const words = countWords(text);
    if (words === 0) return `Write your exam review. It must contain at least ${MIN_REVIEW_WORDS} words.`;
    if (words < MIN_REVIEW_WORDS) {
        const missing = MIN_REVIEW_WORDS - words;
        return `Your review needs at least ${MIN_REVIEW_WORDS} words. Write ${missing} more word${missing === 1 ? '' : 's'}.`;
    }
    if (String(text).trim().length > MAX_REVIEW_CHARS) return `Your review is too long. Please keep it under ${MAX_REVIEW_CHARS} characters.`;
    return '';
};
