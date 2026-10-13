import React, { useState, useMemo, useEffect } from 'react';
import {
    MoreHorizontal, ChevronDown, CheckCircle, XCircle, Clock,
    AlertCircle, FileText, Download, Mail, Filter, Search, RotateCw,
    Info, Trash2, ArrowRight, Square, CheckSquare, Briefcase, BarChart2,
    Sparkles, BookOpen, UserCircle, X, RefreshCcw
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import AnalyticsModal from './AnalyticsModal';
import InterviewModal from './InterviewModal';
import ScoreBreakdownModal from './ScoreBreakdownModal';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import API_URL from '../apiConfig';

const STAGE_FLOW = {
    'Resume Screening': ['Aptitude Round', 'Coding Round', 'Technical Interview'],
    'Screened Candidates': ['Aptitude Round', 'Coding Round', 'Technical Interview'],
    'Aptitude Round': ['Coding Round', 'Technical Interview'],
    'Coding Round': ['Technical Interview'],
    'Technical Interview': ['Offer Sent']
};

// Reusable PromoteAction UI component for standardized bulk actions
const PromoteAction = ({ onClick, disabled, label, variant = "blue" }) => {
    const isBlue = variant === "blue";
    const isRed = variant === "red";
    const baseClass = "px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 border shadow-sm h-9 min-w-[120px]";
    const activeClass = isBlue
        ? "bg-blue-600 hover:bg-blue-700 text-white border-blue-700 hover:shadow-md active:scale-95"
        : isRed
            ? "bg-red-600 hover:bg-red-700 text-white border-red-700 hover:shadow-md active:scale-95"
            : "bg-green-600 hover:bg-green-700 text-white border-green-700 hover:shadow-md active:scale-95";
    const disabledClass = "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed opacity-60";

    return (
        <button
            disabled={disabled}
            onClick={onClick}
            className={`${baseClass} ${disabled ? disabledClass : activeClass}`}
        >
            {!isBlue && <CheckCircle size={14} />}
            {label}
        </button>
    );
};

// Performance Modal Component
const PerformanceModal = ({ candidate, onClose }) => {
    if (!candidate) return null;
    // Extract performance data. Analysis data structure: { correct: N, total: M, score_percentage: X, time_taken_seconds: Y }
    const perf = candidate.analysis_data || {};
    const isAptitude = candidate.stage === 'Aptitude Round';
    const isCoding = candidate.stage === 'Coding Round';

    // Calculate time taken from seconds
    const formatTime = (seconds) => {
        if (!seconds) return "N/A";
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}m ${secs}s`;
    };
    const timeTaken = formatTime(perf.time_taken_seconds);

    // Stage-specific labels
    const correctLabel = isCoding ? 'Passed' : 'Correct';
    const incorrectLabel = isCoding ? 'Failed' : 'Incorrect';
    const totalLabel = isCoding ? 'Total Test Cases' : 'Total Questions';
    const correctCount = perf.correct || perf.passed || 0;
    const totalCount = perf.total || 0;
    const incorrectCount = totalCount - correctCount;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden transform scale-100 transition-all">
                <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <h3 className="font-bold text-gray-900">Performance Report</h3>
                    <button onClick={onClose}><X className="w-5 h-5 text-gray-400 hover:text-gray-600" /></button>
                </div>
                <div className="p-6 space-y-6">
                    <div className="text-center">
                        <div className="text-4xl font-extrabold text-blue-600 mb-1">{perf.score_percentage ? perf.score_percentage.toFixed(1) : '0.0'}%</div>
                        <p className="text-sm text-gray-500 font-medium uppercase tracking-wide">Accuracy Score</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-green-50 p-3 rounded-xl border border-green-100 text-center">
                            <div className="text-xl font-bold text-green-700">{correctCount}</div>
                            <div className="text-xs text-green-600 font-bold uppercase">{correctLabel}</div>
                        </div>
                        <div className="bg-red-50 p-3 rounded-xl border border-red-100 text-center">
                            <div className="text-xl font-bold text-red-700">{incorrectCount}</div>
                            <div className="text-xs text-red-600 font-bold uppercase">{incorrectLabel}</div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                            <span className="text-sm text-gray-600 flex items-center gap-2">
                                <Clock size={16} /> Time Taken
                            </span>
                            <span className="font-bold text-gray-900">{timeTaken}</span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                            <span className="text-sm text-gray-600 flex items-center gap-2">
                                <CheckCircle size={16} /> {totalLabel}
                            </span>
                            <span className="font-bold text-gray-900">{totalCount}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const hasResumeFile = (resumeFile) => {
    if (!resumeFile) return false;
    const fileStr = String(resumeFile).trim().toLowerCase();
    return fileStr !== "" && fileStr !== "null" && fileStr !== "undefined" && fileStr !== "n/a" && fileStr !== "none";
};


const ResumeModal = ({ resumeUrl, onClose }) => {
    if (!resumeUrl) return null;

    const [blobUrl, setBlobUrl] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let isMounted = true;
        let createdBlobUrl = null;

        const fetchResume = async () => {
            try {
                setLoading(true);
                setError(null);
                const token = localStorage.getItem('token');
                const cleanUrl = resumeUrl.split('?')[0];

                const response = await fetch(cleanUrl, {
                    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                });

                if (!response.ok) {
                    throw new Error(`Failed to load resume (${response.status})`);
                }

                const blob = await response.blob();
                if (isMounted) {
                    createdBlobUrl = URL.createObjectURL(blob);
                    setBlobUrl(createdBlobUrl);
                    setLoading(false);
                }
            } catch (err) {
                if (isMounted) {
                    setError(err.message || 'Error loading resume');
                    setLoading(false);
                }
            }
        };

        fetchResume();

        return () => {
            isMounted = false;
            if (createdBlobUrl) {
                URL.revokeObjectURL(createdBlobUrl);
            }
        };
    }, [resumeUrl]);

    return (
        <div className="fixed inset-0 z-[20000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl h-[90vh] overflow-hidden flex flex-col transform scale-100 transition-all">
                <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <h3 className="font-bold text-gray-900 flex items-center gap-2">
                        <FileText className="text-green-600" size={20} />
                        Candidate Resume Viewer
                    </h3>
                    <div className="flex items-center gap-3">
                        <button onClick={onClose} className="p-1.5 hover:bg-gray-200 rounded-lg text-gray-400 hover:text-gray-600">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>
                <div className="flex-1 bg-gray-100 p-2 flex items-center justify-center">
                    {loading ? (
                        <div className="text-sm font-medium text-gray-500 flex items-center gap-2">
                            <RotateCw className="w-4 h-4 animate-spin text-green-600" />
                            Loading candidate resume securely...
                        </div>
                    ) : error ? (
                        <div className="text-sm font-medium text-red-500 bg-red-50 border border-red-200 p-4 rounded-xl">
                            {error}
                        </div>
                    ) : (
                        <iframe
                            src={blobUrl}
                            title="Resume Viewer"
                            className="w-full h-full border-0 rounded-xl bg-white"
                        />
                    )}
                </div>
            </div>
        </div>
    );
};


const CandidateTable = ({
    candidates,
    currentStage,
    onRefresh,
    showRoleColumn = false,
    showStageColumn = false,
    enableStageFilter = false,
    showAnalyticsAction = false,
    showRecommendation = false,
    enableScoreFilter = false,
    enableStatusFilter = true, // Default true to maintain backward capability
    enableRecommendationFilter = false, // New Prop
    onPromote,
    onReleaseOffer,
    onDelete
}) => {
    // ... State ...
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [searchTerm, setSearchTerm] = useState('');
    const [filter, setFilter] = useState('All'); // Status Filter
    const [roleFilter, setRoleFilter] = useState('All Roles');
    const [stageFilter, setStageFilter] = useState('All Stages');
    const [scoreRange, setScoreRange] = useState('All Scores');
    const [recommendationFilter, setRecommendationFilter] = useState('All Recommendations'); // New State
    const [targetStage, setTargetStage] = useState('NEXT');
    const [showExportDropdown, setShowExportDropdown] = useState(false);
    const [viewResumeUrl, setViewResumeUrl] = useState(null);

    // --- Data Export Utilities ---
    const prepareExportData = (exportType) => {
        let targetData = [];
        if (exportType === 'selected') {
            targetData = candidates.filter(c => selectedIds.has(c.id));
        } else if (exportType === 'filtered') {
            targetData = filteredCandidates;
        } else {
            targetData = candidates;
        }

        return targetData.map((c, index) => {
            const rec = getRecommendation(c);
            const status = getAssessmentStatus(c, currentStage);
            const scoreData = getDisplayScore(c);
            return {
                "S.No": index + 1,
                "Name": c.name,
                "Email": c.email,
                "Job Role": c.role || 'N/A',
                "Current Stage": c.stage,
                "Status": status,
                "AI Recommendation": rec.label,
                "Accuracy Score": scoreData.primary + (scoreData.secondary ? ` ${scoreData.secondary}` : '')
            };
        });
    };

    const handleExportExcel = (type) => {
        const data = prepareExportData(type);
        if (data.length === 0) {
            alert("No data available to export.");
            return;
        }
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

        XLSX.writeFile(workbook, `Candidates_Export_${type}_${new Date().toISOString().slice(0, 10)}.xlsx`);
        setShowExportDropdown(false);
    };

    const handleExportPDF = (type) => {
        const data = prepareExportData(type);
        if (data.length === 0) {
            alert("No data available to export.");
            return;
        }

        const doc = new jsPDF();
        
        // Add Title Header
        doc.setFontSize(18);
        doc.setTextColor(93, 140, 44); // Brand Color #5d8c2c
        doc.text("RoleReady - Candidate Assessment Dataset", 14, 20);
        
        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        doc.text(`Generated on: ${new Date().toLocaleString()} | Scope: ${type.toUpperCase()}`, 14, 26);
        doc.text(`Total Candidates: ${data.length}`, 14, 31);
        
        // Table Columns & Rows
        const headers = [["S.No", "Name", "Email", "Role", "Stage", "Status", "AI Rec", "Score"]];
        const body = data.map(row => [
            row["S.No"],
            row["Name"],
            row["Email"],
            row["Job Role"],
            row["Current Stage"],
            row["Status"],
            row["AI Recommendation"],
            row["Accuracy Score"]
        ]);

        autoTable(doc, {
            startY: 36,
            head: headers,
            body: body,
            theme: 'striped',
            headStyles: { fillColor: [93, 140, 44] }, // #5d8c2c
            styles: { fontSize: 8, cellPadding: 2 },
            columnStyles: {
                2: { cellWidth: 40 }
            }
        });

        doc.save(`Candidates_Report_${type}_${new Date().toISOString().slice(0, 10)}.pdf`);
        setShowExportDropdown(false);
    };

    const handleExportWord = (type) => {
        const data = prepareExportData(type);
        if (data.length === 0) {
            alert("No data available to export.");
            return;
        }

        const tableRows = data.map(row => `
            <tr>
                <td>${row["S.No"]}</td>
                <td style="font-weight: bold;">${row["Name"]}</td>
                <td>${row["Email"]}</td>
                <td>${row["Job Role"]}</td>
                <td>${row["Current Stage"]}</td>
                <td>${row["Status"]}</td>
                <td>${row["AI Recommendation"]}</td>
                <td>${row["Accuracy Score"]}</td>
            </tr>
        `).join('');

        const htmlContent = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
            <title>Candidate Assessment Dossier</title>
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
            <h1>Candidate Assessment Dossier</h1>
            <div class="meta">
                Generated: ${new Date().toLocaleString()}<br/>
                Report Scope: ${type.toUpperCase()}<br/>
                Total Active Records: ${data.length}
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
                        <th>AI Recommendation</th>
                        <th>Accuracy Score</th>
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
        a.download = `Candidates_Dossier_${type}_${new Date().toISOString().slice(0, 10)}.doc`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setShowExportDropdown(false);
    };

    // Sort Config
    const [sortConfig, setSortConfig] = useState({ key: 'score', direction: 'desc' });

    // Modal State
    const [viewCandidate, setViewCandidate] = useState(null);
    const [viewPerformance, setViewPerformance] = useState(null);
    const [viewInterview, setViewInterview] = useState(null);
    const [viewScoreBreakdown, setViewScoreBreakdown] = useState(null);

    // ... Derived Lists & Sort Helpers ...
    // (Preserve existing useMemo/handleSort logic implicitly or explicit copy if short)

    const availableRoles = useMemo(() => {
        const roles = new Set(candidates.map(c => c.role).filter(Boolean));
        return ['All Roles', ...Array.from(roles)];
    }, [candidates]);

    // Calculate Recommendation based on score (Same logic as getRecommendation)
    const getRecLabel = (score) => {
        if (score >= 88) return 'Strongly Recommend';
        if (score >= 75) return 'Recommend';
        if (score >= 60) return 'Borderline';
        return 'Not Recommended';
    };

    const availableStages = useMemo(() => {
        const stages = new Set(candidates.map(c => c.stage).filter(Boolean));
        return ['All Stages', ...Array.from(stages)];
    }, [candidates]);

    const validTargetStages = useMemo(() => {
        if (selectedIds.size === 0) return [];

        const selectedCandidates = candidates.filter(c => selectedIds.has(c.id));
        const distinctStages = Array.from(new Set(selectedCandidates.map(c => c.stage)));

        if (distinctStages.length === 0) return [];

        let commonAllowed = null;
        distinctStages.forEach(stage => {
            const flows = STAGE_FLOW[stage] || [];
            if (commonAllowed === null) {
                commonAllowed = flows;
            } else {
                commonAllowed = commonAllowed.filter(s => flows.includes(s));
            }
        });

        return commonAllowed || [];
    }, [selectedIds, candidates]);

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const filteredCandidates = useMemo(() => {
        let items = candidates.filter(c => {
            const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                c.email.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesStatus = filter === 'All' || c.status === filter;
            const matchesRole = roleFilter === 'All Roles' || c.role === roleFilter;
            const matchesStage = stageFilter === 'All Stages' || c.stage === stageFilter;



            let matchesScore = true;
            if (scoreRange !== 'All Scores') {
                const s = c.score || 0;
                if (scoreRange === '90+') matchesScore = s >= 90;
                else if (scoreRange === '80-90') matchesScore = s >= 80 && s < 90;
                else if (scoreRange === '70-80') matchesScore = s >= 70 && s < 80;
                else if (scoreRange === 'Below 70') matchesScore = s < 70;
            }

            let matchesRec = true;
            if (recommendationFilter !== 'All Recommendations') {
                const label = getRecLabel(c.score || 0);
                matchesRec = label === recommendationFilter;
            }

            return matchesSearch && matchesStatus && matchesRole && matchesScore && matchesStage && matchesRec;
        });

        return items.sort((a, b) => {
            if (sortConfig.key === 'score') return sortConfig.direction === 'asc' ? (a.score - b.score) : (b.score - a.score);
            if (sortConfig.key === 'name') return sortConfig.direction === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
            if (sortConfig.key === 'role') return sortConfig.direction === 'asc' ? (a.role || '').localeCompare(b.role || '') : (b.role || '').localeCompare(a.role || '');
            if (sortConfig.key === 'stage') return sortConfig.direction === 'asc' ? (a.stage || '').localeCompare(b.stage || '') : (b.stage || '').localeCompare(a.stage || '');
            return 0;
        });
    }, [candidates, searchTerm, filter, roleFilter, stageFilter, scoreRange, recommendationFilter, sortConfig]);

    const allSelected = filteredCandidates.length > 0 && selectedIds.size === filteredCandidates.length;
    // Assessment Stage check logic
    const isAssessmentStage = ['Aptitude Round', 'Coding Round', 'Technical Interview'].includes(currentStage) || showStageColumn;

    // Helpers
    const getEligibility = (score, stage) => {
        const isInterview = ['Technical Interview', 'Offer Sent', 'Hired'].includes(stage) || currentStage === 'Technical Interview';

        if (score >= 60) {
            if (isInterview) return { label: 'Offer Recommended', color: 'text-green-700 bg-white border-green-200', icon: CheckCircle };
            return { label: 'Next Round Eligible', color: 'text-green-700 bg-white border-green-200', icon: CheckCircle };
        }

        if (isInterview) return { label: 'Offer Not Recommended', color: 'text-red-700 bg-red-50 border-red-200', icon: X };
        return { label: 'Next Round Not Eligible', color: 'text-red-700 bg-red-50 border-red-200', icon: X };
    };

    // ... getRecommendation, getShortReason ...
    const getRecommendation = (candidate) => {
        const score = candidate.score || 0;
        const stage = candidate.stage;
        const status = candidate.status;

        // Resume Screening always shows recommendation based on initial resume score
        const isScreening = ['Resume Screening', 'Screened Candidates'].includes(stage);

        // For assessments, only show recommendation if completed or valid score exists
        if (!isScreening) {
            const s = getAssessmentStatus(candidate, stage);
            if (s !== 'Completed' && score === 0) return { label: 'Pending', color: 'text-gray-400 bg-gray-50 border-gray-200', icon: Clock, confidence: 'Low Confidence' };
        }

        if (score >= 88) return { label: 'Strongly Recommend', color: 'text-green-700 bg-white border-green-200', confidence: 'High Confidence' };
        if (score >= 75) return { label: 'Recommend', color: 'text-blue-700 bg-blue-50 border-blue-200', confidence: 'High Confidence' };
        if (score >= 60) return { label: 'Borderline', color: 'text-green-700 bg-green-50 border-green-200', confidence: 'Medium Confidence' };
        return { label: 'Not Recommended', color: 'text-red-700 bg-red-50 border-red-200', confidence: 'Low Confidence' };
    };

    const getShortReason = (c) => {
        // For technical interview, prioritize interview feedback
        if (c.stage === 'Technical Interview' && c.analysis_data?.interview?.scores?.feedback) {
            return c.analysis_data.interview.scores.feedback.split('.')[0] + ".";
        }

        if (!c.analysis_data?.reasoning) {
            const score = c.score || 0;
            if (score >= 88) return "Strong candidate profile with excellent skill alignment.";
            if (score >= 60) return "Candidate meets the core position requirements.";
            return "Candidate does not meet the minimum requirements.";
        }

        const reasoning = c.analysis_data.reasoning || '';

        // Detect and suppress raw LLM/API error messages — never show technical errors to users
        const isErrorMessage = (
            reasoning.toLowerCase().includes('api') ||
            reasoning.toLowerCase().includes('rate-limit') ||
            reasoning.toLowerCase().includes('failed') ||
            reasoning.toLowerCase().includes('groq') ||
            reasoning.toLowerCase().includes('error') ||
            reasoning.toLowerCase().includes('key')
        );

        if (isErrorMessage) {
            const score = c.score || 0;
            if (score >= 88) return "Strong candidate profile with excellent skill alignment.";
            if (score >= 75) return "Candidate shows strong alignment with job requirements.";
            if (score >= 60) return "Candidate meets the core position requirements.";
            return "Candidate does not meet the minimum required criteria.";
        }

        return reasoning.split('.')[0] + ".";
    };

    const hasCurrentStageData = (c, stage) => {
        if (!c.analysis_data) return false;

        // In global views (Dashboard/All), check against the candidate's current stage
        const effectiveStage = (stage === 'Dashboard' || stage === 'All') ? c.stage : stage;

        if (effectiveStage === 'Aptitude Round') return c.analysis_data.correct !== undefined;
        if (effectiveStage === 'Coding Round') return (c.analysis_data.passed !== undefined || (typeof c.status === 'string' && c.status.includes('/')));
        if (effectiveStage === 'Technical Interview') return c.analysis_data.interview !== undefined;

        // Screening rounds are not "Assessment Rounds", so they don't have "test data" in the same way
        return false;
    };

    const getAssessmentStatus = (candidate, stage) => {
        const status = candidate.status;
        const currentRoundData = hasCurrentStageData(candidate, stage);

        // If explicitly Assigned or In Progress, show Assigned even if no round-specific data exists yet
        if (status === 'In Progress') return 'In Progress';
        if (status === 'Assigned') return 'Assigned';

        // If data exists for the current assessment round, it's Completed
        if (currentRoundData) return 'Completed';

        // For non-assessment stages (like Screening), show the actual candidate status
        const isScreening = ['Resume Screening', 'Screened Candidates'].includes(candidate.stage);
        const isGlobalView = ['Dashboard', 'All'].includes(stage);

        if (isScreening && isGlobalView) {
            return status || 'Applied';
        }

        // Default logic for assessment status
        if (!status || status === 'Pending Assessment' || status === 'Applied') return 'Not Assigned';
        if (typeof status === 'string' && (status.startsWith('Submitted') || status === 'Offer Released' || status === 'Review Pending')) return 'Completed';

        return status || 'Not Assigned';
    };

    const getDisplayScore = (c) => {
        if (!isAssessmentStage && !showStageColumn) {
            // Screened -> Show Resume Score
            return {
                primary: c.score !== undefined ? `${Math.round(c.score)}%` : '0%',
                secondary: null,
                color: getScoreColor(c.score || 0)
            };
        }

        // CRITICAL FIX: Check if score belongs to current stage
        const status = getAssessmentStatus(c, currentStage);
        if (status !== 'Completed') {
            return { primary: '-', secondary: null, color: 'text-gray-400' };
        }

        const isAptitude = currentStage === 'Aptitude Round' || (['Dashboard', 'All'].includes(currentStage) && c.stage === 'Aptitude Round');
        const isCoding = currentStage === 'Coding Round' || (['Dashboard', 'All'].includes(currentStage) && c.stage === 'Coding Round');
        const isInterview = currentStage === 'Technical Interview' || (['Dashboard', 'All'].includes(currentStage) && ['Technical Interview', 'Offer Sent', 'Hired'].includes(c.stage));

        const hasValidData = c.analysis_data && (
            (isAptitude && c.analysis_data.correct !== undefined) ||
            (isCoding && c.analysis_data.passed !== undefined) ||
            (isInterview && c.analysis_data.interview !== undefined)
        );

        if (!hasValidData) {
            // Fallback for simple display
            return {
                primary: `${(c.score || 0).toFixed(1)}%`,
                secondary: null,
                color: getScoreColor(c.score || 0)
            };
        }

        if (status === 'Completed') {
            if (typeof c.status === 'string' && c.status.includes('Submitted:')) {
                const parts = c.status.split(': ')[1].trim();
                const percentage = c.score ? c.score.toFixed(1) : "0.0";

                // CODING ROUND: Show only test cases (4/5), no percentage
                if (currentStage === 'Coding Round') {
                    return {
                        primary: parts.includes('/') ? parts.replace('/', ' / ') : parts,
                        secondary: null,
                        color: getScoreColor(c.score || 0)
                    };
                }

                // APTITUDE ROUND: Show questions with percentage
                return {
                    primary: parts.includes('/') ? parts.replace('/', ' / ') : parts,
                    secondary: `(${percentage}%)`,
                    color: getScoreColor(c.score || 0)
                };
            }
            const percentage = c.score ? c.score.toFixed(1) : "0.0";
            return {
                primary: `${percentage}%`,
                secondary: null,
                color: getScoreColor(c.score || 0)
            };
        }
        return { primary: '-', secondary: null, color: 'text-gray-400' };
    };

    const getScoreColor = (score) => {
        if (score === '-') return 'text-gray-400';
        if (score >= 88) return 'text-green-600';
        if (score >= 75) return 'text-blue-600';
        if (score >= 60) return 'text-green-600';
        return 'text-red-600';
    };

    const getStatusBadge = (candidate, stage) => {
        const s = getAssessmentStatus(candidate, stage);
        if (s === 'Completed' || s === 'Hired' || s === 'Offer Sent')
            return <span className="inline-flex items-center whitespace-nowrap bg-white text-green-700 px-2.5 py-0.5 rounded-full text-xs font-bold border border-green-200">Completed</span>;
        if (s === 'In Progress')
            return <span className="inline-flex items-center whitespace-nowrap bg-white text-green-700 px-2.5 py-0.5 rounded-full text-xs font-bold border border-green-200">In Progress</span>;
        if (s === 'Assigned')
            return <span className="inline-flex items-center whitespace-nowrap bg-white text-blue-700 px-2.5 py-0.5 rounded-full text-xs font-bold border border-blue-200">Assigned</span>;
        if (s === 'Applied')
            return <span className="inline-flex items-center whitespace-nowrap bg-white text-indigo-700 px-2.5 py-0.5 rounded-full text-xs font-bold border border-indigo-200">Applied</span>;
        if (s === 'Rejected')
            return <span className="inline-flex items-center whitespace-nowrap bg-white text-red-700 px-2.5 py-0.5 rounded-full text-xs font-bold border border-red-200">Rejected</span>;

        return <span className="inline-flex items-center whitespace-nowrap bg-gray-100 text-gray-600 px-2.5 py-0.5 rounded-full text-xs font-bold border border-gray-200">{s || 'Not Assigned'}</span>;
    };

    // ... getStageBadgeStyles, toggleSelectAll, toggleSelect ...
    const getStageBadgeStyles = (stage) => {
        if (!stage) return 'bg-white text-gray-600 border-gray-200';
        if (['Hired', 'Offer Sent'].includes(stage)) return 'bg-white text-green-700 border-green-200';
        if (['Resume Screening', 'Screened Candidates'].includes(stage)) return 'bg-white text-slate-600 border-slate-200';
        if (stage === 'Aptitude Round') return 'bg-white text-purple-700 border-purple-200';
        if (stage === 'Coding Round') return 'bg-white text-orange-700 border-orange-200';
        if (stage === 'Technical Interview') return 'bg-white text-teal-700 border-teal-200';
        return 'bg-white text-blue-700 border-blue-200';
    };

    const toggleSelectAll = () => {
        if (allSelected) setSelectedIds(new Set());
        else setSelectedIds(new Set(filteredCandidates.map(c => c.id)));
    };

    const toggleSelect = (id) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    return (
        <div className="space-y-5">
            {/* Search and Filters Bar (Always Visible) */}
            <div className="p-4 bg-white border-b border-gray-100 flex flex-wrap items-center gap-3 rounded-xl shadow-sm border border-gray-200">
                {/* Search */}
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                        type="text"
                        placeholder="Search candidates..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-green-500 outline-none"
                    />
                </div>

                {/* Filters */}
                {enableStageFilter && (
                    <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-slate-800 font-bold focus:ring-2 focus:ring-green-500 outline-none">
                        {availableStages.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                )}
                {showRoleColumn && (
                    <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-slate-800 font-bold focus:ring-2 focus:ring-green-500 outline-none">
                        {availableRoles.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                )}
                {enableScoreFilter && (
                    <select value={scoreRange} onChange={(e) => setScoreRange(e.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-slate-800 font-bold focus:ring-2 focus:ring-green-500 outline-none">
                        <option value="All Scores">All Scores</option>
                        <option value="90+">90% +</option>
                        <option value="80-90">80% - 90%</option>
                        <option value="70-80">70% - 80%</option>
                        <option value="Below 70">Below 70%</option>
                    </select>
                )}
                {enableRecommendationFilter && (
                    <select value={recommendationFilter} onChange={(e) => setRecommendationFilter(e.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-slate-800 font-bold focus:ring-2 focus:ring-green-500 outline-none">
                        <option value="All Recommendations">AI Recommendation</option>
                        <option value="Strongly Recommend">Strongly Recommend (88%+)</option>
                        <option value="Recommend">Recommend (75-87%)</option>
                        <option value="Borderline">Borderline (60-74%)</option>
                        <option value="Not Recommended">Not Recommended (&lt;60%)</option>
                    </select>
                )}
                {enableStatusFilter && (
                    <select value={filter} onChange={(e) => setFilter(e.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-slate-800 font-bold focus:ring-2 focus:ring-green-500 outline-none">
                        <option value="All">All Statuses</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Completed">Completed</option>
                        <option value="Rejected">Rejected</option>
                    </select>
                )}

                <div className="ml-auto">
                    {/* Premium Data Export Dropdown */}
                    <div className="relative">
                        <button
                            onClick={() => setShowExportDropdown(!showExportDropdown)}
                            className="px-4 py-2 bg-white hover:bg-gray-50 text-gray-700 hover:text-gray-900 border border-gray-200 rounded-lg text-sm font-bold transition-all flex items-center gap-2 shadow-sm focus:ring-2 focus:ring-green-500/20"
                        >
                            <Download size={16} className="text-gray-500" />
                            <span>Export</span>
                            <ChevronDown size={14} className={`text-gray-400 transition-transform ${showExportDropdown ? 'rotate-180' : ''}`} />
                        </button>
                        
                        <AnimatePresence>
                            {showExportDropdown && (
                                <>
                                    <div className="fixed inset-0 z-10" onClick={() => setShowExportDropdown(false)} />
                                    <motion.div
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: 10 }}
                                        className="absolute right-0 mt-2 w-72 bg-white border border-gray-100 rounded-xl shadow-xl z-20 py-2 origin-top-right overflow-hidden"
                                    >
                                        <div className="px-4 py-2 border-b border-gray-100 bg-gray-50/50">
                                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Select Export Scope</span>
                                        </div>
                                        
                                        {/* Scope Sections */}
                                        {['selected', 'filtered', 'all'].map((scope) => {
                                            const disabled = scope === 'selected' && selectedIds.size === 0;
                                            const count = scope === 'selected' ? selectedIds.size : scope === 'filtered' ? filteredCandidates.length : candidates.length;
                                            
                                            return (
                                                <div key={scope} className={`border-b border-gray-50 last:border-0 ${disabled ? 'opacity-50' : ''}`}>
                                                    <div className="px-4 py-1.5 flex justify-between items-center text-xs font-semibold text-gray-505">
                                                        <span className="capitalize">{scope} ({count})</span>
                                                    </div>
                                                    <div className="flex px-2 pb-1.5 gap-1">
                                                        <button
                                                            disabled={disabled}
                                                            onClick={() => handleExportExcel(scope)}
                                                            className="flex-1 px-2.5 py-1.5 bg-green-50 hover:bg-green-100 text-green-700 text-xs font-bold rounded-lg border border-green-200/50 transition-colors flex items-center justify-center gap-1 disabled:pointer-events-none"
                                                        >
                                                            Excel
                                                        </button>
                                                        <button
                                                            disabled={disabled}
                                                            onClick={() => handleExportPDF(scope)}
                                                            className="flex-1 px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold rounded-lg border border-red-200/50 transition-colors flex items-center justify-center gap-1 disabled:pointer-events-none"
                                                        >
                                                            PDF
                                                        </button>
                                                        <button
                                                            disabled={disabled}
                                                            onClick={() => handleExportWord(scope)}
                                                            className="flex-1 px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-lg border border-blue-200/50 transition-colors flex items-center justify-center gap-1 disabled:pointer-events-none"
                                                        >
                                                            Word
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </motion.div>
                                </>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>

            {/* Bulk Actions Panel (Shows when candidates are selected) */}
            <AnimatePresence>
                {selectedIds.size > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="p-4 bg-blue-50 border border-blue-100 rounded-xl flex justify-between items-center shadow-sm"
                    >
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                                    {selectedIds.size}
                                </span>
                                <span className="text-sm font-bold text-blue-900">Selected</span>
                                <button
                                    onClick={() => setSelectedIds(new Set())}
                                    className="text-xs text-blue-600 hover:text-blue-800 font-medium hover:underline ml-2"
                                >
                                    Clear Selection
                                </button>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {onPromote && currentStage !== 'Technical Interview' && validTargetStages.length > 0 && (
                                <div className="flex items-center gap-2 mr-2">
                                    <span className="text-xs font-semibold text-blue-800">To:</span>
                                    <select
                                        value={targetStage}
                                        onChange={(e) => setTargetStage(e.target.value)}
                                        className="h-9 px-2 text-xs font-medium text-blue-900 bg-white border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none shadow-sm cursor-pointer"
                                    >
                                        <option value="NEXT">Auto (Next Stage)</option>
                                        {validTargetStages.map(s => (
                                            <option key={s} value={s}>{s}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {onDelete && (
                                <PromoteAction
                                    label="Delete"
                                    variant="red"
                                    onClick={() => onDelete(Array.from(selectedIds))}
                                />
                            )}
                            {currentStage === 'Technical Interview' ? (
                                onReleaseOffer && (
                                    <PromoteAction
                                        label="Release Offer"
                                        variant="green"
                                        onClick={() => onReleaseOffer(Array.from(selectedIds))}
                                    />
                                )
                            ) : (
                                onPromote && (
                                    <PromoteAction
                                        label={targetStage === 'NEXT' ? "Promote →" : "Promote"}
                                        variant="blue"
                                        onClick={() => onPromote(Array.from(selectedIds), targetStage)}
                                    />
                                )
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className={`bg-white border border-gray-200 rounded-xl shadow-md overflow-x-auto ${!['Dashboard', 'All'].includes(currentStage) ? '[&::-webkit-scrollbar]:hidden [scrollbar-width:none]' : ''}`}>
                <table className="w-full text-left min-w-[1000px]">
                    <thead className="bg-gradient-to-r from-gray-50 to-gray-100 border-b-2 border-gray-200">
                        <tr>
                            <th className="px-6 py-4 w-16">
                                <button onClick={toggleSelectAll}>
                                    {allSelected ? <CheckSquare size={20} className="text-green-600" /> : <Square size={20} className="text-gray-400" />}
                                </button>
                            </th>
                            <th onClick={() => handleSort('name')} className="px-6 py-4 text-xs font-extrabold text-slate-800 uppercase tracking-wider cursor-pointer hover:text-green-600">
                                Candidate {sortConfig.key === 'name' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                            </th>
                            {showRoleColumn && (
                                <th onClick={() => handleSort('role')} className="px-6 py-4 text-xs font-extrabold text-slate-800 uppercase tracking-wider cursor-pointer hover:text-green-600">
                                    Job Role {sortConfig.key === 'role' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                </th>
                            )}
                            {showStageColumn && (
                                <th onClick={() => handleSort('stage')} className="px-6 py-4 text-xs font-extrabold text-slate-800 uppercase tracking-wider cursor-pointer hover:text-green-600">
                                    Current Stage {sortConfig.key === 'stage' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                </th>
                            )}
                            {isAssessmentStage && (
                                <>
                                    <th className="px-6 py-4 text-xs font-extrabold text-slate-800 uppercase tracking-wider whitespace-nowrap">Status</th>
                                    <th className="px-6 py-4 text-xs font-extrabold text-slate-800 uppercase tracking-wider whitespace-nowrap">Eligibility</th>
                                    <th className="px-6 py-4 text-xs font-extrabold text-slate-800 uppercase tracking-wider whitespace-nowrap">Performance</th>
                                </>
                            )}
                            {/* Recommendation Column only for Resume Screening or when explicitly asked */}
                            {showRecommendation && (
                                <th onClick={() => handleSort('recommendation')} className="px-6 py-4 text-xs font-extrabold text-slate-800 uppercase tracking-wider cursor-pointer hover:text-green-600">
                                    AI Recommendation {sortConfig.key === 'recommendation' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                </th>
                            )}
                            <th onClick={() => handleSort('score')} className="px-6 py-4 text-xs font-extrabold text-slate-800 uppercase tracking-wider cursor-pointer hover:text-green-600">
                                {isAssessmentStage ? 'Test Score' : 'Score'} {sortConfig.key === 'score' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                            </th>
                            {showAnalyticsAction && (
                                <th className="px-6 py-4 text-xs font-extrabold text-gray-600 uppercase tracking-wider text-right">
                                    Actions
                                </th>
                            )}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {filteredCandidates.map((c, index) => {
                            const scoreData = getDisplayScore(c);

                            // Trust status for eligibility (if completed or in screening, it's eligible/ineligible based on score)
                            const status = getAssessmentStatus(c, currentStage);
                            const hasValidScore = status === 'Completed' || ['Resume Screening', 'Screened Candidates'].includes(c.stage);

                            const rec = getRecommendation(c);
                            const eligibility = hasValidScore ? getEligibility(c.score || 0, c.stage) : { label: 'Pending Assessment', color: 'text-gray-500 bg-gray-50 border-gray-200', icon: Clock };

                            return (
                                <motion.tr
                                    key={c.id}
                                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                                    className={`group transition-all hover:bg-gray-50/80`}
                                >
                                    <td className="px-6 py-4">
                                        <button onClick={() => toggleSelect(c.id)}>
                                            {selectedIds.has(c.id) ? <CheckSquare size={20} className="text-green-600" /> : <Square size={20} className="text-gray-300" />}
                                        </button>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="font-bold text-slate-900 text-sm">{c.name}</div>
                                        <div className="text-xs text-slate-500">{c.email}</div>
                                    </td>
                                    {showRoleColumn && (
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <Briefcase size={14} className="text-slate-400" />
                                                <span className="text-sm font-medium text-slate-700">{c.role || 'N/A'}</span>
                                            </div>
                                        </td>
                                    )}
                                    {showStageColumn && (
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`inline-flex items-center whitespace-nowrap px-2.5 py-0.5 rounded-lg text-xs font-bold border ${getStageBadgeStyles(c.stage)}`}>
                                                {c.stage}
                                            </span>
                                        </td>
                                    )}

                                    {isAssessmentStage && (
                                        <>
                                            <td className="px-6 py-4 whitespace-nowrap">{getStatusBadge(c, currentStage)}</td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                {hasValidScore ? (
                                                    <span className={`inline-flex items-center whitespace-nowrap px-2.5 py-0.5 rounded-full text-xs font-bold border gap-1 ${eligibility.color}`}>
                                                        <eligibility.icon size={12} /> {eligibility.label}
                                                    </span>
                                                ) : (
                                                    <span className="text-xs text-gray-400 font-medium">-</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                {hasValidScore ? (
                                                    ['Technical Interview', 'Offer Sent', 'Hired'].includes(c.stage) ? (
                                                        <button onClick={() => setViewInterview(c)} className="text-xs font-bold text-teal-600 hover:underline flex items-center gap-1">
                                                            <FileText size={14} /> Transcript
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={() => ['Resume Screening', 'Screened Candidates'].includes(c.stage) ? setViewCandidate(c) : setViewPerformance(c)}
                                                            className="text-xs font-bold text-green-600 hover:underline flex items-center gap-1"
                                                        >
                                                            <BarChart2 size={14} /> {['Resume Screening', 'Screened Candidates'].includes(c.stage) ? 'Analysis' : 'View'}
                                                        </button>
                                                    )
                                                ) : <span className="text-xs text-gray-400">-</span>}
                                            </td>
                                        </>
                                    )}

                                    {showRecommendation && (
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col items-start gap-1">
                                                <div className="flex items-center gap-2 cursor-help group/tooltip relative">
                                                    <span className={`px-2.5 py-1 rounded-md text-xs font-bold border ${rec.color}`}>
                                                        {rec.label}
                                                    </span>
                                                    <span className="text-gray-400 hover:text-green-600 cursor-pointer"><Info size={14} /></span>
                                                    <div className="absolute left-0 bottom-full mb-2 w-64 bg-gray-900 text-white text-xs rounded-lg p-3 shadow-xl opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all z-20 pointer-events-none">
                                                        <div className="font-bold mb-1">AI Reasoning:</div>
                                                        {getShortReason(c)}
                                                        <div className="absolute -bottom-1 left-4 w-2 h-2 bg-gray-900 transform rotate-45"></div>
                                                    </div>
                                                </div>
                                                <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400 ml-1">
                                                    {rec.confidence}
                                                </span>
                                            </div>
                                        </td>
                                    )}

                                    <td className="px-6 py-4">
                                        <div className="flex flex-col">
                                            {['Technical Interview', 'Offer Sent', 'Hired'].includes(c.stage) && c.analysis_data?.interview?.scores ? (
                                                <button
                                                    onClick={() => setViewScoreBreakdown(c)}
                                                    className="font-bold text-sm text-green-600 hover:underline cursor-pointer text-left"
                                                >
                                                    {scoreData.primary}
                                                </button>
                                            ) : (
                                                <span className={`font-bold text-sm ${scoreData.color}`}>
                                                    {scoreData.primary}
                                                </span>
                                            )}
                                            {scoreData.secondary && (
                                                <span className="text-xs text-gray-500 font-medium">
                                                    {scoreData.secondary}
                                                </span>
                                            )}
                                        </div>
                                    </td>

                                    {/* ACTIONS */}
                                    {showAnalyticsAction && (
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex justify-end gap-2">
                                                {hasResumeFile(c.resume_file) ? (
                                                    <>
                                                        <button
                                                            onClick={() => setViewCandidate(c)}
                                                            className="px-3 py-1.5 text-[10px] font-bold text-green-600 hover:text-white hover:bg-green-600 bg-white border border-green-200 rounded transition-colors"
                                                        >
                                                            Analysis
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                let resumeUrl = c.resume_file;
                                                                if (!resumeUrl.startsWith('http')) {
                                                                    resumeUrl = `${API_URL}/media/resumes/${resumeUrl}`;
                                                                }
                                                                setViewResumeUrl(resumeUrl);
                                                            }}
                                                            className="px-3 py-1.5 text-[10px] font-bold text-blue-600 hover:text-white hover:bg-blue-600 bg-white border border-blue-200 rounded transition-colors flex items-center gap-1"
                                                        >
                                                            <FileText size={10} /> Resume
                                                        </button>
                                                    </>
                                                ) : (
                                                    !c.analysis_data?.interview?.transcript && <span className="text-xs text-gray-400 font-medium mr-4">-</span>
                                                )}
                                                {['Technical Interview', 'Offer Sent', 'Hired'].includes(c.stage) && c.analysis_data?.interview?.transcript && (
                                                    <button
                                                        onClick={() => setViewInterview(c)}
                                                        className="px-3 py-1.5 text-[10px] font-bold text-green-700 hover:text-white hover:bg-green-700 bg-white border border-green-200 rounded transition-colors flex items-center gap-1"
                                                    >
                                                        <FileText size={10} /> Transcript
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    )}
                                </motion.tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <AnimatePresence>
                {viewCandidate && (
                    <AnalyticsModal 
                        candidate={viewCandidate} 
                        onClose={() => setViewCandidate(null)} 
                        onViewResume={(url) => {
                            setViewCandidate(null);
                            setViewResumeUrl(url);
                        }}
                    />
                )}
                {viewPerformance && <PerformanceModal candidate={viewPerformance} onClose={() => setViewPerformance(null)} />}
                {viewInterview && <InterviewModal candidate={viewInterview} onClose={() => setViewInterview(null)} />}
                {viewScoreBreakdown && (
                    <ScoreBreakdownModal
                        candidate={viewScoreBreakdown}
                        onClose={() => setViewScoreBreakdown(null)}
                        onViewTranscript={() => {
                            const c = viewScoreBreakdown;
                            setViewScoreBreakdown(null);
                            setTimeout(() => setViewInterview(c), 100);
                        }}
                    />
                )}
                {viewResumeUrl && <ResumeModal resumeUrl={viewResumeUrl} onClose={() => setViewResumeUrl(null)} />}
            </AnimatePresence>
        </div >
    );
};

export default CandidateTable;
