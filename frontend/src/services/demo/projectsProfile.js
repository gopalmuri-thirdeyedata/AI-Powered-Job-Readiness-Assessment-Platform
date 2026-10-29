// Sample-data handlers for the Student Dashboard Demo: Projects, Profile and the Career Copilot drawer.
// Offline: no network and no AI. State lives in this module, so a session of edits (add / edit / delete a project, save the profile,
// chat with the copilot) behaves like the real pages until the browser tab is reloaded. All names and links are made up.

const fail = (status, detail) => Object.assign(new Error(detail), { response: { status, data: { detail } } });
const iso = (daysAgo) => new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
const words = (text) => String(text || '').trim().split(/\s+/).filter(Boolean).length;

/* ─── Projects ──────────────────────────────────── */

// The same style of review the real service writes: **bold** headings in the review text, plus questions, STAR bullets and next steps.
const buildAnalysis = ({ title, description, tech_stack: stack = [], github_url: github, live_url: live }, refreshed = false) => {
    const techs = stack.length ? stack : ['your chosen stack'];
    const main = techs.slice(0, 3).join(', ');
    const score = Math.min(94, 52 + Math.min(18, stack.length * 3) + (github ? 9 : 0) + (live ? 7 : 0) + (words(description) >= 60 ? 6 : 0) + (refreshed ? 1 : 0));
    const review = [
        `**Overview**\n${title} reads as a credible portfolio project. The description explains what it does and how it is built with ${main}, which is what an interviewer looks for first.`,
        `**Architecture**\nThe separation between the interface, the API and the data layer is clear. To show senior-level thinking, name the boundaries explicitly (routing, services, persistence) and say why you drew them there.`,
        `**Code quality and testing**\n${github ? 'The repository is linked, so a reviewer can read the real code.' : 'No repository is linked, so reviewers cannot check the code.'} Add automated tests for the core flows and a short README with setup steps and a screenshot.`,
        `**Scalability and security**\nMention how it behaves under load (caching, pagination, indexes) and how requests are authenticated and validated. One concrete number, such as response time or users supported, makes the project far more convincing.`,
        ...(refreshed ? ['**Refreshed review**\nThis review was regenerated from the latest saved details of the project.'] : []),
    ].join('\n\n');
    return {
        completeness_score: score,
        architecture_review: review,
        suggested_interview_questions: [
            `Walk me through the architecture of ${title}. Which part was hardest to get right?`,
            `Why did you choose ${techs[0]} here, and what would you pick differently today?`,
            'How would you handle ten times more users? Where does it break first?',
            'How do you validate input and protect the data this project stores?',
            'What would you test first, and how did you test it?',
        ],
        bullet_point_improvements: [
            `Built ${title} with ${main}, covering the full flow from the interface to the database.`,
            'Designed a clean REST API with validation and consistent error handling, reducing client-side bugs.',
            `Added automated tests and a short setup guide so a new developer can run ${title} in under five minutes.`,
        ],
        recommendations: [
            'Add a measurable result (users, load time, coverage) to the first line of the description.',
            'Containerise the project with Docker and describe the deployment steps.',
            ...(github ? [] : ['Link the GitHub repository so the review can be based on real code.']),
            ...(live ? [] : ['Deploy a live demo (for example on Vercel or Render) and add the link.']),
        ],
    };
};

const sampleProject = (id, daysAgo, fields) => ({
    id, created_at: iso(daysAgo), updated_at: iso(daysAgo), ...fields, ...buildAnalysis(fields),
});

