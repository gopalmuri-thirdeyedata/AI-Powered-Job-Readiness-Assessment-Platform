import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, Sun, Moon, LogOut, User } from 'lucide-react';
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

    return (
        <>
            <nav className="h-16 bg-white dark:bg-[#0d1527] border-b border-gray-200 dark:border-slate-800 fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-3 sm:px-6 shadow-sm transition-colors">
                {/* Logo & Mobile Menu Section */}
                <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                    {onToggleMobileMenu && (
                        <button
                            type="button"
                            onClick={onToggleMobileMenu}
                            aria-label="Toggle navigation menu"
                            className="md:hidden p-2 text-gray-700 dark:text-slate-300 hover:text-[#5d8c2c] dark:hover:text-emerald-400 hover:bg-gray-100 dark:hover:bg-slate-800/80 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/30"
                        >
                            <Menu className="w-5 h-5" />
                        </button>
                    )}
                    <Link to={isAdminRoute ? "/admin/dashboard" : "/"} className="flex items-center gap-3 focus:outline-none min-w-0 shrink-0">
                        <img src="/logo_main.png" alt="ThirdEye Data Logo" className="h-[38px] w-auto object-contain shrink-0" />
                        <div className="hidden sm:block w-px h-6 bg-gray-200 dark:bg-slate-800 shrink-0" />
                        <div className="flex flex-col justify-center">
                            <span className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight leading-none">PrepWin</span>
                            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 leading-none mt-0.5">Job Readiness Platform</span>
                        </div>
                    </Link>
                </div>

                {/* Center Navigation Links (Student Portal) */}
                {!isAdminRoute && (
                    <div className="hidden md:flex items-center gap-2 lg:gap-4">
                        {profile.role === 'STUDENT' && (
                            <>
                                {hasCompletedTask && (
                                    <Link
                                        to="/student/dashboard"
                                        className={`text-sm font-semibold px-3.5 py-1.5 rounded-lg transition-all ${location.pathname.startsWith('/student') ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-xs' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'}`}
                                    >
                                        Student Dashboard
                                    </Link>
                                )}
                                <Link
                                    to="/assessment/setup"
                                    data-fallback="/student/dashboard"
                                    className={`text-sm font-semibold px-3.5 py-1.5 rounded-lg transition-all ${location.pathname.startsWith('/assessment') ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-xs' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'}`}
                                >
                                    Student Assessment
                                </Link>
                            </>
                        )}
                    </div>
                )}

                {/* Right Section: Profile & Actions */}
                <div className="flex items-center gap-3 sm:gap-4 flex-shrink-0">
                    {/* Theme Toggle Button */}
                    <button
                        type="button"
                        onClick={toggleTheme}
                        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                        className="p-1.5 text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800/80 rounded-lg transition-colors focus:outline-none"
                        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                    >
                        {theme === 'dark' ? <Sun className="w-5 h-5 text-amber-500" /> : <Moon className="w-5 h-5 text-slate-600" />}
                    </button>

                    <div className="h-8 w-px bg-gray-200 dark:bg-slate-800 mx-2" />

                    {/* ADMIN PORTAL IDENTITY & ACTIONS (server-verified session) */}
                    {isAdminRoute ? (
                        <div className="flex items-center gap-3 sm:gap-4">
                            <div className="hidden sm:flex flex-col items-end">
                                <span className="text-xs font-bold text-gray-900 dark:text-slate-100 truncate max-w-[180px]">
                                    {profile.email || 'Administrator'}
                                </span>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                    {profile.organization_name && (
                                        <span className="text-[10px] text-gray-500 dark:text-slate-400 truncate max-w-[120px]">
                                            {profile.organization_name}
                                        </span>
                                    )}
                                    <span className="text-[10px] font-semibold text-[#5d8c2c] dark:text-emerald-300 uppercase tracking-wider bg-green-50 dark:bg-emerald-950/40 px-1.5 py-0.2 rounded border border-green-200 dark:border-emerald-800/60">
                                        {ROLE_LABELS[profile.role] || 'Admin'}
                                    </span>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={handleSignOut}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-red-200 transition-colors cursor-pointer"
                                title="Sign Out of Admin Portal"
                            >
                                <LogOut className="w-3.5 h-3.5 text-red-500" />
                                <span className="hidden sm:inline">Sign Out</span>
                            </button>
                        </div>
                    ) : (
                        /* STUDENT / PUBLIC IDENTITY & ACTIONS */
                        <>
                            <button
                                type="button"
                                onClick={handleSignOut}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-red-200 transition-colors cursor-pointer"
                                title="Sign Out"
                            >
                                <LogOut className="w-3.5 h-3.5 text-red-500" />
                                <span className="hidden sm:inline">Sign Out</span>
                            </button>
                        </>
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
