// Sample data for the Student Dashboard Demo. Everything here is made up: no real student, resume or score.
// Shapes mirror the API responses the student pages read, so the real pages render it unchanged.

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();
const shortDate = (n) => new Date(Date.now() - n * DAY).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const clock = (n) => (n === 0 ? 'Today' : n === 1 ? 'Yesterday' : `${n} days ago`);

export const DEMO_STUDENT = {
    full_name: 'Aarav Sharma',
    email: 'aarav.sharma@example.com',
    target_role: 'Software Engineer',
    target_company: 'ThirdEye Data',
};

/* ─── Dashboard ─────────────────────────────────── */
export const DEMO_DASHBOARD = {
    student_name: DEMO_STUDENT.full_name,
    target_role: DEMO_STUDENT.target_role,
    target_company: DEMO_STUDENT.target_company,
    readiness_score: 74,
    resume_score: 82,
    latest_resume_version: 3,
    readiness_breakdown: {
        resume: 82, technical_skills: 76, projects: 70, experience: 58, education: 85, ats_quality: 80,
        assessment: 73, interview: 68, practice: 64, roadmap: 55,
    },
    strengths: [
        'Strong fundamentals in data structures and algorithms',
        'Hands-on full-stack project experience (React, Node.js, PostgreSQL)',
        'Clear communication in the mock interview rounds',
        'Consistent practice streak over the last three weeks',
    ],
    areas_to_improve: [
        'System design: practise designing scalable services',
        'Cloud deployment (Docker, CI/CD) is missing from your projects',
        'Quantify the impact of your internship achievements',
    ],
    resume_recommendations: [
        'Add measurable results to each experience bullet (for example, "reduced load time by 35%").',
        'Move your skills section above projects so ATS parsers find it first.',
        'Add a link to your GitHub profile in the contact line.',
    ],
};

export const DEMO_UNIFIED = {
    roadmap: { completed_tasks: 14, total_tasks: 30 },
    practice: { solved_count: 23 },
    mock_interviews: { completed_sessions: 3, avg_score: 68 },
    projects: { total_projects: 3 },
    copilot_suggestions: [
        'Revise graph traversal and dynamic programming: your last coding round lost most marks there.',
        'Book a mock HR interview this week to lift your interview score above 75%.',
        'Containerise one project with Docker to close the cloud-deployment gap.',
    ],
};

export const DEMO_ONBOARDING = { is_onboarded: true, onboarding_step: 4 };

const assessment = (id, n, role, scores, extra = {}) => {
    const [aptitude, coding, interview] = scores;
    const overall = Math.round(aptitude * 0.3 + coding * 0.4 + interview * 0.3);
    return {
        id, session_uuid: `demo-session-${id}`, target_role: role, target_company: 'ThirdEye Data', created_at: daysAgo(n),
        aptitude_score: aptitude, coding_score: coding, interview_score: interview, overall_readiness_score: overall,
        is_completed: true, is_closed: true, is_timed_out: false, is_disqualified: false, ...extra,
    };
};

const DEMO_SESSIONS = [
    assessment(3, 4, 'Software Engineer', [82, 74, 70]),
    assessment(2, 19, 'Backend Developer', [76, 66, 64]),
    assessment(1, 41, 'Software Engineer', [68, 55, 58]),
];

export const DEMO_ASSESSMENT_HISTORY = {
    total_attempted: DEMO_SESSIONS.length,
    total_completed: DEMO_SESSIONS.length,
    active_session: null,
    latest_assessment: {
        overall_readiness_score: DEMO_SESSIONS[0].overall_readiness_score,
        target_role: DEMO_SESSIONS[0].target_role,
        created_at: DEMO_SESSIONS[0].created_at,
        report_url: null,
    },
    assessments: DEMO_SESSIONS,
    trends: [...DEMO_SESSIONS].reverse().map((s) => ({
        role: s.target_role, date: shortDate(Math.round((Date.now() - new Date(s.created_at).getTime()) / DAY)),
        overall: s.overall_readiness_score, aptitude: s.aptitude_score, coding: s.coding_score, interview: s.interview_score,
    })),
    areas_for_improvement: [
        { round: 'Coding', score: 65, topic: 'Graphs and dynamic programming', recommendation: 'Solve five medium graph problems this week and review the DP patterns in the roadmap.' },
        { round: 'Interview', score: 64, topic: 'System design communication', recommendation: 'Practise explaining trade-offs out loud: structure answers as requirements, design, bottlenecks.' },
    ],
};

