import { SignIn, SignUp, useClerk } from '@clerk/clerk-react';
import { X, CheckCircle, AlertCircle, Loader2, Lock, Mail, Eye, EyeOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import API_URL from '../apiConfig';
import { syncStudentSessionWithBackend } from '../hooks/useStudentTaskStatus';

export default function ClerkAuthModal({ isOpen, onClose, mode = 'student', redirectUrl, initialAuthType = 'signIn' }) {
    const { user } = useClerk();
    const navigate = useNavigate();
    const userTypedRef = useRef(false);
    const modalRef = useRef(null);

    const [authType, setAuthType] = useState(initialAuthType);

    useEffect(() => {
        setAuthType(initialAuthType);
    }, [initialAuthType, isOpen]);

    // Direct Admin Form State (Password Authentication — No OTP)
    const [adminEmail, setAdminEmail] = useState('');
    const [adminPassword, setAdminPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [adminLoading, setAdminLoading] = useState(false);
    const [adminError, setAdminError] = useState(null);

    // Student Clerk Email Pre-check State
    const [emailError, setEmailError] = useState(null);
    const [isCheckingEmail, setIsCheckingEmail] = useState(false);
    const verifiedEmailsRef = useRef(new Set());
    const pendingCheckRef = useRef(false);

    const targetDestination = redirectUrl || (mode === 'student' ? '/assessment/setup' : '/admin/dashboard');

    // Automatically synchronize session and redirect upon successful Clerk authentication (Student only)
    useEffect(() => {
        if (user && isOpen && mode === 'student') {
            const handlePostAuth = async () => {
                await syncStudentSessionWithBackend(user);
                onClose();
                navigate(targetDestination, { replace: true });
            };
            handlePostAuth();
        }
    }, [user, isOpen, onClose, navigate, targetDestination, mode]);

    // Handle Direct Admin Password Authentication (No OTP)
    const handleAdminLogin = async (e) => {
        if (e && e.preventDefault) e.preventDefault();
        const cleanEmail = (adminEmail || '').trim().toLowerCase();
        const cleanPassword = (adminPassword || '').trim();
        if (!cleanEmail || !cleanPassword) {
            setAdminError("Please enter both administrator email and password.");
            return;
        }

        setAdminLoading(true);
        setAdminError(null);

        try {
            const res = await fetch(`${API_URL}/api/auth/login/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: cleanEmail,
                    password: cleanPassword
                })
            });

            let data = null;
            try {
                data = await res.json();
            } catch (jsonErr) {
                if (!res.ok) {
                    throw new Error("Server is initializing or temporarily busy. Please wait a moment and try again.");
                }
            }

            if (!res.ok) {
                throw new Error((data && data.detail) || "Authentication failed. Incorrect email or password.");
            }

            if (data.access) {
                localStorage.setItem('token', data.access);

                // Fetch & store profile
                try {
                    const meRes = await fetch(`${API_URL}/api/auth/me`, {
                        headers: { 'Authorization': `Bearer ${data.access}` }
                    });
                    if (meRes.ok) {
                        const profileData = await meRes.json();
                        localStorage.setItem('user_profile', JSON.stringify(profileData));
                    }
                } catch (pErr) {
                    console.warn("Could not load user profile:", pErr);
                }

                onClose();
                navigate('/admin/dashboard', { replace: true });
            } else {
                throw new Error("No authorization token returned by authentication server.");
            }
        } catch (err) {
            console.error("Direct admin login error:", err);
            setAdminError(err.message || "Failed to log in. Please check your credentials.");
        } finally {
            setAdminLoading(false);
        }
    };

    // Aggressively remove Clerk "Last used" badges and clear browser autofill (Student Mode only)
    useEffect(() => {
        if (!isOpen || mode === 'admin') {
            userTypedRef.current = false;
            return;
        }

        userTypedRef.current = false;

        const onUserInteraction = (e) => {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON')) {
                userTypedRef.current = true;
            }
        };

        const container = modalRef.current || document.body;
        container.addEventListener('input', onUserInteraction, { capture: true });
        container.addEventListener('keydown', onUserInteraction, { capture: true });
        container.addEventListener('mousedown', onUserInteraction, { capture: true });

        const cleanupBadgesAndAutofill = () => {
            // 1. Physically remove any DOM element containing "Last used" text
            const walker = document.createTreeWalker(
                container,
                NodeFilter.SHOW_ELEMENT,
                null,
                false
            );
            const toRemove = [];
            while (walker.nextNode()) {
                const node = walker.currentNode;
                if (
                    node.childNodes.length === 1 &&
                    node.childNodes[0].nodeType === Node.TEXT_NODE &&
                    node.textContent.trim().toLowerCase() === 'last used'
                ) {
                    toRemove.push(node);
                }
            }
            toRemove.forEach((el) => {
                el.style.setProperty('display', 'none', 'important');
                el.style.setProperty('visibility', 'hidden', 'important');
                el.remove();
            });

            // 2. Also remove any elements matching badge selectors
            container.querySelectorAll('.cl-badge, .cl-badge__lastUsed, [class*="cl-badge"], [class*="lastUsed"]').forEach((el) => {
                el.style.setProperty('display', 'none', 'important');
                el.remove();
            });

            // 3. Clear autofill on inputs if the user has not started typing
            if (!userTypedRef.current) {
                const inputs = container.querySelectorAll(
                    '.cl-formFieldInput, input[name="identifier"], input[type="email"], input[type="password"]'
                );
                inputs.forEach((input) => {
                    input.setAttribute('autocomplete', 'new-password');
                    input.setAttribute('data-lpignore', 'true');
                    input.setAttribute('data-form-type', 'other');

                    // If Chrome injected a value before the user touched it, clear it
                    if (input.value && document.activeElement !== input) {
                        input.value = '';
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });
            }
        };

        cleanupBadgesAndAutofill();
        const intervalId = setInterval(cleanupBadgesAndAutofill, 50);
        const timeoutId = setTimeout(() => clearInterval(intervalId), 3000);

        const observer = new MutationObserver(cleanupBadgesAndAutofill);
        observer.observe(container, { childList: true, subtree: true });

        return () => {
            clearInterval(intervalId);
            clearTimeout(timeoutId);
            observer.disconnect();
            container.removeEventListener('input', onUserInteraction, { capture: true });
            container.removeEventListener('keydown', onUserInteraction, { capture: true });
            container.removeEventListener('mousedown', onUserInteraction, { capture: true });
        };
    }, [isOpen, mode]);

    // Pre-authentication check: intercept email entry and verify against HiringAI before sending OTP (Student mode)
    useEffect(() => {
        if (!isOpen || mode === 'admin') {
            setEmailError(null);
            setIsCheckingEmail(false);
            return;
        }

        const container = modalRef.current;
        if (!container) return;

        const checkEmailAllowed = async (email) => {
            try {
                const res = await fetch(`${API_URL}/api/auth/check-email/`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, intent: mode })
                });
                if (!res.ok) {
                    return { allowed: false, detail: "Error verifying email authorization." };
                }
                return await res.json();
            } catch (err) {
                console.error("Email pre-check error:", err);
                return { allowed: false, detail: "Unable to verify email invitation status." };
            }
        };

        const handleEmailValidation = async (e) => {
            const identifierInput = container.querySelector('input[name="identifier"], input[type="email"]');
            const isOtpStep = !!container.querySelector('.cl-otpCodeFieldInputs, input[name="code"]');
            if (!identifierInput || isOtpStep) return;

            const email = (identifierInput.value || '').trim().toLowerCase();
            if (!email || !email.includes('@')) {
                return;
            }

            if (verifiedEmailsRef.current.has(email)) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            if (pendingCheckRef.current) return;
            pendingCheckRef.current = true;
            setIsCheckingEmail(true);
            setEmailError(null);

            const result = await checkEmailAllowed(email);
            pendingCheckRef.current = false;
            setIsCheckingEmail(false);

            if (!result.allowed) {
                setEmailError(result.detail || "This email has not been invited to PrepWin.");
                identifierInput.focus();
                identifierInput.style.borderColor = '#ef4444';
            } else {
                setEmailError(null);
                identifierInput.style.borderColor = '';
                verifiedEmailsRef.current.add(email);

                const submitBtn = container.querySelector('.cl-formButtonPrimary, button[type="submit"]');
                if (submitBtn) {
                    submitBtn.click();
                }
            }
        };

        const onCaptureClick = (e) => {
            const submitBtn = e.target && e.target.closest && e.target.closest('.cl-formButtonPrimary, button[type="submit"]');
            const isSocial = e.target && e.target.closest && e.target.closest('.cl-socialButtonsBlockButton');
            if (submitBtn && !isSocial) {
                handleEmailValidation(e);
            }
        };

        const onCaptureKeyDown = (e) => {
            if (e.key === 'Enter') {
                const target = e.target;
                if (target && (target.name === 'identifier' || target.type === 'email')) {
                    handleEmailValidation(e);
                }
            }
        };

        const onCaptureSubmit = (e) => {
            handleEmailValidation(e);
        };

        const onInputChange = (e) => {
            const target = e.target;
            if (target && (target.name === 'identifier' || target.type === 'email')) {
                setEmailError(null);
                target.style.borderColor = '';
            }
        };

        const onFooterClick = (e) => {
            const link = e.target && e.target.closest && e.target.closest('.cl-footerActionLink, a[href*="sign-up"], a[href*="sign-in"]');
            if (link) {
                e.preventDefault();
                e.stopPropagation();
                setAuthType(prev => (prev === 'signIn' ? 'signUp' : 'signIn'));
                setEmailError(null);
            }
        };

        container.addEventListener('click', onCaptureClick, { capture: true });
        container.addEventListener('click', onFooterClick, { capture: true });
        container.addEventListener('keydown', onCaptureKeyDown, { capture: true });
        container.addEventListener('submit', onCaptureSubmit, { capture: true });
        container.addEventListener('input', onInputChange, { capture: true });

        return () => {
            container.removeEventListener('click', onCaptureClick, { capture: true });
            container.removeEventListener('click', onFooterClick, { capture: true });
            container.removeEventListener('keydown', onCaptureKeyDown, { capture: true });
            container.removeEventListener('submit', onCaptureSubmit, { capture: true });
            container.removeEventListener('input', onInputChange, { capture: true });
        };
    }, [isOpen, mode]);

    if (!isOpen) return null;

    // Custom appearance settings for Clerk (Student mode)
    const clerkAppearance = {
        variables: {
            colorPrimary: "#16A34A",
            borderRadius: "0.75rem",
            colorText: "#111827",
            colorTextSecondary: "#6B7280",
            colorInputText: "#111827",
            colorInputBackground: "#FFFFFF",
            colorInputBorder: "#D1D5DB",
            fontFamily: "inherit"
        },
        elements: {
            rootBox: "w-full mx-auto",
            cardBox: "w-full shadow-none",
            card: "shadow-none border-0 bg-transparent w-full pt-1 pb-1 px-6 sm:px-7",
            header: "text-center pb-0 pt-0",
            headerTitle: "text-lg font-bold text-gray-900 tracking-tight",
            headerSubtitle: "text-xs text-gray-500 mt-0.5 font-normal",
            socialButtonsBlockButton: "h-9 border border-gray-200 bg-white hover:bg-gray-50/80 rounded-xl shadow-2xs hover:shadow-xs transition-all text-gray-700 font-medium text-xs sm:text-sm",
            socialButtonsBlockButtonText: "font-medium text-gray-700 text-xs sm:text-sm",
            socialButtonsProviderIcon: "w-4 h-4 mr-2",
            dividerRow: "my-1.5 sm:my-2",
            dividerText: "text-xs text-gray-400 font-medium",
            dividerLine: "bg-gray-200",
            badge: "!hidden",
            socialButtonsBlockButtonBadge: "!hidden",
            socialButtonsBadge: "!hidden",
            formFieldLabel: "text-xs font-semibold text-gray-700 mb-0.5",
            formFieldRow: "mb-2",
            formFieldInput: "h-9 px-3 text-xs sm:text-sm bg-white border border-gray-300 rounded-xl focus:border-green-600 focus:ring-2 focus:ring-green-600/20 transition-all text-gray-900 shadow-2xs hover:border-gray-400 [&:-webkit-autofill]:shadow-[0_0_0_1000px_white_inset] [&:-webkit-autofill]:[-webkit-text-fill-color:#111827]",
            formFieldAction: "text-xs font-semibold text-green-600 hover:text-green-700 transition-colors",
            formButtonPrimary: "h-9.5 bg-primary hover:bg-green-700 text-white font-semibold rounded-xl shadow-sm hover:shadow-md transition-all text-xs sm:text-sm active:scale-[0.99] mt-1.5",
            footerAction: "!hidden",
            footerActionLink: "!hidden",
            footer: "pt-0 border-0",
            identityPreviewText: "text-sm font-medium text-gray-900",
            identityPreviewEditButton: "text-xs text-green-600 hover:text-green-700 font-semibold",
            formResendCodeLink: "text-xs text-green-600 hover:text-green-700 font-medium",
            otpCodeFieldInput: "border-gray-300 focus:border-green-600 focus:ring-2 focus:ring-green-600/20 rounded-xl"
        }
    };

    // If student user is already signed in via Clerk, show continue card
    if (user && mode === 'student') {
        return (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
                <div
                    className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
                    onClick={onClose}
                />

                <div className="relative z-10 w-full max-w-[440px] mx-auto">
                    <div className="relative bg-white rounded-2xl shadow-2xl p-6 sm:p-8 text-center break-words border border-gray-100">
                        <button
                            onClick={onClose}
                            className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
                            title="Close"
                        >
                            <X className="w-5 h-5" />
                        </button>
                        <CheckCircle className="w-14 h-14 text-green-600 mx-auto mb-4" />
                        <h2 className="text-2xl font-bold text-gray-900 mb-2">Already Signed In</h2>
                        <p className="text-gray-600 mb-6 text-sm">
                            You're already authenticated as <span className="font-semibold text-gray-900">{user.primaryEmailAddress?.emailAddress}</span>
                        </p>
                        <button
                            onClick={async () => {
                                await syncStudentSessionWithBackend(user);
                                onClose();
                                navigate(targetDestination);
                            }}
                            className="w-full py-3 bg-primary text-white font-semibold rounded-xl hover:bg-green-700 transition-all shadow-md cursor-pointer"
                        >
                            Continue to Assessment Setup
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
                onClick={onClose}
            />

            {/* Modal card container */}
            <div ref={modalRef} className="relative z-10 w-full max-w-[440px] my-auto bg-white rounded-2xl shadow-2xl border border-gray-100 max-h-[calc(100vh-2rem)] overflow-y-auto overflow-x-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Close button */}
                <button
                    onClick={onClose}
                    className="absolute top-3.5 right-3.5 z-20 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
                    title="Close"
                    aria-label="Close modal"
                >
                    <X className="w-5 h-5" />
                </button>

                {/* Brand Header */}
                <div className="pt-5 pb-1 flex flex-col items-center justify-center">
                    <div className="flex items-center gap-2">
                        <img 
                            src="/logo_main.png" 
                            alt="ThirdEye Data" 
                            style={{ height: '26px', width: 'auto' }}
                            className="object-contain shrink-0" 
                        />
                        <span className="text-[15px] font-bold text-[#5d8c2c] tracking-tight leading-none">
                            PrepWin
                        </span>
                    </div>
                    <span className="text-[11px] font-medium text-slate-500 mt-1">
                        {mode === 'admin'
                            ? 'Recruiter & Administrator Sign In'
                            : (authType === 'signUp' ? 'Student Assessment Sign Up' : 'Student Assessment Sign In')
                        }
                    </span>
                </div>

                {/* ========================================================================= */}
                {/* ADMIN MODE: DIRECT EMAIL & PASSWORD AUTHENTICATION (NO CLERK, NO OTP)   */}
                {/* ========================================================================= */}
                {mode === 'admin' ? (
                    <div className="px-6 sm:px-7 py-4 text-left">
                        {adminError && (
                            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-left text-xs text-red-700 shadow-xs animate-in fade-in duration-150">
                                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                                <div className="flex-1">
                                    <p className="font-semibold leading-snug">{adminError}</p>
                                </div>
                            </div>
                        )}

                        <form onSubmit={handleAdminLogin} className="space-y-3.5">
                            <div>
                                <label className="block text-xs font-semibold text-gray-700 mb-1">
                                    Administrator Email
                                </label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                                        <Mail className="w-4 h-4" />
                                    </div>
                                    <input
                                        type="email"
                                        required
                                        autoComplete="off"
                                        value={adminEmail}
                                        onChange={(e) => setAdminEmail(e.target.value)}
                                        placeholder="admin@thirdeyedata.ai"
                                        className="w-full pl-9 pr-3 py-2.5 text-xs sm:text-sm bg-white border border-gray-300 rounded-xl focus:border-green-600 focus:ring-2 focus:ring-green-600/20 outline-none transition-all text-gray-900 shadow-2xs"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-gray-700 mb-1">
                                    Password
                                </label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                                        <Lock className="w-4 h-4" />
                                    </div>
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        required
                                        autoComplete="new-password"
                                        value={adminPassword}
                                        onChange={(e) => setAdminPassword(e.target.value)}
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
                                disabled={adminLoading}
                                className="w-full py-2.5 bg-primary hover:bg-green-700 text-white font-semibold rounded-xl text-xs sm:text-sm transition-all shadow-sm hover:shadow-md disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer mt-3"
                            >
                                {adminLoading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span>Authenticating...</span>
                                    </>
                                ) : (
                                    <span>Sign In to Admin Dashboard</span>
                                )}
                            </button>
                        </form>

                        <p className="mt-3.5 text-center text-[11px] text-gray-400">
                        </p>
                    </div>
                ) : (
                    /* ========================================================================= */
                    /* STUDENT MODE: CLERK SIGN IN / SIGN UP (UNTOUCHED - GOOGLE & OTP PRESERVED) */
                    /* ========================================================================= */
                    <div>
                        {/* Pre-auth Email Authorization Error Banner */}
                        {emailError && (
                            <div className="mx-6 mt-3 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-left text-xs shadow-xs animate-in fade-in slide-in-from-top-1 duration-150">
                                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                                <div className="flex-1">
                                    <p className="font-semibold text-red-800 leading-snug">{emailError}</p>
                                    <p className="text-red-600/80 mt-0.5 leading-tight">
                                        Invitation required. Please contact your administrator.
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Email Verification In Progress */}
                        {isCheckingEmail && (
                            <div className="mx-6 mt-2.5 flex items-center justify-center gap-2 text-xs text-green-700 font-medium py-1 animate-pulse">
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-green-600" />
                                <span>Checking invitation status...</span>
                            </div>
                        )}

                        {/* Scoped CSS for Clerk */}
                        <style>{`
                            .cl-badge,
                            .cl-badge__lastUsed,
                            .cl-socialButtonsBlockButtonBadge,
                            .cl-socialButtonsBadge,
                            [class*="cl-badge"],
                            [class*="lastUsed"],
                            [data-localization-key*="lastUsed"] {
                                display: none !important;
                                visibility: hidden !important;
                                opacity: 0 !important;
                                pointer-events: none !important;
                            }
                            .cl-formFieldInput:not(.cl-otpCodeFieldInput),
                            input[name="identifier"],
                            input[name="password"] {
                                border: 1.5px solid #d1d5db !important;
                                border-radius: 0.75rem !important;
                                background-color: #ffffff !important;
                                color: #111827 !important;
                            }
                            .cl-formFieldInput:not(.cl-otpCodeFieldInput):hover,
                            input[name="identifier"]:hover,
                            input[name="password"]:hover {
                                border-color: #9ca3af !important;
                            }
                            .cl-formFieldInput:not(.cl-otpCodeFieldInput):focus,
                            input[name="identifier"]:focus,
                            input[name="password"]:focus {
                                border-color: #16a34a !important;
                                box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.15) !important;
                                outline: none !important;
                            }
                            .cl-otpCodeFieldInputs {
                                display: flex !important;
                                justify-content: center !important;
                                gap: 0.5rem !important;
                                margin: 0.5rem 0 !important;
                            }
                            .cl-otpCodeFieldInput {
                                border: 1.5px solid #d1d5db !important;
                                border-radius: 0.5rem !important;
                                background-color: #ffffff !important;
                                color: #111827 !important;
                                font-weight: 600 !important;
                                font-size: 1.25rem !important;
                                text-align: center !important;
                                width: 2.75rem !important;
                                height: 3.25rem !important;
                            }
                            .cl-otpCodeFieldInput:focus {
                                border-color: #16a34a !important;
                                box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.15) !important;
                                outline: none !important;
                            }
                            input:-webkit-autofill,
                            input:-webkit-autofill:hover,
                            input:-webkit-autofill:focus,
                            input:-webkit-autofill:active {
                                -webkit-box-shadow: 0 0 0 1000px #ffffff inset !important;
                                box-shadow: 0 0 0 1000px #ffffff inset !important;
                                -webkit-text-fill-color: #111827 !important;
                                caret-color: #111827 !important;
                                transition: background-color 5000s ease-in-out 0s !important;
                            }
                        `}</style>

                        {/* Clerk Auth form: SignIn or SignUp */}
                        {authType === 'signUp' ? (
                            <SignUp
                                appearance={clerkAppearance}
                                routing="virtual"
                                signInUrl="#"
                                fallbackRedirectUrl={targetDestination}
                                forceRedirectUrl={targetDestination}
                                initialValues={{ emailAddress: "" }}
                            />
                        ) : (
                            <SignIn
                                appearance={clerkAppearance}
                                routing="virtual"
                                signUpUrl="#"
                                fallbackRedirectUrl={targetDestination}
                                forceRedirectUrl={targetDestination}
                                initialValues={{ emailAddress: "" }}
                            />
                        )}

                        {/* Bottom Quick Switch Link */}
                        <div className="text-center pb-4 pt-1 text-xs text-slate-500 border-t border-slate-100 mx-6">
                            {authType === 'signIn' ? (
                                <p className="mt-2.5">
                                    Don't have an account?{' '}
                                    <button
                                        type="button"
                                        onClick={() => { setAuthType('signUp'); setEmailError(null); }}
                                        className="font-semibold text-emerald-600 hover:text-emerald-700 cursor-pointer ml-0.5 hover:underline"
                                    >
                                        Sign up
                                    </button>
                                </p>
                            ) : (
                                <p className="mt-2.5">
                                    Already have an account?{' '}
                                    <button
                                        type="button"
                                        onClick={() => { setAuthType('signIn'); setEmailError(null); }}
                                        className="font-semibold text-emerald-600 hover:text-emerald-700 cursor-pointer ml-0.5 hover:underline"
                                    >
                                        Sign in
                                    </button>
                                </p>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
