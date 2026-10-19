import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ShieldAlert, ShieldCheck } from 'lucide-react';

// Detection scenarios mirror what the YOLO proctor actually flags.
const SCENES = [
    { id: 'ok', ok: true, status: 'Candidate verified', detail: '1 person · face in frame', boxes: [{ label: 'person 0.97', x: 30, y: 18, w: 38, h: 70, tone: 'emerald' }] },
    { id: 'phone', ok: false, status: 'Cell phone detected', detail: 'Malpractice alert logged', boxes: [
        { label: 'person 0.96', x: 22, y: 18, w: 36, h: 70, tone: 'emerald' },
        { label: 'cell phone 0.91', x: 64, y: 52, w: 16, h: 24, tone: 'red' },
    ] },
    { id: 'multi', ok: false, status: 'Multiple people', detail: 'Violation recorded · 10s recovery', boxes: [
        { label: 'person 0.95', x: 12, y: 20, w: 30, h: 68, tone: 'emerald' },
        { label: 'person 0.88', x: 56, y: 24, w: 30, h: 64, tone: 'red' },
    ] },
    { id: 'ok2', ok: true, status: 'Candidate verified', detail: '1 person · face in frame', boxes: [{ label: 'person 0.98', x: 31, y: 17, w: 38, h: 71, tone: 'emerald' }] },
];

const BOX = {
    emerald: 'border-emerald-400 text-emerald-200 bg-emerald-400/10',
    red: 'border-red-400 text-red-200 bg-red-400/15',
};

const ProctorDemo = () => {
    const reduce = useReducedMotion();
    const [i, setI] = useState(0);

    useEffect(() => {
        if (reduce) return undefined;
        const id = setInterval(() => setI((p) => (p + 1) % SCENES.length), 2800);
        return () => clearInterval(id);
    }, [reduce]);

    const scene = SCENES[i];

    return (
        <div className="rounded-3xl overflow-hidden border border-slate-800 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-950/80 border-b border-slate-800 text-[11px] text-slate-400 font-mono">
                <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> LIVE · analyze-frame</span>
                <span>YOLOv8 · CPU</span>
            </div>

            {/* Fake camera feed */}
            <div className="relative aspect-[4/3] sm:aspect-video bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 overflow-hidden" aria-hidden="true">
                <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(148,163,184,.15)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,.15)_1px,transparent_1px)] [background-size:28px_28px]" />
                {/* silhouette */}
                <div className="absolute left-1/2 bottom-0 -translate-x-1/2 w-[34%] h-[62%] rounded-t-full bg-slate-700/60" />
                <div className="absolute left-1/2 top-[22%] -translate-x-1/2 w-[16%] aspect-square rounded-full bg-slate-600/70" />
                {!reduce && <div className="absolute left-0 right-0 h-16 bg-gradient-to-b from-transparent via-emerald-400/15 to-transparent animate-pw-scan" />}

                <AnimatePresence mode="wait">
                    <motion.div key={scene.id} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
                        {scene.boxes.map((b) => (
                            <div
                                key={b.label}
                                className={`absolute border-2 rounded-md ${BOX[b.tone]}`}
                                style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` }}
                            >
                                <span className={`absolute -top-5 left-[-2px] px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-mono font-bold whitespace-nowrap ${b.tone === 'red' ? 'bg-red-500 text-white' : 'bg-emerald-500 text-slate-900'}`}>{b.label}</span>
                            </div>
                        ))}
                    </motion.div>
                </AnimatePresence>
            </div>

            <div className={`flex items-center gap-3 px-4 py-3 transition-colors duration-300 ${scene.ok ? 'bg-emerald-950/60' : 'bg-red-950/60'}`} role="status" aria-live="polite">
                {scene.ok ? <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" /> : <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />}
                <div className="min-w-0">
                    <div className={`text-sm font-bold ${scene.ok ? 'text-emerald-300' : 'text-red-300'}`}>{scene.status}</div>
                    <div className="text-[11px] text-slate-400">{scene.detail}</div>
                </div>
                <div className="ml-auto flex gap-1" aria-hidden="true">
                    {[0, 1, 2].map((s) => (
                        <span key={s} className={`w-2 h-2 rounded-full ${!scene.ok && s === (scene.id === 'phone' ? 0 : 1) ? 'bg-red-500' : 'bg-slate-700'}`} />
                    ))}
                </div>
            </div>
        </div>
    );
};

export default ProctorDemo;
