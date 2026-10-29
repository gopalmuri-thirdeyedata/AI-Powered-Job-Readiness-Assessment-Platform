import React, { useMemo } from 'react';
import { HEAT_CLASSES, buildHeatmap } from '../../utils/codingPlatform';

// A twelve-week grid like the contribution calendar: one column per week, one row per weekday. Colour only encodes the count,
// so every cell also carries the date and number in its title for anyone who cannot see the shades.
const ActivityHeatmap = ({ activity, days = 84 }) => {
    const weeks = useMemo(() => buildHeatmap(activity, days), [activity, days]);
    const total = Object.values(activity || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
    return (
        <div>
            <div className="flex items-baseline justify-between gap-2 mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Last 12 weeks</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{total} submission{total === 1 ? '' : 's'}</p>
            </div>
            <div className="overflow-x-auto pb-1 w-0 min-w-full" role="img" aria-label={`${total} submissions in the last 12 weeks`}>
                <div className="flex gap-[3px] sm:gap-1 w-max">
                    {weeks.map((week, w) => (
                        <div key={w} className="flex flex-col gap-[3px] sm:gap-1">
                            {week.map((cell, i) => (cell ? (
                                <span key={cell.date} title={`${cell.date}: ${cell.count} submission${cell.count === 1 ? '' : 's'}`}
                                    className={`w-3 h-3 sm:w-4 sm:h-4 rounded-[3px] ${HEAT_CLASSES[cell.level]}`} />
                            ) : <span key={`pad-${i}`} className="w-3 h-3 sm:w-4 sm:h-4" />))}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default ActivityHeatmap;
