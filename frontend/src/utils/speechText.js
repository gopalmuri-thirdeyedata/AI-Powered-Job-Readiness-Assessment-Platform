// Pure helpers for voice typing (dictation) into answer boxes.

// Spoken punctuation commands. Browsers return dictated text without punctuation, so people say these.
// Only unambiguous phrases are commands: "period" and "colon" are ordinary words in an answer ("over a period of
// two years"), and "comma separated" / "new line character" are technical terms, so those are left alone.
const COMMANDS = [
    [/\bnew paragraph\b/gi, '\n\n'],
    [/\b(?:new line|next line)\b(?!\s+(?:character|char|escape))/gi, '\n'],
    [/\bquestion mark\b/gi, '?'],
    [/\b(?:exclamation mark|exclamation point)\b/gi, '!'],
    [/\bfull stop\b/gi, '.'],
    [/\bcomma\b(?!\s*[- ]?\s*(?:separated|delimited))/gi, ','],
];

/** Cleans one dictated chunk: collapses spaces and turns spoken punctuation into real punctuation. */
export const normalizeSpoken = (chunk) => {
    let text = String(chunk ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    for (const [pattern, symbol] of COMMANDS) text = text.replace(pattern, symbol);
    // punctuation attaches to the word before it, with no space in front
    text = text.replace(/\s+([.,;:?!])/g, '$1').replace(/ *\n */g, '\n');
    return text.trim();
};

const endsSentence = (text) => /[.!?]["')\]]?\s*$/.test(text) || /\n\s*$/.test(text);

/** Appends a dictated chunk to what is already typed: one space between, capital letter at a sentence start. */
export const appendTranscript = (existing, chunk) => {
    const spoken = normalizeSpoken(chunk);
    if (!spoken) return existing ?? '';
    const base = existing ?? '';
    if (!base.trim()) return spoken.charAt(0).toUpperCase() + spoken.slice(1);

    const startsNewSentence = endsSentence(base);
    const body = startsNewSentence ? spoken.charAt(0).toUpperCase() + spoken.slice(1) : spoken;
    const glue = /[\s]$/.test(base) || /^[.,;:?!\n]/.test(body) ? '' : ' ';
    return `${base}${glue}${body}`;
};

export const describeSpeechError = (code) => {
    switch (code) {
        case 'not-allowed':
        case 'service-not-allowed':
            return 'Microphone access is blocked. Click the lock icon in the address bar, allow the microphone, then try again.';
        case 'audio-capture':
            return 'No microphone was found. Plug one in and try again.';
        case 'network':
            return 'Voice typing needs an internet connection. Check it and try again, or type your answer.';
        case 'language-not-supported':
            return 'Voice typing does not support this language in your browser.';
        default:
            return 'Voice typing stopped unexpectedly. Click the microphone to start again, or type your answer.';
    }
};
