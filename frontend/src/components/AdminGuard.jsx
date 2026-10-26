import React, { useEffect } from 'react';
import { ShieldAlert, LogOut, GraduationCap, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { isAdminRole } from '../auth/roles';

/**
 * Admin route guard. The server-verified session decides: no session -> login, ADMIN -> children,
 * STUDENT -> explanation page, anything else -> access-required page. The API enforces the same rules independently.
 */
export default function AdminGuard({ children }) {
    const navigate = useNavigate();
    const { user, isLoaded, error, signOut } = useAuth();

    const status = !isLoaded ? 'checking'
        : error === 'network' && !user ? 'error'
        : !user ? 'anonymous'
        : isAdminRole(user.role) ? 'authorized'
        : user.role === 'STUDENT' ? 'student'
        : 'error';
    const errorMsg = error === 'network'
        ? 'Unable to verify your session with the server. Please check your connection and sign in again.'
        : 'Administrator privileges required to access this workspace.';

    const handleSignOut = async () => {
        await signOut();
        navigate('/?auth=login', { replace: true });
    };

    useEffect(() => {
        if (status === 'anonymous') navigate('/?auth=login', { replace: true });
    }, [status, navigate]);

    if (status === 'anonymous') return null;

    if (status === 'checking') {
        return (
            <div className="h-screen bg-[#0a0a0a] flex flex-col items-center justify-center text-white">
                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-emerald-500 mb-4"></div>
                <p className="text-gray-400 text-sm font-semibold tracking-wide">Validating administrator credentials...</p>
            </div>
        );
    }

    if (status === 'student') {
        return (
            <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center text-white p-6">
                <div className="bg-slate-900/90 border border-slate-800 p-5 sm:p-8 rounded-3xl w-full max-w-lg text-center shadow-2xl backdrop-blur-xl">
                    <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-center mx-auto mb-4 text-emerald-400">
                        <GraduationCap size={32} />
                    </div>
                    <span className="text-xs uppercase tracking-widest text-emerald-400 font-bold mb-1 block">PrepWin</span>
                    <h2 className="text-2xl font-bold text-white mb-2">Student Account Detected</h2>
                    <p className="text-gray-300 text-sm mb-6 leading-relaxed max-w-md mx-auto">
                        You are currently signed in with a Student account. The Recruiter Workspace is restricted to authorized hiring team members.
                    </p>
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                        <button 
                            type="button"
                            onClick={() => navigate('/assessment/setup')} 
                            className="w-full sm:w-auto px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-all text-sm font-semibold flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/30 cursor-pointer"
                        >
                            <span>Go to Assessment Setup</span>
                            <ArrowRight size={16} />
                        </button>
                        <button 
                            type="button"
                            onClick={handleSignOut} 
                            className="w-full sm:w-auto px-5 py-3 bg-slate-800 hover:bg-slate-700 text-gray-300 hover:text-white rounded-xl transition-colors text-sm font-semibold flex items-center justify-center gap-2 border border-slate-700 cursor-pointer"
                        >
                            <LogOut size={16} />
                            <span>Sign Out</span>
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (status === 'error') {
        return (
            <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center text-white p-6">
                <div className="bg-red-950/30 border border-red-500/40 p-5 sm:p-8 rounded-3xl w-full max-w-lg text-center shadow-2xl backdrop-blur-xl">
                    <div className="w-14 h-14 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center justify-center mx-auto mb-4 text-red-400">
                        <ShieldAlert size={28} />
                    </div>
                    <span className="text-xs uppercase tracking-widest text-emerald-500 font-bold mb-1 block">PrepWin</span>
                    <h2 className="text-2xl font-bold text-white mb-3">Administrator Access Required</h2>
                    <p className="text-gray-300 text-sm mb-6 leading-relaxed max-w-md mx-auto">
                        {errorMsg || "Your account has not been provisioned for the PrepWin enterprise workspace. Please sign in with an authorized administrator account."}
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-3">
                        <button 
                            onClick={handleSignOut} 
                            className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl transition-colors text-sm font-semibold flex items-center gap-2 shadow-lg shadow-red-900/30 cursor-pointer"
                        >
                            <LogOut size={16} /> Sign In as Administrator
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return children;
}
