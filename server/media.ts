import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { AUDIO_DIR, EXPORT_DIR, TMP_DIR, resolveInside } from './db.ts';
import { generateAssSubtitleContent, getTargetDimensions } from './subtitles.ts';
import type {
  AspectRatio,
  CaptionPresetId,
  ExportResolution,
  ProbeMetadata,
  SubtitlePosition,
  WordTiming,
} from './types.ts';

const execFileAsync = promisify(execFile);

export async function checkBinary(bin: 'ffmpeg' | 'ffprobe'): Promise<{
  available: boolean;
  version: string | null;
}> {
  try {
    const { stdout } = await execFileAsync(bin, ['-version'], { timeout: 5000 });
    const firstLine = stdout.split('\n')[0]?.trim() || 'available';
    return { available: true, version: firstLine };
  } catch {
    return { available: false, version: null };
  }
}

export async function probeVideoFile(filePath: string): Promise<ProbeMetadata> {
  const stat = fs.statSync(filePath);
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ],
    { timeout: 30000 }
  );

  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string; size?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      avg_frame_rate?: string;
    }>;
  };

  const videoStream = parsed.streams?.find((s) => s.codec_type === 'video');
  if (!videoStream || !videoStream.width || !videoStream.height) {
    throw new Error('No valid video stream found in uploaded media file.');
  }

  const audioStream = parsed.streams?.find((s) => s.codec_type === 'audio');
  const duration = Number(parsed.format?.duration || 0);
  const fpsRaw = videoStream.avg_frame_rate || videoStream.r_frame_rate || '30/1';
  const [numStr, denStr] = fpsRaw.split('/');
  const fpsNum = Number(numStr || 30);
  const fpsDen = Number(denStr || 1);
  const fps = fpsDen > 0 ? Number((fpsNum / fpsDen).toFixed(2)) : 30;

  return {
    duration: Number.isFinite(duration) ? Number(duration.toFixed(3)) : 0,
    width: videoStream.width,
    height: videoStream.height,
    fps,
    codec: videoStream.codec_name || 'unknown',
    hasAudio: Boolean(audioStream),
    fileSize: stat.size,
    resolution: `${videoStream.width}x${videoStream.height}`,
  };
}

export async function extractAudioForTranscription(
  videoPath: string,
  projectId: string
): Promise<string> {
  const outPath = resolveInside(AUDIO_DIR, `${projectId}.mp3`);
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-i',
      videoPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      '32k',
      '-f',
      'mp3',
      outPath,
    ],
    { timeout: 180000 }
  );
  return outPath;
}

export interface ExportClipParams {
  clipId: string;
  sourceFilePath: string;
  sourceWidth: number;
  sourceHeight: number;
  hasAudio: boolean;
  startTime: number;
  endTime: number;
  aspectRatio: AspectRatio;
  exportResolution: ExportResolution;
  cropX: number;
  cropY: number;
  zoom: number;
  burnSubtitles: boolean;
  captionPreset: CaptionPresetId;
  fontFamily: string;
  fontSize: number;
  highlightColor: string;
  subtitlePosition: SubtitlePosition;
  bgOpacity: number;
  outlineWidth: number;
  transcript: string;
  wordTimings: WordTiming[];
  darkCinematicFx: boolean;
  musicFilePath?: string | null;
  musicVolume: number;
  onProgress?: (pct: number) => void;
  registerCancel?: (cancelFn: () => void) => void;
}

