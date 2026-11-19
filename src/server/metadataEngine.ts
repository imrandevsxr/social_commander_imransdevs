export interface CentralizedMetadataInput {
  title?: string;
  description?: string;
  mainCaption?: string;
  hashtags?: string;
  keywords?: string;
  tags?: string;
  category?: string;
  language?: string;
  location?: string;
  altText?: string;
  contentWarnings?: string;
  customNotes?: string;
  privacy?: string;
  visibility?: string;
  allowComments?: boolean;
  allowEmbedding?: boolean;
  audienceSetting?: string;
  ageRestriction?: boolean;
  madeForKids?: boolean;
  contentDisclosure?: string;
  brandedContent?: boolean;
  copyrightDeclaration?: boolean;
  platformOverridesJson?: Record<string, Record<string, unknown>>;
}

export interface PlatformMappingResult {
  platform: 'youtube' | 'tiktok' | 'facebook' | 'instagram';
  payload: Record<string, unknown>;
  mappedFields: string[];
  ignoredFields: string[];
  warnings: string[];
  requiredMissing: string[];
}

const YOUTUBE_CATEGORY_MAP: Record<string, string> = {
  education: '27',
  gaming: '20',
  entertainment: '24',
  technology: '28',
  science: '28',
  music: '10',
  sports: '17',
  news: '25',
  comedy: '23',
  howto: '26',
  travel: '19',
  people: '22',
  business: '22',
};

function cleanHashtags(raw?: string): string {
  if (!raw) return '';
  return raw
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((h) => (h.startsWith('#') ? h : `#${h}`))
    .join(' ');
}

function parseTagsArray(tags?: string, keywords?: string): string[] {
  const combined = [tags || '', keywords || '']
    .join(',')
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  return Array.from(new Set(combined)).slice(0, 30);
}

