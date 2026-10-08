import React, { useState, useCallback, useEffect } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    LayoutDashboard, FileText, Code2, Users,
    Mic, ChevronLeft, ChevronRight, LogOut, Settings,
    BrainCircuit, UserCheck, Layers, BarChart3, X
} from 'lucide-react';
import GlobalNavbar from '../components/GlobalNavbar';

const SidebarItem = ({ icon: Icon, label, path, isOpen, onClick }) => {
    const location = useLocation();
    const isActive = location.pathname === path;

    return (
        <Link to={path} onClick={onClick} className="focus:outline-none group block">
            <div
                className={`relative flex items-center transition-all duration-300 cursor-pointer ${isOpen
                    ? 'gap-3 px-4 py-3 mx-3 rounded-xl ' + (isActive ? 'bg-[#5d8c2c] text-white shadow-lg' : 'text-gray-800 hover:bg-white/60 hover:text-black')
                    : 'w-12 h-12 mx-auto justify-center rounded-xl ' + (isActive ? 'text-[#5d8c2c] bg-white shadow-xs' : 'text-gray-700 hover:text-[#5d8c2c]')
                    }`}
            >
                {isActive && (
                    <motion.div
                        layoutId="active-pill"
                        className={`absolute ${isOpen ? 'left-[-12px] w-1 h-7' : 'left-[-8px] w-1.5 h-6'} bg-[#5d8c2c] rounded-r-full shadow-[0_0_15px_rgba(93,140,44,0.5)]`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.2 }}
                    />
                )}

                <Icon size={22} className={`shrink-0 z-10 transition-colors ${isActive ? (isOpen ? 'text-white' : 'text-[#5d8c2c]') : 'text-gray-800 group-hover:scale-110'}`} />

                {isOpen && (
                    <motion.span
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        transition={{ duration: 0.2 }}
                        className={`text-[16px] font-semibold tracking-tight whitespace-nowrap z-10 ${isActive ? 'text-white' : 'text-gray-900 group-hover:text-black'}`}
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
    const [sidebarWidth, setSidebarWidth] = useState(280);
    const [isResizing, setIsResizing] = useState(false);
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

    const startResizing = useCallback((e) => {
        setIsResizing(true);
        e.preventDefault();
    }, []);

    const stopResizing = useCallback(() => {
        setIsResizing(false);
    }, []);

    const resize = useCallback((e) => {
        if (isResizing) {
            const newWidth = e.clientX;
            if (newWidth > 200 && newWidth < 500) {
                setSidebarWidth(newWidth);
            }
        }
    }, [isResizing]);

    useEffect(() => {
        if (isResizing) {
            window.addEventListener('mousemove', resize);
            window.addEventListener('mouseup', stopResizing);
            document.body.style.cursor = 'col-resize';
        } else {
            document.body.style.cursor = 'default';
        }
        return () => {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResizing);
            document.body.style.cursor = 'default';
        };
    }, [isResizing, resize, stopResizing]);

    const renderNavItems = (isOpen, onItemClick) => (
        <div className="py-6 space-y-8">
            {/* Pipeline Stages */}
            <div>
                {isOpen && (
                    <h3 className="text-[11px] font-black text-[#5d8c2c] uppercase tracking-[0.2em] mb-4 px-6 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#5d8c2c]" /> Recruitment Pipeline
                    </h3>
                )}
                {!isOpen && <div className="h-2" />}
                <div className={isOpen ? "space-y-1.5" : "space-y-3"}>
                    <SidebarItem icon={LayoutDashboard} label="Dashboard" path="/dashboard" isOpen={isOpen} onClick={onItemClick} />
                    <SidebarItem icon={Layers} label="Rounds Manager" path="/recruitment/rounds" isOpen={isOpen} onClick={onItemClick} />
                    <SidebarItem icon={FileText} label="Resume Screening" path="/resume-screening" isOpen={isOpen} onClick={onItemClick} />
                    <SidebarItem icon={BrainCircuit} label="Screened Candidates" path="/screened-candidates" isOpen={isOpen} onClick={onItemClick} />
                    <SidebarItem icon={UserCheck} label="Aptitude Round" path="/aptitude-round" isOpen={isOpen} onClick={onItemClick} />
                    <SidebarItem icon={Code2} label="Coding Round" path="/coding-round" isOpen={isOpen} onClick={onItemClick} />
                    <SidebarItem icon={Mic} label="AI Interview" path="/technical-interview" isOpen={isOpen} onClick={onItemClick} />
                </div>
            </div>

            {/* Management */}
            <div>
                {isOpen && (
                    <h3 className="text-[11px] font-black text-[#5d8c2c]/80 uppercase tracking-[0.2em] mb-4 px-6 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#5d8c2c]/60" /> Management
                    </h3>
                )}
                <div className="space-y-1.5">
                    <SidebarItem icon={Users} label="All Candidates" path="/candidates" isOpen={isOpen} onClick={onItemClick} />
                </div>
            </div>
        </div>
    );

    return (
        <div className="h-screen bg-white flex flex-col overflow-hidden font-sans antialiased text-black selection:bg-green-100 selection:text-green-900">
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
                                className="fixed top-0 bottom-0 left-0 w-72 max-w-[85vw] bg-[#ecefec] z-50 shadow-2xl flex flex-col border-r border-[#d9e2d9] md:hidden"
                                aria-label="Mobile Navigation"
                            >
                                {/* Drawer Header */}
                                <div className="h-16 px-5 border-b border-[#d9e2d9] flex items-center justify-between bg-white flex-shrink-0">
                                    <div className="flex items-center gap-3">
                                        <img src="/logo_main.png" alt="ThirdEye Data Logo" className="h-7 w-auto object-contain" />
                                        <span className="text-lg font-bold text-[#5d8c2c] tracking-tight">HiringAI</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setIsMobileMenuOpen(false)}
                                        aria-label="Close navigation menu"
                                        className="p-1.5 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/40"
                                    >
                                        <X size={20} />
                                    </button>
                                </div>

                                {/* Drawer Menu List */}
                                <div className="flex-1 overflow-y-auto no-scrollbar">
                                    {renderNavItems(true, () => setIsMobileMenuOpen(false))}
                                </div>
                            </motion.aside>
                        </>
                    )}
                </AnimatePresence>

                {/* Desktop Collapsible / Resizable Sidebar (>= md viewports) */}
                <motion.aside
                    initial={false}
                    animate={{ width: isSidebarOpen ? sidebarWidth : 84 }}
                    transition={isResizing ? { duration: 0 } : { duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                    className="hidden md:flex bg-[#ecefec] border-r border-[#d9e2d9] flex-col h-full z-40 relative shadow-xs flex-shrink-0"
                    aria-label="Sidebar Navigation"
                >
                    {/* Resize Handle */}
                    <div
                        onMouseDown={startResizing}
                        className={`absolute -right-1 top-0 w-2.5 h-full cursor-col-resize hover:bg-[#5d8c2c]/20 transition-colors z-[100] ${isResizing ? 'bg-[#5d8c2c]/40' : ''}`}
                        title="Drag to resize sidebar"
                    />

                    {/* Collapse/Expand Toggle Button */}
                    <div className="absolute -right-3 top-6 z-50">
                        <button
                            type="button"
                            onClick={() => setSidebarOpen(!isSidebarOpen)}
                            aria-label={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
                            className="p-1 rounded-full bg-white text-[#5d8c2c] shadow-md hover:shadow-lg hover:scale-110 transition-all border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/30"
                        >
                            {isSidebarOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
                        </button>
                    </div>

                    {/* Scrollable Desktop Menu */}
                    <div className="flex-1 overflow-y-auto no-scrollbar">
                        {renderNavItems(isSidebarOpen, null)}
                    </div>
                </motion.aside>

                {/* Main Content Area */}
                <main className="flex-1 min-w-0 h-full overflow-y-auto bg-gray-50/50 p-3 sm:p-5 md:p-6 relative scroll-smooth w-full">
                    <div className="w-full max-w-full pb-16">
                        <Outlet />
                    </div>
                </main>
            </div>
        </div>
    );
};

export default DashboardLayout;
