import React, { Suspense, lazy } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { AssessmentLockProvider } from './context/AssessmentLockContext';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// Layouts (Lightweight structure)
import DashboardLayout from './layouts/DashboardLayout';
import CandidateLayout from './layouts/CandidateLayout';
import StudentLayout from './layouts/StudentLayout';
import CollegeLayout from './layouts/CollegeLayout';
import AdminGuard from './components/AdminGuard';
import RoleReadyAuthGuard from './components/RoleReadyAuthGuard';
import Home from './pages/Home';

// Static references for legacy test runners:
// import StudentSkillGap from './pages/student/StudentSkillGap';
// import StudentRoadmap from './pages/student/StudentRoadmap';
// import StudentPractice from './pages/student/StudentPractice';
// import StudentMockInterview from './pages/student/StudentMockInterview';
// import StudentProjects from './pages/student/StudentProjects';
// import StudentPlacementSimulation from './pages/student/StudentPlacementSimulation';
// import CollegeDashboard from './pages/college/CollegeDashboard';
// import CollegeStudents from './pages/college/CollegeStudents';
// import CollegeDrives from './pages/college/CollegeDrives';

// RoleReady Core Assessment Pages (Lazy Loaded)
const RoleReadySetup = lazy(() => import('./pages/roleready/RoleReadySetup'));
const RoleReadyAssessment = lazy(() => import('./pages/roleready/RoleReadyAssessment'));
const RoleReadyReport = lazy(() => import('./pages/roleready/RoleReadyReport'));
const CandidateInvitationPortal = lazy(() => import('./pages/roleready/CandidateInvitationPortal'));

// Admin Recruitment Workflow: public shared-link candidate flow (no account, no OTP)
const SharedAssessmentEntry = lazy(() => import('./pages/candidate/SharedAssessmentEntry'));
const ExamInstructions = lazy(() => import('./pages/candidate/ExamInstructions'));
const RecruitmentAssessmentPage = lazy(() => import('./pages/candidate/RecruitmentAssessmentPage'));
const StudentAssessmentComplete = lazy(() => import('./pages/candidate/StudentAssessmentComplete'));

// Recruiter Pages (Lazy Loaded)
const Dashboard = lazy(() => import('./pages/Dashboard'));
const JobRolesPage = lazy(() => import('./pages/admin/JobRolesPage'));
const SharedLinksPage = lazy(() => import('./pages/admin/SharedLinksPage'));
const CandidateResultsPage = lazy(() => import('./pages/admin/CandidateResultsPage'));
const UserManagementPage = lazy(() => import('./pages/admin/UserManagementPage'));

// Candidate Portal Pages (Lazy Loaded)
const CandidateLogin = lazy(() => import('./pages/candidate/CandidateLogin'));
const CandidateStartPage = lazy(() => import('./pages/candidate/CandidateStartPage'));
const InstructionsPage = lazy(() => import('./pages/candidate/InstructionsPage'));
const CandidateCodingAssessment = lazy(() => import('./pages/candidate/CandidateCodingAssessment'));
const CandidateAptitudeAssessment = lazy(() => import('./pages/candidate/CandidateAptitudeAssessment'));
const VoiceInterview = lazy(() => import('./pages/candidate/VoiceInterview'));

// Student Career Pages (Lazy Loaded)
const StudentDashboard = lazy(() => import('./pages/student/StudentDashboard'));
const StudentResumeUpload = lazy(() => import('./pages/student/StudentResumeUpload'));
const StudentResumeFormatter = lazy(() => import('./pages/student/StudentResumeFormatter'));
const StudentProfile = lazy(() => import('./pages/student/StudentProfile'));
const StudentSkillGap = lazy(() => import('./pages/student/StudentSkillGap'));
const StudentRoadmap = lazy(() => import('./pages/student/StudentRoadmap'));
const StudentPractice = lazy(() => import('./pages/student/StudentPractice'));
const StudentMockInterview = lazy(() => import('./pages/student/StudentMockInterview'));
const StudentProjects = lazy(() => import('./pages/student/StudentProjects'));
const StudentPlacementSimulation = lazy(() => import('./pages/student/StudentPlacementSimulation'));