let nextProjectId = 4;
let projects = [
    sampleProject(3, 12, {
        title: 'CampusConnect',
        description: 'A full-stack platform for campus events. Students browse and register for events, organisers publish them, and admins see attendance dashboards. Built with React on the front end and a Node.js REST API backed by PostgreSQL, with JWT authentication, role-based access and real-time notifications for event updates.',
        tech_stack: ['React', 'Node.js', 'PostgreSQL', 'JWT', 'Socket.IO'],
        github_url: 'https://github.com/aarav-demo/campusconnect',
        live_url: 'https://campusconnect-demo.vercel.app',
    }),
    sampleProject(2, 40, {
        title: 'Smart Expense Tracker',
        description: 'A mobile-first expense tracker that categorises spending automatically, lets users set monthly budgets per category and charts trends over time. Data syncs through Firebase so it works across devices, and alerts appear when spending crosses a budget limit.',
        tech_stack: ['JavaScript', 'Chart.js', 'Firebase'],
        github_url: 'https://github.com/aarav-demo/expense-tracker',
        live_url: null,
    }),
    sampleProject(1, 75, {
        title: 'Library Management API',
        description: 'A REST API for a college library: books, members, loans, fines and reservations. It validates every request, paginates large listings, uses database indexes for search and ships with automated tests that cover the borrowing and fine calculation rules.',
        tech_stack: ['Python', 'FastAPI', 'SQLite', 'Pytest'],
        github_url: 'https://github.com/aarav-demo/library-api',
        live_url: null,
    }),
];

const findProject = (id) => {
    const project = projects.find((p) => p.id === Number(id));
    if (!project) throw fail(404, 'Project not found.');
    return project;
};

const checkProject = (data) => {
    const title = String(data?.title || '').trim();
    if (title.length < 3) throw fail(400, 'Give your project a title of at least 3 characters.');
    if (words(data?.description) < 20) throw fail(400, 'Describe the project properly: at least 20 words.');
    // One way to see the "stays open with the reason" path of the form, without any real GitHub lookup
    if (/not-?found|does-?not-?exist/i.test(String(data?.github_url || ''))) {
        throw fail(404, 'We could not find that GitHub repository. Check the link and that the repository is public.');
    }
};

/* ─── Profile ───────────────────────────────────── */

let profile = {
    id: 1,
    user_id: 1,
    organization_id: null,
    full_name: 'Aarav Sharma',
    email: 'aarav.sharma@example.com',
    phone: '+91 98765 43210',
    college_name: 'Demo Institute of Technology',
    branch: 'B.Tech, Computer Science',
    education: 'B.Tech, Computer Science',
    graduation_year: 2025,
    cgpa: 8.4,
    target_role: 'Software Engineer',
    target_company: 'ThirdEye Data',
    current_skills: ['Python', 'JavaScript', 'React', 'Node.js', 'PostgreSQL', 'REST APIs', 'Git', 'Data Structures'],
    readiness_score: 74,
    readiness_breakdown: { resume: 82, technical_skills: 76, projects: 70, experience: 58, education: 85 },
    latest_resume: { id: 1, version: 3, file_name: 'Aarav_Sharma_Resume.pdf', overall_score: 82 },
    is_onboarded: true,
    onboarding_step: 4,
    created_at: iso(120),
};

const updateProfile = (data = {}) => {
    const name = String(data.full_name || '').trim();
    const role = String(data.target_role || '').trim();
    if (!name) throw fail(422, 'Please enter your full name.');
    if (!role) throw fail(422, 'Please specify your target career role.');
    if (data.graduation_year != null && (!Number.isInteger(data.graduation_year) || data.graduation_year < 1950 || data.graduation_year > 2100)) {
        throw fail(422, 'Enter a graduation year between 1950 and 2100.');
    }
    if (data.cgpa != null && !(data.cgpa >= 0 && data.cgpa <= 100)) throw fail(422, 'Enter a CGPA between 0 and 100.');
    profile = {
        ...profile,
        full_name: name,
        target_role: role,
        target_company: data.target_company ?? null,
        college_name: data.college_name ?? null,
        education: data.education ?? null,
        branch: data.education ?? null,
        graduation_year: data.graduation_year ?? null,
        cgpa: data.cgpa ?? null,
        current_skills: Array.isArray(data.current_skills) ? [...data.current_skills] : [],
    };
    return profile;
};

/* ─── Career Copilot ────────────────────────────── */

const COPILOT_SUGGESTIONS = [
    'How can I improve my resume score?',
    'What should I practise this week?',
    'How do I prepare for a system design interview?',
    'Which skills am I missing for a Software Engineer role?',
];

