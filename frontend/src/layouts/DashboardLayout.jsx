import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    LayoutDashboard,
    Briefcase,
    Link2,
    ClipboardList,
    Users,
    UserCog,
    ChevronLeft,
    ChevronRight,
    X,
} from 'lucide-react';
import GlobalNavbar from '../components/GlobalNavbar';
import { WORKFLOW_ROUTES } from '../components/admin/workflowRoutes';

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
        <Link to={path} onClick={onClick} className="focus:outline-none group block">
            <div
                className={`relative flex items-center transition-all duration-300 cursor-pointer ${isOpen
                    ? 'gap-3 px-4 py-3 mx-3 rounded-xl ' + (isActive ? 'bg-[#5d8c2c] dark:bg-emerald-600 text-white shadow-lg' : 'text-slate-800 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-800/60 hover:text-black dark:hover:text-white')
                    : 'w-12 h-12 mx-auto justify-center rounded-xl ' + (isActive ? 'text-[#5d8c2c] dark:text-emerald-400 bg-white dark:bg-slate-800 shadow-xs' : 'text-slate-700 dark:text-slate-400 hover:text-[#5d8c2c] dark:hover:text-emerald-400 hover:bg-white/40 dark:hover:bg-slate-800/40')
                    }`}
            >
                {isActive && (
                    <motion.div
                        layoutId={`active-pill-${scope}`}
                        className={`absolute ${isOpen ? 'left-[-12px] w-1 h-7' : 'left-[-8px] w-1.5 h-6'} bg-[#5d8c2c] dark:bg-emerald-500 rounded-r-full shadow-[0_0_15px_rgba(93,140,44,0.5)] dark:shadow-[0_0_15px_rgba(16,185,129,0.5)]`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.2 }}
                    />
                )}

                <Icon size={22} className={`shrink-0 z-10 transition-colors ${isActive ? (isOpen ? 'text-white' : 'text-[#5d8c2c] dark:text-emerald-400') : 'text-slate-700 dark:text-slate-400 group-hover:scale-110 group-hover:text-slate-900 dark:group-hover:text-white'}`} />

                {isOpen && (
                    <motion.span
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        transition={{ duration: 0.2 }}
                        className={`text-[16px] font-semibold tracking-tight whitespace-nowrap z-10 ${isActive ? 'text-white' : 'text-slate-800 dark:text-slate-200 group-hover:text-black dark:group-hover:text-white'}`}
                    >
                        {label}
                    </motion.span>
                )}
            </div>
        </Link>
    );
};

