# Social Command Center

Cloud-based multi-platform social media publishing, account credential vault, multi-Gmail Google Drive storage pool, live analytics, and Gemini AI command center built with React, TypeScript, Express, WebSockets, Drizzle ORM, and Cloud SQL (PostgreSQL).

## Architecture Overview

- **Frontend**: React 19 + TypeScript + Tailwind CSS v4 (Dark/Light dual theme)
- **Backend**: Node.js + Express + `ws` WebSocket server on port 3000
- **Database**: Cloud SQL (PostgreSQL) via Drizzle ORM (`src/db/schema.ts`)
- **Authentication & RBAC**:
  - Salted bcrypt Master Access & user credentials with `httpOnly; SameSite=None; Secure` session cookies
  - Google Sign-In via Firebase Authentication
  - Username Registration -> Administrator Approval -> One-time Invite Token password setup
  - Optional RFC 6238 TOTP Two-Factor Authentication
  - Roles: `super_admin`, `admin`, `approved_user`, `pending_user`, `suspended_user`
- **Multi-Gmail Google Drive Storage Pool**:
  - Connect multiple Gmail accounts via Google Sign-In with Drive scopes (`drive.file`, `drive.metadata.readonly`)
  - Aggregate pooled capacity (~15–16 GB per Gmail) and transfer videos directly into any Gmail's Google Drive
- **Universal Upload Center & Intelligent Metadata Distribution**:
  - Multi-video upload with automatic client-side duration, resolution, aspect ratio, and thumbnail extraction
  - 37-field centralized metadata editor + deterministic & Gemini AI (`@google/genai`) platform payload mapping
  - All connected accounts selected by default, with groups, presets, and scheduling
- **Live Analytics**:
  - Real-time WebSocket updates + on-demand live API queries (YouTube Data API v3, TikTok Display API v2, Meta Graph API)

## OAuth Callback URLs

Configure these exact redirect URIs in your Google Cloud, TikTok Developer, and Meta Developer dashboards:

- **Development URLs**:
  - YouTube: `https://ais-dev-3khximbaslwgv3n2lwe5un-226902442015.asia-southeast1.run.app/auth/youtube/callback`
  - TikTok: `https://ais-dev-3khximbaslwgv3n2lwe5un-226902442015.asia-southeast1.run.app/auth/tiktok/callback`
  - Facebook: `https://ais-dev-3khximbaslwgv3n2lwe5un-226902442015.asia-southeast1.run.app/auth/facebook/callback`
  - Instagram: `https://ais-dev-3khximbaslwgv3n2lwe5un-226902442015.asia-southeast1.run.app/auth/instagram/callback`
- **Shared / Deployed URLs**:
  - YouTube: `https://ais-pre-3khximbaslwgv3n2lwe5un-226902442015.asia-southeast1.run.app/auth/youtube/callback`
  - TikTok: `https://ais-pre-3khximbaslwgv3n2lwe5un-226902442015.asia-southeast1.run.app/auth/tiktok/callback`
  - Facebook: `https://ais-pre-3khximbaslwgv3n2lwe5un-226902442015.asia-southeast1.run.app/auth/facebook/callback`
  - Instagram: `https://ais-pre-3khximbaslwgv3n2lwe5un-226902442015.asia-southeast1.run.app/auth/instagram/callback`

## Feature Implementation Checklist

### Fully Implemented
- Cloud SQL PostgreSQL relational schema (21 tables) & Drizzle ORM persistence
- Master Access authentication (hashed server-side), standard login, username registration queue, one-time invite tokens, TOTP 2FA, session revocation, rate limiting, and audit logs
- Google Sign-In & Multi-Gmail Google Drive Storage Pool (real Drive v3 quota inspection, file listing, video backup upload, confirmed delete)
- Multi-Account Management, Encrypted Token/Credential Vault, and Custom Account Groups
- Universal Upload Center (multi-video batch upload, metadata extraction, 37-field centralized editor, default-all account selection, selection presets, scheduling)
- Intelligent Metadata Distribution Engine (deterministic + server-side Gemini AI `@google/genai`)
- Background Publishing Queue & Scheduler with WebSocket real-time progress, error diagnostics, and per-job retries
- Live Analytics dashboard with real API queries & transparent metric availability reporting
- Admin Control Panel, AI Administrator Assistant chat, Notification Center, and JSON Backup Export

### Awaiting External Platform Credentials / App Review (Configurable in Admin Panel -> Platforms)
- `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` (YouTube Data API v3 quota & OAuth consent)
- `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` (TikTok Content Posting API; unaudited apps are restricted to `SELF_ONLY` private posting until TikTok audit passes)
- `META_APP_ID` / `META_APP_SECRET` (Facebook Pages & Instagram Professional Graph API permissions)
