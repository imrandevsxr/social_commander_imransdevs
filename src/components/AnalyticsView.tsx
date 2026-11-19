import React, { useEffect, useState } from 'react';
import { RefreshCw, Radio } from 'lucide-react';
import { apiFetch, formatNumber } from '../lib/api';
import { JobStatusLabel, PlatformMark } from './PlatformBadge';
import { AccountAnalyticsRow, PlatformType } from '../types';

interface AnalyticsResponse {
  totals: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    followers: number;
    publishedCount: number;
  };
  accounts: AccountAnalyticsRow[];
}

export function AnalyticsView({
  liveAnalyticsEvent,
  wsConnected,
}: {
  liveAnalyticsEvent: Record<string, unknown> | null;
  wsConnected: boolean;
}) {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [platformFilter, setPlatformFilter] = useState<'all' | PlatformType>('all');
  const [accountFilter, setAccountFilter] = useState<number | 'all'>('all');
  const [syncing, setSyncing] = useState(false);
  const [autoRefreshSec, setAutoRefreshSec] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAnalytics = async () => {
    try {
      const res = await apiFetch<AnalyticsResponse>('/api/analytics');
      setData(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    }
  };

  const syncLive = async () => {
    setSyncing(true);
    setError(null);
    try {
      await apiFetch('/api/analytics/sync', { method: 'POST' });
      setLastSyncedAt(new Date().toLocaleTimeString());
      await loadAnalytics();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to sync live metrics');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    void loadAnalytics();
  }, []);

  useEffect(() => {
    if (liveAnalyticsEvent) {
      void loadAnalytics();
      setLastSyncedAt(new Date().toLocaleTimeString());
    }
  }, [liveAnalyticsEvent]);

  useEffect(() => {
    if (autoRefreshSec <= 0) return;
    const id = setInterval(() => {
      void syncLive();
    }, autoRefreshSec * 1000);
    return () => clearInterval(id);
  }, [autoRefreshSec]);

  const rows = (data?.accounts || []).filter((r) => {
    const pMatch = platformFilter === 'all' || r.platform === platformFilter;
    const aMatch = accountFilter === 'all' || r.accountId === accountFilter;
    return pMatch && aMatch;
  });

  const filteredTotals = rows.reduce(
    (acc, r) => ({
      views: acc.views + Number(r.views || 0),
      likes: acc.likes + Number(r.likes || 0),
      comments: acc.comments + Number(r.comments || 0),
      shares: acc.shares + Number(r.shares || 0),
      followers: acc.followers + Number(r.followers || 0),
      publishedCount: acc.publishedCount + Number(r.publishedCount || 0),
    }),
    { views: 0, likes: 0, comments: 0, shares: 0, followers: 0, publishedCount: 0 }
  );

  const maxBarViews = Math.max(1, ...rows.map((r) => Number(r.views || r.likes || 0)));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Live Account Analytics</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Real-time views, likes, comments, shares, and engagement metrics fetched directly from authorized platform APIs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {wsConnected && (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              <Radio className="w-3.5 h-3.5" />
              <span>Live Stream Connected</span>
            </span>
          )}
          <select
            value={autoRefreshSec}
            onChange={(e) => setAutoRefreshSec(Number(e.target.value))}
            className="px-3 py-2 text-xs rounded-lg bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800"
          >
            <option value={0}>Live Poll: Manual</option>
            <option value={15}>Live Poll: Every 15s</option>
            <option value={30}>Live Poll: Every 30s</option>
            <option value={60}>Live Poll: Every 60s</option>
          </select>
          <button
            type="button"
            disabled={syncing}
            onClick={syncLive}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white inline-flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'Syncing APIs...' : 'Sync Live Metrics'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg">
          {(['all', 'youtube', 'tiktok', 'facebook', 'instagram'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setPlatformFilter(p);
                setAccountFilter('all');
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize whitespace-nowrap shrink-0 ${
                platformFilter === p
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="px-3 py-2 text-xs rounded-lg bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800"
          >
            <option value="all">All Connected Accounts</option>
            {(data?.accounts || []).map((a) => (
              <option key={a.accountId} value={a.accountId}>
                {a.displayName} (@{a.username} · {a.platform})
              </option>
            ))}
          </select>
          {lastSyncedAt && (
            <span className="text-xs font-mono text-slate-500">Last synced {lastSyncedAt}</span>
          )}
        </div>
      </div>

      {/* KPI Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        {[
          { label: 'Total Views', value: formatNumber(filteredTotals.views) },
          { label: 'Total Likes', value: formatNumber(filteredTotals.likes) },
          { label: 'Total Comments', value: formatNumber(filteredTotals.comments) },
          { label: 'Total Shares', value: formatNumber(filteredTotals.shares) },
          { label: 'Followers / Subs', value: formatNumber(filteredTotals.followers) },
          { label: 'Published Videos', value: formatNumber(filteredTotals.publishedCount) },
        ].map((k) => (
          <div key={k.label} className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">{k.label}</div>
            <div className="mt-1.5 text-xl font-semibold font-mono tabular-nums">{k.value}</div>
          </div>
        ))}
      </div>

      {/* Account Reach Distribution Chart */}
      {rows.length > 0 && (
        <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <h2 className="text-sm font-semibold">Account Performance Comparison</h2>
          <div className="space-y-3">
            {rows.map((r) => {
              const primaryVal = Number(r.views || r.likes || 0);
              const widthPct = Math.max(2, Math.round((primaryVal / maxBarViews) * 100));
              return (
                <div key={r.accountId} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <PlatformMark platform={r.platform} />
                      <span className="font-medium">{r.displayName}</span>
                      <span className="text-slate-500">@{r.username}</span>
                    </div>
                    <span className="font-mono tabular-nums text-slate-500">
                      {formatNumber(r.views)} views · {formatNumber(r.likes)} likes · {formatNumber(r.comments)} comments
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div className="h-full bg-indigo-500 transition-all" style={{ width: `${widthPct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-Account Detailed Metrics Table */}
      <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Per-Account Live Telemetry</h2>
          <span className="text-xs text-slate-500">Missing API metrics are labeled transparently, never fabricated.</span>
        </div>

        {rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No connected accounts found for this filter. Connect accounts in the Accounts section to view live analytics.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-5 font-medium">Account</th>
                  <th className="py-3 px-3 font-medium">Platform</th>
                  <th className="py-3 px-3 font-medium text-right">Views</th>
                  <th className="py-3 px-3 font-medium text-right">Likes</th>
                  <th className="py-3 px-3 font-medium text-right">Comments</th>
                  <th className="py-3 px-3 font-medium text-right">Shares</th>
                  <th className="py-3 px-3 font-medium text-right">Followers</th>
                  <th className="py-3 px-3 font-medium text-right">Eng. Rate</th>
                  <th className="py-3 px-5 font-medium">API Source / Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {rows.map((r) => (
                  <tr key={r.accountId} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                    <td className="py-3 px-5">
                      <div className="font-medium">{r.displayName}</div>
                      <div className="text-xs text-slate-500">@{r.username}</div>
                    </td>
                    <td className="py-3 px-3">
                      <PlatformMark platform={r.platform} />
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {r.metricsAvailable?.views ? formatNumber(r.views) : <span className="text-xs text-slate-400">N/A via API</span>}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {r.metricsAvailable?.likes ? formatNumber(r.likes) : <span className="text-xs text-slate-400">N/A via API</span>}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {r.metricsAvailable?.comments ? formatNumber(r.comments) : <span className="text-xs text-slate-400">N/A via API</span>}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {r.metricsAvailable?.shares ? formatNumber(r.shares) : <span className="text-xs text-slate-400">N/A via API</span>}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {r.metricsAvailable?.followers ? formatNumber(r.followers) : <span className="text-xs text-slate-400">N/A via API</span>}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">{r.engagementRate}</td>
                    <td className="py-3 px-5 text-xs">
                      <div className="space-y-0.5">
                        <JobStatusLabel status={r.hasOAuthToken ? 'connected' : 'needs_reauth'} />
                        <div className="text-[11px] text-slate-500 max-w-[220px] truncate" title={r.sourceLabel}>
                          {r.sourceLabel}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
