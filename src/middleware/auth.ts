import { NextFunction, Request, Response } from 'express';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { userSessions, users } from '../db/schema.ts';
import { adminAuth } from '../lib/firebase-admin.ts';
import { ensureSystemBootstrapped } from '../server/bootstrap.ts';
import { sha256 } from '../server/crypto.ts';

export interface SafeUser {
  id: number;
  uid: string;
  username: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: string;
  status: string;
  mustChangeSecret: boolean;
  twoFactorEnabled: boolean;
  accountLimit: number;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface AuthRequest extends Request {
  currentUser?: SafeUser;
  sessionId?: number;
}

export function sanitizeUser(u: typeof users.$inferSelect): SafeUser {
  return {
    id: u.id,
    uid: u.uid,
    username: u.username,
    email: u.email,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    role: u.role,
    status: u.status,
    mustChangeSecret: u.mustChangeSecret,
    twoFactorEnabled: u.twoFactorEnabled,
    accountLimit: u.accountLimit,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await ensureSystemBootstrapped();

    const sessionCookie = req.cookies?.scc_session as string | undefined;
    if (sessionCookie) {
      const tokenHash = sha256(sessionCookie);
      const now = new Date();
      const rows = await db
        .select({
          session: userSessions,
          user: users,
        })
        .from(userSessions)
        .innerJoin(users, eq(userSessions.userId, users.id))
        .where(
          and(
            eq(userSessions.tokenHash, tokenHash),
            eq(userSessions.revoked, false),
            gt(userSessions.expiresAt, now)
          )
        )
        .limit(1);

      if (rows.length > 0) {
        const { session, user } = rows[0];
        if (user.status !== 'active' || user.role === 'pending_user' || user.role === 'suspended_user') {
          return res.status(403).json({ error: 'Account is not active or is awaiting administrator approval.' });
        }
        req.currentUser = sanitizeUser(user);
        req.sessionId = session.id;
        return next();
      }
    }

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.split('Bearer ')[1];
      try {
        const decoded = await adminAuth.verifyIdToken(idToken);
        const existing = await db
          .select()
          .from(users)
          .where(eq(users.uid, decoded.uid))
          .limit(1);
        if (existing.length > 0) {
          const user = existing[0];
          if (user.status !== 'active' || user.role === 'pending_user' || user.role === 'suspended_user') {
            return res.status(403).json({ error: 'Account is suspended or awaiting approval.' });
          }
          req.currentUser = sanitizeUser(user);
          return next();
        }
      } catch {
        // Fall through to 401
      }
    }

    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).json({ error: 'Authentication verification failed.' });
  }
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.currentUser) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  if (req.currentUser.role !== 'super_admin' && req.currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator privileges required.' });
  }
  return next();
};

export const requireSuperAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.currentUser) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  if (req.currentUser.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super Administrator authorization required.' });
  }
  return next();
};
