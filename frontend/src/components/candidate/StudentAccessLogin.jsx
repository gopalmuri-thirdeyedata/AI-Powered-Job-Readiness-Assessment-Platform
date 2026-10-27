import React, { useState } from 'react';
import { AlertCircle, Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react';
import { login, logout } from '../../auth/authSession';

/**
 * Sign-in step of the shared assessment link for invited students. It uses PrepWin's one login (POST /api/auth/login/): the
 * student types only the e-mail and password an administrator gave them. There is no name / phone / e-mail registration here.
 * The page URL does not change, so the student lands on the intended assessment as soon as the sign-in succeeds.
 * Which role the account has is decided by the server's stored account, never by this form.
 */
const StudentAccessLogin = ({ assessmentTitle }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [show, setShow] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const submit = async (e) => {
        e.preventDefault();
        if (busy) return;
        if (!email.trim() || !password) { setError('Enter your email address and password.'); return; }
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
        <form onSubmit={submit} noValidate aria-label="Student sign in"
            className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-xs space-y-4 mt-6">
            <div>
                <h2 className="text-lg font-extrabold">Sign in to start</h2>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    Use the email and password for your PrepWin student account{assessmentTitle ? <> to open <b>{assessmentTitle}</b></> : null}.
                    Signing in does not start the assessment.
                </p>
            </div>
            <label className="block">
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Email address</span>
                <span className="relative block mt-1">
                    <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/30 focus:border-[#5d8c2c]" />
                </span>
            </label>
            <label className="block">
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Password</span>
                <span className="relative block mt-1">
                    <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 pl-9 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/30 focus:border-[#5d8c2c]" />
                    <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                        {show ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                </span>
            </label>
            {error && (
                <p role="alert" className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2">
                    <AlertCircle size={15} className="mt-0.5 shrink-0" /> <span>{error}</span>
                </p>
            )}
            <button type="submit" disabled={busy}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-[#5d8c2c] hover:bg-[#4c7324] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm px-8 py-3 transition-colors">
                {busy && <Loader2 size={15} className="animate-spin" />} Sign in
            </button>
        </form>
    );
};

export default StudentAccessLogin;
