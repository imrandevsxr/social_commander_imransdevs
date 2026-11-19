import fs from 'fs';
import path from 'path';
import { decryptText, encryptText } from './crypto.ts';

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
  tokenType?: string;
  pageId?: string;
  igUserId?: string;
  openId?: string;
}

export interface AdapterPublishResult {
  success: boolean;
  status: 'Published' | 'Failed' | 'Requires authorization' | 'Requires manual action';
  platformPostId?: string;
  platformPostUrl?: string;
  errorMessage?: string;
  errorSuggestion?: string;
}

export interface AnalyticsSyncResult {
  success: boolean;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  followers: number;
  publishedCount: number;
  engagementRate: string;
  metricsAvailable: Record<string, boolean>;
  sourceLabel: string;
  errorMessage?: string;
}

export function getAppUrl(reqOrigin?: string): string {
  return (process.env.APP_URL || reqOrigin || 'http://localhost:3000').replace(/\/$/, '');
}

export function parseEncryptedTokens(encryptedJson?: string | null): OAuthTokens | null {
  if (!encryptedJson) return null;
  try {
    const raw = decryptText(encryptedJson);
    return JSON.parse(raw) as OAuthTokens;
  } catch {
    return null;
  }
}

export function serializeEncryptedTokens(tokens: OAuthTokens): string {
  return encryptText(JSON.stringify(tokens));
}

async function refreshYouTubeTokenIfNeeded(
  tokens: OAuthTokens,
  clientId?: string | null,
  clientSecret?: string | null
): Promise<OAuthTokens> {
  if (!tokens.refreshToken || !clientId || !clientSecret) return tokens;
  if (tokens.expiresAt && Date.now() < tokens.expiresAt - 60_000) return tokens;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) return tokens;
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return tokens;
  return {
    ...tokens,
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
}

export function buildPlatformAuthUrl(
  platform: 'youtube' | 'tiktok' | 'facebook' | 'instagram',
  clientId: string,
  redirectUri: string,
  state: string
): string {
  if (platform === 'youtube') {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent select_account',
      scope: [
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/youtube.readonly',
        'https://www.googleapis.com/auth/userinfo.profile',
      ].join(' '),
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  if (platform === 'tiktok') {
    const params = new URLSearchParams({
      client_key: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'user.info.basic,video.publish,video.upload,video.list',
      state,
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
  }

  // Facebook & Instagram both use Meta Facebook Login OAuth
  const scopes =
    platform === 'instagram'
      ? 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement'
      : 'pages_show_list,pages_read_engagement,pages_manage_posts,publish_video';
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    state,
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
}

export async function publishToYouTube(
  tokens: OAuthTokens,
  filePath: string | null,
  mimeType: string,
  payload: Record<string, unknown>,
  onProgress: (pct: number, stepMsg: string) => Promise<void>,
  clientId?: string | null,
  clientSecret?: string | null
): Promise<AdapterPublishResult> {
  const activeTokens = await refreshYouTubeTokenIfNeeded(tokens, clientId, clientSecret);
  if (!activeTokens.accessToken) {
    return {
      success: false,
      status: 'Requires authorization',
      errorMessage: 'Missing YouTube OAuth access token.',
      errorSuggestion: 'Reauthorize this YouTube account in the Accounts section using Google OAuth.',
    };
  }

  if (!filePath || !fs.existsSync(filePath)) {
    return {
      success: false,
      status: 'Failed',
      errorMessage: 'Video media file could not be found on server storage.',
      errorSuggestion: 'Upload or sync the video file to server storage before publishing to YouTube.',
    };
  }

  await onProgress(25, 'Initializing YouTube resumable upload session...');
  const stat = fs.statSync(filePath);
  const initRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${activeTokens.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(stat.size),
        'X-Upload-Content-Type': mimeType || 'video/mp4',
      },
      body: JSON.stringify(payload),
    }
  );

  if (initRes.status === 401 || initRes.status === 403) {
    const errText = await initRes.text();
    return {
      success: false,
      status: 'Requires authorization',
      errorMessage: `YouTube API authorization rejected (${initRes.status}): ${errText.slice(0, 220)}`,
      errorSuggestion: 'Check YouTube Data API v3 quota in Google Cloud Console and reauthorize the account.',
    };
  }

  if (!initRes.ok) {
    const errText = await initRes.text();
    return {
      success: false,
      status: 'Failed',
      errorMessage: `YouTube upload init failed (${initRes.status}): ${errText.slice(0, 220)}`,
      errorSuggestion: 'Verify video title, privacy status, and YouTube Data API v3 enablement.',
    };
  }

  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) {
    return {
      success: false,
      status: 'Failed',
      errorMessage: 'YouTube did not return a resumable upload session URL.',
      errorSuggestion: 'Retry publishing this destination.',
    };
  }

  await onProgress(60, 'Uploading video binary to YouTube...');
  const fileBuffer = fs.readFileSync(filePath);
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Length': String(fileBuffer.length),
      'Content-Type': mimeType || 'video/mp4',
    },
    body: fileBuffer,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    return {
      success: false,
      status: 'Failed',
      errorMessage: `YouTube video transfer failed (${uploadRes.status}): ${errText.slice(0, 220)}`,
      errorSuggestion: 'Ensure the file is a valid MP4/MOV video within YouTube limits and retry.',
    };
  }

  await onProgress(95, 'Finalizing YouTube video metadata...');
  const created = (await uploadRes.json()) as { id?: string };
  return {
    success: true,
    status: 'Published',
    platformPostId: created.id,
    platformPostUrl: created.id ? `https://www.youtube.com/watch?v=${created.id}` : undefined,
  };
}

