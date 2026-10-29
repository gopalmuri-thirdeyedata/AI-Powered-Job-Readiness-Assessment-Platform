// Student Dashboard Demo: Mock Interview and Placement Simulation (pages/student/StudentMockInterview.jsx, StudentPlacementSimulation.jsx).
// Offline stand-ins for the studentApi methods those pages call. No AI, no network: questions and feedback are a fixed script, scores come from a
// simple rule on the answer (length, STAR / design keywords, a code shape check). State lives in this module, so a whole interview or placement
// drive can be walked through, and the finished one then shows up in "Past Sessions" / "Past Drives". A page reload starts the sample again.
// Not defined here on purpose: getTargetRoles / getProfile (shared with the other demo pages; both pages fall back to a default role list).

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();
const fail = (status, detail) => Object.assign(new Error(detail), { response: { status, data: { detail } } });
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(v)));
const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
const words = (text) => String(text || '').trim().split(/\s+/).filter(Boolean).length;
const hasAny = (text, patterns) => patterns.filter((re) => re.test(text)).length;

const DEMO_ROLE = 'Software Engineer';

/* ─── Mock Interview ───────────────────────────────────────────────────────── */

const QUESTIONS = {
    TECHNICAL: (role) => [
        `Walk me through how you would design the data model and REST API for a small ${role} project such as an event-booking app. What would you index and why?`,
        'A page that lists records has become slow as the table grew to a few million rows. How would you find the cause and fix it?',
        'Explain the difference between a process and a thread, and describe a bug that can happen when two threads share mutable state.',
        'Imagine your service depends on a third-party API that sometimes times out. How would you make your service resilient?',
    ],
    HR: () => [
        'Tell me about a time you worked in a team and disagreed with a teammate. What did you do and what was the outcome?',
        'Describe a project where you had to learn something new quickly. How did you approach it?',
        'Tell me about a deadline you were at risk of missing. What actions did you take?',
        'Where do you see yourself in three years, and how does this role help you get there?',
    ],
    MIXED: (role) => [
        `Why did you choose a career as a ${role}, and which project are you proudest of?`,
        'How would you debug an API endpoint that returns correct data locally but intermittently fails in production?',
        'Tell me about a time you received critical feedback on your work. How did you respond?',
        'How do you decide between building something quickly and building it to last?',
    ],
};

