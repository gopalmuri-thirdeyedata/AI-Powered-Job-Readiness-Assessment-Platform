import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, ArrowRight, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const CandidateLoginModal = ({ isOpen, onClose }) => {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleLogin = (e) => {
        e.preventDefault();
        setIsLoading(true);

        // Simulate Verification & Routing Logic
        setTimeout(() => {
            setIsLoading(false);
            onClose();
            // Mock Routing - In a real app this would store token and redirect based on assigned round
            // For now, default to Instructions page which will handle the flow
            navigate('/portal/instructions');
        }, 1500);
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
                {/* Backdrop - Solid Dark Overlay */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                    className="absolute inset-0 bg-slate-900"
                />

                {/* Modal */}
                <motion.div
                    initial={{ scale: 0.95, opacity: 0, y: 10 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.95, opacity: 0, y: 10 }}
                    className="relative w-full max-w-md bg-white rounded-xl shadow-2xl overflow-hidden"
                >
                    {/* Close Button */}
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-full hover:bg-gray-100"
                    >
                        <X size={20} />
                    </button>

                    <div className="p-8">
                        <div className="text-center mb-6">
                            <div className="flex justify-center mb-4">
                                <img src="/logo_main.png" alt="ThirdEye Data Logo" className="h-12 w-auto object-contain" />
                            </div>
                            <h2 className="text-2xl font-bold text-gray-900">Candidate Login</h2>
                            <p className="text-gray-500 text-sm mt-1">
                                Secure Assessment Portal
                            </p>
                        </div>

                        <form onSubmit={handleLogin} className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider ml-1">Full Name</label>
                                <input
                                    type="text"
                                    required
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-600 focus:bg-white focus:outline-none transition-all text-sm font-medium text-gray-900"
                                    placeholder="John Doe"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider ml-1">Email ID</label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-3 text-gray-400" size={18} />
                                    <input
                                        type="email"
                                        required
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-600 focus:bg-white focus:outline-none transition-all text-sm font-medium text-gray-900"
                                        placeholder="candidate@example.com"
                                    />
                                </div>
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider ml-1">Password</label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-3 text-gray-400" size={18} />
                                    <input
                                        type="password"
                                        required
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-600 focus:bg-white focus:outline-none transition-all text-sm font-medium text-gray-900"
                                        placeholder="••••••••"
                                    />
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={isLoading}
                                className={`w-full py-3.5 rounded-lg text-white font-bold shadow-md flex items-center justify-center gap-2 mt-2 transition-all ${isLoading ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 hover:shadow-lg active:scale-[0.98]'
                                    }`}
                            >
                                {isLoading ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        Verifying Credentials...
                                    </>
                                ) : (
                                    <>
                                        Access Assessment <ArrowRight size={18} />
                                    </>
                                )}
                            </button>
                        </form>
                    </div>

                    <div className="bg-gray-50 px-8 py-3 text-center border-t border-gray-100">
                        <p className="text-xs text-gray-500">
                            Secure Testing Environment &bull; v2.4.0
                        </p>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};

export default CandidateLoginModal;
