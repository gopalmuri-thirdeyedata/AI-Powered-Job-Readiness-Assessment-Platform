import React from 'react';
import JobRoleManager from '../../components/admin/JobRoleManager';
import WorkspacePage from '../../components/admin/WorkspacePage';
import { useWorkflowNavigate } from '../../components/admin/workflowRoutes';

/** Stage 2: create job roles, generate / review the blueprint, publish (/admin/job-roles). */
const JobRolesPage = () => {
    const goTo = useWorkflowNavigate();
    return (
        <WorkspacePage title="Job Roles & Blueprints">
            <JobRoleManager onNavigate={goTo} />
        </WorkspacePage>
    );
};

export default JobRolesPage;
