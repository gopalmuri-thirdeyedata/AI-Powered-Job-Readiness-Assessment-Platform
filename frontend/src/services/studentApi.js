import axios from 'axios';
import API_URL from '../apiConfig';

/**
 * Returns authorization headers for student API requests.
 * Checks both studentToken and global token in localStorage.
 */
const getAuthHeaders = (isMultipart = false) => {
    const token = localStorage.getItem('studentToken') || localStorage.getItem('token');
    const headers = {
        'Accept': 'application/json',
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    if (isMultipart) {
        headers['Content-Type'] = 'multipart/form-data';
    } else {
        headers['Content-Type'] = 'application/json';
    }
    return headers;
};

// A stored student JWT can be stale (expired, or signed before a backend restart) while the Clerk
// session is still valid. Re-issue it from the Clerk session once and replay the request.
let refreshInFlight = null;
const refreshStudentToken = () => {
    if (!refreshInFlight) {
        const clerkUser = window.Clerk?.user;
        const email = clerkUser?.primaryEmailAddress?.emailAddress?.trim()?.toLowerCase();
        if (!clerkUser || !email) return Promise.resolve(null);
        refreshInFlight = fetch(`${API_URL}/api/auth/clerk-sync/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, clerk_user_id: clerkUser.id, role_intent: 'student' })
        })
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (!data?.access) return null;
                localStorage.setItem('token', data.access);
                localStorage.setItem('studentToken', data.access);
                localStorage.setItem('student_user_email', email);
                return data.access;
            })
            .catch(() => null)
            .finally(() => { refreshInFlight = null; });
    }
    return refreshInFlight;
};

axios.interceptors.response.use(undefined, async (error) => {
    const config = error.config;
    const url = config?.url || '';
    const isStudentCall = (url.includes('/api/student') || url.includes('/api/roleready/student')) && !url.includes('/auth/');
    if (error.response?.status !== 401 || !isStudentCall || config._studentRetried) {
        return Promise.reject(error);
    }
    config._studentRetried = true;
    const token = await refreshStudentToken();
    if (!token) return Promise.reject(error);
    config.headers = { ...config.headers, Authorization: `Bearer ${token}` };
    return axios(config);
});

export const studentApi = {
    // Auth
    async login(email, password) {
        const response = await axios.post(`${API_URL}/api/student/auth/login`, {
            email,
            password
        });
        if (response.data?.access) {
            localStorage.setItem('studentToken', response.data.access);
            localStorage.setItem('token', response.data.access);
        }
        return response.data;
    },

    async register(email, password, fullName, inviteCode = null) {
        const payload = {
            email,
            password,
            full_name: fullName
        };
        if (inviteCode) {
            payload.invite_code = inviteCode;
        }
        const response = await axios.post(`${API_URL}/api/student/auth/register`, payload);
        if (response.data?.access) {
            localStorage.setItem('studentToken', response.data.access);
            localStorage.setItem('token', response.data.access);
        }
        return response.data;
    },

    logout() {
        try {
            localStorage.removeItem('studentToken');
            localStorage.removeItem('token');
            localStorage.removeItem('student_user_email');
            localStorage.removeItem('user_profile');
            localStorage.removeItem('student_completed_assessment');
        } catch (e) {
            console.error('Failed to clear student session storage:', e);
        }
    },

    // Profile
    async getProfile() {
        const response = await axios.get(`${API_URL}/api/student/profile`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async updateProfile(profileData) {
        const response = await axios.put(`${API_URL}/api/student/profile`, profileData, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    // Resume Analyzer (with job description) and Resume Formatter. Source is a file or a saved resume id.
    async analyzeResumeWithJd({ file = null, resumeId = null, jobDescription }) {
        const formData = new FormData();
        if (file) formData.append('file', file);
        if (resumeId) formData.append('resume_id', String(resumeId));
        formData.append('job_description', jobDescription);
        const response = await axios.post(`${API_URL}/api/student/resume/analyze-jd`, formData, {
            headers: getAuthHeaders(true)
        });
        return response.data;
    },

    async formatResume({ file = null, resumeId = null }) {
        const formData = new FormData();
        if (file) formData.append('file', file);
        if (resumeId) formData.append('resume_id', String(resumeId));
        const response = await axios.post(`${API_URL}/api/student/resume/format`, formData, {
            headers: getAuthHeaders(true)
        });
        return response.data;
    },

    // Resume Upload & Analysis
    async uploadResume(file, targetRole = null, targetCompany = null) {
        const formData = new FormData();
        formData.append('file', file);
        if (targetRole) formData.append('target_role', targetRole);
        if (targetCompany) formData.append('target_company', targetCompany);

        const response = await axios.post(`${API_URL}/api/student/resume/upload`, formData, {
            headers: getAuthHeaders(true)
        });
        return response.data;
    },

    async getResume(version = null) {
        const url = version 
            ? `${API_URL}/api/student/resume?version=${version}`
            : `${API_URL}/api/student/resume`;
        const response = await axios.get(url, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    // Placement Readiness
    async getReadiness() {
        const response = await axios.get(`${API_URL}/api/student/readiness`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    // Dashboard Unified View
    async getDashboard() {
        const response = await axios.get(`${API_URL}/api/student/dashboard`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    // RoleReady Assessment History & Progress
    async getAssessmentHistory() {
        const response = await axios.get(`${API_URL}/api/roleready/student/assessments`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    // Phase 2: Skill Gap & Target Roles
    async getTargetRoles() {
        const response = await axios.get(`${API_URL}/api/student/target-roles`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async getSkillGap() {
        const response = await axios.get(`${API_URL}/api/student/skill-gap`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async simulateSkillGap(targetRole, targetCompany = null, additionalSkills = []) {
        const response = await axios.post(`${API_URL}/api/student/skill-gap/analyze`, {
            target_role: targetRole,
            target_company: targetCompany,
            additional_skills: additionalSkills
        }, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async getCareerPaths() {
        const response = await axios.get(`${API_URL}/api/student/career-paths`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    // Phase 3: Personalized Roadmap & Daily Preparation Plan
    async getRoadmap() {
        const response = await axios.get(`${API_URL}/api/student/roadmap`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async generateRoadmap(targetRole = null, regenerate = false) {
        const response = await axios.post(`${API_URL}/api/student/roadmap/generate`, {
            target_role: targetRole,
            regenerate: regenerate
        }, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async updateDailyTaskStatus(taskId, status) {
        const response = await axios.patch(`${API_URL}/api/student/daily-tasks/${taskId}`, {
            status: status
        }, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    // Phase 4: DSA & Aptitude Practice
    async getPracticeTopics() {
        const response = await axios.get(`${API_URL}/api/student/practice/topics`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async getPracticeQuestions(topic = null, category = null) {
        const params = new URLSearchParams();
        if (topic) params.append('topic', topic);
        if (category) params.append('category', category);
        const queryStr = params.toString() ? `?${params.toString()}` : '';

        const response = await axios.get(`${API_URL}/api/student/practice/questions${queryStr}`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async submitPracticeAttempt(questionId, code = null, language = null, selectedOption = null) {
        const response = await axios.post(`${API_URL}/api/student/practice/submit`, {
            question_id: questionId,
            code: code,
            language: language,
            selected_option: selectedOption
        }, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    // Phase 5: AI Mock Interview
    async startMockInterview(interviewType = 'TECHNICAL', targetRole = null) {
        const response = await axios.post(`${API_URL}/api/student/mock-interview/start`, {
            interview_type: interviewType,
            target_role: targetRole
        }, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async submitMockInterviewTurn(interviewId, studentResponse) {
        const response = await axios.post(`${API_URL}/api/student/mock-interview/${interviewId}/turn`, {
            student_response: studentResponse
        }, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async completeMockInterview(interviewId) {
        const response = await axios.post(`${API_URL}/api/student/mock-interview/${interviewId}/complete`, {}, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async getMockInterviewHistory() {
        const response = await axios.get(`${API_URL}/api/student/mock-interview/history`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async getMockInterviewDetail(interviewId) {
        const response = await axios.get(`${API_URL}/api/student/mock-interview/${interviewId}`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    // Phase 6: Student Projects & Architectural Analyzer
    async getProjects() {
        const response = await axios.get(`${API_URL}/api/student/projects`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async createProject(projectData) {
        const response = await axios.post(`${API_URL}/api/student/projects`, projectData, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async getProject(projectId) {
        const response = await axios.get(`${API_URL}/api/student/projects/${projectId}`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async updateProject(projectId, projectData) {
        const response = await axios.put(`${API_URL}/api/student/projects/${projectId}`, projectData, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async deleteProject(projectId) {
        const response = await axios.delete(`${API_URL}/api/student/projects/${projectId}`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async analyzeProject(projectId) {
        const response = await axios.post(`${API_URL}/api/student/projects/${projectId}/analyze`, {}, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    // Phase 7: Placement Simulation & Readiness Scoring
    async startSimulation(targetRole = null) {
        const response = await axios.post(`${API_URL}/api/student/simulation/start`, {
            target_role: targetRole
        }, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async getActiveSimulation() {
        const response = await axios.get(`${API_URL}/api/student/simulation/active`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async getSimulation(simulationId) {
        const response = await axios.get(`${API_URL}/api/student/simulation/${simulationId}`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async submitSimulationRound(simulationId, roundNumber, payload) {
        const response = await axios.post(
            `${API_URL}/api/student/simulation/${simulationId}/round/${roundNumber}/submit`,
            payload,
            { headers: getAuthHeaders() }
        );
        return response.data;
    },

    async getSimulationHistory() {
        const response = await axios.get(`${API_URL}/api/student/simulation/history`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    // Phase 8: Career Copilot & Unified Dashboard
    async sendCopilotMessage(content) {
        const response = await axios.post(`${API_URL}/api/student/copilot/chat`, {
            content: content
        }, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async getCopilotHistory() {
        const response = await axios.get(`${API_URL}/api/student/copilot/history`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async clearCopilotHistory() {
        const response = await axios.delete(`${API_URL}/api/student/copilot/history`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async getUnifiedDashboard() {
        const response = await axios.get(`${API_URL}/api/student/dashboard/unified`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    // Phase 10: Guided Student Onboarding & Career Intake
    async getOnboardingStatus() {
        const response = await axios.get(`${API_URL}/api/student/onboarding/status`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async saveOnboardingStep(stepData) {
        const response = await axios.post(`${API_URL}/api/student/onboarding/step`, stepData, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async completeOnboarding(onboardingData) {
        const response = await axios.post(`${API_URL}/api/student/onboarding/complete`, onboardingData, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    // Phase 11: Student Performance Dashboard & Assessment History
    async getPerformanceDashboard() {
        const response = await axios.get(`${API_URL}/api/student/performance/dashboard`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async getPerformanceHistory(params = {}) {
        const queryParams = new URLSearchParams();
        if (params.category) queryParams.append('category', params.category);
        if (params.status) queryParams.append('status', params.status);
        if (params.sortBy) queryParams.append('sort_by', params.sortBy);
        if (params.page) queryParams.append('page', params.page);
        if (params.pageSize) queryParams.append('page_size', params.pageSize);

        const queryStr = queryParams.toString() ? `?${queryParams.toString()}` : '';
        const response = await axios.get(`${API_URL}/api/student/performance/history${queryStr}`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async getPerformanceAssessmentDetail(assessmentType, assessmentId) {
        const response = await axios.get(
            `${API_URL}/api/student/performance/assessment/${assessmentType}/${assessmentId}`,
            { headers: getAuthHeaders() }
        );
        return response.data;
    },

    logout() {
        localStorage.removeItem('studentToken');
        localStorage.removeItem('student_completed_assessment');
        // If current role is STUDENT in user_profile, clean up user_profile too
        try {
            const profile = JSON.parse(localStorage.getItem('user_profile') || '{}');
            if (profile.role === 'STUDENT') {
                localStorage.removeItem('token');
                localStorage.removeItem('user_profile');
            }
        } catch {
            // ignore
        }
    }
};

export default studentApi;
