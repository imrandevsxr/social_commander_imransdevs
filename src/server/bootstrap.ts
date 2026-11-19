import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  applicationSettings,
  platformIntegrations,
  users,
} from '../db/schema.ts';

// Precomputed bcrypt hash for initial master access bootstrap (never stored in plaintext)
const INITIAL_MASTER_ACCESS_HASH = '$2b$10$u4zhxbr93CbnT5gUJ68MWuRcRZp8qNvIUoOFnVSZgK1iGxcpOARNe';

let bootstrapped = false;

export async function ensureSystemBootstrapped() {
  if (bootstrapped) return;
  bootstrapped = true;

  try {
    // 1. Ensure default application settings exist
    const existingSettings = await db.select().from(applicationSettings).limit(1);
    if (existingSettings.length === 0) {
      await db.insert(applicationSettings).values({
        appName: 'Social Command Center',
        registrationEnabled: true,
        requireAdminApproval: true,
        maxUploadSizeMb: 500,
        allowedFormats: 'mp4,mov,webm,mkv',
        sessionTimeoutMinutes: 1440,
        maintenanceMode: false,
        defaultTimezone: 'UTC',
        queuePaused: false,
        aiEnabled: true,
        aiModel: 'gemini-4-hydrogen',
        aiThinkingLevel: 'LOW',
      });
    }

    // 2. Ensure platform integration registry rows exist
    const platforms: Array<{ platform: string; notes: string; auditStatus: string; quotaSummary: string }> = [
      {
        platform: 'youtube',
        notes: 'Requires Google Cloud YouTube Data API v3 OAuth Client ID & Secret with youtube.upload & youtube.readonly scopes.',
        auditStatus: 'standard',
        quotaSummary: '10,000 units/day default',
      },
      {
        platform: 'tiktok',
        notes: 'TikTok Content Posting API v2. Unaudited apps are restricted to SELF_ONLY (private) visibility until TikTok app review passes.',
        auditStatus: 'unaudited',
        quotaSummary: 'Rate-limited by creator token',
      },
      {
        platform: 'facebook',
        notes: 'Meta Graph API v21.0. Requires Facebook Page authorization with pages_manage_posts & publish_video permissions.',
        auditStatus: 'standard',
        quotaSummary: '200 calls/user/hour',
      },
      {
        platform: 'instagram',
        notes: 'Instagram Graph API v21.0. Requires an Instagram Professional (Business/Creator) account linked to a Facebook Page.',
        auditStatus: 'standard',
        quotaSummary: '25 API-published posts / 24h',
      },
    ];

    for (const p of platforms) {
      const existing = await db
        .select()
        .from(platformIntegrations)
        .where(eq(platformIntegrations.platform, p.platform));
      if (existing.length === 0) {
        const hasEnvCreds =
          (p.platform === 'youtube' && Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET)) ||
          (p.platform === 'tiktok' && Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET)) ||
          ((p.platform === 'facebook' || p.platform === 'instagram') &&
            Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET));

        await db.insert(platformIntegrations).values({
          platform: p.platform,
          oauthStatus: hasEnvCreds ? 'configured' : 'unconfigured',
          apiHealth: hasEnvCreds ? 'ready' : 'awaiting_credentials',
          auditStatus: p.auditStatus,
          quotaSummary: p.quotaSummary,
          notes: p.notes,
        });
      }
    }

    // 3. Ensure initial Super Administrator exists (hashed secret only)
    const superAdmins = await db
      .select()
      .from(users)
      .where(eq(users.role, 'super_admin'));

    if (superAdmins.length === 0) {
      const envSecret = process.env.MASTER_ACCESS_SECRET;
      const passwordHash =
        envSecret && envSecret !== 'CHANGE_ME_ON_FIRST_LOGIN'
          ? await bcrypt.hash(envSecret, 10)
          : INITIAL_MASTER_ACCESS_HASH;

      await db
        .insert(users)
        .values({
          uid: 'super-admin-root',
          username: 'superadmin',
          displayName: 'Super Administrator',
          passwordHash,
          role: 'super_admin',
          status: 'active',
          mustChangeSecret: true,
        })
        .onConflictDoNothing();
    }
  } catch (err) {
    bootstrapped = false;
    throw err;
  }
}
