// Offline stand-in for studentApi, used only while the browser is on a Student Dashboard Demo route (see utils/studentDemo.js).
// Nothing here touches the network, so the demo costs no API or AI calls. Methods the demo does not cover reject with a clear message.

import {
    DEMO_STUDENT, DEMO_DASHBOARD, DEMO_UNIFIED, DEMO_ONBOARDING, DEMO_ASSESSMENT_HISTORY, DEMO_PERFORMANCE_DASHBOARD,
    demoPerformanceHistory, demoPerformanceDetail, DEMO_RESUME_ANALYSIS, DEMO_JD_ANALYSIS, DEMO_FORMATTED_RESUME,
} from './studentDemoData.js';
import skillGapRoadmap from './demo/skillGapRoadmap.js';
import practiceCoding from './demo/practiceCoding.js';
import interviewSimulation from './demo/interviewSimulation.js';
import projectsProfile from './demo/projectsProfile.js';

const SIMULATED_WORK_MS = 700;      // a short pause so "Analyze" / "Generate" feel like they did something
const later = (value, ms = 0) => new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), ms));

const base = {
    async logout() {},

    getProfile: () => later({ ...DEMO_STUDENT }),

    getDashboard: () => later(DEMO_DASHBOARD),
    getUnifiedDashboard: () => later(DEMO_UNIFIED),
    getOnboardingStatus: () => later(DEMO_ONBOARDING),
    getAssessmentHistory: () => later(DEMO_ASSESSMENT_HISTORY),
    getReadiness: () => later({ readiness_score: DEMO_DASHBOARD.readiness_score, breakdown: DEMO_DASHBOARD.readiness_breakdown }),

    getPerformanceDashboard: () => later(DEMO_PERFORMANCE_DASHBOARD),
    getPerformanceHistory: (params) => later(demoPerformanceHistory(params)),
    getPerformanceAssessmentDetail: (category, id) => later(demoPerformanceDetail(category, id)),

    // Resume Analyzer / Formatter: always the same sample resume and sample results, whatever file is chosen
    getResume: () => later(DEMO_RESUME_ANALYSIS),
    uploadResume: () => later({ version: DEMO_RESUME_ANALYSIS.version }, SIMULATED_WORK_MS),
    analyzeResumeWithJd: () => later(DEMO_JD_ANALYSIS, SIMULATED_WORK_MS),
    formatResume: () => later(DEMO_FORMATTED_RESUME, SIMULATED_WORK_MS),
};

// Per-page handlers (services/demo/*.js) answer from sample data and keep their own in-memory state, so a student can click through
// every page: start an interview, tick a roadmap task, add a project. Each result is cloned so callers can never edit the sample data.
const pageHandlers = { ...skillGapRoadmap, ...practiceCoding, ...interviewSimulation, ...projectsProfile };
const wrap = (fn) => (...args) => Promise.resolve().then(() => fn(...args)).then((v) => (v === undefined ? v : structuredClone(v)));

export const demoStudentApi = { ...base, ...Object.fromEntries(Object.entries(pageHandlers).map(([k, fn]) => [k, wrap(fn)])) };

/** What every other studentApi method does in the demo: no request, a readable error the page shows in its own error state. */
export const demoUnavailable = (name) => () => Promise.reject(Object.assign(
    new Error(`${name} is not part of the demo`),
    { response: { status: 404, data: { detail: 'This feature is not part of the demo.' } } },
));
