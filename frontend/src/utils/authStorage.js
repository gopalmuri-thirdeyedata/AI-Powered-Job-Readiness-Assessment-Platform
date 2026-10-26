/**
 * Read-only helpers over the in-memory, server-verified session (see ../auth/authSession.js).
 *
 * Nothing secret lives in the browser any more: the login credential is an HttpOnly cookie that page JavaScript cannot read,
 * and the only values persisted client-side are harmless UI flags (for example "this student already took an assessment").
 */
import { getAuthState } from '../auth/authSession';
import { isAdminRole } from '../auth/roles';

const COMPLETED_FLAG = 'student_completed_assessment';

/** The signed-in account when (and only when) the server says it is an ADMIN or SUPER_ADMIN. */
export const getAdminUser = () => {
    const user = getAuthState().user;
    return user && isAdminRole(user.role) ? user : null;
};

/** Organization of the signed-in admin as resolved by the server; sent as X-Organization-Id (the server re-checks membership). */
export const getAdminOrgId = () => {
    const user = getAdminUser();
    return user && user.organization_id ? String(user.organization_id) : null;
};

export const getStudentUser = () => {
    const user = getAuthState().user;
    return user && user.role === 'STUDENT' ? user : null;
};

export const getStudentEmail = () => {
    const user = getAuthState().user;
    return user?.email ? String(user.email).trim().toLowerCase() : null;
};

/** Forgets the per-student "completed an assessment" UI flags (they are scoped per e-mail). */
export const clearStudentSession = () => {
    try {
        const email = getStudentEmail();
        localStorage.removeItem(COMPLETED_FLAG);
        if (email) localStorage.removeItem(`${COMPLETED_FLAG}_${email}`);
    } catch {
        // storage unavailable
    }
};
