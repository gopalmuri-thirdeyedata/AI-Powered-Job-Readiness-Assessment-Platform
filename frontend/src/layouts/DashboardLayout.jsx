import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
    LayoutDashboard,
    Briefcase,
    Link2,
    ClipboardList,
    Users,
    UserCog,
    MonitorPlay,
    ChevronLeft,
    ChevronRight,
    X,
} from 'lucide-react';
import GlobalNavbar from '../components/GlobalNavbar';
import { WORKFLOW_ROUTES } from '../components/admin/workflowRoutes';
import { STUDENT_DEMO_BASE } from '../utils/studentDemo';

// Fixed desktop widths: the sidebar only ever toggles between these two (collapse / expand), it is not resizable.
const SIDEBAR_WIDTH_EXPANDED = 280;
const SIDEBAR_WIDTH_COLLAPSED = 84;

// `scope` keeps the desktop sidebar and the mobile drawer from sharing one animated highlight (a shared layoutId stalls the
// drawer's exit animation when the active item changes).
const SidebarItem = ({ icon: Icon, label, path, isOpen, onClick, scope }) => {
    const location = useLocation();
    // Overview also answers to the /dashboard alias; every other item is active on its own route
    const isActive = path === WORKFLOW_ROUTES.overview
        ? location.pathname === WORKFLOW_ROUTES.overview || location.pathname === '/dashboard'
        : location.pathname === path;

    return (
        <Link
            to={path}
            onClick={onClick}
            title={isOpen ? undefined : label}
            aria-label={isOpen ? undefined : label}
            aria-current={isActive ? 'page' : undefined}
            className={`group relative flex items-center rounded-lg text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5d8c2c]/50 ${isOpen ? 'h-10 gap-3 px-3 mx-3' : 'h-10 w-10 mx-auto justify-center'} ${isActive
                ? 'bg-[#5d8c2c]/[0.09] dark:bg-emerald-500/10 ring-1 ring-inset ring-[#5d8c2c]/15 dark:ring-emerald-400/15 text-[#4c7324] dark:text-emerald-300 font-semibold'
                : 'text-slate-600 dark:text-slate-400 font-medium hover:bg-slate-100/80 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100'}`}
        >
            {isActive && (
                <motion.span
                    layoutId={`active-pill-${scope}`}
                    className={`absolute ${isOpen ? '-left-3' : '-left-[21px]'} top-2 bottom-2 w-[3px] rounded-r-full bg-[#5d8c2c] dark:bg-emerald-400`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.2 }}
                    aria-hidden="true"
                />
            )}
            <Icon size={18} strokeWidth={isActive ? 2.1 : 1.8} className={`shrink-0 transition-colors ${isActive ? '' : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-200'}`} aria-hidden="true" />
            {isOpen && <span className="whitespace-nowrap truncate">{label}</span>}
        </Link>
    );
};

