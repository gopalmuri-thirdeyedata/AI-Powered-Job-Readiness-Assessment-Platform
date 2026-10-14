let API_URL = import.meta.env.VITE_API_URL;

if (!API_URL || API_URL.includes('your-backend-url.railway.app') || API_URL.includes('<PRODUCTION_API_BASE_URL>')) {
    API_URL = import.meta.env.PROD ? '/api' : 'http://localhost:8000';
}

export default API_URL;

