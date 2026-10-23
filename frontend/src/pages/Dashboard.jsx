import React from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import OverviewKpis from '../components/admin/OverviewKpis';
import WorkspacePage from '../components/admin/WorkspacePage';
import { WORKFLOW_ROUTES, useWorkflowNavigate } from '../components/admin/workflowRoutes';

/** Stage 1 of the recruitment workflow: Overview (/admin/dashboard). Jobs, links and results have their own routes. */
const Dashboard = () => {
    const [searchParams] = useSearchParams();
    const goTo = useWorkflowNavigate();

    // Bookmarks of the former in-page tabs (?tab=roles|links|results) land on the matching page.
    const legacyTab = searchParams.get('tab');
    if (legacyTab && legacyTab !== 'overview' && WORKFLOW_ROUTES[legacyTab]) return <Navigate to={WORKFLOW_ROUTES[legacyTab]} replace />;

    return (
        <WorkspacePage title="Assessment Management" description="Create job assessments, share assessment links, and review candidate results.">
            <OverviewKpis onNavigate={goTo} />
        </WorkspacePage>
    );
};

export default Dashboard;
