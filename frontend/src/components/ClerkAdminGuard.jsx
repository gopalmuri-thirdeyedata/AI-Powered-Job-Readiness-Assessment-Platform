import React, { useEffect, useState } from 'react';
import { useUser, useClerk } from '@clerk/clerk-react';
import { ShieldAlert, LogOut, GraduationCap, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import API_URL from '../apiConfig';

/**
 * Direct Administrator Guard:
 * Protects admin routes with proper email & password JWT authentication (no OTP required).
 * Also gracefully supports legacy Clerk sessions for backward compatibility.
 */
export default function ClerkAdminGuard({ children }) {
    const { user, isLoaded } = useUser();
    const clerk = useClerk();
    const navigate = useNavigate();
    const [status, setStatus] = useState('checking'); // 'checking', 'authorized', 'student', 'error'
    const [errorMsg, setErrorMsg] = useState(null);

    const handleSignOut = async () => {
        localStorage.removeItem('token');
        localStorage.removeItem('studentToken');
        localStorage.removeItem('user_profile');
        if (clerk && clerk.signOut) {
            try { await clerk.signOut(); } catch (e) {}
        }
        navigate('/');
    };

    useEffect(() => {
        let isMounted = true;

        const verifyAuth = async () => {
            const token = localStorage.getItem('token');

            // 1. Direct JWT token authentication (Primary admin auth - No OTP needed)
            if (token) {
                try {
                    const meRes = await fetch(`${API_URL}/api/auth/me`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });

                    if (meRes.ok) {
                        const profileData = await meRes.json();
                        localStorage.setItem('user_profile', JSON.stringify(profileData));

                        if (profileData.role === 'STUDENT') {
                            if (isMounted) setStatus('student');
                            return;
                        }

                        if (['PLATFORM_ADMIN', 'ORGANIZATION_ADMIN', 'HR'].includes(profileData.role)) {
                            if (isMounted) setStatus('authorized');
                            return;
                        }

                        if (isMounted) {
                            setErrorMsg("Administrator privileges required to access this workspace.");
                            setStatus('error');
                        }
                        return;
                    } else if (meRes.status === 401 || meRes.status === 403) {
                        localStorage.removeItem('token');
                        localStorage.removeItem('user_profile');
                    }
                } catch (err) {
                    console.warn("Direct admin token verification network error:", err);
                    if (isMounted) {
                        setErrorMsg("Unable to verify administrator session with server. Please check your connection and sign in again.");
                        setStatus('error');
                    }
                    return;
                }
            }

            // 2. Clerk session fallback (if admin logged in via Clerk)
            if (isLoaded) {
                if (user) {
                    try {
                        const emailAddress = user.primaryEmailAddress?.emailAddress;
                        const syncRes = await fetch(`${API_URL}/api/auth/clerk-sync/`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                email: emailAddress,
                                clerk_user_id: user.id,
                                role_intent: 'admin'
                            }),
                        });

                        if (syncRes.ok) {
                            const data = await syncRes.json();
                            if (data.access) {
                                localStorage.setItem('token', data.access);
                                const meRes = await fetch(`${API_URL}/api/auth/me`, {
                                    headers: { 'Authorization': `Bearer ${data.access}` }
                                });
                                if (meRes.ok) {
                                    const profileData = await meRes.json();
                                    localStorage.setItem('user_profile', JSON.stringify(profileData));
                                    if (profileData.role === 'STUDENT') {
                                        if (isMounted) setStatus('student');
                                        return;
                                    }
                                }
                                if (isMounted) setStatus('authorized');
                                return;
                            }
                        } else {
                            const errData = await syncRes.json().catch(() => ({}));
                            if (isMounted) {
                                setErrorMsg(errData.detail || "Your account has not been provisioned for the PrepWin admin workspace.");
                                setStatus('error');
                            }
                            return;
                        }
                    } catch (e) {
                        console.error("Clerk sync error:", e);
                    }
                }

                // Neither direct JWT nor Clerk session found -> redirect to home page with admin login modal
                if (isMounted) {
                    navigate('/?auth=admin', { replace: true });
                }
            }
        };

        verifyAuth();

        return () => {
            isMounted = false;
        };
    }, [user, isLoaded, navigate]);

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
