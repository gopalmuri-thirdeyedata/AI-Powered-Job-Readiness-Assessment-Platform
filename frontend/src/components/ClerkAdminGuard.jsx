import React, { useEffect, useState } from 'react';
import { SignedIn, SignedOut, RedirectToSignIn, useUser, useClerk } from '@clerk/clerk-react';
import { ShieldAlert, LogOut, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import API_URL from '../apiConfig';

function ClerkSyncWrapper({ children }) {
    const { user, isLoaded } = useUser();
    const clerk = useClerk();
    const navigate = useNavigate();
    const [synced, setSynced] = useState(false);
    const [error, setError] = useState(null);

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
                        clerk_user_id: user.id
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

                    // Fetch user profile & organization details
                    try {
                        const meRes = await fetch(`${API_URL}/api/auth/me`, {
                            headers: { 'Authorization': `Bearer ${data.access}` }
                        });
                        if (meRes.ok) {
                            const profileData = await meRes.json();
                            localStorage.setItem('user_profile', JSON.stringify(profileData));
                        }
                    } catch (pErr) {
                        console.warn("Could not prefetch user profile:", pErr);
                    }

                    setSynced(true);
                } else {
                    throw new Error("No authorization token returned from backend sync.");
                }
            } catch (err) {
                console.error("Backend sync error:", err);
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
        localStorage.removeItem('user_profile');
        await clerk.signOut();
        navigate('/');
    };

    if (!isLoaded || (!synced && !error)) {
        return (
            <div className="h-screen bg-[#0a0a0a] flex flex-col items-center justify-center text-white">
                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-green-500 mb-4"></div>
                <p className="text-gray-400 text-sm font-semibold tracking-wide">Validating organization credentials...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center text-white p-6">
                <div className="bg-red-950/30 border border-red-500/40 p-8 rounded-2xl max-w-lg text-center shadow-2xl backdrop-blur-md">
                    <div className="w-14 h-14 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center justify-center mx-auto mb-4 text-red-400">
                        <ShieldAlert size={28} />
                    </div>
                    <span className="text-xs uppercase tracking-widest text-green-500 font-bold mb-1 block">HiringAI</span>
                    <h2 className="text-2xl font-bold text-white mb-3">
                        {error.isForbidden ? "Access not granted" : "Authentication Error"}
                    </h2>
                    <p className="text-gray-300 text-sm mb-6 leading-relaxed max-w-md mx-auto">
                        {error.isForbidden ? (
                            <>
                                Your account has not been invited to any HiringAI organization.
                                <br className="my-1" />
                                Please contact your organization administrator.
                            </>
                        ) : error.message}
                    </p>
                    <div className="flex items-center justify-center gap-3">
                        {!error.isForbidden && (
                            <button 
                                onClick={() => window.location.reload()} 
                                className="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 text-white rounded-xl transition-colors text-sm font-semibold flex items-center gap-2 border border-gray-700"
                            >
                                <RefreshCw size={16} /> Retry
                            </button>
                        )}
                        <button 
                            onClick={handleSignOut} 
                            className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl transition-colors text-sm font-semibold flex items-center gap-2 shadow-lg shadow-red-900/30"
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
                <RedirectToSignIn redirectUrl="/" />
            </SignedOut>
        </>
    );
}
