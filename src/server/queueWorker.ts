import { and, asc, eq, lte, or, isNull } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  accountAnalyticsSnapshots,
  applicationSettings,
  mediaFiles,
  notifications,
  platformIntegrations,
  publishingJobLogs,
  publishingJobs,
  socialAccounts,
} from '../db/schema.ts';
import { decryptText } from './crypto.ts';
import {
  getAppUrl,
  parseEncryptedTokens,
  publishToFacebook,
  publishToInstagram,
  publishToTikTok,
  publishToYouTube,
  syncLiveAccountAnalytics,
} from './platformAdapters.ts';
import { broadcastToUser } from './realtime.ts';

let workerInterval: ReturnType<typeof setInterval> | null = null;
const activeJobIds = new Set<number>();

async function logJob(jobId: number, level: 'info' | 'warn' | 'error', message: string) {
  await db.insert(publishingJobLogs).values({ jobId, level, message });
}

async function updateJobStatus(
  jobId: number,
  userId: number,
  patch: Partial<typeof publishingJobs.$inferInsert>
) {
  const [updated] = await db
    .update(publishingJobs)
    .set(patch)
    .where(eq(publishingJobs.id, jobId))
    .returning();
  if (updated) {
    broadcastToUser(userId, 'job:updated', updated);
  }
  return updated;
}

async function notifyUser(
  userId: number,
  type: string,
  title: string,
  message: string,
  relatedEntityType?: string,
  relatedEntityId?: number
) {
  const [notif] = await db
    .insert(notifications)
    .values({ userId, type, title, message, relatedEntityType, relatedEntityId })
    .returning();
  if (notif) {
    broadcastToUser(userId, 'notification:created', notif);
  }
}

