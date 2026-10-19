import React, { useEffect, useState } from 'react';
import { SignedIn, SignedOut, RedirectToSignIn, useUser, useClerk } from '@clerk/clerk-react';
import { ShieldAlert, LogOut, RefreshCw, GraduationCap, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import API_URL from '../apiConfig';

function ClerkSyncWrapper({ children }) {
    const { user, isLoaded } = useUser();
    const clerk = useClerk();
    const navigate = useNavigate();
    const [synced, setSynced] = useState(false);
    const [error, setError] = useState(null);
    const [isStudentRole, setIsStudentRole] = useState(false);

    useEffect(() => {
        if (!isLoaded || !user) return;

        const syncWithBackend = async () => {
            try {
                const emailAddress = user.primaryEmailAddress?.emailAddress;
                if (!emailAddress) {
                    throw new Error("No primary email found in Clerk user profile.");
                }

                const response = await fetch(`${API_URL}/api/auth/clerk-sync/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        email: emailAddress,
                        clerk_user_id: user.id,
                        role_intent: 'admin'
                    }),
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    const detail = errData.detail || `Access denied: Authentication failed (Status ${response.status})`;
                    setError({
                        message: detail,
                        isForbidden: response.status === 403
                    });
                    return;
                }

                const data = await response.json();
                if (data.access) {
                    localStorage.setItem('token', data.access);

                    // Fetch user profile & organization details to verify administrative role
                    try {
                        const meRes = await fetch(`${API_URL}/api/auth/me`, {
                            headers: { 'Authorization': `Bearer ${data.access}` }
                        });
                        if (meRes.ok) {
                            const profileData = await meRes.json();
                            localStorage.setItem('user_profile', JSON.stringify(profileData));

                            // Explicit Student Role Security Guard: Block student accounts from admin dashboard
                            if (profileData.role === 'STUDENT') {
                                setIsStudentRole(true);
                                return;
                            }
                        }
                    } catch (pErr) {
                        console.warn("Could not prefetch user profile:", pErr);
                    }

                    setSynced(true);
                } else {
                    throw new Error("No authorization token returned from backend sync.");
                }
            } catch (err) {
                console.error("Backend admin sync error:", err);
                setError({
                    message: err.message,
                    isForbidden: false
                });
            }
        };

        syncWithBackend();
    }, [user, isLoaded]);

    const handleSignOut = async () => {
        localStorage.removeItem('token');
        localStorage.removeItem('studentToken');
        localStorage.removeItem('user_profile');
        if (clerk && clerk.signOut) {
            await clerk.signOut();
        }
        navigate('/');
    };

    if (!isLoaded || (!synced && !error && !isStudentRole)) {
        return (
            <div className="h-screen bg-[#0a0a0a] flex flex-col items-center justify-center text-white">
                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-emerald-500 mb-4"></div>
                <p className="text-gray-400 text-sm font-semibold tracking-wide">Validating administrator credentials...</p>
            </div>
        );
    }

    // Student Attempting Admin Route: Redirect Notice with Direct Action
    if (isStudentRole) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center text-white p-6">
                <div className="bg-slate-900/90 border border-slate-800 p-5 sm:p-8 rounded-3xl w-full max-w-lg text-center shadow-2xl backdrop-blur-xl">
                    <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-center mx-auto mb-4 text-emerald-400">
                        <GraduationCap size={32} />
                    </div>
                    <span className="text-xs uppercase tracking-widest text-emerald-400 font-bold mb-1 block">PrepWin</span>
                    <h2 className="text-2xl font-bold text-white mb-2">
                        Student Account Detected
                    </h2>
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

    if (error) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center text-white p-6">
                <div className="bg-red-950/30 border border-red-500/40 p-5 sm:p-8 rounded-3xl w-full max-w-lg text-center shadow-2xl backdrop-blur-xl">
                    <div className="w-14 h-14 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center justify-center mx-auto mb-4 text-red-400">
                        <ShieldAlert size={28} />
                    </div>
                    <span className="text-xs uppercase tracking-widest text-emerald-500 font-bold mb-1 block">PrepWin</span>
                    <h2 className="text-2xl font-bold text-white mb-3 break-words">
                        {error.isForbidden ? "Administrator Access Required" : "Authentication Error"}
                    </h2>
                    <p className="text-gray-300 text-sm mb-6 leading-relaxed max-w-md mx-auto">
                        {error.isForbidden ? (
                            <>
                                Your account has not been provisioned for any PrepWin enterprise organization.
                                <br className="my-1" />
                                Please contact your organization administrator to request access.
                            </>
                        ) : error.message}
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-3">
                        {!error.isForbidden && (
                            <button 
                                onClick={() => window.location.reload()} 
                                className="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 text-white rounded-xl transition-colors text-sm font-semibold flex items-center gap-2 border border-gray-700 cursor-pointer"
                            >
                                <RefreshCw size={16} /> Retry
                            </button>
                        )}
                        <button 
                            onClick={handleSignOut} 
                            className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl transition-colors text-sm font-semibold flex items-center gap-2 shadow-lg shadow-red-900/30 cursor-pointer"
                        >
                            <LogOut size={16} /> Sign Out
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return children;
}

export default function ClerkAdminGuard({ children }) {
    return (
        <>
            <SignedIn>
                <ClerkSyncWrapper>
                    {children}
                </ClerkSyncWrapper>
            </SignedIn>
            <SignedOut>
                <RedirectToSignIn redirectUrl="/?auth=admin" />
            </SignedOut>
        </>
    );
}
