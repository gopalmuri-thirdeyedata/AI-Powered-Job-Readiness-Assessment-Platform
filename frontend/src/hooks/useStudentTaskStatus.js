import { useState, useEffect, useCallback } from 'react';
import studentApi from '../services/studentApi';
import { useAuth } from '../auth/useAuth';
import { getStudentEmail } from '../utils/authStorage';
import { isStudentDemo } from '../utils/studentDemo';

const BASE_STORAGE_KEY = 'student_completed_assessment';
const EVENT_NAME = 'student_task_status_changed';

/**
 * Returns a scoped storage key for the given email to prevent state leaking between users.
 */
const getStorageKey = (email = null) => {
    const targetEmail = (email || getStudentEmail() || '').trim().toLowerCase();
    if (targetEmail) {
        return `${BASE_STORAGE_KEY}_${targetEmail}`;
    }
    return BASE_STORAGE_KEY;
};

/**
 * Returns true if student has completed at least one assessment according to localStorage.
 */
export const isStudentTaskCompletedSync = (email = null) => {
    if (isStudentDemo()) return true;     // the demo student has completed assessments
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
    if (isStudentDemo()) return;          // the demo never writes the real student's browser state
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
    if (isStudentDemo()) return;
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
export default function useStudentTaskStatus() {
    const { user, isLoaded: isAuthLoaded } = useAuth();
    const userEmail = user?.role === 'STUDENT' && user?.email ? String(user.email).trim().toLowerCase() : null;
    const [hasCompletedTask, setHasCompletedTask] = useState(() => isStudentTaskCompletedSync(userEmail));
    const [isLoading, setIsLoading] = useState(true);
    // True only when the server confirmed this student has no assessments (or nobody is signed in).
    // A failed or unfinished check must never count as "new student", or the dashboard bounces back to setup.
    const [isConfirmedNew, setIsConfirmedNew] = useState(false);

    const refreshStatus = useCallback(async () => {
        if (!isAuthLoaded) return;

        if (isStudentDemo()) {
            setIsConfirmedNew(false);
            setHasCompletedTask(true);
            setIsLoading(false);
            return;
        }

        // No student session: nothing to ask the student endpoint (and hiring staff have no student task)
        if (!userEmail) {
            setIsConfirmedNew(true);
            setIsLoading(false);
            return;
        }

        try {
            const data = await studentApi.getAssessmentHistory();
            const completedCount = Number(data?.total_completed || 0);
            const attemptedCount = Number(data?.total_attempted || 0);
            // Any attempt (even unfinished) unlocks the dashboard so past tests stay reachable
            const isCompleted = completedCount > 0 || attemptedCount > 0 || (Array.isArray(data?.assessments) && data.assessments.some(a => a.is_completed));

            const key = getStorageKey(userEmail);
            setIsConfirmedNew(!isCompleted);
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
            console.warn('useStudentTaskStatus: assessment history check failed:', err?.response?.status, err?.message);
        } finally {
            setIsLoading(false);
        }
    }, [isAuthLoaded, userEmail]);

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
        isConfirmedNew,
        refreshStatus
    };
}