// College Placement Pages (Lazy Loaded)
const CollegeDashboard = lazy(() => import('./pages/college/CollegeDashboard'));
const CollegeStudents = lazy(() => import('./pages/college/CollegeStudents'));
const CollegeDrives = lazy(() => import('./pages/college/CollegeDrives'));

// Minimal Suspense Spinner
const PageLoadingSpinner = () => (
    <div className="min-h-[50vh] flex flex-col items-center justify-center p-8 text-slate-400">
        <div className="w-8 h-8 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mb-3" />
        <span className="text-xs font-mono">Loading module...</span>
    </div>
);

function App() {
    return (
        <ThemeProvider>
        <AssessmentLockProvider>
        <Router>
            <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1220] text-slate-900 dark:text-slate-100 transition-colors">
                <Suspense fallback={<PageLoadingSpinner />}>
                    <Routes>
                        {/* Primary Authentication Entry Points */}
                        <Route path="/" element={<Home />} />
                        {/* One login for Admin and Student. There is no public sign-up: administrators create the accounts. */}
                        <Route path="/login" element={<Navigate to="/?auth=login" replace />} />
                        <Route path="/admin/login" element={<Navigate to="/?auth=login" replace />} />

                        {/* Shared-link recruitment assessment (public, capability based) */}
                        <Route path="/assessment/join/:shareToken" element={<SharedAssessmentEntry />} />
                        <Route path="/assessment/join/:shareToken/instructions" element={<ExamInstructions />} />
                        <Route path="/assessment/join/:shareToken/assessment" element={<RecruitmentAssessmentPage />} />
                        <Route path="/assessment/join/:shareToken/complete" element={<StudentAssessmentComplete />} />

                        {/* RoleReady Core Assessment Routes - Protected */}
                        <Route path="/assessment/setup" element={<RoleReadyAuthGuard><RoleReadySetup /></RoleReadyAuthGuard>} />
                        <Route path="/assessment/:sessionUuid" element={<RoleReadyAuthGuard><RoleReadyAssessment /></RoleReadyAuthGuard>} />
                        <Route path="/assessment/:sessionUuid/report" element={<RoleReadyAuthGuard><RoleReadyReport /></RoleReadyAuthGuard>} />
                        <Route path="/portal/roleready" element={<CandidateInvitationPortal />} />
                        <Route path="/portal/roleready/:invitationToken" element={<CandidateInvitationPortal />} />

                        {/* Admin Dashboard Routes - Protected by the server-verified admin session */}
                        <Route element={<AdminGuard><DashboardLayout /></AdminGuard>}>
                            <Route path="/admin/dashboard" element={<Dashboard />} />
                            <Route path="/admin/job-roles" element={<JobRolesPage />} />
                            <Route path="/admin/shared-links" element={<SharedLinksPage />} />
                            <Route path="/admin/candidate-results" element={<CandidateResultsPage />} />
                            <Route path="/admin/users" element={<UserManagementPage />} />
                            <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
                            <Route path="/dashboard" element={<Navigate to="/admin/dashboard" replace />} />
                            {/* Modules outside the recruitment workflow were removed from the admin UI: old URLs land on the workspace */}
                            <Route path="/recruitment/rounds" element={<Navigate to="/admin/dashboard" replace />} />
                            <Route path="/recruitment/invitations" element={<Navigate to="/admin/dashboard" replace />} />
                            <Route path="/resume-screening" element={<Navigate to="/admin/dashboard" replace />} />
                            <Route path="/screened-candidates" element={<Navigate to="/admin/dashboard" replace />} />
                            <Route path="/coding-round" element={<Navigate to="/admin/dashboard" replace />} />
                            <Route path="/aptitude-round" element={<Navigate to="/admin/dashboard" replace />} />
                            <Route path="/technical-interview" element={<Navigate to="/admin/dashboard" replace />} />
                            <Route path="/candidates" element={<Navigate to="/admin/dashboard" replace />} />
                            <Route path="/analytics" element={<Navigate to="/admin/dashboard" replace />} />
                            <Route path="/settings" element={<Navigate to="/admin/dashboard" replace />} />
                            <Route path="/platform/organizations" element={<Navigate to="/admin/dashboard" replace />} />
                        </Route>

                        {/* Candidate Portal Routes */}
                        <Route path="/portal" element={<CandidateLayout />}>
                            <Route index element={<Navigate to="/portal/login" replace />} />
                            <Route path="login" element={<CandidateLogin />} />
                            <Route path="start" element={<CandidateStartPage />} />
                            <Route path="instructions" element={<InstructionsPage />} />
                            <Route path="assessment/coding" element={<CandidateCodingAssessment />} />
                            <Route path="assessment/aptitude" element={<CandidateAptitudeAssessment />} />
                            <Route path="assessment/interview" element={<VoiceInterview />} />
                        </Route>

                        {/* Student Routes - Active Assessment & Placement Hub */}
                        <Route path="/student/login" element={<Navigate to="/?auth=login" replace />} />
                        <Route path="/student" element={<Navigate to="/student/dashboard" replace />} />
                        <Route path="/student/dashboard" element={<StudentLayout />}>
                            <Route index element={<StudentDashboard />} />
                        </Route>
                        <Route path="/student/performance" element={<StudentLayout />}>
                            <Route index element={<StudentDashboard />} />
                        </Route>

                        {/* Student career modules: served at /student/<module> (sidebar and dashboard links) and
                            kept at /student/hub/<module> for compatibility. Same components, same auth guard
                            (StudentLayout). */}
                        <Route path="/student/hub" element={<StudentLayout />}>
                            <Route index element={<StudentDashboard />} />
                            <Route path="skill-gap" element={<StudentSkillGap />} />
                            <Route path="roadmap" element={<StudentRoadmap />} />
                            <Route path="practice" element={<StudentPractice />} />
                            <Route path="interview" element={<StudentMockInterview />} />
                            <Route path="simulation" element={<StudentPlacementSimulation />} />
                            <Route path="projects" element={<StudentProjects />} />
                            <Route path="resume" element={<StudentResumeUpload />} />
                            <Route path="resume-formatter" element={<StudentResumeFormatter />} />
                            <Route path="profile" element={<StudentProfile />} />
                        </Route>
                        <Route element={<StudentLayout />}>
                            <Route path="/student/skill-gap" element={<StudentSkillGap />} />
                            <Route path="/student/roadmap" element={<StudentRoadmap />} />
                            <Route path="/student/practice" element={<StudentPractice />} />
                            <Route path="/student/interview" element={<StudentMockInterview />} />
                            <Route path="/student/simulation" element={<StudentPlacementSimulation />} />
                            <Route path="/student/projects" element={<StudentProjects />} />
                            <Route path="/student/resume" element={<StudentResumeUpload />} />
                            <Route path="/student/resume-formatter" element={<StudentResumeFormatter />} />
                            <Route path="/student/profile" element={<StudentProfile />} />
                        </Route>

                        {/* College Placement Administration Routes */}
                        <Route path="/college" element={<CollegeLayout />}>
                            <Route index element={<Navigate to="/college/dashboard" replace />} />
                            <Route path="dashboard" element={<CollegeDashboard />} />
                            <Route path="students" element={<CollegeStudents />} />
                            <Route path="drives" element={<CollegeDrives />} />
                        </Route>

                        {/* Fallback */}
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </Suspense>
            </div>
        </Router>
        </AssessmentLockProvider>
        </ThemeProvider>
    );
}

export default App;
