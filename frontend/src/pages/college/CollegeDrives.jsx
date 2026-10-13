import React, { useState, useEffect } from 'react';
import { 
    Building2, 
    Plus, 
    Users, 
    Calendar, 
    Award, 
    CheckCircle2, 
    X, 
    AlertTriangle, 
    RefreshCw, 
    DollarSign, 
    Check, 
    Clock, 
    ChevronRight,
    Search
} from 'lucide-react';
import collegeApi from '../../services/collegeApi';

const CollegeDrives = () => {
    const [drives, setDrives] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('');
    
    // Modal states
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isApplicantsModalOpen, setIsApplicantsModalOpen] = useState(false);
    const [selectedDrive, setSelectedDrive] = useState(null);
    const [applicants, setApplicants] = useState([]);
    const [isLoadingApplicants, setIsLoadingApplicants] = useState(false);

    // Create Drive Form state
    const [formData, setFormData] = useState({
        company_name: '',
        role_title: '',
        description: '',
        eligibility_criteria: '',
        minimum_cgpa: 7.0,
        required_skills: '',
        package_lpa: '',
        application_deadline: '',
        status: 'OPEN'
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState(null);

    const loadDrives = async () => {
        setIsLoading(true);
        try {
            const data = await collegeApi.getDrives(statusFilter || null);
            setDrives(data || []);
        } catch (err) {
            console.error('Failed to load placement drives:', err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadDrives();
    }, [statusFilter]);

    const handleCreateDrive = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setSubmitError(null);

        try {
            const payload = {
                company_name: formData.company_name.trim(),
                role_title: formData.role_title.trim(),
                description: formData.description.trim(),
                eligibility_criteria: formData.eligibility_criteria.trim() || null,
                minimum_cgpa: parseFloat(formData.minimum_cgpa) || 0.0,
                required_skills: formData.required_skills
                    ? formData.required_skills.split(',').map(s => s.trim()).filter(Boolean)
                    : [],
                package_lpa: formData.package_lpa ? parseFloat(formData.package_lpa) : null,
                application_deadline: formData.application_deadline ? new Date(formData.application_deadline).toISOString() : null,
                status: formData.status
            };

            await collegeApi.createDrive(payload);
            setIsCreateModalOpen(false);
            setFormData({
                company_name: '',
                role_title: '',
                description: '',
                eligibility_criteria: '',
                minimum_cgpa: 7.0,
                required_skills: '',
                package_lpa: '',
                application_deadline: '',
                status: 'OPEN'
            });
            loadDrives();
        } catch (err) {
            console.error('Failed to create drive:', err);
            setSubmitError(err.response?.data?.detail || 'Failed to create placement drive.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleOpenApplicants = async (drive) => {
        setSelectedDrive(drive);
        setIsApplicantsModalOpen(true);
        setIsLoadingApplicants(true);
        try {
            const apps = await collegeApi.getDriveApplications(drive.id);
            setApplicants(apps || []);
        } catch (err) {
            console.error('Failed to load drive applicants:', err);
        } finally {
            setIsLoadingApplicants(false);
        }
    };

    const handleUpdateStatus = async (appId, newStatus) => {
        try {
            const updated = await collegeApi.updateApplicationStatus(appId, newStatus);
            setApplicants(prev => prev.map(a => a.id === appId ? { ...a, status: updated.status } : a));
        } catch (err) {
            console.error('Failed to update applicant status:', err);
            alert('Failed to update status.');
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight flex items-center gap-2.5">
                        <Building2 className="w-7 h-7 text-indigo-400" />
                        <span>Campus Placement Drives</span>
                    </h1>
                    <p className="text-sm text-slate-400 mt-1">
                        Configure campus hiring drives, define eligibility cutoffs, and review student applicants.
                    </p>
                </div>
                <div>
                    <button
                        onClick={() => setIsCreateModalOpen(true)}
                        className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-sm transition-all"
                    >
                        <Plus className="w-4 h-4" />
                        <span>Create Placement Drive</span>
                    </button>
                </div>
            </div>

            {/* Status Filter Tabs */}
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                {[
                    { label: 'All Drives', val: '' },
                    { label: 'Open Drives', val: 'OPEN' },
                    { label: 'Closed', val: 'CLOSED' },
                    { label: 'Completed', val: 'COMPLETED' },
                ].map(({ label, val }) => (
                    <button
                        key={val}
                        onClick={() => setStatusFilter(val)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                            statusFilter === val
                                ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* Drives Grid */}
            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <RefreshCw className="w-7 h-7 text-indigo-400 animate-spin" />
                    <p className="text-xs text-slate-400">Loading placement drives...</p>
                </div>
            ) : drives.length === 0 ? (
                <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-12 text-center space-y-3">
                    <Building2 className="w-12 h-12 text-slate-600 mx-auto" />
                    <h3 className="text-base font-semibold text-white">No placement drives found</h3>
                    <p className="text-xs text-slate-400 max-w-sm mx-auto">
                        Get started by creating an on-campus placement drive with company credentials and eligibility criteria.
                    </p>
                    <button
                        onClick={() => setIsCreateModalOpen(true)}
                        className="mt-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-1.5"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Create First Drive</span>
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {drives.map((drive) => {
                        let statusColor = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
                        if (drive.status === 'CLOSED') statusColor = 'bg-amber-500/15 text-amber-300 border-amber-500/30';
                        if (drive.status === 'COMPLETED') statusColor = 'bg-slate-700/40 text-slate-400 border-slate-700';

                        return (
                            <div 
                                key={drive.id}
                                className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-5 flex flex-col justify-between shadow-sm hover:border-indigo-500/40 transition-all group"
                            >
                                <div>
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                        <div>
                                            <h3 className="font-bold text-white text-base group-hover:text-indigo-300 transition-colors">
                                                {drive.company_name}
                                            </h3>
                                            <p className="text-xs text-indigo-400 font-medium">{drive.role_title}</p>
                                        </div>
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase ${statusColor}`}>
                                            {drive.status}
                                        </span>
                                    </div>

                                    <p className="text-xs text-slate-300 mt-2 line-clamp-2">
                                        {drive.description}
                                    </p>

                                    {/* Quick details */}
                                    <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-slate-700/60 text-xs">
                                        <div>
                                            <span className="text-[11px] text-slate-400 block">Package</span>
                                            <span className="font-bold text-white">
                                                {drive.package_lpa ? `₹${drive.package_lpa} LPA` : 'Disclosed on hire'}
                                            </span>
                                        </div>
                                        <div>
                                            <span className="text-[11px] text-slate-400 block">Min CGPA</span>
                                            <span className="font-bold text-white">
                                                {drive.minimum_cgpa > 0 ? `${drive.minimum_cgpa} CGPA` : 'Open to all'}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Skills pills */}
                                    {drive.required_skills?.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mt-3">
                                            {drive.required_skills.slice(0, 4).map((sk, idx) => (
                                                <span key={idx} className="px-2 py-0.5 rounded-md bg-slate-900 text-slate-300 text-[10px] border border-slate-700">
                                                    {sk}
                                                </span>
                                            ))}
                                            {drive.required_skills.length > 4 && (
                                                <span className="text-[10px] text-slate-400">
                                                    +{drive.required_skills.length - 4} more
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Footer & Action */}
                                <div className="mt-5 pt-3 border-t border-slate-700/60 flex items-center justify-between">
                                    <div className="flex items-center gap-1.5 text-xs text-slate-300">
                                        <Users className="w-3.5 h-3.5 text-indigo-400" />
                                        <span><strong>{drive.applicant_count || 0}</strong> applicants</span>
                                    </div>
                                    <button
                                        onClick={() => handleOpenApplicants(drive)}
                                        className="px-3 py-1.5 bg-slate-700/60 hover:bg-indigo-600 hover:text-white text-slate-200 rounded-xl text-xs font-semibold transition-all flex items-center gap-1"
                                    >
                                        <span>Review</span>
                                        <ChevronRight className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Create Placement Drive Modal */}
            {isCreateModalOpen && (
                <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                            <h2 className="text-base font-bold text-white flex items-center gap-2">
                                <Building2 className="w-5 h-5 text-indigo-400" />
                                <span>Create On-Campus Placement Drive</span>
                            </h2>
                            <button
                                onClick={() => setIsCreateModalOpen(false)}
                                className="text-slate-400 hover:text-white"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {submitError && (
                            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
                                {submitError}
                            </div>
                        )}

                        <form onSubmit={handleCreateDrive} className="space-y-4 text-xs">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-slate-300 mb-1 font-semibold">Company Name *</label>
                                    <input
                                        type="text"
                                        required
                                        value={formData.company_name}
                                        onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                                        placeholder="e.g. Acme Corporation"
                                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                                    />
                                </div>
                                <div>
                                    <label className="block text-slate-300 mb-1 font-semibold">Role Title *</label>
                                    <input
                                        type="text"
                                        required
                                        value={formData.role_title}
                                        onChange={(e) => setFormData({ ...formData, role_title: e.target.value })}
                                        placeholder="e.g. Software Engineer"
                                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-slate-300 mb-1 font-semibold">Package (LPA)</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        value={formData.package_lpa}
                                        onChange={(e) => setFormData({ ...formData, package_lpa: e.target.value })}
                                        placeholder="e.g. 12.5"
                                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                                    />
                                </div>
                                <div>
                                    <label className="block text-slate-300 mb-1 font-semibold">Minimum CGPA Cutoff</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        min="0"
                                        max="10"
                                        value={formData.minimum_cgpa}
                                        onChange={(e) => setFormData({ ...formData, minimum_cgpa: e.target.value })}
                                        placeholder="e.g. 7.5"
                                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-slate-300 mb-1 font-semibold">Required Skills (Comma separated)</label>
                                <input
                                    type="text"
                                    value={formData.required_skills}
                                    onChange={(e) => setFormData({ ...formData, required_skills: e.target.value })}
                                    placeholder="React, Python, SQL, Docker"
                                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                                />
                            </div>

                            <div>
                                <label className="block text-slate-300 mb-1 font-semibold">Description *</label>
                                <textarea
                                    required
                                    rows="3"
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    placeholder="Role description, team overview, and recruitment expectations..."
                                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                                />
                            </div>

                            <div>
                                <label className="block text-slate-300 mb-1 font-semibold">Eligibility Criteria Notes</label>
                                <textarea
                                    rows="2"
                                    value={formData.eligibility_criteria}
                                    onChange={(e) => setFormData({ ...formData, eligibility_criteria: e.target.value })}
                                    placeholder="e.g. B.Tech Computer Science / IT / ECE with no active backlogs."
                                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                                />
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => setIsCreateModalOpen(false)}
                                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition-all shadow-md shadow-indigo-950/40 disabled:opacity-40"
                                >
                                    {isSubmitting ? 'Creating...' : 'Create Drive'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Review Applicants Modal */}
            {isApplicantsModalOpen && selectedDrive && (
                <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                            <div>
                                <h2 className="text-base font-bold text-white flex items-center gap-2">
                                    <Users className="w-5 h-5 text-indigo-400" />
                                    <span>Applicants for {selectedDrive.company_name}</span>
                                </h2>
                                <p className="text-xs text-indigo-400">{selectedDrive.role_title}</p>
                            </div>
                            <button
                                onClick={() => setIsApplicantsModalOpen(false)}
                                className="text-slate-400 hover:text-white"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {isLoadingApplicants ? (
                            <div className="flex flex-col items-center justify-center py-12 gap-2">
                                <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin" />
                                <p className="text-xs text-slate-400">Loading applicants...</p>
                            </div>
                        ) : applicants.length === 0 ? (
                            <div className="py-12 text-center text-xs text-slate-400 italic">
                                No students have applied to this drive yet.
                            </div>
                        ) : (
                            <div className="divide-y divide-slate-800">
                                {applicants.map((app) => (
                                    <div key={app.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-bold text-white">{app.student_name}</span>
                                                <span className="text-[11px] text-slate-400">({app.student_email})</span>
                                            </div>
                                            <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-400">
                                                <span>Branch: <strong>{app.student_branch || 'N/A'}</strong></span>
                                                <span>CGPA: <strong className="text-emerald-400">{app.student_cgpa || 'N/A'}</strong></span>
                                                <span>Readiness: <strong className="text-indigo-400">{Math.round(app.student_readiness_score || 0)}%</strong></span>
                                            </div>
                                            {app.notes && (
                                                <p className="text-[11px] text-slate-300 italic mt-1 bg-slate-800/60 px-2 py-1 rounded">
                                                    Note: "{app.notes}"
                                                </p>
                                            )}
                                        </div>

                                        {/* Status Tag & Changer */}
                                        <div className="flex items-center gap-2 shrink-0">
                                            <select
                                                value={app.status}
                                                onChange={(e) => handleUpdateStatus(app.id, e.target.value)}
                                                className="bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1 text-xs text-slate-200 focus:outline-none"
                                            >
                                                <option value="APPLIED">APPLIED</option>
                                                <option value="SHORTLISTED">SHORTLISTED</option>
                                                <option value="REJECTED">REJECTED</option>
                                                <option value="PLACED">PLACED</option>
                                            </select>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default CollegeDrives;
