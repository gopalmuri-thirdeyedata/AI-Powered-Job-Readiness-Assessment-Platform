// Data for the RoleReady report and the three admin bulk exports (short and multi-page versions).
const names = ['Aarav Mehta', 'Priya Nair', 'Rohan Deshpande-Subramaniam', 'Sneha Kulkarni', 'Vikram Singh Rathore', 'Ananya Iyer'];
const stages = ['Aptitude', 'Coding', 'Technical Interview', 'Hired'];
const statuses = ['Active', 'Completed', 'Rejected', 'On Hold'];

/** Candidates page: [{ name, email, role, stage, status, score }] */
export const candidatesList = (n = 6) => Array.from({ length: n }, (_, i) => ({
    name: names[i % names.length] + (i >= names.length ? ` ${i}` : ''),
    email: `candidate.${i}.with.a.long.address@example-company.com`,
    role: i % 5 === 4 ? '' : ['Backend Engineer', 'Data Analyst', 'Senior Full Stack Engineer'][i % 3],
    stage: stages[i % 4], status: statuses[i % 4], score: i % 7 === 6 ? undefined : 40 + ((i * 7) % 60),
}));

/** CandidateTable: the rows prepareExportData() builds */
export const tableRows = (n = 6) => Array.from({ length: n }, (_, i) => ({
    'S.No': i + 1, Name: names[i % names.length], Email: `person${i}@example-company.com`, 'Job Role': ['Backend Engineer', 'Data Analyst'][i % 2],
    'Current Stage': stages[i % 4], Status: statuses[i % 4], 'AI Recommendation': ['Strong Hire', 'Hire', 'Review', 'No Hire'][i % 4], 'Accuracy Score': `${50 + ((i * 3) % 50)}%`,
}));

export const analyticsData = (rows = 4) => ({
    kpi: { total_applicants: 1280, active_pipeline: 342, placement_rate: 18.5, avg_talent_score: 71.2, pipeline_health_score: 84, pipeline_health_status: 'Healthy' },
    funnelStages: [{ stage: 'Applied', count: 1280, conversion_pct: 100 }, { stage: 'Aptitude', count: 902, conversion_pct: 70.5 }, { stage: 'Coding', count: 610, conversion_pct: 47.7 }, { stage: 'Interview', count: 301, conversion_pct: 23.5 }, { stage: 'Hired', count: 237, conversion_pct: 18.5 }],
    recommendationData: [{ name: 'Strong Hire', value: 120, percentage: 9.4 }, { name: 'Hire', value: 310, percentage: 24.2 }, { name: 'Review', value: 540, percentage: 42.2 }, { name: 'No Hire', value: 310, percentage: 24.2 }],
    roleInsights: Array.from({ length: rows }, (_, i) => ({ role: `Job Role Number ${i + 1}`, candidate_count: 20 + i * 3, avg_score: 60 + (i % 30), placement_rate: 5 + (i % 20) })),
    selectedRoleFilter: 'All Roles', selectedDateRange: 'Last 30 Days',
});

export const roleReadyReport = ({ long = false } = {}) => ({
    target_role: 'Full Stack Engineer', target_company: 'ThirdEye Data', completed_at: '2030-01-15T10:00:00+00:00', current_state: 'COMPLETED',
    overall_readiness_score: 78.5, aptitude_score: 80, coding_score: 66.67, interview_score: null, resume_to_jd_match_score: 72,
    final_report: {
        readiness_tier: 'Foundation Strong', skills_verified: ['Algorithms', 'REST — “design”', 'Git'], areas_for_improvement: ['System design', 'Caching'],
        skill_gap_analysis: [{ skill: 'SQL', status: 'Gap', recommendation: 'Practise joins' }, { skill: 'Python', status: 'Demonstrated', evidence: 'Solved 3 of 3' }],
        interview_breakdown: [{ question_text: 'Explain indexes.', score: 62.4, category: 'SQL', evidence: 'Mentioned B-trees.' }],
        personalized_recommendations: long
            ? Array.from({ length: 70 }, (_, i) => `Recommendation number ${i + 1}: build a small project that exercises this skill end to end and write down what you learned from it.`)
            : ['Build a small API', 'Review indexing'],
        suggested_learning_roadmap: long
            ? Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`Week ${i + 1}`, [`Read the documentation for topic ${i + 1}`, { task: `Practise exercise set ${i + 1}` }]]))
            : { 'Week 1': ['Read docs', { task: 'Practise SQL' }], 'Week 2': 'Mock interview' },
        round_details: { aptitude: { correct_count: 8, total_questions: 10 }, coding: { passed_hidden_tests: 2, total_hidden_tests: 3 } },
    },
});
