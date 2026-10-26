// ==============================================================================
// PREPWIN API CONFIGURATION
// ==============================================================================

const envApiUrl = import.meta.env.VITE_API_URL;
const isPlaceholder = !envApiUrl
    || envApiUrl.includes('your-backend-url.railway.app')
    || envApiUrl.includes('<PRODUCTION_API_BASE_URL>');

// Dev fallback: the API on the SAME host name the page was opened with. The session cookie is SameSite=Lax, so an app opened
// at http://127.0.0.1:5173 must talk to http://127.0.0.1:8000 (not localhost:8000) or the browser would not send the cookie.
const devHost = (typeof window !== 'undefined' && window.location && window.location.hostname) || 'localhost';

const rawApiUrl = !isPlaceholder
    ? envApiUrl
    : (import.meta.env.DEV ? `http://${devHost}:8000` : '');

// Normalize: remove trailing slash, and remove trailing '/api' because
// all services and endpoints in the frontend explicitly prepend '/api/...'
let cleanUrl = (rawApiUrl || '').trim().replace(/\/+$/, '');
if (cleanUrl === '/api' || cleanUrl.endsWith('/api')) {
    cleanUrl = cleanUrl.slice(0, -4);
}

const API_URL = cleanUrl;

export default API_URL;