const DashboardLayout = () => {
    const [isSidebarOpen, setSidebarOpen] = useState(true);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();

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

    const renderNavItems = (isOpen, onItemClick, scope) => (
        <div className="py-6 space-y-6">
            {/* Assessment Workspace */}
            <div>
                {isOpen && (
                    <h3 className="text-[11px] font-black text-[#5d8c2c] dark:text-emerald-400 uppercase tracking-[0.2em] mb-4 px-6 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#5d8c2c] dark:bg-emerald-400" /> PrepWin Assessment Suite
                    </h3>
                )}
                {!isOpen && <div className="h-2" />}
                <div className={isOpen ? "space-y-1.5" : "space-y-3"}>
                    <SidebarItem icon={LayoutDashboard} label="Overview" path={WORKFLOW_ROUTES.overview} isOpen={isOpen} onClick={onItemClick} scope={scope} />
                    <SidebarItem icon={Briefcase} label="Job Roles & Blueprints" path={WORKFLOW_ROUTES.roles} isOpen={isOpen} onClick={onItemClick} scope={scope} />
                    <SidebarItem icon={Link2} label="Shared Links" path={WORKFLOW_ROUTES.links} isOpen={isOpen} onClick={onItemClick} scope={scope} />
                    <SidebarItem icon={ClipboardList} label="Candidate Results" path={WORKFLOW_ROUTES.results} isOpen={isOpen} onClick={onItemClick} scope={scope} />
                </div>
            </div>

            {/* Administration */}
            <div>
                {isOpen && (
                    <h3 className="text-[11px] font-black text-[#5d8c2c] dark:text-emerald-400 uppercase tracking-[0.2em] mb-4 px-6 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#5d8c2c] dark:bg-emerald-400" /> Administration
                    </h3>
                )}
                <div className={isOpen ? "space-y-1.5" : "space-y-3"}>
                    <SidebarItem icon={UserCog} label="User Management" path={WORKFLOW_ROUTES.users} isOpen={isOpen} onClick={onItemClick} scope={scope} />
                </div>
            </div>
        </div>
    );

    return (
        <div className="h-screen bg-[#F8FAFC] dark:bg-[#0B1220] flex flex-col overflow-hidden font-sans antialiased text-slate-900 dark:text-slate-100 selection:bg-green-100 selection:text-green-900 transition-colors">
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
                                className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 md:hidden"
                                aria-hidden="true"
                            />

                            {/* Drawer Panel */}
                            <motion.aside
                                initial={{ x: '-100%' }}
                                animate={{ x: 0 }}
                                exit={{ x: '-100%' }}
                                transition={{ type: 'spring', damping: 25, stiffness: 250 }}
                                className="fixed top-0 bottom-0 left-0 w-72 max-w-[85vw] bg-[#ecefec] dark:bg-[#0f172a] z-50 shadow-2xl flex flex-col border-r border-[#d9e2d9] dark:border-slate-800 md:hidden"
                                aria-label="Mobile Navigation"
                            >
                                {/* Drawer Header */}
                                <div className="h-16 px-5 border-b border-[#d9e2d9] dark:border-slate-800 flex items-center justify-between bg-white dark:bg-[#0f172a] flex-shrink-0">
                                    <div className="flex items-center gap-3">
                                        <img src="/logo_main.png" alt="ThirdEye Data Logo" className="h-7 w-auto object-contain" />
                                        <span className="text-lg font-bold text-[#5d8c2c] dark:text-emerald-400 tracking-tight">PrepWin</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setIsMobileMenuOpen(false)}
                                        aria-label="Close navigation menu"
                                        className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-gray-100 dark:hover:bg-slate-800/80 transition-colors focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/40"
                                    >
                                        <X size={20} />
                                    </button>
                                </div>

                                {/* Drawer Menu List */}
                                <div className="flex-1 overflow-y-auto no-scrollbar">
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
                    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                    className="hidden md:flex bg-[#ecefec] dark:bg-[#0f172a] border-r border-[#d9e2d9] dark:border-slate-800 flex-col h-full z-40 relative shadow-xs flex-shrink-0 transition-colors"
                    aria-label="Sidebar Navigation"
                >
                    {/* Collapse/Expand Toggle Button */}
                    <div className="absolute -right-3 top-6 z-50">
                        <button
                            type="button"
                            onClick={() => setSidebarOpen(!isSidebarOpen)}
                            aria-label={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
                            className="p-1 rounded-full bg-white dark:bg-slate-800 text-[#5d8c2c] dark:text-emerald-400 shadow-md hover:shadow-lg hover:scale-110 transition-all border border-gray-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/30 dark:focus:ring-emerald-500/30"
                        >
                            {isSidebarOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
                        </button>
                    </div>

                    {/* Scrollable Desktop Menu */}
                    <div className="flex-1 overflow-y-auto no-scrollbar">
                        {renderNavItems(isSidebarOpen, null, 'desktop')}
                    </div>
                </motion.aside>

                {/* Main Content Area */}
                <main className="flex-1 min-w-0 h-full overflow-y-auto bg-slate-50/50 dark:bg-[#0B1220] p-3 sm:p-5 md:p-6 relative scroll-smooth w-full transition-colors">
                    <div className="w-full max-w-full pb-16">
                        <Outlet />
                    </div>
                </main>
            </div>
        </div>
    );
};

export default DashboardLayout;
