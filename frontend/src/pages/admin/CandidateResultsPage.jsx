import React from 'react';
import CandidateResultsTable from '../../components/admin/CandidateResultsTable';
import WorkspacePage from '../../components/admin/WorkspacePage';
import { useWorkflowNavigate } from '../../components/admin/workflowRoutes';

/** Stage 4: registrations, assessment status, scores and candidate reports (/admin/candidate-results). */
const CandidateResultsPage = () => {
    const goTo = useWorkflowNavigate();
    return (
        <WorkspacePage title="Candidate Results">
            <CandidateResultsTable onNavigate={goTo} />
        </WorkspacePage>
    );
};

export default CandidateResultsPage;
