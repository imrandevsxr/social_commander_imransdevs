import React, { useState } from 'react';
import { KeyRound, ShieldCheck, Sun, Moon } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { UserProfile } from '../types';

export function SettingsView({
  user,
  darkMode,
  onToggleTheme,
  onUserUpdated,
}: {
  user: UserProfile;
  darkMode: boolean;
  onToggleTheme: () => void;
  onUserUpdated: (u: UserProfile) => void;
}) {
  const [currentSecret, setCurrentSecret] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [twoFaData, setTwoFaData] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const handleChangeSecret = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    try {
      const res = await apiFetch<{ user: UserProfile }>('/api/auth/change-secret', {
        method: 'POST',
        body: JSON.stringify({ currentSecret, newSecret }),
      });
      onUserUpdated(res.user);
      setCurrentSecret('');
      setNewSecret('');
      setMsg('Password / Master secret updated and encrypted in Cloud SQL.');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to update secret');
    }
  };

  const handleStart2FA = async () => {
    setErr(null);
    const res = await apiFetch<{ secret: string; otpauthUri: string }>('/api/auth/2fa/setup', { method: 'POST' });
    setTwoFaData(res);
  };

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      const res = await apiFetch<{ user: UserProfile }>('/api/auth/2fa/verify', {
        method: 'POST',
        body: JSON.stringify({ code: totpCode }),
      });
      onUserUpdated(res.user);
      setTwoFaData(null);
      setTotpCode('');
      setMsg('Two-factor authentication enabled.');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '2FA verification failed');
    }
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account & Security Settings</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Manage your password or master secret, TOTP two-factor authentication, and display preferences.
        </p>
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

      {/* Appearance */}
      <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Interface Theme</h2>
          <p className="text-xs text-slate-500">Switch between Dark Mode (default) and Light Mode.</p>
        </div>
        <button
          type="button"
          onClick={onToggleTheme}
          className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 inline-flex items-center gap-2"
        >
          {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          <span>{darkMode ? 'Switch to Light' : 'Switch to Dark'}</span>
        </button>
      </div>

      {/* Change Password / Master Secret */}
      <form
        onSubmit={handleChangeSecret}
        className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
      >
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-indigo-500" />
          <h2 className="text-sm font-semibold">
            {user.role === 'super_admin' ? 'Rotate Master Access Secret' : 'Update Account Password'}
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1">Current Password / Secret</label>
            <input
              type="password"
              value={currentSecret}
              onChange={(e) => setCurrentSecret(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">New Password / Secret (8+ chars)</label>
            <input
              type="password"
              required
              minLength={8}
              value={newSecret}
              onChange={(e) => setNewSecret(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
            />
          </div>
        </div>
        <button
          type="submit"
          className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white"
        >
          Save New Secret
        </button>
      </form>

      {/* Two-Factor Authentication */}
      <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <div>
              <h2 className="text-sm font-semibold">Two-Factor Authentication (TOTP)</h2>
              <p className="text-xs text-slate-500">
                Status: {user.twoFactorEnabled ? 'Enabled' : 'Not configured'}
              </p>
            </div>
          </div>

          {user.twoFactorEnabled ? (
            <button
              type="button"
              onClick={async () => {
                const res = await apiFetch<{ user: UserProfile }>('/api/auth/2fa/disable', { method: 'POST' });
                onUserUpdated(res.user);
                setMsg('Two-factor authentication disabled.');
              }}
              className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400"
            >
              Disable 2FA
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStart2FA}
              className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
            >
              Set Up 2FA
            </button>
          )}
        </div>

        {twoFaData && (
          <form onSubmit={handleVerify2FA} className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
              <p>Add this Base32 key to Google Authenticator, Authy, or 1Password:</p>
              <div className="p-2.5 rounded bg-slate-50 dark:bg-[#090B0F] font-mono text-xs select-all">
                {twoFaData.secret}
              </div>
              <p className="text-[11px] text-slate-500 break-all">URI: {twoFaData.otpauthUri}</p>
            </div>
            <div className="flex gap-3">
              <input
                type="text"
                required
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                placeholder="Enter 6-digit code"
                className="px-3 py-2 text-sm font-mono rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
              />
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 text-white"
              >
                Verify & Enable
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
