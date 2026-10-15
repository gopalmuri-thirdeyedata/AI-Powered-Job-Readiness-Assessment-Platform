// ==============================================================================
// PREPWIN API CONFIGURATION
// ==============================================================================

const rawApiUrl = (import.meta.env.VITE_API_URL !== undefined && import.meta.env.VITE_API_URL !== '')
    ? import.meta.env.VITE_API_URL
    : (import.meta.env.DEV ? 'http://localhost:8000' : '');

// Normalize: remove trailing slash, and remove trailing '/api' because
// all services and endpoints in the frontend explicitly prepend '/api/...'
let cleanUrl = (rawApiUrl || '').trim().replace(/\/+$/, '');
if (cleanUrl === '/api' || cleanUrl.endsWith('/api')) {
    cleanUrl = cleanUrl.slice(0, -4);
}

const API_URL = cleanUrl;

export default API_URL;
