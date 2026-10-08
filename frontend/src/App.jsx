import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import ResumeScreening from './pages/ResumeScreening';
import CodingRound from './pages/CodingRound';
import TechnicalInterview from './pages/TechnicalInterview';
import AptitudeRound from './pages/AptitudeRound';
import RecruitmentRoundsManager from './pages/RecruitmentRoundsManager';
import Candidates from './pages/Candidates';
import ScreenedCandidates from './pages/ScreenedCandidates';
import Analytics from './pages/Analytics';
import AuthLayout from './layouts/AuthLayout';
import DashboardLayout from './layouts/DashboardLayout';
import CandidateLayout from './layouts/CandidateLayout';
import CandidateLogin from './pages/candidate/CandidateLogin';
import InstructionsPage from './pages/candidate/InstructionsPage';
import CandidateCodingAssessment from './pages/candidate/CandidateCodingAssessment';
import CandidateAptitudeAssessment from './pages/candidate/CandidateAptitudeAssessment';

import VapiInterview from './pages/candidate/VapiInterview';
import VapiTest from './pages/VapiTest';
import CandidateStartPage from './pages/candidate/CandidateStartPage';

import Home from './pages/Home';
import GlobalSettings from './pages/GlobalSettings';
import PlatformAdminDashboard from './pages/PlatformAdminDashboard';
import ClerkAdminGuard from './components/ClerkAdminGuard';

function App() {
    return (
        <Router>
            <div className="min-h-screen bg-dark text-white">
                <Routes>
                    {/* Public Home */}
                    <Route path="/" element={<Home />} />

                    {/* Public/Auth Routes */}
                    <Route path="/login" element={<Home />} />

                    {/* Admin Dashboard Routes - Protected by Clerk */}
                    <Route element={<ClerkAdminGuard><DashboardLayout /></ClerkAdminGuard>}>
                        <Route path="/dashboard" element={<Dashboard />} />
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

                    {/* Candidate Portal Routes - Isolated Environment */}
                    <Route path="/portal" element={<CandidateLayout />}>
                        <Route index element={<Navigate to="/portal/login" replace />} />
                        <Route path="login" element={<CandidateLogin />} />
                        <Route path="start" element={<CandidateStartPage />} />
                        <Route path="instructions" element={<InstructionsPage />} />
                        <Route path="assessment/coding" element={<CandidateCodingAssessment />} />
                        <Route path="assessment/aptitude" element={<CandidateAptitudeAssessment />} />
                        <Route path="assessment/interview" element={<VapiInterview />} />
                        <Route path="test-vapi" element={<VapiTest />} />
                        {/* Future Assessment Routes will go here */}
                    </Route>

                    {/* Fallback */}
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </div>
        </Router>
    );
}

export default App;
