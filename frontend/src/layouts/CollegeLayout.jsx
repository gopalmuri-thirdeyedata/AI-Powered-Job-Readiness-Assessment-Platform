import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
    LayoutDashboard,
    Users,
    Building2,
    GraduationCap,
    LogOut,
    Menu,
    X,
    Shield,
    ArrowUpRight,
} from 'lucide-react';

const CollegeLayout = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [userProfile, setUserProfile] = useState(null);

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) {
            navigate('/login');
            return;
        }

        try {
            const stored = JSON.parse(localStorage.getItem('user_profile') || '{}');
            setUserProfile(stored);
        } catch {
            // ignore
        }
    }, [navigate]);

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user_profile');
        navigate('/login');
    };

    const navItems = [
        { label: 'Cohort Overview', path: '/college/dashboard', icon: LayoutDashboard },
        { label: 'Student Roster', path: '/college/students', icon: Users },
        { label: 'Placement Drives', path: '/college/drives', icon: Building2 },
    ];

    const isActive = (path) => location.pathname === path;

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30 selection:text-indigo-200">
            {/* Header */}
            <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2">
                    {/* Brand */}
                    <div className="flex items-center gap-4 min-w-0">
                        <Link to="/college/dashboard" className="flex items-center gap-2 sm:gap-3 group min-w-0">
                            <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl border border-indigo-500/30">
                                <GraduationCap className="w-5 h-5 group-hover:scale-110 transition-transform" />
                            </div>
                            <div className="flex flex-col min-w-0">
                                <span className="text-lg font-bold text-indigo-400 tracking-tight group-hover:text-indigo-300 transition-colors">
                                    PrepWin
                                </span>
                                <span className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 truncate">
                                    College Placement Office
                                </span>
                            </div>
                        </Link>
                    </div>

                    {/* Navigation */}
                    <nav className="hidden md:flex items-center gap-1.5">
                        {navItems.map((item) => {
                            const Icon = item.icon;
                            const active = isActive(item.path);
                            return (
                                <Link
                                    key={item.path}
                                    to={item.path}
                                    className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                                        active
                                            ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 shadow-xs'
                                            : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                                    }`}
                                >
                                    <Icon className={`w-4 h-4 ${active ? 'text-indigo-400' : 'text-slate-400'}`} />
                                    <span>{item.label}</span>
                                </Link>
                            );
                        })}
                    </nav>

                    {/* Right User Bar */}
                    <div className="hidden md:flex items-center gap-3">
                        <Link
                            to="/dashboard"
                            className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-slate-800/60 transition-colors"
                            title="Switch to Recruiter Dashboard"
                        >
                            <span>Recruiter View</span>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                        </Link>
                        <div className="w-[1px] h-5 bg-slate-800" />
                        <div className="flex items-center gap-2.5 bg-slate-800/80 border border-slate-700/60 px-3 py-1.5 rounded-full text-xs">
                            <Shield className="w-3.5 h-3.5 text-indigo-400" />
                            <span className="font-semibold text-slate-200">
                                {userProfile?.email ? userProfile.email.split('@')[0] : 'Placement Officer'}
                            </span>
                        </div>
                        <button
                            onClick={handleLogout}
                            title="Sign Out"
                            className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors"
                        >
                            <LogOut className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Mobile Menu Button */}
                    <div className="md:hidden flex items-center gap-2">
                        <button
                            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                            className="p-2.5 min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg"
                        >
                            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                        </button>
                    </div>
                </div>

                {/* Mobile Drawer */}
                {isMobileMenuOpen && (
                    <div className="md:hidden border-b border-slate-800 bg-slate-900/95 px-4 pt-2 pb-4 space-y-1">
                        {navItems.map((item) => {
                            const Icon = item.icon;
                            const active = isActive(item.path);
                            return (
                                <Link
                                    key={item.path}
                                    to={item.path}
                                    onClick={() => setIsMobileMenuOpen(false)}
                                    className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium ${
                                        active
                                            ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30'
                                            : 'text-slate-300 hover:bg-slate-800'
                                    }`}
                                >
                                    <Icon className="w-4 h-4" />
                                    <span>{item.label}</span>
                                </Link>
                            );
                        })}
                        <div className="pt-3 mt-3 border-t border-slate-800 flex items-center justify-between">
                            <Link to="/dashboard" className="text-xs text-indigo-400 hover:underline">
                                Switch to Recruiter View
                            </Link>
                            <button
                                onClick={handleLogout}
                                className="text-xs text-rose-400 hover:underline flex items-center gap-1"
                            >
                                <LogOut className="w-3.5 h-3.5" /> Sign Out
                            </button>
                        </div>
                    </div>
                )}
            </header>

            {/* Main Content Area */}
            <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
                <Outlet />
            </main>

            {/* Footer */}
            <footer className="border-t border-slate-800/80 bg-slate-950/40 py-6 text-center text-xs text-slate-500">
                <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
                    <p>© 2026 ThirdEye Data — PrepWin College Placement Administration</p>
                    <p className="text-slate-600">Phase 9: Placement Officer Intelligence</p>
                </div>
            </footer>
        </div>
    );
};

export default CollegeLayout;
