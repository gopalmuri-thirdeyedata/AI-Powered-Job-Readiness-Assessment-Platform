import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, Pencil, Power, Search, ShieldCheck, GraduationCap, UserPlus, Users, X } from 'lucide-react';
import WorkspacePage from '../../components/admin/WorkspacePage';
import ConfirmationModal from '../../components/ConfirmationModal';
import { EmptyState, ErrorBanner, LoadingRow, PanelIntro, Toast, cardCls, formatDate, ghostBtn, inputCls, primaryBtn } from '../../components/admin/adminUi';
import { apiError, passwordProblems, userManagementApi } from '../../services/userManagementApi';
import { useAuth } from '../../auth/useAuth';
import { ROLE_LABELS, creatableRoles, manageableRoles } from '../../auth/roles';

const PAGE_SIZE = 25;

const RoleBadge = ({ role }) => (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border whitespace-nowrap ${role === 'SUPER_ADMIN'
        ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900'
        : role === 'ADMIN'
        ? 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900'
        : 'bg-[#5d8c2c]/15 text-[#4c7324] border-[#5d8c2c]/30 dark:bg-emerald-950/40 dark:text-[#9fd05a] dark:border-emerald-800/60'}`}>
        {role === 'STUDENT' ? <GraduationCap size={11} /> : <ShieldCheck size={11} />}{ROLE_LABELS[role] || role}
    </span>
);

const ActiveBadge = ({ active }) => (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border whitespace-nowrap ${active
        ? 'bg-[#5d8c2c]/15 text-[#4c7324] border-[#5d8c2c]/30 dark:bg-emerald-950/40 dark:text-[#9fd05a] dark:border-emerald-800/60'
        : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900'}`}>
        {active ? 'Active' : 'Deactivated'}
    </span>
);

/** Modal frame shared by the create / details / reset dialogs. */
const Dialog = ({ title, onClose, children, wide = false }) => {
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-label={title}>
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
            <div className={`relative z-10 w-full ${wide ? 'max-w-xl' : 'max-w-md'} my-auto ${cardCls} p-5 sm:p-6`}>
                <div className="flex items-start justify-between gap-3 mb-4">
                    <h2 className="text-lg font-extrabold text-slate-900 dark:text-white tracking-tight">{title}</h2>
                    <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"><X size={16} /></button>
                </div>
                {children}
            </div>
        </div>
    );
};

const Field = ({ label, hint, children, htmlFor }) => (
    <div>
        <label htmlFor={htmlFor} className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">{label}</label>
        {children}
        {hint && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{hint}</p>}
    </div>
);

