import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlayCircle, Award, Clock, ShieldCheck, ArrowRight, AlertTriangle, Camera, CameraOff, Video, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import API_URL from '../../apiConfig';

const CandidateStartPage = () => {
    const navigate = useNavigate();

    // Prevent completed candidates from accessing start/camera page
    useEffect(() => {
        const token = localStorage.getItem('candidateToken');
        if (!token) return;

        fetch(`${API_URL}/api/assessments/my-status/`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(res => {
            if (!res.ok) throw new Error();
            return res.json();
        })
        .then(latest => {
            if (latest && latest.status === 'completed') {
                localStorage.removeItem('candidateToken');
                localStorage.removeItem('currentAssessment');
                localStorage.removeItem('aptitudeQuestions');
                navigate('/portal/login');
            }
        })
        .catch(() => {});
    }, [navigate]);

    const assessment = JSON.parse(localStorage.getItem('currentAssessment') || '{}');

    const type = assessment.type ? assessment.type.charAt(0).toUpperCase() + assessment.type.slice(1) : 'Assessment';
    const config = assessment.config || {};
    const duration = config.duration || config.timeLimit || 60;
    const questions = config.questionCount ? `${config.questionCount} Problems` : (config.qCount ? `${config.qCount} Questions` : '2 Problems');
    const showFormat = ['Aptitude', 'Coding'].includes(type);
    const isInterview = type.toLowerCase().includes('interview');

    const [camStep, setCamStep] = useState(isInterview ? 'done' : 'idle');
    const streamRef = useRef(null);

    // Callback ref — attaches stream the instant the <video> element mounts in DOM
    const videoCallbackRef = useCallback((node) => {
        if (node && streamRef.current) {
            node.srcObject = streamRef.current;
            node.play().catch(() => {});
        }
    }, [camStep]); // re-run when camStep changes so it fires on 'preview'

    useEffect(() => {
        // Do NOT stop camera on unmount — stream stays alive for the coding/aptitude page
        // The assessment page will stop it after submit
        return () => {};
    }, []);

    const handleAllowCamera = async () => {
        setCamStep('asking');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
            streamRef.current = stream;
            // Save globally so assessment page can reuse without re-requesting
            window.__activeProctorStream = stream;
            setCamStep('preview');
        } catch { setCamStep('denied'); }
    };

    const handleConfirmCamera = () => {
        // Do NOT stop the stream — keep camera open for the assessment page
        // Just move the UI forward
        setCamStep('done');
    };

    const handleStart = () => navigate('/portal/instructions');

    // ─── CAMERA PERMISSION SCREENS ───────────────────────────────────────────
    if (camStep !== 'done') {
        return (
            <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
                <style>{`
                    @keyframes camPing  { 0%,100%{transform:scale(1);opacity:.3} 50%{transform:scale(1.5);opacity:.1} }
                    @keyframes camSpin  { to{transform:rotate(360deg)} }
                    @keyframes camPulse { 0%,100%{opacity:1} 50%{opacity:.4} }
                `}</style>

                <AnimatePresence mode="wait">

                    {/* ── Screen 1: Allow Camera ── */}
                    {(camStep === 'idle' || camStep === 'asking') && (
                        <motion.div key="idle" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.3 }}
                            style={{ background: '#fff', borderRadius: '24px', boxShadow: '0 30px 80px rgba(0,0,0,0.6)', maxWidth: '420px', width: '100%', overflow: 'hidden' }}>

                            <div style={{ padding: '40px 36px', textAlign: 'center' }}>
                                {/* Icon */}
                                <div style={{ position: 'relative', width: '84px', height: '84px', margin: '0 auto 28px' }}>
                                    <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(99,102,241,0.2)', animation: 'camPing 2s ease-in-out infinite' }} />
                                    <div style={{ position: 'relative', width: '84px', height: '84px', borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 32px rgba(99,102,241,0.45)' }}>
                                        <Video size={38} color="#fff" />
                                    </div>
                                </div>

                                <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#111827', margin: '0 0 10px', fontFamily: 'inherit' }}>Camera Access Required</h1>
                                <p style={{ fontSize: '13px', color: '#6b7280', lineHeight: 1.75, margin: '0 0 28px', fontFamily: 'inherit' }}>
                                    This assessment uses background camera monitoring to ensure integrity.
                                    Your camera runs silently — <strong style={{ color: '#111827', fontWeight: 700 }}>no recording is stored</strong>.
                                    Detection happens in real time only.
                                </p>

                                {/* Detection list */}
                                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '16px 20px', textAlign: 'left', marginBottom: '28px' }}>
                                    <p style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px', fontFamily: 'inherit' }}>Monitoring detects:</p>
                                    {[
                                        { icon: '👤', text: 'More than one person in frame' },
                                        { icon: '📱', text: 'Mobile phone or electronic device' },
                                        { icon: '📖', text: 'Reference material / books' },
                                        { icon: '🚶', text: 'Face not visible in camera' },
                                    ].map((item, i) => (
                                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: i > 0 ? '10px' : 0 }}>
                                            <span style={{ fontSize: '16px' }}>{item.icon}</span>
                                            <span style={{ fontSize: '13px', color: '#374151', fontFamily: 'inherit' }}>{item.text}</span>
                                        </div>
                                    ))}
                                </div>

                                <button
                                    onClick={handleAllowCamera}
                                    disabled={camStep === 'asking'}
                                    style={{
                                        width: '100%', padding: '15px', borderRadius: '14px', border: 'none',
                                        background: camStep === 'asking' ? '#a5b4fc' : 'linear-gradient(135deg,#4f46e5,#7c3aed)',
                                        color: '#fff', fontWeight: 700, fontSize: '15px', cursor: camStep === 'asking' ? 'not-allowed' : 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                                        boxShadow: '0 4px 24px rgba(99,102,241,0.4)', fontFamily: 'inherit', transition: 'all 0.2s'
                                    }}
                                >
                                    {camStep === 'asking' ? (
                                        <>
                                            <div style={{ width: '18px', height: '18px', border: '2px solid rgba(255,255,255,0.35)', borderTop: '2px solid #fff', borderRadius: '50%', animation: 'camSpin 0.8s linear infinite' }} />
                                            Waiting for permission...
                                        </>
                                    ) : (
                                        <><Camera size={18} /> Allow Camera Access</>
                                    )}
                                </button>
                                <p style={{ fontSize: '11px', color: '#9ca3af', margin: '14px 0 0', fontFamily: 'inherit' }}>
                                    🔒 Camera feed is processed locally and never uploaded
                                </p>
                            </div>
                        </motion.div>
                    )}

                    {/* ── Screen 2: Live Preview ── */}
                    {camStep === 'preview' && (
                        <motion.div key="preview" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.3 }}
                            style={{ background: '#fff', borderRadius: '24px', boxShadow: '0 30px 80px rgba(0,0,0,0.6)', maxWidth: '420px', width: '100%', overflow: 'hidden' }}>

                            <div style={{ padding: '32px', textAlign: 'center' }}>
                                <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#111827', margin: '0 0 4px', fontFamily: 'inherit' }}>Camera is Working ✅</h2>
                                <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 20px', fontFamily: 'inherit' }}>Make sure your face is clearly visible</p>

                                {/* Live feed */}
                                <div style={{ position: 'relative', borderRadius: '16px', overflow: 'hidden', background: '#000', marginBottom: '20px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
                                    <video ref={videoCallbackRef} autoPlay playsInline muted
                                        style={{ width: '100%', display: 'block', transform: 'scaleX(-1)', aspectRatio: '4/3', maxHeight: '220px', objectFit: 'cover' }} />
                                    <div style={{ position: 'absolute', top: '10px', left: '10px', display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(0,0,0,0.65)', padding: '4px 10px', borderRadius: '20px' }}>
                                        <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#4ade80', animation: 'camPulse 1.5s ease-in-out infinite' }} />
                                        <span style={{ color: '#fff', fontSize: '10px', fontWeight: 600, fontFamily: 'inherit' }}>Live Preview</span>
                                    </div>
                                </div>

                                {/* Checklist */}
                                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '14px', padding: '14px 18px', textAlign: 'left', marginBottom: '20px' }}>
                                    <p style={{ fontSize: '11px', fontWeight: 700, color: '#15803d', margin: '0 0 10px', fontFamily: 'inherit' }}>Before you continue, ensure:</p>
                                    {['Your face is clearly visible', 'You are in a well-lit room', 'No other people are in the frame', 'No phone or other devices visible'].map((item, i) => (
                                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: i > 0 ? '8px' : 0 }}>
                                            <span style={{ color: '#16a34a', fontWeight: 700, fontSize: '13px' }}>✓</span>
                                            <span style={{ fontSize: '13px', color: '#166534', fontFamily: 'inherit' }}>{item}</span>
                                        </div>
                                    ))}
                                </div>

                                <button onClick={handleConfirmCamera}
                                    style={{ width: '100%', padding: '15px', borderRadius: '14px', border: 'none', background: 'linear-gradient(135deg,#16a34a,#15803d)', color: '#fff', fontWeight: 700, fontSize: '15px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', boxShadow: '0 4px 24px rgba(22,163,74,0.4)', fontFamily: 'inherit' }}>
                                    <ShieldCheck size={18} /> Looks Good — Continue <ArrowRight size={18} />
                                </button>
                            </div>
                        </motion.div>
                    )}

                    {/* ── Screen 3: Denied ── */}
                    {camStep === 'denied' && (
                        <motion.div key="denied" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.3 }}
                            style={{ background: '#fff', borderRadius: '24px', boxShadow: '0 30px 80px rgba(0,0,0,0.6)', maxWidth: '420px', width: '100%', overflow: 'hidden' }}>

                            <div style={{ padding: '40px 36px', textAlign: 'center' }}>
                                <div style={{ width: '84px', height: '84px', borderRadius: '50%', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
                                    <CameraOff size={38} color="#ef4444" />
                                </div>
                                <h2 style={{ fontSize: '22px', fontWeight: 800, color: '#111827', margin: '0 0 10px', fontFamily: 'inherit' }}>Camera Access Blocked</h2>
                                <p style={{ fontSize: '13px', color: '#6b7280', lineHeight: 1.75, margin: '0 0 24px', fontFamily: 'inherit' }}>
                                    Camera access was denied. This assessment requires camera access to proceed.
                                </p>
                                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '14px', padding: '16px 20px', textAlign: 'left', marginBottom: '24px' }}>
                                    <p style={{ fontSize: '11px', fontWeight: 700, color: '#92400e', margin: '0 0 10px', fontFamily: 'inherit' }}>How to fix:</p>
                                    {["Click the 🔒 lock icon in your browser's address bar", 'Find "Camera" and set it to "Allow"', 'Refresh the page and try again'].map((item, i) => (
                                        <div key={i} style={{ display: 'flex', gap: '10px', marginTop: i > 0 ? '8px' : 0 }}>
                                            <span style={{ color: '#d97706', fontWeight: 700, fontSize: '12px', flexShrink: 0 }}>{i + 1}.</span>
                                            <span style={{ fontSize: '13px', color: '#78350f', fontFamily: 'inherit' }}>{item}</span>
                                        </div>
                                    ))}
                                </div>
                                <button onClick={() => setCamStep('idle')}
                                    style={{ width: '100%', padding: '15px', borderRadius: '14px', border: 'none', background: 'linear-gradient(135deg,#374151,#1f2937)', color: '#fff', fontWeight: 700, fontSize: '15px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', boxShadow: '0 4px 20px rgba(0,0,0,0.3)', fontFamily: 'inherit' }}>
                                    <RefreshCw size={18} /> Try Again
                                </button>
                            </div>
                        </motion.div>
                    )}

                </AnimatePresence>
            </div>
        );
    }

    // ─── MAIN START PAGE (after camera confirmed) ─────────────────────────────
    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50/30 to-gray-50 flex flex-col items-center justify-center p-3 sm:p-6">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="max-w-3xl w-full">

                <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">

                    {/* Header */}
                    <div className="bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-blue-500/10 border-b border-blue-100 p-5 sm:p-8 text-center">
                        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.2 }}
                            className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-lg shadow-blue-200/50">
                            <Award className="text-white" size={40} />
                        </motion.div>
                        <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-2 break-words">{type} Round</h1>
                        <p className="text-gray-600 font-medium">Please review the test details carefully before starting</p>
                        <button onClick={() => { localStorage.clear(); navigate('/portal/login'); }} className="text-xs text-blue-600 hover:text-blue-800 mt-2 underline block mx-auto">
                            Log out & Exit
                        </button>
                    </div>

                    <div className="p-4 sm:p-8 space-y-6">

                        {/* Info Cards */}
                        <div className={`grid grid-cols-1 ${showFormat ? 'sm:grid-cols-2 md:grid-cols-3' : 'sm:grid-cols-2'} gap-5`}>
                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
                                className="group bg-gradient-to-br from-blue-50 to-white p-5 rounded-xl border border-blue-100 hover:border-blue-200 hover:shadow-md transition-all">
                                <div className="flex flex-col items-center text-center space-y-3">
                                    <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                                        <Clock className="text-blue-600" size={24} />
                                    </div>
                                    <div>
                                        <span className="block text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Duration</span>
                                        <span className="block text-2xl font-extrabold text-gray-900">{duration}</span>
                                        <span className="block text-sm text-gray-600 font-medium">Minutes</span>
                                    </div>
                                </div>
                            </motion.div>

                            {showFormat && (
                                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
                                    className="group bg-gradient-to-br from-purple-50 to-white p-5 rounded-xl border border-purple-100 hover:border-purple-200 hover:shadow-md transition-all">
                                    <div className="flex flex-col items-center text-center space-y-3">
                                        <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                                            <Award className="text-purple-600" size={24} />
                                        </div>
                                        <div>
                                            <span className="block text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Format</span>
                                            <span className="block text-2xl font-extrabold text-gray-900">{questions.split(' ')[0]}</span>
                                            <span className="block text-sm text-gray-600 font-medium">{questions.split(' ')[1] || 'Items'}</span>
                                        </div>
                                    </div>
                                </motion.div>
                            )}

                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
                                className="group bg-gradient-to-br from-green-50 to-white p-5 rounded-xl border border-green-100 hover:border-green-200 hover:shadow-md transition-all">
                                <div className="flex flex-col items-center text-center space-y-3">
                                    <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                                        <ShieldCheck className="text-green-600" size={24} />
                                    </div>
                                    <div>
                                        <span className="block text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Proctoring</span>
                                        <span className="block text-2xl font-extrabold text-gray-900">✓</span>
                                        <span className="block text-sm text-gray-600 font-medium">Active</span>
                                    </div>
                                </div>
                            </motion.div>
                        </div>

                        {/* Camera confirmed banner */}
                        {!isInterview && (
                            <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }}
                                className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                                <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                                    <Camera size={16} className="text-green-600" />
                                </div>
                                <div>
                                    <p className="text-sm font-bold text-green-800">Camera Verified — Background Monitoring Active</p>
                                    <p className="text-xs text-green-600">Your session will be monitored for integrity. No recording is stored.</p>
                                </div>
                            </motion.div>
                        )}

                        {/* Instructions */}
                        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.6 }}
                            className="bg-amber-50 border-l-4 border-amber-400 rounded-r-xl p-5 shadow-sm">
                            <div className="flex items-start gap-4">
                                <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                                    <AlertTriangle className="text-amber-600" size={20} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-amber-900 mb-2">Important Instructions</h3>
                                    <ul className="text-sm text-amber-800 space-y-1.5 leading-relaxed">
                                        <li className="flex items-start gap-2"><span className="text-amber-600 font-bold mt-0.5">•</span><span>Timer starts immediately when you click <strong>Start Test</strong></span></li>
                                        <li className="flex items-start gap-2"><span className="text-amber-600 font-bold mt-0.5">•</span><span>Do not close browser or switch tabs during the test</span></li>
                                        <li className="flex items-start gap-2"><span className="text-amber-600 font-bold mt-0.5">•</span><span>Any suspicious activity will be flagged as a violation</span></li>
                                    </ul>
                                </div>
                            </div>
                        </motion.div>

                        {/* Start Button */}
                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}>
                            <button onClick={handleStart}
                                className="group w-full py-5 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold text-lg shadow-xl shadow-blue-200/50 hover:shadow-2xl transition-all transform hover:-translate-y-1 active:translate-y-0 flex items-center justify-center gap-3">
                                <PlayCircle size={24} className="group-hover:scale-110 transition-transform" />
                                {isInterview ? 'Start Interview' : 'Start Test'}
                                <ArrowRight size={24} className="group-hover:translate-x-1 transition-transform" />
                            </button>
                        </motion.div>

                        {/* Session Info */}
                        <div className="text-center pt-1">
                            <div className="inline-flex items-center gap-2 px-4 py-2 bg-gray-50 rounded-lg border border-gray-200">
                                <ShieldCheck className="text-green-600" size={14} />
                                <span className="text-xs text-gray-500 font-medium">Session ID: <span className="text-gray-700 font-mono">{assessment.id || 'Unknown'}</span></span>
                                <span className="text-gray-300">•</span>
                                <span className="text-xs text-gray-500 font-medium">Secure Environment</span>
                            </div>
                        </div>
                    </div>
                </div>

                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }} className="mt-6 text-center">
                    <p className="text-sm text-gray-500">💡 <span className="font-medium">Tip:</span> Ensure you have a stable internet connection before starting</p>
                </motion.div>
            </motion.div>
        </div>
    );
};

export default CandidateStartPage;
