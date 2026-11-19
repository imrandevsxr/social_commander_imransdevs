import React, { useEffect, useState } from 'react';
import { Shield, Database, Download, Check, X, Save } from 'lucide-react';
import { apiFetch, formatBytes } from '../lib/api';
import { PlatformMark } from './PlatformBadge';
import { UserProfile } from '../types';

interface AdminOverviewData {
  isSuperAdmin: boolean;
  overview: {
    totalUsers: number;
    approvedUsers: number;
    pendingUsers: number;
    suspendedUsers: number;
    totalConnectedAccounts: number;
    totalJobs: number;
    successfulPosts: number;
    failedPosts: number;
    geminiConfigured: boolean;
  };
  users: UserProfile[];
  registrations: Array<{ id: number; username: string; status: string; createdAt: string }>;
  platforms: Array<{
    id: number;
    platform: string;
    clientIdConfigured: boolean;
    clientIdPreview: string | null;
    clientSecretConfigured: boolean;
    oauthStatus: string;
    apiHealth: string;
    auditStatus: string;
    quotaSummary: string;
    notes: string;
    callbackUrl: string;
  }>;
  settings: {
    appName: string;
    registrationEnabled: boolean;
    requireAdminApproval: boolean;
    maxUploadSizeMb: number;
    allowedFormats: string;
    sessionTimeoutMinutes: number;
    maintenanceMode: boolean;
    defaultTimezone: string;
    aiEnabled: boolean;
    aiModel: string;
    aiThinkingLevel: string;
  };
  auditLogs: Array<{ id: number; username: string; action: string; targetType: string; createdAt: string }>;
  loginAttempts: Array<{ id: number; username: string; ipAddress: string; success: boolean; reason: string; createdAt: string }>;
  sessions: Array<{ id: number; userId: number; deviceInfo: string; ipAddress: string; revoked: boolean; createdAt: string }>;
  backups: Array<{ id: number; filename: string; sizeBytes: number; createdAt: string }>;
}

