import React, { useCallback, useEffect, useState } from 'react';
import { Clock, Link2, Lock, Users } from 'lucide-react';
import ConfirmationModal from '../ConfirmationModal';
import { adminApi, errorMessage } from '../../services/recruitmentApi';
import { EmptyState, ErrorBanner, LoadingRow, PanelIntro, StatusBadge, Toast, cardCls, dangerGhostBtn, formatDate, ghostBtn, linkBtn, primaryBtn } from './adminUi';
import SharedLinkField from './SharedLinkField';
import ShareWithStudents from './ShareWithStudents';
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
    const [shareOpenId, setShareOpenId] = useState(null); // role whose optional "Share with Students" panel is open

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
        <section aria-label="Shared assessment links" className="space-y-5">
            <PanelIntro onRefresh={load} loading={loading}>Each published assessment has one reusable link, valid for 24 hours from its creation. Share it with every candidate; each candidate registers once and gets a single attempt.</PanelIntro>
            {error && <ErrorBanner onRetry={load}>{error}</ErrorBanner>}
            {loading && roles.length === 0 && <LoadingRow>Loading shared links...</LoadingRow>}
            {!loading && !error && roles.length === 0 && (
                <EmptyState icon={Link2} title="No shared links yet"
                    action={onNavigate && <button type="button" className={primaryBtn} onClick={() => onNavigate('roles')}>Go to Job Roles &amp; Blueprints</button>}>
                    A link is created when you publish a job role that has a valid blueprint.
                </EmptyState>
            )}
            <div className="space-y-4">
                {roles.map((role) => (
                    <article key={role.id} className={`${cardCls} p-5 border-l-[3px] ${role.status === 'PUBLISHED' ? 'border-l-[#5d8c2c] dark:border-l-emerald-500' : 'border-l-red-300 dark:border-l-red-800'}`}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-x-3 gap-y-1.5 min-w-0 flex-wrap">
                                <h3 className="pw-card-title text-[17px] truncate max-w-full">{role.title}</h3>
                                <StatusBadge status={role.status} />
                                <span className="inline-flex items-center gap-1 text-[13px] text-slate-500 dark:text-slate-400"><Users size={13} aria-hidden="true" />{role.registration_count ?? 0} registered</span>
                            </div>
                            {role.status === 'PUBLISHED'
                                ? <div className="flex flex-wrap gap-2">
                                    <button type="button" className={ghostBtn} aria-expanded={shareOpenId === role.id} onClick={() => setShareOpenId(shareOpenId === role.id ? null : role.id)}><Users size={14} aria-hidden="true" /> Share with Students</button>
                                    <button type="button" className={dangerGhostBtn} disabled={busyId === role.id} onClick={() => setCloseTarget(role)}><Lock size={14} aria-hidden="true" /> Close</button>
                                </div>
                                : <button type="button" className={primaryBtn} disabled={busyId === role.id} onClick={() => reopen(role)}>Reopen</button>}
                        </div>
                        {role.status === 'PUBLISHED' && <div className="mt-4"><SharedLinkField role={role} onCopy={onCopied} /></div>}
                        {role.status === 'PUBLISHED' && shareOpenId === role.id && <ShareWithStudents role={role} onToast={setToast} />}
                        {role.status === 'CLOSED' && <p className="mt-3 text-[13px] leading-5 text-slate-500 dark:text-slate-400">Closed: the link no longer accepts new candidates. Reopen to make the same link work again.</p>}
                        <p className="mt-3 flex items-center gap-1.5 text-[13px] leading-5 text-slate-500 dark:text-slate-400" data-testid="link-expiry"><Clock size={13} className="shrink-0" aria-hidden="true" /><span>{expiryNote(role, formatDate)}</span></p>
                    </article>
                ))}
            </div>
            {expiredCount > 0 && (
                <p className="text-[13px] leading-5 text-slate-500 dark:text-slate-400" data-testid="expired-links-note">
                    {expiredCount} expired link{expiredCount === 1 ? ' is' : 's are'} hidden.
                    {onNavigate && <> <button type="button" className={linkBtn} onClick={() => onNavigate('roles')}>Create a new link in Job Roles &amp; Blueprints</button>.</>}
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
