import React from 'react';
import SharedLinkManager from '../../components/admin/SharedLinkManager';
import WorkspacePage from '../../components/admin/WorkspacePage';
import { useWorkflowNavigate } from '../../components/admin/workflowRoutes';

/** Stage 3: copy, preview, close and reopen the shared assessment links (/admin/shared-links). */
const SharedLinksPage = () => {
    const goTo = useWorkflowNavigate();
    return (
        <WorkspacePage title="Shared Links">
            <SharedLinkManager onNavigate={goTo} />
        </WorkspacePage>
    );
};

export default SharedLinksPage;
