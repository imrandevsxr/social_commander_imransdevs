import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Users,
  UploadCloud,
  Film,
  ListChecks,
  BarChart3,
  Sparkles,
  Bell,
  Settings,
  Shield,
  HardDrive,
  LogOut,
  Sun,
  Moon,
  Menu,
  X,
} from 'lucide-react';
import { apiFetch } from './lib/api';
import { clearDriveTokenCache } from './lib/firebase';
import { AuthGate } from './components/AuthGate';
import { DashboardView } from './components/DashboardView';
import { AccountsView } from './components/AccountsView';
import { GoogleStorageView } from './components/GoogleStorageView';
import { UploadCenterView } from './components/UploadCenterView';
import { VideoLibraryView } from './components/VideoLibraryView';
import { QueueHistoryView } from './components/QueueHistoryView';
import { AnalyticsView } from './components/AnalyticsView';
import { AiStudioView } from './components/AiStudioView';
import { NotificationsView } from './components/NotificationsView';
import { SettingsView } from './components/SettingsView';
import { AdminPanelView } from './components/AdminPanelView';
import { AppInfo, NotificationItem, PublishingJob, UserProfile } from './types';

export default function App() {
  const [darkMode, setDarkMode] = useState(true);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo>({
    appName: 'Social Command Center',
    registrationEnabled: true,
    maintenanceMode: false,
    aiEnabled: true,
    aiModel: 'gemini-4-hydrogen',
    queuePaused: false,
  });

  const [activeTab, setActiveTab] = useState('dashboard');
  const [uploadEditMediaId, setUploadEditMediaId] = useState<number | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [wsConnected, setWsConnected] = useState(false);
  const [liveJobEvent, setLiveJobEvent] = useState<PublishingJob | null>(null);
  const [liveAnalyticsEvent, setLiveAnalyticsEvent] = useState<Record<string, unknown> | null>(null);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const res = await apiFetch<{ authenticated: boolean; user: UserProfile | null; appInfo: AppInfo }>(
          '/api/auth/me'
        );
        setAppInfo(res.appInfo);
        setUser(res.authenticated ? res.user : null);
      } catch {
        setUser(null);
      } finally {
        setLoadingAuth(false);
      }
    };
    void checkSession();
  }, []);

  // Load initial unread notifications count once authenticated
  useEffect(() => {
    if (!user) return;
    apiFetch<NotificationItem[]>('/api/notifications')
      .then((list) => setUnreadNotifications(list.filter((n) => !n.isRead).length))
      .catch(() => {});
  }, [user]);

  // Real-time WebSocket connection
  useEffect(() => {
    if (!user) {
      setWsConnected(false);
      return;
    }

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closedByCleanup = false;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      ws.onopen = () => {
        setWsConnected(true);
        ws?.send(JSON.stringify({ type: 'auth', userId: user.id, role: user.role }));
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'job:updated') {
            setLiveJobEvent(msg.payload as PublishingJob);
          } else if (msg.type === 'analytics:updated') {
            setLiveAnalyticsEvent(msg.payload as Record<string, unknown>);
          } else if (msg.type === 'notification:created') {
            setUnreadNotifications((c) => c + 1);
          } else if (msg.type === 'queue:state') {
            setAppInfo((prev) => ({ ...prev, queuePaused: Boolean(msg.payload?.queuePaused) }));
          }
        } catch {
          // ignore malformed messages
        }
      };
      ws.onclose = () => {
        setWsConnected(false);
        if (!closedByCleanup) {
          reconnectTimer = setTimeout(connect, 4000);
        }
      };
    };

    connect();
    return () => {
      closedByCleanup = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [user]);

  const handleLogout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    clearDriveTokenCache();
    setUser(null);
    setActiveTab('dashboard');
  };

  if (loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#090B0F] text-sm text-slate-500">
        Loading Social Command Center...
      </div>
    );
  }

  if (!user) {
    return (
      <AuthGate
        appInfo={appInfo}
        darkMode={darkMode}
        onToggleTheme={() => setDarkMode((d) => !d)}
        onAuthenticated={(u) => setUser(u)}
      />
    );
  }

  const isAdmin = user.role === 'super_admin' || user.role === 'admin';
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'accounts', label: 'Accounts', icon: Users },
    { id: 'google-storage', label: 'Google Storage', icon: HardDrive },
    { id: 'upload', label: 'Upload Center', icon: UploadCloud },
    { id: 'library', label: 'Video Library', icon: Film },
    { id: 'queue', label: 'Publishing Queue', icon: ListChecks },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'ai', label: 'AI Studio', icon: Sparkles },
    { id: 'notifications', label: 'Notifications', icon: Bell, badge: unreadNotifications },
    { id: 'settings', label: 'Settings', icon: Settings },
    ...(isAdmin ? [{ id: 'admin', label: 'Admin Panel', icon: Shield }] : []),
  ];

  const activeNavLabel = navItems.find((n) => n.id === activeTab)?.label || 'Dashboard';

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-[#090B0F] text-slate-900 dark:text-slate-100">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0C0F15] shrink-0">
        <div className="h-16 px-5 border-b border-slate-200 dark:border-slate-800 flex items-center">
          <span className="font-display text-base font-bold tracking-tight whitespace-nowrap truncate">
            {appInfo.appName}
          </span>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  if (item.id !== 'upload') setUploadEditMediaId(null);
                }}
                className={`w-full px-3 py-2 rounded-lg text-sm font-medium flex items-center justify-between transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <span className="inline-flex items-center gap-2.5">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </span>
                {item.badge && item.badge > 0 ? (
                  <span className="font-mono text-xs tabular-nums">{item.badge}</span>
                ) : null}
              </button>
            );
          })}
        </nav>
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <div className="text-xs">
            <div className="font-semibold truncate">{user.displayName || user.username}</div>
            <div className="text-slate-500 font-mono text-[11px] truncate">{user.role}</div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full py-2 px-3 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center justify-center gap-2"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-64 bg-white dark:bg-[#0C0F15] border-r border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="h-16 px-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <span className="font-display text-base font-bold">{appInfo.appName}</span>
              <button type="button" onClick={() => setMobileMenuOpen(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full px-3 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2.5 ${
                      activeTab === item.id
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full py-2 px-3 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800"
              >
                Sign Out
              </button>
            </div>
          </div>
          <div className="flex-1 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 px-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0C0F15] flex items-center justify-between gap-6 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 rounded-md border border-slate-200 dark:border-slate-800"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="text-sm font-medium text-slate-600 dark:text-slate-400 truncate">
              {appInfo.appName} / <span className="text-slate-900 dark:text-slate-100">{activeNavLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="Toggle light/dark mode"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('upload')}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white whitespace-nowrap shrink-0"
            >
              Upload Video
            </button>
          </div>
        </header>

        {user.mustChangeSecret && (
          <div className="px-6 py-2.5 bg-amber-500/10 border-b border-amber-500/30 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-700 dark:text-amber-300">
            <span>
              Security requirement: You are using the initial master access secret. Rotate it immediately in Settings.
            </span>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className="font-semibold underline"
            >
              Update Secret Now
            </button>
          </div>
        )}

        <main className="flex-1 p-6 lg:p-8 max-w-7xl w-full mx-auto overflow-y-auto">
          {activeTab === 'dashboard' && <DashboardView onNavigate={(t) => setActiveTab(t)} />}
          {activeTab === 'accounts' && <AccountsView />}
          {activeTab === 'google-storage' && <GoogleStorageView />}
          {activeTab === 'upload' && (
            <UploadCenterView
              initialMediaId={uploadEditMediaId}
              onPublished={() => {
                setUploadEditMediaId(null);
                setActiveTab('queue');
              }}
            />
          )}
          {activeTab === 'library' && (
            <VideoLibraryView
              onEditInUploadCenter={(id) => {
                setUploadEditMediaId(id);
                setActiveTab('upload');
              }}
            />
          )}
          {activeTab === 'queue' && (
            <QueueHistoryView
              liveJobEvent={liveJobEvent}
              queuePaused={Boolean(appInfo.queuePaused)}
              onQueuePausedChange={(paused) => setAppInfo((p) => ({ ...p, queuePaused: paused }))}
            />
          )}
          {activeTab === 'analytics' && (
            <AnalyticsView liveAnalyticsEvent={liveAnalyticsEvent} wsConnected={wsConnected} />
          )}
          {activeTab === 'ai' && (
            <AiStudioView
              aiModel={appInfo.aiModel || 'gemini-4-hydrogen'}
              aiEnabled={appInfo.aiEnabled !== false}
            />
          )}
          {activeTab === 'notifications' && (
            <NotificationsView onUnreadCountChange={(c) => setUnreadNotifications(c)} />
          )}
          {activeTab === 'settings' && (
            <SettingsView
              user={user}
              darkMode={darkMode}
              onToggleTheme={() => setDarkMode((d) => !d)}
              onUserUpdated={(u) => setUser(u)}
            />
          )}
          {activeTab === 'admin' && isAdmin && <AdminPanelView />}
        </main>
      </div>
    </div>
  );
}
