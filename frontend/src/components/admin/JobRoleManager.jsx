import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Sparkles, Eye, Rocket, Link2, Briefcase, Loader2, Pencil, ChevronDown, ChevronUp, RefreshCw, AlertCircle } from 'lucide-react';
import { adminApi, errorMessage } from '../../services/recruitmentApi';
import JobDescriptionInput from './JobDescriptionInput';
import { isLinkExpired } from './shareLinks';
import { EmptyState, ErrorBanner, LoadingRow, PanelIntro, StatusBadge, Toast, cardCls, ghostBtn, inputCls, primaryBtn } from './adminUi';

const MIN_JD_CHARS = 50;

const SOURCE_BADGES = {
    gemini: { label: 'Gemini', cls: 'bg-[#5d8c2c]/15 text-[#4c7324] border-[#5d8c2c]/30 dark:text-[#9fd05a]' },
    offline_fixture: { label: 'Offline test data', cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' },
};

/** Where the blueprint came from (older blueprints, or an unrecognised source, show nothing). */
const SourceBadge = ({ source }) => {
    const meta = SOURCE_BADGES[source];
    return meta ? <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border whitespace-nowrap ${meta.cls}`}>{meta.label}</span> : null;
};

const BlueprintPreview = ({ blueprint, generation }) => {
    if (!blueprint) return null;
    return (
        <div className="mt-3 space-y-4 text-sm border-t border-slate-100 dark:border-slate-800 pt-3">
            <div>
                <p className="font-bold text-slate-900 dark:text-white">{blueprint.role_title} <span className="text-xs font-semibold text-slate-500">· {blueprint.seniority_level}</span></p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Skills: {(blueprint.required_technical_skills || []).join(', ') || '—'}</p>
            </div>
            <details className="group">
                <summary className="cursor-pointer font-bold text-slate-800 dark:text-slate-200">Aptitude ({blueprint.aptitude_questions.length} questions)</summary>
                <ol className="list-decimal pl-5 mt-2 space-y-2">
                    {blueprint.aptitude_questions.map((q) => (
                        <li key={q.id}><span className="font-semibold">{q.question}</span>
                            <ul className="pl-3 text-xs text-slate-600 dark:text-slate-400">
                                {Object.entries(q.options).map(([k, v]) => <li key={k} className={k === q.correct_key ? 'font-bold text-[#4c7324] dark:text-[#9fd05a]' : ''}>{k}. {v}{k === q.correct_key ? '  ✓ correct' : ''}</li>)}
                            </ul></li>
                    ))}
                </ol>
            </details>
            <details>
                <summary className="cursor-pointer font-bold text-slate-800 dark:text-slate-200">Coding ({blueprint.coding_problems.length} problems)</summary>
                <ul className="mt-2 space-y-2">
                    {blueprint.coding_problems.map((p) => (
                        <li key={p.id} className="rounded-lg bg-slate-50 dark:bg-slate-950 p-3">
                            <p className="font-semibold">{p.title} <span className="text-xs text-slate-500">· {p.difficulty}</span></p>
                            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 whitespace-pre-wrap">{p.description}</p>
                            <p className="text-[11px] text-slate-500 mt-1">{p.public_test_cases.length} public / {p.hidden_test_cases.length} hidden test cases</p>
                        </li>
                    ))}
                </ul>
            </details>
            <details>
                <summary className="cursor-pointer font-bold text-slate-800 dark:text-slate-200">Interview ({blueprint.interview_questions.length} questions)</summary>
                <ol className="list-decimal pl-5 mt-2 space-y-1.5">
                    {blueprint.interview_questions.map((q) => <li key={q.id}><span className="font-semibold">{q.question_text}</span> <span className="text-xs text-slate-500">({q.topic})</span></li>)}
                </ol>
            </details>
        </div>
    );
};

/** Owns: create job role -> generate blueprint -> review -> publish. The published link itself (copy / close / reopen) lives in Shared Links; a new link after expiry is created here. */
const JobRoleManager = ({ onChanged, onNavigate }) => {
    const [roles, setRoles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [form, setForm] = useState({ title: '', role: '', description: '' });
    const [formError, setFormError] = useState('');
    const [creating, setCreating] = useState(false);
    const [formKey, setFormKey] = useState(0); // remounts the description input (clears an uploaded file) after a role is created
    const [formOpen, setFormOpen] = useState(null); // null = automatic: open while there are no job roles yet
    const [busy, setBusy] = useState({});
    const [openBlueprint, setOpenBlueprint] = useState(null);
    const [blueprintData, setBlueprintData] = useState({});
    const [editing, setEditing] = useState(null);
    const [editText, setEditText] = useState('');
    const [toast, setToast] = useState(null);
    const [genErrors, setGenErrors] = useState({}); // blueprint-generation failures stay on the role card until the next attempt
    const [confirmUpdate, setConfirmUpdate] = useState(null); // role.id when showing update-version explanation

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError('');
        try {
            setRoles(await adminApi.listRoles());
        } catch (err) {
            setLoadError(errorMessage(err, 'Unable to load job roles.'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const changed = () => { load(); if (onChanged) onChanged(); };
    const mark = (id, action) => setBusy((b) => ({ ...b, [id]: action }));

    const createRole = async (e) => {
        e.preventDefault();
        setFormError('');
        if (form.title.trim().length < 2) return setFormError('Enter a job title.');
        if (form.description.trim().length < MIN_JD_CHARS) return setFormError(`The job description needs at least ${MIN_JD_CHARS} characters of substantive detail.`);
        setCreating(true);
        try {
            await adminApi.createRole({ title: form.title.trim(), role: form.role.trim() || undefined, description: form.description.trim() });
            setForm({ title: '', role: '', description: '' });
            setFormKey((k) => k + 1);
            setFormOpen(false);
            setToast({ message: 'Job role created. Create its assessment blueprint next.' });
            changed();
        } catch (err) {
            setFormError(errorMessage(err, 'Unable to create the job role.'));
        } finally {
            setCreating(false);
        }
    };

    const generate = async (role) => {
        mark(role.id, 'generate');
        setGenErrors((e) => ({ ...e, [role.id]: null }));
        const isUpdate = Boolean(role.blueprint?.valid);
        try {
            const res = await adminApi.generateBlueprint(role.id);
            setBlueprintData((d) => ({ ...d, [role.id]: res.blueprint_data }));
            setToast({ message: isUpdate ? `Assessment updated successfully. Blueprint v${res.blueprint_version} generated and validated.` : `Assessment created successfully. Blueprint v${res.blueprint_version} generated and validated.` });
            changed();
        } catch (err) {
            const status = err?.response?.status;
            const message = status === 502 ? `${errorMessage(err)} Nothing was changed.` : errorMessage(err, 'Assessment creation failed.');
            setGenErrors((e) => ({ ...e, [role.id]: message }));
            setToast({ type: 'error', message });
        } finally {
            mark(role.id, null);
        }
    };

    const toggleBlueprint = async (role) => {
        if (openBlueprint === role.id) return setOpenBlueprint(null);
        setOpenBlueprint(role.id);
        if (!blueprintData[role.id]) {
            try {
                const full = await adminApi.getRole(role.id);
                setBlueprintData((d) => ({ ...d, [role.id]: full.blueprint_data }));
            } catch (err) {
                setToast({ type: 'error', message: errorMessage(err, 'Unable to load the blueprint.') });
            }
        }
    };

    const publish = async (role) => {
        mark(role.id, 'publish');
        try {
            await adminApi.publishRole(role.id);
            setToast({ message: 'Published. Your shared link is ready in Shared Links.' });
            changed();
        } catch (err) {
            setToast({ type: 'error', message: errorMessage(err, 'Unable to publish.') });
        } finally {
            mark(role.id, null);
        }
    };

    const renewLink = async (role) => {
        mark(role.id, 'renew');
        try {
            await adminApi.newShareLink(role.id);
            setToast({ message: 'New link created. It is valid for 24 hours; find it in Shared Links.' });
            changed();
        } catch (err) {
            setToast({ type: 'error', message: errorMessage(err, 'Unable to create a new link.') });
            changed();
        } finally {
            mark(role.id, null);
        }
    };

    const saveEdit = async (role) => {
        if (editText.trim().length < MIN_JD_CHARS) return setToast({ type: 'error', message: `The job description needs at least ${MIN_JD_CHARS} characters.` });
        mark(role.id, 'edit');
        try {
            await adminApi.updateRole(role.id, { description: editText.trim() });
            setEditing(null);
            setToast({ message: 'Job description updated. Update the assessment to create a new version.' });
            changed();
        } catch (err) {
            setToast({ type: 'error', message: errorMessage(err, 'Unable to save.') });
        } finally {
            mark(role.id, null);
        }
    };

    const formVisible = formOpen ?? (!loading && !loadError && roles.length === 0);

    return (
        <section aria-label="Job roles and blueprinting" className="space-y-6">
            <PanelIntro>Create a job role, generate its assessment blueprint, review it, then publish to get the shared link (valid for 24 hours).</PanelIntro>
            {!formVisible && (
                <div className="flex justify-end">
                    <button type="button" className={primaryBtn} onClick={() => setFormOpen(true)}><Plus size={15} /> New job role</button>
                </div>
            )}
            {formVisible && <form onSubmit={createRole} className={`${cardCls} p-5 space-y-3`} noValidate>
                <h2 className="text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2"><Plus size={18} className="text-[#5d8c2c]" /> New Job Role</h2>
                <div className="grid sm:grid-cols-2 gap-3">
                    <label className="block"><span className="text-xs font-bold text-slate-600 dark:text-slate-300">Job title</span>
                        <input className={`${inputCls} mt-1`} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={200} placeholder="e.g. Senior Backend Engineer" /></label>
                    <label className="block"><span className="text-xs font-bold text-slate-600 dark:text-slate-300">Role / team (optional)</span>
                        <input className={`${inputCls} mt-1`} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} maxLength={200} placeholder="e.g. Platform Engineering" /></label>
                </div>
                <JobDescriptionInput key={formKey} value={form.description} onChange={(description) => setForm((f) => ({ ...f, description }))} minChars={MIN_JD_CHARS} />
                {formError && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{formError}</p>}
                <div className="flex gap-2">
                    <button type="submit" className={primaryBtn} disabled={creating}>{creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Create job role</button>
                    {roles.length > 0 && <button type="button" className={ghostBtn} onClick={() => setFormOpen(false)}>Cancel</button>}
                </div>
            </form>}

            {loadError && <ErrorBanner onRetry={load}>{loadError}</ErrorBanner>}
            {loading && roles.length === 0 && <LoadingRow>Loading job roles...</LoadingRow>}
            {!loading && !loadError && roles.length === 0 && <EmptyState icon={Briefcase} title="No job roles yet">Fill in the form above to create your first job role.</EmptyState>}

            <div className="space-y-3">
                {roles.map((role) => {
                    const hasValidBlueprint = role.blueprint?.valid;
                    const b = busy[role.id];
                    return (
                        <article key={role.id} className={`${cardCls} p-5`}>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h3 className="font-extrabold text-slate-900 dark:text-white truncate">{role.title}</h3>
                                        <StatusBadge status={isLinkExpired(role) ? 'EXPIRED' : role.status} />
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
                                        {hasValidBlueprint && <SourceBadge source={role.blueprint.source} />}
                                        <span>{hasValidBlueprint
                                            ? `Blueprint v${role.blueprint.version} · ${role.blueprint.aptitude_count} aptitude · ${role.blueprint.coding_count} coding · ${role.blueprint.interview_count} interview`
                                            : 'No valid blueprint yet'}
                                        {typeof role.registration_count === 'number' ? ` · ${role.registration_count} registered` : ''}</span>
                                    </p>
                                    {!hasValidBlueprint && (
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                                            Assessment will be created from the job description.
                                        </p>
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <button type="button" className={ghostBtn} onClick={() => { setEditing(editing === role.id ? null : role.id); setEditText(role.description || ''); }}><Pencil size={14} /> Edit JD</button>
                                    <button type="button" className={hasValidBlueprint ? ghostBtn : primaryBtn} disabled={!!b} onClick={() => (hasValidBlueprint ? setConfirmUpdate(confirmUpdate === role.id ? null : role.id) : generate(role))} title={hasValidBlueprint ? 'Update this assessment (creates a new version)' : 'Create assessment from job description'}>{b === 'generate' ? <Loader2 size={14} className="animate-spin" /> : (hasValidBlueprint ? <RefreshCw size={14} /> : <Sparkles size={14} />)} {b === 'generate' ? (hasValidBlueprint ? 'Updating assessment...' : 'Creating assessment...') : (hasValidBlueprint ? 'Update Assessment' : 'Create Assessment')}</button>
                                    {hasValidBlueprint && <button type="button" className={ghostBtn} onClick={() => toggleBlueprint(role)} aria-expanded={openBlueprint === role.id}><Eye size={14} /> {openBlueprint === role.id ? 'Hide' : 'Preview Assessment'} {openBlueprint === role.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</button>}
                                    {role.status === 'DRAFT' && <button type="button" className={primaryBtn} disabled={!hasValidBlueprint || !!b} onClick={() => publish(role)} title={hasValidBlueprint ? '' : 'Create an assessment first'}>{b === 'publish' ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />} Publish</button>}
                                    {role.status !== 'DRAFT' && (onNavigate || isLinkExpired(role)) && <button type="button" className={role.status === 'PUBLISHED' || isLinkExpired(role) ? primaryBtn : ghostBtn} disabled={!!b} onClick={() => (isLinkExpired(role) ? renewLink(role) : onNavigate('links'))}>{b === 'renew' ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} {isLinkExpired(role) ? 'Create new link' : role.status === 'PUBLISHED' ? 'Get shared link' : 'Manage link'}</button>}
                                </div>
                            </div>
                            {genErrors[role.id] && (
                                <div className="mt-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 px-3.5 py-2.5 text-sm flex items-center justify-between gap-2" role="alert">
                                    <span>{genErrors[role.id]}</span>
                                    <button
                                        type="button"
                                        className="text-xs font-bold underline hover:no-underline shrink-0 text-red-800 dark:text-red-200 cursor-pointer"
                                        onClick={() => generate(role)}
                                        disabled={!!b}
                                    >
                                        Retry
                                    </button>
                                </div>
                            )}
                            {confirmUpdate === role.id && (
                                <div className="mt-3 p-3.5 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-900 dark:text-amber-200 flex flex-wrap items-center justify-between gap-3" role="status">
                                    <div className="flex items-start gap-2 max-w-xl">
                                        <AlertCircle size={15} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                        <p>
                                            <strong>Update Assessment:</strong> A new version may replace or supersede the current blueprint version. Existing candidates and shared links will use the updated assessment.
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <button
                                            type="button"
                                            className={primaryBtn}
                                            disabled={b === 'generate'}
                                            onClick={() => { setConfirmUpdate(null); generate(role); }}
                                        >
                                            {b === 'generate' ? <Loader2 size={13} className="animate-spin" /> : null} Confirm & Update
                                        </button>
                                        <button
                                            type="button"
                                            className={ghostBtn}
                                            disabled={b === 'generate'}
                                            onClick={() => setConfirmUpdate(null)}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}
                            {editing === role.id && (
                                <div className="mt-3 space-y-2">
                                    <textarea className={inputCls} rows={6} value={editText} onChange={(e) => setEditText(e.target.value)} aria-label="Job description" />
                                    <div className="flex gap-2">
                                        <button type="button" className={primaryBtn} disabled={b === 'edit'} onClick={() => saveEdit(role)}>Save</button>
                                        <button type="button" className={ghostBtn} onClick={() => setEditing(null)}>Cancel</button>
                                    </div>
                                </div>
                            )}
                            {openBlueprint === role.id && <BlueprintPreview blueprint={blueprintData[role.id]} generation={blueprintData[role.id]?.generation} />}
                        </article>
                    );
                })}
            </div>

            <Toast toast={toast} onClose={() => setToast(null)} />
        </section>
    );
};

export default JobRoleManager;