export function mapMetadataForPlatform(
  input: CentralizedMetadataInput,
  platform: 'youtube' | 'tiktok' | 'facebook' | 'instagram',
  auditStatus = 'standard'
): PlatformMappingResult {
  const overrides = input.platformOverridesJson?.[platform] || {};
  const hashtags = cleanHashtags(input.hashtags);
  const warnings: string[] = [];
  const requiredMissing: string[] = [];

  if (platform === 'youtube') {
    const rawTitle = String(overrides.title || input.title || input.mainCaption || '').trim();
    const title = rawTitle.slice(0, 100);
    if (!title) requiredMissing.push('YouTube Title (required by YouTube Data API)');
    if (rawTitle.length > 100) warnings.push(`Title truncated from ${rawTitle.length} to 100 characters.`);

    const baseDesc = String(overrides.description || input.description || input.mainCaption || '').trim();
    const descWithTags = hashtags && !baseDesc.includes('#') ? `${baseDesc}\n\n${hashtags}`.trim() : baseDesc;
    const description = descWithTags.slice(0, 5000);

    const overrideTags = typeof overrides.tags === 'string' ? overrides.tags : undefined;
    const tagsArray = parseTagsArray(overrideTags ?? input.tags, input.keywords);
    const categoryKey = String(overrides.category || input.category || 'people').toLowerCase().trim();
    const categoryId = YOUTUBE_CATEGORY_MAP[categoryKey] || '22';
    const privacy = String(overrides.privacy || input.privacy || input.visibility || 'public').toLowerCase();
    const privacyStatus = ['public', 'unlisted', 'private'].includes(privacy) ? privacy : 'private';

    return {
      platform,
      payload: {
        snippet: {
          title,
          description,
          tags: tagsArray,
          categoryId,
          defaultLanguage: input.language || 'en',
        },
        status: {
          privacyStatus,
          selfDeclaredMadeForKids: Boolean(input.madeForKids),
          embeddable: input.allowEmbedding !== false,
        },
      },
      mappedFields: ['title', 'description', 'tags', 'category', 'language', 'privacy', 'madeForKids', 'allowEmbedding'],
      ignoredFields: ['location', 'altText', 'coverImage', 'tiktokInteractionPermissions'],
      warnings,
      requiredMissing,
    };
  }

  if (platform === 'tiktok') {
    const baseCaption = String(overrides.caption || input.mainCaption || input.title || input.description || '').trim();
    const fullCaption = hashtags && !baseCaption.includes('#') ? `${baseCaption} ${hashtags}`.trim() : baseCaption;
    const caption = fullCaption.slice(0, 2200);
    if (fullCaption.length > 2200) warnings.push('TikTok caption truncated to 2200 characters.');
    if (!caption) warnings.push('Caption is empty; TikTok recommends a descriptive caption.');

    const requestedPrivacy = String(overrides.privacy || input.privacy || 'public').toLowerCase();
    let privacyLevel = requestedPrivacy === 'private' ? 'SELF_ONLY' : 'PUBLIC_TO_EVERYONE';
    if (auditStatus !== 'audited') {
      privacyLevel = 'SELF_ONLY';
      warnings.push('TikTok app is unaudited: Content Posting API enforces SELF_ONLY (private) visibility until TikTok app audit approval.');
    }

    return {
      platform,
      payload: {
        post_info: {
          title: caption,
          privacy_level: privacyLevel,
          disable_comment: input.allowComments === false,
          disable_duet: overrides.allowDuet === false,
          disable_stitch: overrides.allowStitch === false,
          brand_content_toggle: Boolean(input.brandedContent),
          brand_organic_toggle: input.contentDisclosure === 'self',
        },
      },
      mappedFields: ['mainCaption', 'title', 'hashtags', 'privacy', 'allowComments', 'brandedContent', 'contentDisclosure'],
      ignoredFields: ['youtubeTags', 'allowEmbedding', 'madeForKids', 'location'],
      warnings,
      requiredMissing,
    };
  }

  if (platform === 'instagram') {
    const baseCaption = String(overrides.caption || input.mainCaption || input.description || input.title || '').trim();
    const withTags = hashtags && !baseCaption.includes('#') ? `${baseCaption}\n\n${hashtags}`.trim() : baseCaption;
    const caption = withTags.slice(0, 2200);
    if (withTags.length > 2200) warnings.push('Instagram caption truncated to 2200 characters.');

    const location = String(overrides.location || input.location || '').trim();

    return {
      platform,
      payload: {
        media_type: 'REELS',
        caption,
        share_to_feed: true,
        location_name: location || undefined,
        alt_text: input.altText || undefined,
        comments_enabled: input.allowComments !== false,
      },
      mappedFields: ['mainCaption', 'description', 'hashtags', 'location', 'altText', 'allowComments', 'coverImage'],
      ignoredFields: ['youtubeTags', 'allowEmbedding', 'madeForKids', 'category'],
      warnings,
      requiredMissing,
    };
  }

  // Facebook
  const fbTitle = String(overrides.title || input.title || '').trim().slice(0, 255);
  const baseDesc = String(overrides.caption || input.mainCaption || input.description || '').trim();
  const fbDesc = hashtags && !baseDesc.includes('#') ? `${baseDesc}\n\n${hashtags}`.trim() : baseDesc;
  const pageId = String(overrides.pageId || '').trim();
  if (!fbDesc && !fbTitle) warnings.push('Provide either a Facebook title or caption/description.');

  return {
    platform,
    payload: {
      title: fbTitle || undefined,
      description: fbDesc,
      page_id: pageId || 'connected_page_default',
      published: (input.privacy || 'public').toLowerCase() === 'public',
      allow_comments: input.allowComments !== false,
    },
    mappedFields: ['title', 'description', 'mainCaption', 'hashtags', 'privacy', 'pageDestination', 'thumbnail'],
    ignoredFields: ['youtubeTags', 'madeForKids', 'tiktokInteractionPermissions'],
    warnings,
    requiredMissing,
  };
}
