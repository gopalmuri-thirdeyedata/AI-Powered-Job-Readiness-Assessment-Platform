// Test support: the admin API client and the in-memory auth session bundled together, so a test can put the session in a known
// state (through the module's real refreshSession(), with fetch stubbed) and observe what the API client then sends.
export * from '../src/services/recruitmentApi.js';
export { refreshSession, getAuthState } from '../src/auth/authSession.js';
