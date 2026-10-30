// Student Dashboard Demo (admin sidebar -> "Student Dashboard Demo").
//
// The demo shows the student pages filled with sample data. It never calls the API: while the browser is on a demo
// route, services/studentApi.js answers from services/studentDemoData.js instead of the network. The decision is made
// from the URL on every call (not from React state), so a child page's first effect cannot run before the flag is set.

export const STUDENT_DEMO_BASE = '/admin/student-demo';

export const isStudentDemoPath = (pathname) => pathname === STUDENT_DEMO_BASE || pathname.startsWith(`${STUDENT_DEMO_BASE}/`);

export const isStudentDemo = () => typeof window !== 'undefined' && isStudentDemoPath(window.location.pathname);

// The student pages that run in the demo. A real student link (/student/<page>) maps to /admin/student-demo/<page>.
export const DEMO_PAGES = ['skill-gap', 'roadmap', 'practice', 'coding', 'interview', 'projects', 'resume', 'resume-formatter', 'profile'];
const DASHBOARD_ALIASES = ['/student', '/student/dashboard', '/student/performance'];

/** The demo route for a real student link, or null when that page is not part of the demo. */
export const demoPathFor = (href) => {
    const text = String(href || '');
    const cut = text.search(/[?#]/);
    const path = (cut === -1 ? text : text.slice(0, cut)).replace(/\/+$/, '') || '/';
    const suffix = cut === -1 ? '' : text.slice(cut);
    if (DASHBOARD_ALIASES.includes(path)) return `${STUDENT_DEMO_BASE}${suffix}`;
    const m = path.match(/^\/student(?:\/hub)?\/([a-z-]+)(\/[^/]+)?$/);
    if (!m || !DEMO_PAGES.includes(m[1])) return null;
    if (m[2] && m[1] !== 'coding') return null;                       // only a coding problem has a sub-route
    return `${STUDENT_DEMO_BASE}/${m[1]}${m[2] || ''}${suffix}`;
};
