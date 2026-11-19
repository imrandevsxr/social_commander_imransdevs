import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { CentralizedMetadataInput, mapMetadataForPlatform, PlatformMappingResult } from './metadataEngine.ts';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in server environment secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function resolveThinkingLevel(level?: string): ThinkingLevel {
  if (level === 'HIGH') return ThinkingLevel.HIGH;
  if (level === 'MEDIUM') return ThinkingLevel.MEDIUM;
  return ThinkingLevel.LOW;
}

export async function testGeminiConnection(model = 'gemini-4-hydrogen'): Promise<{ ok: boolean; model: string; reply: string; latencyMs: number }> {
  const ai = getGeminiClient();
  const started = Date.now();
  const response = await ai.models.generateContent({
    model,
    contents: 'Reply with exactly: Gemini connection verified.',
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });
  return {
    ok: true,
    model,
    reply: (response.text || '').trim(),
    latencyMs: Date.now() - started,
  };
}

export async function generateAiMetadataSuggestions(
  input: CentralizedMetadataInput,
  platforms: Array<'youtube' | 'tiktok' | 'facebook' | 'instagram'>,
  model = 'gemini-4-hydrogen',
  thinkingLevel = 'LOW'
): Promise<{
  suggestedTitle: string;
  suggestedDescription: string;
  suggestedHashtags: string;
  suggestedTags: string;
  compatibilityNotes: string[];
  platformMappings: PlatformMappingResult[];
}> {
  const ai = getGeminiClient();
  const prompt = `Analyze this creator video metadata and produce optimized social publishing suggestions without altering factual claims or inventing unrelated details.
Input metadata:
Title: ${input.title || ''}
Description: ${input.description || ''}
Main Caption: ${input.mainCaption || ''}
Hashtags: ${input.hashtags || ''}
Tags: ${input.tags || ''}
Keywords: ${input.keywords || ''}
Category: ${input.category || ''}
Location: ${input.location || ''}
Target Platforms: ${platforms.join(', ')}`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction:
        'You are a social media metadata strategist for YouTube, TikTok, Facebook, and Instagram. Preserve user facts, respect character limits (YouTube title <= 100 chars, TikTok/IG caption <= 2200 chars), and return concise, high-clarity improvements.',
      thinkingConfig: { thinkingLevel: resolveThinkingLevel(thinkingLevel) },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          suggestedTitle: { type: Type.STRING },
          suggestedDescription: { type: Type.STRING },
          suggestedHashtags: { type: Type.STRING },
          suggestedTags: { type: Type.STRING },
          compatibilityNotes: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          platformTweaks: {
            type: Type.OBJECT,
            properties: {
              youtubeTitle: { type: Type.STRING },
              youtubeDescription: { type: Type.STRING },
              tiktokCaption: { type: Type.STRING },
              instagramCaption: { type: Type.STRING },
              facebookDescription: { type: Type.STRING },
            },
          },
        },
      },
    },
  });

  const parsed = JSON.parse((response.text || '{}').trim());
  const mergedInput: CentralizedMetadataInput = {
    ...input,
    title: input.title || parsed.suggestedTitle || '',
    description: input.description || parsed.suggestedDescription || '',
    hashtags: input.hashtags || parsed.suggestedHashtags || '',
    tags: input.tags || parsed.suggestedTags || '',
    platformOverridesJson: {
      ...(input.platformOverridesJson || {}),
      youtube: {
        ...(input.platformOverridesJson?.youtube || {}),
        ...(parsed.platformTweaks?.youtubeTitle && !input.platformOverridesJson?.youtube?.title
          ? { title: parsed.platformTweaks.youtubeTitle }
          : {}),
      },
      tiktok: {
        ...(input.platformOverridesJson?.tiktok || {}),
        ...(parsed.platformTweaks?.tiktokCaption && !input.platformOverridesJson?.tiktok?.caption
          ? { caption: parsed.platformTweaks.tiktokCaption }
          : {}),
      },
      instagram: {
        ...(input.platformOverridesJson?.instagram || {}),
        ...(parsed.platformTweaks?.instagramCaption && !input.platformOverridesJson?.instagram?.caption
          ? { caption: parsed.platformTweaks.instagramCaption }
          : {}),
      },
      facebook: {
        ...(input.platformOverridesJson?.facebook || {}),
        ...(parsed.platformTweaks?.facebookDescription && !input.platformOverridesJson?.facebook?.caption
          ? { caption: parsed.platformTweaks.facebookDescription }
          : {}),
      },
    },
  };

  return {
    suggestedTitle: parsed.suggestedTitle || input.title || '',
    suggestedDescription: parsed.suggestedDescription || input.description || '',
    suggestedHashtags: parsed.suggestedHashtags || input.hashtags || '',
    suggestedTags: parsed.suggestedTags || input.tags || '',
    compatibilityNotes: Array.isArray(parsed.compatibilityNotes) ? parsed.compatibilityNotes : [],
    platformMappings: platforms.map((p) => mapMetadataForPlatform(mergedInput, p)),
  };
}

export async function runAdminAssistantChat(
  userMessage: string,
  systemSummary: Record<string, unknown>,
  history: Array<{ role: 'user' | 'assistant'; text: string }>,
  model = 'gemini-4-hydrogen',
  thinkingLevel = 'LOW'
): Promise<string> {
  const ai = getGeminiClient();
  const formattedHistory = history
    .slice(-10)
    .map((m) => `${m.role === 'user' ? 'Admin' : 'Assistant'}: ${m.text}`)
    .join('\n');

  const response = await ai.models.generateContent({
    model,
    contents: `System Operational Context (redacted — zero secrets/tokens included):
${JSON.stringify(systemSummary, null, 2)}

Recent Conversation:
${formattedHistory}

Admin Request:
${userMessage}`,
    config: {
      systemInstruction:
        'You are the AI Administrator Assistant for Social Command Center. Help diagnose publishing failures, explain YouTube/TikTok/Facebook/Instagram API quota or OAuth requirements, review queue bottlenecks, and suggest safe configuration steps. Never claim to execute arbitrary commands, reveal credentials, or bypass role permissions.',
      thinkingConfig: { thinkingLevel: resolveThinkingLevel(thinkingLevel) },
    },
  });

  return (response.text || 'Unable to generate a response.').trim();
}
