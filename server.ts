import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { execFile } from 'child_process';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import dotenv from 'dotenv';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { createServer as createViteServer } from 'vite';

import { db } from './src/db/index.ts';
import {
  accountAnalyticsSnapshots,
  accountGroupMembers,
  accountGroups,
  accountSelectionPresets,
  aiConversations,
  applicationSettings,
  auditLogs,
  backupRecords,
  googleDriveAccounts,
  loginAttempts,
  mediaFiles,
  notifications,
  platformIntegrations,
  publishingJobLogs,
  publishingJobs,
  registrationRequests,
  socialAccounts,
  uploadBatches,
  userSessions,
  users,
  videoMetadata,
} from './src/db/schema.ts';
import { adminAuth } from './src/lib/firebase-admin.ts';
import {
  AuthRequest,
  requireAdmin,
  requireAuth,
  requireSuperAdmin,
  sanitizeUser,
} from './src/middleware/auth.ts';
import { ensureSystemBootstrapped } from './src/server/bootstrap.ts';
import {
  buildTotpUri,
  decryptText,
  encryptText,
  generateRandomToken,
  generateTotpSecret,
  sha256,
  verifyTotpCode,
} from './src/server/crypto.ts';
import {
  generateAiMetadataSuggestions,
  runAdminAssistantChat,
  testGeminiConnection,
} from './src/server/geminiService.ts';
import { CentralizedMetadataInput, mapMetadataForPlatform } from './src/server/metadataEngine.ts';
import {
  buildPlatformAuthUrl,
  getAppUrl,
  parseEncryptedTokens,
  serializeEncryptedTokens,
  syncLiveAccountAnalytics,
} from './src/server/platformAdapters.ts';
import { processSingleJob, startQueueWorker } from './src/server/queueWorker.ts';
import { broadcastToUser, initRealtimeServer } from './src/server/realtime.ts';

dotenv.config();

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GB safety limit; enforced dynamically by settings too
});

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'none' as const,
  path: '/',
};

async function writeAuditLog(
  userId: number | null,
  username: string | null,
  action: string,
  targetType?: string,
  targetId?: string,
  details: Record<string, unknown> = {},
  ip?: string
) {
  try {
    await db.insert(auditLogs).values({
      userId,
      username,
      action,
      targetType,
      targetId,
      detailsJson: details,
      ipAddress: ip,
    });
  } catch {
    // Audit write failures should not crash primary handler
  }
}

async function createSessionForUser(userId: number, req: express.Request, res: express.Response) {
  const [settings] = await db.select().from(applicationSettings).limit(1);
  const timeoutMins = settings?.sessionTimeoutMinutes || 1440;
  const rawToken = generateRandomToken(32);
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + timeoutMins * 60_000);

  await db.insert(userSessions).values({
    userId,
    tokenHash,
    deviceInfo: String(req.headers['user-agent'] || 'Web Browser').slice(0, 180),
    ipAddress: req.ip || 'unknown',
    expiresAt,
  });

  res.cookie('scc_session', rawToken, {
    ...COOKIE_OPTIONS,
    maxAge: timeoutMins * 60_000,
  });
}

async function isRateLimited(username: string, ip: string): Promise<boolean> {
  const windowStart = new Date(Date.now() - 15 * 60_000);
  const attempts = await db
    .select()
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.username, username),
        eq(loginAttempts.success, false),
        gte(loginAttempts.createdAt, windowStart)
      )
    );
  const ipAttempts = await db
    .select()
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.ipAddress, ip),
        eq(loginAttempts.success, false),
        gte(loginAttempts.createdAt, windowStart)
      )
    );
  return attempts.length >= 8 || ipAttempts.length >= 15;
}

// Temporary OAuth state store (short-lived)
const pendingOAuthStates = new Map<
  string,
  { userId: number; platform: 'youtube' | 'tiktok' | 'facebook' | 'instagram'; redirectUri: string; expiresAt: number }
