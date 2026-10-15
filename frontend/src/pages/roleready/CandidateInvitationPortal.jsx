import React, { useState, useEffect } from 'react';
import { useSearchParams, useParams, useNavigate } from 'react-router-dom';
import {
    Award,
    ShieldCheck,
    ArrowRight,
    AlertTriangle,
    RefreshCw,
    BrainCircuit,
    Code2,
    MessageSquare,
    Sun,
    Moon,
} from 'lucide-react';
import rolereadyApi from '../../services/rolereadyApi';
import { useTheme } from '../../context/ThemeContext';

const CandidateInvitationPortal = () => {
    const { invitationToken } = useParams();
    const [searchParams] = useSearchParams();
    const token = invitationToken || searchParams.get('token');
    const navigate = useNavigate();
    const { theme, toggleTheme } = useTheme();

    const [inviteData, setInviteData] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const verify = async () => {
            if (!token) {
                setError("No invitation token provided in the link.");
                setIsLoading(false);
                return;
            }
            try {
                const res = await rolereadyApi.verifyInvitation(token);
                setInviteData(res);
                localStorage.setItem('invitationToken', token);
            } catch (err) {
                console.error("Failed to verify invitation:", err);
                setError(err.response?.data?.detail || "Invalid or expired invitation token.");
            } finally {
                setIsLoading(false);
            }
        };
        verify();
    }, [token]);

    const handleStart = () => {
        if (inviteData?.session_uuid) {
            navigate(`/assessment/${inviteData.session_uuid}`);
        }
    };

    if (isLoading) {
        return (
            <div className="rr-page flex flex-col items-center justify-center gap-3">
                <RefreshCw className="w-8 h-8 text-[var(--brand)] animate-spin" />
                <p className="rr-muted-text text-xs">Verifying secure candidate invitation...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="rr-page flex flex-col items-center justify-center p-6 text-center">
                <div className="max-w-md w-full rr-card border border-rose-500/30 rounded-2xl p-8 shadow-xl">
                    <AlertTriangle className="w-12 h-12 text-rose-500 mx-auto mb-3" />
                    <h2 className="text-lg font-bold text-[var(--rr-text)]">Invitation Invalid</h2>
                    <p className="text-xs text-[var(--rr-muted)] mt-2 leading-relaxed">{error}</p>
                    <p className="text-[11px] text-[var(--rr-faint)] mt-4">
                        Please check with your recruiter or organization administrator for an updated link.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="rr-page flex flex-col justify-center items-center p-4 sm:p-6 font-sans relative">
            {/* Top Bar with Branding & Theme Toggle */}
            <div className="w-full max-w-lg flex items-center justify-between mb-4 px-1">
                <div className="flex items-center gap-2.5">
                    <img src="/logo_main.png" alt="ThirdEye" className="h-6 w-auto object-contain" />
                    <span className="text-sm font-bold text-[var(--rr-text)] tracking-tight">PrepWin</span>
                </div>
                <button
                    type="button"
                    onClick={toggleTheme}
                    aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--rr-muted)] hover:text-[var(--rr-text)] hover:bg-[var(--rr-surface)] border border-[var(--rr-border)] transition-colors"
                >
                    {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4" />}
                </button>
            </div>

            <div className="max-w-lg w-full rr-card border border-[var(--rr-border)] rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
                <div className="text-center space-y-2">
                    <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto text-[var(--brand)]">
                        <Award className="w-6 h-6" />
                    </div>
                    <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                        Workflow B: Recruiter-Managed Assessment
                    </span>
                    <h1 className="text-2xl font-extrabold text-[var(--rr-text)] tracking-tight">
                        Welcome, {inviteData?.candidate_name}
                    </h1>
                    <p className="text-xs text-[var(--rr-muted)]">
                        You have been invited to complete a sequential 3-round assessment for the role:
                    </p>
                    <div className="inline-block px-4 py-1.5 rounded-xl bg-[var(--rr-bg)] border border-[var(--rr-border)] text-[var(--rr-text)] font-bold text-sm mt-1">
                        {inviteData?.target_role}
                    </div>
                </div>

                {/* Round Structure Preview */}
                <div className="space-y-2.5 pt-1">
                    <div className="p-3 bg-[var(--rr-bg)] rounded-xl border border-[var(--rr-border)] flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-[var(--brand)] shrink-0">
                            <BrainCircuit className="w-4 h-4" />
                        </div>
                        <div>
                            <span className="text-xs font-bold text-[var(--rr-text)] block">Round 1: Role Aptitude & Logic</span>
                            <span className="text-[11px] text-[var(--rr-muted)]">20 minutes • Quantitative & reasoning MCQs</span>
                        </div>
                    </div>

                    <div className="p-3 bg-[var(--rr-bg)] rounded-xl border border-[var(--rr-border)] flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-500 shrink-0">
                            <Code2 className="w-4 h-4" />
                        </div>
                        <div>
                            <span className="text-xs font-bold text-[var(--rr-text)] block">Round 2: Practical Coding</span>
                            <span className="text-[11px] text-[var(--rr-muted)]">45 minutes • Sandboxed code tests</span>
                        </div>
                    </div>

                    <div className="p-3 bg-[var(--rr-bg)] rounded-xl border border-[var(--rr-border)] flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 shrink-0">
                            <MessageSquare className="w-4 h-4" />
                        </div>
                        <div>
                            <span className="text-xs font-bold text-[var(--rr-text)] block">Round 3: Technical Interview</span>
                            <span className="text-[11px] text-[var(--rr-muted)]">20 minutes • Conceptual & behavioral audio session</span>
                        </div>
                    </div>
                </div>

                {/* Security & Proctoring Callout */}
                <div className="p-3.5 bg-emerald-50/60 dark:bg-emerald-950/20 rounded-xl border border-emerald-200 dark:border-emerald-800/40 flex items-start gap-3 text-xs text-slate-700 dark:text-slate-300">
                    <ShieldCheck className="w-4 h-4 text-[var(--brand)] shrink-0 mt-0.5" />
                    <span>
                        This assessment requires camera and fullscreen permissions. Rounds are evaluated sequentially on the server.
                    </span>
                </div>

                <button
                    onClick={handleStart}
                    className="w-full py-3 px-5 rounded-xl rr-btn-primary text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm hover:shadow-md"
                >
                    <span>Start Proctored Assessment</span>
                    <ArrowRight className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
};

export default CandidateInvitationPortal;
