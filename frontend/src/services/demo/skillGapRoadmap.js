// Sample-data handlers for the Student Dashboard Demo: the Skill Gap and Roadmap pages.
// Everything is made up and kept in memory, so the pages react like the real ones (switch role, add a what-if skill, tick a task,
// regenerate the plan) without any request. State resets on a full page reload.

const clean = (s) => String(s || '').trim();
const key = (s) => clean(s).toLowerCase();

/* ─── Skill Gap ─────────────────────────────────── */
// The sample student's skills (the same resume the Resume Analyzer shows)
const STUDENT_SKILLS = [
    'Python', 'JavaScript', 'React', 'Node.js', 'PostgreSQL', 'SQL', 'Git', 'REST APIs', 'HTML', 'CSS',
    'Data Structures', 'Algorithms', 'Problem Solving', 'Communication', 'Teamwork', 'Docker',
];

const ROLES = [
    {
        title: 'Software Engineer',
        description: 'Designs, builds and maintains software features across the stack, with strong fundamentals in data structures, algorithms and clean code.',
        required: ['Python', 'JavaScript', 'Data Structures', 'Algorithms', 'SQL', 'Git', 'REST APIs', 'System Design'],
        preferred: ['React', 'Node.js', 'Docker', 'CI/CD', 'Unit Testing', 'Cloud Basics'],
        rounds: ['Online Coding Assessment', 'Technical Interview (DSA)', 'System Design Discussion', 'Hiring Manager Round', 'HR Round'],
        focus: 'System Design Fundamentals',
        milestone: 'Complete a system design practice set and containerise one of your projects.',
    },
    {
        title: 'Backend Developer',
        description: 'Builds the APIs, databases and services that power applications, with a focus on reliability, performance and security.',
        required: ['Python', 'Node.js', 'SQL', 'PostgreSQL', 'REST APIs', 'Git', 'Authentication', 'Docker'],
        preferred: ['Redis', 'Message Queues', 'CI/CD', 'System Design', 'Cloud Basics'],
        rounds: ['Online Assessment', 'Technical Interview (APIs & Databases)', 'System Design Round', 'HR Round'],
        focus: 'Authentication and Caching',
        milestone: 'Add JWT authentication and a Redis cache to CampusConnect.',
    },
    {
        title: 'Frontend Developer',
        description: 'Creates fast, accessible and polished user interfaces, translating designs into maintainable component-based code.',
        required: ['JavaScript', 'React', 'HTML', 'CSS', 'Git', 'REST APIs', 'Responsive Design', 'TypeScript'],
        preferred: ['Redux', 'Testing Library', 'Accessibility', 'Performance Tuning'],
        rounds: ['Machine Coding Round (UI)', 'JavaScript Fundamentals Interview', 'Frontend System Design', 'HR Round'],
        focus: 'TypeScript and Accessibility',
        milestone: 'Migrate one React project to TypeScript and fix its accessibility issues.',
    },
    {
        title: 'Full Stack Developer',
        description: 'Owns features end to end: user interface, APIs and database, and ships them to production.',
        required: ['JavaScript', 'React', 'Node.js', 'SQL', 'PostgreSQL', 'REST APIs', 'Git', 'Docker'],
        preferred: ['TypeScript', 'CI/CD', 'Cloud Basics', 'Unit Testing', 'System Design'],
        rounds: ['Online Assessment', 'Full Stack Machine Coding', 'Technical Interview', 'Hiring Manager Round', 'HR Round'],
        focus: 'Testing and Deployment',
        milestone: 'Add automated tests and a CI pipeline to one full-stack project.',
    },
    {
        title: 'Data Analyst',
        description: 'Turns raw data into insight with SQL, spreadsheets and dashboards, and explains the findings to business teams.',
        required: ['SQL', 'Excel', 'Python', 'Data Visualization', 'Statistics', 'Communication'],
        preferred: ['Power BI', 'Tableau', 'Pandas', 'A/B Testing'],
        rounds: ['SQL Assessment', 'Case Study Round', 'Technical Interview', 'HR Round'],
        focus: 'Statistics and Visualization',
        milestone: 'Build a dashboard from a public dataset and write up three insights.',
    },
    {
        title: 'DevOps Engineer',
        description: 'Automates build, test and deployment pipelines and keeps production infrastructure reliable and observable.',
        required: ['Linux', 'Docker', 'Git', 'CI/CD', 'Kubernetes', 'Shell Scripting', 'Cloud Basics'],
        preferred: ['Terraform', 'Monitoring', 'Python', 'Networking'],
        rounds: ['Online Assessment', 'Technical Interview (Linux & Containers)', 'Scenario Round', 'HR Round'],
        focus: 'CI/CD and Kubernetes',
        milestone: 'Set up a CI/CD pipeline that builds and deploys a Docker image.',
    },
    {
        title: 'Data Scientist',
        description: 'Builds statistical and machine learning models to answer questions and power data-driven products.',
        required: ['Python', 'Statistics', 'Machine Learning', 'Pandas', 'SQL', 'Data Visualization'],
        preferred: ['Deep Learning', 'Feature Engineering', 'Model Deployment', 'NLP'],
        rounds: ['Online Assessment', 'ML Fundamentals Interview', 'Case Study', 'HR Round'],
        focus: 'Machine Learning Fundamentals',
        milestone: 'Complete a supervised-learning project from data cleaning to evaluation.',
    },
    {
        title: 'QA Engineer',
        description: 'Designs and automates tests so that releases are reliable, and works with developers to find defects early.',
        required: ['Test Planning', 'Selenium', 'Python', 'SQL', 'Git', 'API Testing'],
        preferred: ['CI/CD', 'Performance Testing', 'JavaScript', 'Docker'],
        rounds: ['Online Assessment', 'Testing Fundamentals Interview', 'Automation Task', 'HR Round'],
        focus: 'Test Automation',
        milestone: 'Automate the regression suite of one of your projects.',
    },
];

