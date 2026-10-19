import React, { useState, useEffect, useRef } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
    LayoutDashboard,
    FileText,
    User,
    LogOut,
    Compass,
    Target,
    Code2,
    Award,
    Sparkles,
    Menu,
    X,
    MessageSquare,
    FolderGit2,
    Building2,
    ChevronLeft,
    ChevronRight,
    Sun,
    Moon,
} from 'lucide-react';
import { useUser, useClerk } from '@clerk/clerk-react';
import studentApi from '../services/studentApi';
import CareerCopilotDrawer from '../components/student/CareerCopilotDrawer';
import { useTheme } from '../context/ThemeContext';
import useStudentTaskStatus, { clearStudentTaskCompleted, syncStudentSessionWithBackend } from '../hooks/useStudentTaskStatus';

// Navigation definition with unified emerald brand accents
export const navItems = [
    { label: 'Dashboard',            path: '/student/dashboard',  icon: LayoutDashboard, accent: '#10B981', glow: 'rgba(16,185,129,0.15)' },
    { label: 'Skill Gap',            path: '/student/skill-gap',  icon: Target,          accent: '#10B981', glow: 'rgba(16,185,129,0.15)' },
    { label: 'Roadmap',              path: '/student/roadmap',    icon: Compass,         accent: '#10B981', glow: 'rgba(16,185,129,0.15)' },
    { label: 'Practice',             path: '/student/practice',   icon: Code2,           accent: '#10B981', glow: 'rgba(16,185,129,0.15)' },
    { label: 'Mock Interview',       path: '/student/interview',  icon: MessageSquare,   accent: '#10B981', glow: 'rgba(16,185,129,0.15)' },
    { label: 'Placement Simulation', path: '/student/simulation', icon: Award,           accent: '#10B981', glow: 'rgba(16,185,129,0.15)' },
    { label: 'Campus Drives',        path: '/student/drives',     icon: Building2,       accent: '#10B981', glow: 'rgba(16,185,129,0.15)' },
    { label: 'Projects',             path: '/student/projects',   icon: FolderGit2,      accent: '#10B981', glow: 'rgba(16,185,129,0.15)' },
    { label: 'Resume',               path: '/student/resume',     icon: FileText,        accent: '#10B981', glow: 'rgba(16,185,129,0.15)' },
    { label: 'Profile',              path: '/student/profile',    icon: User,            accent: '#10B981', glow: 'rgba(16,185,129,0.15)' },
];

export const allNavItems = navItems;
export const primaryNavItems = navItems.slice(0, 5);
export const secondaryNavItems = navItems.slice(5);