export function AdminPanelView() {
  const [data, setData] = useState<AdminOverviewData | null>(null);
  const [tab, setTab] = useState<'users' | 'platforms' | 'settings' | 'logs' | 'backups'>('users');
  const [issuedToken, setIssuedToken] = useState<{ username: string; token: string } | null>(null);
  const [platformForms, setPlatformForms] = useState<Record<string, { clientId: string; clientSecret: string; auditStatus: string }>>({});
  const [settingsForm, setSettingsForm] = useState<AdminOverviewData['settings'] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await apiFetch<AdminOverviewData>('/api/admin/overview');
      setData(res);
      setSettingsForm(res.settings);
      const pf: Record<string, { clientId: string; clientSecret: string; auditStatus: string }> = {};
      for (const p of res.platforms) {
        pf[p.platform] = { clientId: '', clientSecret: '', auditStatus: p.auditStatus };
      }
      setPlatformForms(pf);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load admin panel');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (!data) {
    return <div className="text-sm text-slate-500">{err || 'Loading administrator console...'}</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Administrator Control Panel</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Approve registrations, enforce RBAC roles, configure platform OAuth apps, inspect security logs, and run backups.
          </p>
        </div>
        <div className="text-xs font-mono text-indigo-500 inline-flex items-center gap-1.5">
          <Shield className="w-4 h-4" />
          <span>{data.isSuperAdmin ? 'Super Administrator' : 'Administrator'}</span>
        </div>
      </div>

      {msg && (
        <div className="p-3.5 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 text-xs text-emerald-700 dark:text-emerald-300">
          {msg}
        </div>
      )}
      {err && (
        <div className="p-3.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300">
          {err}
        </div>
      )}

      {issuedToken && (
        <div className="p-4 rounded-xl border border-indigo-500 bg-indigo-500/10 space-y-1.5">
          <div className="text-xs font-semibold">
            Approved &ldquo;{issuedToken.username}&rdquo; — One-Time Password Setup Invitation Token
          </div>
          <div className="font-mono text-xs select-all bg-white dark:bg-[#090B0F] p-2 rounded border border-slate-200 dark:border-slate-800">
            {issuedToken.token}
          </div>
          <div className="text-[11px] text-slate-500">
            Share this token securely with {issuedToken.username}. They can enter it under &ldquo;Have an approved invitation token?&rdquo; on the login screen.
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Users', value: data.overview.totalUsers, sub: `${data.overview.pendingUsers} pending` },
          { label: 'Connected Accounts', value: data.overview.totalConnectedAccounts, sub: 'Across all users' },
          { label: 'Publishing Jobs', value: data.overview.totalJobs, sub: `${data.overview.successfulPosts} published · ${data.overview.failedPosts} failed` },
          { label: 'Gemini Secret', value: data.overview.geminiConfigured ? 'Active' : 'Unset', sub: 'Managed via server Secrets' },
        ].map((k) => (
          <div key={k.label} className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-500">{k.label}</div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums">{k.value}</div>
            <div className="mt-1 text-xs text-slate-500">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg w-fit overflow-x-auto">
        {(['users', 'platforms', 'settings', 'logs', 'backups'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md capitalize whitespace-nowrap shrink-0 ${
              tab === t
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <div className="space-y-6">
          {/* Pending Registrations Queue */}
          <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 text-sm font-semibold">
              Registration Requests Queue
            </div>
            {data.registrations.filter((r) => r.status === 'pending').length === 0 ? (
              <div className="p-6 text-xs text-slate-500">No pending registration requests.</div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {data.registrations
                  .filter((r) => r.status === 'pending')
                  .map((r) => (
                    <div key={r.id} className="px-5 py-3.5 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium">{r.username}</div>
                        <div className="text-xs text-slate-500">
                          Requested {new Date(r.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await apiFetch<{ username: string; inviteToken: string }>(
                              `/api/admin/registrations/${r.id}/approve`,
                              { method: 'POST' }
                            );
                            setIssuedToken({ username: res.username, token: res.inviteToken });
                            await load();
                          }}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white inline-flex items-center gap-1"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Approve</span>
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/admin/registrations/${r.id}/reject`, { method: 'POST' });
                            await load();
                          }}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 inline-flex items-center gap-1"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Reject</span>
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Users Table */}
          <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                  <th className="py-3 px-5 font-medium">User</th>
                  <th className="py-3 px-4 font-medium">Role</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium">Last Login</th>
                  {data.isSuperAdmin && <th className="py-3 px-5 font-medium text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {data.users.map((u) => (
                  <tr key={u.id}>
                    <td className="py-3 px-5">
                      <div className="font-medium">{u.username}</div>
                      <div className="text-xs text-slate-500">{u.email || u.displayName}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs">{u.role}</td>
                    <td className="py-3 px-4 text-xs">{u.status}</td>
                    <td className="py-3 px-4 text-xs font-mono text-slate-500">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}
                    </td>
                    {data.isSuperAdmin && (
                      <td className="py-3 px-5 text-right space-x-2">
                        {u.role !== 'super_admin' && (
                          <>
                            <select
                              value={u.role}
                              onChange={async (e) => {
                                await apiFetch(`/api/admin/users/${u.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ role: e.target.value }),
                                });
                                await load();
                              }}
                              className="px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-700 bg-transparent"
                            >
                              <option value="approved_user">approved_user</option>
                              <option value="admin">admin</option>
                              <option value="suspended_user">suspended_user</option>
                            </select>
                            <button
                              type="button"
                              onClick={async () => {
                                await apiFetch(`/api/admin/users/${u.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ status: u.status === 'suspended' ? 'active' : 'suspended' }),
                                });
                                await load();
                              }}
                              className="px-2.5 py-1 text-xs rounded border border-slate-200 dark:border-slate-700"
                            >
                              {u.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                            </button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'platforms' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.platforms.map((p) => (
            <div key={p.id} className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <PlatformMark platform={p.platform} />
                <span className="text-xs font-mono text-slate-500">{p.oauthStatus}</span>
              </div>
              <p className="text-xs text-slate-500">{p.notes}</p>
              <div className="text-[11px] font-mono bg-slate-50 dark:bg-[#090B0F] p-2 rounded border border-slate-200 dark:border-slate-800 break-all">
                Redirect URI: {p.callbackUrl}
              </div>
              {data.isSuperAdmin && (
                <div className="space-y-2.5">
                  <input
                    type="text"
                    value={platformForms[p.platform]?.clientId || ''}
                    onChange={(e) =>
                      setPlatformForms((prev) => ({
                        ...prev,
                        [p.platform]: { ...prev[p.platform], clientId: e.target.value },
                      }))
                    }
                    placeholder={p.clientIdConfigured ? `Configured (${p.clientIdPreview})` : 'OAuth Client ID / App ID'}
                    className="w-full px-3 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                  />
                  <input
                    type="password"
                    value={platformForms[p.platform]?.clientSecret || ''}
                    onChange={(e) =>
                      setPlatformForms((prev) => ({
                        ...prev,
                        [p.platform]: { ...prev[p.platform], clientSecret: e.target.value },
                      }))
                    }
                    placeholder={p.clientSecretConfigured ? 'Client Secret configured (leave blank to keep)' : 'OAuth Client Secret'}
                    className="w-full px-3 py-1.5 text-xs font-mono rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <select
                      value={platformForms[p.platform]?.auditStatus || 'standard'}
                      onChange={(e) =>
                        setPlatformForms((prev) => ({
                          ...prev,
                          [p.platform]: { ...prev[p.platform], auditStatus: e.target.value },
                        }))
                      }
                      className="px-2.5 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                    >
                      <option value="standard">Standard API</option>
                      <option value="unaudited">Unaudited (Private Only)</option>
                      <option value="audited">Audited (Public Approved)</option>
                    </select>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/api/admin/platforms/${p.platform}`, {
                          method: 'PUT',
                          body: JSON.stringify(platformForms[p.platform]),
                        });
                        setMsg(`Saved ${p.platform.toUpperCase()} OAuth credentials securely.`);
                        await load();
                      }}
                      className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white"
                    >
                      Save Credentials
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'settings' && settingsForm && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await apiFetch('/api/admin/settings', {
              method: 'PUT',
              body: JSON.stringify(settingsForm),
            });
            setMsg('System configuration updated.');
            await load();
          }}
          className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4 max-w-3xl"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Application Name</label>
              <input
                type="text"
                value={settingsForm.appName}
                onChange={(e) => setSettingsForm({ ...settingsForm, appName: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Max Upload File Size (MB)</label>
              <input
                type="number"
                value={settingsForm.maxUploadSizeMb}
                onChange={(e) => setSettingsForm({ ...settingsForm, maxUploadSizeMb: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Gemini Model</label>
              <select
                value={settingsForm.aiModel}
                onChange={(e) => setSettingsForm({ ...settingsForm, aiModel: e.target.value })}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
              >
                <option value="gemini-4-hydrogen">gemini-4-hydrogen</option>
                <option value="gemini-4-neon">gemini-4-neon</option>
                <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Gemini Thinking Level</label>
              <select
                value={settingsForm.aiThinkingLevel}
                onChange={(e) => setSettingsForm({ ...settingsForm, aiThinkingLevel: e.target.value })}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
              >
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-5 text-xs pt-2">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={settingsForm.registrationEnabled}
                onChange={(e) => setSettingsForm({ ...settingsForm, registrationEnabled: e.target.checked })}
              />
              <span>Allow Registrations</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={settingsForm.requireAdminApproval}
                onChange={(e) => setSettingsForm({ ...settingsForm, requireAdminApproval: e.target.checked })}
              />
              <span>Require Admin Approval</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={settingsForm.aiEnabled}
                onChange={(e) => setSettingsForm({ ...settingsForm, aiEnabled: e.target.checked })}
              />
              <span>Enable Gemini AI</span>
            </label>
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 text-white inline-flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Configuration</span>
          </button>
        </form>
      )}

      {tab === 'logs' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold">Audit Logs</h2>
            <div className="max-h-96 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {data.auditLogs.map((l) => (
                <div key={l.id} className="py-2 flex justify-between gap-2">
                  <div>
                    <span className="font-mono font-medium">{l.action}</span> · {l.username || 'system'}
                  </div>
                  <span className="font-mono text-slate-500">{new Date(l.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold">Active Sessions & Revocation</h2>
            <div className="max-h-96 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {data.sessions.map((s) => (
                <div key={s.id} className="py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">User #{s.userId} · {s.ipAddress}</div>
                    <div className="text-slate-500 truncate">{s.deviceInfo}</div>
                  </div>
                  {s.revoked ? (
                    <span className="text-slate-400">Revoked</span>
                  ) : (
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/api/admin/sessions/${s.id}/revoke`, { method: 'POST' });
                        await load();
                      }}
                      className="text-red-500 hover:underline shrink-0"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'backups' && (
        <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Database Backups & Recovery</h2>
              <p className="text-xs text-slate-500">Create redacted PostgreSQL state snapshots and download configuration exports.</p>
            </div>
            <button
              type="button"
              onClick={async () => {
                await apiFetch('/api/admin/backups', { method: 'POST' });
                setMsg('Cloud SQL snapshot backup created.');
                await load();
              }}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 text-white inline-flex items-center gap-1.5"
            >
              <Database className="w-3.5 h-3.5" />
              <span>Create Backup</span>
            </button>
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {data.backups.map((b) => (
              <div key={b.id} className="py-3 flex items-center justify-between text-xs">
                <div>
                  <div className="font-mono font-medium">{b.filename}</div>
                  <div className="text-slate-500">
                    {formatBytes(b.sizeBytes)} · {new Date(b.createdAt).toLocaleString()}
                  </div>
                </div>
                <a
                  href={`/api/admin/backups/${b.id}/download`}
                  className="text-indigo-500 hover:underline inline-flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download JSON</span>
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