const TARGET_COMPANY = 'ThirdEye Data';
const roleByTitle = (title) => ROLES.find((r) => key(r.title) === key(title)) || ROLES[0];

const analyse = (role, extraSkills = []) => {
    const have = new Set([...STUDENT_SKILLS, ...extraSkills].map(key));
    const split = (list) => ({ hit: list.filter((s) => have.has(key(s))), miss: list.filter((s) => !have.has(key(s))) });
    const req = split(role.required);
    const pref = split(role.preferred);
    const reqRatio = role.required.length ? req.hit.length / role.required.length : 0;
    const prefRatio = role.preferred.length ? pref.hit.length / role.preferred.length : 0;
    const match = Math.round(reqRatio * 75 + prefRatio * 25);
    return { req, pref, match };
};

const fitLevel = (pct) => (pct >= 75 ? 'High' : pct >= 50 ? 'Moderate' : 'Developing');

const buildGap = (roleTitle, company, extraSkills = []) => {
    const role = roleByTitle(roleTitle);
    const { req, pref, match } = analyse(role, extraSkills);
    const recommendations = [
        ...req.miss.slice(0, 3).map((s) => `Close the required gap in ${s}: build or extend a small project that uses it and add it to your resume.`),
        ...pref.miss.slice(0, 2).map((s) => `Pick up ${s} as a bonus skill. It separates you from similar candidates.`),
        'Practise explaining your projects out loud: interviewers for this role dig into design choices and trade-offs.',
    ];
    if (!req.miss.length) recommendations.unshift('All mandatory skills are covered. Focus on depth: system design, testing and measurable project results.');
    return {
        target_role: role.title,
        target_company: company || TARGET_COMPANY,
        role_description: role.description,
        match_percentage: match,
        required_skills_count: role.required.length,
        matched_required_count: req.hit.length,
        preferred_skills_count: role.preferred.length,
        matched_preferred_count: pref.hit.length,
        matched_skills: [...req.hit, ...pref.hit],
        missing_required: req.miss,
        missing_preferred: pref.miss,
        recommendations,
        typical_interview_rounds: role.rounds,
        career_path_advice: {
            current_fit_level: fitLevel(match),
            primary_focus_area: req.miss.length ? `${req.miss[0]} and core requirements` : role.focus,
            next_milestone: role.milestone,
        },
    };
};