// One coaching note per turn, so every answer gets different feedback. {strong} is used when the answer scored well, {weak} when it was thin.
const COACHING = {
    TECHNICAL: [
        { strong: 'Good structure: you named the entities, the relationships and the main endpoints before going into detail.', weak: 'Start with the entities and their relationships, then list the endpoints. A clear order is easier to follow.',
          strengths: ['Named concrete entities and endpoints', 'Linked the design to a real use case'], improvements: ['Say which columns you would index and the query each index serves', 'Mention validation and error responses'] },
        { strong: 'You approached it like an engineer: measure first, then change one thing at a time.', weak: 'Begin by measuring (query plan, slow-query log) before proposing a fix, so the fix is tied to evidence.',
          strengths: ['Looked at evidence before changing anything', 'Considered more than one fix'], improvements: ['Quantify the improvement you would expect', 'Cover caching and pagination trade-offs'] },
        { strong: 'Clear explanation, and the shared-counter example showed you understand race conditions.', weak: 'Define both terms first (a process has its own memory, threads share it), then give one concrete bug such as a lost update.',
          strengths: ['Correct core definitions', 'Gave a concrete example of a race condition'], improvements: ['Name a fix: locks, atomic operations or immutable data', 'Mention deadlock as a second risk'] },
        { strong: 'Strong answer: timeouts, retries with backoff and a fallback show good production thinking.', weak: 'Add the basics: a timeout on every call, limited retries with backoff, and a fallback when the dependency stays down.',
          strengths: ['Thought about failure as a normal case', 'Mentioned retries and fallbacks'], improvements: ['Explain how a circuit breaker stops repeated failures', 'Say how you would monitor the dependency'] },
    ],
    HR: [
        { strong: 'Good use of STAR: a clear situation, your action and a result that shows teamwork.', weak: 'Use the STAR order: Situation, Task, Action, Result. Finish with what changed because of your action.',
          strengths: ['Stayed professional about the disagreement', 'Ended with a concrete outcome'], improvements: ['Describe your own action in more detail', 'State what you learned'] },
        { strong: 'Nice answer: a clear learning plan and proof that you applied it.', weak: 'Show how you learned (docs, small prototype, asking a mentor) and what you built with it.',
          strengths: ['Showed initiative', 'Applied the learning to real work'], improvements: ['Add a measurable result', 'Say how long it took you to become productive'] },
        { strong: 'You took ownership and communicated early, which is what interviewers look for.', weak: 'Explain what you did first, who you told, and how you reprioritised. Avoid only describing the pressure.',
          strengths: ['Took ownership of the delay', 'Communicated with the team'], improvements: ['Give the final result with numbers or dates', 'Say what you would do earlier next time'] },
        { strong: 'Realistic and specific goals that connect to the role.', weak: 'Make the goals specific: skills you want to gain and the kind of work you want to own, tied to this role.',
          strengths: ['Goals link to the role', 'Showed motivation to grow'], improvements: ['Name one skill and how you will build it', 'Avoid generic answers about "growth"'] },
    ],
    MIXED: [
        { strong: 'Genuine motivation, and the project example gave the answer substance.', weak: 'Give one reason you chose this career, then one project with what you built and what you learned.',
          strengths: ['Clear personal motivation', 'Picked a relevant project'], improvements: ['State your specific contribution', 'Mention the technologies and why you chose them'] },
        { strong: 'A methodical approach: logs, comparing environments and narrowing the cause.', weak: 'Work from evidence: check logs and metrics, compare environments, then narrow down the cause.',
          strengths: ['Systematic debugging steps', 'Considered environment differences'], improvements: ['Mention reproducing the failure with a test', 'Explain how you would prevent it from recurring'] },
        { strong: 'Mature answer: you listened, acted on the feedback and showed the improvement.', weak: 'Describe the feedback, what you changed, and how the next piece of work was better.',
          strengths: ['Open to feedback', 'Showed a change in behaviour'], improvements: ['Give the specific feedback you received', 'Quantify the improvement'] },
        { strong: 'Balanced view: you explained when speed matters and when maintainability matters.', weak: 'Give a rule of thumb (prototype fast, harden what survives) and one example of each.',
          strengths: ['Weighed both sides', 'Linked the choice to the situation'], improvements: ['Add a real example from your projects', 'Mention technical debt and how to repay it'] },
    ],
};

const STAR_WORDS = [/\bsituation\b/i, /\btask\b/i, /\baction\b|\bI (built|led|wrote|decided|fixed|created|implemented|designed)\b/i, /\bresult\b|\boutcome\b|\bas a result\b|\bimproved\b|\breduced\b|\bincreased\b/i];
const TECH_WORDS = [/\bindex\b|\bcache\b|\bcaching\b/i, /\btimeout\b|\bretry\b|\bbackoff\b|\bfallback\b/i, /\bdatabase\b|\bquery\b|\bSQL\b/i, /\bAPI\b|\bendpoint\b/i, /\bthread\b|\block\b|\brace\b|\batomic\b/i, /\bscal(e|able|ability)\b|\blatency\b|\bmetric/i];

const scoreAnswer = (answer, turnNumber) => {
    const n = words(answer);
    const length = Math.min(n, 70) * 0.45;                              // up to ~31 points for a developed answer
    const star = hasAny(answer, STAR_WORDS);
    const tech = hasAny(answer, TECH_WORDS);
    const wobble = ((turnNumber * 7) % 5) - 2;                          // small deterministic variation per question
    const score = clamp(40 + length + star * 4 + tech * 3 + wobble, 25, 96);
    return {
        score,
        star: clamp(34 + Math.min(n, 60) * 0.4 + star * 8 + wobble, 20, 96),
        technical: clamp(score - 6 + tech * 3, 20, 96),
    };
};

