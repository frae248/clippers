import type {
  AspectRatio,
  CaptionPresetId,
  ExportResolution,
  SubtitlePosition,
  WordTiming,
} from './types.ts';

export interface AssOptions {
  preset: CaptionPresetId;
  aspectRatio: AspectRatio;
  exportResolution: ExportResolution;
  fontFamily: string;
  fontSize: number;
  highlightColor: string;
  subtitlePosition: SubtitlePosition;
  bgOpacity: number;
  outlineWidth: number;
  clipStart: number;
  clipEnd: number;
  transcript: string;
  wordTimings: WordTiming[];
}

export function getTargetDimensions(
  aspectRatio: AspectRatio,
  resolution: ExportResolution
): { width: number; height: number } {
  const is1080 = resolution === '1080p';
  switch (aspectRatio) {
    case '9:16':
      return is1080 ? { width: 1080, height: 1920 } : { width: 720, height: 1280 };
    case '16:9':
      return is1080 ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
    case '1:1':
      return is1080 ? { width: 1080, height: 1080 } : { width: 720, height: 720 };
    case '4:5':
      return is1080 ? { width: 1080, height: 1350 } : { width: 720, height: 900 };
    default:
      return is1080 ? { width: 1080, height: 1920 } : { width: 720, height: 1280 };
  }
}

function hexToAssColor(hex: string, alphaZeroToOne = 1): string {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, 'F').slice(0, 6);
  const r = full.slice(0, 2).toUpperCase();
  const g = full.slice(2, 4).toUpperCase();
  const b = full.slice(4, 6).toUpperCase();
  // ASS alpha: 00 = opaque, FF = transparent
  const alphaByte = Math.round((1 - Math.max(0, Math.min(1, alphaZeroToOne))) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  return `&H${alphaByte}${b}${g}${r}`;
}

function formatAssTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const cs = Math.floor((clamped - Math.floor(clamped)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function escapeAssText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
}

function mapPositionToAlignmentAndMargin(
  position: SubtitlePosition,
  playResY: number
): { alignment: number; marginV: number } {
  switch (position) {
    case 'top':
      return { alignment: 8, marginV: Math.round(playResY * 0.12) };
    case 'center':
      return { alignment: 5, marginV: 0 };
    case 'lower-middle':
      return { alignment: 2, marginV: Math.round(playResY * 0.24) };
    case 'bottom':
    default:
      return { alignment: 2, marginV: Math.round(playResY * 0.1) };
  }
}

export function buildFallbackWordTimings(
  transcript: string,
  clipStart: number,
  clipEnd: number
): WordTiming[] {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const total = Math.max(0.5, clipEnd - clipStart);
  const step = total / words.length;
  return words.map((word, idx) => ({
    word,
    start: Number((clipStart + idx * step).toFixed(3)),
    end: Number((clipStart + (idx + 1) * step).toFixed(3)),
  }));
}

export function generateAssSubtitleContent(opts: AssOptions): string {
  const { width: playResX, height: playResY } = getTargetDimensions(
    opts.aspectRatio,
    opts.exportResolution
  );
  const scaleFactor = playResY / 1920;
  const scaledFontSize = Math.max(24, Math.round(opts.fontSize * Math.max(0.65, scaleFactor)));

  const { alignment, marginV } = mapPositionToAlignmentAndMargin(
    opts.subtitlePosition,
    playResY
  );

  const isUppercase = opts.preset === 'HORMOZI';
  const maxWordsPerPhrase =
    opts.preset === 'HORMOZI' ? 3 : opts.preset === 'PODCAST' ? 7 : 5;

  let highlightHex = opts.highlightColor || '#8B5CF6';
  if (opts.preset === 'DARK STORY' && !opts.highlightColor) {
    highlightHex = '#D4AF37';
  } else if (opts.preset === 'MINIMAL') {
    highlightHex = '#FFFFFF';
  }

  const primaryAss = hexToAssColor('#FFFFFF', 1);
  const highlightAss = hexToAssColor(highlightHex, 1);
  const outlineAss = hexToAssColor('#090909', 0.95);
  const backAss = hexToAssColor('#090909', opts.bgOpacity > 0 ? opts.bgOpacity : 0.65);

  const borderStyle = opts.bgOpacity > 0.05 ? 3 : 1;
  const outlineWidth = Math.max(0, Math.min(8, opts.outlineWidth));
  const shadow = opts.preset === 'MINIMAL' ? 1 : 2;
  const bold = opts.preset === 'MINIMAL' ? 0 : -1;

  const usableFont = opts.fontFamily || 'Liberation Sans';
  const marginH = Math.round(playResX * 0.08);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${usableFont},${scaledFontSize},${primaryAss},${highlightAss},${outlineAss},${backAss},${bold},0,0,0,100,100,0,0,${borderStyle},${outlineWidth},${shadow},${alignment},${marginH},${marginH},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const rawWords =
    opts.wordTimings && opts.wordTimings.length > 0
      ? opts.wordTimings
      : buildFallbackWordTimings(opts.transcript, opts.clipStart, opts.clipEnd);

  // Filter words inside clip range and shift to clip-relative time
  const clipWords = rawWords
    .filter((w) => w.end > opts.clipStart && w.start < opts.clipEnd)
    .map((w) => ({
      word: isUppercase ? w.word.toUpperCase() : w.word,
      start: Math.max(0, w.start - opts.clipStart),
      end: Math.max(0.05, Math.min(opts.clipEnd - opts.clipStart, w.end - opts.clipStart)),
      highlight: Boolean(w.highlight),
    }));

  if (clipWords.length === 0) {
    return header;
  }

  // Group into readable phrases
  const phrases: (typeof clipWords)[] = [];
  for (let i = 0; i < clipWords.length; i += maxWordsPerPhrase) {
    phrases.push(clipWords.slice(i, i + maxWordsPerPhrase));
  }

  const events: string[] = [];

  for (let pIdx = 0; pIdx < phrases.length; pIdx++) {
    const phrase = phrases[pIdx];
    const phraseStart = phrase[0].start;
    const nextPhraseStart =
      pIdx + 1 < phrases.length ? phrases[pIdx + 1][0].start : phrase[phrase.length - 1].end;
    const phraseEnd = Math.max(phraseStart + 0.2, Math.min(nextPhraseStart, phrase[phrase.length - 1].end + 0.15));

    if (opts.preset === 'MINIMAL' || opts.preset === 'PODCAST') {
      const text = phrase.map((w) => escapeAssText(w.word)).join(' ');
      const lineText =
        opts.preset === 'PODCAST' && phrase.length >= 5
          ? `${phrase
              .slice(0, Math.ceil(phrase.length / 2))
              .map((w) => escapeAssText(w.word))
              .join(' ')}\\N${phrase
              .slice(Math.ceil(phrase.length / 2))
              .map((w) => escapeAssText(w.word))
              .join(' ')}`
          : text;

      events.push(
        `Dialogue: 0,${formatAssTime(phraseStart)},${formatAssTime(phraseEnd)},Default,,0,0,0,,{\\fad(90,90)}${lineText}`
      );
    } else {
      // Active word-by-word highlight events within the phrase
      for (let activeIdx = 0; activeIdx < phrase.length; activeIdx++) {
        const w = phrase[activeIdx];
        const segStart = w.start;
        const segEnd =
          activeIdx + 1 < phrase.length
            ? Math.max(segStart + 0.05, phrase[activeIdx + 1].start)
            : phraseEnd;

        const rendered = phrase
          .map((item, idx) => {
            const safeWord = escapeAssText(item.word);
            const isHighlighted = idx === activeIdx || item.highlight;
            if (isHighlighted) {
              if (opts.preset === 'HORMOZI') {
                return `{\\c${highlightAss}\\fscx108\\fscy108}${safeWord}{\\c${primaryAss}\\fscx100\\fscy100}`;
              }
              return `{\\c${highlightAss}}${safeWord}{\\c${primaryAss}}`;
            }
            return safeWord;
          })
          .join(' ');

        events.push(
          `Dialogue: 0,${formatAssTime(segStart)},${formatAssTime(segEnd)},Default,,0,0,0,,${rendered}`
        );
      }
    }
  }

  return header + events.join('\n') + '\n';
}