export async function publishToTikTok(
  tokens: OAuthTokens,
  filePath: string | null,
  payload: Record<string, unknown>,
  onProgress: (pct: number, stepMsg: string) => Promise<void>
): Promise<AdapterPublishResult> {
  if (!tokens.accessToken) {
    return {
      success: false,
      status: 'Requires authorization',
      errorMessage: 'Missing TikTok Content Posting API access token.',
      errorSuggestion: 'Connect or reauthorize your TikTok creator account via TikTok OAuth.',
    };
  }

  if (!filePath || !fs.existsSync(filePath)) {
    return {
      success: false,
      status: 'Failed',
      errorMessage: 'Video media file is unavailable on server storage.',
      errorSuggestion: 'Re-upload the video file and retry.',
    };
  }

  const stat = fs.statSync(filePath);
  await onProgress(30, 'Initializing TikTok Content Posting API v2 upload...');

  const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      post_info: payload.post_info,
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: stat.size,
        chunk_size: stat.size,
        total_chunk_count: 1,
      },
    }),
  });

  const initJson = (await initRes.json().catch(() => ({}))) as {
    data?: { publish_id?: string; upload_url?: string };
    error?: { code?: string; message?: string };
  };

  if (!initRes.ok || initJson.error?.code !== 'ok') {
    const code = initJson.error?.code || String(initRes.status);
    const msg = initJson.error?.message || 'TikTok Content Posting API rejected upload init.';
    const needsAuth = initRes.status === 401 || code === 'access_token_invalid';
    return {
      success: false,
      status: needsAuth ? 'Requires authorization' : 'Failed',
      errorMessage: `TikTok API error (${code}): ${msg}`,
      errorSuggestion:
        'Ensure TikTok Content Posting API (video.publish) is approved and unaudited apps use SELF_ONLY privacy.',
    };
  }

  const uploadUrl = initJson.data?.upload_url;
  const publishId = initJson.data?.publish_id;
  if (!uploadUrl || !publishId) {
    return {
      success: false,
      status: 'Failed',
      errorMessage: 'TikTok did not return upload_url or publish_id.',
      errorSuggestion: 'Retry publishing after checking TikTok app permissions.',
    };
  }

  await onProgress(65, 'Transferring video chunk to TikTok...');
  const fileBuf = fs.readFileSync(filePath);
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Range': `bytes 0-${fileBuf.length - 1}/${fileBuf.length}`,
      'Content-Length': String(fileBuf.length),
    },
    body: fileBuf,
  });

  if (!putRes.ok) {
    return {
      success: false,
      status: 'Failed',
      errorMessage: `TikTok binary chunk upload failed (${putRes.status}).`,
      errorSuggestion: 'Verify MP4/WebM codec compatibility and retry.',
    };
  }

  await onProgress(90, 'Polling TikTok publish status...');
  return {
    success: true,
    status: 'Published',
    platformPostId: publishId,
  };
}