export async function exportClipWithFfmpeg(params: ExportClipParams): Promise<{
  outputFilename: string;
  outputSize: number;
}> {
  const clipDuration = Math.max(0.5, params.endTime - params.startTime);
  const { width: outW, height: outH } = getTargetDimensions(
    params.aspectRatio,
    params.exportResolution
  );

  const srcW = Math.max(2, params.sourceWidth);
  const srcH = Math.max(2, params.sourceHeight);
  const targetAR = outW / outH;

  let baseCropW: number;
  let baseCropH: number;
  if (srcW / srcH > targetAR) {
    baseCropH = srcH;
    baseCropW = Math.floor(srcH * targetAR);
  } else {
    baseCropW = srcW;
    baseCropH = Math.floor(srcW / targetAR);
  }

  const safeZoom = Math.max(1.0, Math.min(2.5, params.zoom || 1.0));
  const cropW = Math.max(2, Math.floor(baseCropW / safeZoom / 2) * 2);
  const cropH = Math.max(2, Math.floor(baseCropH / safeZoom / 2) * 2);
  const maxX = Math.max(0, srcW - cropW);
  const maxY = Math.max(0, srcH - cropH);
  const cropX = Math.round(maxX * Math.max(0, Math.min(1, params.cropX)));
  const cropY = Math.round(maxY * Math.max(0, Math.min(1, params.cropY)));

  const filters: string[] = [
    `crop=w=${cropW}:h=${cropH}:x=${cropX}:y=${cropY}`,
  ];

  if (params.darkCinematicFx) {
    if (safeZoom <= 1.05) {
      filters.push(
        `scale=${outW}:${outH}:flags=lanczos`,
        `scale=w='trunc(iw*(1+0.04*min(t/${clipDuration.toFixed(2)},1))/2)*2':h='trunc(ih*(1+0.04*min(t/${clipDuration.toFixed(2)},1))/2)*2':eval=frame:flags=bilinear`,
        `crop=w=${outW}:h=${outH}:x='(iw-${outW})/2':y='(ih-${outH})/2'`,
        'setsar=1'
      );
    } else {
      filters.push(`scale=${outW}:${outH}:flags=lanczos`, 'setsar=1');
    }
    filters.push('eq=contrast=1.06:brightness=-0.01:saturation=0.94');
    filters.push('vignette=PI/5');
  } else {
    filters.push(`scale=${outW}:${outH}:flags=lanczos`, 'setsar=1');
  }

  let assPath: string | null = null;
  if (params.burnSubtitles && params.transcript.trim().length > 0) {
    const assContent = generateAssSubtitleContent({
      preset: params.captionPreset,
      aspectRatio: params.aspectRatio,
      exportResolution: params.exportResolution,
      fontFamily: params.fontFamily,
      fontSize: params.fontSize,
      highlightColor: params.highlightColor,
      subtitlePosition: params.subtitlePosition,
      bgOpacity: params.bgOpacity,
      outlineWidth: params.outlineWidth,
      clipStart: params.startTime,
      clipEnd: params.endTime,
      transcript: params.transcript,
      wordTimings: params.wordTimings,
    });
    const assFilename = `sub_${params.clipId}_${Date.now()}.ass`;
    assPath = resolveInside(TMP_DIR, assFilename);
    fs.writeFileSync(assPath, assContent, 'utf8');
    const relAssPath = path.relative(process.cwd(), assPath).replace(/\\/g, '/');
    filters.push(`ass=${relAssPath}`);
  }

  const outputFilename = `clip_${params.clipId}_${Date.now()}.mp4`;
  const outputPath = resolveInside(EXPORT_DIR, outputFilename);

  const args: string[] = [
    '-y',
    '-ss',
    params.startTime.toFixed(3),
    '-t',
    clipDuration.toFixed(3),
    '-i',
    params.sourceFilePath,
  ];

  const hasMusic = Boolean(params.musicFilePath && fs.existsSync(params.musicFilePath));
  if (hasMusic && params.musicFilePath) {
    args.push('-stream_loop', '-1', '-t', clipDuration.toFixed(3), '-i', params.musicFilePath);
  }

  const videoFilterChain = filters.join(',');

  if (hasMusic && params.hasAudio) {
    const vol = Math.max(0.02, Math.min(0.8, params.musicVolume || 0.18));
    args.push(
      '-filter_complex',
      `[0:v]${videoFilterChain}[vout];[0:a]volume=1.0[a0];[1:a]volume=${vol.toFixed(2)}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
      '-map',
      '[vout]',
      '-map',
      '[aout]'
    );
  } else if (hasMusic && !params.hasAudio) {
    const vol = Math.max(0.05, Math.min(0.8, params.musicVolume || 0.25));
    args.push(
      '-filter_complex',
      `[0:v]${videoFilterChain}[vout];[1:a]volume=${vol.toFixed(2)}[aout]`,
      '-map',
      '[vout]',
      '-map',
      '[aout]'
    );
  } else {
    args.push('-vf', videoFilterChain, '-map', '0:v');
    if (params.hasAudio) {
      args.push('-map', '0:a');
    }
  }

  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    outputPath
  );

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderrBuf = '';
      let killed = false;

      const timeout = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        reject(new Error('FFmpeg export timed out after 10 minutes.'));
      }, 10 * 60 * 1000);

      params.registerCancel?.(() => {
        killed = true;
        clearTimeout(timeout);
        child.kill('SIGTERM');
      });

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        const match = text.match(/out_time_ms=(\d+)/);
        if (match && params.onProgress) {
          const outSec = Number(match[1]) / 1_000_000;
          const pct = Math.min(99, Math.max(1, Math.round((outSec / clipDuration) * 100)));
          params.onProgress(pct);
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderrBuf = (stderrBuf + chunk.toString('utf8')).slice(-4000);
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (killed) {
          reject(new Error('Export job cancelled.'));
          return;
        }
        if (code !== 0) {
          reject(new Error(`FFmpeg render failed (code ${code}): ${stderrBuf.slice(-400)}`));
          return;
        }
        resolve();
      });
    });

    const stat = fs.statSync(outputPath);
    return { outputFilename, outputSize: stat.size };
  } finally {
    if (assPath && fs.existsSync(assPath)) {
      fs.unlinkSync(assPath);
    }
  }
}
