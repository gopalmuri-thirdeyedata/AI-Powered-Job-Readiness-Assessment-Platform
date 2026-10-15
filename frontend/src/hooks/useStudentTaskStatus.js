import { useState, useEffect, useCallback } from 'react';
import studentApi from '../services/studentApi';
import API_URL from '../apiConfig';

const BASE_STORAGE_KEY = 'student_completed_assessment';
const EVENT_NAME = 'student_task_status_changed';

/**
 * Returns a scoped storage key for the given email to prevent state leaking between users.
 */
const getStorageKey = (email = null) => {
    const targetEmail = (email || localStorage.getItem('student_user_email') || '').trim().toLowerCase();
    if (targetEmail) {
        return `${BASE_STORAGE_KEY}_${targetEmail}`;
    }
    return BASE_STORAGE_KEY;
};

/**
 * Synchronizes the active Clerk student session with the backend.
 * Ensures the student JWT token in localStorage strictly belongs to this user.
 */
export const syncStudentSessionWithBackend = async (user) => {
    if (!user) return null;
    const email = user.primaryEmailAddress?.emailAddress?.trim()?.toLowerCase();
    if (!email) return null;

    const previousEmail = (localStorage.getItem('student_user_email') || '').trim().toLowerCase();
    if (previousEmail && previousEmail !== email) {
        // Different user logged in! Evict previous user's JWT and task flags
        localStorage.removeItem('token');
        localStorage.removeItem('studentToken');
        localStorage.removeItem(BASE_STORAGE_KEY);
        localStorage.removeItem(getStorageKey(previousEmail));
        window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { completed: false, email } }));
    }

    try {
        const response = await fetch(`${API_URL}/api/auth/clerk-sync/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email,
                clerk_user_id: user.id,
                role_intent: 'student'
            })
        });

        if (response.ok) {
            const data = await response.json();
            if (data.access) {
                localStorage.setItem('token', data.access);
                localStorage.setItem('studentToken', data.access);
                localStorage.setItem('student_user_email', email);
                return data.access;
            }
        }
    } catch (err) {
        console.warn('syncStudentSessionWithBackend failed:', err);
    }
    return null;
};

/**
 * Returns true if student has completed at least one assessment according to localStorage.
 */
export const isStudentTaskCompletedSync = (email = null) => {
    try {
        const key = getStorageKey(email);
        return localStorage.getItem(key) === 'true';
    } catch {
        return false;
    }
};

/**
 * Marks that the student has completed the assessment task.
 * Updates localStorage and broadcasts event to all components.
 */
export const markStudentTaskCompleted = (email = null) => {
    try {
        const key = getStorageKey(email);
        localStorage.setItem(key, 'true');
        localStorage.setItem(BASE_STORAGE_KEY, 'true');
        window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { completed: true, email } }));
        window.dispatchEvent(new Event('storage'));
    } catch (e) {
        console.error('Failed to mark task completed:', e);
    }
};

/**
 * Resets student completion status (e.g. upon sign out).
 */
export const clearStudentTaskCompleted = (email = null) => {
    try {
        const key = getStorageKey(email);
        localStorage.removeItem(key);
        localStorage.removeItem(BASE_STORAGE_KEY);
        window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { completed: false, email } }));
        window.dispatchEvent(new Event('storage'));
    } catch (e) {
        console.error('Failed to clear student task completion:', e);
    }
};

/**
 * Custom React hook that tracks whether the current student has completed the initial assessment task.
 * 
 * - Synchronously initializes from user-scoped localStorage for zero flash-of-unrendered-content.
 * - Validates in the background against /api/roleready/student/assessments when an auth token exists.
 * - Reactive across tabs and components via custom event listeners.
 */
export default function useStudentTaskStatus(user = null) {
    const userEmail = user?.primaryEmailAddress?.emailAddress?.trim()?.toLowerCase() || null;
    const [hasCompletedTask, setHasCompletedTask] = useState(() => isStudentTaskCompletedSync(userEmail));
    const [isLoading, setIsLoading] = useState(true);

    const refreshStatus = useCallback(async () => {
        let token = localStorage.getItem('studentToken') || localStorage.getItem('token');
        const storedEmail = (localStorage.getItem('student_user_email') || '').trim().toLowerCase();

        // If active Clerk student exists and tokens are missing or belong to another account, synchronize now
        if (user && (!token || (storedEmail && userEmail && storedEmail !== userEmail))) {
            const syncedToken = await syncStudentSessionWithBackend(user);
            if (syncedToken) token = syncedToken;
        }

        if (!token && !user) {
            setIsLoading(false);
            return;
        }

        try {
            const data = await studentApi.getAssessmentHistory();
            const completedCount = Number(data?.total_completed || 0);
            const isCompleted = completedCount > 0 || (Array.isArray(data?.assessments) && data.assessments.some(a => a.is_completed));

            const key = getStorageKey(userEmail || storedEmail);
            if (isCompleted) {
                localStorage.setItem(key, 'true');
                localStorage.setItem(BASE_STORAGE_KEY, 'true');
                setHasCompletedTask(true);
            } else {
                localStorage.setItem(key, 'false');
                localStorage.setItem(BASE_STORAGE_KEY, 'false');
                setHasCompletedTask(false);
            }
        } catch (err) {
            console.debug('useStudentTaskStatus: API check skipped or unavailable:', err?.message);
        } finally {
            setIsLoading(false);
        }
    }, [user, userEmail]);

    useEffect(() => {
        refreshStatus();

        const handleStatusEvent = (e) => {
            if (e?.detail?.completed !== undefined) {
                setHasCompletedTask(Boolean(e.detail.completed));
            } else {
                setHasCompletedTask(isStudentTaskCompletedSync(userEmail));
            }
        };

        const handleStorageEvent = (e) => {
            if (e.key === BASE_STORAGE_KEY || e.key?.startsWith(BASE_STORAGE_KEY) || !e.key) {
                setHasCompletedTask(isStudentTaskCompletedSync(userEmail));
            }
        };

        window.addEventListener(EVENT_NAME, handleStatusEvent);
        window.addEventListener('storage', handleStorageEvent);

        return () => {
            window.removeEventListener(EVENT_NAME, handleStatusEvent);
            window.removeEventListener('storage', handleStorageEvent);
        };
    }, [refreshStatus, userEmail]);

    return {
        hasCompletedTask,
        isLoading,
        refreshStatus
    };
}