/** Password input with a visibility toggle. The value only ever lives in this component's state while the dialog is open. */
const PasswordField = ({ id, value, onChange, autoComplete = 'new-password' }) => {
    const [shown, setShown] = useState(false);
    return (
        <div className="relative">
            <input id={id} type={shown ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} pr-10`} />
            <button type="button" tabIndex={-1} onClick={() => setShown((v) => !v)} aria-label="Toggle password visibility"
                className="absolute inset-y-0 right-0 px-3 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer">
                {shown ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
        </div>
    );
};

const FormError = ({ children }) => children ? (
    <div role="alert" className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 px-3 py-2 text-xs font-semibold">{children}</div>
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
            <form onSubmit={submit} className="space-y-3.5" noValidate>
                <Field label="Role">
                    <div className={`grid gap-2 ${allowedRoles.length > 2 ? 'grid-cols-3' : allowedRoles.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`} role="radiogroup" aria-label="Role">
                        {[['STUDENT', 'Student', GraduationCap], ['ADMIN', 'Admin', ShieldCheck], ['SUPER_ADMIN', 'Super Admin', ShieldCheck]].filter(([value]) => allowedRoles.includes(value)).map(([value, label, Icon]) => (
                            <button key={value} type="button" role="radio" aria-checked={form.role === value} onClick={() => set('role')(value)}
                                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition-colors cursor-pointer ${form.role === value
                                    ? 'border-[#5d8c2c] bg-[#5d8c2c]/10 text-[#4c7324] dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-300'
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
                <div className="flex justify-end gap-2 pt-1">
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
            <form onSubmit={submit} className="space-y-3.5" noValidate>
                <p className="text-sm text-slate-600 dark:text-slate-400">Set a new password for <span className="font-bold text-slate-900 dark:text-white">{user.email}</span>. Their current sessions are signed out. Share the new password with them through a secure channel.</p>
                <Field label="New password" htmlFor="um-reset-password"><PasswordField id="um-reset-password" value={password} onChange={setPassword} /></Field>
                <FormError>{error}</FormError>
                <div className="flex justify-end gap-2 pt-1">
                    <button type="button" className={ghostBtn} onClick={onClose} disabled={busy}>Cancel</button>
                    <button type="submit" className={primaryBtn} disabled={busy}>{busy ? <><Loader2 size={14} className="animate-spin" /> Saving...</> : <><KeyRound size={14} /> Replace password</>}</button>
                </div>
            </form>
        </Dialog>
    );
};

/* ─────────────────────────── Details / edit ─────────────────────────── */
const DetailsDialog = ({ userId, onClose, onChanged, onResetPassword, onToggleActive, isSelf, canManage, manageable }) => {
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
        <div className="flex justify-between gap-4 py-2 border-b border-slate-100 dark:border-slate-800 last:border-0 text-sm">
            <dt className="text-slate-500 dark:text-slate-400 font-semibold">{label}</dt>
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
                        {row('Mobile number', user.phone)}
                        {row('Organization', user.organization_name)}
                        {row('Created', formatDate(user.created_at))}
                        {row('Last sign-in', formatDate(user.last_login_at))}
                        {row('Active sessions', String(user.active_sessions ?? 0))}
                        {user.student_profile && row('College', user.student_profile.college_name)}
                        {user.student_profile && row('Target role', user.student_profile.target_role)}
                        {user.student_profile && row('Onboarded', user.student_profile.is_onboarded ? 'Yes' : 'No')}
                    </dl>
                    <div className="flex flex-wrap justify-end gap-2 mt-4">
                        {manageable.includes(user.role) && <button type="button" className={ghostBtn} onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>}
                        {canManage && <button type="button" className={ghostBtn} onClick={() => onResetPassword(user)}><KeyRound size={14} /> Replace password</button>}
                        {canManage && <button type="button" className={ghostBtn} onClick={() => onToggleActive(user)}><Power size={14} /> {user.is_active ? 'Deactivate' : 'Activate'}</button>}
                    </div>
                </>
            )}
            {user && editing && (
                <form onSubmit={save} className="space-y-3.5" noValidate>
                    <Field label="Name" htmlFor="um-edit-name"><input id="um-edit-name" className={inputCls} value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} maxLength={150} /></Field>
                    <Field label="Mobile number (optional)" htmlFor="um-edit-phone"><input id="um-edit-phone" type="tel" className={inputCls} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} maxLength={50} /></Field>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Email, role and organization cannot be changed here.</p>
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

/* ─────────────────────────── Page ─────────────────────────── */
const UserManagementPage = () => {
    const { user: me } = useAuth();
    const [filters, setFilters] = useState({ q: '', role: '', status: '' });
    const [debouncedQ, setDebouncedQ] = useState('');
    const [page, setPage] = useState(1);
    const [data, setData] = useState({ items: [], total: 0 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [toast, setToast] = useState(null);
    const [dialog, setDialog] = useState(null); // { type: 'create' | 'details' | 'reset', ... }
    const [confirm, setConfirm] = useState(null); // user to (de)activate
    const timer = useRef(null);

    useEffect(() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => { setDebouncedQ(filters.q); setPage(1); }, 300);
        return () => clearTimeout(timer.current);
    }, [filters.q]);

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

    return (
        <WorkspacePage title="User Management" description="Create and manage the Student and Admin accounts that can sign in to PrepWin. There is no public sign-up: every account starts here.">
            <div className="space-y-4">
                <PanelIntro onRefresh={load} loading={loading}>Passwords are stored securely and are never shown again after an account is created. Use Replace password to give someone a new one.</PanelIntro>

                <div className={`${cardCls} p-3 sm:p-4 flex flex-col lg:flex-row gap-3 lg:items-center`}>
                    <div className="relative flex-1 min-w-0">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        <input aria-label="Search by name or email" placeholder="Search by name or email" className={`${inputCls} pl-9`} value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
                    </div>
                    <select aria-label="Filter by role" className={`${inputCls} lg:w-40`} value={filters.role} onChange={(e) => { setFilters((f) => ({ ...f, role: e.target.value })); setPage(1); }}>
                        <option value="">All roles</option><option value="STUDENT">Students</option><option value="ADMIN">Admins</option><option value="SUPER_ADMIN">Super Admins</option>
                    </select>
                    <select aria-label="Filter by status" className={`${inputCls} lg:w-40`} value={filters.status} onChange={(e) => { setFilters((f) => ({ ...f, status: e.target.value })); setPage(1); }}>
                        <option value="">Any status</option><option value="active">Active</option><option value="inactive">Deactivated</option>
                    </select>
                    <button type="button" className={primaryBtn} onClick={() => setDialog({ type: 'create' })}><UserPlus size={15} /> Create account</button>
                </div>

                {error && <ErrorBanner onRetry={load}>{error}</ErrorBanner>}

                {loading && data.items.length === 0 ? <LoadingRow>Loading users...</LoadingRow> : data.items.length === 0 && !error ? (
                    <EmptyState icon={Users} title={debouncedQ || filters.role || filters.status ? 'No users match these filters' : 'No users yet'}
                        action={<button type="button" className={primaryBtn} onClick={() => setDialog({ type: 'create' })}><UserPlus size={14} /> Create account</button>}>
                        {debouncedQ || filters.role || filters.status ? 'Try a different search or clear the filters.' : 'Create the first Student or Admin account.'}
                    </EmptyState>
                ) : (
                    <div className={`${cardCls} overflow-x-auto`}>
                        <table className="w-full text-sm text-left">
                            <thead>
                                <tr className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                                    <th className="px-4 py-3 font-bold">Name</th><th className="px-4 py-3 font-bold">Email</th><th className="px-4 py-3 font-bold">Role</th>
                                    <th className="px-4 py-3 font-bold">Status</th><th className="px-4 py-3 font-bold hidden md:table-cell">Last sign-in</th><th className="px-4 py-3 font-bold text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.items.map((u) => {
                                    const isSelf = me && Number(me.user_id) === u.id;
                                    const canManage = !isSelf && manageableRoles(me?.role).includes(u.role);
                                    return (
                                        <tr key={u.id} className="border-b border-slate-100 dark:border-slate-800/70 last:border-0 hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                                            <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">{u.full_name || '—'}{isSelf && <span className="ml-1.5 text-[10px] font-bold text-slate-400">(you)</span>}</td>
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300 break-all">{u.email}</td>
                                            <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                                            <td className="px-4 py-3"><ActiveBadge active={u.is_active} /></td>
                                            <td className="px-4 py-3 text-slate-500 dark:text-slate-400 hidden md:table-cell whitespace-nowrap">{formatDate(u.last_login_at)}</td>
                                            <td className="px-4 py-3">
                                                <div className="flex justify-end gap-1.5">
                                                    <button type="button" className={ghostBtn} onClick={() => setDialog({ type: 'details', userId: u.id, isSelf, canManage })} aria-label={`View ${u.email}`}><Eye size={14} /><span className="hidden lg:inline">View</span></button>
                                                    {canManage && <button type="button" className={ghostBtn} onClick={() => setDialog({ type: 'reset', user: u })} aria-label={`Replace password for ${u.email}`}><KeyRound size={14} /></button>}
                                                    {canManage && <button type="button" className={ghostBtn} onClick={() => setConfirm(u)} aria-label={`${u.is_active ? 'Deactivate' : 'Activate'} ${u.email}`}><Power size={14} /></button>}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {data.total > PAGE_SIZE && (
                    <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-400">
                        <span>{data.total} users · page {page} of {pages}</span>
                        <div className="flex gap-2">
                            <button type="button" className={ghostBtn} disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>Previous</button>
                            <button type="button" className={ghostBtn} disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)}>Next</button>
                        </div>
                    </div>
                )}
            </div>

            {dialog?.type === 'create' && (
                <CreateUserDialog allowedRoles={creatableRoles(me?.role)} onClose={() => setDialog(null)} onCreated={(res) => { setDialog(null); say(res.message); setPage(1); load(); }} />
            )}
            {dialog?.type === 'reset' && (
                <ResetPasswordDialog user={dialog.user} onClose={() => setDialog(null)} onDone={(message) => { setDialog(null); say(message); load(); }} />
            )}
            {dialog?.type === 'details' && (
                <DetailsDialog userId={dialog.userId} isSelf={dialog.isSelf} canManage={dialog.canManage} manageable={manageableRoles(me?.role)} onClose={() => setDialog(null)} onChanged={(m) => { say(m); load(); }}
                    onResetPassword={(u) => setDialog({ type: 'reset', user: u })} onToggleActive={(u) => setConfirm(u)} />
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
            <Toast toast={toast} onClose={() => setToast(null)} />
        </WorkspacePage>
    );
};

export default UserManagementPage;
