import React from 'react';
import { CheckCircle2, AlertTriangle, Clock, XCircle, KeyRound, Loader2 } from 'lucide-react';
import { PlatformType } from '../types';

export function PlatformMark({ platform, showLabel = true }: { platform: PlatformType | string; showLabel?: boolean }) {
  const colors: Record<string, string> = {
    youtube: 'text-red-500',
    tiktok: 'text-slate-900 dark:text-slate-100',
    facebook: 'text-blue-500',
    instagram: 'text-pink-500',
  };

  const labels: Record<string, string> = {
    youtube: 'YouTube',
    tiktok: 'TikTok',
    facebook: 'Facebook',
    instagram: 'Instagram',
  };

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap shrink-0">
      <span className={`font-mono text-[11px] font-semibold uppercase ${colors[platform] || 'text-slate-400'}`}>
        {platform === 'youtube' ? 'YT' : platform === 'tiktok' ? 'TT' : platform === 'facebook' ? 'FB' : 'IG'}
      </span>
      {showLabel && <span>{labels[platform] || platform}</span>}
    </span>
  );
}

export function JobStatusLabel({ status }: { status: string }) {
  switch (status) {
    case 'Published':
    case 'connected':
    case 'active':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 whitespace-nowrap shrink-0">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>{status}</span>
        </span>
      );
    case 'Failed':
    case 'error':
    case 'suspended':
    case 'rejected':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400 whitespace-nowrap shrink-0">
          <XCircle className="w-3.5 h-3.5" />
          <span>{status}</span>
        </span>
      );
    case 'Requires authorization':
    case 'Requires manual action':
    case 'needs_reauth':
    case 'expired':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 whitespace-nowrap shrink-0">
          <KeyRound className="w-3.5 h-3.5" />
          <span>{status}</span>
        </span>
      );
    case 'Validating':
    case 'Uploading':
    case 'Processing':
    case 'Publishing':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 whitespace-nowrap shrink-0">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>{status}</span>
        </span>
      );
    case 'Cancelled':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>{status}</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap shrink-0">
          <Clock className="w-3.5 h-3.5" />
          <span>{status}</span>
        </span>
      );
  }
}
