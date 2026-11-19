import React, { useEffect, useState } from 'react';
import { CheckCheck } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { NotificationItem } from '../types';

export function NotificationsView({ onUnreadCountChange }: { onUnreadCountChange: (count: number) => void }) {
  const [items, setItems] = useState<NotificationItem[]>([]);

  const load = async () => {
    const res = await apiFetch<NotificationItem[]>('/api/notifications');
    setItems(res);
    onUnreadCountChange(res.filter((n) => !n.isRead).length);
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Real-time alerts for uploads, publishing completions, authorization renewals, and approvals.
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            await apiFetch('/api/notifications/read-all', { method: 'POST' });
            await load();
          }}
          className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
        >
          <CheckCheck className="w-3.5 h-3.5" />
          <span>Mark All Read</span>
        </button>
      </div>

      <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-200 dark:divide-slate-800">
        {items.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">No notifications yet.</div>
        ) : (
          items.map((n) => (
            <div
              key={n.id}
              onClick={async () => {
                if (!n.isRead) {
                  await apiFetch(`/api/notifications/${n.id}/read`, { method: 'POST' });
                  await load();
                }
              }}
              className={`p-4 cursor-pointer flex items-start justify-between gap-4 ${
                n.isRead ? 'opacity-70' : 'bg-indigo-500/5'
              }`}
            >
              <div className="space-y-1">
                <div className="text-sm font-semibold">{n.title}</div>
                <div className="text-xs text-slate-600 dark:text-slate-300">{n.message}</div>
              </div>
              <div className="text-xs font-mono text-slate-500 whitespace-nowrap">
                {new Date(n.createdAt).toLocaleString()}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