>();

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  initRealtimeServer(server);

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '20mb' }));
  app.use(cookieParser());

  // --- HEALTH CHECK ---
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'social-command-center' });
  });

  // --- AUTHENTICATION & ACCESS CONTROL ---
  app.get('/api/auth/me', async (req: AuthRequest, res) => {
    try {
      await ensureSystemBootstrapped();
      const [settings] = await db.select().from(applicationSettings).limit(1);

      const sessionCookie = req.cookies?.scc_session as string | undefined;
      if (!sessionCookie) {
        return res.json({
          authenticated: false,
          user: null,
          appInfo: {
            appName: settings?.appName || 'Social Command Center',
            registrationEnabled: settings?.registrationEnabled ?? true,
            maintenanceMode: settings?.maintenanceMode ?? false,
          },
        });
      }

      const tokenHash = sha256(sessionCookie);
      const rows = await db
        .select({ session: userSessions, user: users })
        .from(userSessions)
        .innerJoin(users, eq(userSessions.userId, users.id))
        .where(
          and(
            eq(userSessions.tokenHash, tokenHash),
            eq(userSessions.revoked, false),
            gte(userSessions.expiresAt, new Date())
          )
        )
        .limit(1);

      if (rows.length === 0) {
        return res.json({
          authenticated: false,
          user: null,
          appInfo: {
            appName: settings?.appName || 'Social Command Center',
            registrationEnabled: settings?.registrationEnabled ?? true,
            maintenanceMode: settings?.maintenanceMode ?? false,
          },
        });
      }

      const user = rows[0].user;
      if (user.status !== 'active') {
        return res.json({
          authenticated: false,
          user: null,
          appInfo: {
            appName: settings?.appName || 'Social Command Center',
            registrationEnabled: settings?.registrationEnabled ?? true,
            maintenanceMode: settings?.maintenanceMode ?? false,
          },
        });
      }

      return res.json({
        authenticated: true,
        user: sanitizeUser(user),
        appInfo: {
          appName: settings?.appName || 'Social Command Center',
          registrationEnabled: settings?.registrationEnabled ?? true,
          maintenanceMode: settings?.maintenanceMode ?? false,
          aiEnabled: settings?.aiEnabled ?? true,
          aiModel: settings?.aiModel || 'gemini-4-hydrogen',
          aiThinkingLevel: settings?.aiThinkingLevel || 'LOW',
          queuePaused: settings?.queuePaused ?? false,
          defaultTimezone: settings?.defaultTimezone || 'UTC',
          maxUploadSizeMb: settings?.maxUploadSizeMb || 500,
        },
      });
    } catch (err: unknown) {
      console.error('Error in /api/auth/me:', err);
      return res.status(500).json({ error: 'Failed to verify authentication state.' });
    }
  });

  app.post('/api/auth/master-login', async (req, res) => {
    try {
      await ensureSystemBootstrapped();
      const { secret, totpCode } = req.body as { secret?: string; totpCode?: string };
      const ip = req.ip || 'unknown';

      if (await isRateLimited('superadmin', ip)) {
        return res.status(429).json({ error: 'Too many failed master access attempts. Please wait 15 minutes.' });
      }

      if (!secret) {
        return res.status(400).json({ error: 'Master access secret is required.' });
      }

      const [admin] = await db
        .select()
        .from(users)
        .where(eq(users.role, 'super_admin'))
        .limit(1);

      if (!admin || !admin.passwordHash) {
        return res.status(500).json({ error: 'Super Administrator account is not initialized.' });
      }

      const valid = await bcrypt.compare(secret, admin.passwordHash);
      if (!valid) {
        await db.insert(loginAttempts).values({
          username: 'superadmin',
          ipAddress: ip,
          success: false,
          reason: 'Invalid master access secret',
        });
        return res.status(401).json({ error: 'Invalid master access secret.' });
      }

      if (admin.twoFactorEnabled && admin.twoFactorSecretEnc) {
        const totpSecret = decryptText(admin.twoFactorSecretEnc);
        if (!totpCode) {
          return res.status(200).json({ requires2FA: true });
        }
        if (!verifyTotpCode(totpSecret, totpCode)) {
          await db.insert(loginAttempts).values({
            username: 'superadmin',
            ipAddress: ip,
            success: false,
            reason: 'Invalid 2FA code',
          });
          return res.status(401).json({ error: 'Invalid two-factor authentication code.' });
        }
      }

      await db.insert(loginAttempts).values({
        username: 'superadmin',
        ipAddress: ip,
        success: true,
        reason: 'Master access login',
      });
      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, admin.id));
      await createSessionForUser(admin.id, req, res);
      await writeAuditLog(admin.id, admin.username, 'MASTER_LOGIN', 'user', String(admin.id), {}, ip);

      return res.json({ user: sanitizeUser(admin) });
    } catch (err) {
      console.error('Master login error:', err);
      return res.status(500).json({ error: 'Master login failed.' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      await ensureSystemBootstrapped();
      const { username, password, totpCode } = req.body as {
        username?: string;
        password?: string;
        totpCode?: string;
      };
      const cleanUser = (username || '').trim().toLowerCase();
      const ip = req.ip || 'unknown';

      if (!cleanUser || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
      }

      if (await isRateLimited(cleanUser, ip)) {
        return res.status(429).json({ error: 'Too many failed login attempts. Try again later.' });
      }

      const [user] = await db.select().from(users).where(eq(users.username, cleanUser)).limit(1);
      if (!user) {
        await db.insert(loginAttempts).values({
          username: cleanUser,
          ipAddress: ip,
          success: false,
          reason: 'Unknown username',
        });
        return res.status(401).json({ error: 'Invalid username or password.' });
      }

      if (user.status === 'pending' || user.role === 'pending_user') {
        return res.status(403).json({ error: 'Your registration is awaiting administrator approval.' });
      }
      if (user.status === 'suspended' || user.role === 'suspended_user') {
        return res.status(403).json({ error: 'This account has been suspended by an administrator.' });
      }
      if (user.status === 'rejected') {
        return res.status(403).json({ error: 'This registration request was rejected.' });
      }
      if (!user.passwordHash) {
        return res.status(403).json({
          error: 'Password setup not completed. Use your administrator invitation token to set a password.',
        });
      }

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) {
        await db.insert(loginAttempts).values({
          username: cleanUser,
          ipAddress: ip,
          success: false,
          reason: 'Wrong password',
        });
        return res.status(401).json({ error: 'Invalid username or password.' });
      }

      if (user.twoFactorEnabled && user.twoFactorSecretEnc) {
        if (!totpCode) {
          return res.json({ requires2FA: true });
        }
        const secret = decryptText(user.twoFactorSecretEnc);
        if (!verifyTotpCode(secret, totpCode)) {
          return res.status(401).json({ error: 'Invalid 2FA verification code.' });
        }
      }

      await db.insert(loginAttempts).values({
        username: cleanUser,
        ipAddress: ip,
        success: true,
        reason: 'Standard login',
      });
      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await createSessionForUser(user.id, req, res);
      await writeAuditLog(user.id, user.username, 'USER_LOGIN', 'user', String(user.id), {}, ip);

      return res.json({ user: sanitizeUser(user) });
    } catch (err) {
      console.error('Login error:', err);
      return res.status(500).json({ error: 'Login failed.' });
    }
  });

  app.post('/api/auth/google-session', async (req, res) => {
    try {
      await ensureSystemBootstrapped();
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing Firebase ID token.' });
      }

      const decoded = await adminAuth.verifyIdToken(authHeader.split('Bearer ')[1]);
      const email = decoded.email || `${decoded.uid}@google.user`;
      const baseUsername = (email.split('@')[0] || decoded.uid).toLowerCase().replace(/[^a-z0-9_.-]/g, '');

      let [existing] = await db.select().from(users).where(eq(users.uid, decoded.uid)).limit(1);
      if (!existing && decoded.email) {
        [existing] = await db.select().from(users).where(eq(users.email, decoded.email)).limit(1);
      }

      if (!existing) {
        const [settings] = await db.select().from(applicationSettings).limit(1);
        const requireApproval = settings?.requireAdminApproval ?? false;
        const uniqueUsername = `${baseUsername}_${decoded.uid.slice(0, 4)}`.toLowerCase();

        const [created] = await db
          .insert(users)
          .values({
            uid: decoded.uid,
            username: uniqueUsername,
            email,
            displayName: decoded.name || baseUsername,
            avatarUrl: decoded.picture || null,
            role: requireApproval ? 'pending_user' : 'approved_user',
            status: requireApproval ? 'pending' : 'active',
          })
          .returning();
        existing = created;

        if (requireApproval) {
          await db
            .insert(registrationRequests)
            .values({ username: uniqueUsername, status: 'pending' })
            .onConflictDoNothing();
          const admins = await db.select().from(users).where(eq(users.role, 'super_admin'));
          for (const adm of admins) {
            await db.insert(notifications).values({
              userId: adm.id,
              type: 'info',
              title: 'New Google user awaiting approval',
              message: `${uniqueUsername} (${email}) signed in via Google and is awaiting approval.`,
            });
          }
          return res.status(403).json({ error: 'Your registration is awaiting administrator approval.' });
        }
      }

      if (existing.status === 'pending' || existing.role === 'pending_user') {
        return res.status(403).json({ error: 'Your registration is awaiting administrator approval.' });
      }
      if (existing.status !== 'active') {
        return res.status(403).json({ error: 'Your account is suspended or disabled.' });
      }

      await db
        .update(users)
        .set({
          uid: decoded.uid,
          email: decoded.email || existing.email,
          displayName: decoded.name || existing.displayName,
          avatarUrl: decoded.picture || existing.avatarUrl,
          lastLoginAt: new Date(),
        })
        .where(eq(users.id, existing.id));

      await createSessionForUser(existing.id, req, res);
      await writeAuditLog(existing.id, existing.username, 'GOOGLE_LOGIN', 'user', String(existing.id), { email }, req.ip);

      const [refreshed] = await db.select().from(users).where(eq(users.id, existing.id)).limit(1);
      return res.json({ user: sanitizeUser(refreshed) });
    } catch (err) {
      console.error('Google session error:', err);
      return res.status(401).json({ error: 'Failed to verify Google authentication token.' });
    }
  });

  app.post('/api/auth/register', async (req, res) => {
    try {
      await ensureSystemBootstrapped();
      const [settings] = await db.select().from(applicationSettings).limit(1);
      if (settings && !settings.registrationEnabled) {
        return res.status(403).json({ error: 'New registrations are currently disabled by the administrator.' });
      }

      const raw = String((req.body as { username?: string })?.username || '').trim().toLowerCase();
      if (!raw || raw.length < 3 || !/^[a-z0-9_.-]+$/.test(raw)) {
        return res.status(400).json({
          error: 'Username must be at least 3 characters and contain only letters, numbers, dots, underscores, or hyphens.',
        });
      }

      const existingUser = await db.select().from(users).where(eq(users.username, raw)).limit(1);
      const existingReq = await db.select().from(registrationRequests).where(eq(registrationRequests.username, raw)).limit(1);
      if (existingUser.length > 0 || existingReq.length > 0) {
        return res.status(409).json({ error: 'This username is already taken or awaiting review.' });
      }

      await db.insert(registrationRequests).values({
        username: raw,
        status: 'pending',
      });

      await db.insert(users).values({
        uid: `local-${crypto.randomUUID()}`,
        username: raw,
        displayName: raw,
        role: 'pending_user',
        status: 'pending',
      });

      const admins = await db.select().from(users).where(eq(users.role, 'super_admin'));
      for (const adm of admins) {
        const [notif] = await db
          .insert(notifications)
          .values({
            userId: adm.id,
            type: 'info',
            title: 'New registration request',
            message: `Username "${raw}" requested access and is awaiting administrator approval.`,
          })
          .returning();
        if (notif) broadcastToUser(adm.id, 'notification:created', notif);
      }

      await writeAuditLog(null, raw, 'REGISTRATION_SUBMITTED', 'registration_request', raw, {}, req.ip);
      return res.status(201).json({
        message: 'Your registration is awaiting administrator approval.',
      });
    } catch (err) {
      console.error('Register error:', err);
      return res.status(500).json({ error: 'Failed to submit registration request.' });
    }
  });

  app.post('/api/auth/complete-invite', async (req, res) => {
    try {
      await ensureSystemBootstrapped();
      const { username, inviteToken, newPassword } = req.body as {
        username?: string;
        inviteToken?: string;
        newPassword?: string;
      };
      const cleanUser = (username || '').trim().toLowerCase();
      if (!cleanUser || !inviteToken || !newPassword || newPassword.length < 8) {
        return res.status(400).json({ error: 'Username, valid invitation token, and password (8+ chars) are required.' });
      }

      const tokenHash = sha256(inviteToken.trim());
      const [reg] = await db
        .select()
        .from(registrationRequests)
        .where(
          and(
            eq(registrationRequests.username, cleanUser),
            eq(registrationRequests.status, 'approved'),
            eq(registrationRequests.inviteTokenHash, tokenHash)
          )
        )
        .limit(1);

      if (!reg || (reg.inviteExpiresAt && reg.inviteExpiresAt < new Date())) {
        return res.status(400).json({ error: 'Invitation token is invalid or expired.' });
      }

      const passwordHash = await bcrypt.hash(newPassword, 10);
      const [updated] = await db
        .update(users)
        .set({ passwordHash, status: 'active', role: 'approved_user', lastLoginAt: new Date() })
        .where(eq(users.username, cleanUser))
        .returning();

      await db
        .update(registrationRequests)
        .set({ inviteTokenHash: null })
        .where(eq(registrationRequests.id, reg.id));

      await createSessionForUser(updated.id, req, res);
      await writeAuditLog(updated.id, updated.username, 'INVITE_ACTIVATED', 'user', String(updated.id), {}, req.ip);
      return res.json({ user: sanitizeUser(updated) });
    } catch (err) {
      console.error('Complete invite error:', err);
      return res.status(500).json({ error: 'Failed to activate account.' });
    }
  });

  app.post('/api/auth/logout', async (req: AuthRequest, res) => {
    const sessionCookie = req.cookies?.scc_session as string | undefined;
    if (sessionCookie) {
      await db
        .update(userSessions)
        .set({ revoked: true })
        .where(eq(userSessions.tokenHash, sha256(sessionCookie)));
    }
    res.clearCookie('scc_session', COOKIE_OPTIONS);
    return res.json({ ok: true });
  });

  app.post('/api/auth/change-secret', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { currentSecret, newSecret } = req.body as { currentSecret?: string; newSecret?: string };
      if (!newSecret || newSecret.length < 8) {
        return res.status(400).json({ error: 'New secret/password must be at least 8 characters.' });
      }
      const [user] = await db.select().from(users).where(eq(users.id, req.currentUser!.id)).limit(1);
      if (!user) return res.status(404).json({ error: 'User not found.' });

      if (user.passwordHash) {
        if (!currentSecret) {
          return res.status(400).json({ error: 'Current secret/password is required.' });
        }
        const matches = await bcrypt.compare(currentSecret, user.passwordHash);
        if (!matches) {
          return res.status(401).json({ error: 'Current secret/password is incorrect.' });
        }
      }

      const nextHash = await bcrypt.hash(newSecret, 10);
      const [updated] = await db
        .update(users)
        .set({ passwordHash: nextHash, mustChangeSecret: false, updatedAt: new Date() })
        .where(eq(users.id, user.id))
        .returning();

      await writeAuditLog(user.id, user.username, 'SECRET_ROTATED', 'user', String(user.id), {}, req.ip);
      return res.json({ user: sanitizeUser(updated) });
    } catch (err) {
      console.error('Change secret error:', err);
      return res.status(500).json({ error: 'Failed to update password/secret.' });
    }
  });

  app.post('/api/auth/2fa/setup', requireAuth, async (req: AuthRequest, res) => {
    const secret = generateTotpSecret();
    const enc = encryptText(secret);
    await db
      .update(users)
      .set({ twoFactorSecretEnc: enc })
      .where(eq(users.id, req.currentUser!.id));
    const uri = buildTotpUri(secret, req.currentUser!.username);
    return res.json({ secret, otpauthUri: uri });
  });

  app.post('/api/auth/2fa/verify', requireAuth, async (req: AuthRequest, res) => {
    const { code } = req.body as { code?: string };
    const [user] = await db.select().from(users).where(eq(users.id, req.currentUser!.id)).limit(1);
    if (!user?.twoFactorSecretEnc) {
      return res.status(400).json({ error: '2FA setup has not been initiated.' });
    }
    const secret = decryptText(user.twoFactorSecretEnc);
    if (!code || !verifyTotpCode(secret, code)) {
      return res.status(400).json({ error: 'Invalid 6-digit authenticator code.' });
    }
    const [updated] = await db
      .update(users)
      .set({ twoFactorEnabled: true })
      .where(eq(users.id, user.id))
      .returning();
    await writeAuditLog(user.id, user.username, '2FA_ENABLED', 'user', String(user.id), {}, req.ip);
    return res.json({ user: sanitizeUser(updated) });
  });

  app.post('/api/auth/2fa/disable', requireAuth, async (req: AuthRequest, res) => {
    const [updated] = await db
      .update(users)
      .set({ twoFactorEnabled: false, twoFactorSecretEnc: null })
      .where(eq(users.id, req.currentUser!.id))
      .returning();
    await writeAuditLog(req.currentUser!.id, req.currentUser!.username, '2FA_DISABLED', 'user', String(req.currentUser!.id), {}, req.ip);
    return res.json({ user: sanitizeUser(updated) });
  });

  // --- DASHBOARD OVERVIEW ---
  app.get('/api/dashboard', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.currentUser!.id;
      const accounts = await db.select().from(socialAccounts).where(eq(socialAccounts.userId, uid));
      const files = await db.select().from(mediaFiles).where(eq(mediaFiles.userId, uid));
      const jobs = await db
        .select()
        .from(publishingJobs)
        .where(eq(publishingJobs.userId, uid))
        .orderBy(desc(publishingJobs.createdAt));
      const drives = await db.select().from(googleDriveAccounts).where(eq(googleDriveAccounts.userId, uid));
      const [settings] = await db.select().from(applicationSettings).limit(1);

      const byPlatform = {
        youtube: accounts.filter((a) => a.platform === 'youtube').length,
        tiktok: accounts.filter((a) => a.platform === 'tiktok').length,
        facebook: accounts.filter((a) => a.platform === 'facebook').length,
        instagram: accounts.filter((a) => a.platform === 'instagram').length,
      };

      const totalServerBytes = files
        .filter((f) => f.storageProvider === 'cloud_server')
        .reduce((acc, f) => acc + Number(f.fileSizeBytes || 0), 0);

      const pooledDriveLimitBytes = drives.reduce((acc, d) => acc + Number(d.storageLimitBytes || 0), 0);
      const pooledDriveUsedBytes = drives.reduce((acc, d) => acc + Number(d.storageUsageBytes || 0), 0);

      return res.json({
        stats: {
          totalAccounts: accounts.length,
          byPlatform,
          totalVideos: files.length,
          publishedPosts: jobs.filter((j) => j.status === 'Published').length,
          failedPosts: jobs.filter((j) => j.status === 'Failed' || j.status === 'Requires authorization').length,
          scheduledPosts: jobs.filter((j) => j.status === 'Waiting' && j.scheduledFor !== null).length,
          pendingUploads: jobs.filter((j) => ['Waiting', 'Validating', 'Uploading', 'Processing', 'Publishing'].includes(j.status)).length,
          activeJobs: jobs.filter((j) => ['Validating', 'Uploading', 'Processing', 'Publishing'].includes(j.status)).length,
          serverStorageBytes: totalServerBytes,
          googleDriveAccountsCount: drives.length,
          pooledDriveLimitBytes,
          pooledDriveUsedBytes,
          queuePaused: settings?.queuePaused ?? false,
        },
        recentActivity: jobs.slice(0, 8),
        recentFailures: jobs.filter((j) => j.status === 'Failed' || j.status === 'Requires authorization').slice(0, 5),
        latestVideos: files.slice(-6).reverse(),
        accountStatusSummary: accounts.map((a) => ({
          id: a.id,
          platform: a.platform,
          displayName: a.displayName,
          username: a.username,
          connectionStatus: a.connectionStatus,
          reauthRequired: a.reauthRequired,
          lastSyncedAt: a.lastSyncedAt,
        })),
      });
    } catch (err) {
      console.error('Dashboard error:', err);
      return res.status(500).json({ error: 'Failed to load dashboard overview.' });
    }
  });

  // --- NOTIFICATIONS ---
  app.get('/api/notifications', requireAuth, async (req: AuthRequest, res) => {
    const items = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, req.currentUser!.id))
      .orderBy(desc(notifications.createdAt))
      .limit(60);
    return res.json(items);
  });

  app.post('/api/notifications/read-all', requireAuth, async (req: AuthRequest, res) => {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.userId, req.currentUser!.id));
    return res.json({ ok: true });
  });

  app.post('/api/notifications/:id/read', requireAuth, async (req: AuthRequest, res) => {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.id, Number(req.params.id)), eq(notifications.userId, req.currentUser!.id)));
    return res.json({ ok: true });
  });

  // --- SOCIAL ACCOUNTS & GROUPS & PRESETS ---
  app.get('/api/accounts', requireAuth, async (req: AuthRequest, res) => {
    const rows = await db
      .select()
      .from(socialAccounts)
      .where(eq(socialAccounts.userId, req.currentUser!.id))
      .orderBy(desc(socialAccounts.createdAt));

    const integrations = await db.select().from(platformIntegrations);
    const integrationMap = Object.fromEntries(
      integrations.map((i) => [
        i.platform,
        {
          oauthStatus: i.oauthStatus,
          apiHealth: i.apiHealth,
          auditStatus: i.auditStatus,
          quotaSummary: i.quotaSummary,
          notes: i.notes,
        },
      ])
    );

    const safeAccounts = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      platform: r.platform,
      accountIdentifier: r.accountIdentifier,
      displayName: r.displayName,
      username: r.username,
      avatarUrl: r.avatarUrl,
      connectionStatus: r.connectionStatus,
      permissionStatus: r.permissionStatus,
      reauthRequired: r.reauthRequired,
      hasOAuthToken: Boolean(r.encryptedTokensJson),
      metadataJson: r.metadataJson || {},
      lastSyncedAt: r.lastSyncedAt,
      createdAt: r.createdAt,
    }));

    return res.json({ accounts: safeAccounts, platformStatus: integrationMap });
  });

  app.post('/api/accounts', requireAuth, async (req: AuthRequest, res) => {
    try {
      const {
        platform,
        displayName,
        username,
        accountIdentifier,
        accessToken,
        refreshToken,
        pageId,
        igUserId,
        notes,
        savedLoginInfo,
      } = req.body as {
        platform?: string;
        displayName?: string;
        username?: string;
        accountIdentifier?: string;
        accessToken?: string;
        refreshToken?: string;
        pageId?: string;
        igUserId?: string;
        notes?: string;
        savedLoginInfo?: Record<string, string>;
      };

      if (!platform || !['youtube', 'tiktok', 'facebook', 'instagram'].includes(platform)) {
        return res.status(400).json({ error: 'Valid platform (youtube, tiktok, facebook, instagram) is required.' });
      }
      if (!displayName || !username) {
        return res.status(400).json({ error: 'Display name and username/handle are required.' });
      }

      // Enforce per-user account limit if configured
      if (req.currentUser!.accountLimit > 0) {
        const currentCount = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(socialAccounts)
          .where(eq(socialAccounts.userId, req.currentUser!.id));
        if ((currentCount[0]?.count || 0) >= req.currentUser!.accountLimit) {
          return res.status(403).json({ error: `Account limit (${req.currentUser!.accountLimit}) reached.` });
        }
      }

      const hasToken = Boolean(accessToken && accessToken.trim().length > 0);
      const encryptedTokensJson = hasToken
        ? serializeEncryptedTokens({
            accessToken: accessToken!.trim(),
            refreshToken: refreshToken?.trim() || undefined,
            pageId: pageId?.trim() || undefined,
            igUserId: igUserId?.trim() || undefined,
          })
        : null;

      // Never store plaintext passwords unencrypted; encrypt sensitive login vault notes
      const encryptedVault =
        savedLoginInfo && Object.keys(savedLoginInfo).length > 0
          ? encryptText(JSON.stringify(savedLoginInfo))
          : undefined;

      const [created] = await db
        .insert(socialAccounts)
        .values({
          userId: req.currentUser!.id,
          platform,
          accountIdentifier: accountIdentifier?.trim() || `${platform}-${username.trim()}`,
          displayName: displayName.trim(),
          username: username.trim().replace(/^@/, ''),
          connectionStatus: hasToken ? 'connected' : 'needs_reauth',
          permissionStatus: hasToken ? 'granted' : 'awaiting_oauth',
          reauthRequired: !hasToken,
          encryptedTokensJson,
          metadataJson: {
            pageId: pageId?.trim() || null,
            igUserId: igUserId?.trim() || null,
            notes: notes?.trim() || '',
            hasSavedVault: Boolean(encryptedVault),
            encryptedVault: encryptedVault || null,
          },
        })
        .returning();

      await writeAuditLog(
        req.currentUser!.id,
        req.currentUser!.username,
        'ACCOUNT_CONNECTED',
        'social_account',
        String(created.id),
        { platform, username: created.username },
        req.ip
      );

      return res.status(201).json({
        id: created.id,
        platform: created.platform,
        displayName: created.displayName,
        username: created.username,
        accountIdentifier: created.accountIdentifier,
        connectionStatus: created.connectionStatus,
        permissionStatus: created.permissionStatus,
        reauthRequired: created.reauthRequired,
        hasOAuthToken: Boolean(created.encryptedTokensJson),
        metadataJson: created.metadataJson,
      });
    } catch (err) {
      console.error('Create account error:', err);
      return res.status(500).json({ error: 'Failed to save social account.' });
    }
  });

  app.patch('/api/accounts/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const [existing] = await db
        .select()
        .from(socialAccounts)
        .where(and(eq(socialAccounts.id, id), eq(socialAccounts.userId, req.currentUser!.id)))
        .limit(1);
      if (!existing) return res.status(404).json({ error: 'Account not found.' });

      const { displayName, username, accessToken, refreshToken, pageId, igUserId, notes } = req.body as Record<
        string,
        string | undefined
      >;

      let encryptedTokensJson = existing.encryptedTokensJson;
      let connectionStatus = existing.connectionStatus;
      let reauthRequired = existing.reauthRequired;
      let permissionStatus = existing.permissionStatus;

      if (accessToken && accessToken.trim()) {
        const prev = parseEncryptedTokens(existing.encryptedTokensJson);
        encryptedTokensJson = serializeEncryptedTokens({
          accessToken: accessToken.trim(),
          refreshToken: refreshToken?.trim() || prev?.refreshToken,
          pageId: pageId?.trim() || prev?.pageId,
          igUserId: igUserId?.trim() || prev?.igUserId,
        });
        connectionStatus = 'connected';
        reauthRequired = false;
        permissionStatus = 'granted';
      }

      const [updated] = await db
        .update(socialAccounts)
        .set({
          displayName: displayName?.trim() || existing.displayName,
          username: username?.trim().replace(/^@/, '') || existing.username,
          encryptedTokensJson,
          connectionStatus,
          reauthRequired,
          permissionStatus,
          lastSyncedAt: new Date(),
          metadataJson: {
            ...(existing.metadataJson || {}),
            ...(pageId !== undefined ? { pageId: pageId.trim() } : {}),
            ...(igUserId !== undefined ? { igUserId: igUserId.trim() } : {}),
            ...(notes !== undefined ? { notes: notes.trim() } : {}),
          },
        })
        .where(eq(socialAccounts.id, id))
        .returning();

      return res.json({
        id: updated.id,
        platform: updated.platform,
        displayName: updated.displayName,
        username: updated.username,
        connectionStatus: updated.connectionStatus,
        reauthRequired: updated.reauthRequired,
        hasOAuthToken: Boolean(updated.encryptedTokensJson),
        metadataJson: updated.metadataJson,
      });
    } catch (err) {
      console.error('Update account error:', err);
      return res.status(500).json({ error: 'Failed to update account.' });
    }
  });

  app.delete('/api/accounts/:id', requireAuth, async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    await db
      .delete(socialAccounts)
      .where(and(eq(socialAccounts.id, id), eq(socialAccounts.userId, req.currentUser!.id)));
    await writeAuditLog(
      req.currentUser!.id,
      req.currentUser!.username,
      'ACCOUNT_DISCONNECTED',
      'social_account',
      String(id),
      {},
      req.ip
    );
    return res.json({ ok: true });
  });

  // --- THIRD-PARTY OAUTH URL & CALLBACKS ---
  app.get('/api/oauth/:platform/url', requireAuth, async (req: AuthRequest, res) => {
    const platform = req.params.platform as 'youtube' | 'tiktok' | 'facebook' | 'instagram';
    if (!['youtube', 'tiktok', 'facebook', 'instagram'].includes(platform)) {
      return res.status(400).json({ error: 'Unsupported platform' });
    }

    const [integration] = await db
      .select()
      .from(platformIntegrations)
      .where(eq(platformIntegrations.platform, platform))
      .limit(1);

    const clientId =
      integration?.clientId ||
      (platform === 'youtube'
        ? process.env.YOUTUBE_CLIENT_ID
        : platform === 'tiktok'
          ? process.env.TIKTOK_CLIENT_KEY
          : process.env.META_APP_ID);

    const origin = (req.query.origin as string) || getAppUrl();
    const redirectUri = `${origin.replace(/\/$/, '')}/auth/${platform}/callback`;

    if (!clientId) {
      return res.status(400).json({
        error: `${platform.toUpperCase()} OAuth Client ID is not configured yet.`,
        redirectUri,
        needsConfiguration: true,
      });
    }

    const state = generateRandomToken(16);
    pendingOAuthStates.set(state, {
      userId: req.currentUser!.id,
      platform,
      redirectUri,
      expiresAt: Date.now() + 10 * 60_000,
    });

    const url = buildPlatformAuthUrl(platform, clientId, redirectUri, state);
    return res.json({ url, redirectUri });
  });

  app.get(['/auth/:platform/callback', '/auth/:platform/callback/'], async (req, res) => {
    const platform = req.params.platform as 'youtube' | 'tiktok' | 'facebook' | 'instagram';
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };

    if (error || !code || !state) {
      return res.send(`<html><body><script>
        if (window.opener) { window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: ${JSON.stringify(error || 'Missing authorization code')} }, '*'); window.close(); }
      </script><p>Authorization cancelled or failed.</p></body></html>`);
    }

    const st = pendingOAuthStates.get(state);
    pendingOAuthStates.delete(state);
    if (!st || st.expiresAt < Date.now() || st.platform !== platform) {
      return res.status(400).send('OAuth state invalid or expired.');
    }

    try {
      const [integration] = await db
        .select()
        .from(platformIntegrations)
        .where(eq(platformIntegrations.platform, platform))
        .limit(1);

      const clientId =
        integration?.clientId ||
        (platform === 'youtube'
          ? process.env.YOUTUBE_CLIENT_ID
          : platform === 'tiktok'
            ? process.env.TIKTOK_CLIENT_KEY
            : process.env.META_APP_ID) ||
        '';

      let clientSecret =
        (platform === 'youtube'
          ? process.env.YOUTUBE_CLIENT_SECRET
          : platform === 'tiktok'
            ? process.env.TIKTOK_CLIENT_SECRET
            : process.env.META_APP_SECRET) || '';
      if (integration?.encryptedClientSecret) {
        clientSecret = decryptText(integration.encryptedClientSecret);
      }

      if (platform === 'youtube') {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: st.redirectUri,
            grant_type: 'authorization_code',
          }),
        });
        const tok = (await tokenRes.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
        if (!tok.access_token) throw new Error('YouTube OAuth exchange failed');

        const chRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
          headers: { Authorization: `Bearer ${tok.access_token}` },
        });
        const chData = (await chRes.json()) as {
          items?: Array<{ id?: string; snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } } }>;
        };
        const ch = chData.items?.[0];

        await db.insert(socialAccounts).values({
          userId: st.userId,
          platform: 'youtube',
          accountIdentifier: ch?.id || `yt-${Date.now()}`,
          displayName: ch?.snippet?.title || 'YouTube Channel',
          username: (ch?.snippet?.customUrl || ch?.snippet?.title || 'youtube_channel').replace(/^@/, ''),
          avatarUrl: ch?.snippet?.thumbnails?.default?.url || null,
          connectionStatus: 'connected',
          permissionStatus: 'granted',
          reauthRequired: false,
          encryptedTokensJson: serializeEncryptedTokens({
            accessToken: tok.access_token,
            refreshToken: tok.refresh_token,
            expiresAt: Date.now() + (tok.expires_in || 3600) * 1000,
          }),
        });
      } else if (platform === 'tiktok') {
        const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_key: clientId,
            client_secret: clientSecret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: st.redirectUri,
          }),
        });
        const tok = (await tokenRes.json()) as { access_token?: string; refresh_token?: string; open_id?: string; expires_in?: number };
        if (!tok.access_token) throw new Error('TikTok OAuth exchange failed');

        const uRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url,username', {
          headers: { Authorization: `Bearer ${tok.access_token}` },
        });
        const uData = (await uRes.json()) as {
          data?: { user?: { open_id?: string; display_name?: string; avatar_url?: string; username?: string } };
        };
        const u = uData.data?.user;

        await db.insert(socialAccounts).values({
          userId: st.userId,
          platform: 'tiktok',
          accountIdentifier: u?.open_id || tok.open_id || `tt-${Date.now()}`,
          displayName: u?.display_name || 'TikTok Creator',
          username: u?.username || 'tiktok_creator',
          avatarUrl: u?.avatar_url || null,
          connectionStatus: 'connected',
          permissionStatus: 'granted',
          reauthRequired: false,
          encryptedTokensJson: serializeEncryptedTokens({
            accessToken: tok.access_token,
            refreshToken: tok.refresh_token,
            openId: tok.open_id,
            expiresAt: Date.now() + (tok.expires_in || 86400) * 1000,
          }),
        });
      } else {
        // Meta Facebook / Instagram
        const tokUrl = new URL('https://graph.facebook.com/v21.0/oauth/access_token');
        tokUrl.searchParams.set('client_id', clientId);
        tokUrl.searchParams.set('client_secret', clientSecret);
        tokUrl.searchParams.set('redirect_uri', st.redirectUri);
        tokUrl.searchParams.set('code', code);

        const tokRes = await fetch(tokUrl.toString());
        const tok = (await tokRes.json()) as { access_token?: string };
        if (!tok.access_token) throw new Error('Meta OAuth token exchange failed');

        const pagesRes = await fetch(
          `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,profile_picture_url}&access_token=${encodeURIComponent(tok.access_token)}`
        );
        const pagesData = (await pagesRes.json()) as {
          data?: Array<{
            id: string;
            name: string;
            access_token: string;
            instagram_business_account?: { id: string; username?: string; profile_picture_url?: string };
          }>;
        };

        for (const page of pagesData.data || []) {
          if (platform === 'facebook') {
            await db.insert(socialAccounts).values({
              userId: st.userId,
              platform: 'facebook',
              accountIdentifier: page.id,
              displayName: page.name,
              username: page.name.toLowerCase().replace(/\s+/g, '_'),
              connectionStatus: 'connected',
              permissionStatus: 'granted',
              reauthRequired: false,
              encryptedTokensJson: serializeEncryptedTokens({
                accessToken: page.access_token,
                pageId: page.id,
              }),
            });
          } else if (platform === 'instagram' && page.instagram_business_account) {
            const ig = page.instagram_business_account;
            await db.insert(socialAccounts).values({
              userId: st.userId,
              platform: 'instagram',
              accountIdentifier: ig.id,
              displayName: ig.username || page.name,
              username: ig.username || page.name.toLowerCase().replace(/\s+/g, '_'),
              avatarUrl: ig.profile_picture_url || null,
              connectionStatus: 'connected',
              permissionStatus: 'granted',
              reauthRequired: false,
              encryptedTokensJson: serializeEncryptedTokens({
                accessToken: page.access_token,
                pageId: page.id,
                igUserId: ig.id,
              }),
            });
          }
        }
      }

      return res.send(`<html><body><script>
        if (window.opener) { window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', platform: ${JSON.stringify(platform)} }, '*'); window.close(); }
        else { window.location.href = '/'; }
      </script><p>Account connected successfully. Closing window...</p></body></html>`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'OAuth callback error';
      return res.send(`<html><body><script>
        if (window.opener) { window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: ${JSON.stringify(msg)} }, '*'); window.close(); }
      </script><p>${msg}</p></body></html>`);
    }
  });

  // --- ACCOUNT GROUPS & SELECTION PRESETS ---
  app.get('/api/groups', requireAuth, async (req: AuthRequest, res) => {
    const groups = await db.select().from(accountGroups).where(eq(accountGroups.userId, req.currentUser!.id));
    const members = await db.select().from(accountGroupMembers);
    return res.json(
      groups.map((g) => ({
        ...g,
        accountIds: members.filter((m) => m.groupId === g.id).map((m) => m.socialAccountId),
      }))
    );
  });

  app.post('/api/groups', requireAuth, async (req: AuthRequest, res) => {
    const { name, description, accountIds } = req.body as {
      name?: string;
      description?: string;
      accountIds?: number[];
    };
    if (!name?.trim()) return res.status(400).json({ error: 'Group name is required.' });
    const [group] = await db
      .insert(accountGroups)
      .values({ userId: req.currentUser!.id, name: name.trim(), description: description?.trim() || '' })
      .returning();

    if (Array.isArray(accountIds) && accountIds.length > 0) {
      for (const accId of accountIds) {
        await db.insert(accountGroupMembers).values({ groupId: group.id, socialAccountId: accId });
      }
    }
    return res.status(201).json({ ...group, accountIds: accountIds || [] });
  });

  app.delete('/api/groups/:id', requireAuth, async (req: AuthRequest, res) => {
    await db
      .delete(accountGroups)
      .where(and(eq(accountGroups.id, Number(req.params.id)), eq(accountGroups.userId, req.currentUser!.id)));
    return res.json({ ok: true });
  });

  app.get('/api/presets', requireAuth, async (req: AuthRequest, res) => {
    const presets = await db
      .select()
      .from(accountSelectionPresets)
      .where(eq(accountSelectionPresets.userId, req.currentUser!.id));
    return res.json(presets);
  });

  app.post('/api/presets', requireAuth, async (req: AuthRequest, res) => {
    const { name, accountIds, isLastUsed } = req.body as {
      name?: string;
      accountIds?: number[];
      isLastUsed?: boolean;
    };
    if (!name?.trim() || !Array.isArray(accountIds)) {
      return res.status(400).json({ error: 'Preset name and accountIds array are required.' });
    }
    if (isLastUsed) {
      await db
        .update(accountSelectionPresets)
        .set({ isLastUsed: false })
        .where(eq(accountSelectionPresets.userId, req.currentUser!.id));
    }
    const [preset] = await db
      .insert(accountSelectionPresets)
      .values({
        userId: req.currentUser!.id,
        name: name.trim(),
        accountIdsJson: accountIds,
        isLastUsed: Boolean(isLastUsed),
      })
      .returning();
    return res.status(201).json(preset);
  });

  app.delete('/api/presets/:id', requireAuth, async (req: AuthRequest, res) => {
    await db
      .delete(accountSelectionPresets)
      .where(
        and(eq(accountSelectionPresets.id, Number(req.params.id)), eq(accountSelectionPresets.userId, req.currentUser!.id))
      );
    return res.json({ ok: true });
  });

  // --- GOOGLE MULTI-GMAIL DRIVE STORAGE POOL ---
  app.get('/api/google-storage/accounts', requireAuth, async (req: AuthRequest, res) => {
    const accounts = await db
      .select()
      .from(googleDriveAccounts)
      .where(eq(googleDriveAccounts.userId, req.currentUser!.id))
      .orderBy(desc(googleDriveAccounts.lastSyncedAt));
    return res.json(accounts);
  });

  app.post('/api/google-storage/connect', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { googleAccessToken } = req.body as { googleAccessToken?: string };
      const token = googleAccessToken || req.headers['x-google-access-token']?.toString();
      if (!token) {
        return res.status(400).json({ error: 'Google Drive access token is required.' });
      }

      const driveRes = await fetch(
        'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,photoLink),storageQuota(limit,usage,usageInDrive)',
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!driveRes.ok) {
        const errText = await driveRes.text();
        return res.status(driveRes.status).json({
          error: `Google Drive API rejected the token (${driveRes.status}). Make sure Drive permissions were granted.`,
          details: errText.slice(0, 200),
        });
      }

      const data = (await driveRes.json()) as {
        user?: { displayName?: string; emailAddress?: string; photoLink?: string };
        storageQuota?: { limit?: string; usage?: string; usageInDrive?: string };
      };

      const email = data.user?.emailAddress;
      if (!email) return res.status(400).json({ error: 'Google Drive response did not include an email address.' });

      const limitBytes = Number(data.storageQuota?.limit || 16106127360);
      const usageBytes = Number(data.storageQuota?.usage || 0);
      const usageInDriveBytes = Number(data.storageQuota?.usageInDrive || 0);

      const existing = await db
        .select()
        .from(googleDriveAccounts)
        .where(and(eq(googleDriveAccounts.userId, req.currentUser!.id), eq(googleDriveAccounts.email, email)))
        .limit(1);

      let saved;
      if (existing.length > 0) {
        [saved] = await db
          .update(googleDriveAccounts)
          .set({
            displayName: data.user?.displayName || existing[0].displayName,
            avatarUrl: data.user?.photoLink || existing[0].avatarUrl,
            storageLimitBytes: limitBytes,
            storageUsageBytes: usageBytes,
            storageUsageInDriveBytes: usageInDriveBytes,
            status: 'connected',
            lastSyncedAt: new Date(),
          })
          .where(eq(googleDriveAccounts.id, existing[0].id))
          .returning();
      } else {
        [saved] = await db
          .insert(googleDriveAccounts)
          .values({
            userId: req.currentUser!.id,
            email,
            displayName: data.user?.displayName || email,
            avatarUrl: data.user?.photoLink || null,
            storageLimitBytes: limitBytes,
            storageUsageBytes: usageBytes,
            storageUsageInDriveBytes: usageInDriveBytes,
            status: 'connected',
          })
          .returning();
      }

      await writeAuditLog(
        req.currentUser!.id,
        req.currentUser!.username,
        'GOOGLE_DRIVE_CONNECTED',
        'google_drive_account',
        email,
        { limitBytes, usageBytes },
        req.ip
      );

      return res.json(saved);
    } catch (err) {
      console.error('Google Drive connect error:', err);
      return res.status(500).json({ error: 'Failed to sync Google Drive account.' });
    }
  });

  app.get('/api/google-storage/files', requireAuth, async (req: AuthRequest, res) => {
    const token = req.headers['x-google-access-token']?.toString();
    if (!token) return res.status(401).json({ error: 'Active Google session token required for this Gmail account.' });

    const driveRes = await fetch(
      'https://www.googleapis.com/drive/v3/files?pageSize=40&q=trashed%3Dfalse&fields=files(id,name,mimeType,size,createdTime,webViewLink,thumbnailLink)',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await driveRes.json();
    if (!driveRes.ok) return res.status(driveRes.status).json(data);
    return res.json(data);
  });

  app.post('/api/google-storage/upload-media/:mediaId', requireAuth, async (req: AuthRequest, res) => {
    try {
      const token = req.headers['x-google-access-token']?.toString();
      const { driveEmail } = req.body as { driveEmail?: string };
      if (!token) return res.status(401).json({ error: 'Active Google Drive access token is required for this Gmail.' });

      const mediaId = Number(req.params.mediaId);
      const [media] = await db
        .select()
        .from(mediaFiles)
        .where(and(eq(mediaFiles.id, mediaId), eq(mediaFiles.userId, req.currentUser!.id)))
        .limit(1);

      if (!media || !media.localPath || !fs.existsSync(media.localPath)) {
        return res.status(404).json({ error: 'Local video file not found for transfer.' });
      }

      const metadata = { name: media.originalFilename, mimeType: media.mimeType };
      const boundary = 'scc_drive_boundary_' + Date.now();
      const fileBytes = fs.readFileSync(media.localPath);
      const preamble = Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${media.mimeType}\r\n\r\n`
      );
      const epilogue = Buffer.from(`\r\n--${boundary}--`);
      const bodyBuffer = Buffer.concat([preamble, fileBytes, epilogue]);

      const upRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,webViewLink',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body: bodyBuffer,
        }
      );

      const upData = (await upRes.json()) as { id?: string; webViewLink?: string; error?: { message?: string } };
      if (!upRes.ok || !upData.id) {
        return res.status(upRes.status).json({ error: upData.error?.message || 'Google Drive upload failed.' });
      }

      const [updated] = await db
        .update(mediaFiles)
        .set({
          driveFileId: upData.id,
          driveAccountEmail: driveEmail || null,
          driveWebViewLink: upData.webViewLink || null,
        })
        .where(eq(mediaFiles.id, media.id))
        .returning();

      return res.json(updated);
    } catch (err) {
      console.error('Drive upload error:', err);
      return res.status(500).json({ error: 'Failed to upload video to Google Drive.' });
    }
  });

  app.delete('/api/google-storage/files/:fileId', requireAuth, async (req: AuthRequest, res) => {
    const token = req.headers['x-google-access-token']?.toString();
    if (!token) return res.status(401).json({ error: 'Active Google Drive token required.' });

    const delRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(req.params.fileId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!delRes.ok && delRes.status !== 204) {
      return res.status(delRes.status).json({ error: 'Failed to delete file from Google Drive.' });
    }
    return res.json({ ok: true });
  });

  app.delete('/api/google-storage/accounts/:id', requireAuth, async (req: AuthRequest, res) => {
    await db
      .delete(googleDriveAccounts)
      .where(
        and(eq(googleDriveAccounts.id, Number(req.params.id)), eq(googleDriveAccounts.userId, req.currentUser!.id))
      );
    return res.json({ ok: true });
  });

  // --- MEDIA LIBRARY & UPLOAD CENTER ---
  app.get('/api/media', requireAuth, async (req: AuthRequest, res) => {
    const files = await db
      .select()
      .from(mediaFiles)
      .where(eq(mediaFiles.userId, req.currentUser!.id))
      .orderBy(desc(mediaFiles.createdAt));
    const metas = await db.select().from(videoMetadata).where(eq(videoMetadata.userId, req.currentUser!.id));
    const jobs = await db.select().from(publishingJobs).where(eq(publishingJobs.userId, req.currentUser!.id));

    const metaMap = new Map(metas.map((m) => [m.mediaFileId, m]));
    return res.json(
      files.map((f) => ({
        ...f,
        metadata: metaMap.get(f.id) || null,
        jobs: jobs.filter((j) => j.mediaFileId === f.id),
      }))
    );
  });

  app.post('/api/media/upload', requireAuth, upload.single('video'), async (req: AuthRequest, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No video file uploaded.' });

      const [settings] = await db.select().from(applicationSettings).limit(1);
      const maxBytes = (settings?.maxUploadSizeMb || 500) * 1024 * 1024;
      if (req.file.size > maxBytes) {
        fs.unlinkSync(req.file.path);
        return res.status(413).json({
          error: `File exceeds configured limit of ${settings?.maxUploadSizeMb || 500} MB.`,
        });
      }

      const buf = fs.readFileSync(req.file.path);
      const checksumSha256 = crypto.createHash('sha256').update(buf).digest('hex');

      const {
        title,
        durationSeconds,
        resolution,
        aspectRatio,
        codec,
        thumbnailDataUrl,
      } = req.body as Record<string, string | undefined>;

      const baseTitle = title?.trim() || req.file.originalname.replace(/\.[^.]+$/, '');

      const [media] = await db
        .insert(mediaFiles)
        .values({
          userId: req.currentUser!.id,
          title: baseTitle,
          originalFilename: req.file.originalname,
          storageProvider: 'cloud_server',
          localPath: req.file.path,
          mimeType: req.file.mimetype || 'video/mp4',
          fileSizeBytes: req.file.size,
          durationSeconds: Number(durationSeconds || 0),
          resolution: resolution || 'Unknown',
          aspectRatio: aspectRatio || '16:9',
          codec: codec || path.extname(req.file.originalname).replace('.', '').toUpperCase() || 'MP4',
          thumbnailUrl: thumbnailDataUrl || null,
          status: 'uploaded',
          checksumSha256,
        })
        .returning();

      const [meta] = await db
        .insert(videoMetadata)
        .values({
          mediaFileId: media.id,
          userId: req.currentUser!.id,
          title: baseTitle,
        })
        .returning();

      const [notif] = await db
        .insert(notifications)
        .values({
          userId: req.currentUser!.id,
          type: 'success',
          title: 'Video uploaded',
          message: `"${media.originalFilename}" (${(media.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB) is ready for publishing.`,
          relatedEntityType: 'media',
          relatedEntityId: media.id,
        })
        .returning();
      if (notif) broadcastToUser(req.currentUser!.id, 'notification:created', notif);

      await writeAuditLog(
        req.currentUser!.id,
        req.currentUser!.username,
        'VIDEO_UPLOADED',
        'media',
        String(media.id),
        { filename: media.originalFilename, sizeBytes: media.fileSizeBytes },
        req.ip
      );

      return res.status(201).json({ ...media, metadata: meta, jobs: [] });
    } catch (err) {
      console.error('Upload error:', err);
      return res.status(500).json({ error: 'Failed to process uploaded video.' });
    }
  });

  app.get('/api/media/:id/stream', async (req, res) => {
    const id = Number(req.params.id);
    const [media] = await db.select().from(mediaFiles).where(eq(mediaFiles.id, id)).limit(1);
    if (!media || !media.localPath || !fs.existsSync(media.localPath)) {
      return res.status(404).json({ error: 'Media file not found.' });
    }
    const stat = fs.statSync(media.localPath);
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': media.mimeType || 'video/mp4',
      });
      fs.createReadStream(media.localPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': media.mimeType || 'video/mp4',
      });
      fs.createReadStream(media.localPath).pipe(res);
    }
  });

  app.put('/api/media/:id/metadata', requireAuth, async (req: AuthRequest, res) => {
    try {
      const mediaId = Number(req.params.id);
      const [media] = await db
        .select()
        .from(mediaFiles)
        .where(and(eq(mediaFiles.id, mediaId), eq(mediaFiles.userId, req.currentUser!.id)))
        .limit(1);
      if (!media) return res.status(404).json({ error: 'Video not found.' });

      const body = req.body as Partial<typeof videoMetadata.$inferInsert> & {
        thumbnailUrl?: string;
        altThumbnailUrl?: string;
        coverImageUrl?: string;
        status?: string;
      };

      if (body.title || body.thumbnailUrl || body.altThumbnailUrl || body.coverImageUrl || body.status) {
        await db
          .update(mediaFiles)
          .set({
            ...(body.title ? { title: body.title } : {}),
            ...(body.thumbnailUrl !== undefined ? { thumbnailUrl: body.thumbnailUrl } : {}),
            ...(body.altThumbnailUrl !== undefined ? { altThumbnailUrl: body.altThumbnailUrl } : {}),
            ...(body.coverImageUrl !== undefined ? { coverImageUrl: body.coverImageUrl } : {}),
            ...(body.status ? { status: body.status } : {}),
          })
          .where(eq(mediaFiles.id, mediaId));
      }

      const [updatedMeta] = await db
        .update(videoMetadata)
        .set({
          title: body.title ?? '',
          description: body.description ?? '',
          mainCaption: body.mainCaption ?? '',
          hashtags: body.hashtags ?? '',
          keywords: body.keywords ?? '',
          tags: body.tags ?? '',
          category: body.category ?? '',
          language: body.language ?? 'en',
          location: body.location ?? '',
          altText: body.altText ?? '',
          contentWarnings: body.contentWarnings ?? '',
          customNotes: body.customNotes ?? '',
          privacy: body.privacy ?? 'public',
          visibility: body.visibility ?? 'public',
          allowComments: body.allowComments ?? true,
          allowEmbedding: body.allowEmbedding ?? true,
          audienceSetting: body.audienceSetting ?? 'general',
          ageRestriction: body.ageRestriction ?? false,
          madeForKids: body.madeForKids ?? false,
          contentDisclosure: body.contentDisclosure ?? 'none',
          brandedContent: body.brandedContent ?? false,
          copyrightDeclaration: body.copyrightDeclaration ?? true,
          platformOverridesJson: body.platformOverridesJson ?? {},
          aiMappingEnabled: body.aiMappingEnabled ?? true,
          updatedAt: new Date(),
        })
        .where(eq(videoMetadata.mediaFileId, mediaId))
        .returning();

      return res.json(updatedMeta);
    } catch (err) {
      console.error('Update metadata error:', err);
      return res.status(500).json({ error: 'Failed to save metadata.' });
    }
  });

  app.post('/api/media/:id/duplicate', requireAuth, async (req: AuthRequest, res) => {
    const mediaId = Number(req.params.id);
    const [orig] = await db
      .select()
      .from(mediaFiles)
      .where(and(eq(mediaFiles.id, mediaId), eq(mediaFiles.userId, req.currentUser!.id)))
      .limit(1);
    if (!orig) return res.status(404).json({ error: 'Media not found.' });

    const [origMeta] = await db.select().from(videoMetadata).where(eq(videoMetadata.mediaFileId, mediaId)).limit(1);
    const [dup] = await db
      .insert(mediaFiles)
      .values({
        ...orig,
        id: undefined,
        title: `${orig.title} (Copy)`,
        status: 'draft',
        createdAt: new Date(),
      })
      .returning();

    const [dupMeta] = await db
      .insert(videoMetadata)
      .values({
        ...(origMeta || {}),
        id: undefined,
        mediaFileId: dup.id,
        userId: req.currentUser!.id,
        title: `${origMeta?.title || orig.title} (Copy)`,
        updatedAt: new Date(),
      })
      .returning();

    return res.status(201).json({ ...dup, metadata: dupMeta, jobs: [] });
  });

  app.patch('/api/media/:id/status', requireAuth, async (req: AuthRequest, res) => {
    const { status } = req.body as { status?: string };
    if (!status) return res.status(400).json({ error: 'Status is required.' });
    const [updated] = await db
      .update(mediaFiles)
      .set({ status })
      .where(and(eq(mediaFiles.id, Number(req.params.id)), eq(mediaFiles.userId, req.currentUser!.id)))
      .returning();
    return res.json(updated);
  });

  app.delete('/api/media/:id', requireAuth, async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const [media] = await db
      .select()
      .from(mediaFiles)
      .where(and(eq(mediaFiles.id, id), eq(mediaFiles.userId, req.currentUser!.id)))
      .limit(1);
    if (!media) return res.status(404).json({ error: 'Media not found.' });
    if (media.localPath && fs.existsSync(media.localPath)) {
      try {
        fs.unlinkSync(media.localPath);
      } catch {
        // ignore
      }
    }
    await db.delete(mediaFiles).where(eq(mediaFiles.id, id));
    return res.json({ ok: true });
  });

  // --- METADATA DISTRIBUTION ENGINE & GEMINI AI ---
  app.post('/api/metadata/preview', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { metadata, accountIds, useAi } = req.body as {
        metadata: CentralizedMetadataInput;
        accountIds: number[];
        useAi?: boolean;
      };

      const userAccounts = await db
        .select()
        .from(socialAccounts)
        .where(eq(socialAccounts.userId, req.currentUser!.id));
      const selected = userAccounts.filter((a) => accountIds.includes(a.id));
      const platforms = Array.from(
        new Set(selected.map((s) => s.platform as 'youtube' | 'tiktok' | 'facebook' | 'instagram'))
      );

      const integrations = await db.select().from(platformIntegrations);
      const auditMap = Object.fromEntries(integrations.map((i) => [i.platform, i.auditStatus]));
      const [settings] = await db.select().from(applicationSettings).limit(1);

      let aiSuggestions: {
        suggestedTitle?: string;
        suggestedDescription?: string;
        suggestedHashtags?: string;
        suggestedTags?: string;
        compatibilityNotes?: string[];
      } | null = null;

      let mappingsByPlatform: Record<string, ReturnType<typeof mapMetadataForPlatform>> = {};

      if (useAi && settings?.aiEnabled && platforms.length > 0 && process.env.GEMINI_API_KEY) {
        try {
          const aiResult = await generateAiMetadataSuggestions(
            metadata,
            platforms,
            settings.aiModel || 'gemini-4-hydrogen',
            settings.aiThinkingLevel || 'LOW'
          );
          aiSuggestions = {
            suggestedTitle: aiResult.suggestedTitle,
            suggestedDescription: aiResult.suggestedDescription,
            suggestedHashtags: aiResult.suggestedHashtags,
            suggestedTags: aiResult.suggestedTags,
            compatibilityNotes: aiResult.compatibilityNotes,
          };
          for (const m of aiResult.platformMappings) {
            mappingsByPlatform[m.platform] = m;
          }
        } catch (aiErr: unknown) {
          console.error('Gemini preview fallback to deterministic:', aiErr);
        }
      }

      for (const p of platforms) {
        if (!mappingsByPlatform[p]) {
          mappingsByPlatform[p] = mapMetadataForPlatform(metadata, p, auditMap[p] || 'standard');
        }
      }

      const destinations = selected.map((acc) => ({
        accountId: acc.id,
        displayName: acc.displayName,
        username: acc.username,
        platform: acc.platform,
        hasOAuthToken: Boolean(acc.encryptedTokensJson),
        mapping: mappingsByPlatform[acc.platform],
      }));

      return res.json({ destinations, aiSuggestions, aiUsed: Boolean(aiSuggestions) });
    } catch (err) {
      console.error('Metadata preview error:', err);
      return res.status(500).json({ error: 'Failed to generate metadata preview.' });
    }
  });

  app.post('/api/ai/test', requireAuth, async (_req, res) => {
    try {
      const [settings] = await db.select().from(applicationSettings).limit(1);
      const result = await testGeminiConnection(settings?.aiModel || 'gemini-4-hydrogen');
      return res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gemini API test failed.';
      return res.status(500).json({ ok: false, error: msg });
    }
  });

  app.get('/api/ai/conversations', requireAuth, async (req: AuthRequest, res) => {
    const convs = await db
      .select()
      .from(aiConversations)
      .where(eq(aiConversations.userId, req.currentUser!.id))
      .orderBy(desc(aiConversations.updatedAt));
    return res.json(convs);
  });

  app.post('/api/ai/chat', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { conversationId, message } = req.body as { conversationId?: number; message?: string };
      if (!message?.trim()) return res.status(400).json({ error: 'Message is required.' });

      const [settings] = await db.select().from(applicationSettings).limit(1);
      if (settings && !settings.aiEnabled) {
        return res.status(403).json({ error: 'Gemini AI is currently disabled in system settings.' });
      }

      // Redacted operational context only (zero secrets/tokens!)
      const accountsCount = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(socialAccounts)
        .where(eq(socialAccounts.userId, req.currentUser!.id));
      const failedJobs = await db
        .select({
          id: publishingJobs.id,
          platform: publishingJobs.platform,
          status: publishingJobs.status,
          errorMessage: publishingJobs.errorMessage,
        })
        .from(publishingJobs)
        .where(eq(publishingJobs.userId, req.currentUser!.id))
        .orderBy(desc(publishingJobs.createdAt))
        .limit(10);
      const integrations = await db
        .select({
          platform: platformIntegrations.platform,
          oauthStatus: platformIntegrations.oauthStatus,
          apiHealth: platformIntegrations.apiHealth,
          auditStatus: platformIntegrations.auditStatus,
        })
        .from(platformIntegrations);

      let conv;
      if (conversationId) {
        [conv] = await db
          .select()
          .from(aiConversations)
          .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.userId, req.currentUser!.id)))
          .limit(1);
      }

      const prevMessages = conv?.messagesJson || [];
      const replyText = await runAdminAssistantChat(
        message.trim(),
        {
          role: req.currentUser!.role,
          connectedAccounts: accountsCount[0]?.count || 0,
          recentJobs: failedJobs,
          platformIntegrations: integrations,
          queuePaused: settings?.queuePaused ?? false,
        },
        prevMessages,
        settings?.aiModel || 'gemini-4-hydrogen',
        settings?.aiThinkingLevel || 'LOW'
      );

      const nextMessages = [
        ...prevMessages,
        { role: 'user' as const, text: message.trim(), ts: new Date().toISOString() },
        { role: 'assistant' as const, text: replyText, ts: new Date().toISOString() },
      ];

      if (conv) {
        [conv] = await db
          .update(aiConversations)
          .set({ messagesJson: nextMessages, updatedAt: new Date() })
          .where(eq(aiConversations.id, conv.id))
          .returning();
      } else {
        [conv] = await db
          .insert(aiConversations)
          .values({
            userId: req.currentUser!.id,
            title: message.trim().slice(0, 48),
            messagesJson: nextMessages,
          })
          .returning();
      }

      return res.json(conv);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'AI chat failed.';
      return res.status(500).json({ error: msg });
    }
  });

  // --- ONE-CLICK PUBLISHING, BATCHES, QUEUE & SCHEDULER ---
  app.post('/api/publish', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { items, scheduledFor, timezone, batchName } = req.body as {
        items: Array<{
          mediaFileId: number;
          accountIds: number[];
          metadata: CentralizedMetadataInput;
        }>;
        scheduledFor?: string | null;
        timezone?: string;
        batchName?: string;
      };

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'At least one video item is required for publishing.' });
      }

      const [batch] = await db
        .insert(uploadBatches)
        .values({
          userId: req.currentUser!.id,
          name: batchName || `Publish Batch (${items.length} video${items.length > 1 ? 's' : ''})`,
          totalVideos: items.length,
        })
        .returning();

      const userAccounts = await db
        .select()
        .from(socialAccounts)
        .where(eq(socialAccounts.userId, req.currentUser!.id));
      const integrations = await db.select().from(platformIntegrations);
      const auditMap = Object.fromEntries(integrations.map((i) => [i.platform, i.auditStatus]));

      const createdJobs = [];
      const schedDate = scheduledFor ? new Date(scheduledFor) : null;

      for (const item of items) {
        const [media] = await db
          .select()
          .from(mediaFiles)
          .where(and(eq(mediaFiles.id, item.mediaFileId), eq(mediaFiles.userId, req.currentUser!.id)))
          .limit(1);
        if (!media) continue;

        const targetAccounts = userAccounts.filter((a) => item.accountIds.includes(a.id));
        for (const acc of targetAccounts) {
          const mapped = mapMetadataForPlatform(
            item.metadata,
            acc.platform as 'youtube' | 'tiktok' | 'facebook' | 'instagram',
            auditMap[acc.platform] || 'standard'
          );

          const idempotencyKey = sha256(
            `${req.currentUser!.id}:${media.id}:${acc.id}:${schedDate ? schedDate.toISOString() : Math.floor(Date.now() / 5000)}`
          );

          const existingDup = await db
            .select()
            .from(publishingJobs)
            .where(eq(publishingJobs.idempotencyKey, idempotencyKey))
            .limit(1);
          if (existingDup.length > 0) continue;

          const [job] = await db
            .insert(publishingJobs)
            .values({
              userId: req.currentUser!.id,
              batchId: batch.id,
              mediaFileId: media.id,
              socialAccountId: acc.id,
              platform: acc.platform,
              status: 'Waiting',
              progress: 0,
              idempotencyKey,
              mappedPayloadJson: mapped.payload,
              scheduledFor: schedDate,
              timezone: timezone || 'UTC',
              queueOrder: 0,
            })
            .returning();

          createdJobs.push(job);
          broadcastToUser(req.currentUser!.id, 'job:updated', job);

          if (!schedDate || schedDate <= new Date()) {
            void processSingleJob(job.id);
          }
        }
      }

      await writeAuditLog(
        req.currentUser!.id,
        req.currentUser!.username,
        'PUBLISHING_STARTED',
        'upload_batch',
        String(batch.id),
        { jobCount: createdJobs.length, scheduledFor },
        req.ip
      );

      return res.status(201).json({ batch, jobs: createdJobs });
    } catch (err) {
      console.error('Publish error:', err);
      return res.status(500).json({ error: 'Failed to create publishing jobs.' });
    }
  });

  app.get('/api/jobs', requireAuth, async (req: AuthRequest, res) => {
    const jobs = await db
      .select()
      .from(publishingJobs)
      .where(eq(publishingJobs.userId, req.currentUser!.id))
      .orderBy(desc(publishingJobs.createdAt))
      .limit(150);
    const files = await db.select().from(mediaFiles).where(eq(mediaFiles.userId, req.currentUser!.id));
    const accounts = await db.select().from(socialAccounts).where(eq(socialAccounts.userId, req.currentUser!.id));
    const logs = await db.select().from(publishingJobLogs).orderBy(desc(publishingJobLogs.createdAt)).limit(300);

    const fileMap = new Map(files.map((f) => [f.id, f]));
    const accMap = new Map(accounts.map((a) => [a.id, a]));

    return res.json(
      jobs.map((j) => ({
        ...j,
        videoTitle: fileMap.get(j.mediaFileId)?.title || 'Deleted video',
        videoFilename: fileMap.get(j.mediaFileId)?.originalFilename || '',
        accountDisplayName: accMap.get(j.socialAccountId)?.displayName || 'Unknown account',
        accountUsername: accMap.get(j.socialAccountId)?.username || '',
        logs: logs.filter((l) => l.jobId === j.id),
      }))
    );
  });

  app.post('/api/jobs/:id/retry', requireAuth, async (req: AuthRequest, res) => {
    const jobId = Number(req.params.id);
    const [job] = await db
      .select()
      .from(publishingJobs)
      .where(and(eq(publishingJobs.id, jobId), eq(publishingJobs.userId, req.currentUser!.id)))
      .limit(1);
    if (!job) return res.status(404).json({ error: 'Publishing job not found.' });

    const [updated] = await db
      .update(publishingJobs)
      .set({
        status: 'Waiting',
        progress: 0,
        errorMessage: null,
        errorSuggestion: null,
        retryCount: job.retryCount + 1,
      })
      .where(eq(publishingJobs.id, jobId))
      .returning();

    broadcastToUser(req.currentUser!.id, 'job:updated', updated);
    void processSingleJob(jobId);
    return res.json(updated);
  });

  app.post('/api/jobs/:id/cancel', requireAuth, async (req: AuthRequest, res) => {
    const jobId = Number(req.params.id);
    const [updated] = await db
      .update(publishingJobs)
      .set({ status: 'Cancelled', completedAt: new Date() })
      .where(and(eq(publishingJobs.id, jobId), eq(publishingJobs.userId, req.currentUser!.id)))
      .returning();
    if (updated) broadcastToUser(req.currentUser!.id, 'job:updated', updated);
    return res.json(updated || { ok: true });
  });

  app.post('/api/queue/toggle', requireAuth, async (req: AuthRequest, res) => {
    const [settings] = await db.select().from(applicationSettings).limit(1);
    if (!settings) return res.status(404).json({ error: 'Settings missing.' });
    const [updated] = await db
      .update(applicationSettings)
      .set({ queuePaused: !settings.queuePaused, updatedAt: new Date() })
      .where(eq(applicationSettings.id, settings.id))
      .returning();
    broadcastToUser(req.currentUser!.id, 'queue:state', { queuePaused: updated.queuePaused });
    return res.json({ queuePaused: updated.queuePaused });
  });

  // --- LIVE REAL-TIME ANALYTICS ---
  app.get('/api/analytics', requireAuth, async (req: AuthRequest, res) => {
    const uid = req.currentUser!.id;
    const accounts = await db.select().from(socialAccounts).where(eq(socialAccounts.userId, uid));
    const snapshots = await db
      .select()
      .from(accountAnalyticsSnapshots)
      .where(eq(accountAnalyticsSnapshots.userId, uid))
      .orderBy(desc(accountAnalyticsSnapshots.fetchedAt));
    const jobs = await db.select().from(publishingJobs).where(eq(publishingJobs.userId, uid));

    const latestByAccount = accounts.map((acc) => {
      const accSnaps = snapshots.filter((s) => s.socialAccountId === acc.id);
      const latest = accSnaps[0] || null;
      const publishedCount = jobs.filter((j) => j.socialAccountId === acc.id && j.status === 'Published').length;
      return {
        accountId: acc.id,
        platform: acc.platform,
        displayName: acc.displayName,
        username: acc.username,
        connectionStatus: acc.connectionStatus,
        hasOAuthToken: Boolean(acc.encryptedTokensJson),
        views: latest?.views ?? 0,
        likes: latest?.likes ?? 0,
        comments: latest?.comments ?? 0,
        shares: latest?.shares ?? 0,
        followers: latest?.followers ?? 0,
        publishedCount: latest?.publishedCount ?? publishedCount,
        engagementRate: latest?.engagementRate ?? '0.0%',
        metricsAvailable: latest?.metricsAvailableJson ?? {
          views: false,
          likes: false,
          comments: false,
          shares: false,
          followers: false,
        },
        sourceLabel:
          latest?.sourceLabel ||
          (acc.encryptedTokensJson ? 'Click Sync Live Metrics to query API' : 'OAuth authorization required for live API'),
        fetchedAt: latest?.fetchedAt || null,
      };
    });

    const totals = latestByAccount.reduce(
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

    return res.json({
      totals,
      accounts: latestByAccount,
      history: snapshots.slice(0, 40),
    });
  });

  app.post('/api/analytics/sync', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.currentUser!.id;
      const accounts = await db.select().from(socialAccounts).where(eq(socialAccounts.userId, uid));
      const integrations = await db.select().from(platformIntegrations);
      const jobs = await db.select().from(publishingJobs).where(eq(publishingJobs.userId, uid));

      const results = [];
      for (const acc of accounts) {
        const tokens = parseEncryptedTokens(acc.encryptedTokensJson);
        const integration = integrations.find((i) => i.platform === acc.platform);
        const clientId = integration?.clientId || process.env.YOUTUBE_CLIENT_ID || null;
        let clientSecret: string | null = process.env.YOUTUBE_CLIENT_SECRET || null;
        if (integration?.encryptedClientSecret) {
          try {
            clientSecret = decryptText(integration.encryptedClientSecret);
          } catch {
            clientSecret = null;
          }
        }

        const publishedCount = jobs.filter((j) => j.socialAccountId === acc.id && j.status === 'Published').length;
        const syncRes = await syncLiveAccountAnalytics(acc.platform, tokens, publishedCount, clientId, clientSecret);

        const [saved] = await db
          .insert(accountAnalyticsSnapshots)
          .values({
            socialAccountId: acc.id,
            userId: uid,
            views: syncRes.views,
            likes: syncRes.likes,
            comments: syncRes.comments,
            shares: syncRes.shares,
            followers: syncRes.followers,
            publishedCount: syncRes.publishedCount,
            engagementRate: syncRes.engagementRate,
            metricsAvailableJson: syncRes.metricsAvailable,
            sourceLabel: syncRes.success ? syncRes.sourceLabel : syncRes.errorMessage || syncRes.sourceLabel,
          })
          .returning();

        results.push({ accountId: acc.id, ...syncRes, snapshot: saved });
        broadcastToUser(uid, 'analytics:updated', saved);
      }

      return res.json({ synced: results.length, results });
    } catch (err) {
      console.error('Analytics sync error:', err);
      return res.status(500).json({ error: 'Failed to sync live analytics.' });
    }
  });

  // --- ADMIN CONTROL PANEL (Strictly RBAC Protected) ---
  app.get('/api/admin/overview', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    const isSuper = req.currentUser!.role === 'super_admin';
    const allUsers = await db.select().from(users).orderBy(desc(users.createdAt));
    const pendingRegs = await db
      .select()
      .from(registrationRequests)
      .orderBy(desc(registrationRequests.createdAt));
    const allIntegrations = await db.select().from(platformIntegrations);
    const [settings] = await db.select().from(applicationSettings).limit(1);
    const logs = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(80);
    const attempts = await db.select().from(loginAttempts).orderBy(desc(loginAttempts.createdAt)).limit(60);
    const sessions = await db.select().from(userSessions).orderBy(desc(userSessions.createdAt)).limit(50);
    const backups = await db
      .select({
        id: backupRecords.id,
        filename: backupRecords.filename,
        sizeBytes: backupRecords.sizeBytes,
        tableCountsJson: backupRecords.tableCountsJson,
        status: backupRecords.status,
        createdAt: backupRecords.createdAt,
      })
      .from(backupRecords)
      .orderBy(desc(backupRecords.createdAt));

    const totalAccounts = await db.select({ count: sql<number>`count(*)::int` }).from(socialAccounts);
    const totalJobs = await db.select({ count: sql<number>`count(*)::int` }).from(publishingJobs);
    const successJobs = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(publishingJobs)
      .where(eq(publishingJobs.status, 'Published'));
    const failedJobs = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(publishingJobs)
      .where(eq(publishingJobs.status, 'Failed'));

    const origin = getAppUrl();
    return res.json({
      isSuperAdmin: isSuper,
      overview: {
        totalUsers: allUsers.length,
        approvedUsers: allUsers.filter((u) => u.status === 'active').length,
        pendingUsers: allUsers.filter((u) => u.status === 'pending').length,
        suspendedUsers: allUsers.filter((u) => u.status === 'suspended').length,
        totalConnectedAccounts: totalAccounts[0]?.count || 0,
        totalJobs: totalJobs[0]?.count || 0,
        successfulPosts: successJobs[0]?.count || 0,
        failedPosts: failedJobs[0]?.count || 0,
        geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      },
      users: allUsers.map(sanitizeUser),
      registrations: pendingRegs.map((r) => ({
        id: r.id,
        username: r.username,
        status: r.status,
        createdAt: r.createdAt,
        reviewedAt: r.reviewedAt,
        inviteExpiresAt: r.inviteExpiresAt,
      })),
      platforms: allIntegrations.map((p) => ({
        id: p.id,
        platform: p.platform,
        clientIdConfigured: Boolean(p.clientId),
        clientIdPreview: p.clientId ? `${p.clientId.slice(0, 8)}...` : null,
        clientSecretConfigured: Boolean(p.encryptedClientSecret),
        oauthStatus: p.oauthStatus,
        apiHealth: p.apiHealth,
        auditStatus: p.auditStatus,
        quotaSummary: p.quotaSummary,
        notes: p.notes,
        callbackUrl: `${origin}/auth/${p.platform}/callback`,
      })),
      settings,
      auditLogs: isSuper ? logs : [],
      loginAttempts: isSuper ? attempts : [],
      sessions: isSuper
        ? sessions.map((s) => ({
            id: s.id,
            userId: s.userId,
            deviceInfo: s.deviceInfo,
            ipAddress: s.ipAddress,
            revoked: s.revoked,
            expiresAt: s.expiresAt,
            createdAt: s.createdAt,
          }))
        : [],
      backups: isSuper ? backups : [],
    });
  });

  app.post('/api/admin/registrations/:id/approve', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const [reg] = await db.select().from(registrationRequests).where(eq(registrationRequests.id, id)).limit(1);
    if (!reg) return res.status(404).json({ error: 'Registration request not found.' });

    const inviteToken = generateRandomToken(16);
    const inviteTokenHash = sha256(inviteToken);
    const inviteExpiresAt = new Date(Date.now() + 72 * 3600_000);

    await db
      .update(registrationRequests)
      .set({
        status: 'approved',
        inviteTokenHash,
        inviteExpiresAt,
        reviewedBy: req.currentUser!.id,
        reviewedAt: new Date(),
      })
      .where(eq(registrationRequests.id, id));

    await db
      .update(users)
      .set({ status: 'active', role: 'approved_user', updatedAt: new Date() })
      .where(eq(users.username, reg.username));

    await writeAuditLog(
      req.currentUser!.id,
      req.currentUser!.username,
      'REGISTRATION_APPROVED',
      'registration_request',
      reg.username,
      {},
      req.ip
    );

    return res.json({
      ok: true,
      username: reg.username,
      inviteToken,
      expiresAt: inviteExpiresAt,
    });
  });

  app.post('/api/admin/registrations/:id/reject', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const [reg] = await db.select().from(registrationRequests).where(eq(registrationRequests.id, id)).limit(1);
    if (!reg) return res.status(404).json({ error: 'Registration request not found.' });

    await db
      .update(registrationRequests)
      .set({ status: 'rejected', reviewedBy: req.currentUser!.id, reviewedAt: new Date() })
      .where(eq(registrationRequests.id, id));

    await db.update(users).set({ status: 'rejected' }).where(eq(users.username, reg.username));
    await writeAuditLog(
      req.currentUser!.id,
      req.currentUser!.username,
      'REGISTRATION_REJECTED',
      'registration_request',
      reg.username,
      {},
      req.ip
    );
    return res.json({ ok: true });
  });

  app.patch('/api/admin/users/:id', requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const { role, status, accountLimit } = req.body as {
      role?: string;
      status?: string;
      accountLimit?: number;
    };

    const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.id === req.currentUser!.id && role && role !== 'super_admin') {
      return res.status(400).json({ error: 'Super Administrator cannot demote themselves.' });
    }

    const [updated] = await db
      .update(users)
      .set({
        ...(role ? { role } : {}),
        ...(status ? { status } : {}),
        ...(accountLimit !== undefined ? { accountLimit: Number(accountLimit) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();

    await writeAuditLog(
      req.currentUser!.id,
      req.currentUser!.username,
      'USER_UPDATED',
      'user',
      String(id),
      { role, status, accountLimit },
      req.ip
    );
    return res.json(sanitizeUser(updated));
  });

  app.delete('/api/admin/users/:id', requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    if (id === req.currentUser!.id) {
      return res.status(400).json({ error: 'Cannot delete currently active Super Administrator.' });
    }
    await db.delete(users).where(eq(users.id, id));
    await writeAuditLog(req.currentUser!.id, req.currentUser!.username, 'USER_DELETED', 'user', String(id), {}, req.ip);
    return res.json({ ok: true });
  });

  app.post('/api/admin/sessions/:id/revoke', requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
    await db.update(userSessions).set({ revoked: true }).where(eq(userSessions.id, Number(req.params.id)));
    return res.json({ ok: true });
  });

  app.put('/api/admin/platforms/:platform', requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
    const platform = req.params.platform;
    const { clientId, clientSecret, auditStatus, notes } = req.body as {
      clientId?: string;
      clientSecret?: string;
      auditStatus?: string;
      notes?: string;
    };

    const [existing] = await db
      .select()
      .from(platformIntegrations)
      .where(eq(platformIntegrations.platform, platform))
      .limit(1);
    if (!existing) return res.status(404).json({ error: 'Platform not found.' });

    const nextClientId = clientId !== undefined ? clientId.trim() : existing.clientId;
    const nextEncryptedSecret =
      clientSecret && clientSecret.trim() ? encryptText(clientSecret.trim()) : existing.encryptedClientSecret;
    const configured = Boolean(nextClientId && nextEncryptedSecret);

    const [updated] = await db
      .update(platformIntegrations)
      .set({
        clientId: nextClientId,
        encryptedClientSecret: nextEncryptedSecret,
        oauthStatus: configured ? 'configured' : 'unconfigured',
        apiHealth: configured ? 'ready' : 'awaiting_credentials',
        auditStatus: auditStatus || existing.auditStatus,
        notes: notes !== undefined ? notes : existing.notes,
        updatedAt: new Date(),
      })
      .where(eq(platformIntegrations.platform, platform))
      .returning();

    await writeAuditLog(
      req.currentUser!.id,
      req.currentUser!.username,
      'PLATFORM_CONFIG_UPDATED',
      'platform',
      platform,
      { configured },
      req.ip
    );
    return res.json({
      id: updated.id,
      platform: updated.platform,
      oauthStatus: updated.oauthStatus,
      apiHealth: updated.apiHealth,
      auditStatus: updated.auditStatus,
    });
  });

  app.put('/api/admin/settings', requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
    const [settings] = await db.select().from(applicationSettings).limit(1);
    if (!settings) return res.status(404).json({ error: 'Settings missing.' });

    const body = req.body as Partial<typeof applicationSettings.$inferInsert>;
    const [updated] = await db
      .update(applicationSettings)
      .set({
        ...(body.appName !== undefined ? { appName: body.appName } : {}),
        ...(body.registrationEnabled !== undefined ? { registrationEnabled: body.registrationEnabled } : {}),
        ...(body.requireAdminApproval !== undefined ? { requireAdminApproval: body.requireAdminApproval } : {}),
        ...(body.maxUploadSizeMb !== undefined ? { maxUploadSizeMb: Number(body.maxUploadSizeMb) } : {}),
        ...(body.allowedFormats !== undefined ? { allowedFormats: body.allowedFormats } : {}),
        ...(body.sessionTimeoutMinutes !== undefined ? { sessionTimeoutMinutes: Number(body.sessionTimeoutMinutes) } : {}),
        ...(body.maintenanceMode !== undefined ? { maintenanceMode: body.maintenanceMode } : {}),
        ...(body.defaultTimezone !== undefined ? { defaultTimezone: body.defaultTimezone } : {}),
        ...(body.aiEnabled !== undefined ? { aiEnabled: body.aiEnabled } : {}),
        ...(body.aiModel !== undefined ? { aiModel: body.aiModel } : {}),
        ...(body.aiThinkingLevel !== undefined ? { aiThinkingLevel: body.aiThinkingLevel } : {}),
        updatedAt: new Date(),
      })
      .where(eq(applicationSettings.id, settings.id))
      .returning();

    await writeAuditLog(req.currentUser!.id, req.currentUser!.username, 'SETTINGS_UPDATED', 'settings', '1', {}, req.ip);
    return res.json(updated);
  });

  app.post('/api/admin/backups', requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
    const allUsers = await db.select().from(users);
    const allAccounts = await db.select().from(socialAccounts);
    const allMedia = await db.select().from(mediaFiles);
    const allJobs = await db.select().from(publishingJobs);
    const [settings] = await db.select().from(applicationSettings).limit(1);

    const snapshot = {
      exportedAt: new Date().toISOString(),
      settings,
      users: allUsers.map(sanitizeUser),
      socialAccounts: allAccounts.map((a) => ({ ...a, encryptedTokensJson: '[REDACTED]' })),
      mediaFiles: allMedia,
      publishingJobs: allJobs,
    };

    const jsonStr = JSON.stringify(snapshot);
    const filename = `scc-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const [backup] = await db
      .insert(backupRecords)
      .values({
        createdBy: req.currentUser!.id,
        filename,
        sizeBytes: Buffer.byteLength(jsonStr),
        tableCountsJson: {
          users: allUsers.length,
          socialAccounts: allAccounts.length,
          mediaFiles: allMedia.length,
          publishingJobs: allJobs.length,
        },
        snapshotJson: snapshot,
        status: 'completed',
      })
      .returning();

    await writeAuditLog(req.currentUser!.id, req.currentUser!.username, 'BACKUP_CREATED', 'backup', String(backup.id), {}, req.ip);
    return res.status(201).json({
      id: backup.id,
      filename: backup.filename,
      sizeBytes: backup.sizeBytes,
      tableCountsJson: backup.tableCountsJson,
      status: backup.status,
      createdAt: backup.createdAt,
    });
  });

  app.get('/api/admin/backups/:id/download', requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
    const [backup] = await db
      .select()
      .from(backupRecords)
      .where(eq(backupRecords.id, Number(req.params.id)))
      .limit(1);
    if (!backup) return res.status(404).json({ error: 'Backup not found.' });
    res.setHeader('Content-Disposition', `attachment; filename="${backup.filename}"`);
    return res.json(backup.snapshotJson);
  });

  app.get('/api/admin/export-source', requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
    const tmpZip = path.join('/tmp', `scc-source-${Date.now()}.zip`);
    const pyScript = `
import os, zipfile
root = os.getcwd()
exclude_dirs = {'node_modules', 'dist', 'uploads', '.git', 'build', 'coverage'}
with zipfile.ZipFile(${JSON.stringify(tmpZip)}, 'w', zipfile.ZIP_DEFLATED) as zf:
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in exclude_dirs]
        for fname in filenames:
            if fname.startswith('.env') and fname != '.env.example':
                continue
            if fname.endswith('.log'):
                continue
            full = os.path.join(dirpath, fname)
            rel = os.path.relpath(full, root)
            zf.write(full, rel)
`;
    execFile('python3', ['-c', pyScript], { cwd: process.cwd() }, async (err) => {
      if (err || !fs.existsSync(tmpZip)) {
        console.error('Source zip export error:', err);
        return res.status(500).json({ error: 'Failed to package source code archive.' });
      }
      await writeAuditLog(req.currentUser!.id, req.currentUser!.username, 'SOURCE_EXPORTED', 'system', 'zip', {}, req.ip);
      res.download(tmpZip, 'social-command-center-source.zip', () => {
        try {
          fs.unlinkSync(tmpZip);
        } catch {
          // ignore cleanup error
        }
      });
    });
  });

  // Start background queue & scheduler worker
  startQueueWorker();

  // Vite middleware in dev, static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT || 3000);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Social Command Center running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
