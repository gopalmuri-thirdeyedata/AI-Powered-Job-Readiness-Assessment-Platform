import React, { useState, useEffect } from 'react';
import API_URL from '../apiConfig';
import { Mic } from 'lucide-react';
import CandidateTable from '../components/CandidateTable';
import ConfirmationModal from '../components/ConfirmationModal';

const TechnicalInterview = () => {
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [confirmation, setConfirmation] = useState({ isOpen: false, title: '', message: '', type: 'info', onConfirm: null });

    const fetchCandidates = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_URL}/api/resume/candidates/`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                const data = await response.json();
                setCandidates(data.filter(c => c.stage === 'Technical Interview'));
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

    const handlePromote = async (candidateIds) => {
        if (!candidateIds || candidateIds.length === 0) return;

        // Check score
        const selected = candidates.filter(c => candidateIds.includes(c.id));
        const lowScore = selected.filter(c => (c.score || 0) < 60);

        let message = `Are you sure you want to promote ${candidateIds.length} candidate(s) to the NEXT stage?`;
        if (lowScore.length > 0) {
            message = `WARNING: ${lowScore.length} candidate(s) have low interview scores (<60%).\n\n` + message;
        }

        setConfirmation({
            isOpen: true,
            title: 'Confirm Promotion',
            message: message,
            type: lowScore.length > 0 ? 'warning' : 'info',
            confirmText: 'Promote',
            onConfirm: () => executePromote(candidateIds)
        });
    };

    const executePromote = async (candidateIds) => {
        try {
            const res = await fetch(`${API_URL}/api/resume/candidates/bulk-update/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    candidate_ids: Array.from(candidateIds),
                    stage: 'NEXT'
                })
            });

            if (res.ok) {
                setConfirmation({
                    isOpen: true,
                    title: 'Promotion Successful',
                    message: `${candidateIds.length} candidate(s) promoted successfully.`,
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

    const handleReleaseOffer = async (candidateIds) => {
        if (!candidateIds || candidateIds.length === 0) return;

        // Check score for offer
        const selected = candidates.filter(c => candidateIds.includes(c.id));
        const lowScore = selected.filter(c => (c.score || 0) < 60);
        const notDoneAnyRound = selected.filter(c => {
            const hasAptitude = c.analysis_data?.correct !== undefined || c.analysis_data?.score_percentage !== undefined;
            const hasCoding = c.analysis_data?.passed !== undefined;
            const hasInterview = c.analysis_data?.interview !== undefined;
            return !(hasAptitude || hasCoding || hasInterview);
        });

        let message = `Release offer to ${candidateIds.length} candidate(s)? This will trigger official offer emails.`;
        if (notDoneAnyRound.length > 0) {
            const names = notDoneAnyRound.map(c => c.name).join(', ');
            message = `WARNING: The following candidate(s) have NOT completed any test rounds (Aptitude, Coding, or Interview): ${names}.\n\n` + message;
        } else if (lowScore.length > 0) {
            message = `WARNING: ${lowScore.length} candidate(s) have low interview scores (<60%).\n\n` + message;
        }

        setConfirmation({
            isOpen: true,
            title: 'Release Job Offers',
            message: message,
            type: (notDoneAnyRound.length > 0 || lowScore.length > 0) ? 'warning' : 'success',
            confirmText: 'Release Offers',
            cancelText: 'Cancel',
            isAlert: false,
            onConfirm: () => executeReleaseOffer(candidateIds)
        });
    };

    const executeReleaseOffer = async (candidateIds) => {
        try {
            const res = await fetch(`${API_URL}/api/resume/candidates/bulk-update/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    candidate_ids: Array.from(candidateIds),
                    status: 'Offer Released'
                })
            });

            if (res.ok) {
                setConfirmation({
                    isOpen: true,
                    title: 'Offers Released',
                    message: `Official offers and notification emails have been released to ${candidateIds.length} candidate(s).`,
                    type: 'success',
                    confirmText: 'Great',
                    isAlert: true,
                    onConfirm: () => fetchCandidates()
                });
                fetchCandidates();
            } else {
                setConfirmation({
                    isOpen: true,
                    title: 'Offer Release Failed',
                    message: 'Failed to release offers. Please try again.',
                    type: 'danger',
                    confirmText: 'OK',
                    isAlert: true
                });
            }
        } catch (error) {
            console.error("Offer release failed:", error);
            setConfirmation({
                isOpen: true,
                title: 'Error',
                message: 'An error occurred during offer release.',
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
                        <Mic className="text-green-600" /> AI Interview
                    </h1>
                    <p className="text-sm text-black mt-1">Voice-based technical screening results.</p>
                </div>
            </div>

            <CandidateTable
                candidates={candidates}
                currentStage="Technical Interview"
                onRefresh={fetchCandidates}
                showRoleColumn={true}
                onPromote={handlePromote}
                onReleaseOffer={handleReleaseOffer}
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

export default TechnicalInterview;