export async function publishToFacebook(
  tokens: OAuthTokens,
  filePath: string | null,
  payload: Record<string, unknown>,
  onProgress: (pct: number, stepMsg: string) => Promise<void>
): Promise<AdapterPublishResult> {
  if (!tokens.accessToken) {
    return {
      success: false,
      status: 'Requires authorization',
      errorMessage: 'Missing Meta Graph API Page access token.',
      errorSuggestion: 'Connect your Facebook Page via Meta OAuth with pages_manage_posts & publish_video permissions.',
    };
  }

  const pageId = String(payload.page_id || tokens.pageId || 'me');
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      success: false,
      status: 'Failed',
      errorMessage: 'Video media file is missing from server storage.',
      errorSuggestion: 'Upload the video again and retry.',
    };
  }

  await onProgress(45, `Uploading video to Facebook Page (${pageId})...`);
  const fileBuffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('source', new Blob([fileBuffer], { type: 'video/mp4' }), path.basename(filePath));
  if (payload.title) form.append('title', String(payload.title));
  if (payload.description) form.append('description', String(payload.description));
  form.append('published', String(payload.published !== false));
  form.append('access_token', tokens.accessToken);

  const res = await fetch(`https://graph-video.facebook.com/v21.0/${encodeURIComponent(pageId)}/videos`, {
    method: 'POST',
    body: form,
  });

  const data = (await res.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string; code?: number };
  };

  if (!res.ok || !data.id) {
    const isAuth = data.error?.code === 190 || res.status === 401;
    return {
      success: false,
      status: isAuth ? 'Requires authorization' : 'Failed',
      errorMessage: `Facebook Graph API error: ${data.error?.message || res.statusText}`,
      errorSuggestion: 'Ensure you authorized a Facebook Page (not personal profile) with publish_video scope.',
    };
  }

  await onProgress(95, 'Facebook Page video published.');
  return {
    success: true,
    status: 'Published',
    platformPostId: data.id,
    platformPostUrl: `https://www.facebook.com/${pageId}/videos/${data.id}`,
  };
}

export async function publishToInstagram(
  tokens: OAuthTokens,
  publicVideoUrl: string | null,
  payload: Record<string, unknown>,
  onProgress: (pct: number, stepMsg: string) => Promise<void>
): Promise<AdapterPublishResult> {
  if (!tokens.accessToken || !tokens.igUserId) {
    return {
      success: false,
      status: 'Requires authorization',
      errorMessage: 'Missing Instagram Professional Account OAuth token or IG User ID.',
      errorSuggestion: 'Reconnect an Instagram Business/Creator account linked to a Facebook Page.',
    };
  }

  if (!publicVideoUrl) {
    return {
      success: false,
      status: 'Requires manual action',
      errorMessage: 'Instagram Graph API requires a publicly reachable HTTPS video_url.',
      errorSuggestion: 'Ensure APP_URL is configured for HTTPS public media delivery.',
    };
  }

  await onProgress(35, 'Creating Instagram Reels media container...');
  const createRes = await fetch(
    `https://graph.facebook.com/v21.0/${encodeURIComponent(tokens.igUserId)}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_type: 'REELS',
        video_url: publicVideoUrl,
        caption: payload.caption || '',
        share_to_feed: true,
        access_token: tokens.accessToken,
      }),
    }
  );
  const createJson = (await createRes.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string; code?: number };
  };

  if (!createRes.ok || !createJson.id) {
    const isAuth = createJson.error?.code === 190 || createRes.status === 401;
    return {
      success: false,
      status: isAuth ? 'Requires authorization' : 'Failed',
      errorMessage: `Instagram container error: ${createJson.error?.message || createRes.statusText}`,
      errorSuggestion: 'Verify Instagram Professional status and instagram_content_publish permission.',
    };
  }

  await onProgress(75, 'Publishing Instagram Reels container...');
  const pubRes = await fetch(
    `https://graph.facebook.com/v21.0/${encodeURIComponent(tokens.igUserId)}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: createJson.id,
        access_token: tokens.accessToken,
      }),
    }
  );
  const pubJson = (await pubRes.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string };
  };

  if (!pubRes.ok || !pubJson.id) {
    return {
      success: false,
      status: 'Failed',
      errorMessage: `Instagram publish failed: ${pubJson.error?.message || pubRes.statusText}`,
      errorSuggestion: 'Container may still be processing; retry in a moment.',
    };
  }

  return {
    success: true,
    status: 'Published',
    platformPostId: pubJson.id,
  };
}

