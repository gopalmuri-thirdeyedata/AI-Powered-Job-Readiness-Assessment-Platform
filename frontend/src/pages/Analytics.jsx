import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    Users,
    Award,
    BarChart3,
    PieChart as PieIcon,
    Target,
    BrainCircuit,
    ShieldAlert,
    FileText,
    CheckCircle,
    SlidersHorizontal,
    Activity,
    RefreshCw,
    Sparkles,
    Download,
    FileSpreadsheet,
    FileDown,
    AlertTriangle,
    ChevronRight,
    Search,
    ArrowUpDown,
    Filter,
    Eye,
    Cpu,
    Zap,
    Calendar,
    CheckCircle2,
    ChevronDown,
    Check,
} from 'lucide-react';
import {
    ResponsiveContainer,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    PieChart,
    Pie,
    Cell,
} from 'recharts';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import API_URL from '../apiConfig';
import CandidateDetailDrawer from '../components/analytics/CandidateDetailDrawer';

const FUNNEL_COLORS = ['#3b82f6', '#06b6d4', '#8b5cf6', '#6366f1', '#a855f7', '#10b981', '#5d8c2c'];
const RECOMMENDATION_COLORS = {
    'Strong Hire': '#10b981',
    'Consider': '#3b82f6',
    'Review': '#f59e0b',
    'Reject': '#ef4444',
    'Strongly Recommend': '#10b981',
    'Recommend': '#5d8c2c',
    'Borderline': '#f59e0b',
    'Not Recommended': '#ef4444',
    'Pending': '#94a3b8'
};

const DATE_RANGE_OPTIONS = [
    { label: 'All Time', value: 'all', days: null },
    { label: 'Today', value: 'today', days: 1 },
    { label: 'Last 7 Days', value: '7d', days: 7 },
    { label: 'Last 30 Days', value: '30d', days: 30 },
    { label: 'Last 90 Days', value: '90d', days: 90 },
    { label: 'This Year', value: '1y', days: 365 }
];

