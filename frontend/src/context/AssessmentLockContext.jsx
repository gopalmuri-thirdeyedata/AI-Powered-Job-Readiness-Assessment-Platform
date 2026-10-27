import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Lock } from 'lucide-react';
import ContactAdminModal from '../components/student-ui/ContactAdminModal';
import { useAuth } from '../auth/useAuth';
import { rolereadyApi } from '../services/rolereadyApi';

// The normal assessment is unlocked per student by an Admin / Super Admin (User Management -> Assessment Access). The backend is
// the authority and refuses locked requests; this context only mirrors the server's answer so the buttons behave accordingly:
//   locked   -> every "start assessment" button opens the contact-admin popup
//   unlocked -> the same buttons open the assessment setup page
// The answer is re-read on every press, so a grant or revoke takes effect without signing out or reloading.
const AssessmentLockContext = createContext({
    promptContactAdmin: () => {},
    startAssessment: () => {},
    assessmentLocked: true,
    refreshAccess: async () => false,
});

export const AssessmentLockProvider = ({ children }) => {
    const navigate = useNavigate();
    const { user, isLoaded } = useAuth();
    const isStudent = isLoaded && user?.role === 'STUDENT';
    const [open, setOpen] = useState(false);
    const [granted, setGranted] = useState(false);
    const alive = useRef(true);

    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

    const refreshAccess = useCallback(async () => {
        if (!isStudent) return false;
        try {
            const value = await rolereadyApi.getAssessmentAccess();
            if (alive.current) setGranted(value);
            return value;
        } catch {
            if (alive.current) setGranted(false);   // fail closed: the server would refuse the request anyway
            return false;
        }
    }, [isStudent]);

    useEffect(() => {
        if (isStudent) refreshAccess();
        else setGranted(false);
    }, [isStudent, user?.id, refreshAccess]);

    const promptContactAdmin = useCallback(() => setOpen(true), []);
    const close = useCallback(() => setOpen(false), []);
    const startAssessment = useCallback(async () => {
        if (await refreshAccess()) navigate('/assessment/setup');
        else setOpen(true);
    }, [refreshAccess, navigate]);

    const value = useMemo(
        () => ({ promptContactAdmin, startAssessment, assessmentLocked: !granted, refreshAccess }),
        [promptContactAdmin, startAssessment, granted, refreshAccess],
    );

    return (
        <AssessmentLockContext.Provider value={value}>
            {children}
            <ContactAdminModal open={open} onClose={close} />
        </AssessmentLockContext.Provider>
    );
};

export const useAssessmentLock = () => useContext(AssessmentLockContext);

/** Padlock while the assessment is locked for this student, an arrow once an admin has unlocked it. */
export const StartIcon = ({ className }) => {
    const { assessmentLocked } = useAssessmentLock();
    return assessmentLocked ? <Lock className={className} /> : <ArrowRight className={className} />;
};
