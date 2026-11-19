import React, { useEffect, useState } from 'react';
import { Pause, Play, RotateCcw, XCircle, ExternalLink } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { JobStatusLabel, PlatformMark } from './PlatformBadge';
import { PublishingJob } from '../types';

export function QueueHistoryView({
  liveJobEvent,
  queuePaused,
  onQueuePausedChange,
}: {
  liveJobEvent: PublishingJob | null;
  queuePaused: boolean;
  onQueuePausedChange: (paused: boolean) => void;
}) {
  const [jobs, setJobs] = useState<PublishingJob[]>([]);
  const [filter, setFilter] = useState<'all' | 'active' | 'published' | 'failed'>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const loadJobs = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<PublishingJob[]>('/api/jobs');
      setJobs(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadJobs();
  }, []);

  useEffect(() => {
    if (!liveJobEvent) return;
    setJobs((prev) => {
      const idx = prev.findIndex((j) => j.id === liveJobEvent.id);
      if (idx === -1) {
        return [liveJobEvent, ...prev];
      }
      const next = [...prev];
      next[idx] = { ...next[idx], ...liveJobEvent };
      return next;
    });
  }, [liveJobEvent]);

  const filtered = jobs.filter((j) => {
    if (filter === 'active') return ['Waiting', 'Validating', 'Uploading', 'Processing', 'Publishing'].includes(j.status);
    if (filter === 'published') return j.status === 'Published';
    if (filter === 'failed') return ['Failed', 'Requires authorization', 'Requires manual action'].includes(j.status);
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Publishing Queue & History</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Independent per-destination job execution, live progress tracking, scheduling, and safe failure retries.
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            const res = await apiFetch<{ queuePaused: boolean }>('/api/queue/toggle', { method: 'POST' });
            onQueuePausedChange(res.queuePaused);
          }}
          className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-2 whitespace-nowrap shrink-0"
        >
          {queuePaused ? <Play className="w-3.5 h-3.5 text-emerald-500" /> : <Pause className="w-3.5 h-3.5 text-amber-500" />}
          <span>{queuePaused ? 'Resume Queue' : 'Pause Queue'}</span>
        </button>
      </div>

      <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg w-fit">
        {(['all', 'active', 'published', 'failed'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setFilter(tab)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize whitespace-nowrap shrink-0 ${
              filter === tab
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading publishing jobs...</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">No jobs match this filter.</div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {filtered.map((job) => (
              <div key={job.id} className="p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <PlatformMark platform={job.platform} />
                      <span className="text-slate-400">·</span>
                      <span className="text-sm font-medium">{job.videoTitle || `Media #${job.mediaFileId}`}</span>
                      <span className="text-slate-400">·</span>
                      <span className="text-xs text-slate-500">
                        {job.accountDisplayName} (@{job.accountUsername})
                      </span>
                    </div>
                    <div className="text-xs font-mono text-slate-500">
                      Job #{job.id} · {job.scheduledFor ? `Scheduled: ${new Date(job.scheduledFor).toLocaleString()} (${job.timezone})` : `Created: ${new Date(job.createdAt).toLocaleString()}`}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="w-24">
                      <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div className="h-full bg-indigo-500 transition-all" style={{ width: `${job.progress}%` }} />
                      </div>
                    </div>
                    <span className="text-xs font-mono tabular-nums w-9 text-right">{job.progress}%</span>
                    <JobStatusLabel status={job.status} />

                    {job.platformPostUrl && (
                      <a
                        href={job.platformPostUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-indigo-500 hover:underline inline-flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>View</span>
                      </a>
                    )}

                    {['Failed', 'Requires authorization', 'Requires manual action'].includes(job.status) && (
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/api/jobs/${job.id}/retry`, { method: 'POST' });
                          await loadJobs();
                        }}
                        className="px-2.5 py-1 text-xs rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Retry</span>
                      </button>
                    )}

                    {job.status === 'Waiting' && (
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/api/jobs/${job.id}/cancel`, { method: 'POST' });
                          await loadJobs();
                        }}
                        className="px-2.5 py-1 text-xs rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 inline-flex items-center gap-1"
                      >
                        <XCircle className="w-3 h-3" />
                        <span>Cancel</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setExpandedId(expandedId === job.id ? null : job.id)}
                      className="text-xs text-slate-500 hover:underline"
                    >
                      {expandedId === job.id ? 'Hide Logs' : 'Logs'}
                    </button>
                  </div>
                </div>

                {job.errorMessage && (
                  <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 text-xs space-y-1">
                    <div className="text-red-700 dark:text-red-300 font-medium">{job.errorMessage}</div>
                    {job.errorSuggestion && (
                      <div className="text-slate-600 dark:text-slate-400">Solution: {job.errorSuggestion}</div>
                    )}
                  </div>
                )}

                {expandedId === job.id && job.logs && job.logs.length > 0 && (
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800 space-y-1">
                    {job.logs.map((l) => (
                      <div key={l.id} className="text-[11px] font-mono text-slate-600 dark:text-slate-400">
                        [{new Date(l.createdAt).toLocaleTimeString()}] {l.level.toUpperCase()}: {l.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
