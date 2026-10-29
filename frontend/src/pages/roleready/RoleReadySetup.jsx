import React, { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useNavigate, Link } from 'react-router-dom';
import {
    Sparkles,
    FileText,
    Target,
    Building2,
    Upload,
    ArrowRight,
    CheckCircle2,
    AlertTriangle,
    ShieldCheck,
    Briefcase,
    X,
    Lock,
    Clock,
    LayoutDashboard,
    Camera,
    Mic,
    Maximize,
    Wifi,
    Rocket,
    Check,
    HelpCircle
} from 'lucide-react';
import { useUser } from '../../auth/useAuth';
import rolereadyApi from '../../services/rolereadyApi';
import RoleReadyNavbar from '../../components/RoleReadyNavbar';
import WalkthroughTour from '../../components/WalkthroughTour';
import AssessmentLoadingOverlay from '../../components/AssessmentLoadingOverlay';
import useStudentTaskStatus from '../../hooks/useStudentTaskStatus';
import { useAssessmentLock } from '../../context/AssessmentLockContext';
import { failureCode, failureMessage } from '../../services/rolereadyApi';

const popularRoles = [
    "Full Stack Engineer",
    "Frontend Developer",
    "Backend Developer",
    "Data Engineer",
    "DevOps / Cloud Engineer",
    "Machine Learning Engineer"
];

const containerV = { hidden: {}, visible: { transition: { staggerChildren: 0.09, delayChildren: 0.1 } } };
const itemV = {
    hidden: { opacity: 0, y: 24, filter: 'blur(6px)' },
    visible: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
};

const PREFLIGHT = [
    { icon: Camera, label: 'Webcam on', hint: 'Used for proctoring' },
    { icon: Mic, label: 'Microphone ready', hint: 'For the AI interview' },
    { icon: Maximize, label: 'Fullscreen mode', hint: 'Stay in fullscreen' },
    { icon: Wifi, label: 'Stable internet', hint: 'Avoid dropouts' },
];

const TOUR_KEY = 'prepwin_setup_tour_done';

const TOUR_STEPS = [
    {
        emoji: '👋',
        title: 'Welcome to PrepWin!',
        body: 'In about a minute you will set up a personalised assessment. This quick tour shows what each part does so nothing is a surprise.',
    },
    {
        emoji: '🎯',
        target: '#tour-role',
        title: 'Pick your target role',
        body: 'Choose the job you are preparing for, or type your own. Every question is built around this role.',
        tip: 'Add a company name if you are aiming at a specific one.',
    },
    {
        emoji: '📄',
        target: '#tour-jd',
        title: 'Add the job description',
        body: 'Paste the job posting or upload it as a file. The more detail it has, the more accurate your questions will be.',
        tip: 'Include skills, tech stack and responsibilities.',
    },
    {
        emoji: '📎',
        target: '#tour-resume',
        title: 'Upload your resume (optional)',
        body: 'We use it to ask about your own projects and experience. Skip it and we will use the resume saved on your profile.',
    },
    {
        emoji: '🧭',
        target: '#tour-rounds',
        title: 'Three rounds, one after another',
        body: 'Aptitude, Coding and an AI Technical Interview. Each round unlocks only after you finish the one before it. Plan for about 60 minutes.',
    },
    {
        emoji: '✅',
        target: '#tour-ready',
        title: 'Check you are ready',
        body: 'The progress bar fills as you complete the form. Make sure your webcam, microphone and internet are ready, and stay in fullscreen.',
        tip: 'Use a quiet place and a laptop or desktop.',
    },
    {
        emoji: '🚀',
        target: '#tour-start',
        title: 'Start when you are ready',
        body: 'Press Start Assessment and we will generate your tailored questions in a few seconds. You can reopen this tour any time from the Take a tour button.',
    },
];

const MAX_RESUME_MB = 5;
const MAX_JD_MB = 5;
const ACCEPTED_RESUME = ".pdf,.docx";
const ACCEPTED_JD = ".pdf,.docx,.txt";