const summaryFor = (overall, star) => {
    if (overall >= 75) return `Strong session. Your answers were clear and well structured (STAR ${star}%). Keep adding concrete numbers to your results to make them even more convincing.`;
    if (overall >= 55) return `A solid attempt with room to grow. Your answers had the right ideas; tighten the structure (Situation, Task, Action, Result) and finish each answer with a measurable outcome. STAR structure: ${star}%.`;
    return `A useful first practice session. Try fuller answers (60 to 120 words each) and follow the STAR order. Re-run the session after reviewing the coach notes below. STAR structure: ${star}%.`;
};

let interviewSeq = 3;
let turnSeq = 100;
const interviews = [];

const pastTurns = (type, role, rows) => QUESTIONS[type](role).map((question_text, i) => ({
    id: ++turnSeq, turn_number: i + 1, question_text, student_response: rows[i].answer,
    feedback: COACHING[type][i].strong, turn_score: rows[i].score, star_score: rows[i].star,
}));

const seedInterview = (id, type, role, daysBack, overall, star, tech, rows) => interviews.push({
    id, interview_type: type, target_role: role, status: 'COMPLETED', created_at: daysAgo(daysBack),
    overall_score: overall, star_structure_score: star, technical_accuracy_score: tech, feedback_summary: summaryFor(overall, star),
    turns: pastTurns(type, role, rows),
});

seedInterview(2, 'TECHNICAL', DEMO_ROLE, 24, 68, 64, 71, [
    { score: 71, star: 66, answer: 'I would model users, events and bookings as three tables with foreign keys, expose REST endpoints for each, and index the booking lookup by event and user because that is the most frequent query.' },
    { score: 66, star: 62, answer: 'I would check the query plan and the slow query log first, then add a composite index and paginate the list so the page only loads what it shows.' },
    { score: 64, star: 60, answer: 'A process has its own memory while threads share memory, so two threads updating one counter can lose an update unless I use a lock or an atomic operation.' },
    { score: 71, star: 68, answer: 'I would set a timeout on every call, retry a limited number of times with backoff and return cached data as a fallback if the API stays down.' },
]);
seedInterview(1, 'HR', DEMO_ROLE, 31, 72, 75, 66, [
    { score: 74, star: 78, answer: 'In our final-year project a teammate and I disagreed on the framework. I proposed a one-day spike for each, we compared results together and chose the simpler option, which saved us a week.' },
    { score: 70, star: 72, answer: 'During my internship I had to learn a reporting library in three days. I read the docs, built a small prototype and then shipped the real report, which the team started using that month.' },
    { score: 69, star: 73, answer: 'We were close to missing a demo deadline, so I told the team early, cut two low-value features and finished the core flow on time with a short list of follow-ups.' },
    { score: 75, star: 77, answer: 'In three years I want to own a backend service end to end, and this role would give me production experience and mentoring to reach that.' },
]);

const interviewById = (id) => interviews.find((i) => String(i.id) === String(id));
const nextOpenTurn = (interview) => interview.turns.find((t) => t.student_response === null);

const startNextTurn = (interview) => {
    const n = interview.turns.length;
    const q = QUESTIONS[interview.interview_type](interview.target_role)[n];
    if (!q) return;
    interview.turns.push({ id: ++turnSeq, turn_number: n + 1, question_text: q, student_response: null, feedback: null, turn_score: null, star_score: null });
};

