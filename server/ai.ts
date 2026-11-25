import fs from 'node:fs';
import { GoogleGenAI, Type } from '@google/genai';
import type { TranscriptSegment, WordTiming } from './types.ts';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Add it in Settings > Secrets to enable AI transcription and clip detection.'
    );
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

export async function transcribeAudioWithGemini(
  audioPath: string,
  durationSec: number
): Promise<TranscriptSegment[]> {
  const ai = getGeminiClient();
  const stat = fs.statSync(audioPath);

  let audioContentPart:
    | { inlineData: { mimeType: string; data: string } }
    | { fileData: { mimeType: string; fileUri: string } };
  let uploadedFileName: string | null = null;

  if (stat.size <= 16 * 1024 * 1024) {
    const base64 = fs.readFileSync(audioPath).toString('base64');
    audioContentPart = {
      inlineData: {
        mimeType: 'audio/mp3',
        data: base64,
      },
    };
  } else {
    const uploaded = await ai.files.upload({
      file: audioPath,
      config: { mimeType: 'audio/mp3' },
    });
    uploadedFileName = uploaded.name || null;
    if (!uploaded.uri) {
      throw new Error('Failed to upload extracted audio to Gemini Files API.');
    }
    audioContentPart = {
      fileData: {
        mimeType: 'audio/mp3',
        fileUri: uploaded.uri,
      },
    };
  }

  try {
    // Step 1: Verbatim speech transcription via gemini-3.5-transcribe
    let verbatimText = '';
    try {
      const transcribeResp = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            audioContentPart,
            { text: 'Transcribe all spoken words verbatim with proper punctuation.' },
          ],
        },
      });
      verbatimText = (transcribeResp.text || '').trim();
    } catch {
      // Fallback directly to audio-grounded alignment below if transcribe model is unavailable
      verbatimText = '';
    }

    // Step 2: Audio-grounded timestamp alignment via gemini-4-hydrogen
    const alignmentPrompt = verbatimText
      ? `Listen carefully to the attached audio (total duration ${durationSec.toFixed(1)}s) and align the verbatim transcript below into accurate timestamped speech segments.
Do NOT invent words that are not spoken in the audio. Use exact seconds from 0 to ${durationSec.toFixed(1)}.
Split into natural sentences or 4-12 second segments, and include word-level timestamps when possible.

Verbatim transcript reference:
${verbatimText}`
      : `Transcribe the attached audio (total duration ${durationSec.toFixed(1)}s) verbatim into accurate timestamped speech segments with exact punctuation.
Do NOT invent words that are not spoken in the audio. Use exact seconds from 0 to ${durationSec.toFixed(1)}.`;

    const alignedResp = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [audioContentPart, { text: alignmentPrompt }],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              start: { type: Type.NUMBER, description: 'Start time in seconds' },
              end: { type: Type.NUMBER, description: 'End time in seconds' },
              text: { type: Type.STRING, description: 'Verbatim spoken text in this segment' },
              words: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    word: { type: Type.STRING },
                    start: { type: Type.NUMBER },
                    end: { type: Type.NUMBER },
                  },
                  required: ['word', 'start', 'end'],
                },
              },
            },
            required: ['start', 'end', 'text'],
          },
        },
      },
    });

    const rawJson = (alignedResp.text || '[]').trim();
    const parsed = JSON.parse(rawJson) as TranscriptSegment[];

    const normalized = parsed
      .filter((s) => s.text && s.text.trim().length > 0)
      .map((s) => {
        const start = Math.max(0, Math.min(durationSec, Number(s.start) || 0));
        const end = Math.max(start + 0.2, Math.min(durationSec, Number(s.end) || start + 2));
        const words: WordTiming[] =
          s.words && s.words.length > 0
            ? s.words.map((w) => ({
                word: w.word,
                start: Math.max(start, Math.min(end, Number(w.start) || start)),
                end: Math.max(start, Math.min(end, Number(w.end) || end)),
              }))
            : distributeWordsEvenly(s.text, start, end);
        return { start, end, text: s.text.trim(), words };
      })
      .sort((a, b) => a.start - b.start);

    if (normalized.length === 0) {
      throw new Error('No speech could be transcribed from this video audio track.');
    }
    return normalized;
  } finally {
    if (uploadedFileName) {
      try {
        await ai.files.delete({ name: uploadedFileName });
      } catch {
        // Ignore cleanup failure
      }
    }
  }
}

function distributeWordsEvenly(text: string, start: number, end: number): WordTiming[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const step = (end - start) / tokens.length;
  return tokens.map((word, idx) => ({
    word,
    start: Number((start + idx * step).toFixed(3)),
    end: Number((start + (idx + 1) * step).toFixed(3)),
  }));
}

export interface ClipSelectionOptions {
  minDuration: number;
  maxDuration: number;
  clipCount: number;
  contentStyle: string;
}

export interface SelectedClipCandidate {
  title: string;
  hook: string;
  category: string;
  start_time: number;
  end_time: number;
  ai_score: number;
  reason: string;
  transcript: string;
  word_timings: WordTiming[];
}

export interface ClipSelectionResult {
  summary: string;
  clips: SelectedClipCandidate[];
}

