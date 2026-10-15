// ==============================================================================
// PREPWIN API CONFIGURATION
// ==============================================================================

const envApiUrl = import.meta.env.VITE_API_URL;
const isPlaceholder = !envApiUrl
    || envApiUrl.includes('your-backend-url.railway.app')
    || envApiUrl.includes('<PRODUCTION_API_BASE_URL>');

const rawApiUrl = !isPlaceholder
    ? envApiUrl
    : (import.meta.env.DEV ? 'http://localhost:8000' : '');

// Normalize: remove trailing slash, and remove trailing '/api' because
// all services and endpoints in the frontend explicitly prepend '/api/...'
let cleanUrl = (rawApiUrl || '').trim().replace(/\/+$/, '');
if (cleanUrl === '/api' || cleanUrl.endsWith('/api')) {
    cleanUrl = cleanUrl.slice(0, -4);
}

const API_URL = cleanUrl;

export default API_URL;
