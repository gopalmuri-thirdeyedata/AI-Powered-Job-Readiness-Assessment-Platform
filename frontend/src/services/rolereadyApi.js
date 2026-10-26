import axios from 'axios';
import API_URL from '../apiConfig';

// Students authenticate with the HttpOnly session cookie (+ CSRF header) added by the auth client.
const getAuthHeaders = (isMultipart = false) => {
    const invitationToken = localStorage.getItem('invitationToken');
    const headers = {
        'Accept': 'application/json',
    };
    if (invitationToken) {
        headers['X-Invitation-Token'] = invitationToken;
    }
    if (isMultipart) {
        headers['Content-Type'] = 'multipart/form-data';
    } else {
        headers['Content-Type'] = 'application/json';
    }
    return headers;
};

export const rolereadyApi = {
    // ─── Workflow A: Student Self-Assessment ───────────────────────
    async initializeSession(formData) {
        const response = await axios.post(`${API_URL}/api/roleready/student/initialize`, formData, {
            headers: getAuthHeaders(true),
            timeout: 120000 // 120s guard against indefinite connection hangs while preserving generation window
        });
        return response.data;
    },

    async getSessionStatus(sessionUuid) {
        const response = await axios.get(`${API_URL}/api/roleready/session/${sessionUuid}`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async getStudentAssessments() {
        const response = await axios.get(`${API_URL}/api/roleready/student/assessments`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async getStudentHistory() {
        return this.getStudentAssessments();
    },

    // Round 1: Aptitude
    async startAptitude(sessionUuid) {
        const response = await axios.post(`${API_URL}/api/roleready/session/${sessionUuid}/start-aptitude`, {}, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async submitAptitude(sessionUuid, answers, timeSpentSeconds = 0, proctoringViolations = []) {
        const response = await axios.post(`${API_URL}/api/roleready/session/${sessionUuid}/submit-aptitude`, {
            answers,
            time_spent_seconds: timeSpentSeconds,
            proctoring_violations: proctoringViolations
        }, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    // Round 2: Coding
    async startCoding(sessionUuid) {
        const response = await axios.post(`${API_URL}/api/roleready/session/${sessionUuid}/start-coding`, {}, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async runCodeTest(sessionUuid, problemId, code, language = 'python') {
        const response = await axios.post(`${API_URL}/api/roleready/session/${sessionUuid}/run-code`, {
            problem_id: problemId,
            code,
            language
        }, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async submitCoding(sessionUuid, solutions, timeSpentSeconds = 0, proctoringViolations = []) {
        const response = await axios.post(`${API_URL}/api/roleready/session/${sessionUuid}/submit-coding`, {
            solutions,
            time_spent_seconds: timeSpentSeconds,
            proctoring_violations: proctoringViolations
        }, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    // Round 3: Interview
    async startInterview(sessionUuid) {
        const response = await axios.post(`${API_URL}/api/roleready/session/${sessionUuid}/start-interview`, {}, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async initVapiSession(sessionUuid) {
        const response = await axios.post(`${API_URL}/api/roleready/session/${sessionUuid}/vapi-init`, {}, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async submitInterview(sessionUuid, answers, timeSpentSeconds = 0, proctoringViolations = [], transcript = []) {
        const response = await axios.post(`${API_URL}/api/roleready/session/${sessionUuid}/submit-interview`, {
            answers,
            transcript,
            time_spent_seconds: timeSpentSeconds,
            proctoring_violations: proctoringViolations
        }, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async retryInterviewEvaluation(sessionUuid) {
        const response = await axios.post(`${API_URL}/api/roleready/session/${sessionUuid}/retry-interview-evaluation`, {}, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    // Autosave of in-progress work (scored by the server if the section or the 60-minute assessment ends first)
    async saveDraft(sessionUuid, section, payload) {
        const response = await axios.put(`${API_URL}/api/roleready/session/${sessionUuid}/draft`, { section, payload }, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    // Fast-path malpractice termination
    async terminateSession(sessionUuid, reason = "3/3 Malpractice Violations Recorded", proctoringViolations = [], currentStage = null) {
        const response = await axios.post(`${API_URL}/api/roleready/session/${sessionUuid}/terminate`, {
            reason,
            proctoring_violations: proctoringViolations,
            round_type: currentStage
        }, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    // Consolidated Report
    async getReport(sessionUuid) {
        const response = await axios.get(`${API_URL}/api/roleready/session/${sessionUuid}/report`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    // ─── Candidate Invitation Portal ──────────────────────────────
    async verifyInvitation(token) {
        const response = await axios.get(`${API_URL}/api/roleready/portal/verify?token=${token}`);
        return response.data;
    },

    // ─── Workflow B: Admin Recruitment ────────────────────────────
    async createBatch(batchName, jobDescriptionId = null, description = null) {
        const response = await axios.post(`${API_URL}/api/roleready/admin/batches`, {
            batch_name: batchName,
            job_description_id: jobDescriptionId,
            description
        }, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async listBatches() {
        const response = await axios.get(`${API_URL}/api/roleready/admin/batches`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async sendBatchInvitations(batchId, candidateIds) {
        const response = await axios.post(`${API_URL}/api/roleready/admin/batches/${batchId}/invitations`, {
            candidate_ids: candidateIds
        }, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async getBatchReport(batchId) {
        const response = await axios.get(`${API_URL}/api/roleready/admin/batches/${batchId}/report`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    // ─── Admin Assessment Workspace & Tracking ────────────────────
    async getTrackingData() {
        const response = await axios.get(`${API_URL}/api/roleready/admin/tracking`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async parseAdminResumes(files) {
        const formData = new FormData();
        files.forEach(file => {
            formData.append('files', file);
        });
        const response = await axios.post(`${API_URL}/api/roleready/admin/parse-resumes`, formData, {
            headers: getAuthHeaders(true)
        });
        return response.data;
    },

    async dispatchBatch(payload) {
        const response = await axios.post(`${API_URL}/api/roleready/admin/dispatch-batch`, payload, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async getCandidateReport(candidateId) {
        const response = await axios.get(`${API_URL}/api/roleready/admin/candidates/${candidateId}/report`, {
            headers: getAuthHeaders()
        });
        return response.data;
    }
};

export default rolereadyApi;
