import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
    Lock,
    Mail,
    User,
    ArrowRight,
    AlertTriangle,
    Sparkles,
    ShieldCheck,
    Building2,
    Target,
    Award,
    Bot,
    ChevronRight,
    Zap,
} from 'lucide-react';
import studentApi from '../../services/studentApi';
import { isStudentTaskCompletedSync, markStudentTaskCompleted } from '../../hooks/useStudentTaskStatus';

const StudentLogin = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const redirectParam = searchParams.get('redirect');

    const resolvePostLoginDestination = async () => {
        if (redirectParam && redirectParam.startsWith('/') && !redirectParam.startsWith('//')) {
            return redirectParam;
        }
        try {
            const hist = await studentApi.getAssessmentHistory();
            if (Number(hist?.total_completed || 0) > 0) {
                markStudentTaskCompleted();
                return '/student/dashboard';
            } else {
                localStorage.setItem('student_completed_assessment', 'false');
                return '/assessment/setup';
            }
        } catch {
            return isStudentTaskCompletedSync() ? '/student/dashboard' : '/assessment/setup';
        }
    };

    const [isRegistering, setIsRegistering] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [fullName, setFullName] = useState('');
    const [inviteCode, setInviteCode] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        try {
            if (isRegistering) {
                await studentApi.register(email, password, fullName, inviteCode.trim() || null);
            } else {
                await studentApi.login(email, password);
            }
            const dest = await resolvePostLoginDestination();
            navigate(dest);
        } catch (err) {
            console.error('Authentication error:', err);
            setError(err.response?.data?.detail || 'Authentication failed. Please check your credentials.');
        } finally {
            setIsLoading(false);
        }
    };

    // Quick demo student login for evaluation
    const handleDemoStudentLogin = async () => {
        setError(null);
        setIsLoading(true);
        const demoEmail = 'student.demo@hiringai.test';
        const demoPass = 'StudentDemoPass123!';

        try {
            // Attempt login first
            try {
                await studentApi.login(demoEmail, demoPass);
                const dest = await resolvePostLoginDestination();
                navigate(dest);
                return;
            } catch {
                // If account does not exist, auto-register with valid org code
                await studentApi.register(demoEmail, demoPass, 'Alex Kumar (Demo Student)', 'college-alpha');
                const dest = await resolvePostLoginDestination();
                navigate(dest);
            }
        } catch (err) {
            console.error('Demo login failed:', err);
            setError('Could not initialize demo student account. Please try manual login.');
        } finally {
            setIsLoading(false);
        }
    };

    const highlights = [
        {
            icon: Target,
            title: 'Precision Readiness Scoring',
            desc: 'Multi-factor ATS, skill coverage & mock interview analytics benchmarked to your dream role.',
            color: '#10B981'
        },
        {
            icon: Award,
            title: '4-Round Campus Simulation',
            desc: 'Full-funnel practice: OA Aptitude, Live Coding, Technical Panel, and HR interviews.',
            color: '#F59E0B'
        },
        {
            icon: Bot,
            title: '24/7 AI Career Copilot',
            desc: 'Instant resume critiques, system architecture breakdowns, and step-by-step guidance.',
            color: '#3B82F6'
        }
    ];

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white flex flex-col lg:flex-row relative overflow-hidden font-sans selection:bg-emerald-100 selection:text-emerald-900">
            {/* Ambient Background Glows */}
            <div className="absolute top-[-150px] left-[-150px] w-[300px] h-[300px] sm:w-[500px] sm:h-[500px] bg-emerald-100/60 dark:bg-emerald-600/10 rounded-full blur-[140px] pointer-events-none" />
            <div className="absolute bottom-[-150px] right-[-150px] w-[300px] h-[300px] sm:w-[500px] sm:h-[500px] bg-blue-100/50 dark:bg-blue-600/10 rounded-full blur-[140px] pointer-events-none" />

            {/* Left Column: Visual Showcase & Brand Narrative */}
            <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 xl:p-16 relative z-10 border-r border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/40 backdrop-blur-md">
                <div>
                    {/* Brand Header */}
                    <Link to="/" className="inline-flex items-center gap-3.5 group">
                        <img
                            src="/logo_main.png"
                            alt="ThirdEye Data"
                            className="h-10 w-auto object-contain transition-transform group-hover:scale-105"
                        />
                        <div className="w-px h-7 bg-slate-200 dark:bg-slate-700" />
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">PrepWin</span>
                                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/30">
                                    Student Portal
                                </span>
                            </div>
                            <span className="text-xs text-slate-500 dark:text-slate-400 block -mt-0.5 font-normal">ThirdEye Data Job Readiness Platform</span>
                        </div>
                    </Link>

                    {/* Hero Title & Pitch */}
                    <div className="mt-14 max-w-lg">
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-300 text-xs font-semibold mb-5 shadow-xs">
                            <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            <span>Empowering Next-Gen Campus Placement Preparation</span>
                        </div>
                        <h1 className="text-4xl xl:text-5xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-[1.15]">
                            Accelerate your journey to your <span className="text-emerald-700 dark:text-emerald-400">dream company</span>.
                        </h1>
                        <p className="mt-4 text-slate-600 dark:text-slate-300 text-sm leading-relaxed font-normal">
                            A unified, AI-driven placement operating system designed to analyze your resume, measure real-world readiness, simulate high-stakes hiring drives, and coach you at every stage.
                        </p>
                    </div>

                    {/* Feature Highlights Grid */}
                    <div className="mt-10 space-y-3.5 max-w-lg">
                        {highlights.map((h, i) => {
                            const Icon = h.icon;
                            return (
                                <div 
                                    key={i} 
                                    className="p-4 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 hover:border-emerald-300 dark:hover:border-emerald-500/40 hover:shadow-sm transition-all duration-200 flex items-start gap-4"
                                >
                                    <div 
                                        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border"
                                        style={{ 
                                            background: `${h.color}10`, 
                                            borderColor: `${h.color}30`,
                                            color: h.color 
                                        }}
                                    >
                                        <Icon className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white tracking-wide">{h.title}</h3>
                                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">{h.desc}</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Bottom Trust Badge */}
                <div className="pt-8 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        <span>Institutional Campus Edition • Verified Assessment Standards</span>
                    </div>
                    <span className="text-slate-400">v2.4 LTS</span>
                </div>
            </div>

            {/* Right Column: Authentication Card */}
            <div className="flex-1 flex flex-col justify-center items-center p-6 sm:p-12 lg:p-16 relative z-10">
                {/* Mobile Header */}
                <div className="lg:hidden text-center mb-8">
                    <Link to="/" className="inline-flex items-center gap-3 mb-4">
                        <img
                            src="/logo_main.png"
                            alt="ThirdEye Data"
                            className="h-9 w-auto object-contain"
                        />
                        <div className="text-left">
                            <span className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">PrepWin</span>
                            <span className="text-[10px] block text-emerald-600 dark:text-emerald-400 font-semibold tracking-wider uppercase">Student Portal</span>
                        </div>
                    </Link>
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                        {isRegistering ? 'Create Your Student Profile' : 'Welcome Back'}
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                        {isRegistering ? 'Start tracking your placement readiness index today' : 'Sign in to access your placement dashboard'}
                    </p>
                </div>

                {/* Main Auth Form Container */}
                <div className="w-full max-w-md">
                    {/* Mode Toggle Switch */}
                    <div className="p-1 bg-slate-200/80 dark:bg-slate-800 rounded-2xl flex items-center mb-6 shadow-inner">
                        <button
                            type="button"
                            onClick={() => { setIsRegistering(false); setError(null); }}
                            className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all duration-200 cursor-pointer ${
                                !isRegistering 
                                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm' 
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            Sign In
                        </button>
                        <button
                            type="button"
                            onClick={() => { setIsRegistering(true); setError(null); }}
                            className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all duration-200 cursor-pointer ${
                                isRegistering 
                                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm' 
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            Create Account
                        </button>
                    </div>

                    {/* Card */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-5 sm:p-8 shadow-xl relative overflow-hidden">
                        {/* Subtle Card Top Accent Glow */}
                        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-500 to-transparent" />

                        <div className="mb-6">
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                                {isRegistering ? 'Create Student Account' : 'Student Career Sign In'}
                            </h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                {isRegistering
                                    ? 'Join your college campus drive cohort and explore readiness analytics.'
                                    : 'Enter your verified student credentials to continue.'}
                            </p>
                        </div>

                        {error && (
                            <div className="mb-6 p-3.5 bg-rose-50 border border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/30 rounded-2xl text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2.5 animate-in fade-in duration-200">
                                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
                                <span className="leading-relaxed">{error}</span>
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-4">
                            {isRegistering && (
                                <div>
                                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                                        Full Name
                                    </label>
                                    <div className="relative">
                                        <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                                        <input
                                            type="text"
                                            required
                                            value={fullName}
                                            onChange={(e) => setFullName(e.target.value)}
                                            placeholder="Alex Kumar"
                                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                                        />
                                    </div>
                                </div>
                            )}

                            <div>
                                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                                    Student Email
                                </label>
                                <div className="relative">
                                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                                    <input
                                        type="email"
                                        required
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="student@college.edu"
                                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                                    />
                                </div>
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                        Password
                                    </label>
                                    {!isRegistering && (
                                        <span className="text-[11px] text-slate-500 hover:text-emerald-700 dark:text-slate-400 dark:hover:text-emerald-400 transition-colors cursor-pointer">
                                            Forgot password?
                                        </span>
                                    )}
                                </div>
                                <div className="relative">
                                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                                    <input
                                        type="password"
                                        required
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="••••••••••••"
                                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                                    />
                                </div>
                            </div>

                            {isRegistering && (
                                <div>
                                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                                        College Invite Code <span className="text-slate-400 font-normal lowercase">(optional)</span>
                                    </label>
                                    <div className="relative">
                                        <Building2 className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                                        <input
                                            type="text"
                                            value={inviteCode}
                                            onChange={(e) => setInviteCode(e.target.value)}
                                            placeholder="e.g. college-alpha"
                                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                                        />
                                    </div>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full mt-2 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-md shadow-emerald-600/20 hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isLoading ? (
                                    <span className="flex items-center gap-2">
                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        <span>Authenticating...</span>
                                    </span>
                                ) : (
                                    <>
                                        <span>{isRegistering ? 'Create Student Account' : 'Sign In to Dashboard'}</span>
                                        <ArrowRight className="w-4 h-4" />
                                    </>
                                )}
                            </button>
                        </form>

                        {/* Divider */}
                        <div className="relative my-6">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-slate-200 dark:border-slate-700" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-white dark:bg-slate-900 px-3 text-slate-400 font-medium tracking-wider">
                                    Instant Evaluation Access
                                </span>
                            </div>
                        </div>

                        {/* One-Click Demo Button */}
                        <button
                            type="button"
                            onClick={handleDemoStudentLogin}
                            disabled={isLoading}
                            className="w-full py-2.5 px-4 rounded-xl bg-emerald-50 hover:bg-emerald-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 font-semibold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs group"
                        >
                            <Zap className="w-4 h-4 text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform" />
                            <span>Instant Demo Student Access (Alex Kumar)</span>
                        </button>

                        {/* Portal Switcher */}
                        <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800 text-center">
                            <Link 
                                to="/login" 
                                className="text-xs text-slate-500 hover:text-emerald-700 dark:text-slate-400 dark:hover:text-emerald-400 inline-flex items-center gap-1 transition-colors font-medium"
                            >
                                <span>Recruiter or Admin? Go to Enterprise Portal</span>
                                <ChevronRight className="w-3.5 h-3.5" />
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default StudentLogin;
