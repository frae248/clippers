import type { AspectRatio, CaptionPresetId, SubtitlePosition } from '../types';

export interface CaptionPresetConfig {
  id: CaptionPresetId;
  name: string;
  description: string;
  defaultHighlightColor: string;
  defaultPosition: SubtitlePosition;
  defaultFontSize: number;
  defaultOutline: number;
  defaultBgOpacity: number;
  uppercase: boolean;
  darkCinematicFx: boolean;
  sampleWords: Array<{ text: string; highlight?: boolean }>;
}

export const CAPTION_PRESETS: CaptionPresetConfig[] = [
  {
    id: 'CINEMATIC',
    name: 'Cinematic',
    description: 'Bold white typography with electric violet keyword emphasis and lower-middle balance.',
    defaultHighlightColor: '#8B5CF6',
    defaultPosition: 'lower-middle',
    defaultFontSize: 52,
    defaultOutline: 3,
    defaultBgOpacity: 0,
    uppercase: false,
    darkCinematicFx: false,
    sampleWords: [
      { text: 'Consistency' },
      { text: 'outlasts' },
      { text: 'intensity', highlight: true },
      { text: 'every' },
      { text: 'single' },
      { text: 'time.' },
    ],
  },
  {
    id: 'HORMOZI',
    name: 'Hormozi',
    description: 'High-contrast uppercase punchy phrases centered for maximum mobile retention.',
    defaultHighlightColor: '#FACC15',
    defaultPosition: 'center',
    defaultFontSize: 60,
    defaultOutline: 4,
    defaultBgOpacity: 0,
    uppercase: true,
    darkCinematicFx: false,
    sampleWords: [
      { text: 'STOP' },
      { text: 'WAITING' },
      { text: 'FOR' },
      { text: 'PERMISSION', highlight: true },
    ],
  },
  {
    id: 'MINIMAL',
    name: 'Minimal',
    description: 'Refined clean white subtitles with subtle drop shadow and zero visual clutter.',
    defaultHighlightColor: '#FFFFFF',
    defaultPosition: 'bottom',
    defaultFontSize: 44,
    defaultOutline: 2,
    defaultBgOpacity: 0,
    uppercase: false,
    darkCinematicFx: false,
    sampleWords: [
      { text: 'The' },
      { text: 'quietest' },
      { text: 'moment' },
      { text: 'changed' },
      { text: 'everything.' },
    ],
  },
  {
    id: 'PODCAST',
    name: 'Podcast',
    description: 'Clean two-line speaker-focused captions tailored for conversational clarity.',
    defaultHighlightColor: '#8B5CF6',
    defaultPosition: 'lower-middle',
    defaultFontSize: 48,
    defaultOutline: 2,
    defaultBgOpacity: 0.45,
    uppercase: false,
    darkCinematicFx: false,
    sampleWords: [
      { text: 'When' },
      { text: 'you' },
      { text: 'actually' },
      { text: 'listen,', highlight: true },
      { text: 'the' },
      { text: 'answer' },
      { text: 'shows' },
      { text: 'up.' },
    ],
  },
  {
    id: 'DARK STORY',
    name: 'Dark Story',
    description: 'White editorial captions paired with muted gold highlights and moody pacing.',
    defaultHighlightColor: '#D4AF37',
    defaultPosition: 'lower-middle',
    defaultFontSize: 50,
    defaultOutline: 3,
    defaultBgOpacity: 0,
    uppercase: false,
    darkCinematicFx: false,
    sampleWords: [
      { text: 'Nobody' },
      { text: 'saw' },
      { text: 'the' },
      { text: 'sacrifices', highlight: true },
      { text: 'behind' },
      { text: 'closed' },
      { text: 'doors.' },
    ],
  },
  {
    id: 'DARK CINEMATIC',
    name: 'Dark Cinematic',
    description:
      'Signature 9:16 relationship podcast preset: 1080x1920, subtle vignette, contrast curve, slow zoom, and gold/violet highlights.',
    defaultHighlightColor: '#D4AF37',
    defaultPosition: 'lower-middle',
    defaultFontSize: 54,
    defaultOutline: 3,
    defaultBgOpacity: 0,
    uppercase: false,
    darkCinematicFx: true,
    sampleWords: [
      { text: 'Real' },
      { text: 'loyalty', highlight: true },
      { text: 'is' },
      { text: 'measured' },
      { text: 'in' },
      { text: 'hard' },
      { text: 'seasons.' },
    ],
  },
];

export const ASPECT_RATIO_OPTIONS: Array<{
  id: AspectRatio;
  label: string;
  detail: string;
}> = [
  { id: '9:16', label: '9:16 Vertical', detail: 'TikTok, Reels, Shorts' },
  { id: '16:9', label: '16:9 Landscape', detail: 'YouTube, X, LinkedIn' },
  { id: '1:1', label: '1:1 Square', detail: 'Feeds & Carousels' },
  { id: '4:5', label: '4:5 Portrait', detail: 'Instagram & Facebook' },
];

export const CONTENT_STYLES = [
  'Balanced',
  'Podcast highlights',
  'Relationship',
  'Motivational',
  'Faith',
  'Emotional',
  'Viral hook',
  'Educational',
  'Funny',
];

export function formatTimecode(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe - Math.floor(safe)) * 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return 'Unavailable';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
