import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, Lock, Unlock, Mail, Pencil, Power, Search, ShieldCheck, GraduationCap, UserPlus, Users, X } from 'lucide-react';
import WorkspacePage from '../../components/admin/WorkspacePage';
import ConfirmationModal from '../../components/ConfirmationModal';
import { Badge, EmptyState, ErrorBanner, LoadingRow, PanelIntro, Toast, cardCls, dangerGhostBtn, formatDate, ghostBtn, hintCls, inputCls, labelCls, primaryBtn, tableWrapCls, tbodyCls, tdCls, theadCls, thCls, trCls } from '../../components/admin/adminUi';
import { apiError, passwordProblems, shareFailureCode, userManagementApi } from '../../services/userManagementApi';
import { useAuth } from '../../auth/useAuth';
import { ROLE_LABELS, creatableRoles, manageableRoles, isAdminRole } from '../../auth/roles';

const PAGE_SIZE = 25;

const RoleBadge = ({ role }) => (
    <Badge tone={role === 'SUPER_ADMIN' ? 'warning' : role === 'ADMIN' ? 'violet' : 'brand'} icon={role === 'STUDENT' ? GraduationCap : ShieldCheck}>
        {ROLE_LABELS[role] || role}
    </Badge>
);

const ActiveBadge = ({ active }) => (
    <Badge tone={active ? 'brand' : 'danger'} dot>{active ? 'Active' : 'Deactivated'}</Badge>
);

const AccessBadge = ({ granted }) => (
    <Badge tone={granted ? 'brand' : 'warning'} icon={granted ? Unlock : Lock}>{granted ? 'Access Granted' : 'Access Locked'}</Badge>
);

/** Modal frame shared by the create / details / reset dialogs: fixed header, scrolling body, Escape closes. */
const Dialog = ({ title, onClose, children, wide = false }) => {
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
            <div className={`relative z-10 w-full ${wide ? 'max-w-xl' : 'max-w-md'} max-h-[calc(100vh-2rem)] flex flex-col ${cardCls} shadow-[0_24px_48px_-12px_rgba(15,23,42,0.35)]`}>
                <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/30 rounded-t-xl shrink-0">
                    <h2 className="pw-section-title">{title}</h2>
                    <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"><X size={16} /></button>
                </div>
                <div className="px-5 sm:px-6 py-5 overflow-y-auto">
                    {children}
                </div>
            </div>
        </div>
    );
};

const Field = ({ label, hint, children, htmlFor }) => (
    <div>
        <label htmlFor={htmlFor} className={labelCls}>{label}</label>
        {children}
        {hint && <p className={hintCls}>{hint}</p>}
    </div>
);

/** Password input with a visibility toggle. The value only ever lives in this component's state while the dialog is open. */
const PasswordField = ({ id, value, onChange, autoComplete = 'new-password' }) => {
    const [shown, setShown] = useState(false);
    return (
        <div className="relative">
            <input id={id} type={shown ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} pr-10`} />
            <button type="button" tabIndex={-1} onClick={() => setShown((v) => !v)} aria-label="Toggle password visibility"
                className="absolute inset-y-0 right-0 px-3 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-r-lg cursor-pointer">
                {shown ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
        </div>
    );
};

const FormError = ({ children }) => children ? (
    <div role="alert" className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 px-3 py-2.5 text-[13px] font-medium leading-5">{children}</div>
) : null;

/* ─────────────────────────── Create user ─────────────────────────── */
const CreateUserDialog = ({ onClose, onCreated, allowedRoles }) => {
    const [form, setForm] = useState({ role: 'STUDENT', fullName: '', email: '', password: '', phone: '' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

    const submit = async (e) => {
        e.preventDefault();
        setError('');
        if (!form.fullName.trim()) return setError('Name is required.');
        if (!form.email.trim()) return setError('Email is required.');
        const problems = passwordProblems(form.password, form.email);
        if (!form.password) return setError('Password is required.');
        if (problems.length) return setError(`Password needs ${problems.join(', ')}.`);
        setBusy(true);
        try {
            const res = await userManagementApi.create({ ...form, fullName: form.fullName.trim(), email: form.email.trim(), phone: form.phone.trim() });
            setForm({ role: 'STUDENT', fullName: '', email: '', password: '', phone: '' }); // the password is never kept or shown again
            onCreated(res);
        } catch (err) {
            setError(apiError(err, 'Could not create the account.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog title="Create account" onClose={onClose}>
            <form onSubmit={submit} className="space-y-4" noValidate>
                <Field label="Role">
                    <div className={`grid gap-2 ${allowedRoles.length > 2 ? 'grid-cols-3' : allowedRoles.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`} role="radiogroup" aria-label="Role">
                        {[['STUDENT', 'Student', GraduationCap], ['ADMIN', 'Admin', ShieldCheck], ['SUPER_ADMIN', 'Super Admin', ShieldCheck]].filter(([value]) => allowedRoles.includes(value)).map(([value, label, Icon]) => (
                            <button key={value} type="button" role="radio" aria-checked={form.role === value} onClick={() => set('role')(value)}
                                className={`flex items-center justify-center gap-2 rounded-lg border min-h-[40px] px-3 py-2 text-sm font-semibold transition-colors cursor-pointer ${form.role === value
                                    ? 'border-[#5d8c2c] bg-[#5d8c2c]/10 text-[#4c7324] ring-1 ring-[#5d8c2c]/30 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-300'
                                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                                <Icon size={15} />{label}
                            </button>
                        ))}
                    </div>
                </Field>
                <Field label="Name" htmlFor="um-name"><input id="um-name" className={inputCls} value={form.fullName} onChange={(e) => set('fullName')(e.target.value)} maxLength={150} autoComplete="off" /></Field>
                <Field label="Email" htmlFor="um-email"><input id="um-email" type="email" className={inputCls} value={form.email} onChange={(e) => set('email')(e.target.value)} maxLength={150} autoComplete="off" /></Field>
                <Field label="Password" htmlFor="um-password" hint="At least 10 characters with an uppercase letter, a lowercase letter and a digit. It is shown only while you type it.">
                    <PasswordField id="um-password" value={form.password} onChange={set('password')} />
                </Field>
                <Field label="Mobile number (optional)" htmlFor="um-phone"><input id="um-phone" type="tel" className={inputCls} value={form.phone} onChange={(e) => set('phone')(e.target.value)} maxLength={50} autoComplete="off" placeholder="+91 98765 43210" /></Field>
                <FormError>{error}</FormError>
                <div className="flex justify-end gap-2 pt-2">
                    <button type="button" className={ghostBtn} onClick={onClose} disabled={busy}>Cancel</button>
                    <button type="submit" className={primaryBtn} disabled={busy}>{busy ? <><Loader2 size={14} className="animate-spin" /> Creating...</> : <><UserPlus size={14} /> Create {(ROLE_LABELS[form.role] || '').toLowerCase()}</>}</button>
                </div>
            </form>
        </Dialog>
    );
};

