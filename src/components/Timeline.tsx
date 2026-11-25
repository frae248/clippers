import React, { useRef, useState } from 'react';
import { formatTimecode } from '../lib/presets';
import type { Clip } from '../types';

interface TimelineProps {
  duration: number;
  currentTime: number;
  clipStart: number;
  clipEnd: number;
  clips: Clip[];
  activeClipId: string | null;
  onSeek: (time: number) => void;
  onChangeRange: (start: number, end: number) => void;
  onSelectClip: (clipId: string) => void;
}

export function Timeline({
  duration,
  currentTime,
  clipStart,
  clipEnd,
  clips,
  activeClipId,
  onSeek,
  onChangeRange,
  onSelectClip,
}: TimelineProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<'playhead' | 'start' | 'end' | null>(null);

  const safeDuration = Math.max(1, duration || 1);

  const timeFromClientX = (clientX: number): number => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Number((ratio * safeDuration).toFixed(2));
  };

  const handlePointerDown = (
    e: React.PointerEvent,
    mode: 'playhead' | 'start' | 'end'
  ) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(mode);
    const t = timeFromClientX(e.clientX);
    if (mode === 'playhead') onSeek(t);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const t = timeFromClientX(e.clientX);
    if (dragging === 'playhead') {
      onSeek(t);
    } else if (dragging === 'start') {
      const nextStart = Math.max(0, Math.min(clipEnd - 1, t));
      onChangeRange(nextStart, clipEnd);
    } else if (dragging === 'end') {
      const nextEnd = Math.min(safeDuration, Math.max(clipStart + 1, t));
      onChangeRange(clipStart, nextEnd);
    }
  };

  const handlePointerUp = () => {
    setDragging(null);
  };

  const startPct = (Math.max(0, Math.min(safeDuration, clipStart)) / safeDuration) * 100;
  const endPct = (Math.max(0, Math.min(safeDuration, clipEnd)) / safeDuration) * 100;
  const playheadPct = (Math.max(0, Math.min(safeDuration, currentTime)) / safeDuration) * 100;

  // Generate clean time ruler ticks
  const tickCount = 6;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => (safeDuration / tickCount) * i);

  return (
    <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-3 sm:p-4 select-none">
      <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 mb-2">
        <span>
          Playhead <strong className="text-white">{formatTimecode(currentTime)}</strong>
        </span>
        <span>
          Selection{' '}
          <strong className="text-[#8B5CF6]">
            {formatTimecode(clipStart)} – {formatTimecode(clipEnd)}
          </strong>{' '}
          ({Math.max(0, clipEnd - clipStart).toFixed(1)}s)
        </span>
      </div>

      {/* Ruler */}
      <div className="flex justify-between text-[10px] font-mono text-zinc-500 mb-1.5">
        {ticks.map((t, idx) => (
          <span key={idx}>{formatTimecode(t)}</span>
        ))}
      </div>

      {/* Interactive Scrub Track */}
      <div
        ref={trackRef}
        onPointerDown={(e) => handlePointerDown(e, 'playhead')}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="relative h-14 bg-[#090909] border border-white/[0.08] rounded-lg cursor-pointer overflow-hidden touch-none"
      >
        {/* Other clips markers */}
        {clips.map((c) => {
          const left = (c.start_time / safeDuration) * 100;
          const width = Math.max(0.8, ((c.end_time - c.start_time) / safeDuration) * 100);
          const isCurrent = c.id === activeClipId;
          return (
            <button
              key={c.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectClip(c.id);
              }}
              title={c.title}
              style={{ left: `${left}%`, width: `${width}%` }}
              className={`absolute top-2 bottom-2 rounded transition-colors ${
                isCurrent
                  ? 'bg-[#8B5CF6]/15 border border-[#8B5CF6]/40 z-0'
                  : 'bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08]'
              }`}
            />
          );
        })}

        {/* Active Trim Region */}
        <div
          style={{ left: `${startPct}%`, width: `${Math.max(1, endPct - startPct)}%` }}
          className="absolute top-1 bottom-1 bg-[#8B5CF6]/25 border-y-2 border-[#8B5CF6] z-10 pointer-events-none"
        />

        {/* Start Trim Handle */}
        <div
          role="slider"
          aria-label="Trim clip start"
          aria-valuemin={0}
          aria-valuemax={clipEnd - 1}
          aria-valuenow={clipStart}
          tabIndex={0}
          onPointerDown={(e) => handlePointerDown(e, 'start')}
          style={{ left: `${startPct}%` }}
          className="absolute top-0 bottom-0 w-3 -ml-1.5 bg-[#8B5CF6] hover:bg-[#9d75ff] cursor-ew-resize z-20 flex items-center justify-center rounded-l"
        >
          <span className="w-0.5 h-5 bg-white/80 rounded-full" />
        </div>

        {/* End Trim Handle */}
        <div
          role="slider"
          aria-label="Trim clip end"
          aria-valuemin={clipStart + 1}
          aria-valuemax={safeDuration}
          aria-valuenow={clipEnd}
          tabIndex={0}
          onPointerDown={(e) => handlePointerDown(e, 'end')}
          style={{ left: `${endPct}%` }}
          className="absolute top-0 bottom-0 w-3 -ml-1.5 bg-[#8B5CF6] hover:bg-[#9d75ff] cursor-ew-resize z-20 flex items-center justify-center rounded-r"
        >
          <span className="w-0.5 h-5 bg-white/80 rounded-full" />
        </div>

        {/* Playhead */}
        <div
          style={{ left: `${playheadPct}%` }}
          className="absolute top-0 bottom-0 w-0.5 bg-white z-30 pointer-events-none"
        >
          <div className="w-2.5 h-2.5 -ml-1 bg-white rounded-sm shadow" />
        </div>
      </div>
    </div>
  );
}
