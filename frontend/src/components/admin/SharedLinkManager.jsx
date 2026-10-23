import React, { useCallback, useEffect, useState } from 'react';
import { Link2, Lock } from 'lucide-react';
import ConfirmationModal from '../ConfirmationModal';
import { adminApi, errorMessage } from '../../services/recruitmentApi';
import { EmptyState, ErrorBanner, LoadingRow, PanelIntro, StatusBadge, Toast, cardCls, formatDate, ghostBtn, primaryBtn } from './adminUi';
import SharedLinkField from './SharedLinkField';
import { activeLinkRoles, expiredLinkRoles, expiryNote } from './shareLinks';

/**
 * Owns the reusable shared link of every published job: copy, preview, close and reopen. Publishing and creating a new link after
 * expiry happen in Job Roles & Blueprints. Links expire 24 hours after creation (decided by the server); expired links are hidden.
 */
const SharedLinkManager = ({ refreshKey = 0, onChanged, onNavigate }) => {
    const [allRoles, setRoles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [toast, setToast] = useState(null);
    const [closeTarget, setCloseTarget] = useState(null);
    const [busyId, setBusyId] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const all = await adminApi.listRoles();
            setRoles(all);
        } catch (err) {
            setError(errorMessage(err, 'Unable to load shared links.'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load, refreshKey]);

    const roles = activeLinkRoles(allRoles);
    const expiredCount = expiredLinkRoles(allRoles).length;

    const onCopied = (ok) => {
        setToast(ok ? { message: 'Assessment link copied to clipboard.' } : { type: 'error', message: 'Copy failed. Select the link and copy it manually.' });
    };

    const reopen = async (role) => {
        setBusyId(role.id);
        try {
            await adminApi.publishRole(role.id);
            setToast({ message: 'Assessment reopened. The original link works again.' });
            load();
            if (onChanged) onChanged();
        } catch (err) {
            setToast({ type: 'error', message: errorMessage(err, 'Unable to reopen.') });
            load();
        } finally {
            setBusyId(null);
        }
    };

    const close = async () => {
        const role = closeTarget;
        setCloseTarget(null);
        setBusyId(role.id);
        try {
            await adminApi.closeRole(role.id);
            setToast({ message: 'Assessment closed to new candidates.' });
            load();
            if (onChanged) onChanged();
        } catch (err) {
            setToast({ type: 'error', message: errorMessage(err, 'Unable to close.') });
        } finally {
            setBusyId(null);
        }
    };

    return (
        <section aria-label="Shared assessment links" className="space-y-4">
            <PanelIntro onRefresh={load} loading={loading}>Each published assessment has one reusable link, valid for 24 hours from its creation. Share it with every candidate; each candidate registers once and gets a single attempt.</PanelIntro>
            {error && <ErrorBanner onRetry={load}>{error}</ErrorBanner>}
            {loading && roles.length === 0 && <LoadingRow>Loading shared links...</LoadingRow>}
            {!loading && !error && roles.length === 0 && (
                <EmptyState icon={Link2} title="No shared links yet"
                    action={onNavigate && <button type="button" className={primaryBtn} onClick={() => onNavigate('roles')}>Go to Job Roles &amp; Blueprints</button>}>
                    A link is created when you publish a job role that has a valid blueprint.
                </EmptyState>
            )}
            <div className="space-y-3">
                {roles.map((role) => (
                    <article key={role.id} className={`${cardCls} p-5`}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                <h3 className="font-extrabold text-slate-900 dark:text-white truncate">{role.title}</h3>
                                <StatusBadge status={role.status} />
                                <span className="text-xs text-slate-500">{role.registration_count ?? 0} registered</span>
                            </div>
                            {role.status === 'PUBLISHED'
                                ? <button type="button" className={ghostBtn} disabled={busyId === role.id} onClick={() => setCloseTarget(role)}><Lock size={14} /> Close</button>
                                : <button type="button" className={primaryBtn} disabled={busyId === role.id} onClick={() => reopen(role)}>Reopen</button>}
                        </div>
                        {role.status === 'PUBLISHED' && <div className="mt-3"><SharedLinkField role={role} onCopy={onCopied} /></div>}
                        {role.status === 'CLOSED' && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Closed: the link no longer accepts new candidates. Reopen to make the same link work again.</p>}
                        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400" data-testid="link-expiry">{expiryNote(role, formatDate)}</p>
                    </article>
                ))}
            </div>
            {expiredCount > 0 && (
                <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="expired-links-note">
                    {expiredCount} expired link{expiredCount === 1 ? ' is' : 's are'} hidden.
                    {onNavigate && <> <button type="button" className="font-semibold text-[#4c7324] dark:text-[#9fd05a] hover:underline" onClick={() => onNavigate('roles')}>Create a new link in Job Roles &amp; Blueprints</button>.</>}
                </p>
            )}
            <ConfirmationModal
                isOpen={!!closeTarget} onClose={() => setCloseTarget(null)} onConfirm={close} type="warning"
                title="Close this assessment?" confirmText="Close assessment"
                message="The link immediately stops accepting registrations and new attempts. Candidates already sitting the assessment are not affected."
            />
            <Toast toast={toast} onClose={() => setToast(null)} />
        </section>
    );
};

export default SharedLinkManager;
