import React, { useEffect, useState } from 'react';
import { UploadCloud, ArrowRight, RefreshCw } from 'lucide-react';
import { apiFetch, formatBytes, formatNumber } from '../lib/api';
import { JobStatusLabel, PlatformMark } from './PlatformBadge';
import { MediaFileItem, PublishingJob } from '../types';

interface DashboardData {
  stats: {
    totalAccounts: number;
    byPlatform: { youtube: number; tiktok: number; facebook: number; instagram: number };
    totalVideos: number;
    publishedPosts: number;
    failedPosts: number;
    scheduledPosts: number;
    pendingUploads: number;
    activeJobs: number;
    serverStorageBytes: number;
    googleDriveAccountsCount: number;
    pooledDriveLimitBytes: number;
    pooledDriveUsedBytes: number;
    queuePaused: boolean;
  };
  recentActivity: PublishingJob[];
  recentFailures: PublishingJob[];
  latestVideos: MediaFileItem[];
  accountStatusSummary: Array<{
    id: number;
    platform: string;
    displayName: string;
    username: string;
    connectionStatus: string;
    reauthRequired: boolean;
    lastSyncedAt: string | null;
  }>;
}

export function DashboardView({
  onNavigate,
}: {
  onNavigate: (tab: string) => void;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<DashboardData>('/api/dashboard');
      setData(res);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-slate-200/60 dark:bg-slate-800/40 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const { stats } = data;
  const kpis = [
    { label: 'Connected Accounts', value: formatNumber(stats.totalAccounts), sub: `YT ${stats.byPlatform.youtube} · TT ${stats.byPlatform.tiktok} · FB ${stats.byPlatform.facebook} · IG ${stats.byPlatform.instagram}` },
    { label: 'Uploaded Videos', value: formatNumber(stats.totalVideos), sub: `${formatBytes(stats.serverStorageBytes)} on server` },
    { label: 'Published Posts', value: formatNumber(stats.publishedPosts), sub: `${formatNumber(stats.failedPosts)} failed · ${formatNumber(stats.scheduledPosts)} scheduled` },
    { label: 'Google Drive Pool', value: formatBytes(stats.pooledDriveLimitBytes), sub: `${stats.googleDriveAccountsCount} Gmail accounts · ${formatBytes(stats.pooledDriveUsedBytes)} used` },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Command Overview</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Real-time snapshot of connected accounts, active publishing jobs, and pooled storage.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={load}
            className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('upload')}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white inline-flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <UploadCloud className="w-4 h-4" />
            <span>Quick Upload</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-5"
          >
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{k.label}</div>
            <div className="mt-2 text-2xl font-semibold font-mono tabular-nums">{k.value}</div>
            <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 truncate">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recent Publishing Activity</h2>
            <button
              type="button"
              onClick={() => onNavigate('queue')}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
            >
              <span>View Queue</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          {data.recentActivity.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No publishing jobs yet. Upload a video in the Universal Upload Center to begin.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {data.recentActivity.map((job) => (
                <div key={job.id} className="px-5 py-3 flex items-center justify-between gap-4 text-sm">
                  <div className="flex items-center gap-3 min-w-0">
                    <PlatformMark platform={job.platform} />
                    <span className="text-slate-400">·</span>
                    <span className="truncate font-mono text-xs text-slate-600 dark:text-slate-300">
                      Job #{job.id}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <span className="font-mono text-xs tabular-nums text-slate-500">{job.progress}%</span>
                    <JobStatusLabel status={job.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Account Status</h2>
            <button
              type="button"
              onClick={() => onNavigate('accounts')}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Manage
            </button>
          </div>
          {data.accountStatusSummary.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No social accounts connected yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {data.accountStatusSummary.slice(0, 6).map((acc) => (
                <div key={acc.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{acc.displayName}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <PlatformMark platform={acc.platform} />
                      <span>·</span>
                      <span className="truncate">@{acc.username}</span>
                    </div>
                  </div>
                  <JobStatusLabel status={acc.reauthRequired ? 'needs_reauth' : acc.connectionStatus} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {data.recentFailures.length > 0 && (
        <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-sm font-semibold">Recent Failures & Required Authorizations</h2>
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {data.recentFailures.map((job) => (
              <div key={job.id} className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <PlatformMark platform={job.platform} />
                    <span>·</span>
                    <JobStatusLabel status={job.status} />
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300">{job.errorMessage || 'Publishing error'}</p>
                  {job.errorSuggestion && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">Suggested fix: {job.errorSuggestion}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('queue')}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  Inspect & Retry
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