/* ─── Sidebar NavItem ─────────────────────────────── */
const NavItem = ({ item, collapsed, onClick, index = 0, idPrefix = 'desk' }) => {
    const location = useLocation();
    const reduce = useReducedMotion();
    const active = location.pathname === item.path || (item.path === '/student/dashboard' && location.pathname === '/student');
    const Icon = item.icon;

    return (
        <motion.div
            initial={reduce ? false : { opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: reduce ? 0 : 0.04 * index, ease: [0.22, 1, 0.36, 1] }}
        >
        <Link
            to={item.path}
            onClick={onClick}
            title={collapsed ? item.label : undefined}
            className={`group relative flex items-center rounded-xl transition-colors duration-200 select-none min-h-[40px] ${
                collapsed
                    ? 'justify-center w-10 h-10 mx-auto my-0.5'
                    : 'gap-3 px-3.5 py-2.5 mx-2.5 mb-1'
            } ${
                active
                    ? 'text-emerald-800 dark:text-emerald-300 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100/90 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
        >
            {/* Sliding active indicator shared across items */}
            {active && (
                <motion.span
                    layoutId={`student-nav-active-${idPrefix}`}
                    transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
                    className="absolute inset-0 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200/80 dark:border-emerald-500/20 shadow-xs"
                >
                    {!collapsed && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-emerald-600 dark:bg-emerald-400" />}
                </motion.span>
            )}

            <Icon
                className={`relative w-[18px] h-[18px] shrink-0 transition-all duration-200 group-hover:scale-110 ${active ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500 group-hover:text-emerald-600 dark:group-hover:text-slate-300'}`}
            />

            {!collapsed && (
                <span className="relative text-[13px] font-medium truncate transition-transform duration-200 group-hover:translate-x-0.5">
                    {item.label}
                </span>
            )}

            {/* Collapsed tooltip */}
            {collapsed && (
                <div
                    className="absolute left-full ml-3 px-2.5 py-1.5 text-xs font-medium text-white bg-slate-900 dark:bg-slate-800 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity shadow-xl"
                >
                    {item.label}
                </div>
            )}
        </Link>
        </motion.div>
    );
};

/* ─── Main Layout ─────────────────────────────────── */
const StudentLayout = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { theme, toggleTheme } = useTheme();
    const { user, isLoaded: isClerkLoaded } = useUser();
    const clerk = useClerk();
    const [profile, setProfile] = useState(null);
    const [collapsed, setCollapsed] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const { hasCompletedTask, isLoading: isTaskStatusLoading } = useStudentTaskStatus(user);

    // Gating for new students: if assessment task is not completed, redirect from dashboard to assessment setup
    useEffect(() => {
        if (!isTaskStatusLoading && !hasCompletedTask && (location.pathname === '/student/dashboard' || location.pathname === '/student')) {
            navigate('/assessment/setup', { replace: true });
        }
    }, [isTaskStatusLoading, hasCompletedTask, location.pathname, navigate]);

    // Read the current path without making it an effect dependency: navigating between pages must
    // not re-sync the session and refetch the profile.
    const pathnameRef = useRef(location.pathname);
    pathnameRef.current = location.pathname;

    useEffect(() => {
        let isCancelled = false;

        const initAuth = async () => {
            // 1. Sync Clerk student session if user is logged in via Clerk
            if (user) {
                await syncStudentSessionWithBackend(user);
            }

            // 2. Validate token availability
            const token = localStorage.getItem('studentToken') || localStorage.getItem('token');
            if (!token && !user && isClerkLoaded && pathnameRef.current !== '/student/login') {
                navigate('/student/login');
                return;
            }

            if (pathnameRef.current !== '/student/login') {
                try {
                    const data = await studentApi.getProfile();
                    if (!isCancelled) {
                        setProfile(data);
                        setIsLoading(false);
                    }
                } catch {
                    if (!isCancelled) {
                        if (user) {
                            setProfile({
                                full_name: user.fullName || user.firstName || 'Student',
                                email: user.primaryEmailAddress?.emailAddress,
                                target_role: 'Full Stack Engineer'
                            });
                        }
                        setIsLoading(false);
                    }
                }
            } else {
                if (!isCancelled) setIsLoading(false);
            }
        };

        initAuth();

        return () => { isCancelled = true; };
    }, [user, isClerkLoaded, navigate]);

    // Close mobile drawer and start each page at the top on route change
    useEffect(() => {
        setMobileOpen(false);
        window.scrollTo({ top: 0, left: 0 });
    }, [location.pathname]);

    // Download the other student pages in the background so sidebar clicks open instantly
    useEffect(() => {
        const warm = () => {
            [
                () => import('../pages/student/StudentDashboard'),
                () => import('../pages/student/StudentSkillGap'),
                () => import('../pages/student/StudentRoadmap'),
                () => import('../pages/student/StudentPractice'),
                () => import('../pages/student/StudentMockInterview'),
                () => import('../pages/student/StudentPlacementSimulation'),
                () => import('../pages/student/StudentDrives'),
                () => import('../pages/student/StudentProjects'),
                () => import('../pages/student/StudentResumeUpload'),
                () => import('../pages/student/StudentProfile'),
            ].forEach(load => load().catch(() => {}));
        };
        if (typeof window.requestIdleCallback === 'function') {
            const id = window.requestIdleCallback(warm, { timeout: 4000 });
            return () => window.cancelIdleCallback(id);
        }
        const t = setTimeout(warm, 1500);
        return () => clearTimeout(t);
    }, []);

    // Login page renders without layout chrome
    if (location.pathname === '/student/login') return <Outlet />;

    const handleLogout = async () => {
        clearStudentTaskCompleted();
        if (studentApi && typeof studentApi.logout === 'function') {
            studentApi.logout();
        } else {
            localStorage.removeItem('studentToken');
            localStorage.removeItem('token');
            localStorage.removeItem('student_user_email');
            localStorage.removeItem('student_completed_assessment');
        }
        try {
            if (clerk && clerk.signOut) {
                await clerk.signOut();
            }
        } catch (e) {
            console.error("Clerk signout error:", e);
        }
        navigate('/?auth=student');
    };

    // Filter nav items: new students who haven't completed the task do not see the Dashboard link
    const effectiveNavItems = navItems.filter(item => {
        if (item.path === '/student/dashboard') {
            return hasCompletedTask;
        }
        return true;
    });

    const currentPage = effectiveNavItems.find(n => n.path === location.pathname);

    /* ─── Sidebar Inner Content ─── */
    const renderSidebar = (forMobile = false) => (
        <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-r border-slate-200/80 dark:border-slate-800">
            {/* Nav Items */}
            <nav className={`flex-1 py-3 overflow-y-auto student-scrollbar ${collapsed && !forMobile ? 'flex flex-col items-center' : ''}`}>
                {effectiveNavItems.map((item, i) => (
                    <NavItem
                        key={item.path}
                        item={item}
                        index={i}
                        idPrefix={forMobile ? 'mob' : 'desk'}
                        collapsed={collapsed && !forMobile}
                        onClick={forMobile ? () => setMobileOpen(false) : undefined}
                    />
                ))}
            </nav>

            {/* User card + Logout */}
            <div className="shrink-0 p-3 border-t border-slate-200/80 dark:border-slate-800">
                {profile && (!collapsed || forMobile) && (
                    <div
                        className="flex items-center gap-2.5 px-3 py-2 rounded-xl mb-2 transition-all hover:shadow-xs hover:border-emerald-200 dark:hover:border-emerald-500/30 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60"
                    >
                        <div
                            className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0 bg-gradient-to-tr from-emerald-600 to-teal-500 shadow-xs"
                        >
                            {profile.full_name?.charAt(0)?.toUpperCase() || 'S'}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-[12px] font-semibold text-slate-800 dark:text-slate-200 truncate">{profile.full_name || 'Student'}</div>
                            <div className="text-[10px] text-emerald-600 dark:text-emerald-400 truncate">
                                {profile.target_role || 'Set target role →'}
                            </div>
                        </div>
                    </div>
                )}
                {collapsed && !forMobile && profile && (
                    <div
                        title={profile.full_name || 'Student'}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white mx-auto mb-2 cursor-pointer bg-gradient-to-tr from-emerald-600 to-teal-500"
                    >
                        {profile.full_name?.charAt(0)?.toUpperCase() || 'S'}
                    </div>
                )}
                <button
                    onClick={handleLogout}
                    title="Sign Out"
                    className={`transition-all rounded-xl text-[12px] font-semibold flex items-center gap-2 text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 cursor-pointer ${
                        collapsed && !forMobile
                            ? 'w-10 h-10 justify-center mx-auto'
                            : 'w-full px-3 py-2'
                    }`}
                >
                    <LogOut className="w-4 h-4 shrink-0" />
                    {(!collapsed || forMobile) && <span>Sign Out</span>}
                </button>
            </div>
        </div>
    );

    const SIDEBAR_W = collapsed ? 72 : 252;

    return (
        <div
            className="min-h-screen flex flex-col font-sans bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            style={{ fontFamily: "'Inter', 'Plus Jakarta Sans', system-ui, sans-serif" }}
        >
            {/* ─── Top Bar (Global across full width) ─── */}
            <header
                className="sticky top-0 z-30 flex items-center justify-between h-16 px-4 sm:px-6 shrink-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800"
            >
                {/* Left: Hamburger (mobile) + Brand Logo & Title + Breadcrumb */}
                <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                    <button
                        onClick={() => setMobileOpen(true)}
                        className="lg:hidden p-2.5 -ml-2 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors rounded-lg cursor-pointer shrink-0"
                        aria-label="Open navigation menu"
                    >
                        <Menu className="w-5 h-5" />
                    </button>

                    {/* Brand Lockup: ALWAYS VISIBLE in both expanded & collapsed states */}
                    <Link
                        to="/"
                        className="flex items-center gap-2.5 group focus:outline-none shrink-0"
                        title="PrepWin Home"
                    >
                        <img
                            src="/logo_main.png"
                            alt="ThirdEye Data"
                            className="h-7 w-auto object-contain shrink-0 transition-transform group-hover:scale-[1.02]"
                        />
                        <div className="w-px h-5 bg-slate-200 dark:bg-slate-800 shrink-0" />
                        <div className="leading-none shrink-0">
                            <div className="text-sm font-bold text-slate-900 dark:text-white tracking-tight group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                                PrepWin
                            </div>
                            <div className="text-[10px] font-semibold uppercase tracking-wider mt-1 text-emerald-600 dark:text-emerald-400">
                                Student Career Hub
                            </div>
                        </div>
                    </Link>

                    {/* Desktop breadcrumb with divider */}
                    <div className="w-px h-5 bg-slate-200 dark:bg-slate-800 shrink-0 hidden md:block" />
                    <nav className="hidden md:flex items-center gap-2 text-xs min-w-0 truncate">
                        <span className="text-slate-400 dark:text-slate-500 font-medium shrink-0">Student Hub</span>
                        {currentPage && (
                            <>
                                <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                <span key={currentPage.path} className="font-semibold text-emerald-700 dark:text-emerald-400 truncate animate-in fade-in slide-in-from-left-2 duration-300">
                                    {currentPage.label}
                                </span>
                            </>
                        )}
                    </nav>
                </div>

                {/* Right: Take Assessment CTA, theme toggle & user pill */}
                <div className="flex items-center gap-2.5 shrink-0">
                    <Link
                        to="/assessment/setup"
                        id="student-topbar-assessment-btn"
                        className="group relative overflow-hidden h-10 sm:h-9 min-w-[40px] justify-center inline-flex items-center gap-1.5 px-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 active:scale-95 text-white text-xs font-semibold transition-all shadow-xs hover:shadow-md hover:shadow-emerald-500/25 cursor-pointer shrink-0"
                        title="Start AI Role Assessment"
                    >
                        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 -left-full w-1/2 -skew-x-12 bg-white/25 transition-transform duration-700 ease-out group-hover:translate-x-[400%] motion-reduce:hidden" />
                        <Sparkles className="relative w-3.5 h-3.5 transition-transform duration-300 group-hover:rotate-12 group-hover:scale-110" />
                        <span className="relative hidden sm:inline">Take Assessment</span>
                    </Link>

                    <button
                        type="button"
                        onClick={toggleTheme}
                        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                        className="w-10 h-10 sm:w-9 sm:h-9 flex items-center justify-center rounded-xl transition-all active:scale-95 hover:rotate-12 motion-reduce:hover:rotate-0 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-700 cursor-pointer shrink-0"
                        title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                    >
                        {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
                    </button>
                    {profile && (
                        <Link
                            to="/student/profile"
                            className="h-9 hidden sm:inline-flex items-center gap-2 rounded-full px-3 transition-all bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-200/70 dark:hover:bg-slate-700 hover:-translate-y-px hover:shadow-xs cursor-pointer text-xs shrink-0"
                        >
                            <div
                                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 bg-gradient-to-tr from-emerald-600 to-teal-500 shadow-xs"
                            >
                                {profile.full_name?.charAt(0)?.toUpperCase() || 'S'}
                            </div>
                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 leading-none max-w-[120px] truncate">
                                {profile.full_name || 'Student'}
                            </span>
                        </Link>
                    )}
                </div>
            </header>

            {/* ─── Body: Sidebar + Main Content ─── */}
            <div className="flex-1 flex relative">
                {/* ─── Desktop Sidebar (Below header) ─── */}
                <aside
                    className="hidden lg:flex flex-col fixed left-0 top-16 bottom-0 z-20 transition-all duration-300 ease-in-out"
                    style={{ width: SIDEBAR_W }}
                >
                    <div className="flex flex-col h-full overflow-x-hidden">
                        {renderSidebar()}
                    </div>

                    {/* Collapse toggle button: centered on sidebar boundary, overflow-visible */}
                    <button
                        onClick={() => setCollapsed(c => !c)}
                        className="absolute -right-3 top-3 z-30 w-6 h-6 rounded-full flex items-center justify-center transition-all shadow-xs hover:shadow-sm hover:scale-105 active:scale-95 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-emerald-300 dark:hover:border-emerald-500/40 text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 cursor-pointer"
                        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    >
                        {collapsed
                            ? <ChevronRight className="w-3.5 h-3.5" />
                            : <ChevronLeft className="w-3.5 h-3.5" />
                        }
                    </button>
                </aside>

                {/* ─── Mobile Overlay Drawer ─── */}
                {mobileOpen && (
                    <div className="lg:hidden fixed inset-0 z-50 flex">
                        {/* Backdrop */}
                        <div
                            className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs"
                            onClick={() => setMobileOpen(false)}
                        />
                        {/* Drawer */}
                        <aside
                            className="relative z-10 w-64 flex flex-col shadow-2xl animate-in slide-in-from-left duration-200 bg-white dark:bg-slate-900"
                        >
                            {/* Mobile Drawer Header */}
                            <div className="flex items-center justify-between h-16 border-b border-slate-200/80 dark:border-slate-800 px-4 shrink-0">
                                <Link to="/" className="flex items-center gap-2 focus:outline-none" onClick={() => setMobileOpen(false)}>
                                    <img src="/logo_main.png" alt="ThirdEye Data" className="h-6 w-auto object-contain shrink-0" />
                                    <div className="leading-none">
                                        <span className="text-sm font-bold text-slate-900 dark:text-white tracking-tight">PrepWin</span>
                                    </div>
                                </Link>
                                <button
                                    onClick={() => setMobileOpen(false)}
                                    className="p-2.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors rounded-lg cursor-pointer"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="flex-1 flex flex-col overflow-y-auto">
                                {renderSidebar(true)}
                            </div>
                        </aside>
                    </div>
                )}

                {/* ─── Main Column ─── */}
                <div
                    className={`flex flex-col flex-1 min-h-[calc(100vh-4rem)] transition-all duration-300 ease-in-out ${collapsed ? 'lg:ml-[72px]' : 'lg:ml-[252px]'}`}
                >
                    {/* Page Content */}
                    <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 pb-28 sm:pb-24">
                        <div className="max-w-7xl mx-auto w-full">
                            <Outlet />
                        </div>
                    </main>

                    {/* Career Copilot Interactive Drawer */}
                    <CareerCopilotDrawer />

                    {/* Minimal Footer with bottom padding clearance on mobile */}
                    <footer
                        className="shrink-0 py-4 px-6 text-center text-xs text-slate-400 border-t border-slate-200/80 dark:border-slate-800 pb-16 sm:pb-4"
                    >
                        © 2026 ThirdEye Data — PrepWin Student Career &amp; Placement Platform
                    </footer>
                </div>
            </div>
        </div>
    );
};

export default StudentLayout;
