import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

// The four stages of the recruitment workflow: one sidebar entry and one route each.
export const WORKFLOW_ROUTES = {
    overview: '/admin/dashboard',
    roles: '/admin/job-roles',
    links: '/admin/shared-links',
    results: '/admin/candidate-results',
    users: '/admin/users',
};

/** Returns goTo('roles' | 'links' | 'results' | 'overview'), used by empty states and next-step actions. */
export const useWorkflowNavigate = () => {
    const navigate = useNavigate();
    return useCallback((stage) => navigate(WORKFLOW_ROUTES[stage] || WORKFLOW_ROUTES.overview), [navigate]);
};
