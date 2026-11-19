import React, { useEffect, useRef, useState } from 'react';
import {
  UploadCloud,
  Sparkles,
  Send,
  CheckSquare,
  Square,
  Copy,
  Calendar,
  AlertTriangle,
  Trash2,
} from 'lucide-react';
import { apiFetch, formatBytes } from '../lib/api';
import { PlatformMark } from './PlatformBadge';
import {
  AccountGroup,
  AccountPreset,
  EMPTY_METADATA,
  MediaFileItem,
  PlatformType,
  SocialAccount,
  VideoMetadataFields,
} from '../types';

interface BatchDraftItem {
  media: MediaFileItem;
  metadata: VideoMetadataFields;
  selectedAccountIds: number[];
}

interface PreviewDestination {
  accountId: number;
  displayName: string;
  username: string;
  platform: PlatformType;
  hasOAuthToken: boolean;
  mapping: {
    payload: Record<string, unknown>;
    mappedFields: string[];
    ignoredFields: string[];
    warnings: string[];
    requiredMissing: string[];
  };
}

async function extractVideoTechnicalInfo(file: File): Promise<{
  durationSeconds: number;
  resolution: string;
  aspectRatio: string;
  thumbnailDataUrl: string;
}> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const url = URL.createObjectURL(file);
    video.src = url;

    const finish = (dur: number, w: number, h: number, thumb: string) => {
      URL.revokeObjectURL(url);
      const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
      const d = w && h ? gcd(w, h) : 1;
      resolve({
        durationSeconds: Math.round(dur || 0),
        resolution: w && h ? `${w}x${h}` : 'Unknown',
        aspectRatio: w && h ? `${w / d}:${h / d}` : '16:9',
        thumbnailDataUrl: thumb,
      });
    };

    video.onloadeddata = () => {
      video.currentTime = Math.min(1, video.duration ? video.duration * 0.1 : 0);
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(video.duration, video.videoWidth, video.videoHeight, canvas.toDataURL('image/jpeg', 0.7));
      } catch {
        finish(video.duration, video.videoWidth, video.videoHeight, '');
      }
    };
    video.onerror = () => finish(0, 0, 0, '');
  });
}

