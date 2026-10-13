import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
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
import studentApi from '../services/studentApi';
import CareerCopilotDrawer from '../components/student/CareerCopilotDrawer';
import { useTheme } from '../context/ThemeContext';

// Navigation definition with per-item accent colors
const navItems = [
    { label: 'Dashboard',       path: '/student/dashboard',  icon: LayoutDashboard, accent: '#10B981', glow: 'rgba(16,185,129,0.2)'  },
    { label: 'Skill Gap',       path: '/student/skill-gap',  icon: Target,          accent: '#F59E0B', glow: 'rgba(245,158,11,0.2)'  },
    { label: 'Roadmap',         path: '/student/roadmap',    icon: Compass,         accent: '#06B6D4', glow: 'rgba(6,182,212,0.2)'   },
    { label: 'Practice',        path: '/student/practice',   icon: Code2,           accent: '#10B981', glow: 'rgba(16,185,129,0.2)'  },
    { label: 'Mock Interview',      path: '/student/interview',  icon: MessageSquare,   accent: '#8B5CF6', glow: 'rgba(139,92,246,0.2)'  },
    { label: 'Placement Simulation', path: '/student/simulation', icon: Award,           accent: '#F43F5E', glow: 'rgba(244,63,94,0.2)'   },
    { label: 'Campus Drives',       path: '/student/drives',     icon: Building2,       accent: '#3B82F6', glow: 'rgba(59,130,246,0.2)'  },
    { label: 'Projects',        path: '/student/projects',   icon: FolderGit2,      accent: '#F59E0B', glow: 'rgba(245,158,11,0.2)'  },
    { label: 'Resume',          path: '/student/resume',     icon: FileText,        accent: '#A855F7', glow: 'rgba(168,85,247,0.2)'  },
    { label: 'Profile',         path: '/student/profile',    icon: User,            accent: '#94A3B8', glow: 'rgba(148,163,184,0.15)'},
];

/* ─── Sidebar NavItem ─────────────────────────────── */
const NavItem = ({ item, collapsed, onClick }) => {
    const location = useLocation();
    const active = location.pathname === item.path;
    const Icon = item.icon;

    return (
        <Link
            to={item.path}
            onClick={onClick}
            title={collapsed ? item.label : undefined}
            className={`group relative flex items-center rounded-xl transition-all duration-200 select-none ${
                collapsed
                    ? 'justify-center w-10 h-10 mx-auto my-0.5'
                    : 'gap-3 px-3.5 py-2.5 mx-2 mb-0.5'
            } ${
                active
                    ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 font-semibold shadow-xs border border-emerald-200/80 dark:border-emerald-500/20'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100/80 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-200 border border-transparent'
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
    const [profile, setProfile] = useState(null);
    const [collapsed, setCollapsed] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const token = localStorage.getItem('studentToken') || localStorage.getItem('token');
        if (!token && location.pathname !== '/student/login') {
            navigate('/student/login');
            return;
        }
        if (location.pathname !== '/student/login') {
            studentApi.getProfile()
                .then(data => { setProfile(data); setIsLoading(false); })
                .catch(() => { setIsLoading(false); });
        } else {
            setIsLoading(false);
        }
    }, [location.pathname, navigate]);

    // Close mobile drawer on route change
    useEffect(() => { setMobileOpen(false); }, [location.pathname]);

    // Login page renders without layout chrome
    if (location.pathname === '/student/login') return <Outlet />;

    const handleLogout = () => {
        studentApi.logout();
        navigate('/student/login');
    };

    const currentPage = navItems.find(n => n.path === location.pathname);

    /* ─── Sidebar Inner Content ─── */
    const SidebarInner = ({ forMobile = false }) => (
        <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-r border-slate-200/80 dark:border-slate-800">
            {/* Brand */}
            <div
                className={`flex items-center h-16 border-b border-slate-200/80 dark:border-slate-800 px-3 shrink-0 ${forMobile ? 'gap-3' : collapsed ? 'justify-center' : 'gap-3 px-4'}`}
            >
                <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-md bg-gradient-to-tr from-emerald-600 to-emerald-500 text-white"
                >
                    <Sparkles className="w-4 h-4 text-white" />
                </div>
                {(!collapsed || forMobile) && (
                    <div className="leading-none">
                        <div className="text-sm font-bold text-slate-900 dark:text-white tracking-tight">RoleReady</div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider mt-1 text-emerald-600 dark:text-emerald-400">
                            Student Career Hub
                        </div>
                    </div>
                )}
                {forMobile && (
                    <button
                        onClick={() => setMobileOpen(false)}
                        className="ml-auto p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors rounded-lg"
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

    const SIDEBAR_W = collapsed ? 68 : 220;

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
                className="flex flex-col flex-1 min-h-screen transition-all duration-300 ease-in-out"
                style={{ marginLeft: typeof window !== 'undefined' && window.innerWidth >= 1024 ? SIDEBAR_W : 0 }}
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

                    {/* Right: theme toggle & user pill */}
                    <div className="flex items-center gap-2.5">
                        <button
                            type="button"
                            onClick={toggleTheme}
                            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                            className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-700"
                        >
                            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                        </button>
                        {profile && (
                            <Link
                                to="/student/profile"
                                className="hidden sm:flex items-center gap-2 rounded-full px-3 py-1.5 transition-all bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700"
                            >
                                <div
                                    className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 bg-gradient-to-tr from-emerald-600 to-teal-500"
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
                    © 2026 ThirdEye Data — RoleReady Student Career &amp; Placement Platform
                </footer>
            </div>
        </div>
    );
};

export default StudentLayout;
