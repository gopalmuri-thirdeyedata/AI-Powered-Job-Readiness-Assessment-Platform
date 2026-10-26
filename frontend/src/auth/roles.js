/**
 * Role helpers for the UI. They only decide what is SHOWN: the API enforces the same hierarchy on every request.
 *   SUPER_ADMIN  creates Student, Admin and Super Admin accounts
 *   ADMIN        creates Student accounts only
 *   STUDENT      creates nothing, has no administrative access
 */
export const isAdminRole = (role) => role === 'ADMIN' || role === 'SUPER_ADMIN';
export const isSuperAdmin = (role) => role === 'SUPER_ADMIN';

export const ROLE_LABELS = { SUPER_ADMIN: 'Super Admin', ADMIN: 'Admin', STUDENT: 'Student' };

/** Roles the signed-in role may offer in the "Create account" form (mirrors the server's permission matrix). */
export const creatableRoles = (role) => (role === 'SUPER_ADMIN' ? ['STUDENT', 'ADMIN', 'SUPER_ADMIN'] : role === 'ADMIN' ? ['STUDENT'] : []);

/** Roles the signed-in role may manage (edit, activate / deactivate, replace password). */
export const manageableRoles = (role) => creatableRoles(role);
