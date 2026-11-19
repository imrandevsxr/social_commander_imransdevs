import React, { useEffect, useState } from 'react';
import { Plus, Trash2, KeyRound, FolderPlus, ExternalLink, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { JobStatusLabel, PlatformMark } from './PlatformBadge';
import { AccountGroup, PlatformType, SocialAccount } from '../types';

export function AccountsView() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [platformStatus, setPlatformStatus] = useState<Record<string, { oauthStatus: string; auditStatus: string; notes: string }>>({});
  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // Add / Save Account Form
  const [showAddForm, setShowAddForm] = useState(false);
  const [platform, setPlatform] = useState<PlatformType>('youtube');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [accountIdentifier, setAccountIdentifier] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [pageId, setPageId] = useState('');
  const [igUserId, setIgUserId] = useState('');
  const [notes, setNotes] = useState('');
  const [loginEmail, setLoginEmail] = useState('');

  // Account Group Form
  const [groupName, setGroupName] = useState('');
  const [groupAccIds, setGroupAccIds] = useState<number[]>([]);

  // Disconnect confirmation
  const [confirmDelete, setConfirmDelete] = useState<SocialAccount | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [accRes, grpRes] = await Promise.all([
        apiFetch<{ accounts: SocialAccount[]; platformStatus: Record<string, { oauthStatus: string; auditStatus: string; notes: string }> }>('/api/accounts'),
        apiFetch<AccountGroup[]>('/api/groups'),
      ]);
      setAccounts(accRes.accounts);
      setPlatformStatus(accRes.platformStatus);
      setGroups(grpRes);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load accounts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setInfoMsg(`Connected ${event.data.platform} account via official OAuth.`);
        void loadData();
      } else if (event.data?.type === 'OAUTH_AUTH_ERROR') {
        setError(event.data.error || 'OAuth authorization failed.');
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const handleOAuthConnect = async (p: PlatformType) => {
    setError(null);
    setInfoMsg(null);
    try {
      const res = await apiFetch<{ url: string }>(`/api/oauth/${p}/url?origin=${encodeURIComponent(window.location.origin)}`);
      const popup = window.open(res.url, 'scc_oauth_popup', 'width=620,height=720');
      if (!popup) {
        setError('Popup blocked by browser. Please allow popups for this site.');
      }
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? `${err.message} You can configure Client ID/Secret in Admin Panel -> Platform APIs or save account details & token manually below.`
          : 'OAuth init failed'
      );
      setPlatform(p);
      setShowAddForm(true);
    }
  };

  const handleSaveManualAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/api/accounts', {
        method: 'POST',
        body: JSON.stringify({
          platform,
          displayName,
          username,
          accountIdentifier,
          accessToken: accessToken || undefined,
          refreshToken: refreshToken || undefined,
          pageId: pageId || undefined,
          igUserId: igUserId || undefined,
          notes,
          savedLoginInfo: loginEmail ? { loginEmail } : undefined,
        }),
      });
      setDisplayName('');
      setUsername('');
      setAccountIdentifier('');
      setAccessToken('');
      setRefreshToken('');
      setPageId('');
      setIgUserId('');
      setNotes('');
      setLoginEmail('');
      setShowAddForm(false);
      setInfoMsg('Account profile and encrypted credentials saved to Cloud SQL.');
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save account');
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) return;
    await apiFetch('/api/groups', {
      method: 'POST',
      body: JSON.stringify({ name: groupName, accountIds: groupAccIds }),
    });
    setGroupName('');
    setGroupAccIds([]);
    await loadData();
  };

  const handleDisconnect = async () => {
    if (!confirmDelete) return;
    await apiFetch(`/api/accounts/${confirmDelete.id}`, { method: 'DELETE' });
    setConfirmDelete(null);
    await loadData();
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Connected Social Accounts</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Connect unlimited YouTube, TikTok, Facebook, and Instagram accounts and store account login metadata securely.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddForm((v) => !v)}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white inline-flex items-center gap-2 whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>{showAddForm ? 'Close Account Form' : 'Save Account / Token'}</span>
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
      {infoMsg && (
        <div className="p-3.5 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 text-xs text-emerald-700 dark:text-emerald-300">
          {infoMsg}
        </div>
      )}

      {/* Platform OAuth Connection Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {(['youtube', 'tiktok', 'facebook', 'instagram'] as PlatformType[]).map((p) => {
          const st = platformStatus[p];
          return (
            <div
              key={p}
              className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-4"
            >
              <div>
                <div className="flex items-center justify-between">
                  <PlatformMark platform={p} />
                  <span className="text-xs font-mono text-slate-500">
                    {st?.oauthStatus === 'configured' ? 'OAuth Ready' : 'Needs OAuth Keys'}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                  {st?.notes || 'Connect via official platform authorization.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleOAuthConnect(p)}
                className="w-full py-2 px-3 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Connect {p.charAt(0).toUpperCase() + p.slice(1)}</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Save / Connect Account Profile & Encrypted Credentials Form */}
      {showAddForm && (
        <form
          onSubmit={handleSaveManualAccount}
          className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5"
        >
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
            <h2 className="text-sm font-semibold">Save Account Profile & Encrypted Credentials</h2>
            <span className="text-xs text-slate-500 inline-flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              AES-256-GCM Encrypted in Cloud SQL
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5">Platform</label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as PlatformType)}
                className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
              >
                <option value="youtube">YouTube</option>
                <option value="tiktok">TikTok</option>
                <option value="facebook">Facebook Page</option>
                <option value="instagram">Instagram Professional</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5">Display Name</label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Tech Channel Main"
                className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5">Username / Handle</label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. techchannel"
                className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5">Account / Channel ID</label>
              <input
                type="text"
                value={accountIdentifier}
                onChange={(e) => setAccountIdentifier(e.target.value)}
                placeholder="Channel ID / Open ID"
                className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5">Login Email / Contact (Vault)</label>
              <input
                type="text"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="account-owner@gmail.com"
                className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5">Account Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Niche, region, brand info"
                className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5">OAuth Access Token (Optional)</label>
              <input
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="Paste OAuth access token for live publishing"
                className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5">OAuth Refresh Token (Optional)</label>
              <input
                type="password"
                value={refreshToken}
                onChange={(e) => setRefreshToken(e.target.value)}
                placeholder="Optional refresh token"
                className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
              />
            </div>
            {(platform === 'facebook' || platform === 'instagram') && (
              <div>
                <label className="block text-xs font-medium mb-1.5">
                  {platform === 'instagram' ? 'IG Business User ID' : 'Facebook Page ID'}
                </label>
                <input
                  type="text"
                  value={platform === 'instagram' ? igUserId : pageId}
                  onChange={(e) => (platform === 'instagram' ? setIgUserId(e.target.value) : setPageId(e.target.value))}
                  placeholder={platform === 'instagram' ? '178414...' : '102938...'}
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              Save Account to Cloud
            </button>
          </div>
        </form>
      )}

      {/* Connected Accounts List */}
      <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Saved Accounts Directory ({accounts.length})</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading accounts...</div>
        ) : accounts.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No social accounts added yet. Connect via OAuth above or save an account profile.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-5 font-medium">Account</th>
                  <th className="py-3 px-4 font-medium">Platform</th>
                  <th className="py-3 px-4 font-medium">Identifier</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium">OAuth Token</th>
                  <th className="py-3 px-5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {accounts.map((acc) => (
                  <tr key={acc.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                    <td className="py-3 px-5">
                      <div className="font-medium">{acc.displayName}</div>
                      <div className="text-xs text-slate-500">@{acc.username}</div>
                    </td>
                    <td className="py-3 px-4">
                      <PlatformMark platform={acc.platform} />
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-500">{acc.accountIdentifier}</td>
                    <td className="py-3 px-4">
                      <JobStatusLabel status={acc.reauthRequired ? 'needs_reauth' : acc.connectionStatus} />
                    </td>
                    <td className="py-3 px-4 text-xs">
                      {acc.hasOAuthToken ? (
                        <span className="text-emerald-600 dark:text-emerald-400">Encrypted Token Active</span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400">Profile Saved (Needs OAuth)</span>
                      )}
                    </td>
                    <td className="py-3 px-5 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => handleOAuthConnect(acc.platform)}
                        className="px-2.5 py-1 text-xs rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1"
                      >
                        <KeyRound className="w-3 h-3" />
                        <span>Reauth</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(acc)}
                        className="px-2.5 py-1 text-xs rounded-md border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 inline-flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Disconnect</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Custom Account Groups */}
      <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div>
          <h2 className="text-sm font-semibold">Custom Account Groups</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Group accounts (e.g. Gaming, Business, International) for fast selection inside the Upload Center.
          </p>
        </div>

        <form onSubmit={handleCreateGroup} className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Group name (e.g. Gaming Channels)"
              className="flex-1 min-w-[220px] px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
            />
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>Create Group</span>
            </button>
          </div>
          {accounts.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {accounts.map((acc) => {
                const checked = groupAccIds.includes(acc.id);
                return (
                  <label
                    key={acc.id}
                    className={`px-3 py-1.5 rounded-lg border text-xs cursor-pointer inline-flex items-center gap-2 ${
                      checked
                        ? 'border-indigo-500 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setGroupAccIds((prev) =>
                          prev.includes(acc.id) ? prev.filter((x) => x !== acc.id) : [...prev, acc.id]
                        )
                      }
                    />
                    <span>
                      {acc.displayName} ({acc.platform})
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </form>

        {groups.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
            {groups.map((g) => (
              <div
                key={g.id}
                className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between"
              >
                <div>
                  <div className="text-sm font-medium">{g.name}</div>
                  <div className="text-xs font-mono text-slate-500">{g.accountIds.length} accounts</div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch(`/api/groups/${g.id}`, { method: 'DELETE' });
                    await loadData();
                  }}
                  className="text-xs text-red-500 hover:underline"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Disconnect Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-semibold">Disconnect {confirmDelete.displayName}?</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              This removes @{confirmDelete.username} ({confirmDelete.platform}) and its stored encrypted OAuth tokens from Social Command Center.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-red-600 hover:bg-red-500 text-white"
              >
                Disconnect Account
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