export async function processSingleJob(jobId: number) {
  if (activeJobIds.has(jobId)) return;
  activeJobIds.add(jobId);

  try {
    const [job] = await db.select().from(publishingJobs).where(eq(publishingJobs.id, jobId));
    if (!job || job.status === 'Cancelled' || job.status === 'Published') return;

    const [account] = await db
      .select()
      .from(socialAccounts)
      .where(eq(socialAccounts.id, job.socialAccountId));
    const [media] = await db
      .select()
      .from(mediaFiles)
      .where(eq(mediaFiles.id, job.mediaFileId));

    if (!account || !media) {
      await updateJobStatus(job.id, job.userId, {
        status: 'Failed',
        progress: 0,
        errorMessage: 'Destination account or media file no longer exists.',
        errorSuggestion: 'Verify both the media asset and connected social account exist.',
        completedAt: new Date(),
      });
      return;
    }

    await updateJobStatus(job.id, job.userId, {
      status: 'Validating',
      progress: 10,
      startedAt: new Date(),
      errorMessage: null,
      errorSuggestion: null,
    });
    await logJob(job.id, 'info', `Validating ${job.platform} destination @${account.username}`);

    const tokens = parseEncryptedTokens(account.encryptedTokensJson);
    const [integration] = await db
      .select()
      .from(platformIntegrations)
      .where(eq(platformIntegrations.platform, job.platform));

    const clientId =
      integration?.clientId ||
      (job.platform === 'youtube'
        ? process.env.YOUTUBE_CLIENT_ID
        : job.platform === 'tiktok'
          ? process.env.TIKTOK_CLIENT_KEY
          : process.env.META_APP_ID) ||
      null;

    let clientSecret: string | null = null;
    if (integration?.encryptedClientSecret) {
      try {
        clientSecret = decryptText(integration.encryptedClientSecret);
      } catch {
        clientSecret = null;
      }
    } else {
      clientSecret =
        (job.platform === 'youtube'
          ? process.env.YOUTUBE_CLIENT_SECRET
          : job.platform === 'tiktok'
            ? process.env.TIKTOK_CLIENT_SECRET
            : process.env.META_APP_SECRET) || null;
    }

    if (!tokens?.accessToken) {
      const msg = `No active OAuth access token for ${job.platform} account @${account.username}.`;
      const suggestion = `Go to Accounts -> Connect ${job.platform.toUpperCase()} or Reauthorize @${account.username} with valid OAuth credentials.`;
      await logJob(job.id, 'error', msg);
      await db
        .update(socialAccounts)
        .set({ reauthRequired: true, connectionStatus: 'needs_reauth' })
        .where(eq(socialAccounts.id, account.id));
      await updateJobStatus(job.id, job.userId, {
        status: 'Requires authorization',
        progress: 15,
        errorMessage: msg,
        errorSuggestion: suggestion,
        completedAt: new Date(),
      });
      await notifyUser(
        job.userId,
        'error',
        `${job.platform.toUpperCase()} authorization required`,
        `${account.displayName} (@${account.username}) requires OAuth authorization before publishing "${media.title}".`,
        'publishing_job',
        job.id
      );
      return;
    }

    await updateJobStatus(job.id, job.userId, { status: 'Uploading', progress: 25 });
    const payload = (job.mappedPayloadJson || {}) as Record<string, unknown>;
    const progressCb = async (pct: number, stepMsg: string) => {
      await logJob(job.id, 'info', stepMsg);
      const nextStatus = pct >= 85 ? 'Publishing' : pct >= 55 ? 'Processing' : 'Uploading';
      await updateJobStatus(job.id, job.userId, { status: nextStatus, progress: pct });
    };

    let result;
    if (job.platform === 'youtube') {
      result = await publishToYouTube(
        tokens,
        media.localPath,
        media.mimeType,
        payload,
        progressCb,
        clientId,
        clientSecret
      );
    } else if (job.platform === 'tiktok') {
      result = await publishToTikTok(tokens, media.localPath, payload, progressCb);
    } else if (job.platform === 'facebook') {
      result = await publishToFacebook(tokens, media.localPath, payload, progressCb);
    } else {
      const publicUrl = media.localPath
        ? `${getAppUrl()}/api/media/${media.id}/stream`
        : media.driveWebViewLink || null;
      result = await publishToInstagram(tokens, publicUrl, payload, progressCb);
    }

    if (result.success) {
      await logJob(job.id, 'info', `Published to ${job.platform} (${result.platformPostId || 'confirmed'})`);
      await updateJobStatus(job.id, job.userId, {
        status: 'Published',
        progress: 100,
        platformPostId: result.platformPostId || null,
        platformPostUrl: result.platformPostUrl || null,
        completedAt: new Date(),
      });
      await db
        .update(mediaFiles)
        .set({ status: 'published' })
        .where(eq(mediaFiles.id, media.id));
      await notifyUser(
        job.userId,
        'success',
        `Published to ${job.platform}`,
        `"${media.title}" was published to ${account.displayName} (@${account.username}).`,
        'publishing_job',
        job.id
      );

      // Refresh live analytics snapshot for this account
      const snap = await syncLiveAccountAnalytics(job.platform, tokens, 1, clientId, clientSecret);
      if (snap.success) {
        const [savedSnap] = await db
          .insert(accountAnalyticsSnapshots)
          .values({
            socialAccountId: account.id,
            userId: job.userId,
            views: snap.views,
            likes: snap.likes,
            comments: snap.comments,
            shares: snap.shares,
            followers: snap.followers,
            publishedCount: snap.publishedCount,
            engagementRate: snap.engagementRate,
            metricsAvailableJson: snap.metricsAvailable,
            sourceLabel: snap.sourceLabel,
          })
          .returning();
        broadcastToUser(job.userId, 'analytics:updated', savedSnap);
      }
    } else {
      await logJob(job.id, 'error', result.errorMessage || 'Publishing failed');
      if (result.status === 'Requires authorization') {
        await db
          .update(socialAccounts)
          .set({ reauthRequired: true, connectionStatus: 'needs_reauth' })
          .where(eq(socialAccounts.id, account.id));
      }
      await updateJobStatus(job.id, job.userId, {
        status: result.status,
        progress: 0,
        errorMessage: result.errorMessage || 'Publishing failed',
        errorSuggestion: result.errorSuggestion || 'Check account permissions and retry.',
        completedAt: new Date(),
      });
      await notifyUser(
        job.userId,
        'error',
        `Publishing failed on ${job.platform}`,
        `${account.displayName}: ${result.errorMessage || 'Failed to publish.'}`,
        'publishing_job',
        job.id
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected publishing error';
    await logJob(jobId, 'error', message);
    const [job] = await db.select().from(publishingJobs).where(eq(publishingJobs.id, jobId));
    if (job) {
      await updateJobStatus(job.id, job.userId, {
        status: 'Failed',
        progress: 0,
        errorMessage: message,
        errorSuggestion: 'Inspect job logs, verify network/API credentials, and click Retry.',
        completedAt: new Date(),
      });
    }
  } finally {
    activeJobIds.delete(jobId);
  }
}

export function startQueueWorker() {
  if (workerInterval) return;
  workerInterval = setInterval(async () => {
    try {
      const [settings] = await db.select().from(applicationSettings).limit(1);
      if (settings?.queuePaused) return;

      const now = new Date();
      const dueJobs = await db
        .select()
        .from(publishingJobs)
        .where(
          and(
            eq(publishingJobs.status, 'Waiting'),
            or(isNull(publishingJobs.scheduledFor), lte(publishingJobs.scheduledFor, now))
          )
        )
        .orderBy(asc(publishingJobs.queueOrder), asc(publishingJobs.id))
        .limit(4);

      for (const job of dueJobs) {
        if (!activeJobIds.has(job.id)) {
          void processSingleJob(job.id);
        }
      }
    } catch {
      // Pool/DB errors during transient idle are handled safely on next tick
    }
  }, 4000);
}
