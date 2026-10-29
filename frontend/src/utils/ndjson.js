// Reads a newline-delimited JSON response body (one JSON object per line) as it arrives.
// A network chunk can end in the middle of a line, so text is buffered until a newline is seen.

/**
 * @param {ReadableStream<Uint8Array>} body  the fetch() response body
 * @yields {object} one parsed event per complete line, in order
 */
export async function* readNdjson(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let newline = buffer.indexOf('\n');
            while (newline !== -1) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                if (line) yield JSON.parse(line);
                newline = buffer.indexOf('\n');
            }
        }
        buffer += decoder.decode();
        const rest = buffer.trim();
        if (rest) yield JSON.parse(rest);
    } finally {
        try { reader.releaseLock(); } catch { /* already released */ }
    }
}
