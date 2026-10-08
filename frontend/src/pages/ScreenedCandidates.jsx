import React, { useState, useEffect } from 'react';
import API_URL from '../apiConfig';
import { BarChart2 } from 'lucide-react';
import CandidateTable from '../components/CandidateTable';
import ConfirmationModal from '../components/ConfirmationModal';

const ScreenedCandidates = () => {
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [confirmation, setConfirmation] = useState({ isOpen: false, title: '', message: '', type: 'info', onConfirm: null });
    const [error, setError] = useState(null);

    const fetchCandidates = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`${API_URL}/api/resume/candidates/`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            if (response.ok) {
                const data = await response.json();
                setCandidates(data.filter(c => c.stage === 'Resume Screening'));
            } else {
                throw new Error(`Server returned ${response.status} ${response.statusText}`);
            }
        } catch (err) {
            console.error("Failed to fetch candidates", err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCandidates();
    }, []);

    const handlePromote = async (candidateIds, stage) => {
        if (!candidateIds || candidateIds.length === 0) return;

        // Check recommendation
        const selected = candidates.filter(c => candidateIds.includes(c.id));
        const notRecommended = selected.filter(c => (c.score || 0) < 60);

        let message = `Promote ${candidateIds.length} candidate(s) to ${stage === 'NEXT' ? 'their respective NEXT stages' : stage}?`;
        if (notRecommended.length > 0) {
            message = `WARNING: ${notRecommended.length} candidate(s) are NOT Recommended by AI (<60%).\n\n` + message;
        }

        setConfirmation({
            isOpen: true,
            title: 'Confirm Promotion',
            message: message,
            type: notRecommended.length > 0 ? 'warning' : 'info',
            confirmText: 'Promote Candidates',
            onConfirm: () => executePromote(candidateIds, stage)
        });
    };

    const executePromote = async (candidateIds, stage) => {
        try {
            const res = await fetch(`${API_URL}/api/resume/candidates/bulk-update/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    candidate_ids: candidateIds,
                    stage: stage || 'NEXT'
                })
            });

            if (res.ok) {
                setConfirmation({
                    isOpen: true,
                    title: 'Promotion Successful',
                    message: `${candidateIds.length} candidate(s) promoted successfully to ${stage === 'NEXT' ? 'their next stage' : stage}.`,
                    type: 'success',
                    confirmText: 'Awesome',
                    isAlert: true,
                    onConfirm: () => fetchCandidates()
                });
                fetchCandidates();
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
    };

    const handleDelete = (candidateIds) => {
        if (!candidateIds || candidateIds.length === 0) return;
        setConfirmation({
            isOpen: true,
            title: 'Delete Candidates',
            message: `Permanently delete ${candidateIds.length} selected candidate(s)? This action cannot be undone.`,
            type: 'danger',
            confirmText: 'Delete',
            cancelText: 'Cancel',
            isAlert: false,
            onConfirm: async () => {
                try {
                    setLoading(true);
                    await Promise.all(candidateIds.map(id =>
                        fetch(`${API_URL}/api/resume/candidates/${id}/`, {
                            method: 'DELETE',
                            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                        })
                    ));
                    setConfirmation({
                        isOpen: true,
                        title: 'Deleted Successfully',
                        message: `${candidateIds.length} candidate(s) deleted successfully.`,
                        type: 'success',
                        confirmText: 'OK',
                        isAlert: true,
                        onConfirm: () => fetchCandidates()
                    });
                    fetchCandidates();
                } catch (err) {
                    console.error("Deletion failed", err);
                    setConfirmation({
                        isOpen: true,
                        title: 'Deletion Failed',
                        message: 'Failed to delete candidates. Please try again.',
                        type: 'danger',
                        confirmText: 'OK',
                        isAlert: true
                    });
                    setLoading(false);
                }
            }
        });
    };

    return (
        <div className="min-h-screen bg-gray-50 pb-12">
            <div className="w-full space-y-6">
                {/* Header Section */}
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 sm:p-6 text-[#5d8c2c]">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div className="flex-1">
                            <h1 className="text-2xl sm:text-3xl font-semibold text-[#5d8c2c] tracking-tight">Screened Candidates</h1>
                            <p className="text-black text-sm mt-2 max-w-2xl font-medium">
                                AI-analyzed candidate pool awaiting action. Select candidates to promote to the next stage or manage their status.
                            </p>
                        </div>
                        <div className="bg-white text-[#5d8c2c] px-5 py-3 rounded-xl text-sm font-bold border border-gray-200 flex items-center gap-2 shadow-sm">
                            <BarChart2 size={18} className="text-green-600" />
                            <div className="flex flex-col items-start">
                                <span className="text-xs text-gray-400 uppercase tracking-wide">Total</span>
                                <span className="text-2xl font-semibold text-[#5d8c2c]">{candidates.length}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="font-bold">Connection Error:</span> {error}
                        </div>
                        <button
                            onClick={fetchCandidates}
                            className="text-sm underline hover:text-red-800"
                        >
                            Retry
                        </button>
                    </div>
                )}

                <CandidateTable
                    candidates={candidates}
                    currentStage="Screened Candidates"
                    onRefresh={fetchCandidates}
                    showRoleColumn={true}
                    showAnalyticsAction={true}
                    showRecommendation={true}
                    enableScoreFilter={true}
                    enableStatusFilter={false}
                    enableRecommendationFilter={true}
                    onPromote={handlePromote}
                    onDelete={handleDelete}
                />

                <ConfirmationModal
                    isOpen={confirmation.isOpen}
                    onClose={() => setConfirmation({ ...confirmation, isOpen: false })}
                    onConfirm={confirmation.onConfirm}
                    title={confirmation.title}
                    message={confirmation.message}
                    type={confirmation.type}
                    confirmText={confirmation.confirmText}
                    cancelText={confirmation.cancelText}
                    isAlert={confirmation.isAlert}
                />
            </div>
        </div>
    );
};

export default ScreenedCandidates;
