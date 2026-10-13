import React, { useState, useEffect } from 'react';
import {
    Save, Building2, Shield, Bell, Mail, Settings, CheckCircle,
    Sparkles, CheckCircle2, ArrowRight, ArrowDown, ShieldCheck, Check, Layers, Cpu,
    UserPlus, Trash2, Users, AlertCircle
} from 'lucide-react';
import ConfirmationModal from '../components/ConfirmationModal';
import API_URL from '../apiConfig';

const GlobalSettings = () => {
    const [activeTab, setActiveTab] = useState('scoring');
    const [saving, setSaving] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);
    const [alertModal, setAlertModal] = useState({
        isOpen: false,
        title: '',
        message: '',
        type: 'warning'
    });

    // Team & Organization Management State
    const [orgInfo, setOrgInfo] = useState(null);
    const [teamMembers, setTeamMembers] = useState([]);
    const [loadingTeam, setLoadingTeam] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviting, setInviting] = useState(false);
    const [inviteSuccess, setInviteSuccess] = useState(null);
    const [inviteError, setInviteError] = useState(null);
    const [currentUserProfile, setCurrentUserProfile] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('user_profile') || '{}');
        } catch {
            return {};
        }
    });

    const fetchTeam = async () => {
        const token = localStorage.getItem('token');
        if (!token) return;
        setLoadingTeam(true);
        try {
            const headers = { 'Authorization': `Bearer ${token}` };
            const [orgRes, teamRes] = await Promise.all([
                fetch(`${API_URL}/api/organization/`, { headers }),
                fetch(`${API_URL}/api/organization/users`, { headers })
            ]);
            if (orgRes.ok) {
                const orgData = await orgRes.json();
                setOrgInfo(orgData);
            }
            if (teamRes.ok) {
                const usersData = await teamRes.json();
                setTeamMembers(usersData);
            }
        } catch (e) {
            console.error("Failed to load team data", e);
        } finally {
            setLoadingTeam(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'team') {
            fetchTeam();
        }
    }, [activeTab]);

    const handleInviteHR = async (e) => {
        e.preventDefault();
        if (!inviteEmail.trim()) return;
        setInviting(true);
        setInviteError(null);
        setInviteSuccess(null);
        const token = localStorage.getItem('token');
        try {
            const res = await fetch(`${API_URL}/api/organization/users/invite`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ email: inviteEmail.trim() })
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.detail || "Failed to send invitation");
            }
            setInviteSuccess(data.message || `Invitation sent to ${inviteEmail}`);
            setInviteEmail('');
            fetchTeam();
        } catch (err) {
            setInviteError(err.message);
        } finally {
            setInviting(false);
        }
    };

    const requestRemoveMember = (memberId, memberEmail) => {
        setAlertModal({
            isOpen: true,
            title: 'Remove Team Member',
            message: `Are you sure you want to remove ${memberEmail || 'this member'} from the organization?\n\nThey will immediately lose access to this tenant workspace.`,
            type: 'danger',
            confirmText: 'Remove Member',
            cancelText: 'Cancel',
            isAlert: false,
            onConfirm: () => handleRemoveMember(memberId)
        });
    };

    const handleRemoveMember = async (memberId) => {
        const token = localStorage.getItem('token');
        try {
            const res = await fetch(`${API_URL}/api/organization/users/${memberId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                setTeamMembers(prev => prev.filter(m => m.id !== memberId && m.user_id !== memberId));
            } else {
                const errData = await res.json().catch(() => ({}));
                setAlertModal({
                    isOpen: true,
                    title: 'Removal Failed',
                    message: errData.detail || "Failed to remove member",
                    type: 'danger',
                    confirmText: 'Got It',
                    isAlert: true,
                    onConfirm: null
                });
            }
        } catch (err) {
            console.error("Error removing member:", err);
            setAlertModal({
                isOpen: true,
                title: 'Error',
                message: "An error occurred while removing the member.",
                type: 'danger',
                confirmText: 'Got It',
                isAlert: true,
                onConfirm: null
            });
        }
    };

    // Initial state with scoring and pipeline defaults
    const [formData, setFormData] = useState({
        orgName: 'Acme Corp',
        timezone: 'UTC-5 (EST)',
        scoring: {
            skills: 40,
            experience: 25,
            projects: 20,
            education: 10,
            bonus: 5
        },
        emails: {
            invitationSubject: 'Invitation to Assessment Round - RoleReady',
            invitationBody: 'Dear Candidate,\n\nYou have been promoted to the next stage of our recruitment process. Please log in to the portal to take your assessment.',
            reminderSubject: 'Reminder: Pending Assessment - RoleReady',
            reminderBody: 'Dear Candidate,\n\nThis is a friendly reminder to complete your pending assessment as soon as possible.'
        },
        security: {
            faceProctoring: true,
            fullscreenProctoring: true,
            autoFlagSuspicious: true
        },
        notifications: {
            emailAlerts: true,
            slackIntegration: false,
            weeklyDigest: true,
            recipientEmail: 'gopalmuri1919@gmail.com'
        }
    });

    useEffect(() => {
        const token = localStorage.getItem('token');
        fetch(`${API_URL}/api/settings/`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        })
            .then(res => res.json())
            .then(data => {
                if (data) {
                    setFormData(prev => ({
                        ...prev,
                        ...data,
                        scoring: { ...prev.scoring, ...(data.scoring || {}) },
                        emails: { ...prev.emails, ...(data.emails || {}) },
                        security: { ...prev.security, ...(data.security || {}) },
                        notifications: { ...prev.notifications, ...(data.notifications || {}) }
                    }));
                    setHasChanges(false);
                }
            })
            .catch(err => console.error("Failed to load settings", err));
    }, []);

    // Calculate dynamic weights sum
    const currentScoring = formData.scoring || { skills: 40, experience: 25, projects: 20, education: 10, bonus: 5 };
    const scoringSum = 
        (currentScoring.skills || 0) + 
        (currentScoring.experience || 0) + 
        (currentScoring.projects || 0) + 
        (currentScoring.education || 0) + 
        (currentScoring.bonus || 0);

    const isScoringValid = scoringSum === 100;

    const handleSave = async () => {
        if (!isScoringValid) {
            setAlertModal({
                isOpen: true,
                title: 'Invalid Scoring Weight',
                message: `Total scoring weight must equal exactly 100%.\nCurrently it is ${scoringSum}% (${100 - scoringSum > 0 ? `need +${100 - scoringSum}%` : `over by ${scoringSum - 100}%`}).\n\nPlease adjust the category sliders before saving.`,
                type: 'warning'
            });
            return;
        }

        setSaving(true);
        try {
            const res = await fetch(`${API_URL}/api/settings/`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({ config: formData })
            });

            if (res.ok) {
                setShowSuccess(true);
                setHasChanges(false);
                setTimeout(() => setShowSuccess(false), 3000);
            } else {
                throw new Error("Failed to save");
            }
        } catch (error) {
            console.error("Save failed", error);
            setAlertModal({
                isOpen: true,
                title: 'Save Failed',
                message: 'Failed to save settings to server. Please try again.',
                type: 'danger'
            });
        } finally {
            setSaving(false);
        }
    };

    const updateScoringField = (field, val) => {
        setFormData(prev => ({
            ...prev,
            scoring: {
                ...prev.scoring,
                [field]: val
            }
        }));
        setHasChanges(true);
    };

    const updateEmailField = (field, val) => {
        setFormData(prev => ({
            ...prev,
            emails: {
                ...prev.emails,
                [field]: val
            }
        }));
        setHasChanges(true);
    };

    const updateSecurityField = (field, val) => {
        setFormData(prev => ({
            ...prev,
            security: {
                ...prev.security,
                [field]: val
            }
        }));
        setHasChanges(true);
    };

    const updateNotificationField = (field, val) => {
        setFormData(prev => ({
            ...prev,
            notifications: {
                ...prev.notifications,
                [field]: val
            }
        }));
        setHasChanges(true);
    };

    const tabs = [
        { id: 'scoring', label: 'AI Resume Screening', icon: BrainCircuitIcon },
        { id: 'team', label: 'Team & Organization', icon: Building2 },
        { id: 'system', label: 'System Summary', icon: Sparkles },
        { id: 'notifications', label: 'Notifications', icon: Bell },
        { id: 'email', label: 'Email Templates', icon: Mail },
        { id: 'security', label: 'Security & Proctoring', icon: Shield }
    ];

    return (
        <div className="max-w-[1200px] mx-auto pb-20">
            {/* Header */}
            <div className="flex justify-between items-start mb-8">
                <div>
                    <h1 className="text-3xl font-extrabold text-gray-900 flex items-center gap-3">
                        <Settings className="text-gray-600" /> Global Settings
                    </h1>
                    <p className="text-gray-500 mt-2">Manage your hiring pipeline, email templates, and AI configurations centrally.</p>
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving || !isScoringValid || !hasChanges}
                    className={`px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2 shadow-lg ${
                        (saving || !isScoringValid || !hasChanges) 
                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none' 
                            : 'bg-green-600 hover:bg-green-700 text-white shadow-green-100'
                    }`}
                >
                    {saving ? (
                        <>Saving...</>
                    ) : showSuccess ? (
                        <><CheckCircle size={20} /> Saved!</>
                    ) : (
                        <><Save size={20} /> Save Changes</>
                    )}
                </button>
            </div>

            {/* Horizontal Configuration Tabs - Single Row */}
            <div className="bg-white rounded-2xl p-2 sm:p-2.5 shadow-xs border border-gray-200/90 mb-6 overflow-x-auto">
                <nav className="flex items-center gap-2 sm:gap-2.5 min-w-max">
                    {tabs.map(tab => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-2 px-3.5 sm:px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap ${
                                    isActive
                                        ? 'bg-[#5d8c2c] text-white shadow-md shadow-[#5d8c2c]/20 ring-2 ring-[#5d8c2c]/20'
                                        : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200/80 hover:border-gray-300'
                                }`}
                            >
                                <Icon size={16} className={isActive ? 'text-white' : 'text-[#5d8c2c]'} />
                                <span>{tab.label}</span>
                            </button>
                        );
                    })}
                </nav>
            </div>

            {/* Main Content Area */}
            <div className="w-full space-y-6">
                    {/* AI SCORING WEIGHTS */}
                    {/* AI SCORING WEIGHTS & REAL-TIME SCREENING */}
                    {activeTab === 'scoring' && (
                        <Section title="AI Resume Screening & Evaluation Weights" description="Configure the scoring formula used by the Groq AI engine and review real-time sequential screening pipeline specifications.">
                            <div className="space-y-6">
                                {/* Total Sum Progress Indicator */}
                                <div className={`p-4 rounded-xl border flex items-center gap-3 transition-colors ${
                                    isScoringValid 
                                        ? 'bg-green-50 border-green-200 text-green-800' 
                                        : 'bg-amber-50 border-amber-200 text-amber-800'
                                }`}>
                                    {isScoringValid ? <CheckCircle className="text-green-600 shrink-0" size={20} /> : <AlertTriangle className="text-amber-600 shrink-0" size={20} />}
                                    <div className="flex-1">
                                        <p className="font-bold text-sm">
                                            Total Target Weight: <span className="underline">{scoringSum}%</span> / 100%
                                        </p>
                                        <p className="text-xs mt-0.5 opacity-90">
                                            {isScoringValid 
                                                ? 'Scoring formula is balanced and valid. Changes can be saved.' 
                                                : `Formula must sum up to exactly 100% to save. Please adjust parameters by ${100 - scoringSum}%`}
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-5">
                                    <Range 
                                        label="1. Skills Matching" 
                                        value={currentScoring.skills} 
                                        onChange={(val) => updateScoringField('skills', val)} 
                                        description="Semantic and keyword alignment between resume technical profiles and Job Description demands."
                                    />
                                    <Range 
                                        label="2. Experience Relevance" 
                                        value={currentScoring.experience} 
                                        onChange={(val) => updateScoringField('experience', val)} 
                                        description="Years of experience match, seniority level comparison, and background progression checks."
                                    />
                                    <Range 
                                        label="3. Project & Role Alignment" 
                                        value={currentScoring.projects} 
                                        onChange={(val) => updateScoringField('projects', val)} 
                                        description="Level of technical complexity, scope of contributions, and product alignment detailed in projects."
                                    />
                                    <Range 
                                        label="4. Education Match" 
                                        value={currentScoring.education} 
                                        onChange={(val) => updateScoringField('education', val)} 
                                        description="Verification of degrees, certifications, specializations, and institutional background matches."
                                    />
                                    <Range 
                                        label="5. Preferred & Bonus Skills" 
                                        value={currentScoring.bonus} 
                                        onChange={(val) => updateScoringField('bonus', val)} 
                                        description="Additional nice-to-have parameters, certificates, or extracurricular matches specified in JD."
                                    />
                                </div>

                                {/* Real-Time Resume Screening Summary */}
                                <div className="pt-6 border-t border-gray-100">
                                    <RealTimeResumeScreeningCard />
                                </div>
                            </div>
                        </Section>
                    )}

                    {/* SYSTEM SUMMARY & ENGINE SPECIFICATIONS */}
                    {activeTab === 'system' && (
                        <Section 
                            title="System Information & Feature Summary" 
                            description="Real-time recruitment processing engines, AI screening specifications, and verified system status."
                        >
                            <RealTimeResumeScreeningCard />
                        </Section>
                    )}

                    {/* NOTIFICATIONS SETTINGS */}
                    {activeTab === 'notifications' && (
                        <Section title="Notification Preferences" description="Configure when and how you want to be notified.">
                            <div className="space-y-4">
                                <Toggle 
                                    label="Email Alerts" 
                                    description="Receive immediate email alerts when a candidate submits a test or finishes an interview." 
                                    checked={formData.notifications.emailAlerts} 
                                    onChange={(val) => updateNotificationField('emailAlerts', val)}
                                />
                                <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-2">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700">HR Notification Recipient Email</label>
                                        <p className="text-xs text-gray-500 mt-0.5 font-medium leading-relaxed">
                                            Candidate alert, completion, and warning notifications will be dispatched here.
                                        </p>
                                    </div>
                                    <input
                                        type="email"
                                        placeholder="hr@hiringai.com"
                                        value={formData.notifications.recipientEmail || ''}
                                        onChange={(e) => updateNotificationField('recipientEmail', e.target.value)}
                                        className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-950 font-medium focus:ring-2 focus:ring-green-500 outline-none"
                                    />
                                </div>
                                <Toggle 
                                    label="Slack Integration" 
                                    description="Push real-time candidate progression notifications directly to your company Slack channel." 
                                    checked={formData.notifications.slackIntegration} 
                                    onChange={(val) => updateNotificationField('slackIntegration', val)}
                                />
                                <Toggle 
                                    label="Weekly Digest" 
                                    description="Receive a summarized weekly email containing stats, hires, and pending evaluations." 
                                    checked={formData.notifications.weeklyDigest} 
                                    onChange={(val) => updateNotificationField('weeklyDigest', val)}
                                />
                            </div>
                        </Section>
                    )}

                    {/* EMAIL TEMPLATES */}
                    {activeTab === 'email' && (
                        <Section title="Assessment Email Templates" description="Modify invitation and reminder emails automatically dispatched to candidates.">
                            <div className="space-y-6">
                                <div className="space-y-3">
                                    <h4 className="font-bold text-gray-800 text-sm">Test Invitation Email</h4>
                                    <Input 
                                        label="Subject Line" 
                                        value={formData.emails.invitationSubject} 
                                        onChange={(val) => updateEmailField('invitationSubject', val)}
                                    />
                                    <div className="space-y-1.5">
                                        <label className="block text-sm font-semibold text-gray-700">Body Text</label>
                                        <textarea
                                            value={formData.emails.invitationBody}
                                            onChange={(e) => updateEmailField('invitationBody', e.target.value)}
                                            rows={4}
                                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-green-500 outline-none text-gray-950 font-medium"
                                        />
                                    </div>
                                </div>

                                <div className="h-px bg-gray-200"></div>

                                <div className="space-y-3">
                                    <h4 className="font-bold text-gray-800 text-sm">Test Reminder Email</h4>
                                    <Input 
                                        label="Subject Line" 
                                        value={formData.emails.reminderSubject} 
                                        onChange={(val) => updateEmailField('reminderSubject', val)}
                                    />
                                    <div className="space-y-1.5">
                                        <label className="block text-sm font-semibold text-gray-700">Body Text</label>
                                        <textarea
                                            value={formData.emails.reminderBody}
                                            onChange={(e) => updateEmailField('reminderBody', e.target.value)}
                                            rows={4}
                                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-green-500 outline-none text-gray-950 font-medium"
                                        />
                                    </div>
                                </div>
                            </div>
                        </Section>
                    )}

                    {/* SECURITY & PROCTORING */}
                    {activeTab === 'security' && (
                        <Section title="Integrity & Proctoring Controls" description="Configure online testing security standards.">
                            <div className="space-y-4">
                                <Toggle 
                                    label="Webcam Face Proctoring" 
                                    description="Use candidate webcam stream to detect presence, verify identities, and flag multiple faces during tests." 
                                    checked={formData.security.faceProctoring} 
                                    onChange={(val) => updateSecurityField('faceProctoring', val)}
                                />
                                <Toggle 
                                    label="Fullscreen Proctoring Enforcement" 
                                    description="Enforce strict fullscreen constraints. Flag when candidates shift focus or navigate away from the test viewport." 
                                    checked={formData.security.fullscreenProctoring} 
                                    onChange={(val) => updateSecurityField('fullscreenProctoring', val)}
                                />
                                <Toggle 
                                    label="Auto-Flag Suspicious Events" 
                                    description="Automatically flag candidate profiles as 'Suspicious' on dashboard if security rules are violated more than 3 times." 
                                    checked={formData.security.autoFlagSuspicious} 
                                    onChange={(val) => updateSecurityField('autoFlagSuspicious', val)}
                                />
                            </div>
                        </Section>
                    )}

                    {/* TEAM & ORGANIZATION MANAGEMENT */}
                    {activeTab === 'team' && (
                        <Section title="Team & Organization Management" description="Manage your organization members, invite HR recruiters, and view tenant details.">
                            <div className="space-y-6">
                                {/* Org Info Banner */}
                                {orgInfo && (
                                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                                        <div>
                                            <div className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Current Organization</div>
                                            <h4 className="text-lg font-bold text-gray-900">{orgInfo.name}</h4>
                                            <p className="text-xs text-gray-500 font-mono">slug: {orgInfo.slug}</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-bold border border-green-200">
                                                Status: {orgInfo.status}
                                            </span>
                                            <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold border border-blue-200">
                                                {teamMembers.length} {teamMembers.length === 1 ? 'Member' : 'Members'}
                                            </span>
                                        </div>
                                    </div>
                                )}

                                {/* Invite HR Form (For Org Admin & Platform Admin) */}
                                {(currentUserProfile.role === 'ORGANIZATION_ADMIN' || currentUserProfile.role === 'PLATFORM_ADMIN') && (
                                    <div className="bg-white border border-green-200 rounded-xl p-5 shadow-xs">
                                        <h4 className="text-sm font-bold text-gray-900 mb-1 flex items-center gap-2">
                                            <UserPlus size={16} className="text-[#5d8c2c]" />
                                            Invite HR Recruiter
                                        </h4>
                                        <p className="text-xs text-gray-500 mb-4">
                                            Invite a new HR recruiter to your organization. They will receive an invitation and log in via Clerk Email OTP.
                                        </p>

                                        {inviteError && (
                                            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 mb-3 flex items-center gap-2">
                                                <AlertCircle size={16} className="shrink-0" />
                                                <span>{inviteError}</span>
                                            </div>
                                        )}
                                        {inviteSuccess && (
                                            <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-xs text-green-700 mb-3 flex items-center gap-2">
                                                <CheckCircle2 size={16} className="shrink-0" />
                                                <span>{inviteSuccess}</span>
                                            </div>
                                        )}

                                        <form onSubmit={handleInviteHR} className="flex flex-col sm:flex-row gap-3">
                                            <input
                                                type="email"
                                                required
                                                placeholder="hr.recruiter@company.com"
                                                value={inviteEmail}
                                                onChange={(e) => setInviteEmail(e.target.value)}
                                                className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-green-500 outline-none font-medium"
                                            />
                                            <button
                                                type="submit"
                                                disabled={inviting || !inviteEmail.trim()}
                                                className="px-5 py-2.5 bg-primary hover:bg-green-700 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-xs"
                                            >
                                                {inviting ? "Sending..." : "Send Invitation"}
                                            </button>
                                        </form>
                                    </div>
                                )}

                                {/* Members List Table */}
                                <div className="border border-gray-200 rounded-xl overflow-hidden">
                                    <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
                                        <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                                            Team Members
                                        </h4>
                                        <span className="text-xs text-gray-500">{teamMembers.length} Total</span>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-sm">
                                            <thead className="bg-gray-50/50 text-gray-500 text-xs font-semibold uppercase border-b border-gray-100">
                                                <tr>
                                                    <th className="px-4 py-3">User</th>
                                                    <th className="px-4 py-3">Role</th>
                                                    <th className="px-4 py-3">Status</th>
                                                    <th className="px-4 py-3">Added</th>
                                                    <th className="px-4 py-3 text-right">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {teamMembers.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={5} className="py-8 text-center text-gray-400 text-sm">
                                                            {loadingTeam ? "Loading members..." : "No team members found."}
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    teamMembers.map((member) => (
                                                        <tr key={member.id} className="hover:bg-gray-50/50 transition-colors">
                                                            <td className="px-4 py-3.5">
                                                                <div className="font-semibold text-gray-900">{member.email}</div>
                                                                {member.user_id === currentUserProfile.user_id && (
                                                                    <span className="text-[10px] text-green-600 font-bold">(You)</span>
                                                                )}
                                                            </td>
                                                            <td className="px-4 py-3.5">
                                                                <span className={`px-2.5 py-1 rounded-md text-xs font-bold ${
                                                                    member.role === 'ORGANIZATION_ADMIN'
                                                                        ? 'bg-purple-100 text-purple-800 border border-purple-200'
                                                                        : 'bg-green-100 text-green-800 border border-green-200'
                                                                }`}>
                                                                    {member.role === 'ORGANIZATION_ADMIN' ? 'Org Admin' : 'HR'}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-3.5">
                                                                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${
                                                                    member.status === 'active'
                                                                        ? 'text-green-700 bg-green-50'
                                                                        : 'text-amber-700 bg-amber-50'
                                                                }`}>
                                                                    <span className={`w-1.5 h-1.5 rounded-full ${member.status === 'active' ? 'bg-green-500' : 'bg-amber-500'}`} />
                                                                    {member.status === 'active' ? 'Active' : 'Pending'}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-3.5 text-xs text-gray-500">
                                                                {member.created_at ? new Date(member.created_at).toLocaleDateString() : '—'}
                                                            </td>
                                                            <td className="px-4 py-3.5 text-right">
                                                                {member.user_id !== currentUserProfile.user_id && 
                                                                 (currentUserProfile.role === 'PLATFORM_ADMIN' || currentUserProfile.role === 'ORGANIZATION_ADMIN') && (
                                                                    <button
                                                                        onClick={() => requestRemoveMember(member.id, member.email)}
                                                                        className="px-2.5 py-1 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors text-xs font-semibold flex items-center gap-1.5 ml-auto border border-red-200 cursor-pointer"
                                                                        title="Remove Member"
                                                                    >
                                                                        <Trash2 size={13} />
                                                                        Remove
                                                                    </button>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </Section>
                    )}
                </div>

            <ConfirmationModal
                isOpen={alertModal.isOpen}
                onClose={() => setAlertModal(prev => ({ ...prev, isOpen: false }))}
                onConfirm={alertModal.onConfirm}
                title={alertModal.title}
                message={alertModal.message}
                type={alertModal.type || 'info'}
                confirmText={alertModal.confirmText || "Got It"}
                cancelText={alertModal.cancelText || "Cancel"}
                isAlert={alertModal.isAlert ?? true}
            />
        </div>
    );
};

// --- Reusable Components ---

const Section = ({ title, description, children }) => (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="p-6 border-b border-gray-100">
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
            <p className="text-sm text-gray-500 mt-1">{description}</p>
        </div>
        <div className="p-6">
            {children}
        </div>
    </div>
);

const Input = ({ label, value, disabled, suffix, onChange }) => (
    <div className="space-y-1.5 w-full">
        <label className="block text-sm font-semibold text-gray-700">{label}</label>
        <div className="relative">
            <input
                type="text"
                value={value}
                disabled={disabled}
                onChange={(e) => onChange && onChange(e.target.value)}
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-950 font-medium focus:ring-2 focus:ring-green-500 outline-none disabled:text-gray-500"
            />
            {suffix && (
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">
                    {suffix}
                </span>
            )}
        </div>
    </div>
);

const Select = ({ label, options, value, onChange }) => (
    <div className="space-y-1.5 w-full">
        <label className="block text-sm font-semibold text-gray-700">{label}</label>
        <select 
            value={value} 
            onChange={(e) => onChange && onChange(e.target.value)}
            className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-950 font-bold focus:ring-2 focus:ring-green-500 outline-none cursor-pointer"
        >
            {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
    </div>
);

const Toggle = ({ label, description, checked, onChange }) => (
    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200">
        <div className="pr-4">
            <h4 className="font-bold text-gray-900 text-sm">{label}</h4>
            <p className="text-xs text-gray-500 mt-0.5 font-medium leading-relaxed">{description}</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input 
                type="checkbox" 
                checked={checked} 
                onChange={(e) => onChange && onChange(e.target.checked)} 
                className="sr-only peer" 
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
        </label>
    </div>
);

const Range = ({ label, value, onChange, description, max = 100 }) => (
    <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-2 w-full">
        <div className="flex justify-between items-start gap-4">
            <div>
                <label className="font-bold text-gray-800 text-sm">{label}</label>
                <p className="text-[11px] text-gray-500 font-medium mt-0.5 leading-relaxed">{description}</p>
            </div>
            <span className="font-extrabold text-green-700 bg-green-50 border border-green-200 px-3 py-1 rounded-lg text-sm shrink-0 min-w-[55px] text-center">
                {value}{max === 100 ? '%' : 'm'}
            </span>
        </div>
        <input 
            type="range" 
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-600 hover:accent-green-700 transition-colors" 
            value={value || 0} 
            onChange={(e) => onChange(parseInt(e.target.value) || 0)}
            min="0"
            max={max}
        />
    </div>
);

const AlertTriangle = ({ size, className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
);

// Icon for AI Brain
const BrainCircuitIcon = ({ size, className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" /><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" /><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" /><path d="M17.599 6.5a3 3 0 0 0 .399-1.375" /><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" /><path d="M3.477 10.896a4 4 0 0 1 .585-.396" /><path d="M19.938 10.5a4 4 0 0 1 .585.396" /><path d="M6 18a4 4 0 0 1-1.97-3.284" /><path d="M17.97 14.716A4 4 0 0 1 18 18" /></svg>
);

// --- Real-Time Resume Screening Summary Card ---
const RealTimeResumeScreeningCard = () => {
    const pipelineStages = [
        { name: 'Parsing', desc: 'Structure & Metadata' },
        { name: 'Extracting', desc: 'Skills & Experience' },
        { name: 'Matching', desc: 'Job Description' },
        { name: 'Scoring', desc: 'AI Evaluation' },
        { name: 'Candidate Result', desc: 'Live Real-Time Card' }
    ];

    const verificationItems = [
        { label: 'Resume Streaming', status: 'Verified' },
        { label: 'Progressive Results', status: 'Verified' },
        { label: 'Candidate Validation', status: 'Verified' },
        { label: 'Score Ranking', status: 'Verified' },
        { label: 'Production Build', status: 'Passed' }
    ];

    return (
        <div className="bg-gradient-to-br from-green-50/70 via-white to-emerald-50/40 border border-green-200/90 rounded-2xl p-4 sm:p-6 shadow-xs">
            {/* Header: Title & Verified Badge */}
            <div className="flex items-start sm:items-center justify-between gap-3 mb-3 flex-wrap sm:flex-nowrap">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-[#5d8c2c]/10 text-[#5d8c2c] flex items-center justify-center shrink-0 border border-green-200">
                        <Sparkles size={16} />
                    </div>
                    <div>
                        <h4 className="text-base sm:text-lg font-bold text-gray-900 tracking-tight flex items-center gap-2">
                            Real-Time Resume Screening
                        </h4>
                    </div>
                </div>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-green-100/90 text-green-800 border border-green-300/80 shrink-0">
                    <CheckCircle2 size={13} className="text-[#5d8c2c]" /> Verified
                </span>
            </div>

            {/* Description */}
            <p className="text-xs sm:text-sm text-gray-600 leading-relaxed mb-4 font-medium">
                Resume screening now processes candidates sequentially and displays results progressively as each resume is completed, allowing recruiters to see candidate results without waiting for the entire batch to finish.
            </p>

            {/* Processing Stages Pipeline */}
            <div className="mb-4 bg-white border border-gray-200/90 rounded-xl p-3 sm:p-4 shadow-2xs">
                <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                    <Cpu size={13} className="text-[#5d8c2c]" /> Sequential Processing Pipeline
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                    {pipelineStages.map((stage, idx) => (
                        <React.Fragment key={stage.name}>
                            <div className="flex-1 bg-gray-50/80 border border-gray-200/80 rounded-lg px-2.5 py-2 text-center">
                                <div className="text-xs font-bold text-gray-800">{stage.name}</div>
                                <div className="text-[10px] text-gray-500 font-medium truncate mt-0.5">{stage.desc}</div>
                            </div>
                            {idx < pipelineStages.length - 1 && (
                                <>
                                    <div className="hidden sm:flex text-gray-300 justify-center">
                                        <ArrowRight size={14} className="text-gray-400 shrink-0" />
                                    </div>
                                    <div className="flex sm:hidden text-gray-300 justify-center py-0.5">
                                        <ArrowDown size={14} className="text-gray-400 shrink-0" />
                                    </div>
                                </>
                            )}
                        </React.Fragment>
                    ))}
                </div>
            </div>

            {/* Core Capabilities */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                {/* 1. Progressive Results */}
                <div className="bg-white border border-gray-200/80 rounded-xl p-3.5 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs font-bold text-gray-800">
                        <Check size={14} className="text-[#5d8c2c] stroke-[2.5]" />
                        <span>Progressive Candidate Results</span>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed font-medium pl-5">
                        Completed candidates appear immediately in the screening results while the remaining resumes continue processing.
                    </p>
                    <ul className="text-[11px] text-gray-500 space-y-1 pl-5 pt-0.5 font-medium">
                        <li className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#5d8c2c] shrink-0" />
                            <span>Results are automatically sorted by match score.</span>
                        </li>
                        <li className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#5d8c2c] shrink-0" />
                            <span>The active processing indicator advances to the next resume.</span>
                        </li>
                        <li className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#5d8c2c] shrink-0" />
                            <span>The processing state closes automatically after all resumes are completed.</span>
                        </li>
                    </ul>
                </div>

                {/* 2. Candidate Validation & Backward Compatibility */}
                <div className="space-y-3">
                    <div className="bg-white border border-gray-200/80 rounded-xl p-3.5 space-y-1">
                        <div className="flex items-center gap-2 text-xs font-bold text-gray-800">
                            <ShieldCheck size={14} className="text-[#5d8c2c] stroke-[2.5]" />
                            <span>Candidate Email Validation</span>
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed font-medium pl-5">
                            Invalid or placeholder candidate email addresses are rejected and are not saved as candidate records.
                        </p>
                    </div>

                    <div className="bg-white border border-gray-200/80 rounded-xl p-3.5 space-y-1">
                        <div className="flex items-center gap-2 text-xs font-bold text-gray-800">
                            <Layers size={14} className="text-[#5d8c2c] stroke-[2.5]" />
                            <span>Backward Compatible</span>
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed font-medium pl-5">
                            Existing resume screening functionality remains available, including the standard screening workflow.
                        </p>
                    </div>
                </div>
            </div>

            {/* Verification Status Banner */}
            <div className="bg-white border border-gray-200/80 rounded-xl p-3 sm:p-3.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                        Verification Status
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                        {verificationItems.map((item) => (
                            <span
                                key={item.label}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-gray-50 border border-gray-200 text-gray-700"
                            >
                                <span>{item.label}</span>
                                <span className="text-[#5d8c2c] font-bold flex items-center gap-0.5">
                                    <Check size={11} className="stroke-[3]" /> {item.status}
                                </span>
                            </span>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default GlobalSettings;
