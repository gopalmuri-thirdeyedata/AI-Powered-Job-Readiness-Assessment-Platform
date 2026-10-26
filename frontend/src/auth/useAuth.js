import { useSyncExternalStore } from 'react';
import { getAuthState, subscribeAuth, logout } from './authSession';

/** Live view of the server-verified session: { user, role, isLoaded, isSignedIn, error, signOut }. */
export function useAuth() {
    const state = useSyncExternalStore(subscribeAuth, getAuthState, getAuthState);
    return {
        user: state.user,
        role: state.user?.role || null,
        isLoaded: state.isLoaded,
        isSignedIn: Boolean(state.user),
        error: state.error,
        signOut: logout,
    };
}

/** `{ user, isLoaded }` shape used by the student pages. */
export const useUser = () => {
    const { user, isLoaded } = useAuth();
    return { user, isLoaded };
};

export default useAuth;
