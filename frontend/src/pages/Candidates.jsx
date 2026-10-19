import React, { useState } from 'react';
import {
    MoreHorizontal,
    User,
    Mail,
    CheckCircle,
    XCircle,
    Clock,
    Eye,
    FileText,
    ArrowRight,
    Send,
    Bell,
    Trash2,
    Users,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import CandidateTable from '../components/CandidateTable';
import ConfirmationModal from '../components/ConfirmationModal';

import API_URL from '../apiConfig';

const AddCandidateModal = ({ isOpen, onClose, onAdd }) => {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        role: '',
        stage: 'Resume Screening'
    });
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const response = await fetch(`${API_URL}/api/resume/candidates/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify(formData)
            });

            if (response.ok) {
                const newCandidate = await response.json();
                onAdd(newCandidate);
                onClose();
                setFormData({ name: '', email: '', role: '', stage: 'Resume Screening' });
            } else {
                const error = await response.json();
                alert(error.detail || "Failed to add candidate");
            }
        } catch (err) {
            console.error("Error adding candidate:", err);
            alert("Connection error.");
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto border border-gray-100"
            >
                <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                    <h2 className="text-xl font-bold text-[#5d8c2c] flex items-center gap-2">
                        <User className="text-green-600" size={20} />
                        Add New Candidate
                    </h2>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-lg transition-colors">
                        <XCircle size={20} className="text-gray-400" />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">Full Name</label>
                        <input
                            required
                            type="text"
                            placeholder="John Doe"
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">Email Address</label>
                        <input
                            required
                            type="email"
                            placeholder="john@example.com"
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">Job Title / Role</label>
                        <input
                            required
                            type="text"
                            placeholder="Software Engineer"
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                            value={formData.role}
                            onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">Initial Stage</label>
                        <select
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                            value={formData.stage}
                            onChange={(e) => setFormData({ ...formData, stage: e.target.value })}
                        >
                            <option value="Resume Screening">Resume Screening</option>
                            <option value="Aptitude Round">Aptitude Round</option>
                            <option value="Coding Round">Coding Round</option>
                            <option value="Technical Interview">Technical Interview</option>
                        </select>
                    </div>
                    <div className="pt-4 flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-3 border border-gray-200 text-gray-700 font-bold rounded-xl hover:bg-gray-50 transition-all"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className={`flex-1 py-3 bg-primary text-white font-bold rounded-xl shadow-md flex items-center justify-center gap-2 ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            {loading ? 'Adding...' : 'Add Candidate'}
                        </button>
                    </div>
                </form>
            </motion.div>
        </div>
    );
};

const FixedActionMenu = ({ position, candidate, onClose, onAction }) => {
    // ... rest of the file
    // Close on scroll
    React.useEffect(() => {
        const handleScroll = () => {
            if (window.scrollY > 0) onClose();
        };
        window.addEventListener('scroll', handleScroll, { passive: true });
        // Also close on window resize
        window.addEventListener('resize', onClose);

        return () => {
            window.removeEventListener('scroll', handleScroll);
            window.removeEventListener('resize', onClose);
        };
    }, [onClose]);

    const handleAction = (action) => {
        if (onAction) onAction(action, candidate);
        onClose();
    };

    return (
        <>
            {/* Backdrop: Transparent, handles click outside */}
            <div
                className="fixed inset-0 z-[9998] cursor-default"
                onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                }}
            />

            {/* Menu: Fixed positioning based on calculated props */}
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -8 }}
                transition={{ duration: 0.1, ease: "easeOut" }}
                style={{
                    top: position.top,
                    left: position.left,
                    position: 'fixed'
                }}
                className="z-[9999] w-56 bg-white border border-gray-100 rounded-xl shadow-2xl overflow-hidden ring-1 ring-black/5"
                onClick={(e) => e.stopPropagation()}
            >
                {/* View Actions */}
                <div className="py-1.5">
                    <button
                        onClick={() => handleAction('view-profile')}
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors flex items-center gap-3"
                    >
                        <Eye className="w-4 h-4 text-gray-400" />
                        <span className="font-medium">View Profile</span>
                    </button>
                    <button
                        onClick={() => handleAction('view-resume')}
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors flex items-center gap-3"
                    >
                        <FileText className="w-4 h-4 text-gray-400" />
                        <span className="font-medium">View Resume</span>
                    </button>
                </div>

                <div className="border-t border-gray-100 my-0.5"></div>

                {/* Stage Actions */}
                <div className="py-1.5">
                    <button
                        onClick={() => handleAction('move-next')}
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-green-50 hover:text-green-700 transition-colors flex items-center gap-3"
                    >
                        <ArrowRight className="w-4 h-4 text-gray-400" />
                        <span className="font-medium">Move to Next Stage</span>
                    </button>
                    <button
                        onClick={() => handleAction('assign-test')}
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-700 transition-colors flex items-center gap-3"
                    >
                        <Send className="w-4 h-4 text-gray-400" />
                        <span className="font-medium">Assign/Resend Test</span>
                    </button>
                    <button
                        onClick={() => handleAction('send-reminder')}
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-green-50 hover:text-green-700 transition-colors flex items-center gap-3"
                    >
                        <Bell className="w-4 h-4 text-gray-400" />
                        <span className="font-medium">Send Reminder</span>
                    </button>
                </div>

                <div className="border-t border-gray-100 my-0.5"></div>

                {/* Status Actions */}
                <div className="py-1.5 ">
                    <button
                        onClick={() => handleAction('reject')}
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-red-50 hover:text-red-600 transition-colors flex items-center gap-3"
                    >
                        <XCircle className="w-4 h-4 text-gray-400" />
                        <span className="font-medium">Reject Candidate</span>
                    </button>
                    <button
                        onClick={() => handleAction('delete')}
                        className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors flex items-center gap-3"
                    >
                        <Trash2 className="w-4 h-4 text-red-400" />
                        <span className="font-medium">Delete Candidate</span>
                    </button>
                </div>
            </motion.div>
        </>
    );
};

