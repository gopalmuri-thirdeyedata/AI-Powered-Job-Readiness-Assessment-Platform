import React, { useState } from 'react';
import { User, Phone, Mail, Loader2, AlertCircle } from 'lucide-react';
import { COUNTRY_CODES, validateRegistration } from '../../utils/registrationValidation';

/**
 * Mandatory 3-field registration popup: Full Name, Phone Number (with country code), Email Address.
 * No OTP, no verification code, no password, no account. Details are self-reported and unverified.
 */
const inputClass = (hasError) =>
    `w-full rounded-xl border px-3.5 py-2.5 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder-slate-400
     focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/30 focus:border-[#5d8c2c] transition-colors
     ${hasError ? 'border-red-400 dark:border-red-500' : 'border-slate-200 dark:border-slate-700'}`;

const CandidateRegistrationModal = ({ assessmentTitle, onSubmit, submitting = false, serverError = '' }) => {
    const [name, setName] = useState('');
    const [countryCode, setCountryCode] = useState('+1');
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [errors, setErrors] = useState({});

    const handleSubmit = (e) => {
        e.preventDefault();
        if (submitting) return;
        const result = validateRegistration({ name, countryCode, phone, email });
        setErrors(result.errors);
        if (result.valid) onSubmit(result.payload);
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="candidate-reg-title">
            <form
                onSubmit={handleSubmit}
                noValidate
                className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 sm:p-7 space-y-5"
            >
                <div>
                    <h2 id="candidate-reg-title" className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                        Register for the assessment
                    </h2>
                    {assessmentTitle && (
                        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{assessmentTitle}</p>
                    )}
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                        Your details are used only to identify you to the hiring team. No account or verification code is needed.
                    </p>
                </div>

                <label className="block">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5"><User size={14} /> Full Name</span>
                    <input
                        type="text" name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)}
                        className={inputClass(!!errors.name)} placeholder="e.g. Priya Sharma" maxLength={150} aria-invalid={!!errors.name}
                    />
                    {errors.name && <span className="text-xs text-red-600 dark:text-red-400 mt-1 block">{errors.name}</span>}
                </label>

                <label className="block">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5"><Phone size={14} /> Phone Number</span>
                    <div className="flex gap-2">
                        <select
                            name="country_code" value={countryCode} onChange={(e) => setCountryCode(e.target.value)} aria-label="Country code"
                            className={`${inputClass(false)} !w-[7.5rem] shrink-0`}
                        >
                            {COUNTRY_CODES.map((c) => (
                                <option key={c.code + c.label} value={c.code}>{c.label}</option>
                            ))}
                        </select>
                        <input
                            type="tel" name="phone" autoComplete="tel-national" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                            className={inputClass(!!errors.phone)} placeholder="Phone number" maxLength={20} aria-invalid={!!errors.phone}
                        />
                    </div>
                    {errors.phone && <span className="text-xs text-red-600 dark:text-red-400 mt-1 block">{errors.phone}</span>}
                </label>

                <label className="block">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5"><Mail size={14} /> Email Address</span>
                    <input
                        type="email" name="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
                        className={inputClass(!!errors.email)} placeholder="you@example.com" maxLength={150} aria-invalid={!!errors.email}
                    />
                    {errors.email && <span className="text-xs text-red-600 dark:text-red-400 mt-1 block">{errors.email}</span>}
                </label>

                {serverError && (
                    <div className="flex items-start gap-2 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3 py-2.5 text-sm text-red-700 dark:text-red-300" role="alert">
                        <AlertCircle size={16} className="mt-0.5 shrink-0" /> <span>{serverError}</span>
                    </div>
                )}

                <button
                    type="submit" disabled={submitting}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#5d8c2c] hover:bg-[#4c7324] disabled:opacity-60 text-white font-bold text-sm py-3 transition-colors focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/40"
                >
                    {submitting ? <><Loader2 size={16} className="animate-spin" /> Registering...</> : 'Continue'}
                </button>
            </form>
        </div>
    );
};

export default CandidateRegistrationModal;
