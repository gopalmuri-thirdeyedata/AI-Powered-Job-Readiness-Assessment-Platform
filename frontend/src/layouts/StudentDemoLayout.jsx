import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Info, Moon, Sun } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { AssessmentLockContext } from '../context/AssessmentLockContext';
import { demoPathFor } from '../utils/studentDemo';
import { DEMO_STUDENT } from '../services/studentDemoData';
import { navItems } from './StudentLayout';
import CareerCopilotDrawer from '../components/student/CareerCopilotDrawer';

// The same pages, labels and icons as the real student sidebar, pointed at the demo routes.
const DEMO_NAV = navItems.map(({ label, path, icon }) => ({
    label, icon, path: demoPathFor(path), end: path === '/student/dashboard',
}));

const navClass = (isActive) => `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13px] font-medium transition-colors min-h-[40px] ${
    isActive
        ? 'bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200/80 dark:border-emerald-500/20 text-emerald-800 dark:text-emerald-300 font-semibold'
        : 'border border-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100/90 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-200'
}`;

/**
 * Student Dashboard Demo shell: the student workspace look (header, navigation, theme) around the real student pages, which run
 * on sample data. It needs no student session and nothing it shows is saved or sent anywhere; the admin session that opens it
 * is checked by AdminGuard in the route. Links and buttons that would leave the demo explain that instead of navigating.
 */
