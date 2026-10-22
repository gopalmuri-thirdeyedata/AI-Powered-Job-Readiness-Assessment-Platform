import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Mic, RefreshCw } from 'lucide-react';

/**
 * Live loudness bar. It subscribes to the microphone hook directly and keeps its own state, so the
 * 60-per-second level updates never re-render the (large) page that hosts it.
 */
export const MicLevelMeter = ({ subscribeLevel, dark = false }) => {
    const [level, setLevel] = useState(0);
    const lastPaint = useRef(0);

    useEffect(() => subscribeLevel((value) => {
        const now = performance.now();
        if (now - lastPaint.current < 60) return; // paint ~16 times a second
        lastPaint.current = now;
        setLevel(value);
    }), [subscribeLevel]);

    const bars = 18;
    const lit = Math.round(level * bars);
    return (
        <div className="flex items-end gap-[3px] h-5" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
            {Array.from({ length: bars }, (_, i) => {
                const on = i < lit;
                const tone = i > bars * 0.8 ? 'bg-amber-500' : 'bg-emerald-500';
                return (
                    <span
                        key={i}
                        className={`w-1.5 rounded-sm transition-colors duration-75 ${on ? tone : dark ? 'bg-slate-700' : 'bg-slate-200'}`}
                        style={{ height: `${35 + (i / bars) * 65}%` }}
                    />
                );
            })}
        </div>
    );
};

/**
 * Microphone chooser + live meter + a real "we can hear you" verdict.
 * `mic` is the object returned by useMicrophone().
 */
const MicrophonePicker = ({ mic, onDeviceChange, dark = false, compact = false, idPrefix = 'mic' }) => {
    const { devices, deviceId, status, error, heardSound, selectDevice, restart, subscribeLevel } = mic;
    const blocked = status === 'denied' || status === 'unavailable' || status === 'error';
    const text = dark ? 'text-slate-200' : 'text-slate-700';
    const muted = dark ? 'text-slate-400' : 'text-slate-500';

    const handleChange = (e) => {
        selectDevice(e.target.value);
        if (onDeviceChange) onDeviceChange(e.target.value);
    };

    return (
        <div className={`space-y-2.5 ${compact ? '' : 'p-3 rounded-xl border'} ${dark ? 'border-slate-700 bg-slate-900/60' : 'border-slate-200 bg-white'}`}>
            <label htmlFor={`${idPrefix}-select`} className={`flex items-center gap-2 text-xs font-semibold ${text}`}>
                <Mic className="w-3.5 h-3.5" /> Microphone
            </label>
            <select
                id={`${idPrefix}-select`}
                value={deviceId}
                onChange={handleChange}
                disabled={blocked && !devices.length}
                className={`w-full min-h-[40px] rounded-lg border px-3 text-xs outline-none focus:ring-2 focus:ring-emerald-500/40 ${dark ? 'bg-slate-800 border-slate-600 text-slate-100' : 'bg-white border-slate-300 text-slate-800'}`}
            >
                {!devices.length && <option value="">Default microphone</option>}
                {devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
            </select>

            {blocked ? (
                <div role="alert" className="flex items-start gap-2 text-xs text-rose-600">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span className="flex-1">{error}</span>
                    <button type="button" onClick={restart} className="inline-flex items-center gap-1 font-semibold underline cursor-pointer shrink-0">
                        <RefreshCw className="w-3 h-3" /> Retry
                    </button>
                </div>
            ) : (
                <>
                    <MicLevelMeter subscribeLevel={subscribeLevel} dark={dark} />
                    {heardSound ? (
                        <p id={`${idPrefix}-heard`} className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
                            <CheckCircle2 className="w-3.5 h-3.5" /> We can hear you
                        </p>
                    ) : (
                        <p id={`${idPrefix}-waiting`} className={`text-xs ${muted}`}>
                            {status === 'starting' ? 'Starting the microphone…' : 'Say a few words. The bars should move. If they stay flat, choose a different microphone above.'}
                        </p>
                    )}
                </>
            )}
        </div>
    );
};

export default MicrophonePicker;