/* ─────────────────────────── Reset password ─────────────────────────── */
const ResetPasswordDialog = ({ user, onClose, onDone }) => {
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const submit = async (e) => {
        e.preventDefault();
        setError('');
        const problems = passwordProblems(password, user.email);
        if (problems.length) return setError(`Password needs ${problems.join(', ')}.`);
        setBusy(true);
        try {
            const res = await userManagementApi.resetPassword(user.id, password);
            setPassword('');
            onDone(res.message);
        } catch (err) {
            setError(apiError(err, 'Could not replace the password.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog title="Replace password" onClose={onClose}>
            <form onSubmit={submit} className="space-y-4" noValidate>
                <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">Set a new password for <span className="font-bold text-slate-900 dark:text-white">{user.email}</span>. Their current sessions are signed out. Share the new password with them through a secure channel.</p>
                <Field label="New password" htmlFor="um-reset-password"><PasswordField id="um-reset-password" value={password} onChange={setPassword} /></Field>
                <FormError>{error}</FormError>
                <div className="flex justify-end gap-2 pt-2">
                    <button type="button" className={ghostBtn} onClick={onClose} disabled={busy}>Cancel</button>
                    <button type="submit" className={primaryBtn} disabled={busy}>{busy ? <><Loader2 size={14} className="animate-spin" /> Saving...</> : <><KeyRound size={14} /> Replace password</>}</button>
                </div>
            </form>
        </Dialog>
    );
};

/* ─────────────────────────── Details / edit ─────────────────────────── */
const DetailsDialog = ({ userId, onClose, onChanged, onResetPassword, onToggleActive, onToggleAssessmentAccess, isSelf, canManage, manageable }) => {
    const [user, setUser] = useState(null);
    const [error, setError] = useState('');
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState({ fullName: '', phone: '' });
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let alive = true;
        userManagementApi.get(userId).then((u) => { if (alive) { setUser(u); setForm({ fullName: u.full_name || '', phone: u.phone || '' }); } })
            .catch((err) => { if (alive) setError(apiError(err, 'Unable to load this user.')); });
        return () => { alive = false; };
    }, [userId]);

    const save = async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            const updated = await userManagementApi.update(userId, { fullName: form.fullName, phone: form.phone.trim() });
            setUser(updated);
            setEditing(false);
            onChanged('Profile updated.');
        } catch (err) {
            setError(apiError(err, 'Could not save the changes.'));
        } finally {
            setBusy(false);
        }
    };

    const row = (label, value) => (
        <div className="flex items-center justify-between gap-4 py-2.5 border-b border-slate-100 dark:border-slate-800 last:border-0 text-sm">
            <dt className="text-slate-500 dark:text-slate-400 font-medium">{label}</dt>
            <dd className="text-slate-900 dark:text-slate-100 font-medium text-right break-all">{value || '—'}</dd>
        </div>
    );

    return (
        <Dialog title="User details" onClose={onClose} wide>
            {!user && !error && <LoadingRow />}
            {error && !user && <ErrorBanner>{error}</ErrorBanner>}
            {user && !editing && (
                <>
                    <dl>
                        {row('Name', user.full_name)}
                        {row('Email', user.email)}
                        {row('Role', <RoleBadge role={user.role} />)}
                        {row('Status', <ActiveBadge active={user.is_active} />)}
                        {user.role === 'STUDENT' && row('Assessment access', <AccessBadge granted={Boolean(user.assessment_access_granted)} />)}
                        {row('Mobile number', user.phone)}
                        {row('Organization', user.organization_name)}
                        {row('Created', formatDate(user.created_at))}
                        {row('Last sign-in', formatDate(user.last_login_at))}
                        {row('Active sessions', String(user.active_sessions ?? 0))}
                        {user.student_profile && row('College', user.student_profile.college_name)}
                        {user.student_profile && row('Target role', user.student_profile.target_role)}
                        {user.student_profile && row('Onboarded', user.student_profile.is_onboarded ? 'Yes' : 'No')}
                    </dl>
                    <div className="flex flex-wrap justify-end gap-2 mt-5 pt-4 border-t border-slate-100 dark:border-slate-800">
                        {canManage && user.role === 'STUDENT' && (
                            <button
                                type="button"
                                className={ghostBtn}
                                onClick={() => onToggleAssessmentAccess && onToggleAssessmentAccess(user)}
                                id={`details-assessment-access-btn-${user.id}`}
                                aria-label={`${user.assessment_access_granted ? 'Revoke' : 'Grant'} assessment access for ${user.email}`}
                            >
                                {user.assessment_access_granted ? <Lock size={14} /> : <Unlock size={14} />}
                                <span>{user.assessment_access_granted ? 'Revoke assessment access' : 'Grant assessment access'}</span>
                            </button>
                        )}
                        {manageable.includes(user.role) && <button type="button" className={ghostBtn} onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>}
                        {canManage && <button type="button" className={ghostBtn} onClick={() => onResetPassword(user)}><KeyRound size={14} /> Replace password</button>}
                        {canManage && <button type="button" className={user.is_active ? dangerGhostBtn : ghostBtn} onClick={() => onToggleActive(user)}><Power size={14} /> {user.is_active ? 'Deactivate' : 'Activate'}</button>}
                    </div>
                </>
            )}
            {user && editing && (
                <form onSubmit={save} className="space-y-4" noValidate>
                    <Field label="Name" htmlFor="um-edit-name"><input id="um-edit-name" className={inputCls} value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} maxLength={150} /></Field>
                    <Field label="Mobile number (optional)" htmlFor="um-edit-phone"><input id="um-edit-phone" type="tel" className={inputCls} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} maxLength={50} /></Field>
                    <p className={hintCls}>Email, role and organization cannot be changed here.</p>
                    <FormError>{error}</FormError>
                    <div className="flex justify-end gap-2">
                        <button type="button" className={ghostBtn} onClick={() => { setEditing(false); setError(''); }} disabled={busy}>Cancel</button>
                        <button type="submit" className={primaryBtn} disabled={busy}>{busy ? <><Loader2 size={14} className="animate-spin" /> Saving...</> : 'Save changes'}</button>
                    </div>
                </form>
            )}
        </Dialog>
    );
};