/* ─── Roadmap ───────────────────────────────────── */
// [category, title, minutes, description, why recommended]
const WEEKS = [
    ['Week 1: Foundations and Baseline', [
        ['DSA', 'Arrays and strings warm-up', 60, 'Solve 5 easy array and string problems and write down the pattern behind each one.', 'Your last coding round was strongest on arrays, so this builds confidence first.'],
        ['APTITUDE', 'Quantitative aptitude: percentages and ratios', 45, 'Work through 20 timed questions on percentages, ratios and averages.', 'Aptitude carries 30% of the assessment score.'],
        ['TECHNICAL_SKILL', 'SQL joins and aggregations', 60, 'Practise inner, left and self joins with GROUP BY on a sample database.', 'SQL is a required skill for your target role.'],
        ['RESUME', 'Rewrite two resume bullets with numbers', 30, 'Add a measurable result to the two weakest experience bullets.', 'The resume analyzer flagged missing quantified achievements.'],
        ['MOCK_INTERVIEW', 'Self-introduction practice', 30, 'Record a 90-second introduction and review it for clarity and structure.', 'Every interview round starts with this question.'],
    ]],
    ['Week 2: Core Data Structures', [
        ['DSA', 'Hash maps and sets', 75, 'Solve 5 problems on frequency counting and two-sum style lookups.', 'Hash maps appear in most coding rounds.'],
        ['DSA', 'Two pointers and sliding window', 75, 'Solve 4 problems and compare the brute force and optimised approaches.', 'These patterns cut the time complexity of many array problems.'],
        ['TECHNICAL_SKILL', 'REST API design principles', 45, 'Read about resource naming, status codes and idempotency, then review your own API.', 'REST APIs are a required skill for your target role.'],
        ['APTITUDE', 'Logical reasoning: series and puzzles', 45, 'Complete a 15-question timed reasoning set.', 'Reasoning was your second-strongest aptitude area: keep it sharp.'],
        ['DSA', 'Stacks and queues', 60, 'Solve 4 problems including valid parentheses and next greater element.', 'Foundation for trees and graph traversal.'],
    ]],
    ['Week 3: Trees, Recursion and Databases', [
        ['DSA', 'Binary trees: traversals', 75, 'Implement inorder, preorder, postorder and level-order traversals.', 'Trees were the weakest topic in your last assessment.'],
        ['DSA', 'Recursion and backtracking basics', 75, 'Solve subsets, permutations and combination sum.', 'Recursion underpins tree and graph problems.'],
        ['TECHNICAL_SKILL', 'Database indexing and query plans', 60, 'Add an index to a slow query and compare the EXPLAIN output.', 'Shows depth beyond basic SQL in interviews.'],
        ['MOCK_INTERVIEW', 'Behavioural answers with the STAR method', 45, 'Prepare three stories: a challenge, a conflict and a result you drove.', 'Your interview score was lowest on structured answers.'],
        ['DSA', 'Binary search variations', 60, 'Solve 4 problems including search in rotated array.', 'Binary search is a high-frequency interview topic.'],
    ], [
        ['DSA', 'Tree problems: depth, diameter and LCA', 75, 'Solve 5 medium tree problems and explain each in two sentences.', 'Trees were the weakest topic in your last assessment.'],
        ['DSA', 'Backtracking: N-Queens and Sudoku patterns', 75, 'Work through two classic backtracking problems with pruning.', 'Builds the recursion depth interviewers probe.'],
        ['TECHNICAL_SKILL', 'Transactions and isolation levels', 60, 'Reproduce a dirty read and a lost update, then fix them.', 'Common follow-up after SQL questions.'],
        ['MOCK_INTERVIEW', 'Mock HR interview', 45, 'Take a 20-minute HR mock and review the feedback.', 'Your interview score was lowest on structured answers.'],
        ['DSA', 'Binary search on answer', 60, 'Solve 4 problems where the search space is the answer.', 'A pattern that unlocks many optimisation problems.'],
    ]],
    ['Week 4: Graphs and Dynamic Programming', [
        ['DSA', 'Graph traversal: BFS and DFS', 90, 'Implement both on an adjacency list and solve number of islands.', 'Graphs cost you the most marks in the last coding round.'],
        ['DSA', 'Dynamic programming: 1D problems', 90, 'Solve climbing stairs, house robber and coin change.', 'DP is the most common reason candidates fail onsite rounds.'],
        ['SYSTEM_DESIGN', 'Design a URL shortener', 60, 'Sketch the API, data model and how you would scale reads.', 'System design is a required skill and a gap on your resume.'],
        ['TECHNICAL_SKILL', 'Unit testing with Jest or pytest', 60, 'Write tests for two functions in one of your projects.', 'Testing is listed in the job description.'],
        ['APTITUDE', 'Data interpretation sets', 45, 'Solve two sets of tables and charts under time pressure.', 'Appears in most company aptitude rounds.'],
    ], [
        ['DSA', 'Shortest paths: Dijkstra basics', 90, 'Implement Dijkstra with a priority queue and trace one example by hand.', 'Graphs cost you the most marks in the last coding round.'],
        ['DSA', 'Dynamic programming: grids and knapsack', 90, 'Solve unique paths, 0/1 knapsack and edit distance.', 'DP is the most common reason candidates fail onsite rounds.'],
        ['SYSTEM_DESIGN', 'Design a rate limiter', 60, 'Compare fixed window and token bucket and where each lives.', 'System design is a required skill and a gap on your resume.'],
        ['TECHNICAL_SKILL', 'Integration tests for an API endpoint', 60, 'Test one endpoint against a temporary database.', 'Testing is listed in the job description.'],
        ['APTITUDE', 'Probability and permutations', 45, 'Solve 15 questions on counting and probability.', 'Appears in most company aptitude rounds.'],
    ]],
    ['Week 5: Projects, Cloud and Design', [
        ['TECHNICAL_SKILL', 'Containerise CampusConnect with Docker', 90, 'Write a Dockerfile and a compose file for the app and its database.', 'Closes your Docker/CI-CD gap and strengthens a resume project.'],
        ['TECHNICAL_SKILL', 'Set up a CI pipeline', 75, 'Run tests and build the image on every push using GitHub Actions.', 'CI/CD is a preferred skill for your target role.'],
        ['SYSTEM_DESIGN', 'Design a chat application', 75, 'Cover websockets, message storage and delivery guarantees.', 'A frequent system design prompt for junior roles.'],
        ['RESUME', 'Add GitHub and LinkedIn links', 20, 'Add both links to the contact line and pin your best repositories.', 'The resume analyzer flagged missing profile links.'],
        ['MOCK_INTERVIEW', 'Technical mock interview', 45, 'Take a technical mock and review the feedback.', 'Practise under realistic conditions before the drive.'],
    ]],
    ['Week 6: Placement Simulation and Polish', [
        ['MOCK_INTERVIEW', 'Full placement simulation', 120, 'Take the 4-round placement simulation without pausing.', 'Tests the full process in one sitting.'],
        ['DSA', 'Revise your mistake log', 60, 'Re-solve the 8 problems you got wrong during the plan.', 'Spaced repetition on weak areas.'],
        ['SYSTEM_DESIGN', 'Review trade-off vocabulary', 45, 'Write one paragraph each on consistency, availability and caching trade-offs.', 'Gives you language for design discussions.'],
        ['RESUME', 'Final resume pass', 45, 'Format the resume with the formatter and re-run the analyzer.', 'Target an ATS score above 85.'],
        ['MOCK_INTERVIEW', 'HR round rehearsal', 45, 'Rehearse salary, relocation and strengths-and-weaknesses answers.', 'The last round is often decided on communication.'],
    ]],
];

