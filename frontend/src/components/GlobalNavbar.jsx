import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Layout, Users, Shield, LogOut, Bell, UserCircle, Menu } from 'lucide-react';
import CandidateLoginModal from './CandidateLoginModal';
import { UserButton } from '@clerk/clerk-react';
import API_URL from '../apiConfig';

const GlobalNavbar = ({ onToggleMobileMenu }) => {
    const navigate = useNavigate();
    const location = useLocation();

    const handleNotificationClick = async (notification) => {
        // 1. Mark as Read
        await markOneRead(notification.id);

        // 2. Navigate based on Action/Content
        // We use heuristic matching on 'action' or 'details' string from ActivityLog
        const action = notification.action.toLowerCase();
        const target = notification.target;

        if (action.includes('screened')) {
            navigate('/candidates'); // Or specific filter if possible
        } else if (action.includes('submitted')) {
            if (notification.details && notification.details.includes('Aptitude')) {
                navigate('/rounds/aptitude');
            } else if (notification.details && notification.details.includes('Coding')) {
                navigate('/rounds/coding');
            } else {
                navigate('/candidates');
            }
        } else if (action.includes('promoted')) {
            // Move to the new stage page?
            // For now, simpler to go to candidates or board
            navigate('/dashboard');
        } else {
            navigate('/dashboard');
        }

        setShowNotifications(false);
    };
    const [showLoginModal, setShowLoginModal] = useState(false);

    // Profile & Organization State
    const [profile, setProfile] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('user_profile') || '{}');
        } catch {
            return {};
        }
    });

    React.useEffect(() => {
        const fetchProfile = async () => {
            try {
                const token = localStorage.getItem('token');
                if (token) {
                    const res = await fetch(`${API_URL}/api/auth/me`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        setProfile(data);
                        localStorage.setItem('user_profile', JSON.stringify(data));
                    }
                }
            } catch (e) {
                console.error("Failed to load user profile", e);
            }
        };
        fetchProfile();
    }, []);

    // Notification Logic
    const [notifications, setNotifications] = useState([]);
    const [showNotifications, setShowNotifications] = useState(false);

    // Derived unread count
    const unreadCount = notifications.length;

    const fetchNotifications = async () => {
        try {
            // Fetch only unread notifications from backend
            const res = await fetch(`${API_URL}/api/dashboard/notifications/`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            if (res.ok) {
                const data = await res.json();
                setNotifications(data);
            }
        } catch (error) {
            console.error("Failed to fetch notifications", error);
        }
    };

    React.useEffect(() => {
        fetchNotifications();
        const interval = setInterval(fetchNotifications, 30000);
        return () => clearInterval(interval);
    }, []);

    const markAllAsRead = async () => {
        // Optimistic UI update
        const currentNotes = [...notifications];
        setNotifications([]);

        // Loop and mark all (parallel) - simplistic approach for now
        // Ideally backend has a 'mark_all_read' endpoint, but user asked for "Clicking notification..."
        // We will just clear UI for "Mark all" and let background sync handle it or loop calls.
        try {
            await Promise.all(currentNotes.map(n =>
                fetch(`${API_URL}/api/dashboard/notifications/${n.id}/read`, {
                    method: 'PUT',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                })
            ));
        } catch (e) {
            console.error(e);
        }
    };

    const markOneRead = async (id) => {
        // Optimistic update
        setNotifications(prev => prev.filter(n => n.id !== id));
        try {
            await fetch(`${API_URL}/api/dashboard/notifications/${id}/read`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
        } catch (e) {
            console.error(e);
        }
    };

    const isActive = (path) => location.pathname === path;

    const getNotificationMessage = (n) => {
        const action = (n.action || '').toLowerCase();
        const target = n.target || 'Candidate';
        const details = n.details || '';

        if (action.includes('submitted')) {
            return <p className="text-sm text-gray-800"><span className="font-bold text-gray-900">{target}</span> submitted <span className="font-medium text-blue-600">{details || 'assignment'}</span></p>;
        }
        if (action.includes('promoted')) {
            return <p className="text-sm text-gray-800"><span className="font-bold text-gray-900">{target}</span> promoted to <span className="font-medium text-purple-600">{details || 'Next Round'}</span></p>;
        }
        return <p className="text-sm text-gray-800"><span className="font-bold">{n.user_name || 'System'}</span> {n.action} <span className="font-medium">{n.target}</span></p>;
    };

    return (
        <>
            <nav className="h-16 bg-white border-b border-gray-200 fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-3 sm:px-6 shadow-sm">
                {/* Logo & Mobile Menu Section */}
                <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                    {onToggleMobileMenu && (
                        <button
                            type="button"
                            onClick={onToggleMobileMenu}
                            aria-label="Toggle navigation menu"
                            className="md:hidden p-2 text-gray-700 hover:text-[#5d8c2c] hover:bg-gray-100 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-[#5d8c2c]/30"
                        >
                            <Menu className="w-5 h-5" />
                        </button>
                    )}
                    <Link to="/dashboard" className="flex items-center gap-2.5 sm:gap-4 focus:outline-none min-w-0">
                        <img src="/logo_main.png" alt="ThirdEye Data Logo" className="h-7 sm:h-8 w-auto object-contain flex-shrink-0" />
                        <div className="hidden sm:block w-[1.5px] h-6 bg-gray-300 flex-shrink-0" />
                        <span className="text-lg sm:text-xl font-bold text-[#5d8c2c] tracking-tight truncate">HiringAI</span>
                    </Link>
                </div>

                {/* Center Navigation Links (Enterprise Style) */}
                <div className="hidden md:flex items-center gap-2 lg:gap-4">
                    <Link
                        to="/dashboard"
                        className={`text-sm font-medium px-3.5 py-1.5 rounded-lg transition-all ${isActive('/dashboard') ? 'bg-green-50 text-[#5d8c2c] font-semibold border border-green-200/80 shadow-xs' : 'text-gray-700 hover:bg-gray-50'}`}
                    >
                        Dashboard
                    </Link>

                    <Link
                        to="/analytics"
                        className={`text-sm font-medium px-3.5 py-1.5 rounded-lg transition-all ${isActive('/analytics') ? 'bg-green-50 text-[#5d8c2c] font-semibold border border-green-200/80 shadow-xs' : 'text-gray-700 hover:bg-gray-50'}`}
                    >
                        Analytics
                    </Link>

                    <Link
                        to="/settings"
                        className={`text-sm font-medium px-3.5 py-1.5 rounded-lg transition-all ${isActive('/settings') ? 'bg-green-50 text-[#5d8c2c] font-semibold border border-green-200/80 shadow-xs' : 'text-gray-700 hover:bg-gray-50'}`}
                    >
                        Settings
                    </Link>

                    {profile.role === 'PLATFORM_ADMIN' && (
                        <Link
                            to="/platform/organizations"
                            className={`text-sm font-semibold px-3.5 py-1.5 rounded-lg transition-all ${isActive('/platform/organizations') ? 'bg-purple-100 text-purple-800 border border-purple-300 shadow-xs' : 'bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200'}`}
                        >
                            Platform Admin
                        </Link>
                    )}
                </div>

                {/* Right Section: Profile & Actions */}
                <div className="flex items-center gap-3 sm:gap-4 flex-shrink-0">
                    <div className="relative">
                        <button
                            onClick={() => {
                                setShowNotifications(!showNotifications);
                            }}
                            className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors relative focus:outline-none"
                            aria-label="View notifications"
                        >
                            <Bell className="w-5 h-5" />
                            {unreadCount > 0 && (
                                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-red-600 text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-white shadow-sm px-1">
                                    {unreadCount}
                                </span>
                            )}
                        </button>

                        {showNotifications && (
                            <div className="absolute right-0 mt-3 w-[calc(100vw-2rem)] sm:w-80 max-w-sm bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
                                <div className="p-3 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                                    <h3 className="font-bold text-gray-900 text-sm">Recent Activity</h3>
                                    {unreadCount > 0 && (
                                        <span onClick={markAllAsRead} className="text-xs text-blue-600 font-semibold cursor-pointer hover:underline">Mark all read</span>
                                    )}
                                </div>
                                <div className="max-h-[300px] overflow-y-auto">
                                    {notifications.length === 0 ? (
                                        <div className="p-6 text-center text-gray-400 text-sm">No new notifications</div>
                                    ) : (
                                        notifications.map((n, i) => (
                                            <div
                                                key={n.id || i}
                                                onClick={() => handleNotificationClick(n)}
                                                className="p-3 border-b border-gray-50 hover:bg-blue-50/50 transition-colors flex gap-3 items-start cursor-pointer"
                                            >
                                                <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 flex-shrink-0"></div>
                                                <div>
                                                    {getNotificationMessage(n)}
                                                    <p className="text-xs text-gray-400 mt-1">{new Date(n.timestamp).toLocaleTimeString()}</p>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                                <div className="p-2 border-t border-gray-100 bg-gray-50 text-center">
                                    <Link to="/dashboard" className="text-xs font-bold text-blue-600 hover:text-blue-700">View Dashboard</Link>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="h-8 w-px bg-gray-200 mx-2" />

                    {/* Organization and Role Badges */}
                    {profile.organization_name && (
                        <div className="hidden sm:flex flex-col items-end">
                            <span className="text-xs font-bold text-gray-900 truncate max-w-[150px]">
                                {profile.organization_name}
                            </span>
                            <span className="text-[10px] font-semibold text-[#5d8c2c] uppercase tracking-wider bg-green-50 px-2 py-0.5 rounded border border-green-200">
                                {profile.role === 'ORGANIZATION_ADMIN' ? 'Org Admin' : profile.role}
                            </span>
                        </div>
                    )}
                    {profile.role === 'PLATFORM_ADMIN' && (
                        <div className="hidden sm:flex flex-col items-end">
                            <span className="text-xs font-bold text-purple-900">
                                HiringAI Platform
                            </span>
                            <span className="text-[10px] font-bold text-purple-700 uppercase tracking-wider bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                                Platform Admin
                            </span>
                        </div>
                    )}

                    {/* Clerk User Button */}
                    <UserButton
                        appearance={{
                            elements: {
                                avatarBox: "w-9 h-9",
                                userButtonPopoverCard: "shadow-xl"
                            }
                        }}
                        afterSignOutUrl="/"
                    />
                </div>
            </nav>

            {/* Candidate Login Modal */}
            <CandidateLoginModal
                isOpen={showLoginModal}
                onClose={() => setShowLoginModal(false)}
            />
        </>
    );
};

export default GlobalNavbar;
