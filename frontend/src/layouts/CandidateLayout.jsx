import React, { useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout } from 'lucide-react';

const CandidateLayout = () => {
    const navigate = useNavigate();
    const location = useLocation();

    // --- Strict Auth Guard ---
    useEffect(() => {
        const token = localStorage.getItem('candidateToken');
        // Only allow access to login page without token
        if (!token && location.pathname !== '/portal/login') {
            navigate('/portal/login');
        }
    }, [location, navigate]); // Check eagerly on every location change
    // -------------------------

    // Detect if current route is an assessment or start page (needs full-width/clean)
    const isAssessment = location.pathname.includes('/portal/assessment') || location.pathname.includes('/portal/start');

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-900">
            {/* Minimal Header - Hide for assessments and start page */}
            {!isAssessment && (
                <header className="bg-white border-b border-gray-200 py-3 sm:py-4 px-4 sm:px-6 md:px-12 flex items-center justify-between shadow-sm z-10 gap-2">
                    <div className="flex items-center gap-3 sm:gap-4">
                        <img src="/logo_main.png" alt="ThirdEye Data Logo" className="h-7 sm:h-8 w-auto object-contain" />
                        <div className="hidden sm:block w-[1.5px] h-7 bg-gray-300" />
                        <span className="text-lg sm:text-xl font-bold text-[#5d8c2c] tracking-tight">RoleReady</span>
                    </div>
                    <div className="text-[11px] sm:text-xs font-medium text-gray-500 bg-gray-100 px-2.5 sm:px-3 py-1 rounded-full whitespace-nowrap">
                        <span className="hidden xs:inline">Secure </span>Assessment
                    </div>
                </header>
            )}

            {/* Main Focus Area - Conditional Layout */}
            {isAssessment ? (
                // Full-width for assessments
                <main className="flex-1 flex flex-col overflow-hidden">
                    <Outlet />
                </main>
            ) : (
                // Centered layout for other pages
                <main className="flex-1 flex flex-col items-center justify-center p-6 md:p-12 pb-32 relative overflow-y-auto overflow-x-hidden">
                    {/* Background Decor */}
                    <div className="absolute inset-0 z-0 opacity-30 pointer-events-none">
                        <div className="absolute top-0 left-0 w-96 h-96 bg-blue-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob"></div>
                        <div className="absolute top-0 right-0 w-96 h-96 bg-purple-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000"></div>
                    </div>

                    <div className="w-full max-w-4xl z-10">
                        <Outlet />
                    </div>
                </main>
            )}

            {/* Simple Footer - Hide for assessments */}
            {!isAssessment && (
                <footer className="py-4 text-center text-xs text-gray-400 bg-white border-t border-gray-100 flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
                    <span>&copy; {new Date().getFullYear()} RoleReady. All rights reserved.</span>
                    <span className="text-gray-300 select-none">·</span>
                    <span className="text-gray-500 font-medium text-[11px]">Developed by Gopal Muri · ThirdEye Data</span>
                </footer>
            )}
        </div>
    );
};

export default CandidateLayout;
