// Time-based progress for the "evaluating" overlay. The bar follows a fixed duration so it moves steadily,
// reaches ~96% when the expected time is up, then crawls towards 99% so a slow server still looks alive.
// It never reaches 100%: that is reserved for "the work really finished".

export const START_PERCENT = 4;
export const EXPECTED_END_PERCENT = 96;
export const MAX_WAITING_PERCENT = 99;
const CREEP_WINDOW_MS = 20000; // how long the slow crawl from 96% to 99% takes

export const timedProgress = (elapsedMs, expectedMs) => {
    const elapsed = Math.max(0, Number(elapsedMs) || 0);
    const expected = Math.max(1, Number(expectedMs) || 1);
    if (elapsed <= expected) {
        return START_PERCENT + ((EXPECTED_END_PERCENT - START_PERCENT) * elapsed) / expected;
    }
    const over = Math.min(1, (elapsed - expected) / CREEP_WINDOW_MS);
    return EXPECTED_END_PERCENT + (MAX_WAITING_PERCENT - EXPECTED_END_PERCENT) * over;
};

/** Which step is current for a given progress: steps are spread evenly across the bar. */
export const stageForProgress = (progress, stageCount) => {
    if (stageCount <= 0) return 0;
    const span = EXPECTED_END_PERCENT - START_PERCENT;
    const fraction = (Math.min(progress, EXPECTED_END_PERCENT) - START_PERCENT) / span;
    return Math.max(0, Math.min(stageCount - 1, Math.floor(fraction * stageCount)));
};
