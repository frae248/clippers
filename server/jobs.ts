import crypto from 'node:crypto';
import fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import {
  selectClipsFromTranscript,
  selectViralClipsWithSummary,
  transcribeAudioWithGemini,
} from './ai.ts';
import { EXPORT_DIR, MUSIC_DIR, UPLOAD_DIR, db, resolveInside } from './db.ts';
import {
  exportClipWithFfmpeg,
  extractAudioForTranscription,
  probeVideoFile,
} from './media.ts';
import type {
  AspectRatio,
  CaptionPresetId,
  ClipRow,
  ExportResolution,
  JobStatus,
  ProcessingJobRow,
  ProjectRow,
  SubtitlePosition,
  TranscriptSegment,
  UserSettingsRow,
  WordTiming,
} from './types.ts';

interface QueueTask {
  jobId: string;
  run: () => Promise<void>;
  cancel?: () => void;
}

const activeTasks = new Map<string, QueueTask>();
const pendingQueue: QueueTask[] = [];
function parsePositiveIntEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const normalized = raw.includes('=') ? raw.split('=').pop()!.trim() : raw.trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const MAX_CONCURRENCY = parsePositiveIntEnv(process.env.WORKER_CONCURRENCY, 2);

function appendJobLog(jobId: string, line: string): void {
  const existing = db
    .prepare(`SELECT logs FROM processing_jobs WHERE id = ?`)
    .get(jobId) as { logs: string | null } | undefined;
  const timestamp = new Date().toISOString();
  const nextLogs = `${existing?.logs ? existing.logs + '\n' : ''}[${timestamp}] ${line}`.slice(
    -8000
  );
  db.prepare(`UPDATE processing_jobs SET logs = ? WHERE id = ?`).run(nextLogs, jobId);
}

function updateJobState(
  jobId: string,
  status: JobStatus,
  progress: number | null,
  stageLabel: string,
  errorMessage: string | null = null
): void {
  const completedAt = ['Completed', 'Failed', 'Cancelled'].includes(status)
    ? new Date().toISOString()
    : null;
  db.prepare(
    `UPDATE processing_jobs
     SET status = ?, progress = ?, stage_label = ?, error_message = ?, completed_at = ?
     WHERE id = ?`
  ).run(status, progress, stageLabel, errorMessage, completedAt, jobId);
  appendJobLog(jobId, `${status}: ${stageLabel}${errorMessage ? ' — ' + errorMessage : ''}`);
}

function pumpQueue(): void {
  while (activeTasks.size < MAX_CONCURRENCY && pendingQueue.length > 0) {
    const task = pendingQueue.shift();
    if (!task) break;
    const job = db
      .prepare(`SELECT status FROM processing_jobs WHERE id = ?`)
      .get(task.jobId) as { status: JobStatus } | undefined;
    if (!job || job.status === 'Cancelled') continue;

    activeTasks.set(task.jobId, task);
    task
      .run()
      .catch((err) => {
        console.error(`Job ${task.jobId} error:`, err);
      })
      .finally(() => {
        activeTasks.delete(task.jobId);
        pumpQueue();
      });
  }
}

export function getQueueStats(): { active: number; queued: number; concurrency: number } {
  return {
    active: activeTasks.size,
    queued: pendingQueue.length,
    concurrency: MAX_CONCURRENCY,
  };
}