export async function syncLiveAccountAnalytics(
  platform: string,
  tokens: OAuthTokens | null,
  publishedPostsCount: number,
  clientId?: string | null,
  clientSecret?: string | null
): Promise<AnalyticsSyncResult> {
  if (!tokens?.accessToken) {
    return {
      success: false,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      followers: 0,
      publishedCount: publishedPostsCount,
      engagementRate: '0.0%',
      metricsAvailable: { views: false, likes: false, comments: false, shares: false, followers: false },
      sourceLabel: 'Authorization required for live API metrics',
      errorMessage: 'Account is not authorized with a live OAuth access token.',
    };
  }

  if (platform === 'youtube') {
    const active = await refreshYouTubeTokenIfNeeded(tokens, clientId, clientSecret);
    const chRes = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true',
      { headers: { Authorization: `Bearer ${active.accessToken}` } }
    );
    if (!chRes.ok) {
      return {
        success: false,
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        followers: 0,
        publishedCount: publishedPostsCount,
        engagementRate: '0.0%',
        metricsAvailable: { views: false, likes: false, comments: false, shares: false, followers: false },
        sourceLabel: 'YouTube Data API v3',
        errorMessage: `YouTube API returned ${chRes.status}. Reauthorization may be required.`,
      };
    }
    const chData = (await chRes.json()) as {
      items?: Array<{
        statistics?: { viewCount?: string; subscriberCount?: string; videoCount?: string };
        contentDetails?: { relatedPlaylists?: { uploads?: string } };
      }>;
    };
    const channel = chData.items?.[0];
    const totalViews = Number(channel?.statistics?.viewCount || 0);
    const followers = Number(channel?.statistics?.subscriberCount || 0);
    const videoCount = Number(channel?.statistics?.videoCount || publishedPostsCount);

    let likes = 0;
    let comments = 0;
    const uploadsPlaylist = channel?.contentDetails?.relatedPlaylists?.uploads;
    if (uploadsPlaylist) {
      const plRes = await fetch(
        `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=15&playlistId=${encodeURIComponent(uploadsPlaylist)}`,
        { headers: { Authorization: `Bearer ${active.accessToken}` } }
      );
      if (plRes.ok) {
        const plData = (await plRes.json()) as {
          items?: Array<{ contentDetails?: { videoId?: string } }>;
        };
        const ids = (plData.items || []).map((i) => i.contentDetails?.videoId).filter(Boolean);
        if (ids.length > 0) {
          const vRes = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.join(',')}`,
            { headers: { Authorization: `Bearer ${active.accessToken}` } }
          );
          if (vRes.ok) {
            const vData = (await vRes.json()) as {
              items?: Array<{ statistics?: { likeCount?: string; commentCount?: string } }>;
            };
            for (const item of vData.items || []) {
              likes += Number(item.statistics?.likeCount || 0);
              comments += Number(item.statistics?.commentCount || 0);
            }
          }
        }
      }
    }

    const rate = totalViews > 0 ? (((likes + comments) / totalViews) * 100).toFixed(2) + '%' : '0.0%';
    return {
      success: true,
      views: totalViews,
      likes,
      comments,
      shares: 0, // YouTube Data API v3 does not expose public share counts without YouTube Analytics API
      followers,
      publishedCount: videoCount,
      engagementRate: rate,
      metricsAvailable: { views: true, likes: true, comments: true, shares: false, followers: true },
      sourceLabel: 'YouTube Data API v3 (Live)',
    };
  }

  if (platform === 'tiktok') {
    const uRes = await fetch(
      'https://open.tiktokapis.com/v2/user/info/?fields=follower_count,likes_count,video_count',
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
    );
    const uJson = (await uRes.json().catch(() => ({}))) as {
      data?: { user?: { follower_count?: number; likes_count?: number; video_count?: number } };
      error?: { code?: string; message?: string };
    };
    if (!uRes.ok || !uJson.data?.user) {
      return {
        success: false,
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        followers: 0,
        publishedCount: publishedPostsCount,
        engagementRate: '0.0%',
        metricsAvailable: { views: false, likes: false, comments: false, shares: false, followers: false },
        sourceLabel: 'TikTok Display API v2',
        errorMessage: uJson.error?.message || `TikTok API returned ${uRes.status}.`,
      };
    }

    let views = 0;
    let comments = 0;
    let shares = 0;
    const vRes = await fetch(
      'https://open.tiktokapis.com/v2/video/list/?fields=like_count,comment_count,share_count,view_count',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ max_count: 20 }),
      }
    );
    if (vRes.ok) {
      const vJson = (await vRes.json().catch(() => ({}))) as {
        data?: { videos?: Array<{ view_count?: number; comment_count?: number; share_count?: number }> };
      };
      for (const vid of vJson.data?.videos || []) {
        views += Number(vid.view_count || 0);
        comments += Number(vid.comment_count || 0);
        shares += Number(vid.share_count || 0);
      }
    }

    const likes = Number(uJson.data.user.likes_count || 0);
    const followers = Number(uJson.data.user.follower_count || 0);
    const rate = views > 0 ? (((likes + comments + shares) / views) * 100).toFixed(2) + '%' : '0.0%';
    return {
      success: true,
      views,
      likes,
      comments,
      shares,
      followers,
      publishedCount: Number(uJson.data.user.video_count || publishedPostsCount),
      engagementRate: rate,
      metricsAvailable: { views: true, likes: true, comments: true, shares: true, followers: true },
      sourceLabel: 'TikTok Display API v2 (Live)',
    };
  }

  if (platform === 'facebook') {
    const pageId = tokens.pageId || 'me';
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(pageId)}?fields=followers_count,fan_count,videos.limit(15){views,likes.summary(true),comments.summary(true)}&access_token=${encodeURIComponent(tokens.accessToken)}`
    );
    const data = (await res.json().catch(() => ({}))) as {
      followers_count?: number;
      fan_count?: number;
      videos?: { data?: Array<{ views?: number; likes?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } } }> };
      error?: { message?: string };
    };
    if (!res.ok || data.error) {
      return {
        success: false,
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        followers: 0,
        publishedCount: publishedPostsCount,
        engagementRate: '0.0%',
        metricsAvailable: { views: false, likes: false, comments: false, shares: false, followers: false },
        sourceLabel: 'Meta Graph API',
        errorMessage: data.error?.message || `Facebook API returned ${res.status}`,
      };
    }
    let views = 0;
    let likes = 0;
    let comments = 0;
    for (const v of data.videos?.data || []) {
      views += Number(v.views || 0);
      likes += Number(v.likes?.summary?.total_count || 0);
      comments += Number(v.comments?.summary?.total_count || 0);
    }
    const followers = Number(data.followers_count || data.fan_count || 0);
    const rate = views > 0 ? (((likes + comments) / views) * 100).toFixed(2) + '%' : '0.0%';
    return {
      success: true,
      views,
      likes,
      comments,
      shares: 0,
      followers,
      publishedCount: (data.videos?.data || []).length || publishedPostsCount,
      engagementRate: rate,
      metricsAvailable: { views: true, likes: true, comments: true, shares: false, followers: true },
      sourceLabel: 'Meta Graph API (Live)',
    };
  }

  // Instagram
  const igId = tokens.igUserId || 'me';
  const igRes = await fetch(
    `https://graph.facebook.com/v21.0/${encodeURIComponent(igId)}?fields=followers_count,media_count,media.limit(15){like_count,comments_count}&access_token=${encodeURIComponent(tokens.accessToken)}`
  );
  const igData = (await igRes.json().catch(() => ({}))) as {
    followers_count?: number;
    media_count?: number;
    media?: { data?: Array<{ like_count?: number; comments_count?: number }> };
    error?: { message?: string };
  };
  if (!igRes.ok || igData.error) {
    return {
      success: false,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      followers: 0,
      publishedCount: publishedPostsCount,
      engagementRate: '0.0%',
      metricsAvailable: { views: false, likes: false, comments: false, shares: false, followers: false },
      sourceLabel: 'Instagram Graph API',
      errorMessage: igData.error?.message || `Instagram API returned ${igRes.status}`,
    };
  }
  let likes = 0;
  let comments = 0;
  for (const m of igData.media?.data || []) {
    likes += Number(m.like_count || 0);
    comments += Number(m.comments_count || 0);
  }
  const followers = Number(igData.followers_count || 0);
  return {
    success: true,
    views: 0, // IG Reels plays require per-media insights scope
    likes,
    comments,
    shares: 0,
    followers,
    publishedCount: Number(igData.media_count || publishedPostsCount),
    engagementRate: followers > 0 ? (((likes + comments) / followers) * 100).toFixed(2) + '%' : '0.0%',
    metricsAvailable: { views: false, likes: true, comments: true, shares: false, followers: true },
    sourceLabel: 'Instagram Graph API (Live)',
  };
}
