import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useUser, useClerk } from '@clerk/clerk-react';
import API_URL from '../apiConfig';

/**
 * RoleReadyAuthGuard
 * 
 * Enforces authentication and authorization on RoleReady assessment routes:
 * 1. Invited Candidate: authorized via invitation token in query parameter or localStorage.
 * 2. Student Self-Assessment: authorized via authenticated Clerk student session synchronized with backend.
 * 
 * If unauthenticated, safely redirects to /?auth=student to trigger the Clerk Student Sign-In modal.
 */
export default function RoleReadyAuthGuard({ children }) {
    const location = useLocation();
    const { user, isLoaded } = useUser();
    const [isVerifying, setIsVerifying] = useState(true);
    const [isAuthorized, setIsAuthorized] = useState(false);

    // 1. Candidate Invitation Token Authorization
    const urlParams = new URLSearchParams(location.search);
    const queryInviteToken = urlParams.get('token');
    const storedInviteToken = localStorage.getItem('invitationToken');
    const hasInvitation = !!(queryInviteToken || storedInviteToken);

    if (queryInviteToken && !storedInviteToken) {
        localStorage.setItem('invitationToken', queryInviteToken);
    }

    useEffect(() => {
        // If candidate has valid invitation token, grant access immediately
        if (hasInvitation) {
            setIsAuthorized(true);
            setIsVerifying(false);
            return;
        }

        if (!isLoaded) return;

        // If active Clerk user session exists, sync student provisioning with backend
        if (user) {
            const syncStudentSession = async () => {
                try {
                    const email = user.primaryEmailAddress?.emailAddress;
                    if (!email) {
                        setIsAuthorized(false);
                        setIsVerifying(false);
                        return;
                    }

                    const response = await fetch(`${API_URL}/api/auth/clerk-sync/`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            email,
                            clerk_user_id: user.id,
                            role_intent: 'student'
                        })
                    });

                    if (response.ok) {
                        const data = await response.json();
                        if (data.access) {
                            localStorage.setItem('token', data.access);
                            localStorage.setItem('studentToken', data.access);
                            setIsAuthorized(true);
                        } else {
                            setIsAuthorized(false);
                        }
                    } else {
                        setIsAuthorized(false);
                    }
                } catch (err) {
                    console.error("Student session sync error:", err);
                    setIsAuthorized(false);
                } finally {
                    setIsVerifying(false);
                }
            };

            syncStudentSession();
            return;
        }

        // If no Clerk user, check if there is an existing valid JWT token
        const existingToken = localStorage.getItem('studentToken') || localStorage.getItem('token');
        if (existingToken) {
            fetch(`${API_URL}/api/auth/me`, {
                headers: {
                    'Authorization': `Bearer ${existingToken}`
                }
            })
            .then((res) => {
                if (res.ok) {
                    setIsAuthorized(true);
                } else {
                    localStorage.removeItem('token');
                    localStorage.removeItem('studentToken');
                    setIsAuthorized(false);
                }
            })
            .catch(() => {
                setIsAuthorized(false);
            })
            .finally(() => {
                setIsVerifying(false);
            });
        } else {
            setIsAuthorized(false);
            setIsVerifying(false);
        }
    }, [user, isLoaded, hasInvitation]);

    // Fast return if invitation token is verified
    if (hasInvitation) {
        return children;
    }

    if (!isLoaded || isVerifying) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center text-slate-600 dark:text-slate-400">
                <div className="w-8 h-8 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mb-3" />
                <span className="text-xs font-mono">Verifying student authorization...</span>
            </div>
        );
    }

    if (!isAuthorized) {
        return <Navigate to="/?auth=student" replace />;
    }

    return children;
}
