import React, { useState } from 'react';
import { Lock, UserPlus, Shield, KeyRound, Sun, Moon } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { signInWithGoogleForApp } from '../lib/firebase';
import { AppInfo, UserProfile } from '../types';

interface AuthGateProps {
  appInfo: AppInfo;
  darkMode: boolean;
  onToggleTheme: () => void;
  onAuthenticated: (user: UserProfile) => void;
}

export function AuthGate({ appInfo, darkMode, onToggleTheme, onAuthenticated }: AuthGateProps) {
  const [mode, setMode] = useState<'login' | 'register' | 'master' | 'invite'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [masterSecret, setMasterSecret] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [needs2FA, setNeeds2FA] = useState(false);
  const [inviteToken, setInviteToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ user?: UserProfile; requires2FA?: boolean }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password, totpCode: needs2FA ? totpCode : undefined }),
      });
      if (res.requires2FA) {
        setNeeds2FA(true);
      } else if (res.user) {
        onAuthenticated(res.user);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleMasterLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ user?: UserProfile; requires2FA?: boolean }>('/api/auth/master-login', {
        method: 'POST',
        body: JSON.stringify({ secret: masterSecret, totpCode: needs2FA ? totpCode : undefined }),
      });
      if (res.requires2FA) {
        setNeeds2FA(true);
      } else if (res.user) {
        onAuthenticated(res.user);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Master access verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await apiFetch<{ message: string }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username }),
      });
      setSuccessMsg(res.message);
      setUsername('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ user: UserProfile }>('/api/auth/complete-invite', {
        method: 'POST',
        body: JSON.stringify({ username, inviteToken, newPassword }),
      });
      onAuthenticated(res.user);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to activate account');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const { idToken } = await signInWithGoogleForApp();
      const res = await apiFetch<{ user: UserProfile }>('/api/auth/google-session', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      onAuthenticated(res.user);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between bg-slate-50 dark:bg-[#090B0F] text-slate-900 dark:text-slate-100 p-6">
      <div className="flex items-center justify-between max-w-5xl w-full mx-auto">
        <span className="font-display text-lg font-semibold tracking-tight">{appInfo.appName}</span>
        <button
          type="button"
          onClick={onToggleTheme}
          className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800/60 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
        >
          {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          <span>{darkMode ? 'Light' : 'Dark'}</span>
        </button>
      </div>

      <main className="w-full max-w-md mx-auto my-auto py-10">
        <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-8">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              {mode === 'login' && 'Sign in to Command Center'}
              {mode === 'register' && 'Request Account Access'}
              {mode === 'master' && 'Administrator Master Access'}
              {mode === 'invite' && 'Activate Approved Account'}
            </h1>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
              {mode === 'login' && 'Centralized multi-platform video publishing, storage, and live analytics.'}
              {mode === 'register' && 'Submit a unique username for administrator approval.'}
              {mode === 'master' && 'Enter the server-verified master access secret.'}
              {mode === 'invite' && 'Set your password using the invitation token issued by your administrator.'}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg mb-6">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
                setNeeds2FA(false);
              }}
              className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                mode === 'login'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
                setSuccessMsg(null);
              }}
              className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                mode === 'register'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              REGISTER
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('master');
                setError(null);
                setNeeds2FA(false);
              }}
              className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                mode === 'master'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Master Access
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {successMsg && (
            <div className="mb-4 p-3 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 text-xs text-emerald-700 dark:text-emerald-300">
              {successMsg}
            </div>
          )}

          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Username
                </label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {needs2FA && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Two-Factor Code (6 digits)
                  </label>
                  <input
                    type="text"
                    required
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="123456"
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors"
              >
                <Lock className="w-4 h-4" />
                <span>{loading ? 'Signing in...' : 'Sign In'}</span>
              </button>

              <div className="pt-2 flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setMode('invite');
                    setError(null);
                  }}
                  className="text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  Have an approved invitation token?
                </button>
              </div>
            </form>
          )}

          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Desired Username
                </label>
                <input
                  type="text"
                  required
                  minLength={3}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. creator_alex"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors"
              >
                <UserPlus className="w-4 h-4" />
                <span>{loading ? 'Submitting...' : 'REGISTER'}</span>
              </button>
            </form>
          )}

          {mode === 'master' && (
            <form onSubmit={handleMasterLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Master Access Secret
                </label>
                <input
                  type="password"
                  required
                  value={masterSecret}
                  onChange={(e) => setMasterSecret(e.target.value)}
                  placeholder="Enter master access secret"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {needs2FA && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Two-Factor Code (6 digits)
                  </label>
                  <input
                    type="text"
                    required
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="123456"
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors"
              >
                <Shield className="w-4 h-4" />
                <span>{loading ? 'Verifying...' : 'Unlock Super Administrator'}</span>
              </button>
            </form>
          )}

          {mode === 'invite' && (
            <form onSubmit={handleCompleteInvite} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Approved Username
                </label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Invitation Token
                </label>
                <input
                  type="text"
                  required
                  value={inviteToken}
                  onChange={(e) => setInviteToken(e.target.value)}
                  placeholder="Paste one-time token from administrator"
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Create Password (min 8 chars)
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors"
              >
                <KeyRound className="w-4 h-4" />
                <span>{loading ? 'Activating...' : 'Set Password & Sign In'}</span>
              </button>
            </form>
          )}

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
            <span className="text-xs text-slate-400">or</span>
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full py-2.5 px-4 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#161B24] hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm font-medium inline-flex items-center justify-center gap-3 transition-colors"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 48 48">
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              />
            </svg>
            <span>Sign in with Google</span>
          </button>
        </div>
      </main>

      <footer className="max-w-5xl w-full mx-auto text-center text-xs text-slate-500 dark:text-slate-500">
        {appInfo.appName} · Cloud SQL & Multi-Platform Publishing Infrastructure
      </footer>
    </div>
  );
}
