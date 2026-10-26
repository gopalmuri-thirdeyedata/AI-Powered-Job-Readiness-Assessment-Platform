import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion, useScroll, useSpring } from 'framer-motion';
import {
    ArrowRight,
    BrainCircuit,
    Code2,
    MessageSquare,
    ShieldCheck,
    GraduationCap,
    FileText,
    Map as MapIcon,
    Target,
    Mic,
    FolderGit2,
    Building2,
    Bot,
    ChevronDown,
    Eye,
    Check,
    Sparkles,
    Award,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { isAdminRole } from '../auth/roles';
import PublicNavbar from '../components/PublicNavbar';
import LoginModal from '../components/LoginModal';
import HeroPreview from '../components/home/HeroPreview';
import ReportPreview from '../components/home/ReportPreview';
import ProctorDemo from '../components/home/ProctorDemo';
import { Counter, EASE, Marquee, Reveal, SpotlightCard } from '../components/home/primitives';
import { CursorGlow, FloatingSymbols, Magnetic, Parallax, RotatingWords, ScrollTimeline, SplitReveal } from '../components/home/motion';

const fadeIn = {
    hidden: { opacity: 0, y: 22 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
};

const staggerContainer = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } },
};

const ROLES = ['Full-Stack Engineer', 'Data Analyst', 'Backend Developer', 'Frontend Developer', 'DevOps Engineer', 'ML Engineer', 'QA Engineer'];

const STATS = [
    { to: 3, suffix: '', label: 'Sequential rounds', hint: 'Aptitude · Coding · Interview' },
    { to: 9, suffix: '', label: 'Resume dimensions', hint: 'Scored without fabrication' },
    { to: 4, suffix: '', label: 'Placement sim rounds', hint: 'Aptitude to HR' },
    { to: 3, suffix: '/3', label: 'Proctoring strikes', hint: 'Fair, transparent limits' },
];

const TECH = [
    'Google Gemini', 'Vapi Voice AI', 'Piston Sandbox', 'Monaco Editor', 'YOLOv8 Proctoring',
    'Secure Sign-In', 'Multi-Tenant Isolation', 'STAR Rubrics', 'Hidden Test Suites', 'PDF Reports',
];

const ROUND_CARDS = [
    {
        n: '01', tone: 'blue', icon: BrainCircuit, tag: 'Round 1 · Role Aptitude',
        title: 'Reasoning & Domain Scenarios',
        body: 'Timed multiple-choice challenges synthesized from the job description. Evaluates technical reasoning, quantitative logic, and domain fundamentals. Private server-side answer keys prevent leaks.',
        foot: 'Anti-Leak Server Key Privacy',
    },
    {
        n: '02', tone: 'emerald', icon: Code2, tag: 'Round 2 · Sandboxed Coding',
        title: 'Live Programming & Hidden Tests',
        body: 'Practical algorithmic challenges in Monaco IDE executed in an isolated runtime (Piston). Validated against both public test cases and confidential hidden test suites. Unlocks after Aptitude.',
        foot: 'Isolated Piston Runtime · Multi-Language',
    },
    {
        n: '03', tone: 'purple', icon: MessageSquare, tag: 'Round 3 · AI Technical Interview',
        title: 'Adaptive Voice & Concept Defense',
        body: "Technical discussion grounded in the candidate's resume and job requirements. Real-time voice/audio interaction using STAR rubrics, followed by an immediate Job Readiness Report.",
        foot: 'STAR Rubric & Voice Evaluation',
    },
];