const finalizeInterview = (interview) => {
    interview.turns = interview.turns.filter((t) => t.student_response !== null);        // an unanswered question is not part of the report
    const answered = interview.turns;
    interview.overall_score = answered.length ? clamp(avg(answered.map((t) => t.turn_score))) : 0;
    interview.star_structure_score = answered.length ? clamp(avg(answered.map((t) => t.star_score))) : 0;
    interview.technical_accuracy_score = answered.length ? clamp(avg(answered.map((t) => t.technical_score ?? t.turn_score - 4))) : 0;
    interview.feedback_summary = answered.length
        ? summaryFor(interview.overall_score, interview.star_structure_score)
        : 'The session ended before any question was answered. Start a new session and answer at least one question to get a scorecard.';
    interview.status = 'COMPLETED';
    interview.completed_at = new Date().toISOString();
};

/* ─── Placement Simulation ─────────────────────────────────────────────────── */

const APTITUDE = [
    { id: 'apt-1', question: 'A train 150 m long passes a pole in 15 seconds. What is its speed?', correct: 'B',
      options: [['A', '8 m/s'], ['B', '10 m/s'], ['C', '12 m/s'], ['D', '15 m/s']] },
    { id: 'apt-2', question: 'If 6 workers finish a job in 12 days, how many days will 9 workers take at the same rate?', correct: 'C',
      options: [['A', '6 days'], ['B', '7 days'], ['C', '8 days'], ['D', '9 days']] },
    { id: 'apt-3', question: 'What comes next in the series 2, 6, 12, 20, 30, ...?', correct: 'D',
      options: [['A', '36'], ['B', '40'], ['C', '38'], ['D', '42']] },
    { id: 'apt-4', question: 'A shopkeeper marks an item 25% above cost and gives a 20% discount. What is the profit percentage?', correct: 'A',
      options: [['A', '0%'], ['B', '5%'], ['C', '10%'], ['D', '25%']] },
    { id: 'apt-5', question: 'All engineers in a team are good at maths. Some good at maths are also good at music. Which statement must be true?', correct: 'B',
      options: [['A', 'All engineers are good at music'], ['B', 'No conclusion about engineers and music follows'], ['C', 'No engineer is good at music'], ['D', 'All musicians are engineers']] },
];

const CODING = {
    title: 'Two Sum',
    description: 'Given a list of integers nums and an integer target, return the indices of the two numbers that add up to target. Each input has exactly one solution and you may not use the same element twice. Aim for better than O(n^2).',
    public_test_cases: [
        { input: 'nums = [2, 7, 11, 15], target = 9', expected_output: '[0, 1]' },
        { input: 'nums = [3, 2, 4], target = 6', expected_output: '[1, 2]' },
    ],
};

const TECH_QUESTION = (role) => `Design a URL shortener that serves 10 million redirects a day. As a ${role}, explain the main components, the database schema, how you would cache hot links and how the system stays available if one server fails.`;
const HR_QUESTION = 'Tell me about a time you took ownership of something that was not part of your job. What did you do, and what was the result?';