export function cancelProcessingJob(jobId: string, userId: string): ProcessingJobRow | null {
  const job = db
    .prepare(`SELECT * FROM processing_jobs WHERE id = ? AND user_id = ?`)
    .get(jobId, userId) as ProcessingJobRow | undefined;
  if (!job) return null;

  const active = activeTasks.get(jobId);
  if (active?.cancel) {
    active.cancel();
  }
  updateJobState(jobId, 'Cancelled', null, 'Cancelled by user');

  if (job.job_type === 'export' && job.clip_id) {
    db.prepare(`UPDATE clips SET status = 'Cancelled' WHERE id = ?`).run(job.clip_id);
  } else if (job.job_type === 'analyze' || job.job_type === 'youtube_analyze') {
    db.prepare(`UPDATE projects SET status = 'Cancelled', updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      job.project_id
    );
  }

  return db
    .prepare(`SELECT * FROM processing_jobs WHERE id = ?`)
    .get(jobId) as unknown as ProcessingJobRow;
}

export function enqueueAnalyzeJob(
  userId: string,
  projectId: string,
  options: {
    minDuration: number;
    maxDuration: number;
    clipCount: number;
    contentStyle: string;
  }
): ProcessingJobRow {
  const jobId = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO processing_jobs (id, user_id, project_id, clip_id, job_type, status, progress, stage_label, logs, created_at)
     VALUES (?, ?, ?, NULL, 'analyze', 'Queued', NULL, 'Queued for AI video analysis', ?, ?)`
  ).run(jobId, userId, projectId, `[${now}] Queued analysis job`, now);

  db.prepare(`UPDATE projects SET status = 'Queued', error_message = NULL, updated_at = ? WHERE id = ?`).run(
    now,
    projectId
  );

  const task: QueueTask = {
    jobId,
    run: async () => {
      let cancelled = false;
      task.cancel = () => {
        cancelled = true;
      };

      const throwIfCancelled = () => {
        if (cancelled) throw new Error('Job cancelled by user');
      };

      try {
        const project = db
          .prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`)
          .get(projectId, userId) as ProjectRow | undefined;
        if (!project || !project.source_file) {
          throw new Error('Source video file not found for this project.');
        }

        const sourcePath = resolveInside(UPLOAD_DIR, project.source_file);
        if (!fs.existsSync(sourcePath)) {
          throw new Error('Source video file is missing from storage.');
        }

        // Step 1: Inspect with FFprobe
        throwIfCancelled();
        updateJobState(jobId, 'Inspecting', null, 'Inspecting media streams with FFprobe');
        db.prepare(`UPDATE projects SET status = 'Inspecting', updated_at = ? WHERE id = ?`).run(
          new Date().toISOString(),
          projectId
        );
        const probe = await probeVideoFile(sourcePath);

        db.prepare(
          `UPDATE projects
           SET duration = ?, width = ?, height = ?, fps = ?, codec = ?, has_audio = ?, file_size = ?, resolution = ?, updated_at = ?
           WHERE id = ?`
        ).run(
          probe.duration,
          probe.width,
          probe.height,
          probe.fps,
          probe.codec,
          probe.hasAudio ? 1 : 0,
          probe.fileSize,
          probe.resolution,
          new Date().toISOString(),
          projectId
        );

        if (!probe.hasAudio) {
          throw new Error(
            'This video has no audio track. Speech transcription requires spoken audio.'
          );
        }

        // Step 2: Extract audio & transcribe
        throwIfCancelled();
        updateJobState(
          jobId,
          'Transcribing',
          null,
          'Extracting audio track and transcribing speech'
        );
        db.prepare(`UPDATE projects SET status = 'Transcribing', updated_at = ? WHERE id = ?`).run(
          new Date().toISOString(),
          projectId
        );

        const audioPath = await extractAudioForTranscription(sourcePath, projectId);
        let segments: TranscriptSegment[] = [];

        if (project.transcript_json) {
          try {
            const cached = JSON.parse(project.transcript_json) as TranscriptSegment[];
            if (Array.isArray(cached) && cached.length > 0) {
              segments = cached;
            }
          } catch {
            segments = [];
          }
        }

        if (segments.length === 0) {
          segments = await transcribeAudioWithGemini(audioPath, probe.duration);
          db.prepare(
            `UPDATE projects SET audio_file = ?, transcript_json = ?, updated_at = ? WHERE id = ?`
          ).run(
            `${projectId}.mp3`,
            JSON.stringify(segments),
            new Date().toISOString(),
            projectId
          );
        }

        // Step 3: Analyze transcript for clip moments
        throwIfCancelled();
        updateJobState(
          jobId,
          'Analyzing',
          null,
          'Analyzing transcript for standalone high-retention moments'
        );
        db.prepare(`UPDATE projects SET status = 'Analyzing', updated_at = ? WHERE id = ?`).run(
          new Date().toISOString(),
          projectId
        );

        const candidates = await selectClipsFromTranscript(segments, probe.duration, options);

        // Step 4: Save clips using user default settings
        throwIfCancelled();
        updateJobState(
          jobId,
          'Selecting clips',
          null,
          `Creating ${candidates.length} editable clips`
        );
        db.prepare(`UPDATE projects SET status = 'Selecting clips', updated_at = ? WHERE id = ?`).run(
          new Date().toISOString(),
          projectId
        );

        const settings = db
          .prepare(`SELECT * FROM user_settings WHERE user_id = ?`)
          .get(userId) as UserSettingsRow | undefined;

        const defaultPreset: CaptionPresetId = settings?.default_caption_style || 'DARK CINEMATIC';
        const defaultRatio: AspectRatio = settings?.default_aspect_ratio || '9:16';
        const defaultRes: ExportResolution = settings?.export_resolution || '1080p';
        const isDarkCinematic = defaultPreset === 'DARK CINEMATIC';

        const insertClip = db.prepare(
          `INSERT INTO clips (
            id, project_id, user_id, title, hook, reason, start_time, end_time,
            transcript, word_timings_json, category, ai_score, is_selected, clip_index,
            caption_preset, aspect_ratio, crop_x, crop_y, zoom, font_family, font_size,
            highlight_color, subtitle_position, bg_opacity, outline_width,
            burn_subtitles, export_resolution, dark_cinematic_fx, music_volume,
            status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0.5, 0.42, 1.0, ?, ?, ?, ?, 0.0, 3, 1, ?, ?, 0.18, 'Completed', ?)`
        );

        const createdAt = new Date().toISOString();
        candidates.forEach((c, idx) => {
          insertClip.run(
            crypto.randomUUID(),
            projectId,
            userId,
            c.title,
            c.hook,
            c.reason,
            c.start_time,
            c.end_time,
            c.transcript,
            JSON.stringify(c.word_timings),
            c.category,
            c.ai_score,
            idx + 1,
            defaultPreset,
            defaultRatio,
            'Liberation Sans',
            defaultPreset === 'HORMOZI' ? 62 : defaultPreset === 'DARK CINEMATIC' ? 54 : 52,
            defaultPreset === 'DARK STORY' || defaultPreset === 'DARK CINEMATIC' ? '#D4AF37' : '#8B5CF6',
            defaultPreset === 'HORMOZI' ? 'center' : 'lower-middle',
            defaultRes,
            isDarkCinematic ? 1 : 0,
            createdAt
          );
        });

        db.prepare(
          `UPDATE projects SET status = 'Completed', error_message = NULL, updated_at = ? WHERE id = ?`
        ).run(new Date().toISOString(), projectId);
        updateJobState(
          jobId,
          'Completed',
          100,
          `Analysis complete — ${candidates.length} clips generated`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unexpected analysis error';
        const status: JobStatus = cancelled ? 'Cancelled' : 'Failed';
        updateJobState(jobId, status, null, status === 'Cancelled' ? 'Cancelled' : 'Analysis failed', msg);
        db.prepare(
          `UPDATE projects SET status = ?, error_message = ?, updated_at = ? WHERE id = ?`
        ).run(status, msg, new Date().toISOString(), projectId);
      }
    },
  };

  pendingQueue.push(task);
  pumpQueue();

  return db
    .prepare(`SELECT * FROM processing_jobs WHERE id = ?`)
    .get(jobId) as unknown as ProcessingJobRow;
}

export function enqueueYouTubeAnalyzeJob(
  userId: string,
  projectId: string,
  options: {
    minDuration: number;
    maxDuration: number;
    clipCount: number;
    contentStyle: string;
    preset?: CaptionPresetId;
    autoRenderWhenReady?: boolean;
  }
): ProcessingJobRow {
  const jobId = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO processing_jobs (id, user_id, project_id, clip_id, job_type, status, progress, stage_label, logs, created_at)
     VALUES (?, ?, ?, NULL, 'youtube_analyze', 'Queued', 5, 'Validating YouTube URL', ?, ?)`
  ).run(jobId, userId, projectId, `[${now}] Queued YouTube viral moment analysis`, now);

  db.prepare(
    `UPDATE projects SET status = 'Validating YouTube URL', error_message = NULL, updated_at = ? WHERE id = ?`
  ).run(now, projectId);

  const task: QueueTask = {
    jobId,
    run: async () => {
      let cancelled = false;
      task.cancel = () => {
        cancelled = true;
      };
      const throwIfCancelled = () => {
        if (cancelled) throw new Error('Job cancelled by user');
      };

      const setStage = (status: JobStatus, progress: number, label: string) => {
        updateJobState(jobId, status, progress, label);
        db.prepare(`UPDATE projects SET status = ?, updated_at = ? WHERE id = ?`).run(
          status,
          new Date().toISOString(),
          projectId
        );
      };

      try {
        const project = db
          .prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`)
          .get(projectId, userId) as ProjectRow | undefined;
        if (!project) {
          throw new Error('YouTube project not found.');
        }

        throwIfCancelled();
        setStage('Fetching video information', 18, 'Video metadata verified');

        let segments: TranscriptSegment[] = [];
        if (project.transcript_json) {
          try {
            const parsed = JSON.parse(project.transcript_json) as TranscriptSegment[];
            if (Array.isArray(parsed) && parsed.length > 0) {
              segments = parsed;
            }
          } catch {
            segments = [];
          }
        }

        let effectiveDuration = project.duration || 0;

        if (segments.length > 0) {
          throwIfCancelled();
          setStage(
            'Retrieving available captions',
            35,
            `Loaded ${segments.length} authorized transcript segments`
          );
          if (effectiveDuration <= 0) {
            effectiveDuration = Math.max(...segments.map((s) => s.end), 60);
          }
        } else if (project.source_file) {
          throwIfCancelled();
          const sourcePath = resolveInside(UPLOAD_DIR, project.source_file);
          if (!fs.existsSync(sourcePath)) {
            throw new Error('Uploaded source video file is missing from storage.');
          }
          const probe = await probeVideoFile(sourcePath);
          effectiveDuration = probe.duration;
          db.prepare(
            `UPDATE projects
             SET duration = ?, width = ?, height = ?, fps = ?, codec = ?, has_audio = ?, file_size = ?, resolution = ?, updated_at = ?
             WHERE id = ?`
          ).run(
            probe.duration,
            probe.width,
            probe.height,
            probe.fps,
            probe.codec,
            probe.hasAudio ? 1 : 0,
            probe.fileSize,
            probe.resolution,
            new Date().toISOString(),
            projectId
          );

          if (!probe.hasAudio) {
            throw new Error('Uploaded source video has no audio track for speech transcription.');
          }

          setStage(
            'Transcribing authorized source',
            40,
            'Extracting audio and transcribing spoken words with Gemini'
          );
          const audioPath = await extractAudioForTranscription(sourcePath, projectId);
          segments = await transcribeAudioWithGemini(audioPath, probe.duration);
          db.prepare(
            `UPDATE projects SET audio_file = ?, transcript_json = ?, transcript_source = 'uploaded_audio', updated_at = ? WHERE id = ?`
          ).run(`${projectId}.mp3`, JSON.stringify(segments), new Date().toISOString(), projectId);
        } else {
          throw new Error(
            'No accessible transcript or authorized source video found. Upload an .srt/.vtt transcript, paste timestamped captions, or upload your source video file.'
          );
        }

        throwIfCancelled();
        setStage('Analyzing transcript', 58, 'Analyzing dialogue arcs and emotional hooks');

        throwIfCancelled();
        setStage('Finding viral moments', 74, 'Detecting top 10 short-form candidate clips');

        const { summary, clips: candidates } = await selectViralClipsWithSummary(
          segments,
          effectiveDuration,
          options
        );

        throwIfCancelled();
        setStage(
          'Preparing clip suggestions',
          90,
          `Saving ${candidates.length} ranked viral clip suggestions`
        );

        // Replace previous AI-generated unrendered suggestions if re-analyzing while preserving any already-exported clips
        db.prepare(
          `DELETE FROM clips WHERE project_id = ? AND user_id = ? AND output_file IS NULL`
        ).run(projectId, userId);

        const settings = db
          .prepare(`SELECT * FROM user_settings WHERE user_id = ?`)
          .get(userId) as UserSettingsRow | undefined;

        const chosenPreset: CaptionPresetId =
          options.preset || settings?.default_caption_style || 'DARK CINEMATIC';
        const chosenRatio: AspectRatio =
          chosenPreset === 'DARK CINEMATIC' ? '9:16' : settings?.default_aspect_ratio || '9:16';
        const chosenRes: ExportResolution = settings?.export_resolution || '1080p';
        const isDarkCinematic = chosenPreset === 'DARK CINEMATIC';

        const insertClip = db.prepare(
          `INSERT INTO clips (
            id, project_id, user_id, title, hook, reason, start_time, end_time,
            transcript, word_timings_json, category, ai_score, is_selected, clip_index,
            caption_preset, aspect_ratio, crop_x, crop_y, zoom, font_family, font_size,
            highlight_color, subtitle_position, bg_opacity, outline_width,
            burn_subtitles, export_resolution, dark_cinematic_fx, music_volume,
            status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0.5, 0.42, 1.0, ?, ?, ?, ?, 0.0, 3, 1, ?, ?, 0.18, 'Completed', ?)`
        );

        const createdAt = new Date().toISOString();
        const createdClipIds: string[] = [];
        candidates.forEach((c, idx) => {
          const clipId = crypto.randomUUID();
          createdClipIds.push(clipId);
          insertClip.run(
            clipId,
            projectId,
            userId,
            c.title,
            c.hook,
            c.reason,
            c.start_time,
            c.end_time,
            c.transcript,
            JSON.stringify(c.word_timings),
            c.category,
            c.ai_score,
            idx + 1,
            chosenPreset,
            chosenRatio,
            'Liberation Sans',
            chosenPreset === 'HORMOZI' ? 62 : chosenPreset === 'DARK CINEMATIC' ? 54 : 52,
            chosenPreset === 'DARK STORY' || chosenPreset === 'DARK CINEMATIC'
              ? '#D4AF37'
              : '#8B5CF6',
            chosenPreset === 'HORMOZI' ? 'center' : 'lower-middle',
            chosenRes,
            isDarkCinematic ? 1 : 0,
            createdAt
          );
        });

        const latestProject = db
          .prepare(`SELECT source_file FROM projects WHERE id = ?`)
          .get(projectId) as { source_file: string | null } | undefined;
        const hasSourceVideo = Boolean(latestProject?.source_file);

        db.prepare(
          `UPDATE projects SET ai_analysis_summary = ?, duration = ?, error_message = NULL, updated_at = ? WHERE id = ?`
        ).run(summary || null, effectiveDuration, new Date().toISOString(), projectId);

        if (!hasSourceVideo) {
          db.prepare(
            `UPDATE projects SET status = 'Waiting for source video', updated_at = ? WHERE id = ?`
          ).run(new Date().toISOString(), projectId);
          updateJobState(
            jobId,
            'Completed',
            100,
            `${candidates.length} viral clip suggestions ready — waiting for authorized source video to render MP4s`
          );
        } else if (options.autoRenderWhenReady && createdClipIds.length > 0) {
          db.prepare(
            `UPDATE projects SET status = 'Rendering clips', updated_at = ? WHERE id = ?`
          ).run(new Date().toISOString(), projectId);
          updateJobState(
            jobId,
            'Completed',
            100,
            `${candidates.length} viral clips found — queuing Dark Cinematic FFmpeg MP4 renders`
          );
          for (const cid of createdClipIds) {
            enqueueExportJob(userId, cid);
          }
        } else {
          db.prepare(
            `UPDATE projects SET status = 'Completed', updated_at = ? WHERE id = ?`
          ).run(new Date().toISOString(), projectId);
          updateJobState(
            jobId,
            'Completed',
            100,
            `Analysis complete — ${candidates.length} viral clip suggestions ready`
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unexpected YouTube analysis error';
        const status: JobStatus = cancelled ? 'Cancelled' : 'Failed';
        updateJobState(
          jobId,
          status,
          null,
          status === 'Cancelled' ? 'Cancelled' : 'Analysis failed',
          msg
        );
        db.prepare(
          `UPDATE projects SET status = ?, error_message = ?, updated_at = ? WHERE id = ?`
        ).run(status, msg, new Date().toISOString(), projectId);
      }
    },
  };

  pendingQueue.push(task);
  pumpQueue();

  return db
    .prepare(`SELECT * FROM processing_jobs WHERE id = ?`)
    .get(jobId) as unknown as ProcessingJobRow;
}

export function enqueueExportJob(userId: string, clipId: string): ProcessingJobRow {
  const clip = db
    .prepare(`SELECT * FROM clips WHERE id = ? AND user_id = ?`)
    .get(clipId, userId) as ClipRow | undefined;
  if (!clip) {
    throw new Error('Clip not found.');
  }

  const jobId = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO processing_jobs (id, user_id, project_id, clip_id, job_type, status, progress, stage_label, logs, created_at)
     VALUES (?, ?, ?, ?, 'export', 'Queued', 0, 'Queued for FFmpeg MP4 render', ?, ?)`
  ).run(jobId, userId, clip.project_id, clipId, `[${now}] Queued MP4 export`, now);

  db.prepare(`UPDATE clips SET status = 'Queued' WHERE id = ?`).run(clipId);

  const task: QueueTask = {
    jobId,
    run: async () => {
      let cancelChild: (() => void) | null = null;
      let cancelled = false;
      task.cancel = () => {
        cancelled = true;
        cancelChild?.();
      };

      try {
        const currentClip = db
          .prepare(`SELECT * FROM clips WHERE id = ? AND user_id = ?`)
          .get(clipId, userId) as ClipRow | undefined;
        if (!currentClip) throw new Error('Clip record removed.');

        const project = db
          .prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`)
          .get(currentClip.project_id, userId) as ProjectRow | undefined;
        if (!project || !project.source_file) {
          throw new Error('Source video file is missing for this project.');
        }

        const sourcePath = resolveInside(UPLOAD_DIR, project.source_file);
        if (!fs.existsSync(sourcePath)) {
          throw new Error('Source video file no longer exists on disk.');
        }

        updateJobState(jobId, 'Rendering', 2, 'Rendering cropped video and subtitle burn-in');
        db.prepare(`UPDATE clips SET status = 'Rendering' WHERE id = ?`).run(clipId);

        let wordTimings: WordTiming[] = [];
        if (currentClip.word_timings_json) {
          try {
            wordTimings = JSON.parse(currentClip.word_timings_json) as WordTiming[];
          } catch {
            wordTimings = [];
          }
        }

        let musicPath: string | null = null;
        if (currentClip.music_file) {
          const candidateMusic = resolveInside(MUSIC_DIR, currentClip.music_file);
          if (fs.existsSync(candidateMusic)) musicPath = candidateMusic;
        }

        let lastPct = 2;
        const { outputFilename, outputSize } = await exportClipWithFfmpeg({
          clipId: currentClip.id,
          sourceFilePath: sourcePath,
          sourceWidth: project.width || 1920,
          sourceHeight: project.height || 1080,
          hasAudio: project.has_audio === 1,
          startTime: currentClip.start_time,
          endTime: currentClip.end_time,
          aspectRatio: currentClip.aspect_ratio as AspectRatio,
          exportResolution: currentClip.export_resolution as ExportResolution,
          cropX: currentClip.crop_x,
          cropY: currentClip.crop_y,
          zoom: currentClip.zoom,
          burnSubtitles: currentClip.burn_subtitles === 1,
          captionPreset: currentClip.caption_preset as CaptionPresetId,
          fontFamily: currentClip.font_family,
          fontSize: currentClip.font_size,
          highlightColor: currentClip.highlight_color,
          subtitlePosition: currentClip.subtitle_position as SubtitlePosition,
          bgOpacity: currentClip.bg_opacity,
          outlineWidth: currentClip.outline_width,
          transcript: currentClip.transcript,
          wordTimings,
          darkCinematicFx: currentClip.dark_cinematic_fx === 1,
          musicFilePath: musicPath,
          musicVolume: currentClip.music_volume,
          registerCancel: (fn) => {
            cancelChild = fn;
          },
          onProgress: (pct) => {
            if (pct - lastPct >= 5) {
              lastPct = pct;
              db.prepare(
                `UPDATE processing_jobs SET status = ?, progress = ?, stage_label = ? WHERE id = ?`
              ).run(
                pct > 85 ? 'Exporting' : 'Rendering',
                pct,
                pct > 85 ? 'Finalizing H.264 MP4 container' : `Encoding frames (${pct}%)`,
                jobId
              );
            }
          },
        });

        // Clean up previous exported file for this clip if replaced
        if (currentClip.output_file && currentClip.output_file !== outputFilename) {
          const oldPath = resolveInside(EXPORT_DIR, currentClip.output_file);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }

        db.prepare(
          `UPDATE clips SET output_file = ?, output_size = ?, status = 'Completed' WHERE id = ?`
        ).run(outputFilename, outputSize, clipId);

        updateJobState(jobId, 'Completed', 100, 'MP4 export ready for download');

        // If project was in 'Rendering clips' and no other export jobs remain active, mark project Completed
        const remainingActiveExports = db
          .prepare(
            `SELECT COUNT(*) as cnt FROM processing_jobs
             WHERE project_id = ? AND job_type = 'export' AND id != ?
               AND status IN ('Queued', 'Rendering', 'Exporting')`
          )
          .get(currentClip.project_id, jobId) as { cnt: number };
        if (remainingActiveExports.cnt === 0) {
          db.prepare(
            `UPDATE projects SET status = 'Completed', updated_at = ? WHERE id = ? AND status = 'Rendering clips'`
          ).run(new Date().toISOString(), currentClip.project_id);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Export failed';
        const status: JobStatus = cancelled ? 'Cancelled' : 'Failed';
        updateJobState(
          jobId,
          status,
          null,
          status === 'Cancelled' ? 'Export cancelled' : 'Export failed',
          msg
        );
        db.prepare(`UPDATE clips SET status = ? WHERE id = ?`).run(status, clipId);
      }
    },
  };

  pendingQueue.push(task);
  pumpQueue();

  return db
    .prepare(`SELECT * FROM processing_jobs WHERE id = ?`)
    .get(jobId) as unknown as ProcessingJobRow;
}
