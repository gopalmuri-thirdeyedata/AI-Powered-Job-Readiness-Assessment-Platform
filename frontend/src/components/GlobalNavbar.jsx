import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, Sun, Moon, LogOut } from 'lucide-react';
import CandidateLoginModal from './CandidateLoginModal';
import { useAuth } from '../auth/useAuth';
import { ROLE_LABELS } from '../auth/roles';
import { useTheme } from '../context/ThemeContext';
import useStudentTaskStatus from '../hooks/useStudentTaskStatus';
import { clearStudentSession } from '../utils/authStorage';

const GlobalNavbar = ({ onToggleMobileMenu }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const { theme, toggleTheme } = useTheme();
    const { hasCompletedTask } = useStudentTaskStatus();
    const { user: sessionUser, signOut } = useAuth();

    const isAdminRoute = location.pathname.startsWith('/admin');

    // Profile & organization come from the server-verified session
    const profile = sessionUser || {};

    const handleSignOut = async () => {
        clearStudentSession();
        await signOut();
        navigate('/?auth=login', { replace: true });
    };

    const [showLoginModal, setShowLoginModal] = useState(false);

    const signOutBtn = (title) => (
        <button
            type="button"
            onClick={handleSignOut}
            className="inline-flex items-center gap-1.5 h-9 px-3 text-[13px] font-medium text-slate-700 dark:text-slate-200 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg border border-slate-300/80 dark:border-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.05)] dark:shadow-none hover:border-red-200 dark:hover:border-red-900 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
            title={title}
        >
            <LogOut className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline">Sign Out</span>
        </button>
    );

    const studentTab = (active) => `text-sm font-semibold px-3.5 py-1.5 rounded-lg border transition-colors ${active ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-200'}`;
    const accountName = profile.email || 'Administrator';

    return (
        <>
            <nav className="h-16 bg-white/95 dark:bg-[var(--pw-surface)] backdrop-blur border-b border-slate-200/90 dark:border-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.03)] fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-3 px-3 sm:px-6 transition-colors">
                {/* Logo & Mobile Menu Section */}
                <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                    {onToggleMobileMenu && (
                        <button
                            type="button"
                            onClick={onToggleMobileMenu}
                            aria-label="Toggle navigation menu"
                            className="md:hidden p-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/80 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5d8c2c]/50"
                        >
                            <Menu className="w-5 h-5" />
                        </button>
                    )}
                    <Link to={isAdminRoute ? "/admin/dashboard" : "/"} className="flex items-center gap-3 min-w-0 shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5d8c2c]/50">
                        <img src="/logo_main.png" alt="ThirdEye Data Logo" className="h-9 w-auto object-contain shrink-0" />
                        <div className="hidden sm:block w-px h-6 bg-slate-200 dark:bg-slate-700 shrink-0" />
                        <div className="flex flex-col justify-center min-w-0">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <span className="text-[19px] font-bold text-slate-900 dark:text-white tracking-[-0.03em] leading-none shrink-0">PrepWin</span>
                                <span className="w-px h-3.5 bg-slate-200 dark:bg-slate-700 shrink-0" aria-hidden="true" />
                                <span className="text-[14px] sm:text-[15px] font-semibold text-slate-700 dark:text-slate-200 tracking-tight leading-none truncate">Assessment Management</span>
                            </div>
                            <span className="hidden sm:block text-[11px] font-medium tracking-wide text-slate-400 dark:text-slate-500 leading-none mt-1 self-start">Job Readiness Platform</span>
                        </div>
                    </Link>
                </div>

                {/* Center Navigation Links (Student Portal) */}
                {!isAdminRoute && (
                    <div className="hidden md:flex items-center gap-2 lg:gap-4">
                        {profile.role === 'STUDENT' && (
                            <>
                                {hasCompletedTask && (
                                    <Link to="/student/dashboard" className={studentTab(location.pathname.startsWith('/student'))}>
                                        Student Dashboard
                                    </Link>
                                )}
                                <Link to="/assessment/setup" data-fallback="/student/dashboard" className={studentTab(location.pathname.startsWith('/assessment'))}>
                                    Student Assessment
                                </Link>
                            </>
                        )}
                    </div>
                )}

                {/* Right Section: Theme, account, sign out */}
                <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                    {/* Theme Toggle Button */}
                    <button
                        type="button"
                        onClick={toggleTheme}
                        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                        className="flex h-9 w-9 items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/80 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5d8c2c]/50"
                        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                    >
                        {theme === 'dark' ? <Sun className="w-[18px] h-[18px] text-amber-400" /> : <Moon className="w-[18px] h-[18px]" />}
                    </button>

                    <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />

                    {/* ADMIN PORTAL IDENTITY & ACTIONS (server-verified session) */}
                    {isAdminRoute ? (
                        <div className="flex items-center gap-3">
                            <div className="hidden sm:flex items-center gap-2.5 min-w-0">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#5d8c2c]/20 to-[#5d8c2c]/5 dark:from-emerald-500/25 dark:to-emerald-500/5 ring-1 ring-[#5d8c2c]/25 dark:ring-emerald-500/30 text-[13px] font-semibold uppercase text-[#4c7324] dark:text-emerald-300" aria-hidden="true">
                                    {accountName.charAt(0)}
                                </span>
                                <div className="flex flex-col min-w-0">
                                    <span className="text-[13px] font-semibold leading-4 tracking-tight text-slate-900 dark:text-slate-100 truncate max-w-[200px]">
                                        {accountName}
                                    </span>
                                    <div className="flex items-center gap-1.5 mt-1 leading-none">
                                        {profile.organization_name && (
                                            <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[120px]">
                                                {profile.organization_name}
                                            </span>
                                        )}
                                        <span className="text-[10px] font-semibold text-[#4c7324] dark:text-emerald-300 uppercase tracking-[0.08em] bg-[#5d8c2c]/10 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded ring-1 ring-inset ring-[#5d8c2c]/25 dark:ring-emerald-800/60 whitespace-nowrap">
                                            {ROLE_LABELS[profile.role] || 'Admin'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            {signOutBtn('Sign Out of Admin Portal')}
                        </div>
                    ) : (
                        /* STUDENT / PUBLIC IDENTITY & ACTIONS */
                        signOutBtn('Sign Out')
                    )}
                </div>
            </nav>

            {/* Candidate Login Modal */}
            <CandidateLoginModal
                isOpen={showLoginModal}
                onClose={() => setShowLoginModal(false)}
            />
        </>
    );
};

export default GlobalNavbar;