const TOTAL_WEEKS = WEEKS.length;
const DONE_THROUGH = 14;                       // the first 14 tasks (weeks 1-2 and four of week 3) start completed
const IN_PROGRESS_INDEX = 14;                  // the next one is under way

let roadmapTarget = 'Software Engineer';
let revision = 0;
const statusOf = new Map();                    // task id -> status

const taskId = (w, d) => 1000 + (w - 1) * 10 + d;
const flat = () => WEEKS.flatMap((week, wi) => week[1].map((_, di) => ({ week: wi + 1, day: di + 1, id: taskId(wi + 1, di + 1) })));
flat().forEach((t, i) => statusOf.set(t.id, i < DONE_THROUGH ? 'COMPLETED' : i === IN_PROGRESS_INDEX ? 'IN_PROGRESS' : 'PENDING'));

const buildRoadmap = () => {
    const weeks = WEEKS.map(([title, tasks, alt], wi) => {
        const weekNo = wi + 1;
        const built = tasks.map((base, di) => {
            const id = taskId(weekNo, di + 1);
            const status = statusOf.get(id);
            // A regenerated plan swaps the tasks that are not done yet for the alternate version; completed work is never changed
            const use = revision % 2 === 1 && alt && status !== 'COMPLETED' ? alt[di] : base;
            const [category, name, minutes, description, why] = use;
            return {
                id, day_number: wi * 5 + di + 1, category, title: name, estimated_minutes: minutes, description, why_recommended: why, status,
            };
        });
        return {
            week_number: weekNo, title,
            completed_count: built.filter((t) => t.status === 'COMPLETED').length, total_count: built.length, tasks: built,
        };
    });
    const total = weeks.reduce((n, w) => n + w.total_count, 0);
    const done = weeks.reduce((n, w) => n + w.completed_count, 0);
    const current = (weeks.find((w) => w.completed_count < w.total_count) || weeks[weeks.length - 1]).week_number;
    return {
        id: 1,
        title: `${TOTAL_WEEKS}-Week ${roadmapTarget} Placement Plan`,
        target_role: roadmapTarget,
        total_weeks: TOTAL_WEEKS,
        current_week: current,
        total_tasks: total,
        completed_tasks: done,
        completion_rate: total ? Math.round((done / total) * 100) : 0,
        weeks,
    };
};