export function UploadCenterView({
  onPublished,
  initialMediaId,
}: {
  onPublished: () => void;
  initialMediaId?: number | null;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [presets, setPresets] = useState<AccountPreset[]>([]);
  const [batch, setBatch] = useState<BatchDraftItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const [aiMappingOn, setAiMappingOn] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [previewData, setPreviewData] = useState<{
    destinations: PreviewDestination[];
    aiSuggestions: Record<string, unknown> | null;
  } | null>(null);

  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [presetName, setPresetName] = useState('');
  const [showAdvancedSections, setShowAdvancedSections] = useState({
    publishing: true,
    platformOverrides: false,
  });

  useEffect(() => {
    const loadInit = async () => {
      try {
        const [accRes, grpRes, preRes, mediaRes] = await Promise.all([
          apiFetch<{ accounts: SocialAccount[] }>('/api/accounts'),
          apiFetch<AccountGroup[]>('/api/groups'),
          apiFetch<AccountPreset[]>('/api/presets'),
          apiFetch<MediaFileItem[]>('/api/media'),
        ]);
        setAccounts(accRes.accounts);
        setGroups(grpRes);
        setPresets(preRes);

        // CRITICAL REQUIREMENT: ALL connected and eligible accounts selected by default
        const allIds = accRes.accounts.map((a) => a.id);

        if (initialMediaId) {
          const found = mediaRes.find((m) => m.id === initialMediaId);
          if (found) {
            setBatch([
              {
                media: found,
                metadata: { ...EMPTY_METADATA, ...(found.metadata || {}), title: found.metadata?.title || found.title },
                selectedAccountIds: allIds,
              },
            ]);
          }
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to initialize Upload Center');
      }
    };
    void loadInit();
  }, [initialMediaId]);

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    setInfoMsg(null);
    const defaultSelectedIds = accounts.map((a) => a.id);

    try {
      const added: BatchDraftItem[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        setUploadPct(Math.round(((i + 0.3) / files.length) * 100));
        const tech = await extractVideoTechnicalInfo(f);

        const form = new FormData();
        form.append('video', f);
        form.append('title', f.name.replace(/\.[^.]+$/, ''));
        form.append('durationSeconds', String(tech.durationSeconds));
        form.append('resolution', tech.resolution);
        form.append('aspectRatio', tech.aspectRatio);
        form.append('thumbnailDataUrl', tech.thumbnailDataUrl);

        const uploaded = await apiFetch<MediaFileItem>('/api/media/upload', {
          method: 'POST',
          body: form,
        });

        added.push({
          media: uploaded,
          metadata: {
            ...EMPTY_METADATA,
            title: uploaded.title,
          },
          selectedAccountIds: [...defaultSelectedIds],
        });
        setUploadPct(Math.round(((i + 1) / files.length) * 100));
      }

      setBatch((prev) => [...prev, ...added]);
      setInfoMsg(`Uploaded ${added.length} video${added.length > 1 ? 's' : ''}. All ${defaultSelectedIds.length} eligible accounts selected by default.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Video upload failed');
    } finally {
      setUploading(false);
      setUploadPct(0);
    }
  };

  const activeItem = batch[activeIndex] || null;

  const updateActiveMetadata = (patch: Partial<VideoMetadataFields>) => {
    setBatch((prev) =>
      prev.map((item, idx) => (idx === activeIndex ? { ...item, metadata: { ...item.metadata, ...patch } } : item))
    );
  };

  const updateActiveOverride = (platform: PlatformType, field: string, value: string | boolean) => {
    if (!activeItem) return;
    const prevOverrides = activeItem.metadata.platformOverridesJson || {};
    updateActiveMetadata({
      platformOverridesJson: {
        ...prevOverrides,
        [platform]: {
          ...(prevOverrides[platform] || {}),
          [field]: value,
        },
      },
    });
  };

  const setActiveSelection = (ids: number[]) => {
    setBatch((prev) =>
      prev.map((item, idx) => (idx === activeIndex ? { ...item, selectedAccountIds: ids } : item))
    );
  };

  const toggleAccount = (id: number) => {
    if (!activeItem) return;
    const exists = activeItem.selectedAccountIds.includes(id);
    setActiveSelection(
      exists ? activeItem.selectedAccountIds.filter((x) => x !== id) : [...activeItem.selectedAccountIds, id]
    );
  };

  const handleSaveMetadataToCloud = async (statusOverride?: string) => {
    if (!activeItem) return;
    await apiFetch(`/api/media/${activeItem.media.id}/metadata`, {
      method: 'PUT',
      body: JSON.stringify({
        ...activeItem.metadata,
        aiMappingEnabled: aiMappingOn,
        ...(statusOverride ? { status: statusOverride } : {}),
      }),
    });
    setInfoMsg(`Saved metadata${statusOverride ? ` (${statusOverride})` : ''} for "${activeItem.media.originalFilename}".`);
  };

  const handleAnalyzeAndPreview = async () => {
    if (!activeItem) return;
    setAnalyzing(true);
    setError(null);
    try {
      await handleSaveMetadataToCloud();
      const res = await apiFetch<{
        destinations: PreviewDestination[];
        aiSuggestions: Record<string, unknown> | null;
      }>('/api/metadata/preview', {
        method: 'POST',
        body: JSON.stringify({
          metadata: activeItem.metadata,
          accountIds: activeItem.selectedAccountIds,
          useAi: aiMappingOn,
        }),
      });
      setPreviewData(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Metadata analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleOpenConfirmPublish = async () => {
    if (batch.length === 0) {
      setError('Upload at least one video before publishing.');
      return;
    }
    await handleAnalyzeAndPreview();
    setShowPublishModal(true);
  };

  const handlePublishNow = async () => {
    setPublishing(true);
    setError(null);
    try {
      // Persist metadata for every batch item first
      for (const item of batch) {
        await apiFetch(`/api/media/${item.media.id}/metadata`, {
          method: 'PUT',
          body: JSON.stringify({ ...item.metadata, aiMappingEnabled: aiMappingOn }),
        });
      }

      const payloadItems = batch
        .filter((item) => item.selectedAccountIds.length > 0)
        .map((item) => ({
          mediaFileId: item.media.id,
          accountIds: item.selectedAccountIds,
          metadata: item.metadata,
        }));

      if (payloadItems.length === 0) {
        throw new Error('Select at least one destination account before publishing.');
      }

      await apiFetch('/api/publish', {
        method: 'POST',
        body: JSON.stringify({
          items: payloadItems,
          scheduledFor: scheduleEnabled && scheduledFor ? new Date(scheduledFor).toISOString() : null,
          timezone,
          batchName: batch.length > 1 ? `Batch (${batch.length} videos)` : batch[0].metadata.title || batch[0].media.originalFilename,
        }),
      });

      setShowPublishModal(false);
      onPublished();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start publishing');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Universal Upload Center</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Upload single or batch videos, enter all metadata once, review intelligent platform mapping, and publish with one click.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setAiMappingOn((v) => !v)}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg border inline-flex items-center gap-2 whitespace-nowrap shrink-0 ${
              aiMappingOn
                ? 'border-indigo-500 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300'
                : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI Metadata Mapping: {aiMappingOn ? 'ON' : 'OFF'}</span>
          </button>
        </div>
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

      {/* Drag & Drop Multi-Video Uploader */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void handleFilesSelected(e.dataTransfer.files);
        }}
        className="bg-white dark:bg-[#11141B] border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-8 text-center space-y-3"
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="video/mp4,video/quicktime,video/webm,video/x-matroska,video/*"
          className="hidden"
          onChange={(e) => void handleFilesSelected(e.target.files)}
        />
        <UploadCloud className="w-8 h-8 mx-auto text-indigo-500" />
        <div>
          <h2 className="text-sm font-semibold">Drop one or multiple videos here</h2>
          <p className="text-xs text-slate-500 mt-1">
            Automatic extraction of duration, resolution, aspect ratio, format, and video thumbnail.
          </p>
        </div>
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:opacity-90 disabled:opacity-50"
        >
          {uploading ? `Uploading ${uploadPct}%...` : 'Browse Video Files'}
        </button>
      </div>

      {/* Multi-Video Batch Strip */}
      {batch.length > 0 && (
        <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold">Batch Queue ({batch.length} video{batch.length > 1 ? 's' : ''})</span>
            <div className="flex flex-wrap gap-2">
              {batch.length > 1 && activeItem && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setBatch((prev) =>
                        prev.map((it) => ({ ...it, metadata: { ...activeItem.metadata, title: it.metadata.title || activeItem.metadata.title } }))
                      );
                      setInfoMsg('Applied current metadata across all videos in batch.');
                    }}
                    className="px-2.5 py-1 text-xs rounded-md border border-slate-200 dark:border-slate-700 inline-flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Apply Metadata to All</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBatch((prev) =>
                        prev.map((it) => ({ ...it, selectedAccountIds: [...activeItem.selectedAccountIds] }))
                      );
                      setInfoMsg('Applied current account selection across all videos in batch.');
                    }}
                    className="px-2.5 py-1 text-xs rounded-md border border-slate-200 dark:border-slate-700"
                  >
                    Apply Accounts to All
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => void handleSaveMetadataToCloud('draft')}
                className="px-2.5 py-1 text-xs rounded-md border border-slate-200 dark:border-slate-700"
              >
                Save Draft
              </button>
            </div>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-1">
            {batch.map((item, idx) => (
              <div
                key={item.media.id}
                onClick={() => setActiveIndex(idx)}
                className={`min-w-[230px] p-3 rounded-lg border cursor-pointer flex items-center justify-between gap-2 ${
                  idx === activeIndex
                    ? 'border-indigo-500 bg-indigo-500/5'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate">{item.metadata.title || item.media.originalFilename}</div>
                  <div className="text-[11px] font-mono text-slate-500">
                    {item.media.resolution} · {item.media.durationSeconds}s · {formatBytes(item.media.fileSizeBytes)}
                  </div>
                  <div className="text-[11px] text-indigo-500">{item.selectedAccountIds.length} destinations</div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setBatch((prev) => prev.filter((_, i) => i !== idx));
                    setActiveIndex(0);
                  }}
                  className="text-slate-400 hover:text-red-500"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeItem && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* LEFT 2 COLS: Centralized 37-Field Metadata Editor */}
          <div className="xl:col-span-2 space-y-6">
            <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-6">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <h2 className="text-sm font-semibold">Centralized Information Editor</h2>
                <span className="text-xs text-slate-500 font-mono">
                  {activeItem.media.aspectRatio} · {activeItem.media.codec}
                </span>
              </div>

              {/* General Information (1-15) */}
              <div className="space-y-4">
                <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">General Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium mb-1">1. Video Title</label>
                    <input
                      type="text"
                      value={activeItem.metadata.title}
                      onChange={(e) => updateActiveMetadata({ title: e.target.value })}
                      placeholder="The Future of Artificial Intelligence"
                      className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium mb-1">2. Description</label>
                    <textarea
                      rows={3}
                      value={activeItem.metadata.description}
                      onChange={(e) => updateActiveMetadata({ description: e.target.value })}
                      placeholder="Full video description..."
                      className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium mb-1">3. Main Caption (TikTok / Instagram / Reels)</label>
                    <textarea
                      rows={2}
                      value={activeItem.metadata.mainCaption}
                      onChange={(e) => updateActiveMetadata({ mainCaption: e.target.value })}
                      placeholder="Concise hook or social caption..."
                      className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">4. Hashtags</label>
                    <input
                      type="text"
                      value={activeItem.metadata.hashtags}
                      onChange={(e) => updateActiveMetadata({ hashtags: e.target.value })}
                      placeholder="#AI #Technology #Future"
                      className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">5. Keywords</label>
                    <input
                      type="text"
                      value={activeItem.metadata.keywords}
                      onChange={(e) => updateActiveMetadata({ keywords: e.target.value })}
                      placeholder="ai, automation, tutorial"
                      className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">6. Tags (Comma separated)</label>
                    <input
                      type="text"
                      value={activeItem.metadata.tags}
                      onChange={(e) => updateActiveMetadata({ tags: e.target.value })}
                      placeholder="artificial intelligence, tech"
                      className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">10. Category</label>
                    <select
                      value={activeItem.metadata.category}
                      onChange={(e) => updateActiveMetadata({ category: e.target.value })}
                      className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                    >
                      <option value="Education">Education</option>
                      <option value="Technology">Technology</option>
                      <option value="Entertainment">Entertainment</option>
                      <option value="Gaming">Gaming</option>
                      <option value="Business">Business</option>
                      <option value="Music">Music</option>
                      <option value="People">People & Blogs</option>
                      <option value="Sports">Sports</option>
                      <option value="Travel">Travel</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">11. Language</label>
                    <input
                      type="text"
                      value={activeItem.metadata.language}
                      onChange={(e) => updateActiveMetadata({ language: e.target.value })}
                      placeholder="en"
                      className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">12. Location</label>
                    <input
                      type="text"
                      value={activeItem.metadata.location}
                      onChange={(e) => updateActiveMetadata({ location: e.target.value })}
                      placeholder="Bangladesh"
                      className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">13. Alt Text</label>
                    <input
                      type="text"
                      value={activeItem.metadata.altText}
                      onChange={(e) => updateActiveMetadata({ altText: e.target.value })}
                      placeholder="Accessible video description"
                      className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">14. Content Warnings</label>
                    <input
                      type="text"
                      value={activeItem.metadata.contentWarnings}
                      onChange={(e) => updateActiveMetadata({ contentWarnings: e.target.value })}
                      placeholder="Optional warning"
                      className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium mb-1">15. Custom Notes</label>
                    <input
                      type="text"
                      value={activeItem.metadata.customNotes}
                      onChange={(e) => updateActiveMetadata({ customNotes: e.target.value })}
                      placeholder="Internal publishing notes"
                      className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                    />
                  </div>
                </div>
              </div>

              {/* Publishing Options (16-26) */}
              <div className="border-t border-slate-200 dark:border-slate-800 pt-5 space-y-4">
                <button
                  type="button"
                  onClick={() => setShowAdvancedSections((s) => ({ ...s, publishing: !s.publishing }))}
                  className="text-xs font-semibold text-slate-600 dark:text-slate-300 hover:underline"
                >
                  {showAdvancedSections.publishing ? 'Hide' : 'Show'} Publishing Options (Privacy, Audience, Disclosures)
                </button>
                {showAdvancedSections.publishing && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium mb-1">16. Privacy</label>
                      <select
                        value={activeItem.metadata.privacy}
                        onChange={(e) => updateActiveMetadata({ privacy: e.target.value })}
                        className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                      >
                        <option value="public">Public</option>
                        <option value="unlisted">Unlisted</option>
                        <option value="private">Private</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">17. Visibility</label>
                      <input
                        type="text"
                        value={activeItem.metadata.visibility}
                        onChange={(e) => updateActiveMetadata({ visibility: e.target.value })}
                        className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">24. Content Disclosure</label>
                      <select
                        value={activeItem.metadata.contentDisclosure}
                        onChange={(e) => updateActiveMetadata({ contentDisclosure: e.target.value })}
                        className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                      >
                        <option value="none">None</option>
                        <option value="self">Self Promotion</option>
                        <option value="paid">Paid Partnership</option>
                      </select>
                    </div>
                    <div className="md:col-span-3 flex flex-wrap gap-5 pt-1 text-xs">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={activeItem.metadata.allowComments}
                          onChange={(e) => updateActiveMetadata({ allowComments: e.target.checked })}
                        />
                        <span>Allow Comments</span>
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={activeItem.metadata.allowEmbedding}
                          onChange={(e) => updateActiveMetadata({ allowEmbedding: e.target.checked })}
                        />
                        <span>Allow Embedding</span>
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={activeItem.metadata.madeForKids}
                          onChange={(e) => updateActiveMetadata({ madeForKids: e.target.checked })}
                        />
                        <span>Made for Kids</span>
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={activeItem.metadata.ageRestriction}
                          onChange={(e) => updateActiveMetadata({ ageRestriction: e.target.checked })}
                        />
                        <span>Age Restricted (18+)</span>
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={activeItem.metadata.brandedContent}
                          onChange={(e) => updateActiveMetadata({ brandedContent: e.target.checked })}
                        />
                        <span>Branded Content</span>
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={activeItem.metadata.copyrightDeclaration}
                          onChange={(e) => updateActiveMetadata({ copyrightDeclaration: e.target.checked })}
                        />
                        <span>Original / Authorized Rights</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {/* Platform-Specific Overrides (27-37) */}
              <div className="border-t border-slate-200 dark:border-slate-800 pt-5 space-y-4">
                <button
                  type="button"
                  onClick={() =>
                    setShowAdvancedSections((s) => ({ ...s, platformOverrides: !s.platformOverrides }))
                  }
                  className="text-xs font-semibold text-slate-600 dark:text-slate-300 hover:underline"
                >
                  {showAdvancedSections.platformOverrides ? 'Hide' : 'Show'} Optional Platform-Specific Overrides (YouTube / TikTok / IG / FB)
                </button>
                {showAdvancedSections.platformOverrides && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium mb-1">YouTube Title Override</label>
                      <input
                        type="text"
                        value={String(activeItem.metadata.platformOverridesJson?.youtube?.title || '')}
                        onChange={(e) => updateActiveOverride('youtube', 'title', e.target.value)}
                        className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">TikTok Caption Override</label>
                      <input
                        type="text"
                        value={String(activeItem.metadata.platformOverridesJson?.tiktok?.caption || '')}
                        onChange={(e) => updateActiveOverride('tiktok', 'caption', e.target.value)}
                        className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Instagram Caption Override</label>
                      <input
                        type="text"
                        value={String(activeItem.metadata.platformOverridesJson?.instagram?.caption || '')}
                        onChange={(e) => updateActiveOverride('instagram', 'caption', e.target.value)}
                        className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Facebook Caption Override</label>
                      <input
                        type="text"
                        value={String(activeItem.metadata.platformOverridesJson?.facebook?.caption || '')}
                        onChange={(e) => updateActiveOverride('facebook', 'caption', e.target.value)}
                        className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => void handleSaveMetadataToCloud()}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Save Metadata
                </button>
                <button
                  type="button"
                  disabled={analyzing}
                  onClick={handleAnalyzeAndPreview}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 inline-flex items-center gap-2"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{analyzing ? 'Analyzing...' : 'Analyze & Preview Mapped Payloads'}</span>
                </button>
              </div>
            </div>

            {/* Destination Mapped Preview */}
            {previewData && (
              <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
                <h2 className="text-sm font-semibold">Intelligent Metadata Mapping Preview ({previewData.destinations.length} destinations)</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {previewData.destinations.map((dest) => (
                    <div key={dest.accountId} className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold">{dest.displayName} (@{dest.username})</div>
                        <PlatformMark platform={dest.platform} />
                      </div>
                      {dest.mapping.warnings.map((w, i) => (
                        <div key={i} className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1">
                          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                          <span>{w}</span>
                        </div>
                      ))}
                      <pre className="text-[11px] font-mono bg-slate-50 dark:bg-[#090B0F] p-2.5 rounded-md overflow-x-auto max-h-40">
                        {JSON.stringify(dest.mapping.payload, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT COL: Account Selection Matrix & One-Click Publish */}
          <div className="space-y-6">
            <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Destination Accounts</h2>
                <span className="text-xs font-mono tabular-nums text-indigo-600 dark:text-indigo-400">
                  Selected: {activeItem.selectedAccountIds.length} / {accounts.length} accounts
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setActiveSelection(accounts.map((a) => a.id))}
                  className="px-2.5 py-1 text-[11px] font-medium rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSelection([])}
                  className="px-2.5 py-1 text-[11px] font-medium rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Deselect All
                </button>
                {(['youtube', 'tiktok', 'facebook', 'instagram'] as PlatformType[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      const pIds = accounts.filter((a) => a.platform === p).map((a) => a.id);
                      const merged = Array.from(new Set([...activeItem.selectedAccountIds, ...pIds]));
                      setActiveSelection(merged);
                    }}
                    className="px-2.5 py-1 text-[11px] font-medium rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    + {p}
                  </button>
                ))}
              </div>

              {groups.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {groups.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setActiveSelection(g.accountIds)}
                      className="px-2.5 py-1 text-[11px] rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-indigo-500/20"
                    >
                      Group: {g.name}
                    </button>
                  ))}
                </div>
              )}

              {accounts.length === 0 ? (
                <div className="p-4 text-xs text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
                  No social accounts connected yet. Add accounts in the Accounts section.
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-72 overflow-y-auto">
                  {accounts.map((acc) => {
                    const checked = activeItem.selectedAccountIds.includes(acc.id);
                    return (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={() => toggleAccount(acc.id)}
                        className="w-full py-2.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-900/40 px-1"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {checked ? (
                            <CheckSquare className="w-4 h-4 text-indigo-500 shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="text-xs font-medium truncate">{acc.displayName}</div>
                            <div className="text-[11px] text-slate-500 truncate">@{acc.username}</div>
                          </div>
                        </div>
                        <PlatformMark platform={acc.platform} showLabel={false} />
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Presets */}
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    placeholder="Save selection preset..."
                    className="flex-1 px-2.5 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!presetName.trim()) return;
                      const saved = await apiFetch<AccountPreset>('/api/presets', {
                        method: 'POST',
                        body: JSON.stringify({ name: presetName, accountIds: activeItem.selectedAccountIds }),
                      });
                      setPresets((p) => [...p, saved]);
                      setPresetName('');
                    }}
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700"
                  >
                    Save
                  </button>
                </div>
                {presets.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {presets.map((pr) => (
                      <button
                        key={pr.id}
                        type="button"
                        onClick={() => setActiveSelection(pr.accountIdsJson)}
                        className="px-2 py-1 text-[11px] rounded bg-slate-100 dark:bg-slate-800 hover:text-indigo-400"
                      >
                        {pr.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Scheduling */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
                <label className="inline-flex items-center gap-2 text-xs font-medium">
                  <input
                    type="checkbox"
                    checked={scheduleEnabled}
                    onChange={(e) => setScheduleEnabled(e.target.checked)}
                  />
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span>Schedule for later</span>
                </label>
                {scheduleEnabled && (
                  <div className="space-y-2">
                    <input
                      type="datetime-local"
                      value={scheduledFor}
                      onChange={(e) => setScheduledFor(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                    />
                    <input
                      type="text"
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      placeholder="Timezone (e.g. Asia/Dhaka)"
                      className="w-full px-3 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-[#090B0F] border border-slate-200 dark:border-slate-800"
                    />
                  </div>
                )}
              </div>

              <button
                type="button"
                disabled={activeItem.selectedAccountIds.length === 0}
                onClick={handleOpenConfirmPublish}
                className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors"
              >
                <Send className="w-4 h-4" />
                <span>PUBLISH TO SELECTED ACCOUNTS</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pre-Publish Confirmation Screen */}
      {showPublishModal && activeItem && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#11141B] border border-slate-200 dark:border-slate-800 rounded-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6 space-y-5">
            <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-lg font-semibold">Confirm Multi-Platform Publishing</h3>
              <p className="text-xs text-slate-500 mt-1">
                Video: {activeItem.media.originalFilename} · Total destinations: {activeItem.selectedAccountIds.length}
                {scheduleEnabled && scheduledFor ? ` · Scheduled: ${scheduledFor} (${timezone})` : ' · Immediate Dispatch'}
              </p>
            </div>

            <div className="space-y-3">
              {previewData?.destinations.map((dest) => (
                <div key={dest.accountId} className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">
                      {dest.displayName} (@{dest.username})
                    </span>
                    <PlatformMark platform={dest.platform} />
                  </div>
                  {!dest.hasOAuthToken && (
                    <div className="text-[11px] text-amber-600 dark:text-amber-400">
                      Notice: No live OAuth token stored. This destination will pause in &ldquo;Requires authorization&rdquo; without blocking other platforms.
                    </div>
                  )}
                  <div className="text-[11px] font-mono text-slate-500 truncate">
                    Payload: {JSON.stringify(dest.mapping.payload)}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowPublishModal(false)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={publishing}
                onClick={handlePublishNow}
                className="px-5 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white"
              >
                {publishing ? 'Dispatching...' : 'PUBLISH NOW'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
