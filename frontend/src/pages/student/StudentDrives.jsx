import React, { useState, useEffect } from 'react';
import {
    Building2,
    CheckCircle2,
    AlertCircle,
    Send,
    RefreshCw,
    X,
    ChevronRight,
} from 'lucide-react';
import studentApi from '../../services/studentApi';

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
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2.5">
                        <Building2 className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
                        <span>Campus Placement Drives</span>
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Explore exclusive on-campus recruitment opportunities organized by your college placement cell.
                    </p>
                </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                <button
                    onClick={() => setActiveTab('drives')}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
                        activeTab === 'drives'
                            ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 shadow-xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60'
                    }`}
                >
                    <Building2 className="w-4 h-4" />
                    <span>Available Drives ({drives.length})</span>
                </button>
                <button
                    onClick={() => setActiveTab('applications')}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
                        activeTab === 'applications'
                            ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 shadow-xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60'
                    }`}
                >
                    <Send className="w-4 h-4" />
                    <span>My Applications ({applications.length})</span>
                </button>
            </div>

            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <RefreshCw className="w-7 h-7 text-emerald-600 dark:text-emerald-400 animate-spin" />
                    <p className="text-xs text-slate-500 dark:text-slate-400">Loading campus placement drives...</p>
                </div>
            ) : activeTab === 'drives' ? (
                drives.length === 0 ? (
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-12 text-center space-y-3 shadow-xs">
                        <Building2 className="w-12 h-12 text-slate-400 dark:text-slate-600 mx-auto" />
                        <h3 className="text-base font-semibold text-slate-900 dark:text-white">No active drives announced</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                            Your college placement officer has not announced any open campus placement drives yet.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        {drives.map((drive) => {
                            const isEligible = drive.is_eligible !== false;
                            const hasApplied = drive.has_applied;

                            return (
                                <div 
                                    key={drive.id}
                                    className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 flex flex-col justify-between shadow-xs hover:border-emerald-500/40 transition-all group"
                                >
                                    <div>
                                        <div className="flex items-start justify-between gap-2 mb-2">
                                            <div>
                                                <h3 className="font-bold text-slate-900 dark:text-white text-base group-hover:text-emerald-600 dark:group-hover:text-emerald-300 transition-colors">
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
                                            <div>
                                                <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Package</span>
                                                <span className="font-bold text-slate-900 dark:text-white">
                                                    {drive.package_lpa ? `₹${drive.package_lpa} LPA` : 'As per policy'}
                                                </span>
                                            </div>
                                            <div>
                                                <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Cutoff</span>
                                                <span className="font-bold text-slate-900 dark:text-white">
                                                    {drive.minimum_cgpa > 0 ? `${drive.minimum_cgpa} CGPA` : 'No cutoff'}
                                                </span>
                                            </div>
                                        </div>

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
                                            <div className="w-full py-2 bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold text-center flex items-center justify-center gap-1.5">
                                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                                <span>Application Submitted ({drive.application_status || 'Applied'})</span>
                                            </div>
                                        ) : !isEligible ? (
                                            <div className="w-full py-2 bg-amber-50 dark:bg-slate-800 text-amber-800 dark:text-amber-400 rounded-xl text-xs text-center border border-amber-200 dark:border-amber-500/20 flex items-center justify-center gap-1.5">
                                                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                                <span>CGPA below cutoff ({drive.minimum_cgpa})</span>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => {
                                                    setSelectedDrive(drive);
                                                    setApplyError(null);
                                                }}
                                                className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs font-semibold transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                                            >
                                                <span>Apply to Drive</span>
                                                <ChevronRight className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )
            ) : (
                /* Applications Tab */
                applications.length === 0 ? (
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-12 text-center space-y-3 shadow-xs">
                        <Send className="w-12 h-12 text-slate-400 dark:text-slate-600 mx-auto" />
                        <h3 className="text-base font-semibold text-slate-900 dark:text-white">No active applications</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                            You haven't submitted any applications to on-campus placement drives yet.
                        </p>
                    </div>
                ) : (
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[11px]">
                                    <th className="py-3.5 px-4 font-semibold">Company & Role</th>
                                    <th className="py-3.5 px-4 font-semibold">Applied Date</th>
                                    <th className="py-3.5 px-4 font-semibold">Status</th>
                                    <th className="py-3.5 px-4 font-semibold">Notes</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-900 dark:text-slate-200">
                                {applications.map((app) => {
                                    let statusColor = 'bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30';
                                    if (app.status === 'SHORTLISTED') statusColor = 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30';
                                    if (app.status === 'PLACED') statusColor = 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30';
                                    if (app.status === 'REJECTED') statusColor = 'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-500/30';

                                    return (
                                        <tr key={app.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                                            <td className="py-3.5 px-4">
                                                <div className="font-semibold text-slate-900 dark:text-white">{app.company_name}</div>
                                                <div className="text-[11px] text-emerald-600 dark:text-emerald-400">{app.role_title}</div>
                                            </td>
                                            <td className="py-3.5 px-4 text-slate-500 dark:text-slate-400">
                                                {new Date(app.applied_at).toLocaleDateString()}
                                            </td>
                                            <td className="py-3.5 px-4">
                                                <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${statusColor}`}>
                                                    {app.status}
                                                </span>
                                            </td>
                                            <td className="py-3.5 px-4 text-slate-500 dark:text-slate-400 italic">
                                                {app.notes || '—'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )
            )}

            {/* Apply Confirmation Modal */}
            {selectedDrive && (
                <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-xl space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                            <div>
                                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                                    Apply to {selectedDrive.company_name}
                                </h2>
                                <p className="text-xs text-emerald-600 dark:text-emerald-400">{selectedDrive.role_title}</p>
                            </div>
                            <button
                                onClick={() => setSelectedDrive(null)}
                                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
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
                                    className="h-10 px-4 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl transition-colors cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isApplying}
                                    className="h-10 px-5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-semibold rounded-xl transition-all shadow-xs disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                                >
                                    {isApplying ? 'Submitting...' : 'Submit Application'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StudentDrives;