const failure = (status, detail) => Object.assign(new Error(detail), { response: { status, data: { detail } } });

/* ─── Handlers ──────────────────────────────────── */
export default {
    getTargetRoles: () => ROLES.map(({ title, description }) => ({ title, description })),

    getSkillGap: () => buildGap('Software Engineer', TARGET_COMPANY),

    simulateSkillGap: (targetRole, targetCompany = null, additionalSkills = []) => {
        const extra = (additionalSkills || []).map(clean).filter(Boolean);
        return buildGap(targetRole, targetCompany, extra);
    },

    getCareerPaths: () => {
        const fits = ROLES.map((role) => {
            const { match } = analyse(role);
            return { role: role.title, match_percentage: match, fit_level: fitLevel(match), is_current_target: role.title === 'Software Engineer' };
        }).sort((a, b) => b.match_percentage - a.match_percentage);
        return { current_target: 'Software Engineer', all_role_fits: fits };
    },

    getRoadmap: () => buildRoadmap(),

    generateRoadmap: (targetRole = null, regenerate = false) => {
        if (targetRole) roadmapTarget = roleByTitle(targetRole).title;
        if (regenerate) revision += 1;
        return buildRoadmap();
    },

    updateDailyTaskStatus: (id, status) => {
        const numeric = Number(id);
        if (!statusOf.has(numeric)) throw failure(404, 'Task not found.');
        if (!['PENDING', 'IN_PROGRESS', 'COMPLETED'].includes(status)) throw failure(400, 'Invalid task status.');
        statusOf.set(numeric, status);
        const task = buildRoadmap().weeks.flatMap((w) => w.tasks).find((t) => t.id === numeric);
        return task;
    },
};
