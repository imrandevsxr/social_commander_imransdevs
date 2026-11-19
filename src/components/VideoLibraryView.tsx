import React, { useEffect, useState } from 'react';
import { Film, Search, Copy, Archive, Trash2, Edit3 } from 'lucide-react';
import { apiFetch, formatBytes } from '../lib/api';
import { MediaFileItem } from '../types';

export function VideoLibraryView({
  onEditInUploadCenter,
}: {
  onEditInUploadCenter: (mediaId: number) => void;
}) {
  const [videos, setVideos] = useState<MediaFileItem[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [previewVideo, setPreviewVideo] = useState<MediaFileItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MediaFileItem | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<MediaFileItem[]>('/api/media');
      setVideos(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = videos.filter((v) => {
    const matchesSearch =
      v.title.toLowerCase().includes(search.toLowerCase()) ||
      v.originalFilename.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || v.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cloud Video Library</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Browse uploaded, draft, published, and archived video assets synchronized in PostgreSQL.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search videos by title or filename..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800"
          />
        </div>
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg">
          {['all', 'uploaded', 'draft', 'published', 'archived'].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize whitespace-nowrap shrink-0 ${
                statusFilter === st
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Loading video library...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center text-sm text-slate-500">
          No matching videos in your cloud library.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((v) => (
            <div
              key={v.id}
              className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col justify-between"
            >
              <div
                onClick={() => setPreviewVideo(v)}
                className="h-40 bg-slate-950 relative cursor-pointer flex items-center justify-center overflow-hidden"
              >
                {v.thumbnailUrl ? (
                  <img
                    src={v.thumbnailUrl}
                    alt={v.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Film className="w-8 h-8 text-slate-600" />
                )}
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <div className="text-sm font-semibold truncate">{v.title}</div>
                  <div className="text-xs font-mono text-slate-500 mt-0.5">
                    {v.resolution} · {v.durationSeconds}s · {formatBytes(v.fileSizeBytes)} · {v.status}
                  </div>
                  {v.driveAccountEmail && (
                    <div className="text-[11px] text-indigo-500 mt-1 truncate">
                      Drive backup: {v.driveAccountEmail}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => onEditInUploadCenter(v.id)}
                    className="px-2.5 py-1 text-xs rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>Publish / Edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/api/media/${v.id}/duplicate`, { method: 'POST' });
                      await load();
                    }}
                    className="px-2.5 py-1 text-xs rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Reuse</span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/api/media/${v.id}/status`, {
                        method: 'PATCH',
                        body: JSON.stringify({ status: v.status === 'archived' ? 'uploaded' : 'archived' }),
                      });
                      await load();
                    }}
                    className="px-2.5 py-1 text-xs rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1"
                  >
                    <Archive className="w-3 h-3" />
                    <span>{v.status === 'archived' ? 'Restore' : 'Archive'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(v)}
                    className="px-2.5 py-1 text-xs rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 ml-auto"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {previewVideo && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl max-w-2xl w-full p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{previewVideo.title}</h3>
              <button type="button" onClick={() => setPreviewVideo(null)} className="text-xs text-slate-500 hover:underline">
                Close
              </button>
            </div>
            <video src={`/api/media/${previewVideo.id}/stream`} controls className="w-full max-h-[60vh] rounded-lg bg-black" />
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-semibold">Delete video asset?</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Delete &ldquo;{confirmDelete.originalFilename}&rdquo; and its metadata permanently from server storage?
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
                onClick={async () => {
                  await apiFetch(`/api/media/${confirmDelete.id}`, { method: 'DELETE' });
                  setConfirmDelete(null);
                  await load();
                }}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-red-600 hover:bg-red-500 text-white"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