const DashboardLayout = () => {
    const [isSidebarOpen, setSidebarOpen] = useState(true);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const reduceMotion = useReducedMotion();

    // Close mobile menu on route change
    useEffect(() => {
        setIsMobileMenuOpen(false);
    }, [location.pathname]);

    // Handle Escape key to close mobile menu
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isMobileMenuOpen) {
                setIsMobileMenuOpen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isMobileMenuOpen]);

    const groupHeading = (text, isOpen) => (isOpen
        ? <h3 className="px-6 mb-2 text-[10.5px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-[0.14em]">{text}</h3>
        : <div className="mx-auto mb-2 h-px w-6 bg-slate-200 dark:bg-slate-800" aria-hidden="true" />);

    const renderNavItems = (isOpen, onItemClick, scope) => (
        <nav className="py-5 space-y-7" aria-label="Admin sections">
            {/* Assessment Workspace */}
            <div>
                {groupHeading('PrepWin Assessment Suite', isOpen)}
                <div className="space-y-1">
                    <SidebarItem icon={LayoutDashboard} label="Overview" path={WORKFLOW_ROUTES.overview} isOpen={isOpen} onClick={onItemClick} scope={scope} />
                    <SidebarItem icon={Briefcase} label="Job Roles & Blueprints" path={WORKFLOW_ROUTES.roles} isOpen={isOpen} onClick={onItemClick} scope={scope} />
                    <SidebarItem icon={Link2} label="Shared Links" path={WORKFLOW_ROUTES.links} isOpen={isOpen} onClick={onItemClick} scope={scope} />
                    <SidebarItem icon={ClipboardList} label="Candidate Results" path={WORKFLOW_ROUTES.results} isOpen={isOpen} onClick={onItemClick} scope={scope} />
                </div>
            </div>

            {/* Administration */}
            <div>
                {groupHeading('Administration', isOpen)}
                <div className="space-y-1">
                    <SidebarItem icon={UserCog} label="User Management" path={WORKFLOW_ROUTES.users} isOpen={isOpen} onClick={onItemClick} scope={scope} />
                    <SidebarItem icon={MonitorPlay} label="Student Dashboard Demo" path={STUDENT_DEMO_BASE} isOpen={isOpen} onClick={onItemClick} scope={scope} />
                </div>
            </div>
        </nav>
    );

    return (
        <div className="pw-admin h-screen bg-[var(--pw-bg)] flex flex-col overflow-hidden font-sans antialiased text-[var(--pw-text)] selection:bg-green-100 selection:text-green-900 transition-colors">
            {/* 1. Global Navbar (Fixed Height) */}
            <div className="flex-none z-50 relative">
                <GlobalNavbar onToggleMobileMenu={() => setIsMobileMenuOpen(prev => !prev)} />
            </div>

            {/* 2. Main Layout (Fills remaining height) */}
            <div className="flex flex-1 overflow-hidden relative pt-16">

                {/* Mobile Drawer (Slide-Over Navigation for < md viewports) */}
                <AnimatePresence>
                    {isMobileMenuOpen && (
                        <>
                            {/* Backdrop */}
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                onClick={() => setIsMobileMenuOpen(false)}
                                className="fixed inset-0 bg-slate-900/50 z-50 md:hidden"
                                aria-hidden="true"
                            />

                            {/* Drawer Panel */}
                            <motion.aside
                                initial={{ x: '-100%' }}
                                animate={{ x: 0 }}
                                exit={{ x: '-100%' }}
                                transition={{ type: 'spring', damping: 25, stiffness: 250 }}
                                className="fixed top-0 bottom-0 left-0 w-72 max-w-[85vw] bg-white dark:bg-[var(--pw-surface)] z-50 shadow-2xl flex flex-col border-r border-slate-200 dark:border-slate-800 md:hidden"
                                aria-label="Mobile Navigation"
                            >
                                {/* Drawer Header */}
                                <div className="h-16 px-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between flex-shrink-0">
                                    <div className="flex items-center gap-3">
                                        <img src="/logo_main.png" alt="ThirdEye Data Logo" className="h-7 w-auto object-contain" />
                                        <span className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">PrepWin</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setIsMobileMenuOpen(false)}
                                        aria-label="Close navigation menu"
                                        className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5d8c2c]/50"
                                    >
                                        <X size={20} />
                                    </button>
                                </div>

                                {/* Drawer Menu List */}
                                <div className="flex-1 overflow-y-auto overflow-x-hidden no-scrollbar">
                                    {renderNavItems(true, () => setIsMobileMenuOpen(false), 'drawer')}
                                </div>
                            </motion.aside>
                        </>
                    )}
                </AnimatePresence>

                {/* Desktop Collapsible Sidebar (>= md viewports) */}
                <motion.aside
                    initial={false}
                    animate={{ width: isSidebarOpen ? SIDEBAR_WIDTH_EXPANDED : SIDEBAR_WIDTH_COLLAPSED }}
                    transition={{ duration: reduceMotion ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
                    className="hidden md:flex bg-white dark:bg-[var(--pw-surface)] border-r border-slate-200 dark:border-slate-800 flex-col h-full z-40 relative flex-shrink-0 transition-colors"
                    aria-label="Sidebar Navigation"
                >
                    {/* Collapse/Expand Toggle Button */}
                    <div className="absolute -right-3 top-5 z-50">
                        <button
                            type="button"
                            onClick={() => setSidebarOpen(!isSidebarOpen)}
                            aria-label={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
                            className="flex h-6 w-6 items-center justify-center rounded-full bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-300 hover:text-[#4c7324] dark:hover:text-emerald-300 shadow-sm border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5d8c2c]/50"
                        >
                            {isSidebarOpen ? <ChevronLeft size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                        </button>
                    </div>

                    {/* Scrollable Desktop Menu */}
                    <div className="flex-1 overflow-y-auto overflow-x-hidden no-scrollbar">
                        {renderNavItems(isSidebarOpen, null, 'desktop')}
                    </div>
                </motion.aside>

                {/* Main Content Area */}
                <main className="flex-1 min-w-0 h-full overflow-y-auto bg-[var(--pw-bg)] px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8 relative scroll-smooth w-full transition-colors">
                    <div className="w-full max-w-full">
                        <Outlet />
                    </div>
                </main>
            </div>
        </div>
    );
};

export default DashboardLayout;
