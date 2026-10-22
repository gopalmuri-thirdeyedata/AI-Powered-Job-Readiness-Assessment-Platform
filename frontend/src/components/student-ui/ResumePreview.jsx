import React, { useEffect, useMemo, useState } from 'react';
import { PAGE_WIDTH_PT, PAGE_HEIGHT_PT } from '../../utils/resumeTemplates';
import { layoutResume } from '../../utils/resumeLayout';
import { getMeasure } from '../../utils/resumeMeasure';

const CSS_FONTS = {
    times: '"Times New Roman", Times, serif',
    helvetica: 'Arial, Helvetica, sans-serif',
};
const ANCHORS = { left: 'start', center: 'middle', right: 'end' };

/**
 * Draws the shared resume layout (the same coordinates the PDF export uses) as SVG pages, so the preview
 * matches the downloaded PDF line for line. SVG scales to any container width, from a thumbnail to full size.
 *
 * maxPages limits how many pages are drawn (thumbnails show page 1 only). framed draws a border and shadow
 * around each page, for the full-size preview.
 */
const ResumePreview = ({ data, templateId, maxPages = Infinity, framed = false }) => {
    const [measure, setMeasure] = useState(null);
    const [loadFailed, setLoadFailed] = useState(false);

    useEffect(() => {
        let alive = true;
        getMeasure().then((m) => { if (alive) setMeasure(() => m); }).catch(() => { if (alive) setLoadFailed(true); });
        return () => { alive = false; };
    }, []);

    const layout = useMemo(() => (measure ? layoutResume(data, templateId, measure) : null), [measure, data, templateId]);

    if (loadFailed) {
        return <div className="aspect-[1/1.414] w-full bg-white flex items-center justify-center text-xs text-slate-500 p-4 text-center">Preview unavailable. You can still download the resume.</div>;
    }
    if (!layout) {
        return <div className="aspect-[1/1.414] w-full bg-white animate-pulse" aria-busy="true" />;
    }

    const pages = layout.pages.slice(0, maxPages);

    return (
        <div data-template={templateId} className="w-full space-y-3">
            {pages.map((pg, pi) => (
                <div key={pi} className={framed ? 'rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 shadow-sm' : undefined}>
                <svg
                    viewBox={`0 0 ${PAGE_WIDTH_PT} ${PAGE_HEIGHT_PT}`}
                    width="100%"
                    role="img"
                    aria-label={`Resume preview, page ${pi + 1}`}
                    style={{ display: 'block', background: '#ffffff' }}
                >
                    {pg.items.map((it, i) => (it.k === 'rule' ? (
                        <line key={i} x1={it.x1} y1={it.y1} x2={it.x2} y2={it.y2} stroke={it.color} strokeWidth={it.width} />
                    ) : (
                        <text
                            key={i}
                            x={it.x}
                            y={it.y}
                            fontFamily={CSS_FONTS[it.font]}
                            fontSize={it.size}
                            fontWeight={it.style === 'bold' ? 700 : 400}
                            fontStyle={it.style === 'italic' ? 'italic' : 'normal'}
                            fill={it.color}
                            textAnchor={ANCHORS[it.align] || 'start'}
                        >
                            {it.text}
                        </text>
                    )))}
                </svg>
                </div>
            ))}
        </div>
    );
};

export default ResumePreview;
