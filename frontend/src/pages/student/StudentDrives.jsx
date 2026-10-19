import React, { useState, useEffect } from 'react';
import {
    Building2,
    CheckCircle2,
    AlertCircle,
    Send,
    RefreshCw,
    X,
    ChevronRight,
    IndianRupee,
    GraduationCap,
    CalendarClock,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import studentApi from '../../services/studentApi';
import { PageHero, Stagger, StaggerItem, EmptyState } from '../../components/student-ui/StudentMotion';
import { EASE } from '../../components/home/primitives';

const StudentDrives = () => {
    const [drives, setDrives] = useState([]);
    const [applications, setApplications] = useState([]);
    const [activeTab, setActiveTab] = useState('drives'); // 'drives' | 'applications'
    const [isLoading, setIsLoading] = useState(true);

    // Apply modal
    const [selectedDrive, setSelectedDrive] = useState(null);
    const [applyNotes, setApplyNotes] = useState('');
    const [isApplying, setIsApplying] = useState(false);
    const [applyError, setApplyError] = useState(null);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [drivesData, appsData] = await Promise.all([
                studentApi.getAvailableDrives(),
                studentApi.getDriveApplications()
            ]);
            setDrives(drivesData || []);
            setApplications(appsData || []);
        } catch (err) {
            console.error('Failed to load student drives:', err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const handleApplySubmit = async (e) => {
        e.preventDefault();
        if (!selectedDrive) return;

        setIsApplying(true);
        setApplyError(null);
        try {
            await studentApi.applyToDrive(selectedDrive.id, applyNotes.trim() || null);
            setSelectedDrive(null);
            setApplyNotes('');
            loadData();
        } catch (err) {
            console.error('Failed to apply to drive:', err);
            setApplyError(err.response?.data?.detail || 'Application submission failed.');
        } finally {
            setIsApplying(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <PageHero
                icon={Building2}
                eyebrow="On-campus recruitment"
                title="Campus Placement Drives"
                subtitle="Explore exclusive on-campus recruitment opportunities organized by your college placement cell."
            />

            {/* Navigation Tabs */}
            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3 overflow-x-auto">
                {[
                    { id: 'drives', Icon: Building2, text: `Available Drives (${drives.length})` },
                    { id: 'applications', Icon: Send, text: `My Applications (${applications.length})` },
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`relative px-4 min-h-[44px] rounded-xl text-xs font-semibold transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                            activeTab === tab.id
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60'
                        }`}
                    >
                        {activeTab === tab.id && (
                            <motion.span
                                layoutId="drives-tab-pill"
                                aria-hidden="true"
                                className="absolute inset-0 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 shadow-xs"
                                transition={{ type: 'spring', stiffness: 400, damping: 34 }}
                            />
                        )}
                        <tab.Icon className="relative w-4 h-4" />
                        <span className="relative">{tab.text}</span>
                    </button>
                ))}
            </div>

            {isLoading ? (
                <div className="space-y-5">
                    <div className="flex items-center justify-center gap-2.5 pt-2">
                        <RefreshCw className="w-5 h-5 text-emerald-600 dark:text-emerald-400 animate-spin motion-reduce:animate-none" />
                        <p className="text-xs text-slate-500 dark:text-slate-400">Loading campus placement drives...</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5" aria-hidden="true">
                        {[0, 1, 2].map(i => (
                            <div key={i} className="h-56 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
                                <div className="h-4 w-1/2 rounded bg-slate-100 dark:bg-slate-800 animate-pulse motion-reduce:animate-none" />
                                <div className="h-3 w-1/3 rounded bg-slate-100 dark:bg-slate-800 animate-pulse motion-reduce:animate-none" />
                                <div className="h-3 w-full rounded bg-slate-100 dark:bg-slate-800 animate-pulse motion-reduce:animate-none" />
                                <div className="h-3 w-5/6 rounded bg-slate-100 dark:bg-slate-800 animate-pulse motion-reduce:animate-none" />
                                <div className="h-9 w-full rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse motion-reduce:animate-none mt-6" />
                            </div>
                        ))}
                    </div>
                </div>
            ) : activeTab === 'drives' ? (
                drives.length === 0 ? (
                    <EmptyState
                        icon={Building2}
                        title="No active drives announced"
                        body="Your college placement officer has not announced any open campus placement drives yet. Meanwhile, sharpen your skills in Practice and Mock Interview so you are ready when one opens."
                    />
                ) : (
                    <Stagger className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        {drives.map((drive) => {
                            const isEligible = drive.is_eligible !== false;
                            const hasApplied = drive.has_applied;

                            return (
                                <StaggerItem key={drive.id} className="h-full">
                                <div
                                    className={`h-full bg-white dark:bg-slate-900 border rounded-2xl p-4 sm:p-5 flex flex-col justify-between shadow-xs hover:-translate-y-1 hover:shadow-lg transition-all duration-300 group ${
                                        isEligible && !hasApplied
                                            ? 'border-emerald-300/70 dark:border-emerald-500/30 hover:border-emerald-500/60'
                                            : 'border-slate-200/90 dark:border-slate-800 hover:border-emerald-500/40'
                                    }`}
                                >
                                    <div>
                                        <div className="flex items-start justify-between gap-2 mb-2">
                                            <div className="min-w-0">
                                                <h3 className="font-bold text-slate-900 dark:text-white text-base break-words group-hover:text-emerald-600 dark:group-hover:text-emerald-300 transition-colors">
                                                    {drive.company_name}
                                                </h3>
                                                <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">{drive.role_title}</p>
                                            </div>

                                            {/* Eligibility Badge */}
                                            {hasApplied ? (
                                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30">
                                                    APPLIED
                                                </span>
                                            ) : isEligible ? (
                                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30">
                                                    ELIGIBLE
                                                </span>
                                            ) : (
                                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30">
                                                    INELIGIBLE
                                                </span>
                                            )}
                                        </div>

                                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-2 line-clamp-3">
                                            {drive.description}
                                        </p>

                                        {/* Criteria highlights */}
                                        <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
                                            <div className="rounded-xl bg-emerald-50/70 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 px-3 py-2">
                                                <span className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1"><IndianRupee className="w-3 h-3" />Package</span>
                                                <span className="font-bold text-slate-900 dark:text-white">
                                                    {drive.package_lpa ? `₹${drive.package_lpa} LPA` : 'As per policy'}
                                                </span>
                                            </div>
                                            <div className={`rounded-xl px-3 py-2 border ${
                                                isEligible
                                                    ? 'bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-700/60'
                                                    : 'bg-amber-50/70 dark:bg-amber-500/10 border-amber-200/80 dark:border-amber-500/20'
                                            }`}>
                                                <span className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1"><GraduationCap className="w-3 h-3" />Cutoff</span>
                                                <span className="font-bold text-slate-900 dark:text-white">
                                                    {drive.minimum_cgpa > 0 ? `${drive.minimum_cgpa} CGPA` : 'No cutoff'}
                                                </span>
                                            </div>
                                        </div>
                                        {(drive.application_deadline || drive.deadline) && (
                                            <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                                                <CalendarClock className="w-3 h-3" />
                                                Apply by {new Date(drive.application_deadline || drive.deadline).toLocaleDateString()}
                                            </div>
                                        )}

                                        {/* Skills pills */}
                                        {drive.required_skills?.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5 mt-3">
                                                {drive.required_skills.map((sk, idx) => (
                                                    <span key={idx} className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] border border-slate-200 dark:border-slate-700">
                                                        {sk}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {/* Action Button */}
                                    <div className="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800">
                                        {hasApplied ? (
                                            <div className="w-full min-h-[44px] py-2 bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold text-center flex items-center justify-center gap-1.5">
                                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                                <span>Application Submitted ({drive.application_status || 'Applied'})</span>
                                            </div>
                                        ) : !isEligible ? (
                                            <div className="w-full min-h-[44px] py-2 bg-amber-50 dark:bg-slate-800 text-amber-800 dark:text-amber-400 rounded-xl text-xs text-center border border-amber-200 dark:border-amber-500/20 flex items-center justify-center gap-1.5">
                                                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                                <span>CGPA below cutoff ({drive.minimum_cgpa})</span>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => {
                                                    setSelectedDrive(drive);
                                                    setApplyError(null);
                                                }}
                                                className="w-full min-h-[44px] py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs font-semibold transition-all shadow-xs hover:shadow-lg hover:shadow-emerald-500/25 active:scale-[0.97] flex items-center justify-center gap-1.5 cursor-pointer group/apply"
                                            >
                                                <span>Apply to Drive</span>
                                                <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover/apply:translate-x-1" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                </StaggerItem>
                            );
                        })}
                    </Stagger>
                )
            ) : (
                /* Applications Tab */
                applications.length === 0 ? (
                    <EmptyState
                        icon={Send}
                        title="No active applications"
                        body="You haven't submitted any applications to on-campus placement drives yet."
                        action={(
                            <button
                                onClick={() => setActiveTab('drives')}
                                className="px-4 min-h-[44px] bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-all active:scale-95"
                            >
                                Browse available drives
                            </button>
                        )}
                    />
                ) : (
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl overflow-x-auto shadow-xs">
                        <table className="w-full min-w-[640px] text-left text-xs border-collapse">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[11px]">
                                    <th className="py-3.5 px-4 font-semibold">Company & Role</th>
                                    <th className="py-3.5 px-4 font-semibold">Applied Date</th>
                                    <th className="py-3.5 px-4 font-semibold">Status</th>
                                    <th className="py-3.5 px-4 font-semibold">Notes</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-900 dark:text-slate-200">
                                {applications.map((app, appIdx) => {
                                    let statusColor = 'bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30';
                                    if (app.status === 'SHORTLISTED') statusColor = 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30';
                                    if (app.status === 'PLACED') statusColor = 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30';
                                    if (app.status === 'REJECTED') statusColor = 'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-500/30';

                                    return (
                                        <motion.tr
                                            key={app.id}
                                            initial={{ opacity: 0, x: -14 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ duration: 0.4, delay: Math.min(appIdx, 10) * 0.05, ease: EASE }}
                                            className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                                        >
                                            <td className="py-3.5 px-4">
                                                <div className="font-semibold text-slate-900 dark:text-white">{app.company_name}</div>
                                                <div className="text-[11px] text-emerald-600 dark:text-emerald-400">{app.role_title}</div>
                                            </td>
                                            <td className="py-3.5 px-4 text-slate-500 dark:text-slate-400">
                                                {new Date(app.applied_at).toLocaleDateString()}
                                            </td>
                                            <td className="py-3.5 px-4">
                                                <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border whitespace-nowrap ${statusColor}`}>
                                                    {app.status}
                                                </span>
                                            </td>
                                            <td className="py-3.5 px-4 text-slate-500 dark:text-slate-400 italic">
                                                {app.notes || '—'}
                                            </td>
                                        </motion.tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )
            )}

            {/* Apply Confirmation Modal */}
            <AnimatePresence>
            {selectedDrive && (
                <motion.div
                    key="apply-modal"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
                >
                    <motion.div
                        initial={{ opacity: 0, y: 40, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 24, scale: 0.98 }}
                        transition={{ duration: 0.3, ease: EASE }}
                        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-2xl sm:rounded-2xl w-full max-w-md p-4 sm:p-6 max-h-[90vh] overflow-y-auto shadow-xl space-y-4"
                    >
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                            <div>
                                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                                    Apply to {selectedDrive.company_name}
                                </h2>
                                <p className="text-xs text-emerald-600 dark:text-emerald-400">{selectedDrive.role_title}</p>
                            </div>
                            <button
                                onClick={() => setSelectedDrive(null)}
                                aria-label="Close"
                                className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {applyError && (
                            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-500/15 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs">
                                {applyError}
                            </div>
                        )}

                        <form onSubmit={handleApplySubmit} className="space-y-4 text-xs">
                            <p className="text-slate-600 dark:text-slate-300">
                                Your verified profile, academic CGPA, and latest ATS resume will be submitted to the college placement officer for candidate shortlisting.
                            </p>

                            <div>
                                <label className="block text-slate-700 dark:text-slate-300 mb-1 font-semibold">
                                    Candidate Note (Optional)
                                </label>
                                <textarea
                                    rows="3"
                                    value={applyNotes}
                                    onChange={(e) => setApplyNotes(e.target.value)}
                                    placeholder="Highlight any relevant achievements, competitive ratings, or interests..."
                                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-sans text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
                                />
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => setSelectedDrive(null)}
                                    className="h-11 px-4 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl transition-colors cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isApplying}
                                    className="h-11 px-5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-semibold rounded-xl transition-all shadow-xs active:scale-95 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                                >
                                    {isApplying ? 'Submitting...' : 'Submit Application'}
                                </button>
                            </div>
                        </form>
                    </motion.div>
                </motion.div>
            )}
            </AnimatePresence>
        </div>
    );
};

export default StudentDrives;