/* ── Compact Upload Dropzone ─────────────────────────────── */
const CompactUploadZone = ({ label, hint, accept, file, onFile, onClear, hasError }) => (
    <div
        className={`relative border-2 border-dashed rounded-2xl p-4 text-center transition-all ${
            file
                ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30'
                : hasError
                    ? 'border-red-400 dark:border-red-500/80 bg-red-50/40 dark:bg-red-950/20'
                    : 'border-slate-200 dark:border-slate-800 hover:border-emerald-500 dark:hover:border-emerald-500 bg-slate-50 dark:bg-slate-950/50'
        }`}
    >
        {file ? (
            <div className="flex items-center justify-between gap-3 text-left">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center text-emerald-700 dark:text-emerald-300 shrink-0">
                        <FileText className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                            {file.name}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {(file.size / 1024 / 1024).toFixed(2)} MB · Selected
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onClear}
                    className="p-1.5 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors shrink-0 cursor-pointer"
                    aria-label="Remove file"
                    title="Remove file"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
        ) : (
            <label className="cursor-pointer block py-1">
                <div className={`w-8 h-8 rounded-xl bg-white dark:bg-slate-900 border shadow-2xs flex items-center justify-center mx-auto mb-1.5 ${
                    hasError
                        ? 'border-red-300 text-red-500 dark:border-red-800 dark:text-red-400'
                        : 'border-slate-200 dark:border-slate-700 text-emerald-600 dark:text-emerald-400'
                }`}>
                    <Upload className="w-4 h-4" />
                </div>
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                    {label}
                </span>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {hint}
                </span>
                <input
                    type="file"
                    accept={accept}
                    className="hidden"
                    onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) onFile(f);
                        e.target.value = '';
                    }}
                />
            </label>
        )}
    </div>
);