const scoreCode = (code) => {
    const text = String(code || '');
    const body = text.replace(/#.*$/gm, '').trim();
    if (!/def\s+\w+\s*\(/.test(body) || !/\breturn\b/.test(body)) return { score: body.length > 20 ? 25 : 0, note: 'No function that returns a result.' };
    const loops = (body.match(/\bfor\b|\bwhile\b/g) || []).length;
    const usesMap = /\{\}|dict\(|\bset\(|lookup|seen|hash/i.test(body);
    if (usesMap && loops >= 1) return { score: 100, note: 'Hash map solution, O(n).' };
    if (loops >= 2) return { score: 70, note: 'Correct idea with nested loops, O(n^2). A hash map would be faster.' };
    return { score: 45, note: 'The function returns, but the logic looks incomplete.' };
};

const scoreWritten = (answer, keywords) => {
    const n = words(answer);
    return clamp(35 + Math.min(n, 90) * 0.4 + hasAny(String(answer || ''), keywords) * 5, 20, 96);
};
const DESIGN_WORDS = [/\bcache\b|\bredis\b/i, /\bdatabase\b|\bschema\b|\bSQL\b|\bNoSQL\b/i, /\bhash\b|\bbase62\b|\bencode\b/i, /\bload balanc/i, /\breplica\b|\bshard|\bpartition/i, /\bavailab|\bfailover\b|\bredundan/i];

const simulationSummary = (sim) => {
    const rows = [['aptitude', sim.aptitude_score], ['coding', sim.coding_score], ['technical interview', sim.technical_interview_score], ['HR interview', sim.hr_interview_score]];
    const best = rows.reduce((a, b) => (b[1] > a[1] ? b : a));
    const weakest = rows.reduce((a, b) => (b[1] < a[1] ? b : a));
    return `Overall drive score ${sim.overall_score}%. Your strongest round was ${best[0]} (${best[1]}%); the weakest was ${weakest[0]} (${weakest[1]}%). Spend your next practice block on ${weakest[0]} and run another drive in a week to see the change.`;
};

const buildRounds = (role, currentRound, scores = {}) => {
    const defs = [
        { round_number: 1, round_type: 'APTITUDE', round_data: { questions: APTITUDE.map((q) => ({ id: q.id, question: q.question, options: q.options.map(([key, text]) => ({ key, text })) })) } },
        { round_number: 2, round_type: 'CODING', round_data: { ...CODING } },
        { round_number: 3, round_type: 'TECHNICAL_INTERVIEW', round_data: { question: TECH_QUESTION(role) } },
        { round_number: 4, round_type: 'HR_INTERVIEW', round_data: { question: HR_QUESTION } },
    ];
    return defs.map((d) => ({
        ...d,
        status: scores[d.round_number] !== undefined ? 'COMPLETED' : d.round_number === currentRound ? 'IN_PROGRESS' : 'PENDING',
        score: scores[d.round_number] ?? null,
    }));
};

let simulationSeq = 2;
const simulations = [];

const seedSimulation = () => {
    const sim = {
        id: 1, target_role: DEMO_ROLE, status: 'COMPLETED', current_round: 4, created_at: daysAgo(9),
        aptitude_score: 78, coding_score: 69, technical_interview_score: 66, hr_interview_score: 72,
    };
    sim.overall_score = clamp(sim.aptitude_score * 0.2 + sim.coding_score * 0.35 + sim.technical_interview_score * 0.25 + sim.hr_interview_score * 0.2);
    sim.report_summary = simulationSummary(sim);
    sim.rounds = buildRounds(sim.target_role, 4, { 1: 78, 2: 69, 3: 66, 4: 72 });
    simulations.push(sim);
};
seedSimulation();

const simulationById = (id) => simulations.find((s) => String(s.id) === String(id));
const activeSimulation = () => simulations.find((s) => s.status === 'IN_PROGRESS') || null;

const SCORE_FIELD = { 1: 'aptitude_score', 2: 'coding_score', 3: 'technical_interview_score', 4: 'hr_interview_score' };

/* ─── studentApi handlers ──────────────────────────────────────────────────── */

export default {
    // Mock interview
    startMockInterview: (interviewType = 'TECHNICAL', targetRole = null) => {
        const type = QUESTIONS[interviewType] ? interviewType : 'TECHNICAL';
        const interview = {
            id: interviewSeq++, interview_type: type, target_role: targetRole || DEMO_ROLE, status: 'IN_PROGRESS', created_at: new Date().toISOString(),
            overall_score: 0, star_structure_score: 0, technical_accuracy_score: 0, feedback_summary: null, turns: [],
        };
        startNextTurn(interview);
        interviews.push(interview);
        return interview;
    },

    submitMockInterviewTurn: (interviewId, studentResponse) => {
        const interview = interviewById(interviewId);
        if (!interview) throw fail(404, 'Interview session not found.');
        if (interview.status === 'COMPLETED') throw fail(400, 'This interview is already completed.');
        const turn = nextOpenTurn(interview);
        if (!turn) throw fail(400, 'There is no open question in this interview.');
        const text = String(studentResponse || '').trim();
        if (!text) throw fail(400, 'Please write an answer before submitting.');

        const { score, star, technical } = scoreAnswer(text, turn.turn_number);
        const notes = COACHING[interview.interview_type][turn.turn_number - 1];
        const feedback = score >= 62 ? notes.strong : notes.weak;
        const isFinished = turn.turn_number >= 4;
        Object.assign(turn, { student_response: text, feedback, turn_score: score, star_score: star, technical_score: technical });
        if (isFinished) finalizeInterview(interview); else startNextTurn(interview);
        return {
            turn_number: turn.turn_number, score, star_score: star, feedback,
            strengths: notes.strengths, improvements: notes.improvements, is_finished: isFinished,
        };
    },

    completeMockInterview: (interviewId) => {
        const interview = interviewById(interviewId);
        if (!interview) throw fail(404, 'Interview session not found.');
        if (interview.status !== 'COMPLETED') finalizeInterview(interview);
        return interview;
    },

    getMockInterviewHistory: () => [...interviews]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .map(({ id, interview_type, target_role, status, overall_score, created_at }) => ({ id, interview_type, target_role, status, overall_score, created_at })),

    getMockInterviewDetail: (interviewId) => {
        const interview = interviewById(interviewId);
        if (!interview) throw fail(404, 'Interview session not found.');
        return interview;
    },

    // Placement simulation
    getActiveSimulation: () => activeSimulation(),

    startSimulation: (targetRole = null) => {
        const old = activeSimulation();
        if (old) simulations.splice(simulations.indexOf(old), 1);          // a new drive replaces an unfinished one
        const sim = {
            id: simulationSeq++, target_role: targetRole || DEMO_ROLE, status: 'IN_PROGRESS', current_round: 1, created_at: new Date().toISOString(),
            aptitude_score: 0, coding_score: 0, technical_interview_score: 0, hr_interview_score: 0, overall_score: 0, report_summary: null,
        };
        sim.rounds = buildRounds(sim.target_role, 1);
        simulations.push(sim);
        return sim;
    },

    submitSimulationRound: (simulationId, roundNumber, payload = {}) => {
        const sim = simulationById(simulationId);
        if (!sim) throw fail(404, 'Simulation not found.');
        if (sim.status === 'COMPLETED') throw fail(400, 'This drive is already completed.');
        if (Number(roundNumber) !== sim.current_round) throw fail(400, `Round ${sim.current_round} is the current round.`);

        let score;
        if (roundNumber === 1) {
            const answers = payload.answers || {};
            score = clamp((APTITUDE.filter((q) => answers[q.id] === q.correct).length / APTITUDE.length) * 100);
        } else if (roundNumber === 2) {
            score = scoreCode(payload.code).score;
        } else if (roundNumber === 3) {
            score = scoreWritten(payload.response, DESIGN_WORDS);
        } else {
            score = scoreWritten(payload.response, STAR_WORDS);
        }
        sim[SCORE_FIELD[roundNumber]] = score;
        const done = Object.fromEntries(sim.rounds.filter((r) => r.score !== null).map((r) => [r.round_number, r.score]));
        done[roundNumber] = score;

        const finished = roundNumber >= 4;
        if (finished) {
            sim.status = 'COMPLETED';
            sim.overall_score = clamp(sim.aptitude_score * 0.2 + sim.coding_score * 0.35 + sim.technical_interview_score * 0.25 + sim.hr_interview_score * 0.2);
            sim.report_summary = simulationSummary(sim);
        } else {
            sim.current_round = roundNumber + 1;
        }
        sim.rounds = buildRounds(sim.target_role, sim.current_round, done);
        return { round_number: roundNumber, round_score: score, is_simulation_finished: finished, next_round: finished ? null : roundNumber + 1 };
    },

    getSimulation: (simulationId) => {
        const sim = simulationById(simulationId);
        if (!sim) throw fail(404, 'Simulation not found.');
        return sim;
    },

    getSimulationHistory: () => [...simulations]
        .filter((s) => s.status === 'COMPLETED')
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .map(({ rounds, ...summary }) => summary),
};
