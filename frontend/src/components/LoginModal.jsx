import { X, AlertCircle, Loader2, Lock, Mail, Eye, EyeOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { login } from '../auth/authSession';

/**
 * The single PrepWin login (Admin and Student). Accounts are created by an administrator, so there is no sign-up path here.
 * The destination comes from the role the SERVER returns for the stored account, never from anything chosen in the browser.
 */
export default function LoginModal({ isOpen, onClose }) {
    const navigate = useNavigate();
    const emailRef = useRef(null);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (isOpen) {
            setError(null);
            setPassword('');
            const t = setTimeout(() => emailRef.current?.focus(), 50);
            return () => clearTimeout(t);
        }
        return undefined;
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        const cleanEmail = email.trim();
        if (!cleanEmail || !password) {
            setError('Please enter your email address and password.');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const data = await login(cleanEmail, password);
            setPassword('');
            onClose();
            navigate(data.redirect || (data.role === 'STUDENT' ? '/student/dashboard' : '/admin/dashboard'), { replace: true });
        } catch (err) {
            setError(err.message || 'Sign-in failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Sign in to PrepWin">
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" onClick={onClose} />

            <div className="relative z-10 w-full max-w-[440px] my-auto bg-white rounded-2xl shadow-2xl border border-gray-100 max-h-[calc(100vh-2rem)] overflow-y-auto overflow-x-hidden animate-in fade-in zoom-in-95 duration-200">
                <button
                    onClick={onClose}
                    className="absolute top-3.5 right-3.5 z-20 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
                    title="Close"
                    aria-label="Close modal"
                >
                    <X className="w-5 h-5" />
                </button>

                <div className="pt-5 pb-1 flex flex-col items-center justify-center">
                    <div className="flex items-center gap-2">
                        <img src="/logo_main.png" alt="ThirdEye Data" style={{ height: '26px', width: 'auto' }} className="object-contain shrink-0" />
                        <span className="text-[15px] font-bold text-[#5d8c2c] tracking-tight leading-none">PrepWin</span>
                    </div>
                    <span className="text-[11px] font-medium text-slate-500 mt-1">Sign in to your account</span>
                </div>

                <div className="px-6 sm:px-7 py-4 text-left">
                    {error && (
                        <div role="alert" className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-left text-xs text-red-700 shadow-xs animate-in fade-in duration-150">
                            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                            <div className="flex-1">
                                <p className="font-semibold leading-snug">{error}</p>
                            </div>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
                        <div>
                            <label htmlFor="login-email" className="block text-xs font-semibold text-gray-700 mb-1">Email address</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                                    <Mail className="w-4 h-4" />
                                </div>
                                <input
                                    id="login-email"
                                    ref={emailRef}
                                    type="email"
                                    required
                                    autoComplete="username"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="you@example.com"
                                    className="w-full pl-9 pr-3 py-2.5 text-xs sm:text-sm bg-white border border-gray-300 rounded-xl focus:border-green-600 focus:ring-2 focus:ring-green-600/20 outline-none transition-all text-gray-900 shadow-2xs"
                                />
                            </div>
                        </div>

                        <div>
                            <label htmlFor="login-password" className="block text-xs font-semibold text-gray-700 mb-1">Password</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                                    <Lock className="w-4 h-4" />
                                </div>
                                <input
                                    id="login-password"
                                    type={showPassword ? 'text' : 'password'}
                                    required
                                    autoComplete="current-password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••••••"
                                    className="w-full pl-9 pr-10 py-2.5 text-xs sm:text-sm bg-white border border-gray-300 rounded-xl focus:border-green-600 focus:ring-2 focus:ring-green-600/20 outline-none transition-all text-gray-900 shadow-2xs"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
                                    tabIndex={-1}
                                    aria-label="Toggle password visibility"
                                >
                                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-2.5 bg-primary hover:bg-green-700 text-white font-semibold rounded-xl text-xs sm:text-sm transition-all shadow-sm hover:shadow-md disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer mt-3"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    <span>Signing in...</span>
                                </>
                            ) : (
                                <span>Sign In</span>
                            )}
                        </button>
                    </form>

                    <p className="mt-3.5 text-center text-[11px] text-gray-400">
                        Accounts are created by your administrator. Contact them if you need access or a password reset.
                    </p>
                </div>
            </div>
        </div>
    );
}