/* ─── Performance & analytics tab ───────────────── */
const PERF_ITEMS = [
    { id: 'a3', raw_id: 3, category_key: 'ROLEREADY', category: 'RoleReady', test_name: 'Software Engineer Assessment', score: DEMO_SESSIONS[0].overall_readiness_score, status: 'COMPLETED', n: 4, duration_minutes: 82,
      rounds_summary: [{ round_name: 'Aptitude', score: 82 }, { round_name: 'Coding', score: 74 }, { round_name: 'Interview', score: 70 }] },
    { id: 'a2', raw_id: 2, category_key: 'ROLEREADY', category: 'RoleReady', test_name: 'Backend Developer Assessment', score: DEMO_SESSIONS[1].overall_readiness_score, status: 'COMPLETED', n: 19, duration_minutes: 76,
      rounds_summary: [{ round_name: 'Aptitude', score: 76 }, { round_name: 'Coding', score: 66 }, { round_name: 'Interview', score: 64 }] },
    { id: 'm2', raw_id: 2, category_key: 'MOCK_INTERVIEW', category: 'Mock Interviews', test_name: 'Technical Mock Interview', score: 68, status: 'COMPLETED', n: 24, duration_minutes: 25, rounds_summary: [] },
    { id: 'm1', raw_id: 1, category_key: 'MOCK_INTERVIEW', category: 'Mock Interviews', test_name: 'HR Mock Interview', score: 72, status: 'COMPLETED', n: 31, duration_minutes: 20, rounds_summary: [] },
    { id: 'a1', raw_id: 1, category_key: 'ROLEREADY', category: 'RoleReady', test_name: 'Software Engineer Assessment', score: DEMO_SESSIONS[2].overall_readiness_score, status: 'COMPLETED', n: 41, duration_minutes: 88,
      rounds_summary: [{ round_name: 'Aptitude', score: 68 }, { round_name: 'Coding', score: 55 }, { round_name: 'Interview', score: 58 }] },
].map(({ n, ...item }) => ({ ...item, formatted_date: shortDate(n), report_url: null, _n: n }));

export const DEMO_PERFORMANCE_DASHBOARD = {
    overview: { student_name: DEMO_STUDENT.full_name, has_active_test: false, active_test_message: '' },
    summary: {
        total_tests_completed: PERF_ITEMS.length,
        average_score: Math.round(PERF_ITEMS.reduce((sum, i) => sum + i.score, 0) / PERF_ITEMS.length),
        best_performance: { test_name: PERF_ITEMS[0].test_name, score: PERF_ITEMS[0].score, formatted_date: PERF_ITEMS[0].formatted_date },
        improvement_rate: 12,
        tests_in_progress: 0,
    },
    trends: {
        trend_status: 'improving',
        trend_message: 'Your scores have improved steadily across your last three assessments.',
        data_points: [...PERF_ITEMS].sort((a, b) => b._n - a._n).map((i) => ({
            category_key: i.category_key, category: i.category, test_name: i.test_name, score: i.score, formatted_date: i.formatted_date,
        })),
    },
    skills_analysis: {
        has_evaluation_data: true,
        assessment_skills: [
            { skill: 'Data Structures & Algorithms', score: 78, level: 'Proficient' },
            { skill: 'Aptitude & Reasoning', score: 82, level: 'Advanced' },
            { skill: 'Database & SQL', score: 71, level: 'Proficient' },
            { skill: 'System Design', score: 52, level: 'Developing' },
            { skill: 'Communication', score: 69, level: 'Proficient' },
        ],
        resume_skills: ['Python', 'JavaScript', 'React', 'Node.js', 'PostgreSQL', 'Git', 'REST APIs', 'Data Structures'],
    },
    recommended_next_steps: [
        { id: 'n1', priority: 'high', title: 'Close your system design gap', description: 'System design is your lowest skill. A short guided practice set will lift your interview score.', action_label: 'Open practice', action_url: '/student/practice' },
        { id: 'n2', priority: 'high', title: 'Review your resume feedback', description: 'Three quick edits can raise your ATS score above 85.', action_label: 'Open Resume Analyzer', action_url: '/student/resume' },
        { id: 'n3', priority: 'normal', title: 'Re-format your resume', description: 'Try the three ATS-friendly templates and download the one you like.', action_label: 'Open Resume Formatter', action_url: '/student/resume-formatter' },
    ],
    recent_activity: [
        { id: 'r1', type: 'interview', title: 'Completed a technical assessment', description: 'Software Engineer: 74% overall', formatted_time: clock(4) },
        { id: 'r2', type: 'practice', title: 'Solved 3 practice problems', description: 'Arrays and hashing', formatted_time: clock(5) },
        { id: 'r3', type: 'roadmap', title: 'Finished a roadmap task', description: 'Revise binary search patterns', formatted_time: clock(6) },
    ],
};

