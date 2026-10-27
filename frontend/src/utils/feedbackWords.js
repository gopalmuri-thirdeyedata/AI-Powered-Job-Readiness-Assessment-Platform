// Word counting for the feedback gate. It mirrors backend/services/assessment_feedback.py: a word is a space-separated piece that holds
// a letter or a digit, so punctuation on its own ("-- -- --") never counts. The server re-checks; this only drives the live
// counter and the button.
export const MIN_FEEDBACK_WORDS = 20;

const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

export const countWords = (text) => String(text || '').split(/\s+/).filter((piece) => HAS_LETTER_OR_DIGIT.test(piece)).length;
