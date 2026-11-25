import type {
  TranscriptSegment,
  WordTiming,
  YouTubeCaptionTrackInfo,
  YouTubeMetadata,
} from './types.ts';

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'studio.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

export interface YouTubeUrlValidation {
  valid: boolean;
  videoId: string | null;
  normalizedUrl: string;
  urlType?: 'watch' | 'short' | 'live' | 'embed' | 'youtu.be';
  error?: string;
}

export function normalizeUrlScheme(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/|$)/.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export function extractYouTubeVideoId(rawInput: string): YouTubeUrlValidation {
  const normalized = normalizeUrlScheme(rawInput);
  if (!normalized) {
    return {
      valid: false,
      videoId: null,
      normalizedUrl: '',
      error: 'Enter a public YouTube video link.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return {
      valid: false,
      videoId: null,
      normalizedUrl: normalized,
      error: 'Enter a valid YouTube URL (e.g. https://www.youtube.com/watch?v=... or https://youtu.be/...).',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      videoId: null,
      normalizedUrl: normalized,
      error: 'Only HTTP and HTTPS YouTube URLs are permitted.',
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) {
    return {
      valid: false,
      videoId: null,
      normalizedUrl: parsed.toString(),
      error: 'URL must be a valid youtube.com or youtu.be link.',
    };
  }

  const pathname = parsed.pathname;
  let videoId = '';
  let urlType: YouTubeUrlValidation['urlType'] = 'watch';

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    videoId = pathname.replace(/^\/+/, '').split('/')[0] || '';
    urlType = 'youtu.be';
  } else if (pathname === '/watch' || pathname === '/watch/') {
    videoId = parsed.searchParams.get('v')?.trim() || '';
    urlType = 'watch';
  } else {
    const match = pathname.match(/^\/(shorts|live|embed|v|video)\/([^/?#]+)/);
    if (match) {
      const kind = match[1];
      videoId = match[2];
      if (kind === 'shorts') urlType = 'short';
      else if (kind === 'live') urlType = 'live';
      else if (kind === 'embed') urlType = 'embed';
    }
  }

  if (!videoId || !/^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) {
    return {
      valid: false,
      videoId: null,
      normalizedUrl: parsed.toString(),
      error: 'Could not extract a valid YouTube video ID from this URL.',
    };
  }

  const canonicalUrl =
    urlType === 'short'
      ? `https://www.youtube.com/shorts/${videoId}`
      : `https://www.youtube.com/watch?v=${videoId}`;

  return {
    valid: true,
    videoId,
    normalizedUrl: canonicalUrl,
    urlType,
  };
}

export function parseIso8601Duration(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const match = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  const h = Number(match[1] || 0);
  const m = Number(match[2] || 0);
  const s = Number(match[3] || 0);
  return h * 3600 + m * 60 + s;
}

export async function fetchOfficialYouTubeMetadata(videoId: string): Promise<YouTubeMetadata> {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();

  if (apiKey) {
    const videoEndpoint = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${encodeURIComponent(
      videoId
    )}&key=${encodeURIComponent(apiKey)}`;

    const res = await fetch(videoEndpoint, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(
        `YouTube Data API returned HTTP ${res.status}${errBody ? `: ${errBody.slice(0, 200)}` : ''}`
      );
    }

    const data = (await res.json()) as {
      items?: Array<{
        snippet?: {
          title?: string;
          channelTitle?: string;
          description?: string;
          publishedAt?: string;
          thumbnails?: {
            maxres?: { url?: string };
            standard?: { url?: string };
            high?: { url?: string };
            medium?: { url?: string };
            default?: { url?: string };
          };
        };
        contentDetails?: { duration?: string };
        status?: { embeddable?: boolean; privacyStatus?: string };
      }>;
    };

    const item = data.items?.[0];
    if (!item || !item.snippet) {
      throw new Error('This YouTube video was not found or is private/unavailable.');
    }

    const thumbs = item.snippet.thumbnails;
    const thumbnailUrl =
      thumbs?.maxres?.url ||
      thumbs?.standard?.url ||
      thumbs?.high?.url ||
      thumbs?.medium?.url ||
      thumbs?.default?.url ||
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    // Query official captions list (public metadata of available caption tracks)
    let captionTracks: YouTubeCaptionTrackInfo[] = [];
    try {
      const capEndpoint = `https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${encodeURIComponent(
        videoId
      )}&key=${encodeURIComponent(apiKey)}`;
      const capRes = await fetch(capEndpoint, { headers: { Accept: 'application/json' } });
      if (capRes.ok) {
        const capData = (await capRes.json()) as {
          items?: Array<{
            id?: string;
            snippet?: { language?: string; name?: string; trackKind?: string };
          }>;
        };
        captionTracks = (capData.items || [])
          .filter((c) => c.id && c.snippet)
          .map((c) => ({
            id: c.id!,
            language: c.snippet!.language || 'unknown',
            name: c.snippet!.name || c.snippet!.language || 'Captions',
            trackKind: c.snippet!.trackKind,
          }));
      }
    } catch {
      captionTracks = [];
    }

    const captionsNote =
      captionTracks.length > 0
        ? `${captionTracks.length} official caption track(s) detected (${captionTracks
            .map((t) => t.language)
            .join(', ')}). Download your .srt/.vtt captions from YouTube Studio or upload your authorized source video to analyze moments.`
        : 'No official public caption track metadata listed. Provide an authorized .srt/.vtt transcript or upload your source video for Gemini audio transcription.';

    return {
      videoId,
      title: item.snippet.title || `YouTube Video (${videoId})`,
      channelTitle: item.snippet.channelTitle || 'YouTube Channel',
      description: item.snippet.description || '',
      thumbnailUrl,
      durationSec: parseIso8601Duration(item.contentDetails?.duration),
      publishedAt: item.snippet.publishedAt || null,
      embeddable: item.status?.embeddable !== false,
      metadataSource: 'youtube_data_api',
      captionTracks,
      captionsNote,
    };
  }

  // Official YouTube oEmbed endpoint when YOUTUBE_API_KEY is not configured
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId}`
  )}&format=json`;
  const oembedRes = await fetch(oembedUrl, { headers: { Accept: 'application/json' } });

  if (!oembedRes.ok) {
    if (oembedRes.status === 401 || oembedRes.status === 403 || oembedRes.status === 404) {
      throw new Error(
        'This YouTube video is private, unavailable, or embedding is restricted by the owner.'
      );
    }
    throw new Error(`YouTube oEmbed metadata request failed (HTTP ${oembedRes.status}).`);
  }

  const oembed = (await oembedRes.json()) as {
    title?: string;
    author_name?: string;
    thumbnail_url?: string;
  };

  return {
    videoId,
    title: oembed.title || `YouTube Video (${videoId})`,
    channelTitle: oembed.author_name || 'YouTube Creator',
    description: '',
    thumbnailUrl: oembed.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    durationSec: null,
    publishedAt: null,
    embeddable: true,
    metadataSource: 'oembed',
    captionTracks: [],
    captionsNote:
      'YOUTUBE_API_KEY is not configured for full Data API caption-track listing. Provide an authorized .srt/.vtt/timestamped transcript or upload your source video for automatic Gemini transcription.',
  };
}

function distributeWords(text: string, start: number, end: number): WordTiming[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const step = Math.max(0.05, end - start) / words.length;
  return words.map((word, idx) => ({
    word,
    start: Number((start + idx * step).toFixed(3)),
    end: Number((start + (idx + 1) * step).toFixed(3)),
  }));
}

function parseTimestampToken(raw: string): number | null {
  const cleaned = raw.trim().replace(',', '.');
  const parts = cleaned.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return null;
}

function stripSubtitleMarkup(text: string): string {
  return text
    .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseTranscriptInput(
  rawText: string,
  filename?: string
): { segments: TranscriptSegment[]; format: string; error?: string } {
  const trimmed = rawText.replace(/^\uFEFF/, '').trim();
  if (!trimmed) {
    return {
      segments: [],
      format: 'empty',
      error: 'Transcript content is empty.',
    };
  }

  const lowerName = (filename || '').toLowerCase();

  // 1. JSON array format
  if (lowerName.endsWith('.json') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as Array<{
        start?: number;
        end?: number;
        text?: string;
        words?: WordTiming[];
      }>;
      if (Array.isArray(parsed)) {
        const segments: TranscriptSegment[] = parsed
          .filter((item) => item && typeof item.text === 'string' && item.text.trim())
          .map((item) => {
            const start = Math.max(0, Number(item.start) || 0);
            const end = Math.max(start + 0.5, Number(item.end) || start + 3);
            const text = item.text!.trim();
            return {
              start: Number(start.toFixed(2)),
              end: Number(end.toFixed(2)),
              text,
              words:
                Array.isArray(item.words) && item.words.length > 0
                  ? item.words
                  : distributeWords(text, start, end),
            };
          })
          .sort((a, b) => a.start - b.start);

        if (segments.length > 0) {
          return { segments, format: 'json' };
        }
      }
    } catch {
      // Fall through to other parsers
    }
  }

  // 2. SRT or WebVTT cue blocks (contains `-->`)
  if (
    lowerName.endsWith('.srt') ||
    lowerName.endsWith('.vtt') ||
    /^WEBVTT/i.test(trimmed) ||
    trimmed.includes('-->')
  ) {
    const normalizedLines = trimmed.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const segments: TranscriptSegment[] = [];

    let i = 0;
    while (i < normalizedLines.length) {
      const line = normalizedLines[i].trim();
      const cueMatch = line.match(
        /^((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})/
      );
      if (cueMatch) {
        const start = parseTimestampToken(cueMatch[1]);
        const end = parseTimestampToken(cueMatch[2]);
        i += 1;
        const textLines: string[] = [];
        while (i < normalizedLines.length && normalizedLines[i].trim() !== '') {
          textLines.push(normalizedLines[i].trim());
          i += 1;
        }
        const cleanText = stripSubtitleMarkup(textLines.join(' '));
        if (start !== null && end !== null && cleanText) {
          const safeEnd = Math.max(start + 0.3, end);
          // Deduplicate consecutive identical VTT rolling cues
          const prev = segments[segments.length - 1];
          if (!prev || prev.text !== cleanText) {
            segments.push({
              start: Number(start.toFixed(2)),
              end: Number(safeEnd.toFixed(2)),
              text: cleanText,
              words: distributeWords(cleanText, start, safeEnd),
            });
          } else {
            prev.end = Number(Math.max(prev.end, safeEnd).toFixed(2));
            prev.words = distributeWords(prev.text, prev.start, prev.end);
          }
        }
      } else {
        i += 1;
      }
    }

    if (segments.length > 0) {
      return {
        segments,
        format: /^WEBVTT/i.test(trimmed) || lowerName.endsWith('.vtt') ? 'vtt' : 'srt',
      };
    }
  }

  // 3. Timestamped text (supports both "[0:12] Hello" and YouTube transcript copy-paste "0:12\nHello")
  const lines = trimmed
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const rawEntries: Array<{ start: number; end?: number; text: string }> = [];
  let pendingStart: number | null = null;

  for (const line of lines) {
    // Explicit range: [12.5s - 18.0s] text  OR  00:12 - 00:18 text
    const rangeMatch = line.match(
      /^\[?\(?((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d+)?|\d+(?:\.\d+)?)s?\s*[-–]\s*((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d+)?|\d+(?:\.\d+)?)s?\)?\]?\s*(.+)$/
    );
    if (rangeMatch) {
      const s = parseTimestampToken(rangeMatch[1]);
      const e = parseTimestampToken(rangeMatch[2]);
      const t = rangeMatch[3].trim();
      if (s !== null && e !== null && t) {
        rawEntries.push({ start: s, end: Math.max(s + 0.5, e), text: t });
        pendingStart = null;
        continue;
      }
    }

    // Standalone timestamp line (YouTube transcript panel copy-paste format)
    const soloTimeMatch = line.match(/^\[?\(?((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d+)?)\)?\]?$/);
    if (soloTimeMatch) {
      const s = parseTimestampToken(soloTimeMatch[1]);
      if (s !== null) {
        pendingStart = s;
        continue;
      }
    }

    // Inline timestamp at start of line: "0:12 Hello world" or "[01:23] Hello world"
    const inlineTimeMatch = line.match(
      /^\[?\(?((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d+)?)\)?\]?\s+[-–:]?\s*(.+)$/
    );
    if (inlineTimeMatch) {
      const s = parseTimestampToken(inlineTimeMatch[1]);
      const t = inlineTimeMatch[2].trim();
      if (s !== null && t) {
        rawEntries.push({ start: s, text: t });
        pendingStart = null;
        continue;
      }
    }

    if (pendingStart !== null) {
      rawEntries.push({ start: pendingStart, text: line });
      pendingStart = null;
    } else if (rawEntries.length > 0) {
      // Continuation line for the previous timestamped entry
      rawEntries[rawEntries.length - 1].text += ` ${line}`;
    }
  }

  if (rawEntries.length > 0) {
    const segments: TranscriptSegment[] = rawEntries.map((entry, idx) => {
      const nextStart = idx + 1 < rawEntries.length ? rawEntries[idx + 1].start : null;
      const estimatedEnd =
        entry.end ??
        (nextStart !== null && nextStart > entry.start
          ? nextStart
          : entry.start + Math.max(2, Math.min(12, entry.text.split(/\s+/).length * 0.45)));
      const safeEnd = Math.max(entry.start + 0.4, estimatedEnd);
      return {
        start: Number(entry.start.toFixed(2)),
        end: Number(safeEnd.toFixed(2)),
        text: entry.text.trim(),
        words: distributeWords(entry.text, entry.start, safeEnd),
      };
    });
    return { segments, format: 'timestamped_text' };
  }

  return {
    segments: [],
    format: 'plain_untimestamped',
    error:
      'No timestamps found in this transcript. Upload an .srt or .vtt subtitle file, paste timestamped lines (e.g. 0:15 ...), or upload your authorized video file for AI audio transcription.',
  };
}