export const demoPerformanceHistory = ({ category, status, sortBy, page = 1, pageSize = 8 } = {}) => {
    let items = PERF_ITEMS.filter((i) => (!category || category === 'ALL' || i.category_key === category) && (!status || status === 'ALL' || i.status === status));
    const sorters = {
        date_asc: (a, b) => b._n - a._n, score_desc: (a, b) => b.score - a.score, score_asc: (a, b) => a.score - b.score,
    };
    items = [...items].sort(sorters[sortBy] || ((a, b) => a._n - b._n));
    const total = items.length;
    const start = (Math.max(1, page) - 1) * pageSize;
    return { items: items.slice(start, start + pageSize), page, total_count: total, total_pages: Math.max(1, Math.ceil(total / pageSize)) };
};

export const demoPerformanceDetail = (category, id) => {
    const item = PERF_ITEMS.find((i) => i.category_key === category && String(i.raw_id) === String(id)) || PERF_ITEMS[0];
    return {
        ...item,
        overall_score: item.score,
        round_details: item.rounds_summary.map((r) => ({ ...r, feedback: `Sample feedback: solid ${r.round_name.toLowerCase()} performance with room to tighten explanations.` })),
        strengths: ['Clear problem decomposition', 'Good use of data structures'],
        weaknesses: ['Edge cases handled late', 'Could explain time complexity sooner'],
        evaluation_summary: 'This is sample data for the demo. A real report summarises the student\'s strongest rounds and gives a short list of follow-ups.',
    };
};

/* ─── Resume Analyzer (reviewer) ────────────────── */
export const DEMO_RESUME_ANALYSIS = {
    id: 1,
    version: 3,
    file_name: 'Aarav_Sharma_Resume.pdf',
    created_at: daysAgo(6),
    overall_score: 82,
    strengths: [
        'Clear project descriptions with the technologies used',
        'Relevant internship experience for a software engineering role',
        'Consistent formatting and standard section headings',
    ],
    weaknesses: [
        'Experience bullets rarely include numbers or measurable outcomes',
        'No link to a GitHub or portfolio profile',
    ],
    missing_information: ['LinkedIn profile URL', 'Certifications dates', 'Quantified achievements in the internship'],
    recommendations: [
        'Add a measurable result to every experience bullet (percentages, users, time saved).',
        'Add your GitHub and LinkedIn links to the contact line.',
        'List certifications with the issuing body and year.',
        'Keep the resume to one page by trimming older coursework.',
    ],
    analysis_json: {
        ats_compatibility: { score: 85 },
        resume_quality: { score: 79 },
        technical_skills: { skills: ['Python', 'JavaScript', 'React', 'Node.js', 'PostgreSQL', 'Git', 'REST APIs', 'Docker (basic)'] },
        soft_skills: { skills: ['Teamwork', 'Communication', 'Problem solving', 'Time management'] },
        dsa_indicators: { indicators: ['Arrays and strings', 'Hash maps', 'Binary search', 'Trees and graphs', 'LeetCode profile (150+ problems)'] },
        education: { records: [{ degree: 'B.Tech, Computer Science', institution: 'Demo Institute of Technology', year: '2025', cgpa: '8.4 / 10' }] },
        projects: {
            items: [
                { name: 'CampusConnect', description: 'Full-stack platform for campus events with role-based access, real-time notifications and an admin dashboard.', technologies: ['React', 'Node.js', 'PostgreSQL'] },
                { name: 'Smart Expense Tracker', description: 'Mobile-first expense tracker that categorises spending and charts monthly trends.', technologies: ['JavaScript', 'Chart.js', 'Firebase'] },
            ],
        },
        experience: {
            items: [
                { role: 'Software Engineering Intern', company: 'Sample Tech Pvt. Ltd.', duration: 'Jun 2024 - Aug 2024', summary: 'Built REST endpoints and a reporting page for an internal analytics tool; wrote unit tests and fixed production bugs.' },
            ],
        },
        certifications: { items: ['Python for Everybody (Coursera)', 'Foundations of Cloud Computing (Sample Academy)'] },
    },
};

