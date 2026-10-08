import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Building2, Users, Briefcase, UserCheck, Plus, Search,
    CheckCircle2, AlertTriangle, Shield, Check, X, ArrowUpRight,
    Power, RefreshCw, Trash2
} from 'lucide-react';
import API_URL from '../apiConfig';
import ConfirmationModal from '../components/ConfirmationModal';

export default function PlatformAdminDashboard() {
    const navigate = useNavigate();
    const userProfile = JSON.parse(localStorage.getItem('user_profile') || '{}');

    const [organizations, setOrganizations] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState(null);
    const [createSuccess, setCreateSuccess] = useState(null);
    const [togglingId, setTogglingId] = useState(null);

    // Confirmation & Alert Modal state
    const [confirmation, setConfirmation] = useState({
        isOpen: false,
        title: '',
        message: '',
        type: 'danger',
        confirmText: 'Confirm',
        cancelText: 'Cancel',
        isAlert: false,
        onConfirm: null
    });

    // Organization Members Modal state
    const [selectedOrgMembers, setSelectedOrgMembers] = useState(null);
    const [loadingMembers, setLoadingMembers] = useState(false);
    const [memberSearchQuery, setMemberSearchQuery] = useState('');
    const [deletingMemberId, setDeletingMemberId] = useState(null);

    // Form data
    const [companyName, setCompanyName] = useState('');
    const [adminEmail, setAdminEmail] = useState('');

    const token = localStorage.getItem('token');

    const fetchData = async () => {
        setLoading(true);
        try {
            const headers = { 'Authorization': `Bearer ${token}` };
            const [orgsRes, statsRes] = await Promise.all([
                fetch(`${API_URL}/api/platform/organizations`, { headers }),
                fetch(`${API_URL}/api/platform/stats`, { headers })
            ]);

            if (orgsRes.ok) {
                const orgsData = await orgsRes.json();
                setOrganizations(orgsData);
            }
            if (statsRes.ok) {
                const statsData = await statsRes.json();
                setStats(statsData);
            }
        } catch (err) {
            console.error("Failed to load platform data", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (userProfile.role && userProfile.role !== 'PLATFORM_ADMIN') {
            navigate('/dashboard', { replace: true });
            return;
        }
        fetchData();
    }, []);

    const handleCreateOrg = async (e) => {
        e.preventDefault();
        setCreating(true);
        setCreateError(null);
        setCreateSuccess(null);

        try {
            const res = await fetch(`${API_URL}/api/platform/organizations`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    name: companyName.trim(),
                    admin_email: adminEmail.trim()
                })
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.detail || "Failed to create organization");
            }

            setCreateSuccess(data);
            setCompanyName('');
            setAdminEmail('');
            fetchData();
        } catch (err) {
            setCreateError(err.message);
        } finally {
            setCreating(false);
        }
    };

    const handleToggleStatus = async (org) => {
        setTogglingId(org.id);
        const newStatus = org.status === 'active' ? 'suspended' : 'active';
        try {
            const res = await fetch(`${API_URL}/api/platform/organizations/${org.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ status: newStatus })
            });
            if (res.ok) {
                setOrganizations(prev => prev.map(o => o.id === org.id ? { ...o, status: newStatus } : o));
            }
        } catch (err) {
            console.error("Failed to toggle organization status", err);
        } finally {
            setTogglingId(null);
        }
    };

    const requestToggleStatus = (org) => {
        if (org.status === 'active') {
            setConfirmation({
                isOpen: true,
                title: 'Suspend Organization',
                message: `Are you sure you want to suspend "${org.name}"?\n\nUsers belonging to this organization will be temporarily prevented from signing in until re-activated.`,
                type: 'warning',
                confirmText: 'Suspend Organization',
                cancelText: 'Cancel',
                isAlert: false,
                onConfirm: () => handleToggleStatus(org)
            });
        } else {
            handleToggleStatus(org);
        }
    };

    const handleViewMembers = async (org) => {
        setSelectedOrgMembers({ org, members: [] });
        setMemberSearchQuery('');
        setLoadingMembers(true);
        try {
            const res = await fetch(`${API_URL}/api/platform/organizations/${org.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setSelectedOrgMembers({ org, members: data.members || [] });
            }
        } catch (err) {
            console.error("Failed to load members", err);
        } finally {
            setLoadingMembers(false);
        }
    };

    const requestRemoveMember = (memberId, memberEmail) => {
        if (!selectedOrgMembers?.org) return;
        setConfirmation({
            isOpen: true,
            title: 'Remove Organization Member',
            message: `Are you sure you want to remove ${memberEmail || 'this user'} from ${selectedOrgMembers.org.name}?\n\nThis will immediately deactivate their account and revoke their access to this organization.`,
            type: 'danger',
            confirmText: 'Remove Member',
            cancelText: 'Cancel',
            isAlert: false,
            onConfirm: () => handleRemoveMember(memberId, memberEmail)
        });
    };

    const handleRemoveMember = async (memberId, memberEmail) => {
        if (!selectedOrgMembers?.org) return;
        setDeletingMemberId(memberId);
        try {
            const res = await fetch(`${API_URL}/api/platform/organizations/${selectedOrgMembers.org.id}/members/${memberId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                setSelectedOrgMembers(prev => ({
                    ...prev,
                    members: prev.members.filter(m => m.id !== memberId && m.user_id !== memberId)
                }));
                fetchData();
            } else {
                const err = await res.json().catch(() => ({}));
                setConfirmation({
                    isOpen: true,
                    title: 'Removal Failed',
                    message: err.detail || 'Failed to remove member from organization.',
                    type: 'danger',
                    confirmText: 'Got It',
                    cancelText: 'Close',
                    isAlert: true,
                    onConfirm: null
                });
            }
        } catch (err) {
            console.error("Failed to remove member", err);
            setConfirmation({
                isOpen: true,
                title: 'Error',
                message: 'An unexpected error occurred while communicating with the server.',
                type: 'danger',
                confirmText: 'Got It',
                cancelText: 'Close',
                isAlert: true,
                onConfirm: null
            });
        } finally {
            setDeletingMemberId(null);
        }
    };

    const filteredOrgs = organizations.filter(o => 
        o.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        o.slug.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const filteredOrgMembers = (selectedOrgMembers?.members || []).filter(m => {
        if (!memberSearchQuery.trim()) return true;
        const q = memberSearchQuery.toLowerCase();
        return (
            (m.email && m.email.toLowerCase().includes(q)) ||
            (m.role && m.role.toLowerCase().includes(q)) ||
            (m.status && m.status.toLowerCase().includes(q))
        );
    });

    if (userProfile.role && userProfile.role !== 'PLATFORM_ADMIN') {
        return (
            <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center">
                <div className="w-14 h-14 bg-red-100 border border-red-200 text-red-600 rounded-2xl flex items-center justify-center mb-4">
                    <Shield size={28} />
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">Access Restricted</h2>
                <p className="text-sm text-gray-500 max-w-md mb-6 leading-relaxed">
                    This portal is reserved strictly for the Platform Administrator (Software Owner). Your current role does not have permission to view or manage customer organizations.
                </p>
                <button
                    onClick={() => navigate('/dashboard')}
                    className="px-6 py-2.5 bg-primary text-white font-semibold rounded-xl hover:bg-green-700 transition-all shadow-sm"
                >
                    Return to Organization Dashboard
                </button>
            </div>
        );
    }

    return (
        <div className="max-w-[1240px] mx-auto pb-24 text-gray-900">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                <div>
                    <div className="flex items-center gap-3">
                        <span className="p-2 bg-purple-100 text-purple-700 rounded-xl">
                            <Shield size={24} />
                        </span>
                        <div>
                            <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">
                                Platform Organizations
                            </h1>
                            <p className="text-sm text-gray-500 mt-0.5">
                                Manage customer organizations, provision tenant spaces, and invite Organization Admins.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={fetchData}
                        className="p-2.5 bg-white border border-gray-200 text-gray-600 hover:text-gray-900 rounded-xl hover:bg-gray-50 transition-all shadow-xs"
                        title="Refresh"
                    >
                        <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
                    </button>
                    <button
                        onClick={() => {
                            setIsCreateModalOpen(true);
                            setCreateError(null);
                            setCreateSuccess(null);
                        }}
                        className="px-5 py-2.5 bg-primary hover:bg-green-700 text-white font-semibold rounded-xl transition-all shadow-md flex items-center gap-2"
                    >
                        <Plus size={18} />
                        <span>Create Organization</span>
                    </button>
                </div>
            </div>

            {/* Platform Metric Cards */}
            {stats && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-xs">
                        <div className="flex justify-between items-center text-gray-500 mb-2">
                            <span className="text-xs font-semibold uppercase tracking-wider">Total Orgs</span>
                            <Building2 size={18} className="text-purple-600" />
                        </div>
                        <div className="text-3xl font-extrabold text-gray-900">{stats.total_organizations}</div>
                        <div className="text-xs text-green-600 mt-1 font-medium">{stats.active_organizations} active tenants</div>
                    </div>

                    <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-xs">
                        <div className="flex justify-between items-center text-gray-500 mb-2">
                            <span className="text-xs font-semibold uppercase tracking-wider">Active Orgs</span>
                            <CheckCircle2 size={18} className="text-green-600" />
                        </div>
                        <div className="text-3xl font-extrabold text-gray-900">{stats.active_organizations}</div>
                        <div className="text-xs text-gray-500 mt-1 font-medium">Customer tenants online</div>
                    </div>

                    <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-xs">
                        <div className="flex justify-between items-center text-gray-500 mb-2">
                            <span className="text-xs font-semibold uppercase tracking-wider">Recruiter Users</span>
                            <Users size={18} className="text-blue-600" />
                        </div>
                        <div className="text-3xl font-extrabold text-gray-900">{stats.total_users}</div>
                        <div className="text-xs text-gray-500 mt-1 font-medium">Across all organizations</div>
                    </div>

                    <div className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-xs">
                        <div className="flex justify-between items-center text-gray-500 mb-2">
                            <span className="text-xs font-semibold uppercase tracking-wider">Total Candidates</span>
                            <UserCheck size={18} className="text-amber-600" />
                        </div>
                        <div className="text-3xl font-extrabold text-gray-900">{stats.total_candidates}</div>
                        <div className="text-xs text-gray-500 mt-1 font-medium">Tenant-isolated records</div>
                    </div>
                </div>
            )}

            {/* Organizations Table Container */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
                <div className="p-4 sm:p-5 border-b border-gray-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div className="relative w-full sm:w-80">
                        <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search organization by name or slug..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                        />
                    </div>
                    <span className="text-xs font-medium text-gray-500">
                        Showing {filteredOrgs.length} of {organizations.length} organizations
                    </span>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-50 text-[11px] font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                                <th className="py-3 px-5">ID</th>
                                <th className="py-3 px-5">Organization</th>
                                <th className="py-3 px-5">Status</th>
                                <th className="py-3 px-5">Members</th>
                                <th className="py-3 px-5">Candidates</th>
                                <th className="py-3 px-5">Jobs</th>
                                <th className="py-3 px-5">Created</th>
                                <th className="py-3 px-5 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 text-sm">
                            {filteredOrgs.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="text-center py-12 text-gray-400">
                                        {loading ? "Loading organizations..." : "No organizations found."}
                                    </td>
                                </tr>
                            ) : (
                                filteredOrgs.map((org) => (
                                    <tr key={org.id} className="hover:bg-gray-50/80 transition-colors">
                                        <td className="py-3.5 px-5 font-mono text-xs text-gray-500">#{org.id}</td>
                                        <td className="py-3.5 px-5">
                                            <div className="font-bold text-gray-900">{org.name}</div>
                                            <div className="text-xs text-gray-400 font-mono">slug: {org.slug}</div>
                                        </td>
                                        <td className="py-3.5 px-5">
                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                                                org.status === 'active'
                                                    ? 'bg-green-50 text-green-700 border border-green-200'
                                                    : 'bg-red-50 text-red-700 border border-red-200'
                                            }`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${org.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                                {org.status === 'active' ? 'Active' : 'Suspended'}
                                            </span>
                                        </td>
                                        <td className="py-3.5 px-5 text-gray-700 font-medium">{org.member_count}</td>
                                        <td className="py-3.5 px-5 text-gray-700 font-medium">{org.candidate_count}</td>
                                        <td className="py-3.5 px-5 text-gray-700 font-medium">{org.job_count}</td>
                                        <td className="py-3.5 px-5 text-xs text-gray-500">
                                            {org.created_at ? new Date(org.created_at).toLocaleDateString() : '—'}
                                        </td>
                                        <td className="py-3.5 px-5 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => handleViewMembers(org)}
                                                    className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 transition-all flex items-center gap-1 cursor-pointer"
                                                    title="View & Manage Members"
                                                >
                                                    <Users size={13} />
                                                    Members
                                                </button>
                                                <button
                                                    onClick={() => requestToggleStatus(org)}
                                                    disabled={togglingId === org.id}
                                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border cursor-pointer ${
                                                        org.status === 'active'
                                                            ? 'text-red-700 border-red-200 hover:bg-red-50'
                                                            : 'text-green-700 border-green-200 hover:bg-green-50'
                                                    }`}
                                                >
                                                    {org.status === 'active' ? 'Suspend' : 'Activate'}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Create Organization Modal */}
            {isCreateModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div 
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                        onClick={() => setIsCreateModalOpen(false)}
                    />

                    <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-200 max-w-lg w-full p-6 z-10 animate-in fade-in zoom-in-95">
                        <div className="flex justify-between items-center pb-4 mb-4 border-b border-gray-100">
                            <div className="flex items-center gap-2.5">
                                <span className="p-2 bg-green-50 text-green-700 rounded-xl">
                                    <Building2 size={20} />
                                </span>
                                <div>
                                    <h3 className="font-bold text-gray-900 text-lg">Create New Organization</h3>
                                    <p className="text-xs text-gray-500">Provisions isolated multi-tenant workspace & invites Admin</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsCreateModalOpen(false)}
                                className="text-gray-400 hover:text-gray-600 p-1"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {createError && (
                            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 mb-4 flex items-center gap-2">
                                <AlertTriangle size={16} className="flex-shrink-0" />
                                <span>{createError}</span>
                            </div>
                        )}

                        {createSuccess ? (
                            <div className="text-center py-6">
                                <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-3">
                                    <CheckCircle2 size={28} />
                                </div>
                                <h4 className="text-lg font-bold text-gray-900 mb-1">Organization Provisioned!</h4>
                                <p className="text-sm text-gray-600 mb-4">
                                    <strong>{createSuccess.name}</strong> created successfully.
                                </p>
                                <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs text-left mb-6 space-y-1">
                                    <div className="text-gray-600"><strong>Admin Email:</strong> {createSuccess.admin_email}</div>
                                    <div className="text-gray-600"><strong>Role Assigned:</strong> ORGANIZATION_ADMIN</div>
                                    <div className="text-gray-600"><strong>Invitation Status:</strong> {createSuccess.invitation_status}</div>
                                </div>
                                <button
                                    onClick={() => {
                                        setIsCreateModalOpen(false);
                                        setCreateSuccess(null);
                                    }}
                                    className="w-full py-2.5 bg-primary hover:bg-green-700 text-white font-semibold rounded-xl transition-all"
                                >
                                    Done
                                </button>
                            </div>
                        ) : (
                            <form onSubmit={handleCreateOrg} className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 uppercase mb-1.5">
                                        Company / Organization Name
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="e.g. Acme Corporation"
                                        value={companyName}
                                        onChange={(e) => setCompanyName(e.target.value)}
                                        className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                                    />
                                    {companyName && (
                                        <p className="text-[11px] text-gray-400 mt-1 font-mono">
                                            slug: {companyName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')}
                                        </p>
                                    )}
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-gray-700 uppercase mb-1.5">
                                        Organization Admin Email
                                    </label>
                                    <input
                                        type="email"
                                        required
                                        placeholder="e.g. admin@acmecorp.com"
                                        value={adminEmail}
                                        onChange={(e) => setAdminEmail(e.target.value)}
                                        className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                                    />
                                    <p className="text-[11px] text-gray-400 mt-1">
                                        An invitation will be sent to this email to activate their ORGANIZATION_ADMIN account.
                                    </p>
                                </div>

                                <div className="pt-2 flex justify-end gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setIsCreateModalOpen(false)}
                                        className="px-4 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm font-semibold hover:bg-gray-50"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={creating || !companyName.trim() || !adminEmail.trim()}
                                        className="px-5 py-2 bg-primary hover:bg-green-700 text-white rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
                                    >
                                        {creating ? "Provisioning..." : "Create & Invite Admin"}
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>
                </div>
            )}

            {/* Manage Organization Members Modal */}
            {selectedOrgMembers && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6 transition-all duration-200">
                    <div className="bg-white rounded-2xl max-w-3xl w-full border border-gray-100 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
                        {/* Header */}
                        <div className="flex justify-between items-center px-6 py-4.5 border-b border-gray-100 bg-white">
                            <div className="flex items-center gap-3.5 min-w-0">
                                <div className="w-11 h-11 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center border border-purple-200/80 shadow-2xs shrink-0">
                                    <Users size={22} />
                                </div>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2.5 flex-wrap">
                                        <h3 className="text-lg font-bold text-gray-900 tracking-tight truncate">
                                            {selectedOrgMembers.org.name}
                                        </h3>
                                        <span className="text-xs px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-700 font-semibold border border-purple-200/80 shrink-0">
                                            Members
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                                        <span>Slug:</span>
                                        <code className="font-mono bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded border border-gray-200 font-semibold text-[11px]">
                                            {selectedOrgMembers.org.slug}
                                        </code>
                                        <span className="text-gray-300">•</span>
                                        <span className="font-medium text-gray-600">
                                            {selectedOrgMembers.members.length} {selectedOrgMembers.members.length === 1 ? 'registered member' : 'registered members'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={() => setSelectedOrgMembers(null)}
                                className="p-2 text-gray-400 hover:text-gray-600 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer shrink-0 ml-4"
                                title="Close"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Quick Search bar if members exist */}
                        {selectedOrgMembers.members.length > 2 && (
                            <div className="px-6 py-3 bg-gray-50/70 border-b border-gray-100 flex items-center gap-3">
                                <div className="relative flex-1">
                                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        type="text"
                                        placeholder="Search members by email, role, or status..."
                                        value={memberSearchQuery}
                                        onChange={(e) => setMemberSearchQuery(e.target.value)}
                                        className="w-full pl-9 pr-8 py-2 bg-white border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all shadow-2xs"
                                    />
                                    {memberSearchQuery && (
                                        <button 
                                            onClick={() => setMemberSearchQuery('')}
                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs p-1"
                                        >
                                            <X size={12} />
                                        </button>
                                    )}
                                </div>
                                {memberSearchQuery && (
                                    <span className="text-xs text-gray-500 whitespace-nowrap">
                                        Showing {filteredOrgMembers.length} of {selectedOrgMembers.members.length}
                                    </span>
                                )}
                            </div>
                        )}

                        {/* Body / Table */}
                        <div className="p-6 overflow-hidden flex-1 flex flex-col">
                            {loadingMembers ? (
                                <div className="py-20 text-center text-gray-500 text-sm flex flex-col items-center justify-center gap-3">
                                    <RefreshCw size={26} className="animate-spin text-purple-600" />
                                    <span className="font-medium">Loading organization members...</span>
                                </div>
                            ) : selectedOrgMembers.members.length === 0 ? (
                                <div className="py-20 text-center text-gray-400 text-sm flex flex-col items-center justify-center gap-2">
                                    <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 mb-1">
                                        <Users size={24} />
                                    </div>
                                    <span className="font-semibold text-gray-700">No members registered</span>
                                    <span className="text-xs text-gray-400">This organization has no members provisioned yet.</span>
                                </div>
                            ) : (
                                <div className="border border-gray-200 rounded-xl overflow-hidden flex flex-col shadow-2xs">
                                    <div className="overflow-y-auto overflow-x-hidden max-h-[380px]">
                                        <table className="w-full text-left text-sm border-collapse">
                                            <thead className="bg-gray-50/90 text-[11px] font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200 sticky top-0 z-10 backdrop-blur-xs">
                                                <tr>
                                                    <th className="py-3 px-4 w-[45%]">User</th>
                                                    <th className="py-3 px-4 w-[20%]">Role</th>
                                                    <th className="py-3 px-4 w-[17%]">Status</th>
                                                    <th className="py-3 px-4 w-[18%] text-right">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 bg-white">
                                                {filteredOrgMembers.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={4} className="py-12 text-center text-gray-400 text-xs">
                                                            No members match "{memberSearchQuery}".
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    filteredOrgMembers.map((m) => {
                                                        const isDeleting = deletingMemberId === m.id;
                                                        const userInitial = (m.email && m.email[0] ? m.email[0].toUpperCase() : 'U');
                                                        return (
                                                            <tr key={m.id} className="hover:bg-purple-50/20 transition-colors">
                                                                <td className="py-3.5 px-4">
                                                                    <div className="flex items-center gap-3 min-w-0">
                                                                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-100 to-indigo-100 text-purple-700 flex items-center justify-center font-bold text-xs shrink-0 border border-purple-200/80 shadow-2xs">
                                                                            {userInitial}
                                                                        </div>
                                                                        <div className="min-w-0 flex-1">
                                                                            <div className="font-semibold text-gray-900 text-sm truncate" title={m.email}>
                                                                                {m.email}
                                                                            </div>
                                                                            {m.created_at && (
                                                                                <div className="text-[11px] text-gray-400 mt-0.5">
                                                                                    Added {new Date(m.created_at).toLocaleDateString()}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                                <td className="py-3.5 px-4">
                                                                    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold whitespace-nowrap ${
                                                                        m.role === 'ORGANIZATION_ADMIN'
                                                                            ? 'bg-purple-100/80 text-purple-800 border border-purple-200'
                                                                            : 'bg-emerald-100/80 text-emerald-800 border border-emerald-200'
                                                                    }`}>
                                                                        {m.role === 'ORGANIZATION_ADMIN' ? 'Org Admin' : 'HR'}
                                                                    </span>
                                                                </td>
                                                                <td className="py-3.5 px-4">
                                                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                                                                        m.status === 'active'
                                                                            ? 'text-emerald-700 bg-emerald-50 border border-emerald-200/60'
                                                                            : 'text-amber-700 bg-amber-50 border border-amber-200/60'
                                                                    }`}>
                                                                        <span className={`w-1.5 h-1.5 rounded-full ${m.status === 'active' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                                                                        {m.status === 'active' ? 'Active' : 'Pending'}
                                                                    </span>
                                                                </td>
                                                                <td className="py-3.5 px-4 text-right">
                                                                    <button
                                                                        onClick={() => requestRemoveMember(m.id, m.email)}
                                                                        disabled={isDeleting}
                                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-red-600 hover:text-white hover:bg-red-600 border border-red-200 hover:border-red-600 rounded-lg transition-all text-xs font-semibold cursor-pointer whitespace-nowrap shadow-2xs disabled:opacity-50"
                                                                        title="Remove Member from Organization"
                                                                    >
                                                                        <Trash2 size={13} className={isDeleting ? "animate-spin" : ""} />
                                                                        <span>{isDeleting ? "Removing..." : "Remove"}</span>
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-4 bg-gray-50/80 border-t border-gray-100 flex items-center justify-between">
                            <div className="text-xs text-gray-500 flex items-center gap-1.5">
                                <Shield size={14} className="text-purple-600 shrink-0" />
                                <span>Platform Admin can revoke tenant access at any time.</span>
                            </div>
                            <button
                                onClick={() => setSelectedOrgMembers(null)}
                                className="px-5 py-2 bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 rounded-xl text-xs font-semibold transition-all shadow-2xs cursor-pointer"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Custom Confirmation & Alert Modal Dialog */}
            <ConfirmationModal
                isOpen={confirmation.isOpen}
                onClose={() => setConfirmation(prev => ({ ...prev, isOpen: false }))}
                onConfirm={confirmation.onConfirm}
                title={confirmation.title}
                message={confirmation.message}
                type={confirmation.type}
                confirmText={confirmation.confirmText}
                cancelText={confirmation.cancelText}
                isAlert={confirmation.isAlert}
            />
        </div>
    );
}
