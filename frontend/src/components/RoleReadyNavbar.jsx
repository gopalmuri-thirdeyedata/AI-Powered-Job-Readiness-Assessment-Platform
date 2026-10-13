import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sun, Moon, LogOut, Menu, X, User, LayoutDashboard } from 'lucide-react';
import { useClerk, useUser } from '@clerk/clerk-react';
import { useTheme } from '../context/ThemeContext';

/**
 * RoleReadyNavbar
 * 
 * Standardized shared navbar for RoleReady assessment setup & assessment screens:
 * - 80px (h-20) height matching RoleReady homepage
 * - Centered max-w-7xl inner container with balanced horizontal padding
 * - ThirdEye logo & RoleReady wordmark vertically aligned on one baseline
 * - Responsive light/dark theme toggle utilizing design tokens
 * - Direct Student Dashboard return button for seamless navigation
 * - Clean user profile identity and sign-out action
 * - Cohesive border and surface treatment in both light (#FFFFFF) and dark (#0B1220 / #111B2E) themes
 */
const RoleReadyNavbar = ({ title = "Student Assessment", showDashboard = true }) => {
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
        <header className="sticky top-0 left-0 right-0 z-50 h-20 bg-[var(--rr-surface)]/95 backdrop-blur-md border-b border-[var(--rr-border)] shadow-xs transition-colors">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full flex items-center justify-between gap-4">
                
                {/* ── Left: Branding & Subtitle ── */}
                <div className="flex items-center gap-4 sm:gap-6 shrink-0">
                    <Link to="/" className="flex items-center gap-3 group focus:outline-none shrink-0" title="RoleReady Home">
                        <img
                            src="/logo_main.png"
                            alt="ThirdEye Data"
                            className="h-9 w-auto object-contain shrink-0 transition-transform group-hover:scale-[1.02]"
                        />
                        <div className="w-px h-6 bg-[var(--rr-border)] hidden sm:block shrink-0" />
                        <div className="flex flex-col justify-center">
                            <span className="text-lg font-bold tracking-tight text-[var(--rr-text)] group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors leading-none">
                                RoleReady
                            </span>
                            <span className="text-[10px] font-medium text-[var(--rr-muted)] tracking-normal mt-1 leading-none">
                                Job Readiness Platform
                            </span>
                        </div>
                    </Link>

                    {/* Section Pill Badge */}
                    {title && (
                        <div className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300 text-xs font-semibold">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            <span>{title}</span>
                        </div>
                    )}
                </div>

                {/* ── Right: Theme Toggle & User Actions ── */}
                <div className="hidden md:flex items-center gap-3 shrink-0">
                    {/* Theme Toggle Button */}
                    <button
                        type="button"
                        onClick={toggleTheme}
                        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                        className="w-9 h-9 flex items-center justify-center rounded-xl text-[var(--rr-muted)] hover:text-[var(--rr-text)] hover:bg-[var(--rr-bg)] transition-colors cursor-pointer border border-[var(--rr-border)]"
                        title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                    >
                        {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
                    </button>

                    {/* User Identity or Sign In */}
                    {user ? (
                        <div className="flex items-center gap-2.5 pl-2 border-l border-[var(--rr-border)]">
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--rr-card)] border border-[var(--rr-border)] text-xs">
                                <div className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-bold text-[10px]">
                                    {userName ? userName.charAt(0).toUpperCase() : <User className="w-3 h-3" />}
                                </div>
                                <span className="font-medium text-[var(--rr-text)] max-w-[140px] truncate" title={userEmail}>
                                    {userName || userEmail}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={handleSignOut}
                                aria-label="Sign Out"
                                title="Sign Out"
                                className="w-9 h-9 flex items-center justify-center rounded-xl text-[var(--rr-muted)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 dark:hover:text-red-400 transition-colors cursor-pointer"
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
                        className="w-9 h-9 flex items-center justify-center rounded-lg text-[var(--rr-muted)] hover:text-[var(--rr-text)] hover:bg-[var(--rr-bg)] transition-colors cursor-pointer border border-[var(--rr-border)]"
                    >
                        {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
                    </button>
                    <button
                        type="button"
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                        aria-label="Toggle navigation menu"
                        className="w-9 h-9 flex items-center justify-center text-[var(--rr-text)] hover:bg-[var(--rr-bg)] rounded-xl transition-colors focus:outline-none"
                    >
                        {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    </button>
                </div>
            </div>

            {/* ── Mobile Dropdown Drawer ── */}
            {mobileMenuOpen && (
                <div className="md:hidden absolute top-20 left-0 right-0 bg-[var(--rr-surface)] border-b border-[var(--rr-border)] shadow-xl px-5 py-4 animate-in slide-in-from-top-2 duration-200 z-50">
                    <div className="flex flex-col gap-2">
                        {user ? (
                            <>
                                <div className="px-3.5 py-2 rounded-xl bg-[var(--rr-card)] border border-[var(--rr-border)] flex items-center gap-2.5 my-1">
                                    <div className="w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-bold text-xs">
                                        {userName ? userName.charAt(0).toUpperCase() : 'U'}
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                        <span className="text-xs font-bold text-[var(--rr-text)] truncate">{userName || 'Student'}</span>
                                        <span className="text-[11px] text-[var(--rr-muted)] truncate">{userEmail}</span>
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
