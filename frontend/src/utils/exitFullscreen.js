// Leaves browser fullscreen once an assessment is over (after the FINAL submission has been accepted, never between sections).
//
// - Does nothing when the page is not in fullscreen, so it is safe to call more than once.
// - Calls made while an exit is already in flight share that one request (no duplicate exitFullscreen calls).
// - Never throws and never rejects: a browser that refuses (or has no Fullscreen API) just resolves to false, and the caller carries on.
// - Resolves to true only when the document really is out of fullscreen afterwards; it does not assume success.

const fullscreenElement = () => (typeof document === 'undefined' ? null
    : document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement || null);

let inFlight = null;

export const exitFullscreenSafely = () => {
    if (!fullscreenElement()) return Promise.resolve(false);
    if (inFlight) return inFlight;
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
    if (!exit) return Promise.resolve(false);
    inFlight = (async () => {
        try {
            await exit.call(document);
        } catch (err) {
            console.warn('[Fullscreen] Could not exit fullscreen:', err?.message || err);
        }
        return !fullscreenElement();
    })().finally(() => { inFlight = null; });
    return inFlight;
};

export default exitFullscreenSafely;
