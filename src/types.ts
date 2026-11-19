export type PlatformType = 'youtube' | 'tiktok' | 'facebook' | 'instagram';

export interface UserProfile {
  id: number;
  uid: string;
  username: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: 'super_admin' | 'admin' | 'approved_user' | 'pending_user' | 'suspended_user';
  status: 'active' | 'pending' | 'rejected' | 'suspended';
  mustChangeSecret: boolean;
  twoFactorEnabled: boolean;
  accountLimit: number;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AppInfo {
  appName: string;
  registrationEnabled: boolean;
  maintenanceMode: boolean;
  aiEnabled?: boolean;
  aiModel?: string;
  aiThinkingLevel?: string;
  queuePaused?: boolean;
  defaultTimezone?: string;
  maxUploadSizeMb?: number;
}

export interface SocialAccount {
  id: number;
  userId: number;
  platform: PlatformType;
  accountIdentifier: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  connectionStatus: string;
  permissionStatus: string;
  reauthRequired: boolean;
  hasOAuthToken: boolean;
  metadataJson: Record<string, unknown>;
  lastSyncedAt: string | null;
  createdAt: string;
}

export interface GoogleDriveAccount {
  id: number;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  storageLimitBytes: number;
  storageUsageBytes: number;
  storageUsageInDriveBytes: number;
  status: string;
  lastSyncedAt: string;
}

export interface AccountGroup {
  id: number;
  name: string;
  description: string | null;
  accountIds: number[];
}

export interface AccountPreset {
  id: number;
  name: string;
  accountIdsJson: number[];
  isLastUsed: boolean;
}

export interface VideoMetadataFields {
  title: string;
  description: string;
  mainCaption: string;
  hashtags: string;
  keywords: string;
  tags: string;
  category: string;
  language: string;
  location: string;
  altText: string;
  contentWarnings: string;
  customNotes: string;
  privacy: string;
  visibility: string;
  allowComments: boolean;
  allowEmbedding: boolean;
  audienceSetting: string;
  ageRestriction: boolean;
  madeForKids: boolean;
  contentDisclosure: string;
  brandedContent: boolean;
  copyrightDeclaration: boolean;
  platformOverridesJson: Record<string, Record<string, unknown>>;
  aiMappingEnabled: boolean;
}

export interface MediaFileItem {
  id: number;
  title: string;
  originalFilename: string;
  storageProvider: string;
  driveFileId: string | null;
  driveAccountEmail: string | null;
  driveWebViewLink: string | null;
  mimeType: string;
  fileSizeBytes: number;
  durationSeconds: number;
  resolution: string | null;
  aspectRatio: string | null;
  codec: string | null;
  thumbnailUrl: string | null;
  altThumbnailUrl: string | null;
  coverImageUrl: string | null;
  status: string;
  createdAt: string;
  metadata: VideoMetadataFields | null;
  jobs: PublishingJob[];
}

export interface PublishingJob {
  id: number;
  mediaFileId: number;
  socialAccountId: number;
  platform: PlatformType;
  status: string;
  progress: number;
  platformPostId: string | null;
  platformPostUrl: string | null;
  errorMessage: string | null;
  errorSuggestion: string | null;
  scheduledFor: string | null;
  timezone: string | null;
  retryCount: number;
  createdAt: string;
  completedAt: string | null;
  videoTitle?: string;
  videoFilename?: string;
  accountDisplayName?: string;
  accountUsername?: string;
  logs?: Array<{ id: number; level: string; message: string; createdAt: string }>;
}

export interface AccountAnalyticsRow {
  accountId: number;
  platform: PlatformType;
  displayName: string;
  username: string;
  connectionStatus: string;
  hasOAuthToken: boolean;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  followers: number;
  publishedCount: number;
  engagementRate: string;
  metricsAvailable: Record<string, boolean>;
  sourceLabel: string;
  fetchedAt: string | null;
}

export interface NotificationItem {
  id: number;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export const EMPTY_METADATA: VideoMetadataFields = {
  title: '',
  description: '',
  mainCaption: '',
  hashtags: '',
  keywords: '',
  tags: '',
  category: 'Education',
  language: 'en',
  location: '',
  altText: '',
  contentWarnings: '',
  customNotes: '',
  privacy: 'public',
  visibility: 'public',
  allowComments: true,
  allowEmbedding: true,
  audienceSetting: 'general',
  ageRestriction: false,
  madeForKids: false,
  contentDisclosure: 'none',
  brandedContent: false,
  copyrightDeclaration: true,
  platformOverridesJson: {},
  aiMappingEnabled: true,
};
