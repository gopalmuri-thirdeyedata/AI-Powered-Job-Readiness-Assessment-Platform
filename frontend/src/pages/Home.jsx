import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
    ArrowRight,
    BrainCircuit,
    Code2,
    MessageSquare,
    CheckCircle2,
    ShieldCheck,
    Sparkles,
    FileText,
    Building2,
    Lock,
    Award,
    ChevronRight,
    Check,
    GraduationCap,
    Clock,
    Layers,
    BarChart3
} from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useClerk, useUser } from '@clerk/clerk-react';
import PublicNavbar from '../components/PublicNavbar';
import ClerkAuthModal from '../components/ClerkAuthModal';

// Animation variants
const fadeIn = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } }
};

const staggerContainer = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.12 } }
};

const Home = () => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { user, isLoaded } = useUser();
    const clerk = useClerk();
    const [isClerkOpen, setIsClerkOpen] = useState(false);
    const [authModalMode, setAuthModalMode] = useState('student'); // 'student' | 'admin'
    const [authModalAuthType, setAuthModalAuthType] = useState('signIn'); // 'signIn' | 'signUp'

    // Signed out: drop any stale student credentials so the page never shows a ghost session
    React.useEffect(() => {
        if (isLoaded && !user) {
            ['studentToken', 'student_user_email', 'student_completed_assessment'].forEach(k => {
                try { localStorage.removeItem(k); } catch { /* storage unavailable */ }
            });
        }
    }, [isLoaded, user]);

    // Automatically route authenticated users directly to their corresponding workspace
    React.useEffect(() => {
        if (!isLoaded || !user) return;

        const authParam = searchParams.get('auth');
        const profile = (() => {
            try {
                return JSON.parse(localStorage.getItem('user_profile') || '{}');
            } catch {
                return {};
            }
        })();

        if (authParam === 'admin' || ['ORGANIZATION_ADMIN', 'HR', 'PLATFORM_ADMIN'].includes(profile.role)) {
            navigate('/admin/dashboard', { replace: true });
        } else {
            // Default authenticated student destination: Assessment Setup (JD & Resume upload)
            navigate('/assessment/setup', { replace: true });
        }
    }, [user, isLoaded, searchParams, navigate]);

    // Handle deep-linked auth requests (e.g. redirected from protected guards)
    React.useEffect(() => {
        const authParam = searchParams.get('auth');
        if (authParam === 'student') {
            setAuthModalMode('student');
            setAuthModalAuthType('signIn');
            if (!user) setIsClerkOpen(true);
        } else if (authParam === 'signup' || authParam === 'register') {
            setAuthModalMode('student');
            setAuthModalAuthType('signUp');
            if (!user) setIsClerkOpen(true);
        } else if (authParam === 'admin') {
            setAuthModalMode('admin');
            setAuthModalAuthType('signIn');
            if (!user) setIsClerkOpen(true);
        }
    }, [searchParams, user]);

    const openStudentSignIn = () => {
        if (user) {
            navigate('/assessment/setup');
        } else {
            setAuthModalMode('student');
            setAuthModalAuthType('signIn');
            setIsClerkOpen(true);
        }
    };

    const openAdminSignIn = () => {
        if (user) {
            navigate('/admin/dashboard');
        } else {
            setAuthModalMode('admin');
            setAuthModalAuthType('signIn');
            setIsClerkOpen(true);
        }
    };

    return (
        <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-sans selection:bg-emerald-100 selection:text-emerald-900 overflow-x-hidden">
            {/* Clerk Auth Modal parameterized by entry mode and authType */}
            <ClerkAuthModal
                isOpen={isClerkOpen}
                onClose={() => setIsClerkOpen(false)}
                mode={authModalMode}
                initialAuthType={authModalAuthType}
                redirectUrl={authModalMode === 'student' ? '/assessment/setup' : '/admin/dashboard'}
            />

            {/* Public Top Navbar */}
            <PublicNavbar
                onOpenStudentSignIn={openStudentSignIn}
                onOpenAdminSignIn={openAdminSignIn}
            />

            {/* ═══════════════════════════════════════════════════════════════════
                SECTION A — HERO SECTION (2-Column Desktop Layout)
               ═══════════════════════════════════════════════════════════════════ */}
            <section className="relative pt-28 pb-16 lg:pt-36 lg:pb-24 px-4 sm:px-6 lg:px-8 overflow-hidden bg-gradient-to-b from-slate-50/60 via-white to-white dark:from-slate-900/50 dark:via-slate-950 dark:to-slate-950">
                {/* Subtle ambient background glow */}
                <div className="absolute top-14 right-1/4 w-96 h-96 bg-emerald-100/40 dark:bg-emerald-600/10 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute top-24 left-10 w-72 h-72 bg-blue-100/30 dark:bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

                <div className="max-w-7xl mx-auto relative z-10">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
                        
                        {/* ── Left Column: Value Proposition & Two Entry Points ── */}
                        <motion.div
                            initial="hidden"
                            animate="visible"
                            variants={staggerContainer}
                            className="lg:col-span-6 space-y-6 text-left"
                        >
                            {/* Eyebrow Badge */}
                            <motion.div variants={fadeIn} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300 text-xs font-semibold tracking-wide shadow-xs">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                <span>AI-POWERED JOB ASSESSMENT PLATFORM</span>
                            </motion.div>

                            {/* Exact Headline as specified */}
                            <motion.h1 variants={fadeIn} className="text-4xl sm:text-5xl lg:text-[3.25rem] font-extrabold tracking-tight text-slate-900 dark:text-white leading-[1.12]">
                                Prove Your Skills.<br />
                                <span className="text-emerald-700 dark:text-emerald-400">Get Job Ready.</span>
                            </motion.h1>

                            {/* Exact Supporting Text as specified */}
                            <motion.p variants={fadeIn} className="text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl font-normal">
                                Complete aptitude, coding, and technical interview assessments tailored to your resume and target job description.
                            </motion.p>

                            {/* Two Clear Entry Point Buttons: Student Sign In, Admin Sign In */}
                            <motion.div variants={fadeIn} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
                                {/* Button 1: Student Sign In */}
                                <button
                                    type="button"
                                    onClick={openStudentSignIn}
                                    className="px-6 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-md shadow-emerald-600/20 hover:shadow-lg hover:shadow-emerald-600/30 transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer"
                                >
                                    <GraduationCap className="w-4 h-4 text-white" />
                                    <span>Student Sign In</span>
                                    <ArrowRight className="w-4 h-4 ml-0.5" />
                                </button>

                                {/* Button 2: Admin Sign In */}
                                <button
                                    type="button"
                                    onClick={openAdminSignIn}
                                    className="px-5 py-3.5 rounded-xl border border-slate-300 hover:border-slate-400 dark:border-slate-700 dark:hover:border-slate-600 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 font-semibold text-sm transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                                >
                                    <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                    <span>Admin Sign In</span>
                                </button>
                            </motion.div>

                            {/* Sequential Trust Line */}
                            <motion.div variants={fadeIn} className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 font-medium">
                                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                <span>Sequential 3-round assessment: Role Aptitude · Sandboxed Coding · Technical AI Interview</span>
                            </motion.div>
                        </motion.div>

                        {/* ── Right Column: Interactive Product Preview ── */}
                        <motion.div
                            initial={{ opacity: 0, scale: 0.96, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                            className="lg:col-span-6 relative"
                        >
                            <div className="relative mx-auto max-w-lg lg:max-w-none">
                                {/* Ambient backdrop card glow */}
                                <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500/20 via-teal-500/10 to-blue-500/20 rounded-3xl blur-xl opacity-75" />

                                {/* Main Glass Mockup Container */}
                                <div className="relative bg-white/95 dark:bg-slate-900/95 border border-slate-200/90 dark:border-slate-800 rounded-3xl shadow-2xl p-6 sm:p-7 backdrop-blur-xl space-y-6">
                                    
                                    {/* 1. Job Description & Candidate Synthesis Bar */}
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800 gap-3">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/60 flex items-center justify-center text-emerald-700 dark:text-emerald-400 font-bold shrink-0">
                                                JD
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <h4 className="text-sm font-bold text-slate-900 dark:text-white leading-none">Full-Stack Engineer</h4>
                                                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">Target Role</span>
                                                </div>
                                                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">Resume + JD synthesized into personalized assessment</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 self-start sm:self-center bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 px-2.5 py-1 rounded-full text-xs font-bold border border-emerald-200/70 dark:border-emerald-800/60">
                                            <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                            <span>Role Tailored</span>
                                        </div>
                                    </div>

                                    {/* 2. Sequential 3-Round Pipeline */}
                                    <div className="space-y-2.5">
                                        <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-400">
                                            <span>Sequential Assessment Pipeline</span>
                                            <span className="text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                                                <Lock className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> Server-Side Gated
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-3 gap-2">
                                            {/* Round 1: Aptitude */}
                                            <div className="p-3 rounded-2xl bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 text-left">
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-400">Round 1</span>
                                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                                </div>
                                                <div className="text-xs font-bold text-slate-900 dark:text-white">Aptitude</div>
                                                <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 mt-0.5">MCQs & Logic</div>
                                            </div>

                                            {/* Round 2: Coding */}
                                            <div className="p-3 rounded-2xl bg-blue-50/80 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/60 text-left">
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="text-[10px] uppercase font-bold text-blue-700 dark:text-blue-400">Round 2</span>
                                                    <Code2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                                                </div>
                                                <div className="text-xs font-bold text-slate-900 dark:text-white">Coding</div>
                                                <div className="text-[11px] font-semibold text-blue-700 dark:text-blue-400 mt-0.5">Sandbox IDE</div>
                                            </div>

                                            {/* Round 3: Interview */}
                                            <div className="p-3 rounded-2xl bg-purple-50/80 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/60 text-left">
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="text-[10px] uppercase font-bold text-purple-700 dark:text-purple-400">Round 3</span>
                                                    <MessageSquare className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                                                </div>
                                                <div className="text-xs font-bold text-slate-900 dark:text-white">Interview</div>
                                                <div className="text-[11px] font-semibold text-purple-700 dark:text-purple-400 mt-0.5">AI Voice Eval</div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* 3. Verified Readiness Dossier Preview */}
                                    <div className="p-4 rounded-2xl bg-slate-50/90 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 flex items-center justify-between gap-4">
                                        <div className="flex items-center gap-3.5">
                                            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-bold text-sm shrink-0">
                                                <Award className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <div className="text-xs font-bold text-slate-900 dark:text-white">Standardized Candidate Dossier</div>
                                                <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">Scores, demonstrated strengths, and targeted improvement areas.</p>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">Verified</span>
                                        </div>
                                    </div>

                                    {/* 4. Telemetry & Proctoring Status */}
                                    <div className="pt-2 flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800">
                                        <div className="flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                                            <span>Proctoring Active · Fullscreen Enforced</span>
                                        </div>
                                        <span className="font-mono text-[10px]">Piston Sandbox 2.0</span>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                </div>
            </section>

            {/* ═══════════════════════════════════════════════════════════════════
                SECTION B — HOW IT WORKS (Concise 3-Round Explanation)
               ═══════════════════════════════════════════════════════════════════ */}
            <section id="how-it-works" className="py-20 lg:py-24 px-4 sm:px-6 lg:px-8 bg-slate-50/70 dark:bg-slate-900/40 border-y border-slate-100 dark:border-slate-800 relative">
                <div className="max-w-7xl mx-auto">
                    <div className="text-center max-w-3xl mx-auto mb-16 space-y-3">
                        <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1 rounded-full border border-emerald-200/80 dark:border-emerald-800/60">
                            The 3-Round Sequential Process
                        </span>
                        <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                            How PrepWin Evaluates Job Readiness
                        </h2>
                        <p className="text-slate-600 dark:text-slate-300 text-sm sm:text-base leading-relaxed">
                            A connected sequential progression tailored to your target job description and resume.
                        </p>
                    </div>

                    {/* 3 Step Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        {/* Round 1 */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-7 shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between">
                            <div>
                                <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 text-blue-700 dark:text-blue-400 font-extrabold text-lg flex items-center justify-center mb-6 shadow-xs">
                                    01
                                </div>
                                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 text-[11px] font-bold uppercase tracking-wider mb-2">
                                    Round 1 · Role Aptitude
                                </div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                                    Reasoning & Domain Scenarios
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                                    Timed multiple-choice challenges synthesized from the job description. Evaluates technical reasoning, quantitative logic, and domain fundamentals. Private server-side answer keys prevent leaks.
                                </p>
                            </div>
                            <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-400">
                                <BrainCircuit className="w-4 h-4" />
                                <span>Anti-Leak Server Key Privacy</span>
                            </div>
                        </div>

                        {/* Round 2 */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-7 shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between">
                            <div>
                                <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-400 font-extrabold text-lg flex items-center justify-center mb-6 shadow-xs">
                                    02
                                </div>
                                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold uppercase tracking-wider mb-2">
                                    Round 2 · Sandboxed Coding
                                </div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                                    Live Programming & Hidden Tests
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                                    Practical algorithmic challenges in Monaco IDE executed in an isolated runtime (Piston). Validated against both public test cases and confidential hidden test suites. Unlocks after Aptitude.
                                </p>
                            </div>
                            <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                                <Code2 className="w-4 h-4" />
                                <span>Isolated Piston Runtime · Multi-Language</span>
                            </div>
                        </div>

                        {/* Round 3 */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-7 shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between">
                            <div>
                                <div className="w-12 h-12 rounded-2xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/60 text-purple-700 dark:text-purple-400 font-extrabold text-lg flex items-center justify-center mb-6 shadow-xs">
                                    03
                                </div>
                                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 text-[11px] font-bold uppercase tracking-wider mb-2">
                                    Round 3 · AI Technical Interview
                                </div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                                    Adaptive Voice & Concept Defense
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                                    Technical discussion grounded in the candidate's resume and job requirements. Real-time voice/audio interaction using STAR rubrics, followed by an immediate Job Readiness Report.
                                </p>
                            </div>
                            <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2 text-xs font-semibold text-purple-700 dark:text-purple-400">
                                <MessageSquare className="w-4 h-4" />
                                <span>STAR Rubric & Voice Evaluation</span>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ═══════════════════════════════════════════════════════════════════
                SECTION C — RECRUITER & ADMIN WORKFLOW SUMMARY
               ═══════════════════════════════════════════════════════════════════ */}
            <section className="py-20 lg:py-24 px-4 sm:px-6 lg:px-8 bg-white dark:bg-slate-950">
                <div className="max-w-7xl mx-auto">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
                        {/* Left Column: Recruiter Workflow Description */}
                        <div className="lg:col-span-6 space-y-6">
                            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1 rounded-full border border-emerald-200/80 dark:border-emerald-800/60">
                                Administrator Suite
                            </span>
                            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-tight">
                                Bulk Recruitment & Candidate Batch Management
                            </h2>
                            <p className="text-slate-600 dark:text-slate-300 text-sm sm:text-base leading-relaxed">
                                Manage hiring drives with automated candidate pipelines, batch invitations, and centralized multi-round reporting.
                            </p>

                            <div className="space-y-3 pt-2">
                                {[
                                    { title: 'Bulk Resume Ingestion', desc: 'Upload candidate cohorts with automatic contact extraction and JD matching.' },
                                    { title: 'Recruitment Batches', desc: 'Organize candidate groups by target job role and campus drive cohorts.' },
                                    { title: 'Cryptographic Invitations', desc: 'Issue secure, expiring candidate invitation links with token-based authorization.' },
                                    { title: 'Full Proctoring Telemetry', desc: 'Review fullscreen exits, window blur events, and attempt integrity.' },
                                    { title: 'Consolidated Batch Dossiers', desc: 'Inspect rank-ordered scorecards with granular round metrics and strengths.' }
                                ].map((item, i) => (
                                    <div key={i} className="flex items-start gap-3">
                                        <div className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold">
                                            ✓
                                        </div>
                                        <div>
                                            <strong className="text-slate-900 dark:text-white text-sm font-semibold">{item.title}: </strong>
                                            <span className="text-slate-600 dark:text-slate-400 text-sm">{item.desc}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="pt-4 flex items-center gap-3">
                                <button
                                    type="button"
                                    onClick={openAdminSignIn}
                                    className="px-6 py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 font-semibold text-sm shadow-md transition-all flex items-center gap-2 cursor-pointer"
                                >
                                    <ShieldCheck className="w-4 h-4 text-emerald-400 dark:text-emerald-600" />
                                    <span>Admin Sign In</span>
                                </button>
                            </div>
                        </div>

                        {/* Right Column: Visual Organization Summary Card */}
                        <div className="lg:col-span-6">
                            <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-lg space-y-5">
                                <div className="flex items-center justify-between pb-4 border-b border-slate-200/80 dark:border-slate-800">
                                    <div>
                                        <span className="text-xs uppercase font-bold text-slate-500 dark:text-slate-400">Recruitment Command Center</span>
                                        <h4 className="text-base font-bold text-slate-900 dark:text-white">PrepWin Assessment Operations</h4>
                                    </div>
                                    <span className="px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 text-xs font-bold">
                                        Active Suite
                                    </span>
                                </div>

                                {/* Mini Pipeline Overview */}
                                <div className="space-y-2.5 text-xs">
                                    <div className="p-3.5 bg-white dark:bg-slate-800/80 rounded-2xl border border-slate-200/70 dark:border-slate-700 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-bold">
                                                01
                                            </div>
                                            <div>
                                                <div className="font-bold text-slate-900 dark:text-white">Batch & Candidate Intake</div>
                                                <div className="text-[11px] text-slate-500 dark:text-slate-400">Bulk resume parsing & JD specification</div>
                                            </div>
                                        </div>
                                        <span className="font-semibold text-emerald-700 dark:text-emerald-400">Ready</span>
                                    </div>

                                    <div className="p-3.5 bg-white dark:bg-slate-800/80 rounded-2xl border border-slate-200/70 dark:border-slate-700 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 flex items-center justify-center font-bold">
                                                02
                                            </div>
                                            <div>
                                                <div className="font-bold text-slate-900 dark:text-white">Dispatched Invitations</div>
                                                <div className="text-[11px] text-slate-500 dark:text-slate-400">Single-use tokenized links</div>
                                            </div>
                                        </div>
                                        <span className="font-semibold text-blue-700 dark:text-blue-400">Automated</span>
                                    </div>

                                    <div className="p-3.5 bg-white dark:bg-slate-800/80 rounded-2xl border border-slate-200/70 dark:border-slate-700 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 flex items-center justify-center font-bold">
                                                03
                                            </div>
                                            <div>
                                                <div className="font-bold text-slate-900 dark:text-white">Consolidated Reporting</div>
                                                <div className="text-[11px] text-slate-500 dark:text-slate-400">Readiness tiers, scorecards & PDF export</div>
                                            </div>
                                        </div>
                                        <span className="font-semibold text-purple-700 dark:text-purple-400">Analytics</span>
                                    </div>
                                </div>

                                <div className="p-3.5 bg-emerald-50/70 dark:bg-emerald-950/30 rounded-2xl border border-emerald-100 dark:border-emerald-800/50 text-xs text-emerald-900 dark:text-emerald-300 flex items-center gap-2">
                                    <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                    <span>Enterprise isolation enforced. Candidate records strictly scoped to authorized organization.</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ═══════════════════════════════════════════════════════════════════
                SECTION D — FINAL CALL TO ACTION
               ═══════════════════════════════════════════════════════════════════ */}
            <section className="py-20 lg:py-24 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-slate-50 to-emerald-50/40 dark:from-slate-900 dark:to-slate-950 border-t border-slate-200/70 dark:border-slate-800 text-center">
                <div className="max-w-4xl mx-auto space-y-6">
                    <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                        Prove Your Skills. Get Job Ready.
                    </h2>
                    <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto leading-relaxed">
                        Complete aptitude, coding, and technical interview assessments tailored to your resume and target job description.
                    </p>
                    <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
                        <button
                            type="button"
                            onClick={openStudentSignIn}
                            className="w-full sm:w-auto px-7 py-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-base shadow-md shadow-emerald-600/20 hover:shadow-lg transition-all hover:scale-[1.02] flex items-center justify-center gap-2 cursor-pointer"
                        >
                            <GraduationCap className="w-5 h-5 text-white" />
                            <span>Student Sign In</span>
                            <ArrowRight className="w-5 h-5 ml-1" />
                        </button>
                        <button
                            type="button"
                            onClick={openAdminSignIn}
                            className="w-full sm:w-auto px-7 py-4 rounded-xl border border-slate-300 hover:border-slate-400 dark:border-slate-700 dark:hover:border-slate-600 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 font-semibold text-base transition-all flex items-center justify-center gap-2 cursor-pointer"
                        >
                            <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                            <span>Admin Sign In</span>
                        </button>
                    </div>
                </div>
            </section>

            {/* ═══════════════════════════════════════════════════════════════════
                SECTION E — COMPACT FOOTER
               ═══════════════════════════════════════════════════════════════════ */}
            <footer className="bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 py-10 px-4 sm:px-6 lg:px-8 text-xs text-slate-500 dark:text-slate-400">
                <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-2.5">
                        <img src="/logo_main.png" alt="ThirdEye Data Logo" className="h-6 w-auto object-contain" />
                        <div className="w-px h-4 bg-slate-200 dark:bg-slate-700" />
                        <span className="font-bold text-slate-900 dark:text-white text-sm">PrepWin</span>
                        <span className="text-[11px] text-slate-400">· ThirdEye Data</span>
                    </div>

                    <div className="flex items-center gap-4">
                        <a href="#how-it-works" className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">How It Works</a>
                        <button onClick={openStudentSignIn} className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer">Student Access</button>
                        <button onClick={openAdminSignIn} className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer">Admin Access</button>
                    </div>

                    <div>
                        &copy; 2026 PrepWin · ThirdEye Data. All rights reserved.
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default Home;
