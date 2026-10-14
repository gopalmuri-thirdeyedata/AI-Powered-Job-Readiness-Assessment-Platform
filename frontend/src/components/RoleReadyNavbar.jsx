import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sun, Moon, LogOut, Menu, X, User, LayoutDashboard } from 'lucide-react';
import { useClerk, useUser } from '@clerk/clerk-react';
import { useTheme } from '../context/ThemeContext';

/**
 * RoleReadyNavbar
 * 
 * Standardized shared navbar for PrepWin assessment setup & assessment screens:
 * - 64px (h-16) height matching StudentLayout header height
 * - Centered max-w-7xl inner container with balanced horizontal padding
 * - Brand logo & PrepWin wordmark aligned on one baseline
 * - Prominent breadcrumb return link to Student Dashboard
 * - Clean user profile identity and sign-out action
 * - Cohesive border and surface treatment in both light and dark themes
 */
const RoleReadyNavbar = ({ title = "Student Assessment", showDashboard = true, showHome = false }) => {
    const navigate = useNavigate();
    const { user } = useUser();
    const clerk = useClerk();
    const { theme, toggleTheme } = useTheme();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const handleSignOut = async () => {
        try {
            localStorage.removeItem('token');
            localStorage.removeItem('studentToken');
            localStorage.removeItem('invitationToken');
            localStorage.removeItem('user_profile');
            if (clerk && clerk.signOut) {
                await clerk.signOut();
            }
        } catch (err) {
            console.error("Sign out error:", err);
        } finally {
            navigate('/');
        }
    };

    const userEmail = user?.primaryEmailAddress?.emailAddress || '';
    const userName = user?.fullName || user?.firstName || (userEmail ? userEmail.split('@')[0] : '');

    return (
        <header className="sticky top-0 left-0 right-0 z-50 h-16 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 shadow-xs transition-colors">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full flex items-center justify-between gap-4">
                
                {/* ── Left: Branding & Subtitle ── */}
                <div className="flex items-center gap-3 sm:gap-5 shrink-0">
                    <Link to="/" className="flex items-center gap-2.5 group focus:outline-none shrink-0" title="PrepWin Home">
                        <img
                            src="/logo_main.png"
                            alt="ThirdEye Data"
                            className="h-8 w-auto object-contain shrink-0 transition-transform group-hover:scale-[1.02]"
                        />
                        <div className="w-px h-5 bg-slate-200 dark:bg-slate-800 hidden sm:block shrink-0" />
                        <div className="flex flex-col justify-center">
                            <span className="text-base font-bold tracking-tight text-slate-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors leading-none">
                                PrepWin
                            </span>
                            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 tracking-normal mt-1 leading-none">
                                Job Readiness Platform
                            </span>
                        </div>
                    </Link>

                    {/* Section Pill Badge */}
                    {title && (
                        <div className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300 text-xs font-semibold">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            <span>{title}</span>
                        </div>
                    )}
                </div>

                {/* ── Center / Breadcrumb Link ── */}
                {showDashboard && (
                    <div className="hidden sm:flex items-center">
                        <Link
                            to="/student/dashboard"
                            id="nav-student-dashboard-btn"
                            className="text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 flex items-center gap-1.5 px-3 py-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors"
                            title="Return to Student Dashboard"
                        >
                            <span>← Back to Dashboard</span>
                        </Link>
                    </div>
                )}

                {/* ── Right: Theme Toggle & User Actions ── */}
                <div className="hidden md:flex items-center gap-3 shrink-0">
                    {/* Theme Toggle Button */}
                    <button
                        type="button"
                        onClick={toggleTheme}
                        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                        className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-700 transition-colors cursor-pointer"
                        title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                    >
                        {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
                    </button>

                    {/* User Identity or Sign In */}
                    {user ? (
                        <div className="flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-slate-800">
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
                                <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center font-bold text-[10px]">
                                    {userName ? userName.charAt(0).toUpperCase() : <User className="w-3 h-3" />}
                                </div>
                                <span className="font-semibold text-slate-700 dark:text-slate-200 max-w-[140px] truncate" title={userEmail}>
                                    {userName || userEmail}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={handleSignOut}
                                aria-label="Sign Out"
                                title="Sign Out"
                                className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 dark:hover:text-red-400 transition-colors cursor-pointer"
                            >
                                <LogOut className="w-4 h-4" />
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => navigate('/?auth=student')}
                            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-all shadow-xs cursor-pointer"
                        >
                            Sign In
                        </button>
                    )}
                </div>

                {/* ── Mobile Hamburger Controls ── */}
                <div className="flex md:hidden items-center gap-1.5">
                    <button
                        type="button"
                        onClick={toggleTheme}
                        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                        className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-700 transition-colors cursor-pointer"
                    >
                        {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
                    </button>
                    <button
                        type="button"
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                        aria-label="Toggle navigation menu"
                        className="w-9 h-9 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors focus:outline-none"
                    >
                        {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    </button>
                </div>
            </div>

            {/* ── Mobile Dropdown Drawer ── */}
            {mobileMenuOpen && (
                <div className="md:hidden absolute top-16 left-0 right-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-xl px-5 py-4 animate-in slide-in-from-top-2 duration-200 z-50">
                    <div className="flex flex-col gap-2">
                        {showDashboard && (
                            <Link
                                to="/student/dashboard"
                                onClick={() => setMobileMenuOpen(false)}
                                className="px-3.5 py-2.5 rounded-xl text-sm font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/60 flex items-center gap-2"
                            >
                                <LayoutDashboard className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                <span>Student Dashboard</span>
                            </Link>
                        )}
                        {showHome && (
                            <Link
                                to="/"
                                onClick={() => setMobileMenuOpen(false)}
                                className="px-3.5 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                                PrepWin Home
                            </Link>
                        )}
                        {user ? (
                            <>
                                <div className="px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center gap-2.5 my-1">
                                    <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center font-bold text-xs">
                                        {userName ? userName.charAt(0).toUpperCase() : 'U'}
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                        <span className="text-xs font-bold text-slate-900 dark:text-white truncate">{userName || 'Student'}</span>
                                        <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{userEmail}</span>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setMobileMenuOpen(false);
                                        handleSignOut();
                                    }}
                                    className="w-full px-3.5 py-2.5 rounded-xl text-sm font-semibold text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 flex items-center gap-2 cursor-pointer"
                                >
                                    <LogOut className="w-4 h-4" />
                                    <span>Sign Out</span>
                                </button>
                            </>
                        ) : (
                            <button
                                type="button"
                                onClick={() => {
                                    setMobileMenuOpen(false);
                                    navigate('/?auth=student');
                                }}
                                className="w-full px-3.5 py-2.5 rounded-xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 flex items-center justify-center gap-2 cursor-pointer"
                            >
                                <span>Student Sign In</span>
                            </button>
                        )}
                    </div>
                </div>
            )}
        </header>
    );
};

export default RoleReadyNavbar;