export const DEMO_SAMPLE_JOB_DESCRIPTION = `Software Engineer (Full Stack) at ThirdEye Data

We are looking for a Software Engineer to build and ship features across our React front end and Python/Node.js services.

Responsibilities
- Design, build and test REST APIs and responsive user interfaces.
- Work with PostgreSQL, write efficient queries and keep data models clean.
- Collaborate with product and design in an agile team; review code and fix production issues.

Requirements
- 0-2 years of experience; B.Tech/B.E. in Computer Science or a related field.
- Strong knowledge of JavaScript, React, and one backend language (Python or Node.js).
- Good understanding of data structures, algorithms and SQL.
- Familiarity with Git, Docker and CI/CD is a plus.
- Clear communication and a habit of writing tests.`;

export const DEMO_JD_ANALYSIS = {
    ai_generated: true,
    job_title: 'Software Engineer (Full Stack)',
    company: 'ThirdEye Data',
    required_experience: '0-2 years',
    resume_experience: '3 months internship plus 2 substantial projects',
    match_score: 78,
    fit_verdict: 'Good',
    summary: 'Your resume matches most of the required skills for this role. Gaps are Docker/CI-CD exposure and measurable impact in your experience section.',
    matched_skills: ['JavaScript', 'React', 'Node.js', 'PostgreSQL', 'Git', 'REST APIs', 'Data Structures'],
    missing_skills: ['Docker', 'CI/CD', 'Unit testing frameworks'],
    strengths: ['Hands-on React and Node.js projects that match the stack', 'Relevant internship building REST endpoints', 'Qualification and experience level fit the role'],
    weaknesses: ['No Docker or CI/CD evidence', 'Experience bullets lack measurable results'],
    experience_fit: 'Your internship and projects cover the 0-2 year experience range the role asks for.',
    qualification_fit: 'B.Tech in Computer Science meets the education requirement.',
    recommendations: [
        'Containerise CampusConnect with Docker and mention it in the project description.',
        'Add a line about the tests you wrote during your internship.',
        'Mirror the job description\'s wording for skills you genuinely have so ATS filters match.',
    ],
};

/* ─── Resume Formatter ──────────────────────────── */
export const DEMO_FORMATTED_RESUME = {
    ai_generated: true,
    name: 'Aarav Sharma',
    contact: {
        email: 'aarav.sharma@example.com',
        phone: '+91 98765 43210',
        location: 'Bengaluru, India',
        links: ['github.com/aarav-demo', 'linkedin.com/in/aarav-demo'],
    },
    summary: 'Computer Science graduate with hands-on full-stack project experience and a software engineering internship. Strong in data structures, React and Node.js, looking for a Software Engineer role.',
    skills: ['Python', 'JavaScript', 'React', 'Node.js', 'PostgreSQL', 'REST APIs', 'Git', 'Data Structures & Algorithms', 'Docker (basic)'],
    experience: [
        {
            title: 'Software Engineering Intern',
            company: 'Sample Tech Pvt. Ltd., Bengaluru',
            dates: 'Jun 2024 - Aug 2024',
            bullets: [
                'Built REST endpoints and a reporting page for an internal analytics tool used by the operations team.',
                'Wrote unit tests for new modules and fixed production bugs reported by users.',
                'Worked in a two-week sprint cycle with code reviews and daily stand-ups.',
            ],
        },
    ],
    projects: [
        {
            name: 'CampusConnect',
            dates: '2024',
            tech: ['React', 'Node.js', 'PostgreSQL'],
            description: 'Full-stack campus events platform with role-based access and an admin dashboard.',
            bullets: ['Implemented real-time notifications for event updates.', 'Designed the database schema and secured endpoints with JWT.'],
        },
        {
            name: 'Smart Expense Tracker',
            dates: '2023',
            tech: ['JavaScript', 'Chart.js', 'Firebase'],
            description: 'Mobile-first expense tracker that categorises spending and charts monthly trends.',
            bullets: ['Added category budgets with alerts when spending crosses a limit.'],
        },
    ],
    education: [
        { degree: 'B.Tech, Computer Science', institution: 'Demo Institute of Technology', dates: '2021 - 2025', details: 'CGPA: 8.4 / 10' },
    ],
    certifications: ['Python for Everybody (Coursera)', 'Foundations of Cloud Computing (Sample Academy)'],
    achievements: ['Solved 150+ problems on LeetCode', 'Finalist, college hackathon 2023'],
};
