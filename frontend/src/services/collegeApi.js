import axios from 'axios';
import API_URL from '../apiConfig';

// Authentication is the HttpOnly session cookie (+ CSRF header) added by the auth client; no per-request credentials here.
const getAuthHeaders = () => ({});

const collegeApi = {
    // Phase 9: College Cohort Overview & Analytics
    async getOverview() {
        const response = await axios.get(`${API_URL}/api/college/overview`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    // Student Roster with Filtering & Search
    async getStudents(params = {}) {
        const query = new URLSearchParams();
        if (params.search) query.append('search', params.search);
        if (params.branch) query.append('branch', params.branch);
        if (params.min_readiness !== undefined && params.min_readiness !== null && params.min_readiness !== '') {
            query.append('min_readiness', params.min_readiness);
        }
        if (params.limit) query.append('limit', params.limit);
        if (params.offset) query.append('offset', params.offset);

        const queryStr = query.toString() ? `?${query.toString()}` : '';
        const response = await axios.get(`${API_URL}/api/college/students${queryStr}`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    // Placement Drives Management
    async getDrives(status = null) {
        const query = status ? `?status=${status}` : '';
        const response = await axios.get(`${API_URL}/api/college/drives${query}`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async createDrive(driveData) {
        const response = await axios.post(`${API_URL}/api/college/drives`, driveData, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async getDrive(driveId) {
        const response = await axios.get(`${API_URL}/api/college/drives/${driveId}`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async updateDrive(driveId, updateData) {
        const response = await axios.put(`${API_URL}/api/college/drives/${driveId}`, updateData, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    // Drive Applications & Candidate Progression
    async getDriveApplications(driveId) {
        const response = await axios.get(`${API_URL}/api/college/drives/${driveId}/applications`, {
            headers: getAuthHeaders()
        });
        return response.data;
    },

    async updateApplicationStatus(applicationId, status, notes = null) {
        const response = await axios.patch(`${API_URL}/api/college/applications/${applicationId}/status`, {
            status: status,
            notes: notes
        }, {
            headers: getAuthHeaders()
        });
        return response.data;
    }
};

export default collegeApi;
