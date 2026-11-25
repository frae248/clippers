import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pause,
  Play,
  Repeat,
  RotateCcw,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { formatTimecode } from '../lib/presets';
import type { AspectRatio, CaptionPresetId, SubtitlePosition, WordTiming } from '../types';

interface ClipPreviewPlayerProps {
  sourceUrl: string | null;
  exportedUrl: string | null;
  previewMode: 'edit' | 'exported';
  onPreviewModeChange: (mode: 'edit' | 'exported') => void;
  startTime: number;
  endTime: number;
  currentTime: number;
  onTimeUpdate: (time: number) => void;
  aspectRatio: AspectRatio;
  cropX: number;
  cropY: number;
  zoom: number;
  burnSubtitles: boolean;
  captionPreset: CaptionPresetId;
  fontSize: number;
  highlightColor: string;
  subtitlePosition: SubtitlePosition;
  bgOpacity: number;
  outlineWidth: number;
  darkCinematicFx: boolean;
  transcript: string;
  wordTimings: WordTiming[];
  videoRefExternal?: React.RefObject<HTMLVideoElement | null>;
}

export function ClipPreviewPlayer({
  sourceUrl,
  exportedUrl,
  previewMode,
  onPreviewModeChange,
  startTime,
  endTime,
  currentTime,
  onTimeUpdate,
  aspectRatio,
  cropX,
  cropY,
  zoom,
  burnSubtitles,
  captionPreset,
  fontSize,
  highlightColor,
  subtitlePosition,
  bgOpacity,
  outlineWidth,
  darkCinematicFx,
  transcript,
  wordTimings,
  videoRefExternal,
}: ClipPreviewPlayerProps) {
  const internalRef = useRef<HTMLVideoElement | null>(null);
  const videoRef = videoRefExternal || internalRef;
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [loopSection, setLoopSection] = useState(true);

  const activeUrl = previewMode === 'exported' && exportedUrl ? exportedUrl : sourceUrl;

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (previewMode === 'edit' && Math.abs(vid.currentTime - currentTime) > 0.4) {
      vid.currentTime = currentTime;
    }
  }, [currentTime, previewMode, videoRef]);

  const togglePlay = async () => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) {
      if (previewMode === 'edit' && (vid.currentTime < startTime || vid.currentTime >= endTime)) {
        vid.currentTime = startTime;
      }
      await vid.play().catch(() => {});
      setPlaying(true);
    } else {
      vid.pause();
      setPlaying(false);
    }
  };

  const handleTimeUpdate = () => {
    const vid = videoRef.current;
    if (!vid) return;
    const t = vid.currentTime;
    if (previewMode === 'edit' && loopSection && t >= endTime) {
      vid.currentTime = startTime;
      onTimeUpdate(startTime);
      return;
    }
    onTimeUpdate(t);
  };

  const jumpToClipStart = () => {
    const vid = videoRef.current;
    if (!vid) return;
    const target = previewMode === 'exported' ? 0 : startTime;
    vid.currentTime = target;
    onTimeUpdate(target);
  };

  // Build synchronized word timings (real or evenly distributed fallback for edited text)
  const effectiveWords = useMemo<WordTiming[]>(() => {
    if (wordTimings && wordTimings.length > 0) {
      const inRange = wordTimings.filter((w) => w.end > startTime && w.start < endTime);
      if (inRange.length > 0) return inRange;
    }
    const tokens = transcript.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    const dur = Math.max(0.5, endTime - startTime);
    const step = dur / tokens.length;
    return tokens.map((word, idx) => ({
      word,
      start: startTime + idx * step,
      end: startTime + (idx + 1) * step,
    }));
  }, [wordTimings, transcript, startTime, endTime]);

  const activePhrase = useMemo(() => {
    if (!burnSubtitles || previewMode === 'exported' || effectiveWords.length === 0) return null;
    const maxWords =
      captionPreset === 'HORMOZI' ? 3 : captionPreset === 'PODCAST' ? 7 : 5;
    const activeIdx = effectiveWords.findIndex(
      (w) => currentTime >= w.start && currentTime <= w.end + 0.15
    );
    const resolvedIdx = activeIdx >= 0 ? activeIdx : 0;
    const groupIdx = Math.floor(resolvedIdx / maxWords);
    const slice = effectiveWords.slice(groupIdx * maxWords, (groupIdx + 1) * maxWords);
    return { slice, activeWordIdx: resolvedIdx - groupIdx * maxWords };
  }, [burnSubtitles, previewMode, effectiveWords, currentTime, captionPreset]);

  const frameAspectClass =
    aspectRatio === '9:16'
      ? 'aspect-[9/16] max-h-[500px]'
      : aspectRatio === '1:1'
      ? 'aspect-square max-h-[460px]'
      : aspectRatio === '4:5'
      ? 'aspect-[4/5] max-h-[480px]'
      : 'aspect-video w-full max-w-[680px]';

  const positionClass =
    subtitlePosition === 'top'
      ? 'top-[12%]'
      : subtitlePosition === 'center'
      ? 'top-1/2 -translate-y-1/2'
      : subtitlePosition === 'lower-middle'
      ? 'bottom-[22%]'
      : 'bottom-[10%]';

  const scaledPreviewFont = Math.max(13, Math.round(fontSize * 0.34));

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Mode toggle when an exported MP4 exists */}
      <div className="w-full flex items-center justify-between gap-2">
        <div className="inline-flex items-center p-0.5 rounded-lg bg-[#141414] border border-white/[0.08]">
          <button
            type="button"
            onClick={() => onPreviewModeChange('edit')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              previewMode === 'edit'
                ? 'bg-[#8B5CF6] text-white'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Live Edit Preview
          </button>
          <button
            type="button"
            disabled={!exportedUrl}
            onClick={() => onPreviewModeChange('exported')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              previewMode === 'exported'
                ? 'bg-[#8B5CF6] text-white'
                : exportedUrl
                ? 'text-zinc-400 hover:text-white'
                : 'text-zinc-600 cursor-not-allowed'
            }`}
          >
            Exported MP4
          </button>
        </div>

        <span className="text-xs font-mono text-zinc-400 whitespace-nowrap">
          {aspectRatio}
        </span>
      </div>

      {/* Video Frame Container */}
      <div className="w-full flex items-center justify-center bg-[#090909] border border-white/[0.08] rounded-xl p-4 min-h-[380px]">
        <div
          className={`relative overflow-hidden rounded-lg bg-black border border-white/10 shadow-2xl ${frameAspectClass}`}
        >
          {activeUrl ? (
            <video
              ref={videoRef}
              src={activeUrl}
              muted={muted}
              playsInline
              onTimeUpdate={handleTimeUpdate}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              style={
                previewMode === 'edit'
                  ? {
                      objectFit: 'cover',
                      objectPosition: `${Math.round(cropX * 100)}% ${Math.round(cropY * 100)}%`,
                      transform: `scale(${zoom})`,
                      filter: darkCinematicFx
                        ? 'contrast(1.06) brightness(0.99) saturate(0.94)'
                        : undefined,
                    }
                  : { objectFit: 'contain' }
              }
              className="w-full h-full transition-transform duration-150"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center p-6 text-center text-xs text-zinc-500">
              Source video stream unavailable
            </div>
          )}

          {/* Subtle Dark Cinematic Vignette Overlay */}
          {previewMode === 'edit' && darkCinematicFx && (
            <div
              aria-hidden="true"
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'radial-gradient(circle, rgba(0,0,0,0) 55%, rgba(0,0,0,0.48) 100%)',
              }}
            />
          )}

          {/* Live Synced Caption Preview */}
          {activePhrase && (
            <div
              className={`absolute inset-x-3 pointer-events-none flex justify-center text-center ${positionClass}`}
            >
              <div
                style={{
                  backgroundColor:
                    bgOpacity > 0.05 ? `rgba(9, 9, 9, ${bgOpacity})` : 'transparent',
                  padding: bgOpacity > 0.05 ? '4px 10px' : '0',
                  borderRadius: '6px',
                  fontSize: `${scaledPreviewFont}px`,
                  lineHeight: 1.2,
                  textShadow:
                    outlineWidth > 0
                      ? `0 2px ${Math.max(2, outlineWidth * 2)}px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.9)`
                      : undefined,
                }}
                className={`font-display ${
                  captionPreset === 'MINIMAL' ? 'font-medium' : 'font-extrabold'
                } ${captionPreset === 'HORMOZI' ? 'uppercase tracking-tight' : ''}`}
              >
                {activePhrase.slice.map((w, idx) => {
                  const isActive = idx === activePhrase.activeWordIdx || w.highlight;
                  return (
                    <span
                      key={`${w.word}_${idx}`}
                      style={{
                        color: isActive ? highlightColor : '#FFFFFF',
                        display: 'inline-block',
                        transform:
                          isActive && captionPreset === 'HORMOZI' ? 'scale(1.06)' : undefined,
                      }}
                      className="mx-1 transition-transform duration-100"
                    >
                      {w.word}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Transport Controls */}
      <div className="w-full flex flex-wrap items-center justify-between gap-3 bg-[#141414] border border-white/[0.08] rounded-xl px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={jumpToClipStart}
            title="Jump to clip start"
            aria-label="Jump to clip start"
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              const vid = videoRef.current;
              if (vid) {
                vid.currentTime = Math.max(0, vid.currentTime - 2);
                onTimeUpdate(vid.currentTime);
              }
            }}
            aria-label="Back 2 seconds"
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <SkipBack className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? 'Pause' : 'Play'}
            className="w-9 h-9 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white flex items-center justify-center transition-colors"
          >
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
          <button
            type="button"
            onClick={() => {
              const vid = videoRef.current;
              if (vid) {
                vid.currentTime = vid.currentTime + 2;
                onTimeUpdate(vid.currentTime);
              }
            }}
            aria-label="Forward 2 seconds"
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>

        <span className="font-mono text-xs text-zinc-300">
          {formatTimecode(currentTime)}
        </span>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setLoopSection((v) => !v)}
            title="Loop clip boundaries"
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              loopSection
                ? 'bg-[#8B5CF6]/20 text-[#C4B5FD] border border-[#8B5CF6]/40'
                : 'text-zinc-400 hover:text-white border border-transparent'
            }`}
          >
            <Repeat className="w-3.5 h-3.5" />
            Loop clip
          </button>
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? 'Unmute' : 'Mute'}
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
