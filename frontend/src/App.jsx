import React, { Suspense, lazy } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// Layouts (Lightweight structure)
import DashboardLayout from './layouts/DashboardLayout';
import CandidateLayout from './layouts/CandidateLayout';
import StudentLayout from './layouts/StudentLayout';
import CollegeLayout from './layouts/CollegeLayout';
import ClerkAdminGuard from './components/ClerkAdminGuard';
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
// import StudentDrives from './pages/student/StudentDrives';

// RoleReady Core Assessment Pages (Lazy Loaded)
const RoleReadySetup = lazy(() => import('./pages/roleready/RoleReadySetup'));
const RoleReadyAssessment = lazy(() => import('./pages/roleready/RoleReadyAssessment'));
const RoleReadyReport = lazy(() => import('./pages/roleready/RoleReadyReport'));
const CandidateInvitationPortal = lazy(() => import('./pages/roleready/CandidateInvitationPortal'));

// Recruiter Pages (Lazy Loaded)
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ResumeScreening = lazy(() => import('./pages/ResumeScreening'));
const CodingRound = lazy(() => import('./pages/CodingRound'));
const TechnicalInterview = lazy(() => import('./pages/TechnicalInterview'));
const AptitudeRound = lazy(() => import('./pages/AptitudeRound'));
const RecruitmentRoundsManager = lazy(() => import('./pages/RecruitmentRoundsManager'));
const Candidates = lazy(() => import('./pages/Candidates'));
const ScreenedCandidates = lazy(() => import('./pages/ScreenedCandidates'));
const Analytics = lazy(() => import('./pages/Analytics'));
const GlobalSettings = lazy(() => import('./pages/GlobalSettings'));
const PlatformAdminDashboard = lazy(() => import('./pages/PlatformAdminDashboard'));

// Candidate Portal Pages (Lazy Loaded)
const CandidateLogin = lazy(() => import('./pages/candidate/CandidateLogin'));
const CandidateStartPage = lazy(() => import('./pages/candidate/CandidateStartPage'));
const InstructionsPage = lazy(() => import('./pages/candidate/InstructionsPage'));
const CandidateCodingAssessment = lazy(() => import('./pages/candidate/CandidateCodingAssessment'));
const CandidateAptitudeAssessment = lazy(() => import('./pages/candidate/CandidateAptitudeAssessment'));
const VapiInterview = lazy(() => import('./pages/candidate/VapiInterview'));
const VapiTest = lazy(() => import('./pages/VapiTest'));

// Student Career Pages (Lazy Loaded)
const StudentLogin = lazy(() => import('./pages/student/StudentLogin'));
const StudentDashboard = lazy(() => import('./pages/student/StudentDashboard'));
const StudentResumeUpload = lazy(() => import('./pages/student/StudentResumeUpload'));
const StudentProfile = lazy(() => import('./pages/student/StudentProfile'));
const StudentSkillGap = lazy(() => import('./pages/student/StudentSkillGap'));
const StudentRoadmap = lazy(() => import('./pages/student/StudentRoadmap'));
const StudentPractice = lazy(() => import('./pages/student/StudentPractice'));
const StudentMockInterview = lazy(() => import('./pages/student/StudentMockInterview'));
const StudentProjects = lazy(() => import('./pages/student/StudentProjects'));
const StudentPlacementSimulation = lazy(() => import('./pages/student/StudentPlacementSimulation'));
const StudentDrives = lazy(() => import('./pages/student/StudentDrives'));

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
        <Router>
            <div className="min-h-screen">
                <Suspense fallback={<PageLoadingSpinner />}>
                    <Routes>
                        {/* Public Home */}
                        <Route path="/" element={<Home />} />
                        <Route path="/login" element={<Home />} />

                        {/* RoleReady Core Assessment Routes - Protected */}
                        <Route path="/assessment/setup" element={<RoleReadyAuthGuard><RoleReadySetup /></RoleReadyAuthGuard>} />
                        <Route path="/assessment/:sessionUuid" element={<RoleReadyAuthGuard><RoleReadyAssessment /></RoleReadyAuthGuard>} />
                        <Route path="/assessment/:sessionUuid/report" element={<RoleReadyAuthGuard><RoleReadyReport /></RoleReadyAuthGuard>} />
                        <Route path="/portal/roleready" element={<CandidateInvitationPortal />} />
                        <Route path="/portal/roleready/:invitationToken" element={<CandidateInvitationPortal />} />

                        {/* Admin Dashboard Routes - Protected by Clerk */}
                        <Route element={<ClerkAdminGuard><DashboardLayout /></ClerkAdminGuard>}>
                            <Route path="/admin/dashboard" element={<Dashboard />} />
                            <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
                            <Route path="/dashboard" element={<Navigate to="/admin/dashboard" replace />} />
                            <Route path="/recruitment/rounds" element={<RecruitmentRoundsManager />} />
                            <Route path="/resume-screening" element={<ResumeScreening />} />
                            <Route path="/screened-candidates" element={<ScreenedCandidates />} />
                            <Route path="/coding-round" element={<CodingRound />} />
                            <Route path="/aptitude-round" element={<AptitudeRound />} />
                            <Route path="/technical-interview" element={<TechnicalInterview />} />
                            <Route path="/candidates" element={<Candidates />} />
                            <Route path="/analytics" element={<Analytics />} />
                            <Route path="/settings" element={<GlobalSettings />} />
                            <Route path="/platform/organizations" element={<PlatformAdminDashboard />} />
                        </Route>

                        {/* Candidate Portal Routes */}
                        <Route path="/portal" element={<CandidateLayout />}>
                            <Route index element={<Navigate to="/portal/login" replace />} />
                            <Route path="login" element={<CandidateLogin />} />
                            <Route path="start" element={<CandidateStartPage />} />
                            <Route path="instructions" element={<InstructionsPage />} />
                            <Route path="assessment/coding" element={<CandidateCodingAssessment />} />
                            <Route path="assessment/aptitude" element={<CandidateAptitudeAssessment />} />
                            <Route path="assessment/interview" element={<VapiInterview />} />
                            <Route path="test-vapi" element={<VapiTest />} />
                        </Route>

                        {/* Student Routes - Active Assessment & Placement Hub */}
                        <Route path="/student/login" element={<Navigate to="/?auth=student" replace />} />
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
                            <Route path="drives" element={<StudentDrives />} />
                            <Route path="projects" element={<StudentProjects />} />
                            <Route path="resume" element={<StudentResumeUpload />} />
                            <Route path="profile" element={<StudentProfile />} />
                        </Route>
                        <Route element={<StudentLayout />}>
                            <Route path="/student/skill-gap" element={<StudentSkillGap />} />
                            <Route path="/student/roadmap" element={<StudentRoadmap />} />
                            <Route path="/student/practice" element={<StudentPractice />} />
                            <Route path="/student/interview" element={<StudentMockInterview />} />
                            <Route path="/student/simulation" element={<StudentPlacementSimulation />} />
                            <Route path="/student/drives" element={<StudentDrives />} />
                            <Route path="/student/projects" element={<StudentProjects />} />
                            <Route path="/student/resume" element={<StudentResumeUpload />} />
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
        </ThemeProvider>
    );
}

export default App;
