import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  username: text('username').notNull().unique(),
  email: text('email'),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  passwordHash: text('password_hash'),
  role: text('role').notNull().default('approved_user'), // super_admin | admin | approved_user | pending_user | suspended_user
  status: text('status').notNull().default('active'), // active | pending | rejected | suspended
  mustChangeSecret: boolean('must_change_secret').notNull().default(false),
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  twoFactorSecretEnc: text('two_factor_secret_enc'),
  accountLimit: integer('account_limit').notNull().default(0), // 0 = unlimited
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const registrationRequests = pgTable('registration_requests', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  status: text('status').notNull().default('pending'), // pending | approved | rejected
  inviteTokenHash: text('invite_token_hash'),
  inviteExpiresAt: timestamp('invite_expires_at'),
  reviewedBy: integer('reviewed_by'),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const userSessions = pgTable('user_sessions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  deviceInfo: text('device_info'),
  ipAddress: text('ip_address'),
  expiresAt: timestamp('expires_at').notNull(),
  revoked: boolean('revoked').notNull().default(false),
  lastActiveAt: timestamp('last_active_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const loginAttempts = pgTable('login_attempts', {
  id: serial('id').primaryKey(),
  username: text('username').notNull(),
  ipAddress: text('ip_address'),
  success: boolean('success').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const socialAccounts = pgTable('social_accounts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  platform: text('platform').notNull(), // youtube | tiktok | facebook | instagram
  accountIdentifier: text('account_identifier').notNull(),
  displayName: text('display_name').notNull(),
  username: text('username').notNull(),
  avatarUrl: text('avatar_url'),
  connectionStatus: text('connection_status').notNull().default('connected'), // connected | expired | needs_reauth | disconnected | error
  permissionStatus: text('permission_status').notNull().default('granted'),
  reauthRequired: boolean('reauth_required').notNull().default(false),
  encryptedTokensJson: text('encrypted_tokens_json'),
  metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>().default({}),
  lastSyncedAt: timestamp('last_synced_at').defaultNow(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const googleDriveAccounts = pgTable('google_drive_accounts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  storageLimitBytes: bigint('storage_limit_bytes', { mode: 'number' }).notNull().default(16106127360),
  storageUsageBytes: bigint('storage_usage_bytes', { mode: 'number' }).notNull().default(0),
  storageUsageInDriveBytes: bigint('storage_usage_in_drive_bytes', { mode: 'number' }).notNull().default(0),
  status: text('status').notNull().default('connected'),
  lastSyncedAt: timestamp('last_synced_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const accountGroups = pgTable('account_groups', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const accountGroupMembers = pgTable('account_group_members', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .references(() => accountGroups.id, { onDelete: 'cascade' })
    .notNull(),
  socialAccountId: integer('social_account_id')
    .references(() => socialAccounts.id, { onDelete: 'cascade' })
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const accountSelectionPresets = pgTable('account_selection_presets', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  name: text('name').notNull(),
  accountIdsJson: jsonb('account_ids_json').$type<number[]>().notNull().default([]),
  isLastUsed: boolean('is_last_used').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const mediaFiles = pgTable('media_files', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull(),
  originalFilename: text('original_filename').notNull(),
  storageProvider: text('storage_provider').notNull().default('cloud_server'), // cloud_server | google_drive
  localPath: text('local_path'),
  driveFileId: text('drive_file_id'),
  driveAccountEmail: text('drive_account_email'),
  driveWebViewLink: text('drive_web_view_link'),
  mimeType: text('mime_type').notNull(),
  fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).notNull().default(0),
  durationSeconds: integer('duration_seconds').notNull().default(0),
  resolution: text('resolution'),
  aspectRatio: text('aspect_ratio'),
  codec: text('codec'),
  thumbnailUrl: text('thumbnail_url'),
  altThumbnailUrl: text('alt_thumbnail_url'),
  coverImageUrl: text('cover_image_url'),
  status: text('status').notNull().default('uploaded'), // uploaded | draft | published | failed | archived
  checksumSha256: text('checksum_sha256'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const videoMetadata = pgTable('video_metadata', {
  id: serial('id').primaryKey(),
  mediaFileId: integer('media_file_id')
    .references(() => mediaFiles.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').default(''),
  description: text('description').default(''),
  mainCaption: text('main_caption').default(''),
  hashtags: text('hashtags').default(''),
  keywords: text('keywords').default(''),
  tags: text('tags').default(''),
  category: text('category').default(''),
  language: text('language').default('en'),
  location: text('location').default(''),
  altText: text('alt_text').default(''),
  contentWarnings: text('content_warnings').default(''),
  customNotes: text('custom_notes').default(''),
  privacy: text('privacy').default('public'),
  visibility: text('visibility').default('public'),
  allowComments: boolean('allow_comments').notNull().default(true),
  allowEmbedding: boolean('allow_embedding').notNull().default(true),
  audienceSetting: text('audience_setting').default('general'),
  ageRestriction: boolean('age_restriction').notNull().default(false),
  madeForKids: boolean('made_for_kids').notNull().default(false),
  contentDisclosure: text('content_disclosure').default('none'),
  brandedContent: boolean('branded_content').notNull().default(false),
  copyrightDeclaration: boolean('copyright_declaration').notNull().default(true),
  platformOverridesJson: jsonb('platform_overrides_json').$type<Record<string, Record<string, unknown>>>().default({}),
  aiMappingEnabled: boolean('ai_mapping_enabled').notNull().default(true),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const uploadBatches = pgTable('upload_batches', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  name: text('name').notNull(),
  totalVideos: integer('total_videos').notNull().default(1),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const publishingJobs = pgTable('publishing_jobs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  batchId: integer('batch_id').references(() => uploadBatches.id, { onDelete: 'set null' }),
  mediaFileId: integer('media_file_id')
    .references(() => mediaFiles.id, { onDelete: 'cascade' })
    .notNull(),
  socialAccountId: integer('social_account_id')
    .references(() => socialAccounts.id, { onDelete: 'cascade' })
    .notNull(),
  platform: text('platform').notNull(),
  status: text('status').notNull().default('Waiting'), // Waiting | Validating | Uploading | Processing | Publishing | Published | Failed | Requires authorization | Requires manual action | Cancelled
  progress: integer('progress').notNull().default(0),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  mappedPayloadJson: jsonb('mapped_payload_json').$type<Record<string, unknown>>().default({}),
  platformPostId: text('platform_post_id'),
  platformPostUrl: text('platform_post_url'),
  errorMessage: text('error_message'),
  errorSuggestion: text('error_suggestion'),
  scheduledFor: timestamp('scheduled_for'),
  timezone: text('timezone').default('UTC'),
  queueOrder: integer('queue_order').notNull().default(0),
  retryCount: integer('retry_count').notNull().default(0),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const publishingJobLogs = pgTable('publishing_job_logs', {
  id: serial('id').primaryKey(),
  jobId: integer('job_id')
    .references(() => publishingJobs.id, { onDelete: 'cascade' })
    .notNull(),
  level: text('level').notNull().default('info'),
  message: text('message').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const accountAnalyticsSnapshots = pgTable('account_analytics_snapshots', {
  id: serial('id').primaryKey(),
  socialAccountId: integer('social_account_id')
    .references(() => socialAccounts.id, { onDelete: 'cascade' })
    .notNull(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  views: bigint('views', { mode: 'number' }).notNull().default(0),
  likes: bigint('likes', { mode: 'number' }).notNull().default(0),
  comments: bigint('comments', { mode: 'number' }).notNull().default(0),
  shares: bigint('shares', { mode: 'number' }).notNull().default(0),
  followers: bigint('followers', { mode: 'number' }).notNull().default(0),
  publishedCount: integer('published_count').notNull().default(0),
  engagementRate: text('engagement_rate').default('0.0%'),
  metricsAvailableJson: jsonb('metrics_available_json').$type<Record<string, boolean>>().default({}),
  sourceLabel: text('source_label').notNull().default('Platform API'),
  fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
});

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  type: text('type').notNull().default('info'),
  title: text('title').notNull(),
  message: text('message').notNull(),
  isRead: boolean('is_read').notNull().default(false),
  relatedEntityType: text('related_entity_type'),
  relatedEntityId: integer('related_entity_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const platformIntegrations = pgTable('platform_integrations', {
  id: serial('id').primaryKey(),
  platform: text('platform').notNull().unique(), // youtube | tiktok | facebook | instagram
  clientId: text('client_id'),
  encryptedClientSecret: text('encrypted_client_secret'),
  oauthStatus: text('oauth_status').notNull().default('unconfigured'), // configured | unconfigured
  apiHealth: text('api_health').notNull().default('awaiting_credentials'),
  auditStatus: text('audit_status').notNull().default('standard'),
  quotaSummary: text('quota_summary').default('Unknown'),
  notes: text('notes'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const applicationSettings = pgTable('application_settings', {
  id: serial('id').primaryKey(),
  appName: text('app_name').notNull().default('Social Command Center'),
  registrationEnabled: boolean('registration_enabled').notNull().default(true),
  requireAdminApproval: boolean('require_admin_approval').notNull().default(true),
  maxUploadSizeMb: integer('max_upload_size_mb').notNull().default(500),
  allowedFormats: text('allowed_formats').notNull().default('mp4,mov,webm,mkv'),
  sessionTimeoutMinutes: integer('session_timeout_minutes').notNull().default(1440),
  maintenanceMode: boolean('maintenance_mode').notNull().default(false),
  defaultTimezone: text('default_timezone').notNull().default('UTC'),
  queuePaused: boolean('queue_paused').notNull().default(false),
  aiEnabled: boolean('ai_enabled').notNull().default(true),
  aiModel: text('ai_model').notNull().default('gemini-4-hydrogen'),
  aiThinkingLevel: text('ai_thinking_level').notNull().default('LOW'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  username: text('username'),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  detailsJson: jsonb('details_json').$type<Record<string, unknown>>().default({}),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const backupRecords = pgTable('backup_records', {
  id: serial('id').primaryKey(),
  createdBy: integer('created_by'),
  filename: text('filename').notNull(),
  sizeBytes: integer('size_bytes').notNull().default(0),
  tableCountsJson: jsonb('table_counts_json').$type<Record<string, number>>().default({}),
  snapshotJson: jsonb('snapshot_json').$type<Record<string, unknown>>().default({}),
  status: text('status').notNull().default('completed'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const aiConversations = pgTable('ai_conversations', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull().default('Admin Assistant'),
  messagesJson: jsonb('messages_json').$type<Array<{ role: 'user' | 'assistant'; text: string; ts: string }>>().default([]),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(userSessions),
  socialAccounts: many(socialAccounts),
  googleDriveAccounts: many(googleDriveAccounts),
  mediaFiles: many(mediaFiles),
  publishingJobs: many(publishingJobs),
  notifications: many(notifications),
}));

export const socialAccountsRelations = relations(socialAccounts, ({ one, many }) => ({
  owner: one(users, { fields: [socialAccounts.userId], references: [users.id] }),
  analytics: many(accountAnalyticsSnapshots),
  jobs: many(publishingJobs),
}));

export const mediaFilesRelations = relations(mediaFiles, ({ one, many }) => ({
  owner: one(users, { fields: [mediaFiles.userId], references: [users.id] }),
  metadata: one(videoMetadata),
  jobs: many(publishingJobs),
}));

export const publishingJobsRelations = relations(publishingJobs, ({ one, many }) => ({
  mediaFile: one(mediaFiles, { fields: [publishingJobs.mediaFileId], references: [mediaFiles.id] }),
  socialAccount: one(socialAccounts, { fields: [publishingJobs.socialAccountId], references: [socialAccounts.id] }),
  logs: many(publishingJobLogs),
}));
