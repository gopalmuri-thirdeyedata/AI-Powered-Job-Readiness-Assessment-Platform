import React, { useEffect, useState } from 'react';
import { EyeOff, FlaskConical } from 'lucide-react';

const TILE_ROW_PX = 60;          // 20px of text + 40px gap
const MAX_TILES = 1400;
const DESKTOP = { w: 1920, h: 1080 };

const readViewport = () => (typeof window === 'undefined' ? DESKTOP : { w: window.innerWidth || DESKTOP.w, h: window.innerHeight || DESKTOP.h });

/** The window size, re-read (debounced) on resize: the watermark has to fill the whole window, whatever its size. */
const useViewport = () => {
    const [size, setSize] = useState(readViewport);
    useEffect(() => {
        let timer = null;
        const onResize = () => { clearTimeout(timer); timer = setTimeout(() => setSize(readViewport()), 200); };
        window.addEventListener('resize', onResize);
        return () => { clearTimeout(timer); window.removeEventListener('resize', onResize); };
    }, []);
    return size;
};

/**
 * Enough tiles to cover the rotated layer: it is 180% of the window in both directions (so the corners stay covered after the rotation),
 * each tile about (characters x 8.2px + 56px gap) wide and 60px high, plus a 10% margin for text that renders wider than estimated.
 */
export const tileCount = (text, { w, h }) => {
    const cellW = String(text || '').length * 8.2 + 56;
    const cols = Math.ceil((w * 1.8) / cellW);
    const rows = Math.ceil((h * 1.8) / TILE_ROW_PX);
    return Math.min(MAX_TILES, Math.ceil(cols * rows * 1.1));
};

/**
 * The visible half of the content protection (see hooks/useAssessmentProtection):
 *   - a faint tiled watermark with the session id over the whole assessment: a screenshot or photo that leaks can be traced back to the sitting;
 *   - a cover that hides the questions while the window is not in front (Alt-Tab, other tab, screenshot tools);
 *   - a small badge while the protection is switched off for testing, so nobody forgets it.
 */
const ProtectionLayer = ({ obscured, watermark, protectionOn, testMode }) => {
    const viewport = useViewport();
    const tiles = watermark ? Array.from({ length: tileCount(watermark, viewport) }) : [];
    return (
        <>
            {protectionOn && watermark && (
                <div aria-hidden="true" data-testid="protection-watermark" className="pointer-events-none fixed inset-0 z-[9990] overflow-hidden select-none">
                    {/* A neutral grey that reads on BOTH themes. (This layer sits outside the workspace's `dark` wrapper, so a dark:text-white variant never applied: the tiles were invisible on the dark coding screen.) */}
                    <div className="absolute -inset-[40%] flex flex-wrap content-start gap-x-14 gap-y-10 -rotate-[24deg] opacity-[0.12] text-slate-500">
                        {tiles.map((_, i) => <span key={i} className="whitespace-nowrap text-sm font-semibold tracking-wide">{watermark}</span>)}
                    </div>
                </div>
            )}
            {obscured && (
                <div role="alert" data-testid="protection-cover" className="fixed inset-0 z-[99990] flex flex-col items-center justify-center gap-3 bg-slate-950 text-white text-center p-6">
                    <EyeOff className="w-10 h-10 text-slate-400" aria-hidden="true" />
                    <p className="text-lg font-bold">The assessment is hidden</p>
                    <p className="text-sm text-slate-300 max-w-md">Return to this window to continue. Leaving it, switching tabs or capturing the screen is recorded and shared with the hiring team.</p>
                </div>
            )}
            {testMode && (
                <div data-testid="protection-test-badge" className="fixed bottom-2 left-2 z-[99980] inline-flex items-center gap-1.5 rounded-full bg-amber-500 text-slate-900 text-[11px] font-bold px-2.5 py-1 shadow-lg pointer-events-none">
                    <FlaskConical className="w-3.5 h-3.5" aria-hidden="true" /> Test mode: copy / paste and screenshot protection are OFF
                </div>
            )}
        </>
    );
};

export default ProtectionLayer;
