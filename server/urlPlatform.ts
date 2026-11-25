export type SourcePlatform =
  | 'YouTube'
  | 'TikTok'
  | 'Instagram'
  | 'Vimeo'
  | 'Twitch'
  | 'Facebook'
  | 'X'
  | 'Netflix'
  | 'Direct URL'
  | 'Direct Upload';

export interface UrlInspectionResult {
  valid: boolean;
  normalizedUrl: string;
  platform: SourcePlatform;
  requiresAuthorizedUpload: boolean;
  suggestedTitle: string;
  studioHint: string;
  error?: string;
}

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'studio.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

const TIKTOK_HOSTS = new Set([
  'tiktok.com',
  'www.tiktok.com',
  'm.tiktok.com',
  'vm.tiktok.com',
  'vt.tiktok.com',
]);

const INSTAGRAM_HOSTS = new Set([
  'instagram.com',
  'www.instagram.com',
  'm.instagram.com',
]);

function hostMatches(host: string, set: Set<string>): boolean {
  return set.has(host);
}

function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith('.' + domain);
}

export function normalizeVideoUrlInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Reject explicit non-http(s) schemes such as javascript:, data:, file:, ftp:
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/|$)/.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export function inspectVideoUrl(rawInput: string): UrlInspectionResult {
  const normalizedInput = normalizeVideoUrlInput(rawInput);
  if (!normalizedInput) {
    return {
      valid: false,
      normalizedUrl: '',
      platform: 'Direct URL',
      requiresAuthorizedUpload: false,
      suggestedTitle: '',
      studioHint: '',
      error: 'Enter a YouTube, TikTok, Instagram, or direct MP4/MOV/WEBM URL.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(normalizedInput);
  } catch {
    return {
      valid: false,
      normalizedUrl: normalizedInput,
      platform: 'Direct URL',
      requiresAuthorizedUpload: false,
      suggestedTitle: '',
      studioHint: '',
      error: 'Please enter a valid http:// or https:// video URL.',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      normalizedUrl: normalizedInput,
      platform: 'Direct URL',
      requiresAuthorizedUpload: false,
      suggestedTitle: '',
      studioHint: '',
      error: 'Only HTTP and HTTPS URLs are permitted.',
    };
  }

  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname;
  const cleanUrl = parsed.toString();

  // YouTube
  if (hostMatches(host, YOUTUBE_HOSTS)) {
    let videoId = '';
    if (host === 'youtu.be' || host === 'www.youtu.be') {
      videoId = pathname.replace(/^\/+/, '').split('/')[0] || '';
    } else if (pathname === '/watch' || pathname === '/watch/') {
      videoId = parsed.searchParams.get('v')?.trim() || '';
    } else {
      const m = pathname.match(/^\/(?:shorts|live|embed|v|video)\/([^/?#]+)/);
      if (m) videoId = m[1];
    }

    if (!videoId) {
      return {
        valid: false,
        normalizedUrl: cleanUrl,
        platform: 'YouTube',
        requiresAuthorizedUpload: true,
        suggestedTitle: 'YouTube Clip Project',
        studioHint:
          'Download your video from YouTube Studio (Content → Options → Download) and upload the MP4 file.',
        error:
          'Enter a specific YouTube video, Shorts, or Live URL (for example: youtube.com/watch?v=... or youtu.be/...).',
      };
    }

    return {
      valid: true,
      normalizedUrl: cleanUrl,
      platform: 'YouTube',
      requiresAuthorizedUpload: true,
      suggestedTitle: `YouTube Video (${videoId})`,
      studioHint:
        'Direct extraction from YouTube is unavailable because CLIPFORGE never scrapes or bypasses platform protections. Download your own video from YouTube Studio and upload the MP4/MOV file below to start AI clipping.',
    };
  }

  // TikTok
  if (hostMatches(host, TIKTOK_HOSTS)) {
    const isShortHost = host === 'vm.tiktok.com' || host === 'vt.tiktok.com';
    const pathValid = isShortHost
      ? pathname.replace(/^\/+/, '').length >= 2
      : /^\/(?:@[^/]+\/(?:video|photo)\/\d+|t\/[^/]+|v\/\d+|embed\/v2\/\d+)/.test(pathname);

    if (!pathValid) {
      return {
        valid: false,
        normalizedUrl: cleanUrl,
        platform: 'TikTok',
        requiresAuthorizedUpload: true,
        suggestedTitle: 'TikTok Clip Project',
        studioHint:
          'Download your original video from TikTok Creator Center or your drafts and upload the MP4/MOV file.',
        error:
          'Enter a valid TikTok video URL (for example: tiktok.com/@creator/video/... or vm.tiktok.com/...).',
      };
    }

    const idMatch = pathname.match(/\/(?:video|photo|t|v)\/([^/?#]+)/);
    const shortId = idMatch?.[1] || pathname.replace(/^\/+|\/+$/g, '').split('/')[0] || 'Clip';
    return {
      valid: true,
      normalizedUrl: cleanUrl,
      platform: 'TikTok',
      requiresAuthorizedUpload: true,
      suggestedTitle: `TikTok Video (${shortId})`,
      studioHint:
        'Direct extraction from TikTok is unavailable because CLIPFORGE never scrapes or bypasses platform protections. Upload your downloaded video from TikTok Creator Center below to start AI clipping.',
    };
  }

  // Instagram
  if (hostMatches(host, INSTAGRAM_HOSTS)) {
    const match = pathname.match(/^\/(?:reel|reels|p|tv|share\/reel|share\/p)\/([^/?#]+)/);
    if (!match) {
      return {
        valid: false,
        normalizedUrl: cleanUrl,
        platform: 'Instagram',
        requiresAuthorizedUpload: true,
        suggestedTitle: 'Instagram Clip Project',
        studioHint:
          'Save your original Reel or video from Instagram / Meta Business Suite and upload the MP4/MOV file.',
        error:
          'Enter a valid Instagram Reel or post URL (for example: instagram.com/reel/... or instagram.com/p/...).',
      };
    }

    return {
      valid: true,
      normalizedUrl: cleanUrl,
      platform: 'Instagram',
      requiresAuthorizedUpload: true,
      suggestedTitle: `Instagram Video (${match[1]})`,
      studioHint:
        'Direct extraction from Instagram is unavailable because CLIPFORGE never scrapes or bypasses platform protections. Upload your saved video from Instagram or Meta Business Suite below to start AI clipping.',
    };
  }

  // Other protected streaming / social hosts
  const otherPlatforms: Array<[string, SourcePlatform]> = [
    ['netflix.com', 'Netflix'],
    ['vimeo.com', 'Vimeo'],
    ['twitch.tv', 'Twitch'],
    ['facebook.com', 'Facebook'],
    ['fb.watch', 'Facebook'],
    ['x.com', 'X'],
    ['twitter.com', 'X'],
  ];

  for (const [domain, platform] of otherPlatforms) {
    if (hostMatchesDomain(host, domain)) {
      return {
        valid: true,
        normalizedUrl: cleanUrl,
        platform,
        requiresAuthorizedUpload: true,
        suggestedTitle: `${platform} Video Project`,
        studioHint: `Direct extraction from ${platform} is unavailable because CLIPFORGE does not scrape or bypass DRM/platform protections. Upload an authorized MP4, MOV, or WEBM file you own below.`,
      };
    }
  }

  // Direct public media URL candidate
  const baseName = pathname.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
  return {
    valid: true,
    normalizedUrl: cleanUrl,
    platform: 'Direct URL',
    requiresAuthorizedUpload: false,
    suggestedTitle: baseName || 'Imported Direct Video',
    studioHint:
      'Direct public MP4, MOV, WEBM, and MKV file links are verified with FFprobe before processing.',
  };
}