export async function selectViralClipsWithSummary(
  segments: TranscriptSegment[],
  durationSec: number,
  options: ClipSelectionOptions
): Promise<ClipSelectionResult> {
  const ai = getGeminiClient();

  const effectiveDuration =
    durationSec > 0
      ? durationSec
      : segments.length > 0
        ? Math.max(...segments.map((s) => s.end))
        : 60;

  const formattedTranscript = segments
    .map((s) => `[${s.start.toFixed(2)}s - ${s.end.toFixed(2)}s] ${s.text}`)
    .join('\n');

  const safeMin = Math.max(5, Math.min(effectiveDuration, options.minDuration));
  const safeMax = Math.max(safeMin + 2, Math.min(effectiveDuration, options.maxDuration));
  const targetCount = Math.max(1, Math.min(15, options.clipCount));

  const prompt = `Analyze the following timestamped transcript from a ${effectiveDuration.toFixed(
    1
  )}-second video and identify the top ${targetCount} standalone short-form clips ranked from highest engagement potential to lowest.

Preferences:
- Target clip duration: ${safeMin}s to ${safeMax}s (if total video is shorter, use the strongest complete segment)
- Editorial style focus: ${options.contentStyle}

High-priority viral moment categories to detect:
- Emotional relationship moments
- Heartbreak conversations
- Dating advice
- Cheating discussions
- Red flags & Green flags
- Powerful opinions & Controversial statements
- Funny conversations
- Motivational moments
- Interesting stories & Unexpected revelations

Strict editorial rules:
1. Prioritize moments that make complete sense on their own for TikTok, Instagram Reels, and YouTube Shorts.
2. Start at the beginning of a complete sentence/thought with an attention-grabbing opening hook.
3. End cleanly at the conclusion of a thought — never cut off mid-sentence.
4. Avoid dead air or weak transitions.
5. Clips must NOT overlap each other.
6. Only use exact timestamps present in the transcript. NEVER invent dialogue or timestamps.

Timestamped Transcript:
${formattedTranscript}`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'You are a senior short-form podcast and relationship clip editor. Identify the highest-impact standalone moments from the transcript without inventing any dialogue or timestamps.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: {
            type: Type.STRING,
            description: 'Concise 2-sentence overview of the strongest themes and clip potential in this video',
          },
          clips: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING, description: 'Concise editorial title for the clip' },
                hook: { type: Type.STRING, description: 'Compelling opening hook line or framing' },
                category: {
                  type: Type.STRING,
                  description:
                    'Category such as Emotional, Heartbreak, Dating advice, Cheating, Red flags, Green flags, Powerful opinion, Controversial, Funny, Motivational, Story, Revelation',
                },
                start_time: { type: Type.NUMBER, description: 'Start timestamp in seconds' },
                end_time: { type: Type.NUMBER, description: 'End timestamp in seconds' },
                ai_score: { type: Type.NUMBER, description: 'Engagement potential score 1 to 100' },
                reason: { type: Type.STRING, description: 'Reason why this moment performs well as a short clip' },
              },
              required: ['title', 'hook', 'category', 'start_time', 'end_time', 'ai_score', 'reason'],
            },
          },
        },
        required: ['summary', 'clips'],
      },
    },
  });

  const parsed = JSON.parse((response.text || '{}').trim()) as {
    summary?: string;
    clips?: Array<{
      title: string;
      hook: string;
      category: string;
      start_time: number;
      end_time: number;
      ai_score: number;
      reason: string;
    }>;
  };

  const candidates = Array.isArray(parsed.clips) ? parsed.clips : [];

  // Ground each candidate's transcript & word timings strictly in the real transcript segments
  const results: SelectedClipCandidate[] = [];
  for (const item of candidates.slice(0, targetCount)) {
    const start = Math.max(0, Math.min(effectiveDuration - 1, Number(item.start_time) || 0));
    const end = Math.max(start + 1, Math.min(effectiveDuration, Number(item.end_time) || effectiveDuration));

    const overlappingSegments = segments.filter(
      (seg) => seg.end > start + 0.1 && seg.start < end - 0.1
    );
    const actualStart =
      overlappingSegments.length > 0 ? Math.min(start, overlappingSegments[0].start) : start;
    const actualEnd =
      overlappingSegments.length > 0
        ? Math.max(end, overlappingSegments[overlappingSegments.length - 1].end)
        : end;

    const realTranscript = overlappingSegments.map((s) => s.text).join(' ').trim();
    const realWords: WordTiming[] = overlappingSegments.flatMap((s) => s.words || []);

    if (!realTranscript) continue;

    // Prevent overlaps with already accepted clips
    const overlapsExisting = results.some(
      (r) => actualStart < r.end_time - 0.5 && actualEnd > r.start_time + 0.5
    );
    if (overlapsExisting) continue;

    results.push({
      title: item.title.slice(0, 120),
      hook: item.hook.slice(0, 240),
      category: item.category || options.contentStyle,
      start_time: Number(actualStart.toFixed(2)),
      end_time: Number(actualEnd.toFixed(2)),
      ai_score: Math.max(1, Math.min(100, Math.round(Number(item.ai_score) || 80))),
      reason: item.reason,
      transcript: realTranscript,
      word_timings: realWords,
    });
  }

  results.sort((a, b) => b.ai_score - a.ai_score);

  return {
    summary: (parsed.summary || '').trim().slice(0, 600),
    clips: results,
  };
}

export async function selectClipsFromTranscript(
  segments: TranscriptSegment[],
  durationSec: number,
  options: ClipSelectionOptions
): Promise<SelectedClipCandidate[]> {
  const { clips } = await selectViralClipsWithSummary(segments, durationSec, options);
  return clips;
}