const COPILOT_REPLIES = [
    [/resume|cv|ats/, 'Your latest resume scores 82/100. The quickest wins are adding a measurable result to each experience bullet (for example "cut load time by 35%") and linking your GitHub profile in the contact line. Try the Resume Analyzer with a job description to see which keywords you are missing.'],
    [/system design|architecture|scal/, 'System design is your lowest skill right now (about 52%). Start with the basics: requirements, a simple diagram, then bottlenecks and trade-offs. Practise explaining one of your own projects, such as CampusConnect, as if it had ten times more users.'],
    [/interview|hr|mock/, 'You have completed 3 mock interviews with an average of 68%. Focus on structured answers: situation, action and result. Book a mock HR interview this week to bring that score above 75%.'],
    [/roadmap|plan|schedule|week/, 'You have finished 14 of 30 roadmap tasks. This week, aim for one graph problem and one dynamic programming problem a day, then revise your weakest topics on the weekend.'],
    [/skill|gap|missing|learn/, 'For a Software Engineer role your gaps are Docker, CI/CD and system design. Containerise one of your projects first; it also gives you a strong resume bullet.'],
    [/practi[cs]e|dsa|coding|leetcode|problem/, 'You have solved 23 practice problems. Your coding round lost most marks on graphs and dynamic programming, so spend this week on five medium graph problems and the standard DP patterns.'],
    [/project|portfolio|github/, 'Your strongest project is CampusConnect. Add a measurable result, a short README with a screenshot and a Docker setup, and use the review on the Projects page for interview questions.'],
    [/hello|hi\b|hey|thanks|thank/, 'Hello Aarav! I can help with your resume, practice plan, interviews and skill gaps. What would you like to work on?'],
];
const FALLBACK_REPLY = 'Based on your profile, the three most useful next steps are: close your system design gap, add a measurable result to your resume bullets, and solve a few graph problems. Ask me about any of them.';

let nextMessageId = 3;
let messages = [
    { id: 1, role: 'USER', content: 'What should I focus on this week?', created_at: iso(1) },
    { id: 2, role: 'ASSISTANT', content: 'Focus on graphs and dynamic programming in practice, and add a measurable result to your resume bullets. Your readiness is 74 and the biggest gain is in the coding round.', created_at: iso(1) },
];

const copilotReply = (query) => {
    const text = String(query || '').toLowerCase();
    const hit = COPILOT_REPLIES.find(([pattern]) => pattern.test(text));
    return hit ? hit[1] : FALLBACK_REPLY;
};

/* ─── Handlers ──────────────────────────────────── */

export default {
    getProjects: () => [...projects].sort((a, b) => b.id - a.id),

    createProject: (data) => {
        checkProject(data);
        const now = new Date().toISOString();
        const project = {
            id: nextProjectId++, created_at: now, updated_at: now,
            title: data.title, description: data.description, tech_stack: data.tech_stack || [],
            github_url: data.github_url || null, live_url: data.live_url || null, ...buildAnalysis(data),
        };
        projects = [project, ...projects];
        return project;
    },

    updateProject: (id, data) => {
        const current = findProject(id);
        checkProject(data);
        const updated = {
            ...current, title: data.title, description: data.description, tech_stack: data.tech_stack || [],
            github_url: data.github_url || null, live_url: data.live_url || null, updated_at: new Date().toISOString(), ...buildAnalysis(data),
        };
        projects = projects.map((p) => (p.id === current.id ? updated : p));
        return updated;
    },

    deleteProject: (id) => {
        findProject(id);
        projects = projects.filter((p) => p.id !== Number(id));
        return { message: 'Project deleted.' };
    },

    analyzeProject: (id) => {
        const current = findProject(id);
        const analysis = buildAnalysis(current, true);
        projects = projects.map((p) => (p.id === current.id ? { ...p, ...analysis } : p));
        return analysis;
    },

    getProfile: () => profile,
    updateProfile,

    getCopilotHistory: () => ({ messages, suggestions: COPILOT_SUGGESTIONS }),

    sendCopilotMessage: (content) => {
        const query = String(content || '').trim();
        if (!query) throw fail(400, 'Please type a message.');
        const now = new Date().toISOString();
        const user = { id: nextMessageId++, role: 'USER', content: query, created_at: now };
        const assistant = { id: nextMessageId++, role: 'ASSISTANT', content: copilotReply(query), created_at: now };
        messages = [...messages, user, assistant];
        return assistant;
    },

    clearCopilotHistory: () => {
        messages = [];
        return { message: 'History cleared.' };
    },
};