const TONE = {
    blue: { chip: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300', num: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/60 text-blue-700 dark:text-blue-400', foot: 'text-blue-700 dark:text-blue-400', glow: 'from-blue-500/20' },
    emerald: { chip: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300', num: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-400', foot: 'text-emerald-700 dark:text-emerald-400', glow: 'from-emerald-500/20' },
    purple: { chip: 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300', num: 'bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800/60 text-purple-700 dark:text-purple-400', foot: 'text-purple-700 dark:text-purple-400', glow: 'from-purple-500/20' },
};

const HUB = [
    { icon: FileText, title: '9-Dimension Resume Diagnostics', body: 'Upload your resume and get honest, structured scoring with strengths, gaps and recommendations.', span: 'lg:col-span-2' },
    { icon: MapIcon, title: 'Weekly Learning Roadmap', body: 'A tailored 4-week plan with daily tasks you can tick off.', span: '' },
    { icon: Target, title: 'Skill Gap Analysis', body: 'See exactly which skills stand between you and your target role.', span: '' },
    { icon: Code2, title: 'DSA & Aptitude Practice', body: 'Practice in a real editor with hidden test cases and instant feedback.', span: '' },
    { icon: Mic, title: 'AI Mock Interviews', body: 'Technical, HR or mixed — scored on STAR structure and technical accuracy.', span: '' },
    { icon: FolderGit2, title: 'AI Project Reviews', body: 'Architecture feedback and interview defense questions for your portfolio projects.', span: '' },
    { icon: Building2, title: '4-Round Placement Simulation', body: 'Rehearse a full campus drive: aptitude, coding, technical and HR rounds.', span: 'lg:col-span-2' },
    { icon: Bot, title: 'AI Career Copilot', body: 'An always-on assistant grounded in your own profile and progress.', span: '' },
];

const JOURNEY = [
    { icon: FileText, title: 'Upload your resume', body: 'Drop in your resume (PDF or DOCX). We read it the way a recruiter would.' },
    { icon: Target, title: 'Paste your dream job', body: 'Add the job description of the role you want. Every question is built from it.' },
    { icon: BrainCircuit, title: 'Take the 3 rounds', body: 'Aptitude, sandboxed coding and a live AI voice interview, one after another.' },
    { icon: Award, title: 'Get your readiness report', body: 'Scores, skill match matrix, strengths and exactly what to improve.' },
    { icon: MapIcon, title: 'Follow your roadmap', body: 'A weekly plan with daily tasks that closes your skill gaps.' },
    { icon: Building2, title: 'Apply to campus drives', body: 'Practise, simulate placements and apply to drives when you are ready.' },
];

const BENEFITS = [
    { icon: Target, title: 'Know exactly where you stand', body: 'Stop guessing. See your score against the real requirements of the role you want.' },
    { icon: Mic, title: 'Practise the interview you fear', body: 'Talk to an AI interviewer that follows up on your own resume and projects.' },
    { icon: Code2, title: 'Code like it is the real test', body: 'A real editor, multiple languages, public samples and hidden test cases.' },
    { icon: MapIcon, title: 'Turn gaps into a plan', body: 'Every weak area becomes a daily task in a personalised 4-week roadmap.' },
    { icon: ShieldCheck, title: 'Fair and honest scoring', body: 'Answer keys never reach your browser, so your score is truly yours.' },
    { icon: Bot, title: 'A copilot that knows you', body: 'Ask the Career Copilot anything, grounded in your profile and progress.' },
];

const AUDIENCE = [
    { emoji: '🎓', title: 'Final-year students', body: 'Get placement-ready before campus drives start.' },
    { emoji: '🚀', title: 'Fresh graduates', body: 'Find out what employers will actually test you on.' },
    { emoji: '🔁', title: 'Career switchers', body: 'Measure your skills against a brand-new target role.' },
    { emoji: '🏫', title: 'Placement cells', body: 'Colleges track cohort readiness from their own portal.' },
];

const PROCTOR_POINTS = [
    'Fullscreen enforced with a 10-second recovery window',
    'Phones, extra people and unauthorized screens flagged in real time',
    'Tab switches and window blur events recorded',
    'Every incident is timestamped, so nothing is ever ambiguous',
];

const FAQS = [
    { q: 'Who is PrepWin for?', a: 'Students, fresh graduates and career switchers who want to know how ready they are for a specific job, and what to fix before the real interview.' },
    { q: 'How does the assessment work?', a: 'You upload your resume and the job description you are targeting. PrepWin builds three sequential rounds from them: role aptitude, sandboxed coding and an AI voice interview. Each round unlocks only after the previous one is evaluated.' },
    { q: 'What do I get at the end?', a: 'A Job Readiness Report with round scores, a skill match matrix, strengths, improvement areas and a personalised roadmap with daily tasks.' },
    { q: 'Can I see the answers or hidden tests ahead of time?', a: 'No. Answer keys and hidden test cases stay on the server and are never sent to your browser, which keeps every attempt fair.' },
    { q: 'What does proctoring check?', a: 'Fullscreen mode, tab switching, and webcam frames for extra people, phones and other unauthorised items. You get a short recovery window after leaving fullscreen, and the session ends after three confirmed violations.' },
    { q: 'Do I need a camera and microphone?', a: 'Yes. The webcam is used for proctoring and the microphone for the AI voice interview, so use a quiet space and a laptop or desktop for the assessment.' },
    { q: 'Where can I practise before the real thing?', a: 'Inside the Student Hub: DSA and aptitude practice, AI mock interviews, a 4-round placement simulation and project reviews.' },
];

const SectionTag = ({ children }) => (
    <span className="inline-block text-[11px] sm:text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1 rounded-full border border-emerald-200/80 dark:border-emerald-800/60">
        {children}
    </span>
);

const Faq = ({ item, open, onToggle, id }) => (
    <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={`faq-${id}`}
            className="w-full flex items-center justify-between gap-4 text-left px-5 py-4 cursor-pointer"
        >
            <span className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white">{item.q}</span>
            <ChevronDown className={`w-5 h-5 shrink-0 text-emerald-600 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
        </button>
        <AnimatePresence initial={false}>
            {open && (
                <motion.div
                    id={`faq-${id}`}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: EASE }}
                >
                    <p className="px-5 pb-5 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{item.a}</p>
                </motion.div>
            )}
        </AnimatePresence>
    </div>
);

const Home = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { user, role, isLoaded } = useAuth();
    const reduce = useReducedMotion();
    const [isLoginOpen, setIsLoginOpen] = useState(false);
    const [openFaq, setOpenFaq] = useState(0);
    const heroRef = useRef(null);
    const [showStickyCta, setShowStickyCta] = useState(false);

    const { scrollYProgress } = useScroll();
    const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 28, restDelta: 0.001 });

    // Mobile sticky CTA appears once the hero has scrolled away
    useEffect(() => {
        const onScroll = () => setShowStickyCta(window.scrollY > 520);
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    // Signed in: students go straight to their dashboard; admins go to theirs when they asked to sign in (?auth=login)
    useEffect(() => {
        if (!isLoaded || !user) return;
        if (role === 'STUDENT') {
            navigate('/student/dashboard', { replace: true });
        } else if (isAdminRole(role) && searchParams.get('auth')) {
            navigate('/admin/dashboard', { replace: true });
        }
    }, [user, role, isLoaded, searchParams, navigate]);

    // Deep-linked sign-in requests (e.g. redirected from protected guards). There is no public sign-up.
    useEffect(() => {
        const authParam = searchParams.get('auth');
        if (isLoaded && !user && ['login', 'student', 'admin'].includes(authParam || '')) {
            setIsLoginOpen(true);
        }
    }, [searchParams, user, isLoaded]);

    // One login for everyone: the server decides the destination from the stored role
    const openSignIn = () => {
        if (user && role === 'STUDENT') {
            navigate('/student/dashboard');
        } else if (user && isAdminRole(role)) {
            navigate('/admin/dashboard');
        } else {
            setIsLoginOpen(true);
        }
    };
    const openStudentSignIn = openSignIn;
    const openAdminSignIn = openSignIn;

    return (
        <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-sans selection:bg-emerald-100 selection:text-emerald-900 overflow-x-hidden">
            {/* Scroll progress */}
            <motion.div
                aria-hidden="true"
                className="fixed top-0 left-0 right-0 h-0.5 z-[60] origin-left bg-gradient-to-r from-emerald-500 via-teal-400 to-blue-500"
                style={{ scaleX: reduce ? 0 : progress }}
            />

            {/* Single login (Admin and Student) */}
            <LoginModal isOpen={isLoginOpen} onClose={() => setIsLoginOpen(false)} />

            <PublicNavbar
                onOpenSignIn={openSignIn}
            />

            {/* ═══════════════════ HERO ═══════════════════ */}
            <section ref={heroRef} className="relative pt-28 pb-16 sm:pb-20 lg:pt-40 lg:pb-28 px-4 sm:px-6 lg:px-8 overflow-hidden">
                {/* Animated backdrop */}
                <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-emerald-50/70 via-white to-white dark:from-slate-900/60 dark:via-slate-950 dark:to-slate-950" />
                <div aria-hidden="true" className="absolute inset-0 opacity-[0.5] dark:opacity-[0.25] [background-image:radial-gradient(circle_at_1px_1px,rgba(100,116,139,0.25)_1px,transparent_0)] [background-size:26px_26px] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" />
                <div aria-hidden="true" className="absolute -top-10 right-[8%] w-72 sm:w-96 h-72 sm:h-96 rounded-full bg-emerald-300/40 dark:bg-emerald-500/15 blur-3xl animate-pw-blob" />
                <div aria-hidden="true" className="absolute top-40 -left-10 w-64 sm:w-80 h-64 sm:h-80 rounded-full bg-blue-300/30 dark:bg-blue-500/10 blur-3xl animate-pw-blob [animation-delay:-6s]" />
                <div aria-hidden="true" className="absolute bottom-0 left-1/3 w-64 h-64 rounded-full bg-purple-300/20 dark:bg-purple-500/10 blur-3xl animate-pw-blob [animation-delay:-11s]" />
                <CursorGlow targetRef={heroRef} />
                <FloatingSymbols />

                <div className="max-w-7xl mx-auto relative z-10">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-14 lg:gap-8 items-center">
                        <motion.div
                            initial="hidden"
                            animate="visible"
                            variants={staggerContainer}
                            className="lg:col-span-6 space-y-6 text-left"
                        >
                            <motion.div variants={fadeIn} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/80 dark:bg-emerald-950/40 backdrop-blur border border-emerald-200/80 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300 text-[11px] sm:text-xs font-semibold tracking-wide shadow-xs">
                                <span className="relative flex w-2 h-2">
                                    <span className="absolute inset-0 rounded-full bg-emerald-500 animate-pw-ping" />
                                    <span className="relative w-2 h-2 rounded-full bg-emerald-500" />
                                </span>
                                <span>AI-POWERED JOB ASSESSMENT PLATFORM</span>
                            </motion.div>

                            <motion.h1 variants={fadeIn} className="text-[2.5rem] leading-[1.08] sm:text-6xl lg:text-[3.6rem] xl:text-[4rem] font-extrabold tracking-tight text-slate-900 dark:text-white">
                                Prove Your Skills.<br />
                                <span className="bg-gradient-to-r from-emerald-700 via-teal-500 to-emerald-600 dark:from-emerald-400 dark:via-teal-300 dark:to-emerald-400 bg-[length:200%_auto] bg-clip-text text-transparent animate-pw-shimmer">
                                    Get Job Ready.
                                </span>
                            </motion.h1>

                            <motion.p variants={fadeIn} className="text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl font-normal">
                                Complete aptitude, coding, and technical interview assessments tailored to your resume and target job description.
                            </motion.p>

                            <motion.div variants={fadeIn} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200 bg-white/70 dark:bg-slate-900/70 backdrop-blur border border-slate-200 dark:border-slate-700 rounded-full pl-3 pr-4 py-1.5 shadow-xs max-w-full">
                                <Target className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                <span className="text-slate-500 dark:text-slate-400 shrink-0">Prepare for</span>
                                <RotatingWords words={ROLES} className="text-emerald-700 dark:text-emerald-400 font-bold shrink-0" />
                            </motion.div>

                            <motion.div variants={fadeIn} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
                                <Magnetic className="w-full sm:w-auto">
                                <button
                                    type="button"
                                    onClick={openStudentSignIn}
                                    className="w-full sm:w-auto group relative overflow-hidden px-6 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-lg shadow-emerald-600/25 hover:shadow-xl hover:shadow-emerald-600/35 transition-all hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950"
                                >
                                    <span aria-hidden="true" className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
                                    <GraduationCap className="w-4 h-4 relative" />
                                    <span className="relative">Start My Assessment</span>
                                    <ArrowRight className="w-4 h-4 ml-0.5 relative transition-transform group-hover:translate-x-1" />
                                </button>
                                </Magnetic>

                                <a
                                    href="#journey"
                                    className="px-5 py-3.5 rounded-xl border border-slate-300 hover:border-emerald-400 dark:border-slate-700 dark:hover:border-emerald-600 bg-white/80 dark:bg-slate-900 hover:bg-white dark:hover:bg-slate-800 backdrop-blur text-slate-800 dark:text-slate-200 font-semibold text-sm transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950"
                                >
                                    <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                    <span>See how it works</span>
                                </a>
                            </motion.div>

                            <motion.div variants={fadeIn} className="pt-4 border-t border-slate-200/70 dark:border-slate-800 flex items-start sm:items-center gap-2 text-xs text-slate-600 dark:text-slate-400 font-medium">
                                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5 sm:mt-0" />
                                <span>Sequential 3-round assessment: Role Aptitude · Sandboxed Coding · Technical AI Interview</span>
                            </motion.div>
                        </motion.div>

                        <motion.div
                            initial={reduce ? false : { opacity: 0, scale: 0.95, y: 30 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            transition={{ duration: 0.9, delay: 0.2, ease: EASE }}
                            className="lg:col-span-6 relative px-1"
                        >
                            <HeroPreview />
                        </motion.div>
                    </div>
                </div>
                <div aria-hidden="true" className="hidden lg:flex absolute bottom-6 left-1/2 -translate-x-1/2 flex-col items-center gap-1 text-[10px] font-semibold tracking-widest text-slate-400 uppercase">
                    <span>Scroll</span>
                    <span className="w-5 h-8 rounded-full border-2 border-slate-300 dark:border-slate-600 flex justify-center pt-1.5">
                        <motion.span animate={{ y: [0, 10, 0], opacity: [1, 0.2, 1] }} transition={{ duration: 1.6, repeat: Infinity }} className="w-1 h-1.5 rounded-full bg-emerald-500" />
                    </span>
                </div>
            </section>

            {/* ═══════════════════ STATS + TECH MARQUEE ═══════════════════ */}
            <section aria-label="Platform highlights" className="py-10 sm:py-14 px-4 sm:px-6 lg:px-8 border-y border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40">
                <div className="max-w-7xl mx-auto space-y-10">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
                        {STATS.map((s, i) => (
                            <Reveal key={s.label} delay={i * 0.08} className="text-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 py-5 px-3 shadow-xs">
                                <div className="text-3xl sm:text-4xl font-extrabold tracking-tight text-emerald-700 dark:text-emerald-400 tabular-nums">
                                    {s.suffix === '/3' ? <><Counter to={s.to} />/3</> : <Counter to={s.to} suffix={s.suffix} />}
                                </div>
                                <div className="mt-1 text-xs sm:text-sm font-bold text-slate-900 dark:text-white">{s.label}</div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{s.hint}</div>
                            </Reveal>
                        ))}
                    </div>
                    <Marquee items={TECH} />
                    <Marquee items={[...TECH].reverse()} reverse />
                </div>
            </section>

            {/* ═══════════════════ JOURNEY ═══════════════════ */}
            <section id="journey" className="scroll-mt-24 py-16 sm:py-20 lg:py-28 px-4 sm:px-6 lg:px-8">
                <div className="max-w-7xl mx-auto">
                    <Reveal className="text-center max-w-3xl mx-auto mb-12 sm:mb-14 space-y-3">
                        <SectionTag>Your journey</SectionTag>
                        <SplitReveal as="h2" className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white" text="From resume to job-ready in 6 steps" />
                        <p className="text-slate-600 dark:text-slate-300 text-sm sm:text-base leading-relaxed">A guided path that takes you from &ldquo;where do I stand?&rdquo; to &ldquo;I am ready&rdquo;.</p>
                    </Reveal>
                    <ScrollTimeline items={JOURNEY} />
                </div>
            </section>

            {/* ═══════════════════ HOW IT WORKS ═══════════════════ */}
            <section id="how-it-works" className="scroll-mt-24 py-16 sm:py-20 lg:py-28 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
                <Parallax from={-80} to={80} className="absolute -left-24 top-10 pointer-events-none"><div aria-hidden="true" className="w-72 h-72 rounded-full bg-blue-300/20 dark:bg-blue-500/10 blur-3xl" /></Parallax>
                <Parallax from={80} to={-80} className="absolute -right-24 bottom-10 pointer-events-none"><div aria-hidden="true" className="w-72 h-72 rounded-full bg-purple-300/20 dark:bg-purple-500/10 blur-3xl" /></Parallax>
                <div className="max-w-7xl mx-auto">
                    <Reveal className="text-center max-w-3xl mx-auto mb-12 sm:mb-16 space-y-3">
                        <SectionTag>The 3-Round Sequential Process</SectionTag>
                        <SplitReveal as="h2" className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-900 dark:text-white tracking-tight" text="How PrepWin Evaluates Job Readiness" />
                        <p className="text-slate-600 dark:text-slate-300 text-sm sm:text-base leading-relaxed">
                            A connected sequential progression tailored to your target job description and resume.
                        </p>
                    </Reveal>

                    <div className="relative">
                        {/* connector line on desktop */}
                        <div aria-hidden="true" className="hidden md:block absolute top-[3.1rem] left-[16%] right-[16%] h-px bg-gradient-to-r from-blue-300 via-emerald-300 to-purple-300 dark:from-blue-700 dark:via-emerald-700 dark:to-purple-700">
                            <motion.span className="absolute -top-1 w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_12px_3px_rgba(16,185,129,0.6)]" animate={{ left: ['0%', '100%'] }} transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', repeatType: 'reverse' }} />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-8">
                            {ROUND_CARDS.map((c, i) => {
                                const t = TONE[c.tone];
                                const Icon = c.icon;
                                return (
                                    <Reveal key={c.n} delay={i * 0.14} variant="scale" className="h-full">
                                        <SpotlightCard className="h-full bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-6 sm:p-7 shadow-xs hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col">
                                            <div className="flex-1">
                                                <div className={`w-12 h-12 rounded-2xl border font-extrabold text-lg flex items-center justify-center mb-6 shadow-xs ${t.num}`}>{c.n}</div>
                                                <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider mb-2 ${t.chip}`}>{c.tag}</div>
                                                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">{c.title}</h3>
                                                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{c.body}</p>
                                            </div>
                                            <div className={`mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2 text-xs font-semibold ${t.foot}`}>
                                                <Icon className="w-4 h-4 shrink-0" />
                                                <span>{c.foot}</span>
                                            </div>
                                        </SpotlightCard>
                                    </Reveal>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </section>

            {/* ═══════════════════ STUDENT HUB (BENTO) ═══════════════════ */}
            <section id="student-hub" className="scroll-mt-24 py-16 sm:py-20 lg:py-28 px-4 sm:px-6 lg:px-8 bg-slate-50/70 dark:bg-slate-900/40 border-y border-slate-100 dark:border-slate-800">
                <div className="max-w-7xl mx-auto">
                    <Reveal className="text-center max-w-3xl mx-auto mb-12 sm:mb-14 space-y-3">
                        <SectionTag>Student Career Hub</SectionTag>
                        <SplitReveal as="h2" className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white" text="Everything you need to get placed" />
                        <p className="text-slate-600 dark:text-slate-300 text-sm sm:text-base leading-relaxed">
                            Beyond the assessment: practice, plan and track your readiness in one place.
                        </p>
                    </Reveal>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
                        {HUB.map((h, i) => {
                            const Icon = h.icon;
                            return (
                                <Reveal key={h.title} delay={(i % 4) * 0.08} variant="scale" className={h.span}>
                                    <SpotlightCard className="h-full bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-5 sm:p-6 hover:border-emerald-300 dark:hover:border-emerald-700 hover:shadow-lg transition-all duration-300 group">
                                        <div className="w-11 h-11 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200/80 dark:border-emerald-800/60 flex items-center justify-center mb-4 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3">
                                            <Icon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                                        </div>
                                        <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1.5">{h.title}</h3>
                                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{h.body}</p>
                                    </SpotlightCard>
                                </Reveal>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* ═══════════════════ PROCTORING ═══════════════════ */}
            <section id="proctoring" className="scroll-mt-24 py-16 sm:py-20 lg:py-28 px-4 sm:px-6 lg:px-8">
                <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
                    <Reveal variant="left" className="lg:col-span-5 space-y-5">
                        <SectionTag>Integrity Built In</SectionTag>
                        <SplitReveal as="h2" className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-tight" text="Fair for every candidate. Verified by vision AI." />
                        <p className="text-slate-600 dark:text-slate-300 text-sm sm:text-base leading-relaxed">
                            Your score only means something if everyone plays fair. Smart proctoring protects honest students and keeps employers trusting your result.
                        </p>
                        <ul className="space-y-3 pt-1">
                            {PROCTOR_POINTS.map((p) => (
                                <li key={p} className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-300">
                                    <span className="mt-0.5 w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
                                        <Check className="w-3 h-3" strokeWidth={3} />
                                    </span>
                                    <span>{p}</span>
                                </li>
                            ))}
                        </ul>
                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400 pt-2">
                            <Eye className="w-4 h-4 text-emerald-600" /> Illustrative simulation of the live proctor view
                        </div>
                    </Reveal>
                    <Reveal delay={0.15} variant="right" className="lg:col-span-7">
                        <ProctorDemo />
                    </Reveal>
                </div>
            </section>

            {/* ═══════════════════ SAMPLE REPORT ═══════════════════ */}
            <section id="report" className="scroll-mt-24 py-16 sm:py-20 lg:py-28 px-4 sm:px-6 lg:px-8 bg-slate-50/70 dark:bg-slate-900/40 border-y border-slate-100 dark:border-slate-800">
                <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
                    <Reveal variant="left" className="lg:col-span-6 space-y-5">
                        <SectionTag>Your Job Readiness Report</SectionTag>
                        <SplitReveal as="h2" className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-tight" text="Know exactly what to fix before the real interview" />
                        <p className="text-slate-600 dark:text-slate-300 text-sm sm:text-base leading-relaxed">
                            No vague feedback. Your report shows where you are strong, where you lose marks, and what to practise next, specific to the job you want.
                        </p>
                        <ul className="space-y-3 pt-1">
                            {['Overall readiness score plus a score for each round', 'Skill match matrix against the job description', 'Strengths you can mention confidently in interviews', 'Improvement areas that automatically become your roadmap'].map((p) => (
                                <li key={p} className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-300">
                                    <span className="mt-0.5 w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0"><Check className="w-3 h-3" strokeWidth={3} /></span>
                                    <span>{p}</span>
                                </li>
                            ))}
                        </ul>
                        <button type="button" onClick={openStudentSignIn} className="group w-full sm:w-auto px-6 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-lg shadow-emerald-600/25 transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 cursor-pointer">
                            <span>Get my report</span><ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                        </button>
                    </Reveal>
                    <Reveal delay={0.15} variant="right" className="lg:col-span-6">
                        <ReportPreview />
                        <p className="text-center text-[11px] text-slate-500 dark:text-slate-400 mt-3">Sample report with demo data</p>
                    </Reveal>
                </div>
            </section>

            {/* ═══════════════════ WHY STUDENTS LOVE IT + AUDIENCE ═══════════════════ */}
            <section id="why" className="scroll-mt-24 py-16 sm:py-20 lg:py-28 px-4 sm:px-6 lg:px-8">
                <div className="max-w-7xl mx-auto">
                    <Reveal className="text-center max-w-3xl mx-auto mb-12 space-y-3">
                        <SectionTag>Why students love PrepWin</SectionTag>
                        <SplitReveal as="h2" className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white" text="Built to get you hired, not just scored" />
                    </Reveal>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
                        {BENEFITS.map((b, i) => {
                            const Icon = b.icon;
                            return (
                                <Reveal key={b.title} delay={(i % 3) * 0.1} variant="blur">
                                    <SpotlightCard className="h-full bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-6 hover:border-emerald-300 dark:hover:border-emerald-700 hover:shadow-lg transition-all duration-300 group">
                                        <div className="w-11 h-11 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200/80 dark:border-emerald-800/60 flex items-center justify-center mb-4 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3">
                                            <Icon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                                        </div>
                                        <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1.5">{b.title}</h3>
                                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{b.body}</p>
                                    </SpotlightCard>
                                </Reveal>
                            );
                        })}
                    </div>

                    <Reveal className="mt-14 sm:mt-16">
                        <h3 className="text-center text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white mb-6">Made for</h3>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
                            {AUDIENCE.map((a) => (
                                <div key={a.title} className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-gradient-to-b from-white to-emerald-50/40 dark:from-slate-900 dark:to-slate-900 p-4 sm:p-5 text-center hover:-translate-y-1 hover:shadow-lg transition-all">
                                    <div className="text-3xl mb-2" aria-hidden="true">{a.emoji}</div>
                                    <div className="text-sm font-bold text-slate-900 dark:text-white">{a.title}</div>
                                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">{a.body}</p>
                                </div>
                            ))}
                        </div>
                    </Reveal>
                </div>
            </section>

            {/* ═══════════════════ FAQ ═══════════════════ */}
            <section id="faq" className="scroll-mt-24 py-16 sm:py-20 lg:py-28 px-4 sm:px-6 lg:px-8">
                <div className="max-w-3xl mx-auto">
                    <Reveal className="text-center mb-10 space-y-3">
                        <SectionTag>FAQ</SectionTag>
                        <SplitReveal as="h2" className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white" text="Questions, answered" />
                    </Reveal>
                    <div className="space-y-3">
                        {FAQS.map((f, i) => (
                            <Reveal key={f.q} delay={i * 0.05}>
                                <Faq item={f} id={i} open={openFaq === i} onToggle={() => setOpenFaq(openFaq === i ? -1 : i)} />
                            </Reveal>
                        ))}
                    </div>
                </div>
            </section>

            {/* ═══════════════════ FINAL CTA ═══════════════════ */}
            <section className="relative overflow-hidden py-16 sm:py-24 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-white to-emerald-50/60 dark:from-slate-950 dark:to-slate-900 border-t border-slate-200/70 dark:border-slate-800 text-center">
                <div aria-hidden="true" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[34rem] max-w-full h-72 rounded-full bg-emerald-300/30 dark:bg-emerald-500/10 blur-3xl animate-pw-blob" />
                <div aria-hidden="true" className="absolute -left-20 top-0 w-72 h-72 rounded-full bg-blue-300/25 dark:bg-blue-500/10 blur-3xl animate-pw-blob [animation-delay:-5s]" />
                <div aria-hidden="true" className="absolute -right-20 bottom-0 w-72 h-72 rounded-full bg-purple-300/25 dark:bg-purple-500/10 blur-3xl animate-pw-blob [animation-delay:-9s]" />
                <FloatingSymbols />
                <Reveal className="relative max-w-4xl mx-auto space-y-6">
                    <SplitReveal as="h2" className="text-3xl sm:text-5xl lg:text-6xl font-extrabold text-slate-900 dark:text-white tracking-tight" text="Prove Your Skills. Get Job Ready." />
                    <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto leading-relaxed">
                        Complete aptitude, coding, and technical interview assessments tailored to your resume and target job description.
                    </p>
                    <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
                        <Magnetic className="relative w-full sm:w-auto">
                            <span aria-hidden="true" className="absolute inset-0 rounded-xl bg-emerald-500/40 animate-pw-ping pointer-events-none" />
                        <button
                            type="button"
                            onClick={openStudentSignIn}
                            className="group w-full sm:w-auto px-7 py-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-base shadow-lg shadow-emerald-600/25 hover:shadow-xl transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 cursor-pointer"
                        >
                            <GraduationCap className="w-5 h-5" />
                            <span>Start My Assessment</span>
                            <ArrowRight className="w-5 h-5 ml-1 transition-transform group-hover:translate-x-1" />
                        </button>
                        </Magnetic>
                    </div>
                </Reveal>
            </section>

            {/* ═══════════════════ FOOTER ═══════════════════ */}
            <footer className="bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 py-10 px-4 sm:px-6 lg:px-8 text-xs text-slate-500 dark:text-slate-400 pb-24 md:pb-10">
                <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-5 text-center md:text-left">
                    <div className="flex items-center gap-2.5">
                        <img src="/logo_main.png" alt="ThirdEye Data Logo" className="h-6 w-auto object-contain" />
                        <div className="w-px h-4 bg-slate-200 dark:bg-slate-700" />
                        <span className="font-bold text-slate-900 dark:text-white text-sm">PrepWin</span>
                        <span className="text-[11px] text-slate-400">· ThirdEye Data</span>
                    </div>

                    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
                        <a href="#how-it-works" className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">How It Works</a>
                        <a href="#faq" className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">FAQ</a>
                        <button type="button" onClick={openStudentSignIn} className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer">Student Access</button>
                        <button type="button" onClick={openAdminSignIn} className="hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer">Admin Access</button>
                    </div>

                    <div>&copy; 2026 PrepWin · ThirdEye Data. All rights reserved.</div>
                </div>
            </footer>

            {/* Mobile sticky CTA */}
            <AnimatePresence>
                {showStickyCta && (
                    <motion.div
                        initial={{ y: 80, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 80, opacity: 0 }}
                        transition={{ duration: 0.35, ease: EASE }}
                        className="md:hidden fixed bottom-0 inset-x-0 z-40 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-white/90 dark:bg-slate-950/90 backdrop-blur-xl border-t border-slate-200 dark:border-slate-800 flex gap-2"
                    >
                        <button type="button" onClick={openStudentSignIn} className="flex-1 py-3 rounded-xl bg-emerald-600 active:bg-emerald-700 text-white text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer">
                            <GraduationCap className="w-4 h-4" /> Start My Assessment
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default Home;
