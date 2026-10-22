import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';

/**
 * Shown in place of a student page until the student has attempted their first assessment.
 * `feature` names what the student clicked so the message says what the assessment unlocks.
 */
const AssessmentRequiredGate = ({ feature = 'your performance dashboard and career readiness metrics' }) => (
    <div id="assessment-required-gate" className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6">
        <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center mb-4">
            <Sparkles className="w-7 h-7 text-emerald-600 dark:text-emerald-400 animate-pulse motion-reduce:animate-none" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Initial Assessment Required</h2>
        <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm max-w-md mb-6 leading-relaxed">
            Welcome to PrepWin! To unlock {feature}, please complete your first 3-round assessment (Aptitude, Coding, and AI Technical Interview).
        </p>
        <Link
            to="/assessment/setup"
            className="px-6 py-3 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs sm:text-sm shadow-md shadow-emerald-600/20 transition-all inline-flex items-center gap-2 cursor-pointer"
        >
            <span>Start Your Assessment Now</span>
            <ArrowRight className="w-4 h-4" />
        </Link>
    </div>
);

export default AssessmentRequiredGate;
