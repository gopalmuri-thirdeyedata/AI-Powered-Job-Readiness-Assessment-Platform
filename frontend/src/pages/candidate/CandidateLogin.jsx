import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, ArrowRight, ShieldCheck, UserCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import API_URL from '../../apiConfig';
import ConfirmationModal from '../../components/ConfirmationModal';

const CandidateLogin = () => {
    const navigate = useNavigate();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [autoChecking, setAutoChecking] = useState(true); // Show spinner while checking token

    // Centered Alert Modal State
    const [alertModal, setAlertModal] = useState({
        isOpen: false,
        title: '',
        message: '',
        type: 'danger',
        onConfirm: null
    });
    const showAlert = (title, message, type = 'danger', onConfirm = null) => {
        setAlertModal({
            isOpen: true,
            title,
            message,
            type,
            onConfirm
        });
    };

    // ── Smart session check on mount ──
    useEffect(() => {
        const token = localStorage.getItem('candidateToken');
        if (!token) { setAutoChecking(false); return; }

        // Always validate the stored token against the backend first
        fetch(`${API_URL}/api/assessments/my-status/`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(res => {
            if (!res.ok) throw new Error('Token invalid or expired');
            return res.json();
        })
        .then(latest => {
            if (latest.status === 'completed') {
                // Already submitted — show message, clear token, no login needed
                localStorage.removeItem('candidateToken');
                localStorage.removeItem('currentAssessment');
                localStorage.removeItem('aptitudeQuestions');
                showAlert('Assessment Completed', 'Your assessment has already been submitted. Thank you for participating!', 'info');
                setAutoChecking(false);
                return;
            }

            // Assessment is still pending — check if this is a mid-session refresh
            const referrer = document.referrer || '';
            const isInternalNavigation = referrer.includes('/portal/');

            if (isInternalNavigation) {
                // Mid-session refresh — auto-resume without re-login
                localStorage.setItem('currentAssessment', JSON.stringify(latest));
                navigate('/portal/start');
            } else {
                // Fresh visit (email link, new tab) — require fresh login
                localStorage.removeItem('candidateToken');
                localStorage.removeItem('currentAssessment');
                localStorage.removeItem('aptitudeQuestions');
                setAutoChecking(false);
            }
        })
        .catch(() => {
            // Token is invalid/expired — clear it and show login form
            localStorage.removeItem('candidateToken');
            localStorage.removeItem('currentAssessment');
            localStorage.removeItem('aptitudeQuestions');
            setAutoChecking(false);
        });
    }, []);

    const handleMagicLogin = async (token) => {
        setIsLoading(true);
        try {
            // Validate Token by fetching Status
            const asmResponse = await fetch(`${API_URL}/api/assessments/my-status/`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!asmResponse.ok) throw new Error("Invalid or Expired Magic Link");

            const latest = await asmResponse.json();

            // Clear ALL local state before NEW login
            localStorage.removeItem('candidateToken');
            localStorage.removeItem('candidateName');
            localStorage.removeItem('currentAssessment');
            localStorage.removeItem('aptitudeQuestions');

            // Store Token & Config
            localStorage.setItem('candidateToken', token);
            // We might not have the name, but that's okay, maybe extract from token or fetched data?
            // For now, let's just proceed.
            if (latest.status === 'completed') {
                localStorage.removeItem('candidateToken');
                localStorage.removeItem('currentAssessment');
                localStorage.removeItem('aptitudeQuestions');
                showAlert('Assessment Completed', 'This assessment has already been submitted. You cannot attempt it again.', 'warning');
                setIsLoading(false);
                return;
            }

            localStorage.setItem('currentAssessment', JSON.stringify(latest));
            navigate('/portal/start');

        } catch (error) {
            console.error("Magic Login Failed:", error);
            showAlert('Magic Link Login Failed', error.message || 'Unable to log in with magic link.', 'danger');
            // Clear URL param to prevent loop/confusion
            window.history.replaceState({}, document.title, window.location.pathname);
        } finally {
            setIsLoading(false);
        }
    };
    // ---------------------------

    const handleLogin = async (e) => {
        e.preventDefault();
        setIsLoading(true);

        try {
            // 1. Authenticate (Get Token)
            const authResponse = await fetch(`${API_URL}/api/auth/candidate-login/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: email.trim(),
                    password: password.trim()
                })
            });

            if (!authResponse.ok) {
                const errorData = await authResponse.json().catch(() => ({}));
                throw new Error(errorData.detail || "Invalid credentials");
            }

            const authData = await authResponse.json();
            const token = authData.access;

            // Clear ALL local state before NEW login
            localStorage.removeItem('candidateToken');
            localStorage.removeItem('candidateName');
            localStorage.removeItem('currentAssessment');
            localStorage.removeItem('aptitudeQuestions');

            localStorage.setItem('candidateToken', token);
            localStorage.setItem('candidateName', name);

            // 2. Fetch Latest Assessment Status
            // We use the token to authorize this request
            const asmResponse = await fetch(`${API_URL}/api/assessments/my-status/`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!asmResponse.ok) throw new Error("Failed to fetch assessment status");

            const latest = await asmResponse.json();

            if (!latest) {
                showAlert('No Assessment Found', 'No assessment found for this account. Please contact your administrator.', 'warning');
                setIsLoading(false);
                return;
            }
            if (latest.status === 'completed') {
                localStorage.removeItem('candidateToken');
                localStorage.removeItem('currentAssessment');
                localStorage.removeItem('aptitudeQuestions');
                showAlert('Assessment Completed', 'All assessments have been completed. Thank you for participating!', 'info');
                setIsLoading(false);
                return;
            }

            // Store config and Route to Start Page
            localStorage.setItem('currentAssessment', JSON.stringify(latest));
            navigate('/portal/start');


        } catch (error) {
            console.error(error);
            showAlert('Login Failed', error.message || 'Login Failed', 'danger');
        } finally {
            setIsLoading(false);
        }
    };

    // Show spinner while auto-checking stored token
    if (autoChecking) {
        return (
            <div className="w-full max-w-lg mx-auto py-2 flex flex-col items-center justify-center gap-4" style={{ minHeight: '200px' }}>
                <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                <p className="text-gray-500 text-sm">Checking your session...</p>
            </div>
        );
    }

    return (
        <div className="w-full max-w-lg mx-auto py-2">
            <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="bg-white/80 backdrop-blur-xl border border-white/50 rounded-2xl shadow-xl p-6"
            >
                <div className="text-center mb-6">
                    <div className="w-14 h-14 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-3 border border-blue-100">
                        <ShieldCheck className="text-blue-600" size={28} />
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900">Welcome Candidate</h2>
                    <p className="text-gray-500 text-sm mt-1">
                        Please enter your credentials to access your secure assessment.
                    </p>
                </div>

                <form onSubmit={handleLogin} className="space-y-4" autoComplete="off">
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-700 ml-1 uppercase tracking-wide">User Name</label>
                        <div className="relative">
                            <UserCircle className="absolute left-4 top-3 text-gray-400" size={18} />
                            <input
                                type="text"
                                required
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full pl-11 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white focus:outline-none transition-all text-gray-900 font-medium"
                                placeholder="John Doe"
                                autoComplete="off"
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-700 ml-1 uppercase tracking-wide">Email ID</label>
                        <div className="relative">
                            <Mail className="absolute left-4 top-3 text-gray-400" size={18} />
                            <input
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full pl-11 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white focus:outline-none transition-all text-gray-900 font-medium"
                                placeholder="name@example.com"
                                autoComplete="off"
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-700 ml-1 uppercase tracking-wide">Password</label>
                        <div className="relative">
                            <Lock className="absolute left-4 top-3 text-gray-400" size={18} />
                            <input
                                type="password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full pl-11 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white focus:outline-none transition-all text-gray-900 font-medium text-lg tracking-widest"
                                placeholder="••••••••"
                                autoComplete="new-password"
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading}
                        className={`w-full py-3 rounded-xl text-white font-bold text-lg shadow-lg flex items-center justify-center gap-2 transition-all transform hover:scale-[1.02] ${isLoading ? 'bg-gray-400 cursor-not-allowed' : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700'
                            }`}
                    >
                        {isLoading ? (
                            <span className="flex items-center gap-2 text-base">
                                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                Verifying Credentials...
                            </span>
                        ) : (
                            <>
                                Start Assessment <ArrowRight size={20} />
                            </>
                        )}
                    </button>
                </form>

                <div className="mt-8 text-center">
                    <p className="text-xs text-gray-400">
                        Protected by SecureGuard™ Proctoring System. <br />
                        Your IP and Browser activity will be monitored.
                    </p>
                </div>
            </motion.div>

            {/* Centered In-App Alert Modal */}
            <ConfirmationModal
                isOpen={alertModal.isOpen}
                onClose={() => setAlertModal(prev => ({ ...prev, isOpen: false }))}
                onConfirm={alertModal.onConfirm}
                title={alertModal.title}
                message={alertModal.message}
                type={alertModal.type}
                confirmText="OK"
                isAlert={true}
            />
        </div>
    );
};

export default CandidateLogin;
