import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import ContactAdminModal from '../components/student-ui/ContactAdminModal';

// Assessments are assigned by the admin, so every student "start assessment" button opens the contact-admin popup.
// Set to false to let students start their own assessments again.
export const ASSESSMENT_START_LOCKED = false; // TEMPORARY: unlocked to test the ElevenLabs voice interview. Set back to true after testing.

const AssessmentLockContext = createContext({ promptContactAdmin: () => {} });

export const AssessmentLockProvider = ({ children }) => {
    const [open, setOpen] = useState(false);
    const promptContactAdmin = useCallback(() => setOpen(true), []);
    const close = useCallback(() => setOpen(false), []);
    const value = useMemo(() => ({ promptContactAdmin }), [promptContactAdmin]);

    return (
        <AssessmentLockContext.Provider value={value}>
            {children}
            <ContactAdminModal open={open} onClose={close} />
        </AssessmentLockContext.Provider>
    );
};

export const useAssessmentLock = () => useContext(AssessmentLockContext);
