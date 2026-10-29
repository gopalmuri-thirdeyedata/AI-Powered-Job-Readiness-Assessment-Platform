import React, { useState } from 'react';
import { AlertCircle, Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react';
import { login, logout } from '../../auth/authSession';
import { panelCls, primaryBtnCls } from './AssessmentBrief';

const inputCls = 'w-full h-11 rounded-xl border bg-white dark:bg-slate-950 pl-9 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-colors focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/30 focus:border-[#5d8c2c]';
const okBorder = 'border-slate-300 dark:border-slate-700';
const badBorder = 'border-red-400 dark:border-red-500/70';

/**
 * Sign-in step of the shared assessment link for invited students. It uses PrepWin's one login (POST /api/auth/login/): the
 * student types only the e-mail and password an administrator gave them. There is no name / phone / e-mail registration here.
 * The page URL does not change, so the student lands on the intended assessment as soon as the sign-in succeeds.
 * Which role the account has is decided by the server's stored account, never by this form.
 * It is a bordered 12px panel (the same surface as the other cards of the opening page) so it can sit beside the overview.
 */
const StudentAccessLogin = ({ assessmentTitle, className = '' }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [show, setShow] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [missing, setMissing] = useState({ email: false, password: false });

    const submit = async (e) => {
        e.preventDefault();
        if (busy) return;
        if (!email.trim() || !password) {
            setMissing({ email: !email.trim(), password: !password });
            setError('Enter your email address and password.');
            return;
        }
        setMissing({ email: false, password: false });
        setBusy(true);
        setError('');
        try {
            const data = await login(email.trim(), password);
            setPassword('');
            if (data.role !== 'STUDENT') {
                await logout(); // an administrator signing in here is not given a session that could act as a student
                setError('This assessment is for student accounts. Sign in with the student email and password you were given.');
            }
        } catch (err) {
            setError(err.message || 'Sign-in failed. Please try again.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit} noValidate aria-label="Student sign in" className={`${panelCls} p-4 sm:p-5 space-y-3.5 ${className}`}>
            <div>
                <h2 className="text-lg font-extrabold leading-snug">Sign in to start</h2>
                <p className="text-[13px] leading-5 text-slate-600 dark:text-slate-400 mt-1">
                    Use the email and password for your PrepWin student account{assessmentTitle ? <> to open <b>{assessmentTitle}</b></> : null}.
                    Signing in does not start the assessment.
                </p>
            </div>
            <label className="block">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Email address</span>
                <span className="relative block mt-1.5">
                    <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input type="email" autoComplete="username" value={email} aria-invalid={missing.email || undefined}
                        onChange={(e) => { setEmail(e.target.value); if (missing.email) setMissing((m) => ({ ...m, email: false })); }} placeholder="you@example.com"
                        className={`${inputCls} pr-3 ${missing.email ? badBorder : okBorder}`} />
                </span>
            </label>
            <label className="block">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Password</span>
                <span className="relative block mt-1.5">
                    <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} aria-invalid={missing.password || undefined}
                        onChange={(e) => { setPassword(e.target.value); if (missing.password) setMissing((m) => ({ ...m, password: false })); }}
                        className={`${inputCls} pr-11 ${missing.password ? badBorder : okBorder}`} />
                    <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5d8c2c]/60">
                        {show ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                </span>
            </label>
            {error && (
                <p role="alert" className="flex items-start gap-2 text-[13px] leading-5 text-red-700 dark:text-red-300 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2">
                    <AlertCircle size={15} className="mt-0.5 shrink-0" /> <span>{error}</span>
                </p>
            )}
            <button type="submit" disabled={busy} aria-busy={busy} className={`${primaryBtnCls} w-full`}>
                {busy && <Loader2 size={15} className="animate-spin" />} Sign in
            </button>
        </form>
    );
};

export default StudentAccessLogin;