export default function Analytics() {
    // Primary Data States
    const [candidates, setCandidates] = useState([]);
    const [analyticsData, setAnalyticsData] = useState(null);
    const [activityLogs, setActivityLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [timeAgo, setTimeAgo] = useState('just now');

    // Controls & Filters
    const [selectedRoleFilter, setSelectedRoleFilter] = useState('All Roles');
    const [selectedDateRange, setSelectedDateRange] = useState('all');
    const [liveMode, setLiveMode] = useState(false);
    const [showExportDropdown, setShowExportDropdown] = useState(false);
    const [showRoleDropdown, setShowRoleDropdown] = useState(false);
    const [showDateDropdown, setShowDateDropdown] = useState(false);

    // Dropdown Refs for click-outside dismissal
    const roleDropdownRef = useRef(null);
    const dateDropdownRef = useRef(null);
    const exportDropdownRef = useRef(null);
    
    // Leaderboard Controls
    const [candidateSearch, setCandidateSearch] = useState('');
    const [candidateStageFilter, setCandidateStageFilter] = useState('All Stages');
    const [candidateRecFilter, setCandidateRecFilter] = useState('All');
    const [candidateSort, setCandidateSort] = useState({ field: 'score', dir: 'desc' });
    
    // Interactive Chart States
    const [roundMetricType, setRoundMetricType] = useState('average'); // 'average' | 'pass_rate'
    const [distributionMetric, setDistributionMetric] = useState('overall'); // 'overall' | 'resume' | 'aptitude' | 'coding' | 'interview'
    const [selectedScoreBucket, setSelectedScoreBucket] = useState(null);
    
    // Drawer & Modal State
    const [selectedCandidate, setSelectedCandidate] = useState(null);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [reScreening, setReScreening] = useState(false);

    // Leaderboard Ref for smooth scroll on chart click
    const leaderboardRef = useRef(null);

    // Calculate effective score incorporating available round results
    const getEffectiveScore = useCallback((c) => {
        if (!c) return 0;
        const scores = [];
        
        // Resume score
        if (typeof c.score === 'number' && c.score > 0) {
            scores.push(c.score);
        }
        
        // Aptitude score
        if (c.analysis_data?.score_percentage !== undefined) {
            scores.push(c.analysis_data.score_percentage);
        } else if (c.analysis_data?.correct !== undefined && c.analysis_data?.total) {
            scores.push((c.analysis_data.correct / c.analysis_data.total) * 100);
        }
        
        // Coding score
        if (c.analysis_data?.passed !== undefined && c.analysis_data?.total) {
            scores.push((c.analysis_data.passed / c.analysis_data.total) * 100);
        }
        
        // Interview score
        if (c.analysis_data?.interview?.score !== undefined) {
            scores.push(c.analysis_data.interview.score);
        }
        
        if (scores.length === 0) return c.score || 0;
        const sum = scores.reduce((a, b) => a + b, 0);
        return Math.round(sum / scores.length);
    }, []);

    // Fetch Analytics from Backend
    const fetchAnalytics = useCallback(async (isSilent = false) => {
        if (!isSilent) setLoading(true);
        setError(null);
        try {
            const token = localStorage.getItem('token');
            const headers = { 
                'Authorization': `Bearer ${token}`,
                'Cache-Control': 'no-cache'
            };

            const selectedOption = DATE_RANGE_OPTIONS.find(o => o.value === selectedDateRange);
            const queryParams = new URLSearchParams();
            if (selectedRoleFilter && selectedRoleFilter !== 'All Roles') {
                queryParams.append('role', selectedRoleFilter);
            }
            if (selectedOption?.days) {
                queryParams.append('days', selectedOption.days);
            }

            // 1. Fetch Aggregated Backend Analytics
            const analyticsPromise = fetch(`${API_URL}/api/dashboard/analytics/?${queryParams.toString()}`, { headers })
                .then(res => res.ok ? res.json() : null)
                .catch(() => null);

            // 2. Fetch Raw Candidates for Leaderboard & Search
            const candidatesPromise = fetch(`${API_URL}/api/resume/candidates/`, { headers })
                .then(res => res.ok ? res.json() : [])
                .catch(() => []);

            // 3. Fetch Activity Log
            const activityPromise = fetch(`${API_URL}/api/dashboard/activity/`, { headers })
                .then(res => res.ok ? res.json() : [])
                .catch(() => []);

            const [analyticsRes, candidatesRes, activityRes] = await Promise.all([
                analyticsPromise,
                candidatesPromise,
                activityPromise
            ]);

            if (analyticsRes) {
                setAnalyticsData(analyticsRes);
            }
            if (Array.isArray(candidatesRes)) {
                setCandidates(candidatesRes);
            }
            if (Array.isArray(activityRes)) {
                setActivityLogs(activityRes);
            }
            setLastUpdated(new Date());
            setTimeAgo('just now');
        } catch (err) {
            console.error('Error fetching dashboard analytics:', err);
            setError(err.message || 'Failed to load recruitment analytics');
        } finally {
            if (!isSilent) setLoading(false);
        }
    }, [selectedRoleFilter, selectedDateRange]);

    // Initial Load & on filter change
    useEffect(() => {
        fetchAnalytics(false);
    }, [fetchAnalytics]);

    // Live Data Mode 30s auto-refresh
    useEffect(() => {
        if (!liveMode) return;
        const interval = setInterval(() => {
            fetchAnalytics(true);
        }, 30000);
        return () => clearInterval(interval);
    }, [liveMode, fetchAnalytics]);

    // Timer ticker for "Updated X ago"
    useEffect(() => {
        if (!lastUpdated) return;
        const interval = setInterval(() => {
            const diffSec = Math.floor((new Date() - lastUpdated) / 1000);
            if (diffSec < 10) setTimeAgo('just now');
            else if (diffSec < 60) setTimeAgo(`${diffSec}s ago`);
            else setTimeAgo(`${Math.floor(diffSec / 60)}m ago`);
        }, 5000);
        return () => clearInterval(interval);
    }, [lastUpdated]);

    // Dismiss custom dropdowns when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (roleDropdownRef.current && !roleDropdownRef.current.contains(event.target)) {
                setShowRoleDropdown(false);
            }
            if (dateDropdownRef.current && !dateDropdownRef.current.contains(event.target)) {
                setShowDateDropdown(false);
            }
            if (exportDropdownRef.current && !exportDropdownRef.current.contains(event.target)) {
                setShowExportDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Available Roles dynamically (strictly deduped, 'All Roles' always first)
    const availableRoles = useMemo(() => {
        const sourceRoles = (analyticsData?.available_roles && analyticsData.available_roles.length > 0)
            ? analyticsData.available_roles
            : candidates.map(c => c.applied_role || c.role);
        const set = new Set(sourceRoles.filter(Boolean));
        set.delete('All Roles');
        return ['All Roles', ...Array.from(set)];
    }, [analyticsData, candidates]);

    // Filter Candidates by Date Range and Role for the Leaderboard
    const filteredCandidates = useMemo(() => {
        let result = [...candidates];
        
        // Role filter
        if (selectedRoleFilter !== 'All Roles') {
            result = result.filter(c => (c.applied_role || c.role) === selectedRoleFilter);
        }

        // Date range filter
        const selectedOption = DATE_RANGE_OPTIONS.find(o => o.value === selectedDateRange);
        if (selectedOption?.days) {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - selectedOption.days);
            result = result.filter(c => {
                if (!c.created_at) return true;
                return new Date(c.created_at) >= cutoff;
            });
        }

        // Stage filter
        if (candidateStageFilter !== 'All Stages') {
            result = result.filter(c => c.stage === candidateStageFilter);
        }

        // Recommendation filter
        if (candidateRecFilter !== 'All') {
            result = result.filter(c => {
                const eff = getEffectiveScore(c);
                let rec = 'Review';
                if (eff >= 75) rec = 'Strong Hire';
                else if (eff >= 60) rec = 'Consider';
                return rec === candidateRecFilter;
            });
        }

        // Score bucket filter (if user clicked a score bucket)
        if (selectedScoreBucket !== null) {
            result = result.filter(c => {
                const score = getEffectiveScore(c);
                const bucketMin = selectedScoreBucket * 10;
                const bucketMax = selectedScoreBucket === 9 ? 100 : (selectedScoreBucket + 1) * 10;
                return score >= bucketMin && (selectedScoreBucket === 9 ? score <= bucketMax : score < bucketMax);
            });
        }

        // Search filter
        if (candidateSearch.trim()) {
            const q = candidateSearch.toLowerCase();
            result = result.filter(c => 
                (c.name || '').toLowerCase().includes(q) ||
                (c.email || '').toLowerCase().includes(q) ||
                (c.applied_role || c.role || '').toLowerCase().includes(q) ||
                (Array.isArray(c.skills) && c.skills.some(s => s.toLowerCase().includes(q)))
            );
        }

        // Sorting
        result.sort((a, b) => {
            if (candidateSort.field === 'score') {
                const sa = getEffectiveScore(a);
                const sb = getEffectiveScore(b);
                return candidateSort.dir === 'desc' ? sb - sa : sa - sb;
            }
            if (candidateSort.field === 'name') {
                const na = (a.name || '').toLowerCase();
                const nb = (b.name || '').toLowerCase();
                return candidateSort.dir === 'asc' ? na.localeCompare(nb) : nb.localeCompare(na);
            }
            if (candidateSort.field === 'created_at') {
                const da = new Date(a.created_at || 0);
                const db = new Date(b.created_at || 0);
                return candidateSort.dir === 'desc' ? db - da : da - db;
            }
            return 0;
        });

        return result;
    }, [candidates, selectedRoleFilter, selectedDateRange, candidateStageFilter, candidateRecFilter, selectedScoreBucket, candidateSearch, candidateSort, getEffectiveScore]);

    // KPI Values
    const kpi = useMemo(() => {
        if (analyticsData?.kpi) return analyticsData.kpi;
        const total = filteredCandidates.length;
        const scores = filteredCandidates.map(c => getEffectiveScore(c)).filter(s => s > 0);
        const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
        const hired = filteredCandidates.filter(c => c.stage === 'Hired' || c.status === 'Hired').length;
        const active = filteredCandidates.filter(c => c.status !== 'Rejected' && c.stage !== 'Hired').length;
        const placementRate = total > 0 ? Math.round((hired / total) * 100) : 0;
        
        let healthScore = 0;
        let healthStatus = 'No Data';
        if (total > 0) {
            const evaluatedRatio = scores.length / total;
            const passingRatio = scores.length > 0 ? (scores.filter(s => s >= 60).length / scores.length) : 0;
            const conversionRatio = (total - filteredCandidates.filter(c => c.status === 'Rejected').length) / total;
            healthScore = Math.round(((evaluatedRatio * 0.3) + (passingRatio * 0.4) + (conversionRatio * 0.3)) * 100);
            if (healthScore >= 70) healthStatus = 'Healthy';
            else if (healthScore >= 50) healthStatus = 'Fair';
            else healthStatus = 'Needs Attention';
        }

        return {
            total_applicants: total,
            active_pipeline: active,
            avg_talent_score: avgScore,
            placement_rate: placementRate,
            pipeline_health_score: healthScore,
            pipeline_health_status: healthStatus
        };
    }, [analyticsData, filteredCandidates, getEffectiveScore]);

    // Funnel Data
    const funnelStages = useMemo(() => {
        if (analyticsData?.funnel && analyticsData.funnel.length > 0) {
            return analyticsData.funnel.map(f => ({
                stage: f.name || f.stage,
                count: f.count,
                conversion_pct: f.conversion_rate !== undefined ? f.conversion_rate : (f.conversion_pct || 0),
                drop_off_pct: f.drop_off_rate !== undefined ? f.drop_off_rate : (f.drop_off_pct || 0)
            }));
        }
        const defaultStages = [
            'Resume Screening',
            'Aptitude Round',
            'Coding Round',
            'Technical Interview',
            'Offer Sent',
            'Hired'
        ];
        return defaultStages.map(stage => {
            const count = filteredCandidates.filter(c => c.stage === stage).length;
            return {
                stage,
                count,
                conversion_pct: 0,
                drop_off_pct: 0
            };
        });
    }, [analyticsData, filteredCandidates]);

    // Recommendation Breakdown Data
    const recommendationData = useMemo(() => {
        if (analyticsData?.ai_recommendations && analyticsData.ai_recommendations.length > 0) {
            return analyticsData.ai_recommendations.map(r => ({
                name: r.name || r.category,
                value: r.count,
                percentage: r.percentage,
                color: r.color || RECOMMENDATION_COLORS[r.name || r.category] || '#94a3b8'
            }));
        }
        const recCounts = { 'Strong Hire': 0, 'Consider': 0, 'Review': 0 };
        filteredCandidates.forEach(c => {
            const s = getEffectiveScore(c);
            if (s >= 75) recCounts['Strong Hire']++;
            else if (s >= 60) recCounts['Consider']++;
            else recCounts['Review']++;
        });
        return Object.entries(recCounts)
            .filter(([_, v]) => v > 0)
            .map(([name, value]) => ({
                name,
                value,
                percentage: filteredCandidates.length > 0 ? Math.round((value / filteredCandidates.length) * 100) : 0,
                color: RECOMMENDATION_COLORS[name] || '#94a3b8'
            }));
    }, [analyticsData, filteredCandidates, getEffectiveScore]);

    // Round Performance Data
    const roundPerformanceData = useMemo(() => {
        if (analyticsData?.round_performance && analyticsData.round_performance.length > 0) {
            return analyticsData.round_performance;
        }
        return [
            { round_name: 'Resume Screening', avg_score: 0, median_score: 0, pass_rate: 0, total_evaluated: 0 },
            { round_name: 'Aptitude Round', avg_score: 0, median_score: 0, pass_rate: 0, total_evaluated: 0 },
            { round_name: 'Coding Round', avg_score: 0, median_score: 0, pass_rate: 0, total_evaluated: 0 },
            { round_name: 'Technical Interview', avg_score: 0, median_score: 0, pass_rate: 0, total_evaluated: 0 }
        ];
    }, [analyticsData]);

    // Score Distribution Histogram Data
    const scoreDistributionData = useMemo(() => {
        if (distributionMetric === 'overall' && analyticsData?.score_distribution) {
            return analyticsData.score_distribution.map((count, i) => ({
                range: `${i * 10}-${(i + 1) * 10}%`,
                Candidates: count,
                bucketIndex: i
            }));
        }

        // Compute locally based on selected distributionMetric
        const buckets = Array(10).fill(0);
        filteredCandidates.forEach(c => {
            let score = null;
            if (distributionMetric === 'overall') score = getEffectiveScore(c);
            else if (distributionMetric === 'resume') score = c.score || c.analysis_data?.resume_score;
            else if (distributionMetric === 'aptitude') score = c.analysis_data?.score_percentage ?? (c.analysis_data?.correct ? (c.analysis_data.correct / (c.analysis_data.total || 1)) * 100 : null);
            else if (distributionMetric === 'coding') score = c.analysis_data?.coding_score ?? (c.analysis_data?.passed ? (c.analysis_data.passed / (c.analysis_data.total || 1)) * 100 : null);
            else if (distributionMetric === 'interview') score = c.analysis_data?.interview?.score;

            if (score !== null && score !== undefined && !isNaN(score)) {
                const idx = Math.min(Math.floor(score / 10), 9);
                buckets[idx]++;
            }
        });

        return buckets.map((count, i) => ({
            range: `${i * 10}-${(i + 1) * 10}%`,
            Candidates: count,
            bucketIndex: i
        }));
    }, [distributionMetric, analyticsData, filteredCandidates, getEffectiveScore]);

    // Job Role Insights Data
    const roleInsights = useMemo(() => {
        if (analyticsData?.role_insights && analyticsData.role_insights.length > 0) {
            return analyticsData.role_insights.map(ri => ({
                role: ri.role,
                candidate_count: ri.total_applicants ?? ri.candidate_count ?? 0,
                avg_score: ri.avg_score ?? 0,
                placement_rate: ri.pass_rate ?? ri.placement_rate ?? 0,
                performance_tier: ri.pipeline_status || (ri.avg_score >= 75 ? 'Top Performer' : ri.avg_score >= 60 ? 'Standard' : 'Needs Review')
            }));
        }
        const stats = {};
        candidates.forEach(c => {
            const role = c.applied_role || c.role || 'Unspecified';
            if (!stats[role]) stats[role] = { count: 0, scoreSum: 0, hired: 0 };
            stats[role].count++;
            const s = getEffectiveScore(c);
            stats[role].scoreSum += s;
            if (c.stage === 'Hired' || c.status === 'Hired') stats[role].hired++;
        });
        return Object.entries(stats).map(([role, val]) => ({
            role,
            candidate_count: val.count,
            avg_score: val.count > 0 ? Math.round(val.scoreSum / val.count) : 0,
            placement_rate: val.count > 0 ? Math.round((val.hired / val.count) * 100) : 0,
            performance_tier: val.scoreSum / val.count >= 75 ? 'Top Performer' : val.scoreSum / val.count >= 60 ? 'Standard' : 'Needs Review'
        }));
    }, [analyticsData, candidates, getEffectiveScore]);

    // Skills Intelligence Data
    const skillsIntelligence = useMemo(() => {
        if (analyticsData?.skills_intelligence && analyticsData.skills_intelligence.length > 0) {
            return analyticsData.skills_intelligence;
        }
        const skillCounts = {};
        filteredCandidates.forEach(c => {
            const list = Array.isArray(c.skills) ? c.skills : (c.analysis_data?.skills || []);
            list.forEach(s => {
                skillCounts[s] = (skillCounts[s] || 0) + 1;
            });
        });
        const total = filteredCandidates.length || 1;
        return Object.entries(skillCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([skill, count]) => ({
                skill,
                count,
                percentage: Math.round((count / total) * 100)
            }));
    }, [analyticsData, filteredCandidates]);

    // Pipeline Bottlenecks
    const bottlenecks = useMemo(() => {
        return analyticsData?.bottlenecks || [];
    }, [analyticsData]);

    // Candidates Requiring Attention
    const attentionCandidates = useMemo(() => {
        const items = analyticsData?.attention_items || analyticsData?.attention_required;
        if (items && items.length > 0) {
            return items.map(att => ({
                candidate_id: att.id || att.candidate_id,
                name: att.name,
                role: att.role,
                stage: att.stage,
                issue: att.issue
            }));
        }
        return filteredCandidates
            .filter(c => !c.score || c.score === 0 || c.status === 'Stalled')
            .slice(0, 5)
            .map(c => ({
                candidate_id: c.id,
                name: c.name || 'Anonymous',
                role: c.applied_role || c.role || 'Unspecified',
                stage: c.stage || 'Resume Screening',
                issue: !c.score ? 'Unscored Resume' : 'Awaiting Review'
            }));
    }, [analyticsData, filteredCandidates]);

    // Relative Time Helper for Activity Log
    const getRelativeTime = (timestamp) => {
        if (!timestamp) return 'Recent';
        try {
            const now = new Date();
            const past = new Date(timestamp);
            const diffMs = now - past;
            const diffSec = Math.floor(diffMs / 1000);
            if (diffSec < 60) return 'Just now';
            const diffMin = Math.floor(diffSec / 60);
            if (diffMin < 60) return `${diffMin} min ago`;
            const diffHr = Math.floor(diffMin / 60);
            if (diffHr < 24) return `${diffHr} hour${diffHr > 1 ? 's' : ''} ago`;
            const diffDay = Math.floor(diffHr / 24);
            if (diffDay === 1) return 'Yesterday';
            if (diffDay < 7) return `${diffDay} days ago`;
            return past.toLocaleDateString();
        } catch {
            return 'Recent';
        }
    };

    // Handle Stage Funnel Drilldown
    const handleFunnelStageClick = (stageName) => {
        setCandidateStageFilter(stageName);
        if (leaderboardRef.current) {
            leaderboardRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    };

    // Handle Recommendation Drilldown
    const handleRecClick = (recName) => {
        setCandidateRecFilter(recName);
        if (leaderboardRef.current) {
            leaderboardRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    };

    // Open Candidate Detail Drawer
    const handleViewCandidate = (candidate) => {
        setSelectedCandidate(candidate);
        setIsDrawerOpen(true);
    };

    // Rescreen unscored trigger
    const handleReScreenUnscored = async () => {
        const jd = prompt('Paste Job Description text to re-screen unscored candidates:');
        if (!jd || !jd.trim()) return;
        try {
            setReScreening(true);
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_URL}/api/resume/rescreen-unscored/`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ job_description: jd })
            });
            const data = await res.json();
            alert(`✅ ${data.message || 'Rescreening initiated successfully'}`);
            fetchAnalytics(false);
        } catch (err) {
            alert('Re-screening failed: ' + err.message);
        } finally {
            setReScreening(false);
        }
    };

    // EXPORT HANDLERS (Real Database Records)
    const handleExportPDF = () => {
        if (filteredCandidates.length === 0) {
            alert("No candidate data available to export.");
            return;
        }
        const doc = new jsPDF();
        
        // Brand Header
        doc.setFontSize(20);
        doc.setTextColor(93, 140, 44);
        doc.text("PrepWin - Pipeline & Talent Intelligence Report", 14, 20);
        
        doc.setFontSize(9);
        doc.setTextColor(100, 100, 100);
        doc.text(`Generated on: ${new Date().toLocaleString()} | Filter: ${selectedRoleFilter} | Date Range: ${selectedDateRange}`, 14, 26);
        
        // High Level Metrics Section
        doc.setFontSize(12);
        doc.setTextColor(50, 50, 50);
        doc.text("Executive Summary Metrics:", 14, 35);
        
        doc.setFontSize(10);
        doc.text(`- Total Applicants Evaluated: ${kpi.total_applicants}`, 16, 42);
        doc.text(`- Active Pipeline Candidates: ${kpi.active_pipeline}`, 16, 48);
        doc.text(`- Overall Placement/Hired Rate: ${kpi.placement_rate}%`, 16, 54);
        doc.text(`- Average Overall Talent Score: ${kpi.avg_talent_score}%`, 16, 60);
        doc.text(`- Pipeline Health Score: ${kpi.pipeline_health_score}% (${kpi.pipeline_health_status})`, 16, 66);

        // Funnel Table
        doc.setFontSize(12);
        doc.text("Recruitment Funnel Stage Distribution:", 14, 76);
        
        const funnelHeaders = [["Stage Name", "Candidates", "Conversion %"]];
        const funnelBody = funnelStages.map(item => [item.stage, item.count, `${item.conversion_pct}%`]);
        
        autoTable(doc, {
            startY: 80,
            head: funnelHeaders,
            body: funnelBody,
            theme: 'striped',
            headStyles: { fillColor: [93, 140, 44] },
            styles: { fontSize: 8, cellPadding: 2 }
        });
        
        // Recommendations Table
        const currentY = doc.lastAutoTable.finalY + 10;
        doc.text("AI Talent Recommendation Breakdown:", 14, currentY);
        
        const recHeaders = [["Recommendation Tier", "Count", "Percentage"]];
        const recBody = recommendationData.map(item => [item.name, item.value, `${item.percentage}%`]);
        
        autoTable(doc, {
            startY: currentY + 4,
            head: recHeaders,
            body: recBody,
            theme: 'striped',
            headStyles: { fillColor: [93, 140, 44] },
            styles: { fontSize: 8, cellPadding: 2 }
        });

        // Add page for details
        doc.addPage();
        doc.setFontSize(12);
        doc.text("Performance Insights by Job Role:", 14, 20);
        
        const roleHeaders = [["Job Role", "Candidates", "Avg Score", "Placement Rate"]];
        const roleBody = roleInsights.map(item => [item.role, item.candidate_count, `${item.avg_score}%`, `${item.placement_rate}%`]);
        
        autoTable(doc, {
            startY: 24,
            head: roleHeaders,
            body: roleBody,
            theme: 'striped',
            headStyles: { fillColor: [93, 140, 44] },
            styles: { fontSize: 8, cellPadding: 2 }
        });

        doc.save(`PrepWin_Analytics_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
        setShowExportDropdown(false);
    };

    const handleExportWord = () => {
        if (filteredCandidates.length === 0) {
            alert("No candidate data available to export.");
            return;
        }

        const funnelRows = funnelStages.map(item => `
            <tr>
                <td style="font-weight: bold;">${item.stage}</td>
                <td>${item.count}</td>
                <td>${item.conversion_pct}%</td>
            </tr>
        `).join('');

        const recRows = recommendationData.map(item => `
            <tr>
                <td style="font-weight: bold;">${item.name}</td>
                <td>${item.value}</td>
                <td>${item.percentage}%</td>
            </tr>
        `).join('');

        const roleRows = roleInsights.map(item => `
            <tr>
                <td style="font-weight: bold;">${item.role}</td>
                <td>${item.candidate_count}</td>
                <td>${item.avg_score}%</td>
                <td>${item.placement_rate}%</td>
            </tr>
        `).join('');

        const htmlContent = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
            <title>PrepWin Recruitment Intelligence Dossier</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; }
                h1 { color: #5d8c2c; font-size: 24px; border-bottom: 2px solid #5d8c2c; padding-bottom: 8px; }
                h2 { color: #333333; font-size: 18px; margin-top: 24px; }
                .meta { color: #666; font-size: 11px; margin-bottom: 24px; }
                .metric-box { border: 1px solid #ddd; background-color: #f9f9f9; padding: 12px; margin-bottom: 16px; font-weight: bold; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 20px; }
                th { background-color: #5d8c2c; color: white; padding: 10px; text-align: left; font-size: 12px; font-weight: bold; border: 1px solid #ddd; }
                td { padding: 8px 10px; font-size: 11px; border: 1px solid #ddd; }
                tr:nth-child(even) { background-color: #f9f9f9; }
            </style>
        </head>
        <body>
            <h1>PrepWin Recruitment Intelligence Dossier</h1>
            <div class="meta">
                Generated: ${new Date().toLocaleString()}<br/>
                Role Filter: ${selectedRoleFilter}<br/>
                Date Range: ${selectedDateRange}<br/>
            </div>
            
            <div class="metric-box">
                <p>Total Applicants Evaluated: ${kpi.total_applicants}</p>
                <p>Active Pipeline: ${kpi.active_pipeline}</p>
                <p>Placement Rate: ${kpi.placement_rate}%</p>
                <p>Average Talent Score: ${kpi.avg_talent_score}%</p>
                <p>Pipeline Health: ${kpi.pipeline_health_score}% (${kpi.pipeline_health_status})</p>
            </div>

            <h2>1. Recruitment Funnel Progression</h2>
            <table>
                <thead><tr><th>Stage Name</th><th>Candidates</th><th>Conversion %</th></tr></thead>
                <tbody>${funnelRows}</tbody>
            </table>

            <h2>2. AI Recommendation Quality Breakdown</h2>
            <table>
                <thead><tr><th>Tier</th><th>Count</th><th>Percentage</th></tr></thead>
                <tbody>${recRows}</tbody>
            </table>

            <h2>3. Performance Insights by Job Role</h2>
            <table>
                <thead><tr><th>Job Role</th><th>Candidates</th><th>Avg Score</th><th>Placement Rate</th></tr></thead>
                <tbody>${roleRows}</tbody>
            </table>
        </body>
        </html>
        `;

        const blob = new Blob(['\ufeff' + htmlContent], { type: 'application/msword' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `PrepWin_Analytics_Report_${new Date().toISOString().slice(0, 10)}.doc`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setShowExportDropdown(false);
    };

    const handleExportExcel = () => {
        if (filteredCandidates.length === 0) {
            alert("No candidate data available to export.");
            return;
        }

        const workbook = XLSX.utils.book_new();
        const reportData = [
            ["PrepWin - Recruitment Intelligence Report"],
            [`Generated on: ${new Date().toLocaleString()} | Filter: ${selectedRoleFilter} | Date Range: ${selectedDateRange}`],
            [],
            ["EXECUTIVE SUMMARY METRICS"],
            ["Metric Name", "Value"],
            ["Total Applicants", kpi.total_applicants],
            ["Active Pipeline", kpi.active_pipeline],
            ["Placement Rate (%)", kpi.placement_rate],
            ["Avg Talent Score (%)", kpi.avg_talent_score],
            ["Pipeline Health Score (%)", kpi.pipeline_health_score],
            ["Pipeline Health Status", kpi.pipeline_health_status],
            [],
            ["RECRUITMENT FUNNEL DISTRIBUTION"],
            ["Stage Name", "Candidate Count", "Conversion %"],
            ...funnelStages.map(item => [item.stage, item.count, `${item.conversion_pct}%`]),
            [],
            ["AI TALENT RECOMMENDATION BREAKDOWN"],
            ["Recommendation Tier", "Count", "Percentage"],
            ...recommendationData.map(item => [item.name, item.value, `${item.percentage}%`]),
            [],
            ["PERFORMANCE INSIGHTS BY JOB ROLE"],
            ["Job Role", "Candidates", "Avg Overall Score (%)", "Placement Rate (%)"],
            ...roleInsights.map(item => [item.role, item.candidate_count, item.avg_score, `${item.placement_rate}%`])
        ];

        const worksheet = XLSX.utils.aoa_to_sheet(reportData);
        worksheet['!cols'] = [{ wch: 40 }, { wch: 25 }, { wch: 25 }, { wch: 20 }];
        XLSX.utils.book_append_sheet(workbook, worksheet, "Analytics Report");
        XLSX.writeFile(workbook, `PrepWin_Analytics_Data_${new Date().toISOString().slice(0, 10)}.xlsx`);
        setShowExportDropdown(false);
    };

    // Health score styling
    const getHealthColor = (status) => {
        if (status === 'Healthy') return 'text-emerald-700 bg-emerald-50 border-emerald-200';
        if (status === 'Fair') return 'text-amber-700 bg-amber-50 border-amber-200';
        return 'text-rose-700 bg-rose-50 border-rose-200';
    };

    return (
        <div className="space-y-6 w-full max-w-full pb-16">
            
            {/* Top Header & Filter Controls Bar */}
            <div className="border-b border-gray-200 pb-5 space-y-4">
                {/* Title & Live Status on Top Full-Width Row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-3 flex-wrap">
                            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#5d8c2c] tracking-tight whitespace-normal sm:whitespace-nowrap">
                                Recruitment Intelligence Dashboard
                            </h1>
                            {liveMode && (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 animate-pulse whitespace-nowrap">
                                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                    Live Sync (30s)
                                </span>
                            )}
                        </div>
                        <p className="text-gray-500 text-sm mt-1.5 font-medium">
                            Real-time hiring intelligence — strictly calculated from real database records.
                            {lastUpdated && <span className="ml-2 text-xs text-gray-400 font-normal">Updated {timeAgo}</span>}
                        </p>
                    </div>
                </div>

                {/* Controls Row: Left Filters, Right Actions */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-1">
                    {/* Left: Live Toggle, Date Range, Role Filter */}
                    <div className="flex flex-wrap items-center gap-2.5">
                        {/* Live Data Switch */}
                        <button
                            onClick={() => setLiveMode(!liveMode)}
                            className={`h-10 inline-flex items-center gap-2 px-3.5 border rounded-xl shadow-xs text-sm font-semibold transition-all ${
                                liveMode 
                                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100' 
                                    : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                            }`}
                            title="Toggle 30-second live background polling"
                        >
                            <Zap size={16} className={liveMode ? 'text-emerald-600 fill-emerald-600' : 'text-gray-400'} />
                            <span>{liveMode ? 'Live Mode Active' : 'Live Mode'}</span>
                        </button>

                        {/* Date Range Selector */}
                        <div className="relative" ref={dateDropdownRef}>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowDateDropdown(!showDateDropdown);
                                    setShowRoleDropdown(false);
                                    setShowExportDropdown(false);
                                }}
                                className="h-10 inline-flex items-center gap-2 bg-white px-3.5 border border-gray-200 hover:border-gray-300 rounded-xl shadow-xs text-sm font-semibold text-slate-800 transition-all cursor-pointer"
                            >
                                <Calendar size={15} className="text-[#5d8c2c] shrink-0" />
                                <span>{DATE_RANGE_OPTIONS.find(o => o.value === selectedDateRange)?.label || 'All Time'}</span>
                                <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 ${showDateDropdown ? 'rotate-180 text-[#5d8c2c]' : ''}`} />
                            </button>
                            {showDateDropdown && (
                                <div className="absolute left-0 mt-2 w-44 bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                                    {DATE_RANGE_OPTIONS.map(opt => {
                                        const isSelected = selectedDateRange === opt.value;
                                        return (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => {
                                                    setSelectedDateRange(opt.value);
                                                    setShowDateDropdown(false);
                                                }}
                                                className={`w-full text-left px-3.5 py-2 text-sm transition-colors flex items-center justify-between ${
                                                    isSelected 
                                                        ? 'bg-emerald-50 text-[#5d8c2c] font-bold' 
                                                        : 'text-slate-700 hover:bg-gray-50 font-medium'
                                                }`}
                                            >
                                                <span>{opt.label}</span>
                                                {isSelected && <Check size={14} className="text-[#5d8c2c] shrink-0" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Role Filter Dropdown */}
                        <div className="relative" ref={roleDropdownRef}>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowRoleDropdown(!showRoleDropdown);
                                    setShowDateDropdown(false);
                                    setShowExportDropdown(false);
                                }}
                                className="h-10 inline-flex items-center gap-2 bg-white px-3.5 border border-gray-200 hover:border-gray-300 rounded-xl shadow-xs text-sm font-semibold text-slate-800 transition-all cursor-pointer"
                            >
                                <SlidersHorizontal size={15} className="text-[#5d8c2c] shrink-0" />
                                <span className="truncate max-w-[180px]">{selectedRoleFilter}</span>
                                <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 ${showRoleDropdown ? 'rotate-180 text-[#5d8c2c]' : ''}`} />
                            </button>
                            {showRoleDropdown && (
                                <div className="absolute left-0 mt-2 min-w-[210px] w-max max-w-xs bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                                    {availableRoles.map(role => {
                                        const isSelected = selectedRoleFilter === role;
                                        return (
                                            <button
                                                key={role}
                                                type="button"
                                                onClick={() => {
                                                    setSelectedRoleFilter(role);
                                                    setShowRoleDropdown(false);
                                                }}
                                                className={`w-full text-left px-3.5 py-2 text-sm transition-colors flex items-center justify-between gap-3 ${
                                                    isSelected 
                                                        ? 'bg-emerald-50 text-[#5d8c2c] font-bold' 
                                                        : 'text-slate-700 hover:bg-gray-50 font-medium'
                                                }`}
                                            >
                                                <span className="truncate">{role}</span>
                                                {isSelected && <Check size={14} className="text-[#5d8c2c] shrink-0" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right: Refresh & Export */}
                    <div className="flex items-center gap-2.5 shrink-0">
                        {/* Refresh Button */}
                        <button 
                            onClick={() => fetchAnalytics(false)}
                            disabled={loading}
                            className={`h-10 px-4 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold rounded-xl text-sm transition-all shadow-xs inline-flex items-center gap-2 ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
                        >
                            <RefreshCw size={15} className={`text-[#5d8c2c] ${loading ? 'animate-spin' : ''}`} />
                            <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
                        </button>

                        {/* Export Dropdown */}
                        <div className="relative" ref={exportDropdownRef}>
                            <button
                                onClick={() => {
                                    setShowExportDropdown(!showExportDropdown);
                                    setShowRoleDropdown(false);
                                    setShowDateDropdown(false);
                                }}
                                className="h-10 inline-flex items-center gap-2 px-4 bg-[#5d8c2c] hover:bg-[#4d7424] text-white font-semibold rounded-xl text-sm transition-all shadow-xs"
                            >
                                <Download size={16} />
                                <span>Export Report</span>
                            </button>
                            {showExportDropdown && (
                                <div className="absolute right-0 mt-2 w-52 bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                                    <button
                                        onClick={handleExportPDF}
                                        className="w-full text-left px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
                                    >
                                        <FileDown size={16} className="text-red-500" />
                                        <span>Download PDF</span>
                                    </button>
                                    <button
                                        onClick={handleExportWord}
                                        className="w-full text-left px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
                                    >
                                        <FileText size={16} className="text-blue-500" />
                                        <span>Download DOCS (Word)</span>
                                    </button>
                                    <button
                                        onClick={handleExportExcel}
                                        className="w-full text-left px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
                                    >
                                        <FileSpreadsheet size={16} className="text-green-600" />
                                        <span>Download Excel</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Error Banner if any */}
            {error && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-3 text-rose-700 text-sm">
                    <AlertTriangle className="w-5 h-5 flex-shrink-0 text-rose-500" />
                    <span>{error}</span>
                </div>
            )}

            {/* Pipeline Bottleneck Detection Alert Box */}
            {bottlenecks.length > 0 && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                        <div>
                            <h4 className="text-sm font-bold text-amber-900">
                                Pipeline Bottleneck Detected: {bottlenecks[0].stage} ({bottlenecks[0].affected_count ?? bottlenecks[0].candidate_count ?? 0} candidates)
                            </h4>
                            <p className="text-xs text-amber-800 mt-0.5">
                                {bottlenecks[0].message || bottlenecks[0].recommendation}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => handleFunnelStageClick(bottlenecks[0].stage)}
                        className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 self-start md:self-center shrink-0 shadow-xs"
                    >
                        <span>View Candidates</span>
                        <ChevronRight size={14} />
                    </button>
                </div>
            )}

            {/* Executive Metric Cards Grid + Pipeline Health */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                
                {/* 1. Total Applicants */}
                <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex flex-col justify-between h-full hover:shadow-sm transition-shadow">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">TOTAL APPLICANTS</span>
                        <div className="p-2 rounded-xl bg-green-50 text-[#5d8c2c] border border-green-100">
                            <Users size={18} />
                        </div>
                    </div>
                    <div className="my-2">
                        <h3 className="text-3xl font-extrabold text-[#5d8c2c] tracking-tight">{kpi.total_applicants}</h3>
                    </div>
                    <p className="text-xs text-gray-500 font-medium">All active records</p>
                </div>

                {/* 2. Active Pipeline */}
                <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex flex-col justify-between h-full hover:shadow-sm transition-shadow">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">ACTIVE PIPELINE</span>
                        <div className="p-2 rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
                            <BrainCircuit size={18} />
                        </div>
                    </div>
                    <div className="my-2">
                        <h3 className="text-3xl font-extrabold text-blue-600 tracking-tight">{kpi.active_pipeline}</h3>
                    </div>
                    <p className="text-xs text-gray-500 font-medium">In screening, tests, or interview</p>
                </div>

                {/* 3. Placement Rate */}
                <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex flex-col justify-between h-full hover:shadow-sm transition-shadow">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">PLACEMENT RATE</span>
                        <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100">
                            <CheckCircle size={18} />
                        </div>
                    </div>
                    <div className="my-2">
                        <h3 className="text-3xl font-extrabold text-emerald-600 tracking-tight">{kpi.placement_rate}%</h3>
                    </div>
                    <p className="text-xs text-gray-500 font-medium">Hired candidates / Total</p>
                </div>

                {/* 4. Average Talent Score */}
                <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex flex-col justify-between h-full hover:shadow-sm transition-shadow">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">AVG TALENT SCORE</span>
                        <div className="p-2 rounded-xl bg-purple-50 text-purple-600 border border-purple-100">
                            <Award size={18} />
                        </div>
                    </div>
                    <div className="my-2">
                        <h3 className="text-3xl font-extrabold text-purple-600 tracking-tight">
                            {kpi.avg_talent_score > 0 ? `${kpi.avg_talent_score}%` : '—'}
                        </h3>
                    </div>
                    <p className="text-xs text-gray-500 font-medium">Across evaluated candidates</p>
                </div>

                {/* 5. Pipeline Health Score Card */}
                <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex flex-col justify-between h-full hover:shadow-sm transition-shadow">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">PIPELINE HEALTH</span>
                        <span className={`px-2.5 py-0.5 text-xs font-bold rounded-full border ${getHealthColor(kpi.pipeline_health_status)}`}>
                            {kpi.pipeline_health_status}
                        </span>
                    </div>
                    <div className="my-2 flex items-baseline gap-2">
                        <h3 className="text-3xl font-extrabold text-slate-900 tracking-tight">{kpi.pipeline_health_score}%</h3>
                    </div>
                    <div>
                        <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                            <div 
                                className={`h-full rounded-full transition-all duration-700 ${
                                    kpi.pipeline_health_status === 'Healthy' ? 'bg-emerald-500' :
                                    kpi.pipeline_health_status === 'Fair' ? 'bg-amber-500' : 'bg-rose-500'
                                }`}
                                style={{ width: `${Math.min(kpi.pipeline_health_score, 100)}%` }}
                            />
                        </div>
                        <p className="text-xs text-gray-500 font-medium mt-1.5">Throughput stability</p>
                    </div>
                </div>
            </div>

            {/* ✦ AI Recruitment Insights (Light Enterprise Card Style) */}
            <div className="bg-emerald-50/50 border border-emerald-100 rounded-2xl p-5 shadow-xs">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-emerald-800 tracking-wide flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-[#5d8c2c]" />
                        ✦ AI Recruitment Insights
                    </h3>
                    <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-100/70 px-2.5 py-0.5 rounded-full">
                        Auto-synthesized
                    </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Card 1: Pipeline Throughput */}
                    <div className="bg-white p-4 rounded-xl border border-emerald-100/80 shadow-xs flex flex-col justify-between hover:border-emerald-300 transition-colors">
                        <div>
                            <div className="flex items-center gap-2 text-emerald-700 mb-1.5">
                                <Users className="w-4 h-4" />
                                <span className="text-xs font-bold uppercase tracking-wider">Pipeline Throughput</span>
                            </div>
                            <h4 className="text-base font-bold text-gray-900 mt-1">
                                {kpi.total_applicants > 0 ? `${kpi.active_pipeline} active in pipeline` : 'No active candidates'}
                            </h4>
                            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                                {kpi.total_applicants > 0 
                                    ? `${Math.round((kpi.active_pipeline / kpi.total_applicants) * 100)}% pipeline retention. Overall placement rate is currently ${kpi.placement_rate}%.`
                                    : 'Candidates will appear here once applications are received.'}
                            </p>
                        </div>
                        <button
                            onClick={() => leaderboardRef.current?.scrollIntoView({ behavior: 'smooth' })}
                            className="text-xs font-bold text-[#5d8c2c] hover:text-[#4d7424] inline-flex items-center gap-1 mt-3 self-start transition-colors"
                        >
                            <span>View pipeline</span>
                            <ChevronRight size={13} />
                        </button>
                    </div>

                    {/* Card 2: Talent Score */}
                    <div className="bg-white p-4 rounded-xl border border-emerald-100/80 shadow-xs flex flex-col justify-between hover:border-emerald-300 transition-colors">
                        <div>
                            <div className="flex items-center gap-2 text-blue-700 mb-1.5">
                                <Award className="w-4 h-4" />
                                <span className="text-xs font-bold uppercase tracking-wider">Talent Score</span>
                            </div>
                            <h4 className="text-base font-bold text-gray-900 mt-1">
                                {kpi.avg_talent_score > 0 ? `Average score is ${kpi.avg_talent_score}%` : 'Awaiting evaluations'}
                            </h4>
                            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                                {kpi.avg_talent_score > 0
                                    ? 'Candidates scoring ≥ 75% are prioritized for technical interview rounds.'
                                    : 'Scores compute automatically as candidates complete screening tests.'}
                            </p>
                        </div>
                        <div className="mt-3 text-[11px] font-semibold text-gray-400">
                            Benchmark: 70%+ recommended
                        </div>
                    </div>

                    {/* Card 3: Action Required */}
                    <div className="bg-white p-4 rounded-xl border border-emerald-100/80 shadow-xs flex flex-col justify-between hover:border-emerald-300 transition-colors">
                        <div>
                            <div className="flex items-center gap-2 text-amber-700 mb-1.5">
                                <AlertTriangle className="w-4 h-4" />
                                <span className="text-xs font-bold uppercase tracking-wider">Action Required</span>
                            </div>
                            <h4 className="text-base font-bold text-gray-900 mt-1">
                                {bottlenecks.length > 0 
                                    ? `${bottlenecks[0].stage} has the largest bottleneck`
                                    : attentionCandidates.length > 0 
                                        ? `${attentionCandidates.length} candidate(s) need review`
                                        : 'Pipeline is flowing healthily'}
                            </h4>
                            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                                {bottlenecks.length > 0
                                    ? (bottlenecks[0].message || 'Review stalled candidates to accelerate time-to-hire.')
                                    : attentionCandidates.length > 0
                                        ? 'Candidate resumes awaiting scoring or assessment progress.'
                                        : 'No immediate bottlenecks or stalled candidates identified.'}
                            </p>
                        </div>
                        <button
                            onClick={() => {
                                if (bottlenecks.length > 0) handleFunnelStageClick(bottlenecks[0].stage);
                                else leaderboardRef.current?.scrollIntoView({ behavior: 'smooth' });
                            }}
                            className="text-xs font-bold text-amber-700 hover:text-amber-800 inline-flex items-center gap-1 mt-3 self-start transition-colors"
                        >
                            <span>View candidates</span>
                            <ChevronRight size={13} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Funnel Pipeline & AI Recommendation Donuts */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* 1. Candidate Funnel with Conversion & Drop-off */}
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs lg:col-span-8 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                                <BarChart3 size={18} className="text-[#5d8c2c]" />
                                Candidate Funnel — Stage Progression
                            </h3>
                            <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
                                Click stage to filter
                            </span>
                        </div>
                        <p className="text-xs text-gray-500 mb-4 font-medium">
                            Candidates active in each hiring milestone. Conversion % reflects progression from prior stage.
                        </p>
                    </div>

                    <div className="h-[260px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart 
                                data={funnelStages} 
                                margin={{ top: 10, right: 10, left: -20, bottom: 20 }}
                                onClick={(e) => {
                                    if (e && e.activePayload && e.activePayload[0]) {
                                        handleFunnelStageClick(e.activePayload[0].payload.stage);
                                    }
                                }}
                            >
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis 
                                    dataKey="stage" 
                                    tick={{ fontSize: 11, fill: '#475569', fontWeight: 600 }} 
                                    axisLine={false} 
                                    tickLine={false} 
                                    interval={0}
                                    angle={-10}
                                    textAnchor="end"
                                />
                                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                <Tooltip 
                                    cursor={{ fill: 'rgba(93, 140, 44, 0.05)' }}
                                    content={({ active, payload }) => {
                                        if (!active || !payload || !payload.length) return null;
                                        const d = payload[0].payload;
                                        return (
                                            <div className="bg-slate-900 text-white text-xs px-3 py-2 rounded-lg shadow-lg border border-slate-700 pointer-events-none">
                                                <p className="font-bold text-slate-100">{d.stage}</p>
                                                <p className="text-emerald-400 mt-0.5">{d.count} candidates &bull; {d.conversion_pct}% pass</p>
                                            </div>
                                        );
                                    }}
                                />
                                <Bar dataKey="count" radius={[6, 6, 0, 0]} className="cursor-pointer">
                                    {funnelStages.map((entry, index) => (
                                        <Cell 
                                            key={`cell-${index}`} 
                                            fill={FUNNEL_COLORS[index % FUNNEL_COLORS.length]}
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    {/* Funnel Stage Summary Cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-4 border-t border-gray-100">
                        {funnelStages.map((st, i) => (
                            <button
                                key={i}
                                onClick={() => handleFunnelStageClick(st.stage)}
                                className={`p-2.5 rounded-xl text-left border transition-all ${
                                    candidateStageFilter === st.stage
                                        ? 'bg-emerald-50 border-[#5d8c2c] text-[#5d8c2c] ring-1 ring-[#5d8c2c]'
                                        : 'bg-gray-50/70 border-gray-200/70 text-slate-700 hover:bg-gray-100/80 hover:border-gray-300'
                                }`}
                            >
                                <p className="text-xs font-semibold truncate text-gray-600">{st.stage}</p>
                                <p className="text-base font-extrabold text-gray-900 mt-0.5">{st.count} <span className="text-xs font-normal text-gray-500">candidates</span></p>
                                <p className="text-xs font-semibold text-emerald-600 mt-0.5">{st.conversion_pct}% pass</p>
                            </button>
                        ))}
                    </div>
                </div>

                {/* 2. AI Recommendation Breakdown Donut */}
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs lg:col-span-4 flex flex-col justify-between">
                    <div>
                        <h3 className="text-base font-bold text-gray-900 flex items-center gap-2 mb-1">
                            <PieIcon size={18} className="text-[#5d8c2c]" />
                            AI Recommendation Quality
                        </h3>
                        <p className="text-xs text-gray-500 mb-4 font-medium">
                            Synthesized recommendation tiers across evaluated applicant profiles.
                        </p>
                    </div>
                    
                    {recommendationData.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 py-10 border border-dashed border-gray-200 rounded-xl bg-gray-50/50">
                            <ShieldAlert size={36} className="mb-2 text-gray-300" />
                            <span className="text-xs font-semibold">No recommendation data available</span>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center">
                            <div className="h-[200px] w-full relative">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={recommendationData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={80}
                                            paddingAngle={4}
                                            dataKey="value"
                                            className="cursor-pointer"
                                            onClick={(entry) => handleRecClick(entry.name)}
                                        >
                                            {recommendationData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.color} />
                                            ))}
                                        </Pie>
                                        <Tooltip 
                                            content={({ active, payload }) => {
                                                if (!active || !payload || !payload.length) return null;
                                                const d = payload[0].payload;
                                                return (
                                                    <div className="bg-slate-900 text-white text-xs px-2.5 py-1.5 rounded-lg shadow-lg border border-slate-700 pointer-events-none">
                                                        <p className="font-bold text-slate-100">{d.name}</p>
                                                        <p className="text-emerald-400">{d.value} candidates ({d.percentage}%)</p>
                                                    </div>
                                                );
                                            }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                    <span className="text-2xl font-extrabold text-gray-900">
                                        {filteredCandidates.length}
                                    </span>
                                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                        Candidates
                                    </span>
                                </div>
                            </div>
                            
                            {/* Interactive Legend Chips */}
                            <div className="w-full grid grid-cols-2 gap-2 mt-4">
                                {recommendationData.map((d, i) => (
                                    <button
                                        key={i}
                                        onClick={() => handleRecClick(d.name)}
                                        className={`flex items-center justify-between p-2 rounded-lg border text-xs font-medium transition ${
                                            candidateRecFilter === d.name
                                                ? 'bg-gray-100 border-gray-400 text-gray-900 font-bold'
                                                : 'border-transparent text-gray-700 hover:bg-gray-50'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2 truncate">
                                            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                                            <span className="truncate">{d.name}</span>
                                        </div>
                                        <span className="text-xs font-bold text-gray-600 ml-1">{d.value}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Round-wise Performance & Score Distribution Histogram */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* 1. Round-wise Performance (Clean Horizontal Bars with No Data Support) */}
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs lg:col-span-6 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                                <Target size={18} className="text-[#5d8c2c]" />
                                Round-wise Assessment Performance
                            </h3>
                            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl text-xs font-semibold">
                                <button
                                    onClick={() => setRoundMetricType('average')}
                                    className={`px-2.5 py-1 rounded-lg transition ${
                                        roundMetricType === 'average'
                                            ? 'bg-white text-[#5d8c2c] shadow-xs font-bold'
                                            : 'text-gray-500 hover:text-gray-900'
                                    }`}
                                >
                                    Average Score
                                </button>
                                <button
                                    onClick={() => setRoundMetricType('pass_rate')}
                                    className={`px-2.5 py-1 rounded-lg transition ${
                                        roundMetricType === 'pass_rate'
                                            ? 'bg-white text-[#5d8c2c] shadow-xs font-bold'
                                            : 'text-gray-500 hover:text-gray-900'
                                    }`}
                                >
                                    Pass Rate %
                                </button>
                            </div>
                        </div>
                        <p className="text-xs text-gray-500 mb-5 font-medium">
                            Candidate achievement levels across Resume Screening, Aptitude, Coding & Interview.
                        </p>
                    </div>

                    <div className="space-y-4 my-auto py-2">
                        {roundPerformanceData.map((round, idx) => {
                            const val = roundMetricType === 'average' ? round.avg_score : round.pass_rate;
                            const hasData = val > 0 || (round.total_evaluated && round.total_evaluated > 0);
                            return (
                                <div key={idx} className="space-y-1.5">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="font-bold text-gray-800">{round.round_name}</span>
                                        {hasData ? (
                                            <span className="font-extrabold text-[#5d8c2c]">{Math.round(val)}%</span>
                                        ) : (
                                            <span className="text-gray-400 font-medium">No data</span>
                                        )}
                                    </div>
                                    <div className="w-full bg-gray-100 h-2.5 rounded-full overflow-hidden">
                                        {hasData ? (
                                            <div 
                                                className="h-full rounded-full bg-[#5d8c2c] transition-all duration-500"
                                                style={{ width: `${Math.min(val, 100)}%` }}
                                            />
                                        ) : (
                                            <div className="h-full bg-transparent" />
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="pt-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400 font-medium">
                        <span>Baseline passing threshold: 60%</span>
                        <span>Evaluation metric: {roundMetricType === 'average' ? 'Average Score' : 'Pass Rate'}</span>
                    </div>
                </div>

                {/* 2. Score Distribution Histogram with Empty State Support */}
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs lg:col-span-6 flex flex-col justify-between">
                    <div>
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1.5">
                            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                                <Award size={18} className="text-[#5d8c2c]" />
                                Applicant Score Distribution
                            </h3>
                            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl text-xs font-semibold overflow-x-auto">
                                {[
                                    { id: 'overall', label: 'Overall' },
                                    { id: 'resume', label: 'Resume' },
                                    { id: 'aptitude', label: 'Aptitude' },
                                    { id: 'coding', label: 'Coding' },
                                    { id: 'interview', label: 'Interview' }
                                ].map(m => (
                                    <button
                                        key={m.id}
                                        onClick={() => {
                                            setDistributionMetric(m.id);
                                            setSelectedScoreBucket(null);
                                        }}
                                        className={`px-2 py-0.5 rounded-lg whitespace-nowrap transition ${
                                            distributionMetric === m.id
                                                ? 'bg-white text-[#5d8c2c] shadow-xs font-bold'
                                                : 'text-gray-500 hover:text-gray-900'
                                        }`}
                                    >
                                        {m.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <p className="text-xs text-gray-500 mb-4 font-medium">
                            Candidate volume across 10-point score bands. Click any bucket to filter candidates.
                        </p>
                    </div>

                    {/* Check if any scores exist */}
                    {!scoreDistributionData.some(d => d.Candidates > 0) ? (
                        <div className="h-[220px] flex flex-col items-center justify-center text-center p-6 border border-dashed border-gray-200 rounded-xl bg-gray-50/50 my-auto">
                            <Award size={36} className="text-gray-300 mb-2" />
                            <h4 className="text-sm font-bold text-gray-700">No score distribution available yet</h4>
                            <p className="text-xs text-gray-500 max-w-sm mt-1">
                                Complete candidate assessments to see score distribution across the pipeline.
                            </p>
                        </div>
                    ) : (
                        <div className="h-[220px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart 
                                    data={scoreDistributionData} 
                                    margin={{ top: 10, right: 10, left: -20, bottom: 5 }}
                                    onClick={(e) => {
                                        if (e && e.activePayload && e.activePayload[0]) {
                                            const bIdx = e.activePayload[0].payload.bucketIndex;
                                            setSelectedScoreBucket(selectedScoreBucket === bIdx ? null : bIdx);
                                            if (leaderboardRef.current) {
                                                leaderboardRef.current.scrollIntoView({ behavior: 'smooth' });
                                            }
                                        }
                                    }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                    <XAxis 
                                        dataKey="range" 
                                        tick={{ fontSize: 9, fill: '#64748b', fontWeight: 600 }} 
                                        axisLine={false} 
                                        tickLine={false} 
                                    />
                                    <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                    <Tooltip 
                                        cursor={{ fill: 'rgba(93, 140, 44, 0.05)' }}
                                        content={({ active, payload }) => {
                                            if (!active || !payload || !payload.length) return null;
                                            const d = payload[0].payload;
                                            return (
                                                <div className="bg-slate-900 text-white text-xs px-2.5 py-1.5 rounded-lg shadow-lg border border-slate-700 pointer-events-none">
                                                    <p className="font-bold text-slate-100">{d.range}</p>
                                                    <p className="text-emerald-400">{d.Candidates} Candidates</p>
                                                </div>
                                            );
                                        }}
                                    />
                                    <Bar dataKey="Candidates" radius={[4, 4, 0, 0]} className="cursor-pointer">
                                        {scoreDistributionData.map((entry, index) => (
                                            <Cell 
                                                key={`cell-${index}`} 
                                                fill={selectedScoreBucket === index ? '#10b981' : '#5d8c2c'}
                                                opacity={selectedScoreBucket !== null && selectedScoreBucket !== index ? 0.35 : 1}
                                            />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    )}

                    <div className="pt-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400 font-medium">
                        <span>Distribution scope: {distributionMetric.toUpperCase()}</span>
                        {selectedScoreBucket !== null && (
                            <button onClick={() => setSelectedScoreBucket(null)} className="text-[#5d8c2c] font-bold hover:underline">
                                Reset Bucket Filter
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Job Role Analytics Comparison Table */}
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                            <FileText size={18} className="text-[#5d8c2c]" />
                            Performance Insights by Job Role
                        </h3>
                        <p className="text-xs text-gray-500 mt-0.5 font-medium">
                            Aggregated applicant volume, mean score, and placement rate by position. Click a role to isolate its data.
                        </p>
                    </div>
                    {selectedRoleFilter !== 'All Roles' && (
                        <button
                            onClick={() => setSelectedRoleFilter('All Roles')}
                            className="text-xs font-bold text-[#5d8c2c] hover:underline"
                        >
                            Reset Role Filter
                        </button>
                    )}
                </div>

                {roleInsights.length === 0 ? (
                    <div className="text-center py-10 text-gray-400 text-sm font-semibold">No job roles found.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-gray-200 text-xs font-bold text-gray-400 uppercase tracking-wider bg-gray-50/70">
                                    <th className="py-3 px-4 rounded-l-lg">Job Role</th>
                                    <th className="py-3 px-4 text-center">Candidates</th>
                                    <th className="py-3 px-4 text-center">Avg Overall Score</th>
                                    <th className="py-3 px-4 text-center">Placement Rate</th>
                                    <th className="py-3 px-4 rounded-r-lg">Performance Index</th>
                                </tr>
                            </thead>
                            <tbody>
                                {roleInsights.map((item, idx) => (
                                    <tr 
                                        key={idx} 
                                        onClick={() => setSelectedRoleFilter(item.role)}
                                        className={`border-b border-gray-100 hover:bg-gray-50/80 transition-colors cursor-pointer ${
                                            selectedRoleFilter === item.role ? 'bg-emerald-50/60' : ''
                                        }`}
                                    >
                                        <td className="py-3.5 px-4 font-bold text-gray-900 text-sm flex items-center gap-2">
                                            <span>{item.role}</span>
                                            {selectedRoleFilter === item.role && (
                                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#5d8c2c] text-white">Active</span>
                                            )}
                                        </td>
                                        <td className="py-3.5 px-4 text-center text-gray-600 font-semibold text-sm">
                                            {item.candidate_count}
                                        </td>
                                        <td className="py-3.5 px-4 text-center text-sm font-extrabold text-[#5d8c2c]">
                                            {item.avg_score > 0 ? `${item.avg_score}%` : '—'}
                                        </td>
                                        <td className="py-3.5 px-4 text-center text-sm font-semibold text-slate-700">
                                            {item.placement_rate}%
                                        </td>
                                        <td className="py-3.5 px-4">
                                            <div className="flex items-center justify-center gap-2">
                                                <div className="w-24 bg-gray-100 h-2 rounded-full overflow-hidden">
                                                    <div 
                                                        className="bg-[#5d8c2c] h-full rounded-full transition-all duration-500" 
                                                        style={{ width: `${item.avg_score}%` }}
                                                    />
                                                </div>
                                                <span className="text-xs text-gray-600 font-bold">
                                                    {item.avg_score >= 80 ? 'Exceptional' : item.avg_score >= 65 ? 'Competitive' : item.avg_score > 0 ? 'Satisfactory' : 'Pending'}
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Skills Intelligence & Attention Required Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* 1. Skills Intelligence */}
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs lg:col-span-6 flex flex-col justify-between">
                    <div>
                        <h3 className="text-base font-bold text-gray-900 flex items-center gap-2 mb-1">
                            <Cpu size={18} className="text-[#5d8c2c]" />
                            Skills Intelligence & Talent Density
                        </h3>
                        <p className="text-xs text-gray-500 mb-4 font-medium">
                            Most prevalent verified skills extracted across current applicant profiles.
                        </p>
                    </div>

                    {skillsIntelligence.length === 0 ? (
                        <div className="h-44 flex flex-col items-center justify-center text-center p-4 border border-dashed border-gray-200 rounded-xl bg-gray-50/50 my-auto">
                            <Cpu size={32} className="text-gray-300 mb-2" />
                            <h4 className="text-xs font-bold text-gray-700">No extracted skills available</h4>
                            <p className="text-xs text-gray-400 mt-1 max-w-xs">
                                Skills will appear here once candidate profiles contain extractable skill data.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3 my-auto">
                            {skillsIntelligence.map((sk, idx) => (
                                <div key={idx} className="space-y-1">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="font-semibold text-slate-800">{sk.skill}</span>
                                        <span className="text-slate-500 font-medium">{sk.count} candidates ({sk.percentage}%)</span>
                                    </div>
                                    <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                                        <div 
                                            className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                                            style={{ width: `${Math.min(sk.percentage, 100)}%` }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="pt-4 border-t border-gray-100 text-xs text-gray-400 font-medium">
                        Extracted from verified resume parsing
                    </div>
                </div>

                {/* 2. Candidates Requiring Attention */}
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs lg:col-span-6 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                                <ShieldAlert size={18} className="text-amber-500" />
                                Requires Recruiter Attention
                            </h3>
                            {filteredCandidates.some(c => !c.score || c.score === 0) && (
                                <button
                                    onClick={handleReScreenUnscored}
                                    disabled={reScreening}
                                    className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-lg text-xs font-bold transition flex items-center gap-1"
                                >
                                    <RefreshCw size={12} className={reScreening ? 'animate-spin' : ''} />
                                    <span>Re-Screen</span>
                                </button>
                            )}
                        </div>
                        <p className="text-xs text-gray-500 mb-4 font-medium">
                            Candidates awaiting initial resume scoring or stalled in an assessment round.
                        </p>
                    </div>

                    {attentionCandidates.length === 0 ? (
                        <div className="h-44 flex flex-col items-center justify-center text-center p-4 border border-dashed border-gray-200 rounded-xl bg-gray-50/50 my-auto">
                            <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-1 opacity-80" />
                            <h4 className="text-xs font-bold text-gray-700">No candidates stalled</h4>
                            <p className="text-xs text-gray-400 mt-1">All applicant records are properly progressing.</p>
                        </div>
                    ) : (
                        <div className="space-y-2.5 my-auto">
                            {attentionCandidates.map((att, idx) => {
                                const matchingCandidate = candidates.find(c => c.id === att.candidate_id);
                                return (
                                    <div 
                                        key={idx}
                                        className="p-3 rounded-xl bg-gray-50 border border-gray-200/80 flex items-center justify-between text-xs hover:border-gray-300 transition-colors"
                                    >
                                        <div>
                                            <p className="font-bold text-gray-900 text-sm">{att.name}</p>
                                            <p className="text-gray-500 text-xs mt-0.5">{att.role} &bull; {att.stage}</p>
                                        </div>
                                        <div className="flex items-center gap-2.5">
                                            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                                {att.issue}
                                            </span>
                                            {matchingCandidate && (
                                                <button
                                                    onClick={() => handleViewCandidate(matchingCandidate)}
                                                    className="px-2.5 py-1 text-xs font-bold text-[#5d8c2c] hover:bg-green-50 rounded-lg transition-colors flex items-center gap-1"
                                                    title="View Profile"
                                                >
                                                    <span>View</span>
                                                    <ChevronRight size={13} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <div className="pt-4 border-t border-gray-100 text-xs text-gray-400 font-medium">
                        Recruiter action recommended to maintain pipeline throughput
                    </div>
                </div>
            </div>

            {/* Recent Recruitment Activity Log */}
            {activityLogs.length > 0 && (
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs">
                    <h3 className="text-base font-bold text-gray-900 flex items-center gap-2 mb-1">
                        <Activity size={18} className="text-[#5d8c2c]" />
                        Recent Recruitment Activity
                    </h3>
                    <p className="text-xs text-gray-500 mb-4 font-medium">
                        Real audit history of candidate invitations, completions, and evaluations.
                    </p>
                    <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                        {activityLogs.slice(0, 8).map((log, i) => (
                            <div key={i} className="flex items-start gap-3 text-xs">
                                <span className="w-2 h-2 rounded-full bg-[#5d8c2c] mt-1.5 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="font-semibold text-gray-800 truncate">{log.action || log.event || 'System Action'}</p>
                                    <p className="text-gray-500 text-xs truncate">{log.details || log.description || ''}</p>
                                </div>
                                <span className="text-gray-400 font-medium whitespace-nowrap text-[11px]">
                                    {getRelativeTime(log.timestamp)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Candidate Leaderboard Section */}
            <div ref={leaderboardRef} className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
                <div className="p-6 border-b border-gray-100">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                                    <Users size={18} className="text-[#5d8c2c]" />
                                    Candidate Leaderboard
                                </h3>
                                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">
                                    {filteredCandidates.length} Active Records
                                </span>
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5 font-medium">
                                Real database applicant profiles with stage progression, scores, and evaluation briefs.
                            </p>
                        </div>
                        
                        {/* Consistent-Height Control Bar */}
                        <div className="flex flex-wrap items-center gap-2">
                            {/* Search */}
                            <div className="h-10 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 shadow-2xs">
                                <Search size={14} className="text-gray-400 shrink-0" />
                                <input
                                    type="text"
                                    placeholder="Search candidate or skill..."
                                    value={candidateSearch}
                                    onChange={e => setCandidateSearch(e.target.value)}
                                    className="bg-transparent text-sm font-medium text-gray-700 focus:outline-none w-44"
                                />
                            </div>

                            {/* Stage Filter */}
                            <div className="h-10 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 shadow-2xs">
                                <Target size={14} className="text-[#5d8c2c] shrink-0" />
                                <select
                                    value={candidateStageFilter}
                                    onChange={e => setCandidateStageFilter(e.target.value)}
                                    className="bg-transparent text-sm font-semibold text-slate-800 focus:outline-none cursor-pointer pr-1"
                                >
                                    {[
                                        'All Stages',
                                        'Resume Screening',
                                        'Screened Candidates',
                                        'Aptitude Round',
                                        'Coding Round',
                                        'Technical Interview',
                                        'Offer Sent',
                                        'Hired'
                                    ].map(s => (
                                        <option key={s} value={s}>{s}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Recommendation Filter */}
                            <div className="h-10 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 shadow-2xs">
                                <Filter size={14} className="text-[#5d8c2c] shrink-0" />
                                <select
                                    value={candidateRecFilter}
                                    onChange={e => setCandidateRecFilter(e.target.value)}
                                    className="bg-transparent text-sm font-semibold text-slate-800 focus:outline-none cursor-pointer pr-1"
                                >
                                    <option value="All">All Recs</option>
                                    <option value="Strong Hire">Strong Hire</option>
                                    <option value="Consider">Consider</option>
                                    <option value="Review">Review</option>
                                </select>
                            </div>

                            {/* Sort */}
                            <div className="h-10 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 shadow-2xs">
                                <ArrowUpDown size={14} className="text-[#5d8c2c] shrink-0" />
                                <select
                                    value={`${candidateSort.field}-${candidateSort.dir}`}
                                    onChange={e => {
                                        const [field, dir] = e.target.value.split('-');
                                        setCandidateSort({ field, dir });
                                    }}
                                    className="bg-transparent text-sm font-semibold text-slate-800 focus:outline-none cursor-pointer pr-1"
                                >
                                    <option value="score-desc">Score: High → Low</option>
                                    <option value="score-asc">Score: Low → High</option>
                                    <option value="name-asc">Name: A → Z</option>
                                    <option value="name-desc">Name: Z → A</option>
                                    <option value="created_at-desc">Newest First</option>
                                </select>
                            </div>

                            {/* Clear Active Filters */}
                            {(candidateSearch || candidateStageFilter !== 'All Stages' || candidateRecFilter !== 'All' || selectedScoreBucket !== null) && (
                                <button
                                    onClick={() => {
                                        setCandidateSearch('');
                                        setCandidateStageFilter('All Stages');
                                        setCandidateRecFilter('All');
                                        setSelectedScoreBucket(null);
                                    }}
                                    className="h-10 px-3 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-xl border border-rose-200 transition"
                                >
                                    Reset Filters
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Table Content */}
                {filteredCandidates.length === 0 ? (
                    <div className="text-center py-16 text-gray-400">
                        <Users size={36} className="mx-auto mb-2 opacity-30" />
                        <p className="font-semibold text-sm">No candidate records match your current filter parameters.</p>
                        <p className="text-xs text-gray-500 mt-1">Try switching to 'All Roles' or resetting your stage filters.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-gray-200 text-xs font-bold text-gray-400 uppercase tracking-wider bg-gray-50/70">
                                    <th className="py-3.5 px-4 rounded-l-lg">#</th>
                                    <th className="py-3.5 px-4">Candidate</th>
                                    <th className="py-3.5 px-4">Job Role</th>
                                    <th className="py-3.5 px-4">Current Stage</th>
                                    <th className="py-3.5 px-4 text-center">Resume Score</th>
                                    <th className="py-3.5 px-4 text-center">Overall Score</th>
                                    <th className="py-3.5 px-4 text-center">AI Rating</th>
                                    <th className="py-3.5 px-4 text-center rounded-r-lg">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredCandidates.map((c, idx) => {
                                    const effScore = getEffectiveScore(c);
                                    const initials = (c.name || 'NA').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
                                    const avatarColors = ['#5d8c2c','#3b82f6','#8b5cf6','#f59e0b','#ef4444','#06b6d4','#ec4899'];
                                    const avatarBg = avatarColors[idx % avatarColors.length];

                                    // Rating Badge
                                    let ratingLabel = 'Awaiting Score';
                                    let ratingCls = 'bg-gray-100 text-gray-500 border-gray-200';
                                    if (effScore >= 85) {
                                        ratingLabel = 'Exceptional';
                                        ratingCls = 'bg-purple-100 text-purple-700 border-purple-200';
                                    } else if (effScore >= 75) {
                                        ratingLabel = 'Strong Hire';
                                        ratingCls = 'bg-emerald-100 text-emerald-700 border-emerald-200';
                                    } else if (effScore >= 60) {
                                        ratingLabel = 'Consider';
                                        ratingCls = 'bg-blue-100 text-blue-700 border-blue-200';
                                    } else if (effScore > 0) {
                                        ratingLabel = 'Review';
                                        ratingCls = 'bg-amber-100 text-amber-700 border-amber-200';
                                    }

                                    // Stage badge color
                                    const stageMap = {
                                        'Hired': 'bg-emerald-100 text-emerald-700',
                                        'Offer Sent': 'bg-teal-100 text-teal-700',
                                        'Technical Interview': 'bg-blue-100 text-blue-700',
                                        'Coding Round': 'bg-indigo-100 text-indigo-700',
                                        'Aptitude Round': 'bg-violet-100 text-violet-700',
                                        'Screened Candidates': 'bg-amber-100 text-amber-700',
                                        'Resume Screening': 'bg-gray-100 text-gray-600',
                                    };
                                    const stageCls = stageMap[c.stage] || 'bg-gray-100 text-gray-500';

                                    return (
                                        <tr 
                                            key={c.id || idx} 
                                            className="border-b border-gray-100 hover:bg-green-50/20 transition-colors group cursor-pointer"
                                            onClick={() => handleViewCandidate(c)}
                                        >
                                            <td className="py-3.5 px-4 text-xs font-bold text-gray-400">{idx + 1}</td>
                                            <td className="py-3.5 px-4">
                                                <div className="flex items-center gap-3">
                                                    <div
                                                        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-extrabold shrink-0"
                                                        style={{ backgroundColor: avatarBg }}
                                                    >
                                                        {initials}
                                                    </div>
                                                    <div>
                                                        <p className="font-bold text-gray-900 text-sm">{c.name || 'Unknown'}</p>
                                                        <p className="text-xs text-gray-400 font-medium">{c.email || '—'}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-3.5 px-4">
                                                <span className="text-sm font-semibold text-gray-700 max-w-[180px] block truncate">
                                                    {c.applied_role || c.role || 'N/A'}
                                                </span>
                                            </td>
                                            <td className="py-3.5 px-4">
                                                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${stageCls}`}>
                                                    {c.stage || 'Resume Screening'}
                                                </span>
                                            </td>
                                            <td className="py-3.5 px-4 text-center">
                                                {(c.score && c.score > 0)
                                                    ? <span className="text-sm font-extrabold text-gray-700">{Math.round(c.score)}%</span>
                                                    : (c.analysis_data?.score && c.analysis_data.score > 0)
                                                        ? <span className="text-sm font-extrabold text-gray-700">{Math.round(c.analysis_data.score)}%</span>
                                                        : <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Pending</span>
                                                }
                                            </td>
                                            <td className="py-3.5 px-4 text-center">
                                                {effScore > 0 ? (
                                                    <div className="flex flex-col items-center gap-1">
                                                        <span className="text-sm font-extrabold text-[#5d8c2c]">{effScore}%</span>
                                                        <div className="w-20 bg-gray-100 h-1.5 rounded-full overflow-hidden">
                                                            <div
                                                                className="h-full rounded-full bg-[#5d8c2c] transition-all duration-500"
                                                                style={{ width: `${effScore}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <span className="text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                                                        Not Yet Scored
                                                    </span>
                                                )}
                                            </td>
                                            <td className="py-3.5 px-4 text-center">
                                                <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${ratingCls}`}>
                                                    {ratingLabel}
                                                </span>
                                            </td>
                                            <td className="py-3.5 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                                                <button
                                                    onClick={() => handleViewCandidate(c)}
                                                    className="px-3 py-1.5 bg-gray-100 hover:bg-[#5d8c2c] hover:text-white text-gray-700 rounded-lg text-xs font-bold transition flex items-center gap-1.5 mx-auto"
                                                >
                                                    <Eye size={13} />
                                                    <span>View Profile</span>
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        <div className="px-6 py-3.5 bg-gray-50/70 border-t border-gray-100 text-xs text-gray-400 font-semibold flex items-center justify-between">
                            <span>Showing {filteredCandidates.length} evaluated candidate profiles</span>
                            <span>All metrics calculated live from active records</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Slide-Over Candidate Detail Drawer */}
            <CandidateDetailDrawer
                candidate={selectedCandidate}
                isOpen={isDrawerOpen}
                onClose={() => {
                    setIsDrawerOpen(false);
                    setSelectedCandidate(null);
                }}
            />

        </div>
    );
}