const StudentDemoLayout = () => {
    const { theme, toggleTheme } = useTheme();
    const location = useLocation();
    const navigate = useNavigate();
    const [notice, setNotice] = useState(null);
    const noticeTimer = useRef(null);

    const showNotice = useCallback((message) => {
        setNotice(message);
        clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => setNotice(null), 4500);
    }, []);
    useEffect(() => () => clearTimeout(noticeTimer.current), []);
    useEffect(() => { window.scrollTo({ top: 0, left: 0 }); }, [location.pathname]);

    // "Take assessment" buttons on the student pages: nothing to start in a demo.
    const lock = useMemo(() => ({
        promptContactAdmin: () => showNotice('Assessments are not available in the demo.'),
        startAssessment: () => showNotice('Starting an assessment is not available in the demo.'),
        assessmentLocked: false,
        refreshAccess: async () => false,
    }), [showNotice]);

    // The student pages link to the real routes (/student/...). Inside the demo those go to the matching demo page, or explain.
    const onClickCapture = (e) => {
        const anchor = e.target instanceof Element ? e.target.closest('a[href]') : null;
        if (!anchor) return;
        const href = anchor.getAttribute('href') || '';
        if (!/^\/(student|assessment|portal)(\/|\?|#|$)/.test(href)) return;
        e.preventDefault();
        e.stopPropagation();
        const demoPath = demoPathFor(href);
        if (demoPath) navigate(demoPath);
        else showNotice('That page is not part of the demo.');
    };

    return (
        <AssessmentLockContext.Provider value={lock}>
            <div
                className="min-h-screen flex flex-col font-sans bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                style={{ fontFamily: "'Inter', 'Plus Jakarta Sans', system-ui, sans-serif" }}
                onClickCapture={onClickCapture}
            >
                <header className="sticky top-0 z-30 flex items-center justify-between gap-3 h-16 px-4 sm:px-6 shrink-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800">
                    <div className="flex items-center gap-3 min-w-0">
                        <img src="/logo_main.png" alt="ThirdEye Data" className="h-7 w-auto object-contain shrink-0" />
                        <div className="w-px h-5 bg-slate-200 dark:bg-slate-800 shrink-0" />
                        <div className="leading-none min-w-0">
                            <div className="text-sm font-bold text-slate-900 dark:text-white tracking-tight">PrepWin</div>
                            <div className="text-[10px] font-semibold uppercase tracking-wider mt-1 text-emerald-600 dark:text-emerald-400 truncate">Student Career Hub</div>
                        </div>
                        <span className="hidden sm:inline-flex px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30">
                            Demo
                        </span>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                        <button
                            type="button"
                            onClick={toggleTheme}
                            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                            className="w-10 h-10 sm:w-9 sm:h-9 flex items-center justify-center rounded-xl transition-all active:scale-95 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                            {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
                        </button>
                        <Link
                            to="/admin/dashboard"
                            className="h-10 sm:h-9 inline-flex items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold text-white bg-[#5d8c2c] hover:bg-[#4c7324] transition-colors"
                        >
                            <ArrowLeft className="w-3.5 h-3.5" />
                            <span>Exit demo</span>
                        </Link>
                    </div>
                </header>

                <div className="flex-1 flex relative">
                    <aside className="hidden lg:flex flex-col fixed left-0 top-16 bottom-0 z-20 w-[252px] bg-white dark:bg-slate-900 border-r border-slate-200/80 dark:border-slate-800">
                        <nav className="flex-1 min-h-0 py-3 px-2.5 space-y-1 overflow-y-auto overflow-x-hidden overscroll-contain student-nav-scroll" aria-label="Student demo sections">
                            {DEMO_NAV.map(({ label, path, icon: Icon, end }) => (
                                <NavLink key={path} to={path} end={end} className={({ isActive }) => navClass(isActive)}>
                                    <Icon className="w-[18px] h-[18px] shrink-0" />
                                    <span className="truncate">{label}</span>
                                </NavLink>
                            ))}
                        </nav>
                        <div className="shrink-0 p-3 border-t border-slate-200/80 dark:border-slate-800">
                            <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60">
                                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0 bg-gradient-to-tr from-emerald-600 to-teal-500">
                                    {DEMO_STUDENT.full_name.charAt(0)}
                                </div>
                                <div className="min-w-0">
                                    <div className="text-[12px] font-semibold text-slate-800 dark:text-slate-200 truncate">{DEMO_STUDENT.full_name}</div>
                                    <div className="text-[10px] text-slate-400">Sample student</div>
                                </div>
                            </div>
                        </div>
                    </aside>

                    <div className="flex flex-col flex-1 min-w-0 min-h-[calc(100vh-4rem)] lg:ml-[252px]">
                        {/* Phone / tablet navigation */}
                        <nav className="lg:hidden flex gap-2 overflow-x-auto px-4 sm:px-6 pt-3" aria-label="Student demo sections">
                            {DEMO_NAV.map(({ label, path, icon: Icon, end }) => (
                                <NavLink key={path} to={path} end={end} className={({ isActive }) => `${navClass(isActive)} whitespace-nowrap shrink-0`}>
                                    <Icon className="w-4 h-4 shrink-0" />
                                    <span>{label}</span>
                                </NavLink>
                            ))}
                        </nav>

                        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 pb-24">
                            <div className="max-w-7xl mx-auto w-full space-y-6">
                                <div
                                    role="note"
                                    className="flex items-start gap-2.5 rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-xs sm:text-[13px] text-amber-900 dark:text-amber-200"
                                >
                                    <Info className="w-4 h-4 shrink-0 mt-0.5" />
                                    <p className="leading-relaxed">
                                        <strong>Student dashboard demo.</strong> This is how the student side looks, filled with sample data. Nothing is saved and no
                                        AI or API calls are made. Every page is filled in and works, so you can try every control.  Starting a real assessment is not part of the demo.
                                    </p>
                                </div>
                                <Outlet />
                            </div>
                        </main>
                    </div>
                </div>

                <CareerCopilotDrawer />

                {notice && (
                    <div
                        role="status"
                        aria-live="polite"
                        className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 max-w-[92vw] rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-4 py-2.5 text-xs font-medium shadow-xl"
                    >
                        {notice}
                    </div>
                )}
            </div>
        </AssessmentLockContext.Provider>
    );
};

export default StudentDemoLayout;
