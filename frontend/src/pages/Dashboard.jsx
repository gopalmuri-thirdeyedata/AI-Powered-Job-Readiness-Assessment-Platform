import React, { useState, useEffect } from 'react';
import { Layout, Users, FileText, CheckCircle, BrainCircuit, Activity } from 'lucide-react';
import CandidateTable from '../components/CandidateTable';
import ConfirmationModal from '../components/ConfirmationModal';
import { Link } from 'react-router-dom';
import API_URL from '../apiConfig';

const Dashboard = () => {
    const [stats, setStats] = useState({
        metrics: { active: 0, screened: 0, assessments: 0, offers: 0 }
    });
    const [allCandidates, setAllCandidates] = useState([]);
    const [loading, setLoading] = useState(true);

    const [confirmation, setConfirmation] = useState({
        isOpen: false,
        title: '',
        message: '',
        type: 'info',
        confirmText: 'Confirm',
        cancelText: 'Cancel',
        isAlert: false,
        onConfirm: null
    });

    const fetchData = async (background = false) => {
        if (!background) setLoading(true);
        try {
            const token = localStorage.getItem('token');
            const headers = { 'Authorization': `Bearer ${token}` };

            // 1. Fetch Stats for Top Cards
            const statsRes = await fetch(`${API_URL}/api/resume/stats/`, { headers, cache: 'no-store' });
            if (statsRes.ok) {
                const data = await statsRes.json();
                setStats(data);
            }

            // 2. Fetch ALL Candidates for the Table
            const candidatesRes = await fetch(`${API_URL}/api/resume/candidates/`, { headers, cache: 'no-store' });
            if (candidatesRes.ok) {
                const data = await candidatesRes.json();
                setAllCandidates(data);
            }

        } catch (error) {
            console.error("Dashboard fetch error:", error);
        } finally {
            if (!background) setLoading(false);
        }
    };

    const handlePromote = (candidateIds) => {
        if (!candidateIds || candidateIds.length === 0) return;

        setConfirmation({
            isOpen: true,
            title: 'Promote Candidates',
            message: `Promote ${candidateIds.length} selected candidate(s) to their respective NEXT stages?`,
            type: 'info',
            confirmText: 'Promote',
            cancelText: 'Cancel',
            isAlert: false,
            onConfirm: async () => {
                try {
                    const res = await fetch(`${API_URL}/api/resume/candidates/bulk-update/`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${localStorage.getItem('token')}`
                        },
                        body: JSON.stringify({
                            candidate_ids: candidateIds,
                            stage: 'NEXT'
                        })
                    });

                    if (res.ok) {
                        setConfirmation({
                            isOpen: true,
                            title: 'Promotion Successful',
                            message: `${candidateIds.length} candidate(s) promoted successfully to their respective next stages.`,
                            type: 'success',
                            confirmText: 'Awesome',
                            isAlert: true,
                            onConfirm: () => fetchData()
                        });
                        fetchData();
                    } else {
                        const errorData = await res.json();
                        setConfirmation({
                            isOpen: true,
                            title: 'Promotion Failed',
                            message: `Failed to promote: ${errorData.detail || 'Unknown error'}`,
                            type: 'danger',
                            confirmText: 'OK',
                            isAlert: true
                        });
                    }
                } catch (error) {
                    console.error("Promotion failed:", error);
                    setConfirmation({
                        isOpen: true,
                        title: 'Error',
                        message: 'An error occurred during promotion. Please try again.',
                        type: 'danger',
                        confirmText: 'OK',
                        isAlert: true
                    });
                }
            }
        });
    };

    useEffect(() => {
        fetchData(); // Initial load

        const interval = setInterval(() => fetchData(true), 5000); // Poll every 5s

        // Auto-refresh on focus
        const handleFocus = () => fetchData(true);
        window.addEventListener('focus', handleFocus);
        return () => {
            clearInterval(interval);
            window.removeEventListener('focus', handleFocus);
        };
    }, []);

    const statCards = [
        { title: 'Active Candidates', value: stats.metrics.active, icon: Users, color: 'text-green-600', bg: 'bg-white', border: 'border-green-200' },
        { title: 'Resume Screened', value: stats.metrics.screened, icon: FileText, color: 'text-green-700', bg: 'bg-white', border: 'border-green-300' },
        { title: 'In Assessments', value: stats.metrics.assessments, icon: BrainCircuit, color: 'text-green-600', bg: 'bg-white', border: 'border-green-200' },
        { title: 'Hired / Offers', value: stats.metrics.offers, icon: CheckCircle, color: 'text-green-800', bg: 'bg-white', border: 'border-green-400' },
    ];

    return (
        <div className="space-y-8 w-full pb-12">
            {/* Header */}
            <div className="border-b border-gray-200 pb-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-semibold text-[#5d8c2c] tracking-tight">
                        Hiring Control Panel
                    </h1>
                    <p className="text-black mt-2 text-sm font-medium">Real-time overview of your recruitment pipeline and candidate progress.</p>
                </div>
                <div className="flex items-center gap-3">
                    <span className="flex h-3 w-3 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                    </span>
                    <span className="text-sm font-bold text-green-700 bg-white px-3 py-1 rounded-full border border-green-200">
                        {loading ? 'System Active' : `Assessments Validated: ${stats.metrics.assessments}`}
                    </span>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                {statCards.map((stat, index) => {
                    const Icon = stat.icon;
                    return (
                        <div key={index} className={`bg-white rounded-2xl p-6 border ${stat.border} shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group`}>
                            <div className={`absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity transform scale-150 rotate-12`}>
                                <Icon size={64} className={stat.color} />
                            </div>
                            <div className="flex items-center gap-4 relative z-10">
                                <div className={`p-3 rounded-xl ${stat.bg} ${stat.color} border border-white/50 shadow-sm`}>
                                    <Icon size={24} />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-green-700 uppercase tracking-wide">{stat.title}</p>
                                    <h3 className="text-3xl font-semibold text-[#5d8c2c] mt-1">{loading ? '-' : stat.value}</h3>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Main Content: Candidate Table */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-semibold text-[#5d8c2c] flex items-center gap-2">
                        <Activity className="text-green-600" size={20} />
                        Live Candidate Pipeline
                    </h2>
                    <Link to="/candidates" className="text-sm font-semibold text-green-600 hover:text-green-800 flex items-center gap-1">
                        View Full List <Users size={16} />
                    </Link>
                </div>

                {/* Candidate Table with Enhanced Filtering */}
                <CandidateTable
                    candidates={allCandidates}
                    currentStage="Dashboard"
                    onRefresh={fetchData}
                    showRoleColumn={true}
                    showStageColumn={true}
                    enableStageFilter={true}
                    enableScoreFilter={true}
                    showAnalyticsAction={false}
                    showRecommendation={true}
                    onPromote={handlePromote}
                    onDelete={(ids) => {
                        if (!ids || ids.length === 0) return;
                        setConfirmation({
                            isOpen: true,
                            title: 'Delete Candidates',
                            message: `Permanently delete ${ids.length} selected candidate(s)? This action cannot be undone.`,
                            type: 'danger',
                            confirmText: 'Delete',
                            cancelText: 'Cancel',
                            isAlert: false,
                            onConfirm: async () => {
                                try {
                                    setLoading(true);
                                    await Promise.all(ids.map(id =>
                                        fetch(`${API_URL}/api/resume/candidates/${id}/`, {
                                            method: 'DELETE',
                                            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                                        })
                                    ));
                                    setConfirmation({
                                        isOpen: true,
                                        title: 'Deleted Successfully',
                                        message: `${ids.length} candidate(s) deleted successfully.`,
                                        type: 'success',
                                        confirmText: 'OK',
                                        isAlert: true,
                                        onConfirm: () => fetchData()
                                    });
                                    fetchData();
                                } catch (err) {
                                    console.error("Deletion failed", err);
                                    setConfirmation({
                                        isOpen: true,
                                        title: 'Deletion Failed',
                                        message: 'Failed to delete candidate(s). Please try again.',
                                        type: 'danger',
                                        confirmText: 'OK',
                                        isAlert: true
                                    });
                                    setLoading(false);
                                }
                            }
                        });
                    }}
                />
            </div>

            <ConfirmationModal
                isOpen={confirmation.isOpen}
                onClose={() => setConfirmation(prev => ({ ...prev, isOpen: false }))}
                onConfirm={confirmation.onConfirm}
                title={confirmation.title}
                message={confirmation.message}
                type={confirmation.type}
                confirmText={confirmation.confirmText}
                cancelText={confirmation.cancelText}
                isAlert={confirmation.isAlert}
            />
        </div>
    );
};

export default Dashboard;
