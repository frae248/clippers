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

export interface ClientUrlInspection {
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

function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith('.' + domain);
}

export function isSafeExternalUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeVideoUrlInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/|$)/.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export function inspectClientVideoUrl(rawInput: string): ClientUrlInspection | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  const normalizedInput = normalizeVideoUrlInput(trimmed);
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
      error: 'Enter a valid http:// or https:// video URL.',
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
      error: 'Only HTTP and HTTPS URLs are supported.',
    };
  }

  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname;
  const cleanUrl = parsed.toString();

  if (YOUTUBE_HOSTS.has(host)) {
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
          'Download your own video from YouTube Studio (Content → Options → Download) and upload the MP4 file.',
        error:
          'Paste a complete YouTube video, Shorts, or Live link (for example: youtube.com/watch?v=... or youtu.be/...).',
      };
    }

    return {
      valid: true,
      normalizedUrl: cleanUrl,
      platform: 'YouTube',
      requiresAuthorizedUpload: true,
      suggestedTitle: `YouTube Video (${videoId})`,
      studioHint:
        'YouTube link identified. CLIPFORGE never scrapes or bypasses platform protections — save this project with your source link, then upload your downloaded YouTube Studio MP4/MOV file to start AI clipping.',
    };
  }

  if (TIKTOK_HOSTS.has(host)) {
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
          'Download your original video from TikTok Creator Center or drafts and upload the MP4/MOV file.',
        error:
          'Paste a valid TikTok video URL (for example: tiktok.com/@creator/video/... or vm.tiktok.com/...).',
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
        'TikTok link identified. CLIPFORGE never scrapes or bypasses platform protections — save this project with your source link, then upload your downloaded TikTok Creator Center MP4/MOV file to start AI clipping.',
    };
  }

  if (INSTAGRAM_HOSTS.has(host)) {
    const match = pathname.match(/^\/(?:reel|reels|p|tv|share\/reel|share\/p)\/([^/?#]+)/);
    if (!match) {
      return {
        valid: false,
        normalizedUrl: cleanUrl,
        platform: 'Instagram',
        requiresAuthorizedUpload: true,
        suggestedTitle: 'Instagram Clip Project',
        studioHint:
          'Save your Reel or video from Instagram / Meta Business Suite and upload the MP4/MOV file.',
        error:
          'Paste a valid Instagram Reel or post URL (for example: instagram.com/reel/... or instagram.com/p/...).',
      };
    }

    return {
      valid: true,
      normalizedUrl: cleanUrl,
      platform: 'Instagram',
      requiresAuthorizedUpload: true,
      suggestedTitle: `Instagram Video (${match[1]})`,
      studioHint:
        'Instagram link identified. CLIPFORGE never scrapes or bypasses platform protections — save this project with your source link, then upload your downloaded Instagram / Meta Business Suite MP4/MOV file to start AI clipping.',
    };
  }

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
        studioHint: `${platform} link identified. CLIPFORGE does not scrape or bypass protected streams — save this project with your link and upload an authorized MP4/MOV/WEBM file you own.`,
      };
    }
  }

  const baseName = pathname.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
  return {
    valid: true,
    normalizedUrl: cleanUrl,
    platform: 'Direct URL',
    requiresAuthorizedUpload: false,
    suggestedTitle: baseName || 'Imported Direct Video',
    studioHint:
      'Direct public MP4, MOV, WEBM, or MKV URLs will be fetched securely and verified with FFprobe.',
  };
}
