import React, { useState, useEffect } from 'react';
import API_URL from '../apiConfig';
import { Code2 } from 'lucide-react';
import CandidateTable from '../components/CandidateTable';
import ConfirmationModal from '../components/ConfirmationModal';

const CodingRound = () => {
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [confirmation, setConfirmation] = useState({ isOpen: false, title: '', message: '', type: 'info', onConfirm: null });

    const fetchCandidates = async () => {
        setLoading(true);
        try {
            const response = await fetch(`${API_URL}/api/resume/candidates/`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            if (response.ok) {
                const data = await response.json();
                setCandidates(data.filter(c => c.stage === 'Coding Round'));
            }
        } catch (error) {
            console.error("Failed to fetch", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCandidates();
    }, []);

    const handlePromote = async (candidateIds, stage) => {
        if (!candidateIds || candidateIds.length === 0) return;

        // Check eligibility
        const selected = candidates.filter(c => candidateIds.includes(c.id));
        const ineligible = selected.filter(c => {
            const status = c.status || '';
            const isCompleted = status === 'Completed' || status.startsWith('Submitted');
            return !isCompleted || (c.score || 0) < 60;
        });

        let message = `Are you sure you want to promote ${candidateIds.length} candidate(s) to ${stage === 'NEXT' ? 'the NEXT stage' : stage}?`;
        if (ineligible.length > 0) {
            message = `WARNING: ${ineligible.length} candidate(s) are not eligible (Low Score or Incomplete).\n\n` + message;
        }

        setConfirmation({
            isOpen: true,
            title: 'Confirm Promotion',
            message: message,
            type: ineligible.length > 0 ? 'warning' : 'info',
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
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-semibold text-[#5d8c2c] tracking-tight flex items-center gap-2">
                        <Code2 className="text-green-600" /> Coding Round Management
                    </h1>
                    <p className="text-black text-sm mt-1">Monitor candidate progress and evaluate submissions.</p>
                </div>
            </div>

            <CandidateTable
                candidates={candidates}
                currentStage="Coding Round"
                onRefresh={fetchCandidates}
                showRoleColumn={true}
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
    );
};

export default CodingRound;
