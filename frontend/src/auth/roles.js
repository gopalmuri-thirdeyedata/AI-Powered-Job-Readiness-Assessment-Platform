/**
 * Role helpers for the UI. They only decide what is SHOWN: the API enforces the same hierarchy on every request.
 *   SUPER_ADMIN  creates Student, Admin and Super Admin accounts
 *   ADMIN        creates Student accounts only
 *   STUDENT      creates nothing, has no administrative access
 */
export const isAdminRole = (role) => {
    const r = (role || '').toUpperCase();
    return r === 'ADMIN' || r === 'SUPER_ADMIN' || r === 'PLATFORM_ADMIN' || r === 'ORGANIZATION_ADMIN';
};

export const isSuperAdmin = (role) => {
    const r = (role || '').toUpperCase();
    return r === 'SUPER_ADMIN' || r === 'PLATFORM_ADMIN';
};

export const ROLE_LABELS = {
    SUPER_ADMIN: 'Super Admin',
    PLATFORM_ADMIN: 'Super Admin',
    ADMIN: 'Admin',
    ORGANIZATION_ADMIN: 'Admin',
    STUDENT: 'Student',
};

/** Roles the signed-in role may offer in the "Create account" form (mirrors the server's permission matrix). */
export const creatableRoles = (role) => (isSuperAdmin(role) ? ['STUDENT', 'ADMIN', 'SUPER_ADMIN'] : isAdminRole(role) ? ['STUDENT'] : []);

/** Roles the signed-in role may manage (edit, activate / deactivate, replace password). */
export const manageableRoles = (role) => creatableRoles(role);
