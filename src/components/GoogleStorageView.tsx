import React, { useEffect, useState } from 'react';
import { HardDrive, Plus, RefreshCw, Trash2, Upload, ExternalLink } from 'lucide-react';
import { apiFetch, formatBytes } from '../lib/api';
import { connectGmailDrivePopup, getCachedDriveToken } from '../lib/firebase';
import { GoogleDriveAccount, MediaFileItem } from '../types';

interface DriveFileRow {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  webViewLink?: string;
}

export function GoogleStorageView() {
  const [driveAccounts, setDriveAccounts] = useState<GoogleDriveAccount[]>([]);
  const [libraryVideos, setLibraryVideos] = useState<MediaFileItem[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [driveFiles, setDriveFiles] = useState<DriveFileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [transferMediaId, setTransferMediaId] = useState<number | ''>('');
  const [confirmDeleteFile, setConfirmDeleteFile] = useState<DriveFileRow | null>(null);
  const [confirmRemoveGmail, setConfirmRemoveGmail] = useState<GoogleDriveAccount | null>(null);

  const loadAccounts = async () => {
    setLoading(true);
    try {
      const [accs, vids] = await Promise.all([
        apiFetch<GoogleDriveAccount[]>('/api/google-storage/accounts'),
        apiFetch<MediaFileItem[]>('/api/media'),
      ]);
      setDriveAccounts(accs);
      setLibraryVideos(vids);
      if (accs.length > 0 && !selectedEmail) {
        setSelectedEmail(accs[0].email);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load Google Storage accounts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAccounts();
  }, []);

  const loadFilesForEmail = async (email: string) => {
    setSelectedEmail(email);
    setError(null);
    const token = getCachedDriveToken(email);
    if (!token) {
      setDriveFiles([]);
      return;
    }
    try {
      const res = await apiFetch<{ files: DriveFileRow[] }>('/api/google-storage/files', {
        headers: { 'x-google-access-token': token },
      });
      setDriveFiles(res.files || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to list files from Google Drive');
    }
  };

  const handleConnectGmail = async () => {
    setBusy(true);
    setError(null);
    setInfoMsg(null);
    try {
      const { email, accessToken } = await connectGmailDrivePopup();
      const saved = await apiFetch<GoogleDriveAccount>('/api/google-storage/connect', {
        method: 'POST',
        body: JSON.stringify({ googleAccessToken: accessToken }),
      });
      setInfoMsg(`Connected ${email} (${formatBytes(saved.storageLimitBytes)} quota synced).`);
      await loadAccounts();
      await loadFilesForEmail(email);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to connect Gmail storage account');
    } finally {
      setBusy(false);
    }
  };

  const handleTransferToDrive = async () => {
    if (!selectedEmail || !transferMediaId) return;
    const token = getCachedDriveToken(selectedEmail);
    if (!token) {
      setError(`Session token for ${selectedEmail} expired or is not active in this tab. Click "Reconnect Gmail" first.`);
      return;
    }
    setBusy(true);
    setError(null);
    setInfoMsg(null);
    try {
      await apiFetch(`/api/google-storage/upload-media/${transferMediaId}`, {
        method: 'POST',
        headers: { 'x-google-access-token': token },
        body: JSON.stringify({ driveEmail: selectedEmail }),
      });
      setInfoMsg(`Video backed up to ${selectedEmail}'s Google Drive.`);
      setTransferMediaId('');
      await loadFilesForEmail(selectedEmail);
      await loadAccounts();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Transfer to Google Drive failed');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDeleteDriveFile = async () => {
    if (!confirmDeleteFile || !selectedEmail) return;
    const token = getCachedDriveToken(selectedEmail);
    if (!token) {
      setError(`Reconnect ${selectedEmail} to authorize file deletion.`);
      setConfirmDeleteFile(null);
      return;
    }
    await apiFetch(`/api/google-storage/files/${confirmDeleteFile.id}`, {
      method: 'DELETE',
      headers: { 'x-google-access-token': token },
    });
    setConfirmDeleteFile(null);
    await loadFilesForEmail(selectedEmail);
  };

  const totalLimit = driveAccounts.reduce((s, a) => s + Number(a.storageLimitBytes || 0), 0);
  const totalUsed = driveAccounts.reduce((s, a) => s + Number(a.storageUsageBytes || 0), 0);
  const totalFree = Math.max(0, totalLimit - totalUsed);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Google Drive Storage Pool</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Connect multiple Gmail accounts (15+ GB free Drive storage each) to pool cloud video storage across accounts.
          </p>
        </div>
        <button
          type="button"
          onClick={handleConnectGmail}
          disabled={busy}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white inline-flex items-center gap-2 whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>{busy ? 'Connecting...' : 'Connect Gmail Storage'}</span>
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

      {/* Pooled Capacity Summary */}
      <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <HardDrive className="w-5 h-5 text-indigo-500" />
            <div>
              <div className="text-sm font-semibold">Combined Multi-Gmail Storage Pool</div>
              <div className="text-xs text-slate-500 font-mono tabular-nums">
                {driveAccounts.length} Gmail account{driveAccounts.length === 1 ? '' : 's'} · {formatBytes(totalFree)} free of {formatBytes(totalLimit)}
              </div>
            </div>
          </div>
          <div className="text-right font-mono text-sm tabular-nums">
            <span className="font-semibold">{formatBytes(totalUsed)}</span>
            <span className="text-slate-500"> / {formatBytes(totalLimit)} used</span>
          </div>
        </div>
        <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
          <div
            className="h-full bg-indigo-600 transition-all"
            style={{ width: `${totalLimit > 0 ? Math.min(100, (totalUsed / totalLimit) * 100) : 0}%` }}
          />
        </div>
      </div>

      {/* Individual Gmail Accounts Grid */}
      {loading ? (
        <div className="text-sm text-slate-500">Loading Gmail storage accounts...</div>
      ) : driveAccounts.length === 0 ? (
        <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center space-y-3">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No Gmail Drive accounts connected yet. Sign into 2 or 3 Gmail accounts to pool up to 45+ GB of free Google Drive storage.
          </p>
          <button
            type="button"
            onClick={handleConnectGmail}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Connect First Gmail</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {driveAccounts.map((acc) => {
            const pct = acc.storageLimitBytes > 0 ? Math.min(100, (acc.storageUsageBytes / acc.storageLimitBytes) * 100) : 0;
            const hasToken = Boolean(getCachedDriveToken(acc.email));
            const isSelected = selectedEmail === acc.email;

            return (
              <div
                key={acc.id}
                onClick={() => void loadFilesForEmail(acc.email)}
                className={`cursor-pointer bg-white dark:bg-[#11141B] border rounded-xl p-5 space-y-4 transition-colors ${
                  isSelected
                    ? 'border-indigo-500'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{acc.displayName || acc.email}</div>
                    <div className="text-xs text-slate-500 truncate">{acc.email}</div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmRemoveGmail(acc);
                    }}
                    className="text-xs text-slate-400 hover:text-red-500"
                    title="Remove from pool"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-mono tabular-nums">
                    <span>{formatBytes(acc.storageUsageBytes)} used</span>
                    <span className="text-slate-500">{formatBytes(acc.storageLimitBytes)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className={hasToken ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                    {hasToken ? 'Active Session' : 'Re-auth needed in tab'}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleConnectGmail();
                    }}
                    className="text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>{hasToken ? 'Sync' : 'Reconnect'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload Video to Selected Gmail Drive + Drive File Browser */}
      {selectedEmail && (
        <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
            <div>
              <h2 className="text-sm font-semibold">Drive Storage Explorer · {selectedEmail}</h2>
              <p className="text-xs text-slate-500">Transfer videos from your Video Library directly into this Gmail account&apos;s Google Drive.</p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={transferMediaId}
                onChange={(e) => setTransferMediaId(e.target.value ? Number(e.target.value) : '')}
                className="px-3 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
              >
                <option value="">Select video to offload...</option>
                {libraryVideos.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.title} ({formatBytes(v.fileSizeBytes)})
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!transferMediaId || busy}
                onClick={handleTransferToDrive}
                className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Backup to Drive</span>
              </button>
            </div>
          </div>

          {!getCachedDriveToken(selectedEmail) ? (
            <div className="p-6 text-center space-y-2">
              <p className="text-xs text-slate-500">
                For security, Google Drive tokens are stored in memory only. Reconnect {selectedEmail} to browse or upload Drive files in this session.
              </p>
              <button
                type="button"
                onClick={handleConnectGmail}
                className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Authorize {selectedEmail}
              </button>
            </div>
          ) : driveFiles.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No app-accessible files found in this Google Drive yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {driveFiles.map((f) => (
                <div key={f.id} className="py-3 flex items-center justify-between gap-4 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{f.name}</div>
                    <div className="text-xs font-mono text-slate-500">
                      {f.mimeType} · {f.size ? formatBytes(Number(f.size)) : 'Folder/Doc'}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {f.webViewLink && (
                      <a
                        href={f.webViewLink}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Open</span>
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteFile(f)}
                      className="text-xs text-red-500 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Mandatory Confirmation Dialog for Google Drive Deletion */}
      {confirmDeleteFile && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-semibold">Delete file from Google Drive?</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Are you sure you want to permanently delete &ldquo;{confirmDeleteFile.name}&rdquo; from {selectedEmail}&apos;s Google Drive? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmDeleteFile(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteDriveFile}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-red-600 hover:bg-red-500 text-white"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmRemoveGmail && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-semibold">Remove Gmail from Storage Pool?</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Remove {confirmRemoveGmail.email} from your Social Command Center storage pool? Files inside Google Drive remain untouched.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmRemoveGmail(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await apiFetch(`/api/google-storage/accounts/${confirmRemoveGmail.id}`, { method: 'DELETE' });
                  setConfirmRemoveGmail(null);
                  if (selectedEmail === confirmRemoveGmail.email) setSelectedEmail(null);
                  await loadAccounts();
                }}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-red-600 hover:bg-red-500 text-white"
              >
                Remove Account
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
