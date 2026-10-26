import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { isAdminRole } from '../auth/roles';

/**
 * RoleReadyAuthGuard
 *
 * Enforces authentication on RoleReady assessment routes:
 * 1. Invited Candidate: authorized via invitation token in query parameter or localStorage.
 * 2. Student Self-Assessment: authorized by the server-verified STUDENT session (HttpOnly cookie).
 *
 * Administrators are sent to their own dashboard; anyone else is sent to the single login. The API enforces the same rules.
 */
export default function RoleReadyAuthGuard({ children }) {
    const location = useLocation();
    const { user, role, isLoaded } = useAuth();

    // 1. Candidate Invitation Token Authorization
    const urlParams = new URLSearchParams(location.search);
    const queryInviteToken = urlParams.get('token');
    const storedInviteToken = localStorage.getItem('invitationToken');
    const hasInvitation = !!(queryInviteToken || storedInviteToken);

    if (queryInviteToken && !storedInviteToken) {
        localStorage.setItem('invitationToken', queryInviteToken);
    }

    // Fast return if invitation token is present
    if (hasInvitation) {
        return children;
    }

    if (!isLoaded) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4 text-center text-slate-600 dark:text-slate-400">
                <div className="w-8 h-8 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mb-3" />
                <span className="text-xs font-mono">Verifying student authorization...</span>
            </div>
        );
    }

    if (user && role === 'STUDENT') {
        return children;
    }
    if (user && isAdminRole(role)) {
        return <Navigate to="/admin/dashboard" replace />;
    }
    return <Navigate to="/?auth=login" replace />;
}