const Candidates = () => {
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showExportDropdown, setShowExportDropdown] = useState(false);

    const handleExportExcel = async () => {
        if (candidates.length === 0) {
            alert("No candidate data available to export.");
            return;
        }
        const data = candidates.map((c, index) => ({
            "S.No": index + 1,
            "Name": c.name,
            "Email": c.email,
            "Job Role": c.role || 'N/A',
            "Current Stage": c.stage,
            "Status": c.status,
            "Score": c.score !== undefined ? `${c.score}%` : '0%'
        }));
        
        const XLSX = await import('xlsx');
        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Candidates");
        
        // Auto-fit column widths
        const maxLen = {};
        data.forEach(row => {
            Object.keys(row).forEach(key => {
                const val = String(row[key] || '');
                maxLen[key] = Math.max(maxLen[key] || 0, val.length, key.length);
            });
        });
        worksheet["!cols"] = Object.keys(maxLen).map(key => ({ wch: maxLen[key] + 3 }));

        XLSX.writeFile(workbook, `Candidates_Export_Full_${new Date().toISOString().slice(0, 10)}.xlsx`);
        setShowExportDropdown(false);
    };

    const handleExportPDF = async () => {
        if (candidates.length === 0) {
            alert("No candidate data available to export.");
            return;
        }

        const { jsPDF } = await import('jspdf');
        const { default: autoTable } = await import('jspdf-autotable');
        const doc = new jsPDF();
        
        // Add Title Header
        doc.setFontSize(18);
        doc.setTextColor(93, 140, 44); // Brand Color #5d8c2c
        doc.text("PrepWin - Full Candidate Dataset", 14, 20);
        
        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        doc.text(`Generated on: ${new Date().toLocaleString()} | Scope: FULL DATASET`, 14, 26);
        doc.text(`Total Candidates: ${candidates.length}`, 14, 31);
        
        // Table Columns & Rows
        const headers = [["S.No", "Name", "Email", "Role", "Stage", "Status", "Score"]];
        const body = candidates.map((c, index) => [
            index + 1,
            c.name,
            c.email,
            c.role || 'N/A',
            c.stage,
            c.status,
            c.score !== undefined ? `${c.score}%` : '0%'
        ]);

        autoTable(doc, {
            startY: 36,
            head: headers,
            body: body,
            theme: 'striped',
            headStyles: { fillColor: [93, 140, 44] }, // #5d8c2c
            styles: { fontSize: 8, cellPadding: 2 },
            columnStyles: {
                2: { cellWidth: 45 }
            }
        });

        doc.save(`Candidates_Report_Full_${new Date().toISOString().slice(0, 10)}.pdf`);
        setShowExportDropdown(false);
    };

    const handleExportWord = () => {
        if (candidates.length === 0) {
            alert("No candidate data available to export.");
            return;
        }

        const tableRows = candidates.map((c, index) => `
            <tr>
                <td>${index + 1}</td>
                <td style="font-weight: bold;">${c.name}</td>
                <td>${c.email}</td>
                <td>${c.role || 'N/A'}</td>
                <td>${c.stage}</td>
                <td>${c.status}</td>
                <td>${c.score !== undefined ? `${c.score}%` : '0%'}</td>
            </tr>
        `).join('');

        const htmlContent = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
            <title>Candidates Full Dossier</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; }
                h1 { color: #5d8c2c; font-size: 24px; border-bottom: 2px solid #5d8c2c; padding-bottom: 8px; }
                .meta { color: #666; font-size: 11px; margin-bottom: 24px; }
                table { width: 100%; border-collapse: collapse; margin-top: 16px; }
                th { background-color: #5d8c2c; color: white; padding: 10px; text-align: left; font-size: 12px; font-weight: bold; border: 1px solid #ddd; }
                td { padding: 8px 10px; font-size: 11px; border: 1px solid #ddd; }
                tr:nth-child(even) { background-color: #f9f9f9; }
            </style>
        </head>
        <body>
            <h1>Candidates Full Dossier</h1>
            <div class="meta">
                Generated: ${new Date().toLocaleString()}<br/>
                Report Scope: FULL DATASET<br/>
                Total Active Records: ${candidates.length}
            </div>
            <table>
                <thead>
                    <tr>
                        <th>S.No</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Job Role</th>
                        <th>Current Stage</th>
                        <th>Status</th>
                        <th>Score</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
        </body>
        </html>
        `;

        const blob = new Blob(['\ufeff' + htmlContent], {
            type: 'application/msword'
        });
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Candidates_Dossier_Full_${new Date().toISOString().slice(0, 10)}.doc`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setShowExportDropdown(false);
    };

    // Contextual Menu State
    const [menuState, setMenuState] = useState({
        isOpen: false,
        candidate: null,
        position: { top: 0, left: 0 }
    });

    // Confirmation & Alert Modal State
    const [confirmModal, setConfirmModal] = useState({
        isOpen: false,
        title: '',
        message: '',
        type: 'danger',
        confirmText: 'Confirm',
        cancelText: 'Cancel',
        isAlert: false,
        onConfirm: null
    });

    const [isModalOpen, setIsModalOpen] = useState(false);

    const handleOpenMenu = (e, candidate) => {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();

        // Calculate smart position
        const menuWidth = 224; // w-56 is 14rem = 224px
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;

        let top = rect.bottom + 8;
        let left = rect.right - menuWidth;

        // Check overflow bottom
        if (top + 300 > screenHeight) {
            top = rect.top - 8 - 300;
            if (top < 10) top = rect.bottom + 8;
        }

        // Check overflow left
        if (left < 10) {
            left = rect.left;
        }

        setMenuState({
            isOpen: true,
            candidate: candidate,
            position: { top, left }
        });
    };

    const handleCloseMenu = () => {
        setMenuState(prev => ({ ...prev, isOpen: false }));
    };

    const handleAction = async (action, candidate) => {
        if (action === 'delete') {
            setConfirmModal({
                isOpen: true,
                title: 'Delete Candidate',
                message: `Are you sure you want to permanently delete candidate "${candidate.name}"?\nThis cannot be undone.`,
                type: 'danger',
                confirmText: 'Delete',
                cancelText: 'Cancel',
                isAlert: false,
                onConfirm: async () => {
                    try {
                        const response = await fetch(`${API_URL}/api/resume/candidates/${candidate.id}/`, {
                            method: 'DELETE',
                            headers: {
                                'Authorization': `Bearer ${localStorage.getItem('token')}`
                            }
                        });

                        if (response.ok) {
                            setCandidates(prev => prev.filter(c => c.id !== candidate.id));
                        } else {
                            setConfirmModal({
                                isOpen: true,
                                title: 'Deletion Failed',
                                message: 'Failed to delete candidate. Please try again.',
                                type: 'danger',
                                confirmText: 'OK',
                                isAlert: true
                            });
                        }
                    } catch (err) {
                        console.error("Error deleting candidate:", err);
                        setConfirmModal({
                            isOpen: true,
                            title: 'Error',
                            message: 'Error connecting to server.',
                            type: 'danger',
                            confirmText: 'OK',
                            isAlert: true
                        });
                    }
                }
            });
        } else if (action === 'view-resume') {
            if (candidate.resume_file) {
                let resumeUrl = candidate.resume_file;
                if (!resumeUrl.startsWith('http')) {
                    const token = localStorage.getItem('token');
                    fetch(`${API_URL}/api/resume/preview-token?file_path=${encodeURIComponent(resumeUrl)}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    })
                    .then(res => {
                        if (res.ok) return res.json();
                        throw new Error("Preview token issuance failed");
                    })
                    .then(data => {
                        window.open(`${API_URL}/media/resumes/${resumeUrl}?token=${encodeURIComponent(data.preview_token)}`, '_blank');
                    })
                    .catch(() => {
                        fetch(`${API_URL}/media/resumes/${resumeUrl}`, {
                            headers: { 'Authorization': `Bearer ${token}` }
                        })
                        .then(r => r.blob())
                        .then(blob => window.open(URL.createObjectURL(blob), '_blank'))
                        .catch(() => alert("Failed to load candidate resume."));
                    });
                    return;
                }
                window.open(resumeUrl, '_blank');
            } else {
                alert("No resume file available for this candidate.");
            }
        } else {
            console.log(`Unimplemented action: ${action}`);
        }
    };

    const fetchCandidates = async (background = false) => {
        try {
            if (!background) setLoading(true);
            const response = await fetch(`${API_URL}/api/resume/candidates/`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                cache: 'no-store'
            });
            if (!response.ok) throw new Error('Failed to fetch candidates');
            const data = await response.json();
            setCandidates(data);
        } catch (err) {
            console.error("Error fetching candidates:", err);
            setError(err.message);
        } finally {
            if (!background) setLoading(false);
        }
    };

    React.useEffect(() => {
        fetchCandidates(); // Initial
        const interval = setInterval(() => fetchCandidates(true), 5000); // Poll

        const handleFocus = () => fetchCandidates(true);
        window.addEventListener('focus', handleFocus);
        return () => {
            clearInterval(interval);
            window.removeEventListener('focus', handleFocus);
        };
    }, []);

    return (
        <div className="min-h-screen bg-gray-50 pb-12 relative">
            <div className="w-full space-y-6">
                {/* Header Section */}
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 sm:p-6">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                        <div className="flex-1">
                            <h1 className="text-2xl sm:text-3xl font-bold text-[#5d8c2c] tracking-tight flex items-center gap-3">
                                <div className="p-2 sm:p-2.5 bg-white rounded-xl border border-gray-200">
                                    <Users className="text-green-600" size={24} />
                                </div>
                                All Candidates
                            </h1>
                            <p className="text-gray-700 text-sm mt-2 max-w-2xl font-medium">
                                Manage and track your complete applicant pool across all stages. View profiles, assign tests, and move candidates through your hiring pipeline.
                            </p>
                        </div>
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
                            <div className="bg-white text-[#5d8c2c] px-4 py-3 rounded-xl text-sm font-bold border border-gray-200 flex items-center gap-2 shadow-sm justify-center sm:justify-start">
                                <Users size={18} className="text-green-600" />
                                <div className="flex flex-col items-start">
                                    <span className="text-xs text-gray-500 uppercase tracking-wide">Total</span>
                                    <span className="text-xl sm:text-2xl font-extrabold text-[#5d8c2c]">{candidates.length}</span>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsModalOpen(true)}
                                className="px-5 py-3 bg-primary text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-md"
                            >
                                <User className="w-4 h-4" />
                                Add Candidate
                            </button>
                        </div>
                    </div>
                </div>

                {/* Candidates Table */}
                <CandidateTable
                    candidates={candidates}
                    currentStage="All"
                    onRefresh={fetchCandidates}
                    showRoleColumn={true}
                    showStageColumn={true}
                    enableStageFilter={true}
                    enableScoreFilter={true}
                    showAnalyticsAction={true}
                    onPromote={(ids, stage) => {
                        if (!ids || ids.length === 0) return;

                        // Check if promoting to Offer Sent or if any candidate will be auto-promoted to Offer Sent
                        const selected = candidates.filter(c => ids.includes(c.id));
                        const willReceiveOffer = stage === 'Offer Sent' || (stage === 'NEXT' && selected.some(c => c.stage === 'Technical Interview' || c.stage === 'HR Round'));

                        const doPromote = async () => {
                            try {
                                const res = await fetch(`${API_URL}/api/resume/candidates/bulk-update/`, {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                                    },
                                    body: JSON.stringify({
                                        candidate_ids: ids,
                                        stage: stage || 'NEXT'
                                    })
                                });

                                if (res.ok) {
                                    setConfirmModal({
                                        isOpen: true,
                                        title: 'Promotion Successful',
                                        message: `${ids.length} candidate(s) promoted successfully to ${stage === 'NEXT' ? 'their respective next stages' : stage}.`,
                                        type: 'success',
                                        confirmText: 'Awesome',
                                        isAlert: true,
                                        onConfirm: () => fetchCandidates()
                                    });
                                    fetchCandidates();
                                } else {
                                    const errorData = await res.json();
                                    setConfirmModal({
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
                                setConfirmModal({
                                    isOpen: true,
                                    title: 'Error',
                                    message: 'An error occurred during promotion. Please try again.',
                                    type: 'danger',
                                    confirmText: 'OK',
                                    isAlert: true
                                });
                            }
                        };

                        if (willReceiveOffer) {
                            const notDoneAnyRound = selected.filter(c => {
                                const hasAptitude = c.analysis_data?.correct !== undefined || c.analysis_data?.score_percentage !== undefined;
                                const hasCoding = c.analysis_data?.passed !== undefined;
                                const hasInterview = c.analysis_data?.interview !== undefined;
                                return !(hasAptitude || hasCoding || hasInterview);
                            });

                            if (notDoneAnyRound.length > 0) {
                                const names = notDoneAnyRound.map(c => c.name).join(', ');
                                setConfirmModal({
                                    isOpen: true,
                                    title: 'Missing Assessment Warning',
                                    message: `The following candidate(s) have NOT completed test rounds (Aptitude, Coding, or Interview):\n${names}\n\nDo you want to proceed with sending them the offer letter?`,
                                    type: 'warning',
                                    confirmText: 'Proceed Anyway',
                                    cancelText: 'Cancel',
                                    isAlert: false,
                                    onConfirm: doPromote
                                });
                                return;
                            }
                        }

                        setConfirmModal({
                            isOpen: true,
                            title: 'Promote Candidates',
                            message: `Promote ${ids.length} selected candidate(s) to ${stage === 'NEXT' ? 'their respective NEXT stages' : stage}?`,
                            type: 'info',
                            confirmText: 'Promote',
                            cancelText: 'Cancel',
                            isAlert: false,
                            onConfirm: doPromote
                        });
                    }}
                    onDelete={(ids) => {
                        if (!ids || ids.length === 0) return;
                        setConfirmModal({
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
                                    setConfirmModal({
                                        isOpen: true,
                                        title: 'Deleted Successfully',
                                        message: `${ids.length} candidate(s) deleted successfully.`,
                                        type: 'success',
                                        confirmText: 'OK',
                                        isAlert: true,
                                        onConfirm: () => fetchCandidates()
                                    });
                                    fetchCandidates();
                                } catch (err) {
                                    console.error("Deletion failed", err);
                                    setConfirmModal({
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

            {/* Floating Action Menu Portal */}
            <AnimatePresence>
                {menuState.isOpen && (
                    <FixedActionMenu
                        position={menuState.position}
                        candidate={menuState.candidate}
                        onClose={handleCloseMenu}
                        onAction={handleAction}
                    />
                )}
            </AnimatePresence>

            {/* Add Candidate Modal */}
            <AddCandidateModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onAdd={(newCandidate) => {
                    setCandidates(prev => [newCandidate, ...prev]);
                }}
            />

            {/* Centered Modern Confirmation & Alert Modal */}
            <ConfirmationModal
                isOpen={confirmModal.isOpen}
                onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                onConfirm={confirmModal.onConfirm}
                title={confirmModal.title}
                message={confirmModal.message}
                type={confirmModal.type}
                confirmText={confirmModal.confirmText}
                cancelText={confirmModal.cancelText}
                isAlert={confirmModal.isAlert}
            />
        </div>
    );
};

export default Candidates;
