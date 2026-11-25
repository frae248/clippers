import React, { useEffect, useRef } from 'react';
import { ExternalLink, Play, ShieldAlert } from 'lucide-react';
import { formatTimecode } from '../lib/presets';
import { isSafeExternalUrl } from '../lib/urlPlatform';

interface YouTubeEmbedPlayerProps {
  videoId: string;
  title: string;
  thumbnailUrl?: string;
  embeddable?: boolean;
  seekToSeconds?: number | null;
  seekTrigger?: number;
  activeRangeLabel?: string | null;
}

export function YouTubeEmbedPlayer({
  videoId,
  title,
  thumbnailUrl,
  embeddable = true,
  seekToSeconds,
  seekTrigger = 0,
  activeRangeLabel,
}: YouTubeEmbedPlayerProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const safeId = /^[a-zA-Z0-9_-]{6,20}$/.test(videoId) ? videoId : '';
  const watchUrl = safeId ? `https://www.youtube.com/watch?v=${safeId}` : '';

  useEffect(() => {
    if (!embeddable || !safeId || seekToSeconds === null || seekToSeconds === undefined) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;

    const targetSec = Math.max(0, Math.floor(seekToSeconds));
    try {
      win.postMessage(
        JSON.stringify({ event: 'command', func: 'seekTo', args: [targetSec, true] }),
        'https://www.youtube.com'
      );
      win.postMessage(
        JSON.stringify({ event: 'command', func: 'playVideo', args: [] }),
        'https://www.youtube.com'
      );
    } catch {
      // Cross-origin postMessage ignored safely
    }
  }, [embeddable, safeId, seekToSeconds, seekTrigger]);

  if (!safeId) {
    return null;
  }

  if (!embeddable) {
    return (
      <div className="aspect-video w-full rounded-xl bg-[#090909] border border-white/[0.08] overflow-hidden relative flex items-center justify-center p-6 text-center">
        {thumbnailUrl && isSafeExternalUrl(thumbnailUrl) && (
          <img
            src={thumbnailUrl}
            alt={title}
            className="absolute inset-0 w-full h-full object-cover opacity-20"
            referrerPolicy="no-referrer"
          />
        )}
        <div className="relative z-10 max-w-sm space-y-3">
          <ShieldAlert className="w-7 h-7 text-amber-400 mx-auto" />
          <p className="text-xs font-medium text-white">
            Embedded playback is disabled by the channel owner
          </p>
          <p className="text-[11px] text-zinc-400">
            You can still analyze the transcript, preview timestamps, and upload your authorized source file to render MP4 clips.
          </p>
          {isSafeExternalUrl(watchUrl) && (
            <a
              href={watchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1B1B1B] border border-white/15 hover:border-white/30 text-xs font-medium text-white"
            >
              Open on YouTube
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
    );
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const embedSrc = `https://www.youtube.com/embed/${safeId}?enablejsapi=1&rel=0&modestbranding=1${
    origin ? `&origin=${encodeURIComponent(origin)}` : ''
  }`;

  return (
    <div className="space-y-2">
      <div className="aspect-video w-full rounded-xl bg-[#090909] border border-white/[0.08] overflow-hidden">
        <iframe
          ref={iframeRef}
          src={embedSrc}
          title={title}
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
      {activeRangeLabel && (
        <div className="flex items-center justify-between text-[11px] text-zinc-400 px-1">
          <span className="inline-flex items-center gap-1.5 text-[#C4B5FD]">
            <Play className="w-3 h-3" />
            Previewing clip segment: {activeRangeLabel}
          </span>
          {seekToSeconds !== null && seekToSeconds !== undefined && (
            <span className="font-mono text-zinc-500">
              Seeked to {formatTimecode(seekToSeconds)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
