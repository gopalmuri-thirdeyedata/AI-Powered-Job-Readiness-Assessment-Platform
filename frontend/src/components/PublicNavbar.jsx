import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Menu, X, Sun, Moon, GraduationCap, ShieldCheck, ChevronRight } from 'lucide-react';
import { useClerk, useUser } from '@clerk/clerk-react';
import { useTheme } from '../context/ThemeContext';

const PublicNavbar = ({ onOpenStudentSignIn, onOpenAdminSignIn, onOpenSignIn }) => {
    const navigate = useNavigate();
    const { user } = useUser();
    const clerk = useClerk();
    const { theme, toggleTheme } = useTheme();
    const [scrolled, setScrolled] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 10);
        };
        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    const handleStudentClick = () => {
        setMobileMenuOpen(false);
        if (user) {
            navigate('/assessment/setup');
        } else if (onOpenStudentSignIn) {
            onOpenStudentSignIn();
        } else {
            navigate('/?auth=student');
        }
    };

    const handleAdminClick = () => {
        setMobileMenuOpen(false);
        if (user) {
            navigate('/admin/dashboard');
        } else if (onOpenAdminSignIn) {
            onOpenAdminSignIn();
        } else if (onOpenSignIn) {
            onOpenSignIn();
        } else {
            navigate('/?auth=admin');
        }
    };

    return (
        <header
            className={`fixed top-0 left-0 right-0 z-50 h-20 transition-all duration-200 ${
                scrolled
                    ? 'bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200/90 dark:border-slate-800 shadow-xs'
                    : 'bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm border-b border-slate-100 dark:border-slate-800/80 shadow-none'
            }`}
        >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full flex items-center justify-between gap-4">
                
                {/* ── Left: Branding & How It Works ── */}
                <div className="flex items-center gap-8 lg:gap-10 shrink-0">
                    <Link to="/" className="flex items-center gap-3 group focus:outline-none shrink-0">
                        <img
                            src="/logo_main.png"
                            alt="ThirdEye Data"
                            className="h-9 w-auto object-contain shrink-0 transition-transform group-hover:scale-[1.02]"
                        />
                        <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 hidden sm:block shrink-0" />
                        <div className="flex flex-col justify-center">
                            <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-white group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors leading-none">
                                RoleReady
                            </span>
                            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 tracking-normal mt-1 leading-none">
                                Job Readiness Platform
                            </span>
                        </div>
                    </Link>

                    {/* Navigation Link: How It Works */}
                    <nav className="hidden md:flex items-center">
                        <a
                            href="#how-it-works"
                            className="text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white px-3 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                        >
                            How It Works
                        </a>
                    </nav>
                </div>

                {/* ── Right: Theme Toggle + 2 Sign In Entry Points ── */}
                <div className="hidden md:flex items-center gap-2.5 shrink-0">
                    {/* Light/Dark Theme Toggle */}
                    <button
                        type="button"
                        onClick={toggleTheme}
                        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                        className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                        {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    </button>

                    {/* Entry Point 1: Student Sign In */}
                    <button
                        type="button"
                        onClick={handleStudentClick}
                        className="px-4 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                        <GraduationCap className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        <span>Student Sign In</span>
                    </button>

                    {/* Entry Point 2: Admin Sign In */}
                    <button
                        type="button"
                        onClick={handleAdminClick}
                        className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 text-xs font-semibold shadow-xs hover:shadow-md transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                        <ShieldCheck className="w-4 h-4 text-emerald-400 dark:text-emerald-600" />
                        <span>Admin Sign In</span>
                    </button>
                </div>

                {/* ── Mobile Hamburger Toggle Button ── */}
                <div className="flex md:hidden items-center gap-1.5">
                    <button
                        type="button"
                        onClick={toggleTheme}
                        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                        className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                        {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    </button>
                    <button
                        type="button"
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                        aria-label="Toggle navigation menu"
                        className="w-9 h-9 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors focus:outline-none"
                    >
                        {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    </button>
                </div>
            </div>

            {/* ── Mobile Responsive Dropdown Drawer ── */}
            {mobileMenuOpen && (
                <div className="md:hidden absolute top-20 left-0 right-0 bg-white/98 dark:bg-slate-900/98 backdrop-blur-xl border-b border-slate-200/90 dark:border-slate-800 shadow-xl px-5 py-4 animate-in slide-in-from-top-2 duration-200 z-50">
                    <nav className="flex flex-col gap-2">
                        <a
                            href="#how-it-works"
                            onClick={() => setMobileMenuOpen(false)}
                            className="px-3.5 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between"
                        >
                            <span>How It Works</span>
                            <ChevronRight className="w-4 h-4 text-slate-400" />
                        </a>
                        <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />
                        <button
                            type="button"
                            onClick={handleStudentClick}
                            className="w-full px-3.5 py-2.5 rounded-xl text-sm font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 flex items-center justify-between cursor-pointer"
                        >
                            <span className="flex items-center gap-2">
                                <GraduationCap className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                <span>Student Sign In</span>
                            </span>
                            <ChevronRight className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        </button>
                        <button
                            type="button"
                            onClick={handleAdminClick}
                            className="w-full px-3.5 py-2.5 rounded-xl text-sm font-semibold text-white bg-slate-900 dark:bg-slate-800 flex items-center justify-between cursor-pointer"
                        >
                            <span className="flex items-center gap-2">
                                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                                <span>Admin Sign In</span>
                            </span>
                            <ChevronRight className="w-4 h-4 text-slate-400" />
                        </button>
                    </nav>
                </div>
            )}
        </header>
    );
};

export default PublicNavbar;