/* ─────────────────────────── Bulk results ─────────────────────────── */
const BulkResultsDialog = ({ data, onClose }) => {
    return (
        <Dialog title="Credential Sharing Results" onClose={onClose} wide>
            <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 text-center">
                        <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Selected</div>
                        <div className="text-xl font-semibold text-slate-800 dark:text-white mt-0.5">{data.total}</div>
                    </div>
                    <div className="p-3 rounded-lg bg-[#5d8c2c]/10 border border-[#5d8c2c]/30 text-center">
                        <div className="text-xs font-medium text-[#4c7324] dark:text-[#9fd05a]">Sent</div>
                        <div className="text-xl font-semibold text-[#4c7324] dark:text-[#9fd05a] mt-0.5">{data.sent}</div>
                    </div>
                    <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-center">
                        <div className="text-xs font-medium text-red-600 dark:text-red-400">Failed</div>
                        <div className="text-xl font-semibold text-red-600 dark:text-red-400 mt-0.5">{data.failed}</div>
                    </div>
                    <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-center">
                        <div className="text-xs font-medium text-amber-700 dark:text-amber-400">Skipped</div>
                        <div className="text-xl font-semibold text-amber-700 dark:text-amber-400 mt-0.5">{data.skipped}</div>
                    </div>
                </div>

                <div className="text-[13px] leading-5 text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40 px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
                    <span className="font-semibold">Note:</span> Sent indicates the mail server accepted the message; delivery to the inbox is not guaranteed. Retained credentials for successful recipients were deleted.
                </div>

                <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800/70">
                    {(data.results || []).map((r, idx) => {
                        const isSent = r.status === 'sent';
                        const isFailed = r.status === 'failed';
                        const badgeCls = isSent
                            ? 'bg-[#5d8c2c]/15 text-[#4c7324] border-[#5d8c2c]/30 dark:bg-emerald-950/40 dark:text-[#9fd05a] dark:border-emerald-800/60'
                            : isFailed
                            ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900'
                            : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900';
                        return (
                            <div key={r.id || idx} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 text-xs">
                                <div className="min-w-0">
                                    <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{r.name || 'Student'}</div>
                                    <div className="text-slate-500 dark:text-slate-400 text-[11px] truncate">{r.email || (r.id ? `User ID ${r.id}` : '—')}</div>
                                </div>
                                <div className="flex sm:flex-col sm:items-end gap-1 shrink-0">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide border uppercase ${badgeCls}`}>
                                        {r.status}
                                    </span>
                                    <span className="text-[11px] text-slate-500 dark:text-slate-400 max-w-xs text-right truncate" title={r.message}>
                                        {r.message}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="flex justify-end pt-2">
                    <button type="button" className={primaryBtn} onClick={onClose}>
                        Close
                    </button>
                </div>
            </div>
        </Dialog>
    );
};

/** True below the lg breakpoint: the user list switches from a table to one card per user (no sideways scrolling). */
const useIsNarrow = () => {
    const query = '(max-width: 1023px)';
    const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches);
    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return undefined;
        const mq = window.matchMedia(query);
        const onChange = (e) => setNarrow(e.matches);
        setNarrow(mq.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);
    return narrow;
};

/** Assessment access badge and its Lock / Unlock switch (students only). */
const AssessmentAccess = ({ u, canManage, accessBusyId, setAccessConfirm }) => (
    u.role === 'STUDENT' ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <AccessBadge granted={Boolean(u.assessment_access_granted)} />
            {canManage && u.role === 'STUDENT' && (
                <button type="button" onClick={() => setAccessConfirm(u)}
                    disabled={accessBusyId !== null}
                    id={`assessment-access-btn-${u.id}`}
                    aria-busy={accessBusyId === u.id}
                    aria-label={`${u.assessment_access_granted ? 'Lock' : 'Unlock'} assessment access for ${u.email}`}
                    title={u.assessment_access_granted ? 'Lock access to assessments' : 'Unlock access to assessments'}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5d8c2c]/50 ${
                        u.assessment_access_granted
                            ? 'border-amber-300/80 bg-amber-50/90 text-amber-800 hover:bg-amber-100 hover:border-amber-400 dark:border-amber-800/80 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/50'
                            : 'border-[#5d8c2c]/40 bg-[#5d8c2c]/10 text-[#4c7324] hover:bg-[#5d8c2c]/20 hover:border-[#5d8c2c]/60 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/50'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                    {accessBusyId === u.id ? <Loader2 size={12} className="animate-spin" /> : u.assessment_access_granted ? <Lock size={12} /> : <Unlock size={12} />}
                    <span>{u.assessment_access_granted ? 'Lock' : 'Unlock'}</span>
                </button>
            )}
        </div>
    ) : (
        <span className="text-slate-400 dark:text-slate-500 font-medium">—</span>
    )
);

/** View / Share / Replace password / Deactivate for one user (the same four actions in the table and in the cards). */
const RowActions = ({ u, isSelf, canManage, sharingId, setDialog, shareCredentials, setConfirm, compact = false }) => (
    <div className={`flex items-center gap-1.5 ${compact ? 'flex-nowrap justify-end [&_button]:min-h-[32px] [&_button]:px-2.5 [&_button]:py-1 [&_button]:text-[13px]' : 'flex-wrap'}`}>
        <button
            type="button"
            className={ghostBtn}
            onClick={() => setDialog({ type: 'details', userId: u.id, isSelf, canManage })}
            aria-label={`View ${u.email}`}
            title="View user details"
        >
            <Eye size={14} />
            <span>View</span>
        </button>
        {canManage && u.role === 'STUDENT' && (
            <button
                type="button"
                className={ghostBtn}
                onClick={() => shareCredentials(u)}
                disabled={sharingId !== null || !u.is_active}
                aria-label={`Share login credentials with ${u.email}`}
                aria-busy={sharingId === u.id}
                title={!u.is_active ? 'Activate this account to share its credentials' : u.credentials_ready ? "E-mail this student's login details" : 'Set a new password with Replace password first'}
            >
                {sharingId === u.id ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                <span>{sharingId === u.id ? 'Sending...' : 'Share'}</span>
            </button>
        )}
        {canManage && (
            <button
                type="button"
                className={ghostBtn}
                onClick={() => setDialog({ type: 'reset', user: u })}
                aria-label={`Replace password for ${u.email}`}
                title="Replace password"
            >
                <KeyRound size={14} />
            </button>
        )}
        {canManage && (
            <button
                type="button"
                className={u.is_active ? dangerGhostBtn : ghostBtn}
                onClick={() => setConfirm(u)}
                aria-label={`${u.is_active ? 'Deactivate' : 'Activate'} ${u.email}`}
                title={u.is_active ? 'Deactivate account' : 'Activate account'}
            >
                <Power size={14} />
            </button>
        )}
    </div>
);

const Avatar = ({ u }) => (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-100 to-slate-200/70 dark:from-slate-800 dark:to-slate-700/60 ring-1 ring-slate-200 dark:ring-slate-700 text-[13px] font-semibold uppercase text-slate-600 dark:text-slate-300" aria-hidden="true">{(u.full_name || u.email || '?').charAt(0)}</span>
);

const SelfTag = () => <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">(you)</span>;

/* ─────────────────────────── Page ─────────────────────────── */
const UserManagementPage = () => {
    const { user: me } = useAuth();
    const narrow = useIsNarrow();
    const [filters, setFilters] = useState({ q: '', role: '', status: '' });
    const [debouncedQ, setDebouncedQ] = useState('');
    const [page, setPage] = useState(1);
    const [data, setData] = useState({ items: [], total: 0 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [toast, setToast] = useState(null);
    const [dialog, setDialog] = useState(null); // { type: 'create' | 'details' | 'reset', ... }
    const [confirm, setConfirm] = useState(null); // user to (de)activate
    const [accessConfirm, setAccessConfirm] = useState(null); // student whose assessment access is being granted / revoked
    const [accessBusyId, setAccessBusyId] = useState(null);
    const accessRef = useRef(false);
    const [sharingId, setSharingId] = useState(null); // student whose credentials e-mail is being sent
    const [needsReplace, setNeedsReplace] = useState(null); // student whose password is no longer available to share
    const [selectedIds, setSelectedIds] = useState([]);
    const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
    const [bulkReplaceConfirmOpen, setBulkReplaceConfirmOpen] = useState(false);
    const [bulkSending, setBulkSending] = useState(false);
    const [bulkResults, setBulkResults] = useState(null);
    const sharingRef = useRef(false);
    const bulkRef = useRef(false);
    const timer = useRef(null);

    useEffect(() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => { setDebouncedQ(filters.q); setPage(1); }, 300);
        return () => clearTimeout(timer.current);
    }, [filters.q]);

    useEffect(() => {
        setSelectedIds([]);
    }, [debouncedQ, filters.role, filters.status, page]);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setData(await userManagementApi.list({
                q: debouncedQ, role: filters.role, isActive: filters.status === '' ? undefined : filters.status === 'active', page, pageSize: PAGE_SIZE,
            }));
        } catch (err) {
            setError(apiError(err, 'Unable to load users.'));
        } finally {
            setLoading(false);
        }
    }, [debouncedQ, filters.role, filters.status, page]);

    useEffect(() => { load(); }, [load]);

    const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
    const say = (message, type) => setToast({ message, type });

    const toggleActive = async () => {
        const target = confirm;
        setConfirm(null);
        try {
            const res = target.is_active ? await userManagementApi.deactivate(target.id) : await userManagementApi.activate(target.id);
            say(res.message);
            setDialog(null);
            load();
        } catch (err) {
            say(apiError(err, 'Could not change the account status.'), 'error');
        }
    };

    // Assessment Access: flips ONE student's switch after confirmation. The server re-checks the role hierarchy and the organization.
    const changeAssessmentAccess = async () => {
        const target = accessConfirm;
        setAccessConfirm(null);
        if (!target || accessRef.current) return;
        accessRef.current = true;
        setAccessBusyId(target.id);
        try {
            const nextGranted = !target.assessment_access_granted;
            const res = await userManagementApi.setAssessmentAccess(target.id, nextGranted);
            say(res.message);
            setData((prev) => ({
                ...prev,
                items: prev.items.map((item) =>
                    item.id === target.id ? { ...item, assessment_access_granted: nextGranted } : item
                ),
            }));
        } catch (err) {
            say(apiError(err, 'Could not change the assessment access.'), 'error');
        } finally {
            accessRef.current = false;
            setAccessBusyId(null);
            load();
        }
    };

    const displayedEligible = data.items.filter((u) => {
        const isSelf = me && Number(me.user_id) === u.id;
        return !isSelf && manageableRoles(me?.role).includes(u.role) && u.role === 'STUDENT';
    });
    const allSelected = displayedEligible.length > 0 && displayedEligible.every((u) => selectedIds.includes(u.id));
    const someSelected = displayedEligible.some((u) => selectedIds.includes(u.id));

    const toggleSelectAll = () => {
        if (allSelected) {
            const eligibleIdSet = new Set(displayedEligible.map((u) => u.id));
            setSelectedIds((prev) => prev.filter((id) => !eligibleIdSet.has(id)));
        } else {
            const toAdd = displayedEligible.map((u) => u.id);
            setSelectedIds((prev) => Array.from(new Set([...prev, ...toAdd])));
        }
    };

    const toggleSelectOne = (id) => {
        setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
    };

    const handleBulkShare = async () => {
        if (bulkRef.current || selectedIds.length === 0) return;
        bulkRef.current = true;
        setBulkConfirmOpen(false);
        setBulkSending(true);
        try {
            const res = await userManagementApi.bulkShareCredentials(selectedIds);
            setBulkResults(res);
        } catch (err) {
            say(apiError(err, 'The credentials could not be sent. Please try again.'), 'error');
        } finally {
            bulkRef.current = false;
            setBulkSending(false);
            load();
        }
    };

    const handleBulkReplaceAndShare = async () => {
        if (bulkRef.current || selectedIds.length === 0) return;
        bulkRef.current = true;
        setBulkReplaceConfirmOpen(false);
        setBulkSending(true);
        try {
            const res = await userManagementApi.replacePasswordsAndShare(selectedIds);
            setBulkResults(res);
        } catch (err) {
            say(apiError(err, 'Could not replace passwords and send credentials. Please try again.'), 'error');
        } finally {
            bulkRef.current = false;
            setBulkSending(false);
            load();
        }
    };

    const closeBulkResults = () => {
        setBulkResults(null);
        setSelectedIds([]);
        load();
    };

    // Share: the server e-mails the student's login e-mail + the password assigned at creation / Replace password. The password is
    // never in this page; if it is no longer available the admin is sent to Replace password first (Share never changes a password).
    const shareCredentials = async (target) => {
        if (sharingRef.current) return;                      // one send at a time: a double click cannot send twice
        sharingRef.current = true;
        setSharingId(target.id);
        try {
            const res = await userManagementApi.shareCredentials(target.id);
            say(res.message);
        } catch (err) {
            if (shareFailureCode(err) === 'PASSWORD_NOT_AVAILABLE') setNeedsReplace(target);
            else say(apiError(err, 'The credentials could not be sent. Please try again.'), 'error');
        } finally {
            sharingRef.current = false;
            setSharingId(null);
            load();
        }
    };

    return (
        <WorkspacePage title="User Management" description="Create and manage the Student and Admin accounts that can sign in to PrepWin. There is no public sign-up: every account starts here.">
            <div className="space-y-5">
                <PanelIntro onRefresh={load} loading={loading}>Passwords are stored securely and are never shown again after an account is created. Use Replace password to give someone a new one. Share e-mails a student their login details right after you create the account or replace the password.</PanelIntro>

                <div className={`${cardCls} p-3 sm:p-4 flex flex-col lg:flex-row gap-3 lg:items-center`}>
                    <div className="relative flex-1 min-w-0">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" aria-hidden="true" />
                        <input aria-label="Search by name or email" placeholder="Search by name or email" className={`${inputCls} pl-9`} value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
                    </div>
                    <select aria-label="Filter by role" className={`${inputCls} lg:w-40`} value={filters.role} onChange={(e) => { setFilters((f) => ({ ...f, role: e.target.value })); setPage(1); }}>
                        <option value="">All roles</option><option value="STUDENT">Students</option><option value="ADMIN">Admins</option><option value="SUPER_ADMIN">Super Admins</option>
                    </select>
                    <select aria-label="Filter by status" className={`${inputCls} lg:w-40`} value={filters.status} onChange={(e) => { setFilters((f) => ({ ...f, status: e.target.value })); setPage(1); }}>
                        <option value="">Any status</option><option value="active">Active</option><option value="inactive">Deactivated</option>
                    </select>
                    <button
                        type="button"
                        id="bulk-share-header-btn"
                        className={selectedIds.length > 0 ? primaryBtn : ghostBtn}
                        disabled={selectedIds.length === 0 || bulkSending}
                        onClick={() => setBulkConfirmOpen(true)}
                        title={selectedIds.length === 0 ? 'Select at least one eligible student to share credentials' : 'Share credentials with selected students'}
                    >
                        {bulkSending ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}
                        <span>Share Credentials{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}</span>
                    </button>
                    <button type="button" className={primaryBtn} onClick={() => setDialog({ type: 'create' })}><UserPlus size={15} /> Create account</button>
                </div>

                {selectedIds.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl bg-[#5d8c2c]/10 dark:bg-emerald-950/30 border border-[#5d8c2c]/30 dark:border-emerald-800/50 text-slate-800 dark:text-slate-100">
                        <div className="flex items-center gap-2">
                            <span className="inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-[#5d8c2c] dark:bg-emerald-600 text-white text-xs font-semibold">
                                {selectedIds.length}
                            </span>
                            <span className="text-sm font-semibold">
                                {selectedIds.length} {selectedIds.length === 1 ? 'student' : 'students'} selected
                            </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <button type="button" className={ghostBtn} onClick={() => setSelectedIds([])}>
                                Clear selection
                            </button>
                            <button
                                type="button"
                                id="bulk-share-credentials-btn"
                                className={ghostBtn}
                                disabled={bulkSending}
                                onClick={() => setBulkConfirmOpen(true)}
                                title="Share credentials using existing retained passwords (skips accounts without retained passwords)"
                            >
                                {bulkSending ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}
                                <span>Share Credentials</span>
                            </button>
                            <button
                                type="button"
                                id="bulk-replace-and-share-btn"
                                className={primaryBtn}
                                disabled={bulkSending}
                                onClick={() => setBulkReplaceConfirmOpen(true)}
                                title="Generate new secure passwords and email them to selected students"
                            >
                                {bulkSending ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
                                <span>Replace Passwords & Share</span>
                            </button>
                        </div>
                    </div>
                )}

                {error && <ErrorBanner onRetry={load}>{error}</ErrorBanner>}

                {loading && data.items.length === 0 ? <LoadingRow>Loading users...</LoadingRow> : data.items.length === 0 && !error ? (
                    <EmptyState icon={Users} title={debouncedQ || filters.role || filters.status ? 'No users match these filters' : 'No users yet'}
                        action={<button type="button" className={primaryBtn} onClick={() => setDialog({ type: 'create' })}><UserPlus size={14} /> Create account</button>}>
                        {debouncedQ || filters.role || filters.status ? 'Try a different search or clear the filters.' : 'Create the first Student or Admin account.'}
                    </EmptyState>
                ) : (
                    narrow ? (
                        <div className="space-y-3">
                        {displayedEligible.length > 0 && (
                            <label className="flex items-center gap-2.5 px-1 text-[13px] font-medium text-slate-600 dark:text-slate-300 cursor-pointer w-fit">
                                <input
                                    type="checkbox"
                                    id="select-all-students"
                                    aria-label="Select all eligible students on this page"
                                    checked={allSelected}
                                    ref={(el) => { if (el) el.indeterminate = !allSelected && someSelected; }}
                                    onChange={toggleSelectAll}
                                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 cursor-pointer"
                                />
                                Select all students on this page
                            </label>
                        )}
                        <ul className={`grid gap-3 grid-cols-[minmax(0,1fr)] min-[1000px]:grid-cols-[repeat(2,minmax(0,1fr))] ${loading ? 'opacity-70' : ''} transition-opacity`} aria-label="Users" aria-busy={loading}>
                            {data.items.map((u) => {
                                const isSelf = me && (Number(me.user_id) === u.id || Number(me.id) === u.id);
                                const canManage = !isSelf && (
                                    !me?.role ||
                                    manageableRoles(me?.role).includes(u.role) ||
                                    isAdminRole(me?.role)
                                );
                                const isEligibleStudent = canManage && u.role === 'STUDENT';
                                return (
                                    <li key={u.id} className={`${cardCls} p-4 space-y-3`}>
                                        <div className="flex items-start gap-3">
                                            {isEligibleStudent && (
                                                <input
                                                    type="checkbox"
                                                    id={`select-user-${u.id}`}
                                                    aria-label={`Select ${u.email}`}
                                                    checked={selectedIds.includes(u.id)}
                                                    onChange={() => toggleSelectOne(u.id)}
                                                    className="mt-2 w-4 h-4 rounded border-slate-300 dark:border-slate-600 cursor-pointer"
                                                />
                                            )}
                                            <Avatar u={u} />
                                            <div className="min-w-0 flex-1">
                                                <p className="font-medium text-slate-900 dark:text-slate-100 break-words">{u.full_name || '—'}{isSelf && <SelfTag />}</p>
                                                <p className="text-[13px] leading-5 text-slate-500 dark:text-slate-400 truncate" title={u.email}>{u.email}</p>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <RoleBadge role={u.role} />
                                            <ActiveBadge active={u.is_active} />
                                        </div>
                                        {u.role === 'STUDENT' && <AssessmentAccess u={u} canManage={canManage} accessBusyId={accessBusyId} setAccessConfirm={setAccessConfirm} />}
                                        <p className="text-xs text-slate-500 dark:text-slate-400">Last sign-in: {formatDate(u.last_login_at)}</p>
                                        <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                                            <RowActions u={u} isSelf={isSelf} canManage={canManage} sharingId={sharingId} setDialog={setDialog} shareCredentials={shareCredentials} setConfirm={setConfirm} />
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                        </div>
                    ) : (
                    <div className={`${tableWrapCls} ${loading ? 'opacity-70' : ''} transition-opacity`} aria-busy={loading}>
                        <div className="pw-scroll-x">
                            <table className="w-full text-sm text-left border-collapse min-w-[1000px]">
                                <thead className={theadCls}>
                                    <tr className="select-none">
                                        <th scope="col" className="w-[44px] min-w-[44px] max-w-[44px] px-3 py-3 text-center">
                                            <div className="flex items-center justify-center">
                                                <input
                                                    type="checkbox"
                                                    id="select-all-students"
                                                    aria-label="Select all eligible students on this page"
                                                    checked={allSelected}
                                                    ref={(el) => { if (el) el.indeterminate = !allSelected && someSelected; }}
                                                    disabled={displayedEligible.length === 0}
                                                    onChange={toggleSelectAll}
                                                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                                />
                                            </div>
                                        </th>
                                        <th scope="col" className={`${thCls} !px-3 min-w-[120px]`}>Name</th>
                                        <th scope="col" className={`${thCls} !px-3 min-w-[130px]`}>Email</th>
                                        <th scope="col" className={`${thCls} !px-3 min-w-[110px]`}>Role</th>
                                        <th scope="col" className={`${thCls} !px-3 min-w-[100px]`}>Status</th>
                                        <th scope="col" className={`${thCls} !px-3 min-w-[140px]`}>Assessment</th>
                                        <th scope="col" className={`${thCls} !px-3 min-w-[130px] hidden 2xl:table-cell`}>Last sign-in</th>
                                        <th scope="col" className={`${thCls} !px-3 sticky right-0 z-[1] bg-slate-50 dark:bg-slate-950 text-right shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.15)]`}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody className={tbodyCls}>
                                    {data.items.map((u) => {
                                        const isSelf = me && (Number(me.user_id) === u.id || Number(me.id) === u.id);
                                        const canManage = !isSelf && (
                                            !me?.role ||
                                            manageableRoles(me?.role).includes(u.role) ||
                                            isAdminRole(me?.role)
                                        );
                                        const isEligibleStudent = canManage && u.role === 'STUDENT';
                                        return (
                                            <tr key={u.id} className={`group h-[68px] ${trCls}`}>
                                                <td className="w-[44px] min-w-[44px] max-w-[44px] px-3 py-3 align-middle text-center">
                                                    <div className="flex items-center justify-center">
                                                        {isEligibleStudent ? (
                                                            <input
                                                                type="checkbox"
                                                                id={`select-user-${u.id}`}
                                                                aria-label={`Select ${u.email}`}
                                                                checked={selectedIds.includes(u.id)}
                                                                onChange={() => toggleSelectOne(u.id)}
                                                                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 cursor-pointer"
                                                            />
                                                        ) : null}
                                                    </div>
                                                </td>
                                                <td className={`${tdCls} !px-3`}>
                                                    <div className="flex items-center gap-2.5">
                                                        <Avatar u={u} />
                                                        <div className="font-medium text-slate-900 dark:text-slate-100 line-clamp-2 leading-snug">
                                                            {u.full_name || '—'}
                                                            {isSelf && <SelfTag />}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className={`${tdCls} !px-3`}>
                                                    <div className="truncate max-w-[150px] text-slate-600 dark:text-slate-300 text-[13px] leading-normal" title={u.email}>
                                                        {u.email}
                                                    </div>
                                                </td>
                                                <td className={`${tdCls} !px-3 whitespace-nowrap`}>
                                                    <RoleBadge role={u.role} />
                                                </td>
                                                <td className={`${tdCls} !px-3 whitespace-nowrap`}>
                                                    <ActiveBadge active={u.is_active} />
                                                </td>
                                                <td className={`${tdCls} !px-3`}>
                                                    <AssessmentAccess u={u} canManage={canManage} accessBusyId={accessBusyId} setAccessConfirm={setAccessConfirm} />
                                                </td>
                                                <td className={`${tdCls} !px-3 text-slate-500 dark:text-slate-400 hidden 2xl:table-cell whitespace-nowrap text-[13px]`}>
                                                    {formatDate(u.last_login_at)}
                                                </td>
                                                <td className={`${tdCls} !px-3 sticky right-0 z-[1] bg-white dark:bg-[var(--pw-surface)] group-hover:bg-slate-50 dark:group-hover:bg-slate-800 transition-colors shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.15)]`}>
                                                    <RowActions u={u} isSelf={isSelf} canManage={canManage} sharingId={sharingId} setDialog={setDialog} shareCredentials={shareCredentials} setConfirm={setConfirm} compact />
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    )
                )}

                {data.total > PAGE_SIZE && (
                    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-400">
                        <span>{data.total} users · page {page} of {pages}</span>
                        <div className="flex gap-2">
                            <button type="button" className={ghostBtn} disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>Previous</button>
                            <button type="button" className={ghostBtn} disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)}>Next</button>
                        </div>
                    </div>
                )}
            </div>

            {dialog?.type === 'create' && (
                <CreateUserDialog allowedRoles={creatableRoles(me?.role)} onClose={() => setDialog(null)} onCreated={(res) => { setDialog(null); say(res.user?.role === 'STUDENT' ? `${res.message} Click Share to e-mail the login details to the student.` : res.message); setPage(1); load(); }} />
            )}
            {dialog?.type === 'reset' && (
                <ResetPasswordDialog user={dialog.user} onClose={() => setDialog(null)}
                    onDone={(message) => { const student = dialog.user.role === 'STUDENT'; setDialog(null); say(student ? `${message} Click Share to e-mail the new password to the student.` : message); load(); }} />
            )}
            <ConfirmationModal
                isOpen={Boolean(needsReplace)}
                onClose={() => setNeedsReplace(null)}
                onConfirm={() => { const target = needsReplace; setNeedsReplace(null); setDialog({ type: 'reset', user: target }); }}
                type="warning"
                title="Password can't be shared yet"
                message={`${needsReplace?.email}'s password is stored securely and cannot be recovered or shown, so it can't be e-mailed. Replace the password first, then click Share to send the new one.`}
                confirmText="Replace password"
            />
            {dialog?.type === 'details' && (
                <DetailsDialog userId={dialog.userId} isSelf={dialog.isSelf} canManage={dialog.canManage} manageable={manageableRoles(me?.role)} onClose={() => setDialog(null)} onChanged={(m) => { say(m); load(); }}
                    onResetPassword={(u) => setDialog({ type: 'reset', user: u })} onToggleActive={(u) => setConfirm(u)}
                    onToggleAssessmentAccess={(u) => { setDialog(null); setAccessConfirm(u); }} />
            )}
            <ConfirmationModal
                isOpen={Boolean(confirm)}
                onClose={() => setConfirm(null)}
                onConfirm={toggleActive}
                type={confirm?.is_active ? 'warning' : 'success'}
                title={confirm?.is_active ? 'Deactivate account?' : 'Activate account?'}
                message={confirm?.is_active
                    ? `${confirm?.email} will be signed out immediately and will not be able to sign in until you activate the account again.`
                    : `${confirm?.email} will be able to sign in again.`}
                confirmText={confirm?.is_active ? 'Deactivate' : 'Activate'}
            />
            <ConfirmationModal
                isOpen={Boolean(accessConfirm)}
                onClose={() => setAccessConfirm(null)}
                onConfirm={changeAssessmentAccess}
                type={accessConfirm?.assessment_access_granted ? 'warning' : 'success'}
                title={accessConfirm?.assessment_access_granted ? 'Lock assessment access?' : 'Unlock assessment access?'}
                message={accessConfirm?.assessment_access_granted
                    ? `${accessConfirm?.email} will no longer be able to start a new assessment. An assessment they have already started is not interrupted, and their past results and reports are kept.`
                    : `${accessConfirm?.email} will be able to start assessments until access is locked again.`}
                confirmText={accessConfirm?.assessment_access_granted ? 'Lock access' : 'Unlock access'}
            />
            <ConfirmationModal
                isOpen={bulkConfirmOpen}
                onClose={() => setBulkConfirmOpen(false)}
                onConfirm={handleBulkShare}
                type="info"
                title="Share Credentials"
                message={`Send login credentials to ${selectedIds.length} selected ${selectedIds.length === 1 ? 'student' : 'students'}?\n\nEach student will receive an individual email with their login credentials if available. Retained passwords will be cleared once accepted by the mail server.`}
                confirmText={`Send to ${selectedIds.length} ${selectedIds.length === 1 ? 'Student' : 'Students'}`}
            />
            <ConfirmationModal
                isOpen={bulkReplaceConfirmOpen}
                onClose={() => setBulkReplaceConfirmOpen(false)}
                onConfirm={handleBulkReplaceAndShare}
                type="warning"
                title="Replace Passwords & Share Credentials?"
                message={`Are you sure you want to replace passwords for ${selectedIds.length} selected ${selectedIds.length === 1 ? 'student' : 'students'}?\n\nThis will generate a new secure password for each student, sign them out of any active sessions, and email them their new login details. Their previous passwords will no longer work.`}
                confirmText={`Replace Passwords & Send Emails`}
            />
            {bulkSending && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Sending credentials">
                    <div className={`relative z-10 w-full max-w-sm ${cardCls} p-6 text-center space-y-3`}>
                        <Loader2 size={36} className="mx-auto text-[#5d8c2c] dark:text-emerald-400 animate-spin" />
                        <h3 className="pw-card-title">Sending Credentials</h3>
                        <p className="text-[13px] leading-5 text-slate-500 dark:text-slate-400">
                            Processing emails for {selectedIds.length} {selectedIds.length === 1 ? 'student' : 'students'}... Please do not close this window.
                        </p>
                    </div>
                </div>
            )}
            {bulkResults && (
                <BulkResultsDialog data={bulkResults} onClose={closeBulkResults} />
            )}
            <Toast toast={toast} onClose={() => setToast(null)} />
        </WorkspacePage>
    );
};

export default UserManagementPage;
