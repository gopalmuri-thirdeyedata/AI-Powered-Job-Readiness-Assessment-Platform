import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
    LayoutDashboard,
    ClipboardList,
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
    TrendingUp
} from 'lucide-react';
import { useUser, useClerk } from '@clerk/clerk-react';
import studentApi from '../services/studentApi';
import CareerCopilotDrawer from '../components/student/CareerCopilotDrawer';
import { useTheme } from '../context/ThemeContext';
import API_URL from '../apiConfig';

// Navigation definition with unified emerald brand accents
export const navItems = [
    { label: 'Dashboard',            path: '/student/dashboard',  icon: LayoutDashboard, accent: '#10B981', glow: 'rgba(16,185,129,0.15)' },
    { label: 'Role Assessment',      path: '/assessment/setup',   icon: Sparkles,        accent: '#10B981', glow: 'rgba(16,185,129,0.15)' },
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
const NavItem = ({ item, collapsed, onClick }) => {
    const location = useLocation();
    const active = location.pathname === item.path || (item.path === '/student/dashboard' && location.pathname === '/student');
    const Icon = item.icon;

    return (
        <Link
            to={item.path}
            onClick={onClick}
            title={collapsed ? item.label : undefined}
            className={`group relative flex items-center rounded-xl transition-all duration-200 select-none ${
                collapsed
                    ? 'justify-center w-10 h-10 mx-auto my-0.5'
                    : 'gap-3 px-3.5 py-2.5 mx-2.5 mb-1'
            } ${
                active
                    ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 font-semibold shadow-xs border border-emerald-200/80 dark:border-emerald-500/20'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100/90 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-200 border border-transparent'
            }`}
        >
            {/* Active left bar indicator */}
            {active && (
                <div
                    className="absolute left-0 w-1 h-5 rounded-r-full bg-emerald-600 dark:bg-emerald-400"
                />
            )}

            <Icon
                className={`w-[18px] h-[18px] shrink-0 transition-colors ${active ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300'}`}
            />

            {!collapsed && (
                <span className="text-[13px] font-medium truncate">
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

    useEffect(() => {
        let isCancelled = false;

        const initAuth = async () => {
            // 1. Sync Clerk student session if user is logged in via Clerk
            if (user) {
                try {
                    const email = user.primaryEmailAddress?.emailAddress;
                    if (email) {
                        const response = await fetch(`${API_URL}/api/auth/clerk-sync/`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                email,
                                clerk_user_id: user.id,
                                role_intent: 'student'
                            })
                        });
                        if (response.ok) {
                            const data = await response.json();
                            if (data.access) {
                                localStorage.setItem('token', data.access);
                                localStorage.setItem('studentToken', data.access);
                            }
                        }
                    }
                } catch (e) {
                    console.warn("Clerk student sync caught:", e);
                }
            }

            // 2. Validate token availability
            const token = localStorage.getItem('studentToken') || localStorage.getItem('token');
            if (!token && !user && isClerkLoaded && location.pathname !== '/student/login') {
                navigate('/student/login');
                return;
            }

            if (location.pathname !== '/student/login') {
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
    }, [user, isClerkLoaded, location.pathname, navigate]);

    // Close mobile drawer on route change
    useEffect(() => { setMobileOpen(false); }, [location.pathname]);

    // Login page renders without layout chrome
    if (location.pathname === '/student/login') return <Outlet />;

    const handleLogout = async () => {
        studentApi.logout();
        try {
            if (clerk && clerk.signOut) {
                await clerk.signOut();
            }
        } catch (e) {
            console.error("Clerk signout error:", e);
        }
        navigate('/student/login');
    };

    const currentPage = allNavItems.find(n => n.path === location.pathname);

    /* ─── Sidebar Inner Content ─── */
    const SidebarInner = ({ forMobile = false }) => (
        <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-r border-slate-200/80 dark:border-slate-800">
            {/* Brand */}
            <div
                className={`flex items-center h-16 border-b border-slate-200/80 dark:border-slate-800 px-3 shrink-0 ${forMobile ? 'gap-3 px-4' : collapsed ? 'justify-center' : 'gap-3 px-4'}`}
            >
                <Link to="/" className="flex items-center gap-2.5 group focus:outline-none shrink-0" title="PrepWin Home">
                    <img
                        src="/logo_main.png"
                        alt="ThirdEye Data"
                        className={`${collapsed && !forMobile ? 'h-7 w-auto' : 'h-7 w-auto'} object-contain shrink-0 transition-transform group-hover:scale-[1.02]`}
                    />
                    {(!collapsed || forMobile) && (
                        <>
                            <div className="w-px h-5 bg-slate-200 dark:bg-slate-800 shrink-0" />
                            <div className="leading-none">
                                <div className="text-sm font-bold text-slate-900 dark:text-white tracking-tight group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                                    PrepWin
                                </div>
                                <div className="text-[10px] font-semibold uppercase tracking-wider mt-1 text-emerald-600 dark:text-emerald-400">
                                    Student Career Hub
                                </div>
                            </div>
                        </>
                    )}
                </Link>
                {forMobile && (
                    <button
                        onClick={() => setMobileOpen(false)}
                        className="ml-auto p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors rounded-lg cursor-pointer"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>

            {/* Nav Items */}
            <nav className={`flex-1 py-3 overflow-y-auto student-scrollbar ${collapsed && !forMobile ? 'flex flex-col items-center' : ''}`}>
                {navItems.map(item => (
                    <NavItem
                        key={item.path}
                        item={item}
                        collapsed={collapsed && !forMobile}
                        onClick={forMobile ? () => setMobileOpen(false) : undefined}
                    />
                ))}
            </nav>

            {/* User card + Logout */}
            <div className="shrink-0 p-3 border-t border-slate-200/80 dark:border-slate-800">
                {profile && (!collapsed || forMobile) && (
                    <div
                        className="flex items-center gap-2.5 px-3 py-2 rounded-xl mb-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60"
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
            className="min-h-screen flex font-sans bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
            style={{ fontFamily: "'Inter', 'Plus Jakarta Sans', system-ui, sans-serif" }}
        >
            {/* ─── Desktop Sidebar ─── */}
            <aside
                className="hidden lg:flex flex-col fixed left-0 top-0 bottom-0 z-30 transition-all duration-300 ease-in-out"
                style={{ width: SIDEBAR_W }}
            >
                <SidebarInner />

                {/* Collapse toggle button */}
                <button
                    onClick={() => setCollapsed(c => !c)}
                    className="absolute -right-3 top-[68px] w-6 h-6 rounded-full flex items-center justify-center transition-all shadow-md hover:scale-110 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                    title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
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
                        className="relative z-10 w-64 flex flex-col shadow-2xl animate-in slide-in-from-left duration-200"
                    >
                        <SidebarInner forMobile />
                    </aside>
                </div>
            )}

            {/* ─── Main Column ─── */}
            <div
                className={`flex flex-col flex-1 min-h-screen transition-all duration-300 ease-in-out ${collapsed ? 'lg:ml-[72px]' : 'lg:ml-[252px]'}`}
            >
                {/* Top Bar */}
                <header
                    className="sticky top-0 z-20 flex items-center justify-between h-16 px-4 sm:px-6 shrink-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800"
                >
                    {/* Left: hamburger (mobile) + breadcrumb (desktop) */}
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setMobileOpen(true)}
                            className="lg:hidden p-1.5 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors rounded-lg"
                        >
                            <Menu className="w-5 h-5" />
                        </button>

                        {/* Desktop breadcrumb */}
                        <nav className="hidden lg:flex items-center gap-2 text-xs">
                            <span className="text-slate-400 dark:text-slate-500 font-medium">Student Hub</span>
                            {currentPage && (
                                <>
                                    <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                        {currentPage.label}
                                    </span>
                                </>
                            )}
                        </nav>
                    </div>

                    {/* Right: Take Assessment CTA, theme toggle & user pill */}
                    <div className="flex items-center gap-2.5">
                        <Link
                            to="/assessment/setup"
                            id="student-topbar-assessment-btn"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-semibold transition-all shadow-xs cursor-pointer"
                            title="Start AI Role Assessment"
                        >
                            <Sparkles className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Take Assessment</span>
                        </Link>

                        <button
                            type="button"
                            onClick={toggleTheme}
                            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                            className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-700 cursor-pointer"
                        >
                            {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
                        </button>
                        {profile && (
                            <Link
                                to="/student/profile"
                                className="hidden sm:flex items-center gap-2 rounded-full px-3 py-1.5 transition-all bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-200/70 dark:hover:bg-slate-700 cursor-pointer text-xs"
                            >
                                <div
                                    className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 bg-gradient-to-tr from-emerald-600 to-teal-500 shadow-xs"
                                >
                                    {profile.full_name?.charAt(0)?.toUpperCase() || 'S'}
                                </div>
                                <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 leading-none">
                                    {profile.full_name || 'Student'}
                                </span>
                            </Link>
                        )}
                    </div>
                </header>

                {/* Page Content */}
                <main className="flex-1 px-4 sm:px-6 py-6">
                    <div className="max-w-7xl mx-auto w-full">
                        <Outlet />
                    </div>
                </main>

                {/* Career Copilot Interactive Drawer */}
                <CareerCopilotDrawer />

                {/* Minimal Footer */}
                <footer
                    className="shrink-0 py-4 px-6 text-center text-xs text-slate-400 border-t border-slate-200/80 dark:border-slate-800"
                >
                    © 2026 ThirdEye Data — PrepWin Student Career &amp; Placement Platform
                </footer>
            </div>
        </div>
    );
};

export default StudentLayout;