/* ── Compact Assessment Round Row ────────────────────────── */
const PipelineRoundRow = ({ stepNumber, title, description, duration, isGated = false }) => (
    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-800/80 flex items-start gap-3 transition-all hover:-translate-y-0.5 hover:shadow-sm hover:border-emerald-300 dark:hover:border-emerald-700">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 ${
            isGated
                ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'
                : 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 ring-4 ring-emerald-200/60 dark:ring-emerald-800/40 animate-pulse'
        }`}>
            {stepNumber}
        </div>
        <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <span>{title}</span>
                    {isGated
                        ? <Lock className="w-3 h-3 text-slate-400 dark:text-slate-500 shrink-0" />
                        : <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/40 px-1.5 py-0.5 rounded">Unlocked</span>}
                </h4>
                <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-900 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700/80 shrink-0">
                    <Clock className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                    <span>{duration}</span>
                </div>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                {description}
            </p>
        </div>
    </div>
);

/* ═════════════════════════════════════════════════════════════
   MAIN COMPONENT: RoleReadySetup
   ═════════════════════════════════════════════════════════════ */
const RoleReadySetup = () => {
    const navigate = useNavigate();
    const { user, isLoaded: isUserLoaded } = useUser();
    const { hasCompletedTask } = useStudentTaskStatus(user);
    const { promptContactAdmin, assessmentLocked, refreshAccess } = useAssessmentLock();

    const [targetRole, setTargetRole] = useState("Full Stack Engineer");
    const [targetCompany, setTargetCompany] = useState("");
    const [jdMode, setJdMode] = useState("paste"); // "paste" | "upload"
    const [customJdText, setCustomJdText] = useState("");
    const [jdFile, setJdFile] = useState(null);
    const [resumeFile, setResumeFile] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [fieldErrors, setFieldErrors] = useState({});

    const reduce = useReducedMotion();
    const [tourOpen, setTourOpen] = useState(false);

    // Offer the tour automatically the first time each student lands here. The "seen" flag is stored per
    // account, so a new signup in a browser that another account already used still gets the tour.
    const tourStorageKey = user?.id ? `${TOUR_KEY}:${user.id}` : null;
    useEffect(() => {
        if (!isUserLoaded || !tourStorageKey) return undefined;
        let seen = false;
        try { seen = localStorage.getItem(tourStorageKey) === '1'; } catch { /* storage unavailable */ }
        if (seen) return undefined;
        const t = setTimeout(() => setTourOpen(true), 900);
        return () => clearTimeout(t);
    }, [isUserLoaded, tourStorageKey]);

    const closeTour = () => {
        setTourOpen(false);
        if (!tourStorageKey) return;
        try { localStorage.setItem(tourStorageKey, '1'); } catch { /* storage unavailable */ }
    };
    const firstName = user?.firstName || '';
    const jdWords = customJdText.trim() ? customJdText.trim().split(/\s+/).length : 0;
    const roleDone = !!targetRole.trim();
    const jdDone = jdMode === "paste" ? jdWords > 0 : !!jdFile;
    const resumeDone = !!resumeFile;
    const progress = (roleDone ? 35 : 0) + (jdDone ? 50 : 0) + (resumeDone ? 15 : 0);
    const checklist = [
        { label: 'Target role chosen', done: roleDone },
        { label: 'Job description added', done: jdDone },
        { label: resumeDone ? 'Resume attached' : 'Resume (optional, profile resume used)', done: resumeDone, optional: true },
    ];

    const handleRoleChange = (val) => {
        setTargetRole(val);
        if (fieldErrors.targetRole) {
            setFieldErrors((prev) => ({ ...prev, targetRole: undefined }));
        }
    };

    const handleJdTextChange = (val) => {
        setCustomJdText(val);
        if (fieldErrors.jd) {
            setFieldErrors((prev) => ({ ...prev, jd: undefined }));
        }
    };

    const handleJdFileChange = (file) => {
        setJdFile(file);
        if (fieldErrors.jd) {
            setFieldErrors((prev) => ({ ...prev, jd: undefined }));
        }
    };

    const handleResumeFileChange = (file) => {
        setResumeFile(file);
        if (fieldErrors.resume) {
            setFieldErrors((prev) => ({ ...prev, resume: undefined }));
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        // Also covers Enter pressed inside a field, which submits the form without clicking the button.
        // The server decides: re-read the student's access (an admin may have changed it since the page opened).
        if (!(await refreshAccess())) {
            promptContactAdmin();
            return;
        }
        setError(null);

        const errors = {};
        if (!targetRole.trim()) {
            errors.targetRole = "Target job title is required. Please choose a role or enter a custom title.";
        }

        if (jdMode === "paste") {
            if (!customJdText.trim()) {
                errors.jd = "Job description is required. Please paste the job description text.";
            }
        } else if (jdMode === "upload") {
            if (!jdFile) {
                errors.jd = "Job description document is required. Please upload a PDF, DOCX, or TXT file.";
            }
        }

        if (Object.keys(errors).length > 0) {
            setFieldErrors(errors);
            setError("Please fill in all required fields before starting the assessment.");
            return;
        }

        setFieldErrors({});
        setIsLoading(true);

        try {
            const formData = new FormData();
            formData.append("target_role", targetRole.trim());
            if (targetCompany.trim()) {
                formData.append("target_company", targetCompany.trim());
            }

            if (jdMode === "paste") {
                formData.append("custom_jd_text", customJdText.trim());
            } else if (jdMode === "upload" && jdFile) {
                formData.append("jd_file", jdFile);
            }

            if (resumeFile) {
                formData.append("resume_file", resumeFile);
            }

            const res = await rolereadyApi.initializeSession(formData);
            if (res && res.session_uuid) {
                navigate(`/assessment/${res.session_uuid}`);
            } else {
                throw new Error("Invalid session response received from server.");
            }
        } catch (err) {
            console.error("Failed to initialize assessment session:", err);
            if (failureCode(err) === 'ASSESSMENT_ACCESS_LOCKED') {
                promptContactAdmin();   // access was revoked after the page opened
            } else {
                setError(failureMessage(err, "Could not initialize assessment. Please check your inputs and try again."));
            }
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div
            className="relative overflow-x-clip min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans selection:bg-emerald-100 selection:text-emerald-900 flex flex-col transition-colors duration-200"
            style={{ fontFamily: "'Inter', 'Plus Jakarta Sans', system-ui, sans-serif" }}
        >
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[34rem] overflow-hidden">
                <div className="absolute -top-24 right-[10%] w-80 h-80 rounded-full bg-emerald-300/30 dark:bg-emerald-500/10 blur-3xl animate-pw-blob" />
                <div className="absolute top-20 -left-16 w-72 h-72 rounded-full bg-blue-300/25 dark:bg-blue-500/10 blur-3xl animate-pw-blob [animation-delay:-6s]" />
                <div className="absolute inset-0 opacity-40 dark:opacity-20 [background-image:radial-gradient(circle_at_1px_1px,rgba(100,116,139,0.25)_1px,transparent_0)] [background-size:26px_26px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
            </div>

            {/* ── Standardized Shared Navbar ── */}
            <RoleReadyNavbar title="Assessment Setup" showDashboard={hasCompletedTask} />

            {/* ── Main Content Container (Max width ~1160–1240px) ── */}
            <main className="relative flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
                {/* Header Title Section with Dashboard Link */}
                <div className="mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <motion.div
                        initial={reduce ? false : { opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                        className="space-y-1.5"
                    >
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-800 dark:text-emerald-300 text-xs font-semibold">
                            <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            <span>{firstName ? `WELCOME, ${firstName.toUpperCase()}` : 'AI-POWERED EVALUATION'}</span>
                        </div>
                        <h1 className="text-3xl sm:text-4xl lg:text-[40px] font-extrabold tracking-tight bg-gradient-to-r from-slate-900 via-emerald-700 to-slate-900 dark:from-white dark:via-emerald-300 dark:to-white bg-[length:200%_auto] bg-clip-text text-transparent animate-pw-shimmer">
                            Set Up Your Assessment
                        </h1>
                        <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 font-normal leading-relaxed max-w-2xl">
                            Choose your target role and provide the job description for a personalized assessment.
                        </p>
                    </motion.div>

                    <div className="flex flex-wrap items-center gap-2 self-start md:self-auto shrink-0">
                    <button
                        type="button"
                        onClick={() => setTourOpen(true)}
                        id="setup-take-tour-btn"
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-800/60 text-xs font-semibold text-emerald-800 dark:text-emerald-300 transition-all cursor-pointer"
                    >
                        <HelpCircle className="w-4 h-4" />
                        <span>Take a tour</span>
                    </button>
                    <Link
                        to="/student/dashboard"
                        id="setup-view-dashboard-btn"
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 hover:border-emerald-300 dark:hover:border-emerald-500/40 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-all shadow-2xs hover:shadow-xs self-start md:self-auto shrink-0 cursor-pointer"
                    >
                        <LayoutDashboard className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        <span>View Past Tests & Dashboard</span>
                    </Link>
                    </div>
                </div>

                {/* Validation / Error Banner */}
                {error && (
                    <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 dark:bg-red-950/30 dark:border-red-800/60 text-red-800 dark:text-red-300 text-xs sm:text-sm flex items-start gap-3 animate-in fade-in duration-150">
                        <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                        <span className="font-medium leading-relaxed">{error}</span>
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    {/* ── Balanced 2-Column Desktop / 1-Column Mobile Layout ── */}
                    <motion.div variants={containerV} initial={reduce ? false : "hidden"} animate="visible" className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

                        {/* ══════════════════════════════════════════
                            LEFT COLUMN: Target Position, Job Description & Resume
                           ══════════════════════════════════════════ */}
                        <div className="lg:col-span-7 space-y-6">
                            
                            {/* Card 1: Target Position */}
                            <motion.div id="tour-role" variants={itemV}>
                            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-5 transition-colors">
                                <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100 dark:border-slate-800">
                                    <div className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 flex items-center justify-center font-bold">
                                        <Target className="w-4 h-4" />
                                    </div>
                                    <div>
                                        <h2 className="text-base font-bold text-slate-900 dark:text-white">Target Position</h2>
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400">Specify the role and optional company you are preparing for</p>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label htmlFor="target-role-input" className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                                        Target Job Title / Role <span className="text-emerald-600 dark:text-emerald-400">*</span>
                                    </label>
                                    <input
                                        id="target-role-input"
                                        name="target_role"
                                        type="text"
                                        required
                                        aria-required="true"
                                        value={targetRole}
                                        onChange={(e) => handleRoleChange(e.target.value)}
                                        placeholder="e.g. Full Stack Engineer, Frontend Developer, DevOps Specialist..."
                                        className={`w-full h-11 bg-slate-50 dark:bg-slate-950/50 border rounded-xl px-4 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 transition-all font-medium ${
                                            fieldErrors.targetRole
                                                ? 'border-red-400 dark:border-red-500/80 focus:border-red-500 focus:ring-red-500/20'
                                                : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 focus:border-emerald-500 dark:focus:border-emerald-500 focus:ring-emerald-500/20'
                                        }`}
                                    />

                                    {/* Inline Validation Error for Target Role */}
                                    {fieldErrors.targetRole && (
                                        <p className="text-xs text-red-600 dark:text-red-400 font-medium flex items-center gap-1.5 animate-in fade-in duration-150">
                                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                            <span>{fieldErrors.targetRole}</span>
                                        </p>
                                    )}

                                    {/* Role Suggestion Chips */}
                                    <div className="flex flex-wrap gap-1.5 pt-1">
                                        {popularRoles.map((r) => {
                                            const isSelected = targetRole.trim().toLowerCase() === r.toLowerCase();
                                            return (
                                                <button
                                                    key={r}
                                                    type="button"
                                                    onClick={() => handleRoleChange(r)}
                                                    className={`text-xs px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                                                        isSelected
                                                            ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-400 dark:border-emerald-600 text-emerald-800 dark:text-emerald-300 font-semibold shadow-2xs'
                                                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/40 font-medium'
                                                    }`}
                                                >
                                                    {r}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Target Company Input */}
                                <div className="space-y-1.5 pt-1 border-t border-slate-100 dark:border-slate-800">
                                    <label htmlFor="target-company-input" className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                                        Target Company <span className="text-slate-400 dark:text-slate-500 font-normal text-[11px]">(optional)</span>
                                    </label>
                                    <div className="relative">
                                        <Building2 className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                                        <input
                                            id="target-company-input"
                                            name="target_company"
                                            type="text"
                                            value={targetCompany}
                                            onChange={(e) => setTargetCompany(e.target.value)}
                                            placeholder="e.g. Google, Stripe, Microsoft, or Startup"
                                            className="w-full h-11 bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 rounded-xl pl-10 pr-4 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-emerald-500 dark:focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all font-medium"
                                        />
                                    </div>
                                </div>
                            </div>

                            </motion.div>

                            {/* Card 2: Job Description */}
                            <motion.div id="tour-jd" variants={itemV}>
                            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-4 transition-colors">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800 gap-2">
                                    <div className="flex items-center gap-2.5">
                                        <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400 flex items-center justify-center font-bold">
                                            <Briefcase className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <h2 className="text-base font-bold text-slate-900 dark:text-white">
                                                Job Description <span className="text-emerald-600 dark:text-emerald-400">*</span>
                                            </h2>
                                            <p className="text-[11px] text-slate-500 dark:text-slate-400">Provide job requirements for specialized questions</p>
                                        </div>
                                    </div>

                                    {/* Mode Switcher */}
                                    <div className="p-0.5 bg-slate-100 dark:bg-slate-800/80 rounded-xl flex items-center self-start sm:self-auto border border-slate-200/80 dark:border-slate-700">
                                        <button
                                            type="button"
                                            onClick={() => setJdMode("paste")}
                                            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                                                jdMode === 'paste'
                                                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xs'
                                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                                            }`}
                                        >
                                            Paste Text
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setJdMode("upload")}
                                            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                                                jdMode === 'upload'
                                                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xs'
                                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                                            }`}
                                        >
                                            Upload File
                                        </button>
                                    </div>
                                </div>

                                {jdMode === "paste" ? (
                                    <div className="space-y-1.5">
                                        <textarea
                                            rows={6}
                                            value={customJdText}
                                            onChange={(e) => handleJdTextChange(e.target.value)}
                                            placeholder="Paste the job description text here — skills, technical stack, responsibilities, years of experience, requirements..."
                                            className={`w-full min-h-[140px] bg-slate-50 dark:bg-slate-950/50 border rounded-xl p-3.5 text-sm font-sans text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 transition-all leading-relaxed resize-y ${
                                                fieldErrors.jd
                                                    ? 'border-red-400 dark:border-red-500/80 focus:border-red-500 focus:ring-red-500/20'
                                                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 focus:border-emerald-500 dark:focus:border-emerald-500 focus:ring-emerald-500/20'
                                            }`}
                                        />
                                        <div className="flex items-center justify-between gap-3 text-[11px]">
                                            <p className={jdWords === 0 ? 'text-slate-500 dark:text-slate-400' : jdWords < 40 ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-emerald-700 dark:text-emerald-400 font-medium'}>
                                                {jdWords === 0
                                                    ? 'A detailed JD ensures accurate questions across Aptitude, Coding, and Technical Interview.'
                                                    : jdWords < 40
                                                        ? 'Add more detail: skills, tech stack and responsibilities improve question accuracy.'
                                                        : 'Great detail. This is enough for a well-tailored assessment.'}
                                            </p>
                                            <span className="tabular-nums text-slate-400 dark:text-slate-500 shrink-0">{jdWords} words</span>
                                        </div>
                                    </div>
                                ) : (
                                    <CompactUploadZone
                                        label="Click or drag JD document here"
                                        hint={`PDF, DOCX, or TXT · max ${MAX_JD_MB} MB`}
                                        accept={ACCEPTED_JD}
                                        file={jdFile}
                                        onFile={handleJdFileChange}
                                        onClear={() => handleJdFileChange(null)}
                                        hasError={!!fieldErrors.jd}
                                    />
                                )}

                                {/* Inline Validation Error for Job Description */}
                                {fieldErrors.jd && (
                                    <p className="text-xs text-red-600 dark:text-red-400 font-medium flex items-center gap-1.5 animate-in fade-in duration-150">
                                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                        <span>{fieldErrors.jd}</span>
                                    </p>
                                )}
                            </div>
                            </motion.div>

                            {/* Card 1: Resume Upload */}
                            <motion.div id="tour-resume" variants={itemV}>
                            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-4 transition-colors">
                                <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100 dark:border-slate-800">
                                    <div className="w-7 h-7 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 flex items-center justify-center font-bold">
                                        <FileText className="w-4 h-4" />
                                    </div>
                                    <div>
                                        <h2 className="text-base font-bold text-slate-900 dark:text-white">Resume Upload</h2>
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400">Personalize questions to your experience</p>
                                    </div>
                                </div>

                                <CompactUploadZone
                                    label="Click or drag your resume here"
                                    hint={`PDF or DOCX · max ${MAX_RESUME_MB} MB`}
                                    accept={ACCEPTED_RESUME}
                                    file={resumeFile}
                                    onFile={handleResumeFileChange}
                                    onClear={() => handleResumeFileChange(null)}
                                    hasError={!!fieldErrors.resume}
                                />

                                {!resumeFile && (
                                    <div className="p-2.5 bg-slate-50 dark:bg-slate-950/50 rounded-xl border border-slate-200/80 dark:border-slate-800/80 text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
                                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                        <span>Leave blank to use your existing profile resume.</span>
                                    </div>
                                )}
                            </div>

                            </motion.div>
                        </div>

                        {/* ══════════════════════════════════════════
                            RIGHT COLUMN: Pipeline, Readiness & Start Action
                            ══════════════════════════════════════════ */}
                        <div className="lg:col-span-5 space-y-6">
                            
                            {/* Card 2: Three-Round Assessment */}
                            <motion.div id="tour-rounds" variants={itemV}>
                            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-4 transition-colors">
                                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                                    <div className="flex items-center gap-2.5">
                                        <div className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 flex items-center justify-center font-bold">
                                            <ShieldCheck className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <h2 className="text-base font-bold text-slate-900 dark:text-white">Three-Round Assessment</h2>
                                            <p className="text-[11px] text-slate-500 dark:text-slate-400">Sequential evaluation pipeline</p>
                                        </div>
                                    </div>
                                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/60 px-2 py-1 rounded-lg shrink-0">
                                        <Clock className="w-3 h-3" /> ~60 min
                                    </span>
                                </div>

                                <div className="space-y-2.5">
                                    <PipelineRoundRow
                                        stepNumber="1"
                                        title="Aptitude"
                                        description="Quantitative, logical reasoning & domain scenario MCQs."
                                        duration="20 min"
                                        isGated={false}
                                    />
                                    <PipelineRoundRow
                                        stepNumber="2"
                                        title="Coding Assessment"
                                        description="Algorithmic coding in an interactive sandbox with test cases."
                                        duration="20 min"
                                        isGated={true}
                                    />
                                    <PipelineRoundRow
                                        stepNumber="3"
                                        title="Technical Interview"
                                        description="AI-guided technical conversation & concept defense."
                                        duration="10 min"
                                        isGated={true}
                                    />
                                </div>

                                <div className="p-2.5 bg-emerald-50/70 dark:bg-emerald-950/30 rounded-xl border border-emerald-100 dark:border-emerald-800/50 text-[11px] text-emerald-900 dark:text-emerald-300 flex items-center gap-2">
                                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                    <span>Server-side gated: Each round unlocks upon completing the prior round.</span>
                                </div>
                            </div>

                            </motion.div>

                            <div className="space-y-6 lg:sticky lg:top-24">
                            {/* Readiness checklist + pre-flight */}
                            <motion.div id="tour-ready" variants={itemV}>
                                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-4">
                                    <div className="flex items-center justify-between">
                                        <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                            <Rocket className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> Ready to launch
                                        </h2>
                                        <span className="text-sm font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums">{progress}%</span>
                                    </div>
                                    <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                                        <motion.div
                                            className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-500"
                                            animate={{ width: `${progress}%` }}
                                            transition={{ type: 'spring', stiffness: 120, damping: 20 }}
                                        />
                                    </div>
                                    <ul className="space-y-2">
                                        {checklist.map((c) => (
                                            <li key={c.label} className="flex items-center gap-2.5 text-xs">
                                                <motion.span
                                                    animate={{ scale: c.done ? [1, 1.35, 1] : 1 }}
                                                    transition={{ duration: 0.35 }}
                                                    className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 border ${
                                                        c.done
                                                            ? 'bg-emerald-500 border-emerald-500 text-white'
                                                            : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-transparent'
                                                    }`}
                                                >
                                                    <Check className="w-3 h-3" strokeWidth={3} />
                                                </motion.span>
                                                <span className={c.done ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}>{c.label}</span>
                                            </li>
                                        ))}
                                    </ul>
                                    <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                                        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Before you start</div>
                                        <div className="grid grid-cols-2 gap-2">
                                            {PREFLIGHT.map((p) => {
                                                const Icon = p.icon;
                                                return (
                                                    <div key={p.label} className="flex items-center gap-2 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-800/80 px-2.5 py-2">
                                                        <Icon className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                                        <div className="min-w-0">
                                                            <div className="text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate">{p.label}</div>
                                                            <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{p.hint}</div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </motion.div>

                            {/* Primary Action CTA: Start Assessment */}
                            <motion.div id="tour-start" variants={itemV}>
                            <div className="space-y-2">
                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className="group relative overflow-hidden w-full h-12 px-6 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 active:scale-[0.98] text-white font-bold text-sm shadow-lg shadow-emerald-600/25 hover:shadow-xl hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isLoading ? (
                                        <span className="flex items-center gap-2.5">
                                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            <span>Synthesizing Tailored Assessment...</span>
                                        </span>
                                    ) : (
                                        <>
                                            <span aria-hidden="true" className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
                                            <span className="relative">Start Assessment</span>
                                            {assessmentLocked
                                                ? <Lock className="w-4 h-4 relative" />
                                                : <ArrowRight className="w-4 h-4 relative transition-transform group-hover:translate-x-1" />}
                                        </>
                                    )}
                                </button>
                                <p className="text-center text-[11px] text-slate-500 dark:text-slate-400">
                                    We tailor your questions in a few seconds. Your answers stay private to you.
                                </p>
                            </div>
                            </motion.div>
                            </div>
                        </div>
                    </motion.div>
                </form>
            </main>

            <WalkthroughTour steps={TOUR_STEPS} open={tourOpen} onClose={closeTour} />
            <AssessmentLoadingOverlay open={isLoading} role={targetRole.trim()} hasResume={!!resumeFile} />
        </div>
    );
};

export default RoleReadySetup;
