import React, { useState, useEffect } from 'react';
import { 
    Users, 
    Search, 
    Filter, 
    FileText, 
    Award, 
    AlertTriangle, 
    CheckCircle2, 
    RefreshCw, 
    ChevronDown, 
    Building2 
} from 'lucide-react';
import collegeApi from '../../services/collegeApi';

const CollegeStudents = () => {
    const [students, setStudents] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedBranch, setSelectedBranch] = useState('');
    const [readinessFilter, setReadinessFilter] = useState('');

    const loadStudents = async () => {
        setIsLoading(true);
        try {
            const params = {};
            if (searchQuery.trim()) params.search = searchQuery.trim();
            if (selectedBranch) params.branch = selectedBranch;
            if (readinessFilter) {
                if (readinessFilter === 'high') params.min_readiness = 75;
                if (readinessFilter === 'moderate') params.min_readiness = 50;
            }

            const data = await collegeApi.getStudents(params);
            
            // Client-side filtering for 'risk' if chosen (< 50)
            let filtered = data || [];
            if (readinessFilter === 'risk') {
                filtered = filtered.filter(s => s.readiness_score < 50);
            }

            setStudents(filtered);
        } catch (err) {
            console.error('Failed to load students roster:', err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadStudents();
    }, [selectedBranch, readinessFilter]);

    const handleSearchSubmit = (e) => {
        e.preventDefault();
        loadStudents();
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight flex items-center gap-2.5">
                        <Users className="w-7 h-7 text-indigo-400" />
                        <span>Student Placement Roster</span>
                    </h1>
                    <p className="text-sm text-slate-400 mt-1">
                        Monitor individual candidate preparation, verified ATS resume scores, and drive engagement.
                    </p>
                </div>
            </div>

            {/* Filter Controls Bar */}
            <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 flex flex-col md:flex-row items-center gap-3 justify-between shadow-sm">
                {/* Search Box */}
                <form onSubmit={handleSearchSubmit} className="relative w-full md:w-96">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search student by name, email, target role..."
                        className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                    />
                </form>

                {/* Dropdown Filters */}
                <div className="flex items-center gap-3 w-full md:w-auto">
                    {/* Branch Filter */}
                    <div className="flex items-center gap-2">
                        <Filter className="w-3.5 h-3.5 text-slate-400" />
                        <select
                            value={selectedBranch}
                            onChange={(e) => setSelectedBranch(e.target.value)}
                            className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none"
                        >
                            <option value="">All Branches</option>
                            <option value="Computer Science">Computer Science</option>
                            <option value="Information Technology">Information Technology</option>
                            <option value="Electronics">Electronics</option>
                            <option value="Mechanical">Mechanical</option>
                        </select>
                    </div>

                    {/* Readiness Filter */}
                    <select
                        value={readinessFilter}
                        onChange={(e) => setReadinessFilter(e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none"
                    >
                        <option value="">All Readiness Tiers</option>
                        <option value="high">High (≥ 75%)</option>
                        <option value="moderate">Moderate (≥ 50%)</option>
                        <option value="risk">At-Risk (&lt; 50%)</option>
                    </select>

                    <button
                        onClick={loadStudents}
                        className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Filter</span>
                    </button>
                </div>
            </div>

            {/* Students Table */}
            <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl overflow-hidden shadow-sm">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                        <RefreshCw className="w-7 h-7 text-indigo-400 animate-spin" />
                        <p className="text-xs text-slate-400">Loading student roster...</p>
                    </div>
                ) : students.length === 0 ? (
                    <div className="py-16 text-center space-y-2">
                        <Users className="w-10 h-10 text-slate-600 mx-auto" />
                        <h3 className="text-sm font-semibold text-slate-300">No students matched</h3>
                        <p className="text-xs text-slate-500 max-w-sm mx-auto">
                            Try adjusting your search criteria or clearing filters to view enrolled students.
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead>
                                <tr className="border-b border-slate-700/80 bg-slate-900/40 text-slate-400 uppercase tracking-wider text-[11px]">
                                    <th className="py-3.5 px-4 font-semibold">Student Name</th>
                                    <th className="py-3.5 px-4 font-semibold">Branch & Year</th>
                                    <th className="py-3.5 px-4 font-semibold">CGPA</th>
                                    <th className="py-3.5 px-4 font-semibold">Target Role</th>
                                    <th className="py-3.5 px-4 font-semibold">Readiness Score</th>
                                    <th className="py-3.5 px-4 font-semibold">Resume ATS</th>
                                    <th className="py-3.5 px-4 font-semibold">Drive Apps</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700/50 text-slate-200">
                                {students.map((student) => {
                                    const score = Math.round(student.readiness_score || 0);
                                    let badgeColor = 'bg-rose-500/15 text-rose-300 border-rose-500/30';
                                    if (score >= 75) badgeColor = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
                                    else if (score >= 50) badgeColor = 'bg-amber-500/15 text-amber-300 border-amber-500/30';

                                    return (
                                        <tr key={student.id} className="hover:bg-slate-750/50 transition-colors">
                                            {/* Name & Email */}
                                            <td className="py-3.5 px-4">
                                                <div className="font-semibold text-white">{student.full_name}</div>
                                                <div className="text-[11px] text-slate-400">{student.email}</div>
                                            </td>

                                            {/* Branch & Year */}
                                            <td className="py-3.5 px-4">
                                                <span className="text-slate-300">{student.branch || 'N/A'}</span>
                                                <div className="text-[11px] text-slate-500">
                                                    Grad: {student.graduation_year || 'N/A'}
                                                </div>
                                            </td>

                                            {/* CGPA */}
                                            <td className="py-3.5 px-4 font-semibold">
                                                {student.cgpa !== null && student.cgpa !== undefined ? (
                                                    <span className={student.cgpa >= 7.5 ? 'text-emerald-400' : 'text-slate-300'}>
                                                        {student.cgpa.toFixed(1)}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-500">N/A</span>
                                                )}
                                            </td>

                                            {/* Target Role */}
                                            <td className="py-3.5 px-4">
                                                <span className="px-2.5 py-1 rounded-lg bg-slate-700/60 text-slate-300 text-[11px]">
                                                    {student.target_role || 'General'}
                                                </span>
                                            </td>

                                            {/* Readiness Score */}
                                            <td className="py-3.5 px-4">
                                                <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${badgeColor}`}>
                                                    {score}%
                                                </span>
                                            </td>

                                            {/* Resume ATS */}
                                            <td className="py-3.5 px-4">
                                                {student.has_resume ? (
                                                    <span className="text-emerald-400 font-semibold flex items-center gap-1">
                                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                                        <span>{Math.round(student.resume_score || 0)}%</span>
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-500 italic">No resume</span>
                                                )}
                                            </td>

                                            {/* Drive Applications */}
                                            <td className="py-3.5 px-4">
                                                <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-indigo-300 font-bold">
                                                    {student.applications_count}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CollegeStudents;
