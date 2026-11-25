import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import dns from 'node:dns/promises';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import {
  type AuthenticatedRequest,
  clearSessionCookie,
  createSession,
  createSignedMediaToken,
  extractSessionToken,
  hashPassword,
  lookupUserBySessionToken,
  requireAuth,
  revokeSession,
  setSessionCookie,
  verifyPassword,
  verifySignedMediaToken,
} from './server/auth.ts';
import {
  AUDIO_DIR,
  CHUNK_DIR,
  EXPORT_DIR,
  MUSIC_DIR,
  STORAGE_ROOT,
  UPLOAD_DIR,
  db,
  resolveInside,
} from './server/db.ts';
import {
  cancelProcessingJob,
  enqueueAnalyzeJob,
  enqueueExportJob,
  enqueueYouTubeAnalyzeJob,
  getQueueStats,
} from './server/jobs.ts';
import { checkBinary, probeVideoFile } from './server/media.ts';
import { inspectVideoUrl } from './server/urlPlatform.ts';
import {
  extractYouTubeVideoId,
  fetchOfficialYouTubeMetadata,
  parseTranscriptInput,
} from './server/youtube.ts';
import type {
  CaptionPresetId,
  ClipRow,
  ProcessingJobRow,
  ProjectRow,
  TranscriptSegment,
  UserSettingsRow,
  YouTubeMetadata,
} from './server/types.ts';

dotenv.config();

function parsePositiveIntEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const normalized = raw.includes('=') ? raw.split('=').pop()!.trim() : raw.trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const PORT = 3000;
const MAX_UPLOAD_SIZE = parsePositiveIntEnv(process.env.MAX_UPLOAD_SIZE, 1024 * 1024 * 1024); // 1 GB default
const ALLOWED_VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.mkv']);
const ALLOWED_AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg']);

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));

// Sliding window rate limiter
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(maxHits: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (bucket.count >= maxHits) {
      res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' });
      return;
    }
    bucket.count += 1;
    next();
  };
}

// Multer setup for direct video and authorized music uploads
const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${uuidv4()}${ALLOWED_VIDEO_EXTS.has(ext) ? ext : '.mp4'}`);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_VIDEO_EXTS.has(ext)) {
      cb(new Error('Unsupported video format. Accepted formats: MP4, MOV, WEBM, MKV.'));
      return;
    }
    cb(null, true);
  },
});

const musicUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, MUSIC_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `music_${uuidv4()}${ALLOWED_AUDIO_EXTS.has(ext) ? ext : '.mp3'}`);
    },
  }),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_AUDIO_EXTS.has(ext)) {
      cb(new Error('Unsupported audio format. Accepted formats: MP3, WAV, M4A, AAC, OGG.'));
      return;
    }
    cb(null, true);
  },
});

const subtitleUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.srt', '.vtt', '.txt', '.json'].includes(ext)) {
      cb(new Error('Unsupported transcript format. Accepted formats: SRT, VTT, TXT, JSON.'));
      return;
    }
    cb(null, true);
  },
});

// Helper: attach signed media URLs for owned resources
function serializeProject(p: ProjectRow) {
  let youtubeMetadata: YouTubeMetadata | null = null;
  if (p.youtube_metadata_json) {
    try {
      youtubeMetadata = JSON.parse(p.youtube_metadata_json) as YouTubeMetadata;
    } catch {
      youtubeMetadata = null;
    }
  }
  return {
    ...p,
    has_audio: Boolean(p.has_audio),
    youtube_metadata: youtubeMetadata,
    source_media_url: p.source_file
      ? `/api/media/source/${p.id}?st=${encodeURIComponent(
          createSignedMediaToken(p.user_id, 'source', p.id, 7200)
        )}`
      : null,
    transcript: p.transcript_json ? JSON.parse(p.transcript_json) : [],
  };
}

function serializeClip(c: ClipRow) {
  return {
    ...c,
    is_selected: c.is_selected === undefined ? true : Boolean(c.is_selected),
    clip_index: c.clip_index || 0,
    burn_subtitles: Boolean(c.burn_subtitles),
    dark_cinematic_fx: Boolean(c.dark_cinematic_fx),
    word_timings: c.word_timings_json ? JSON.parse(c.word_timings_json) : [],
    export_media_url: c.output_file
      ? `/api/media/export/${c.id}?st=${encodeURIComponent(
          createSignedMediaToken(c.user_id, 'export', c.id, 7200)
        )}`
      : null,
    music_media_url: c.music_file
      ? `/api/media/music/${c.id}?st=${encodeURIComponent(
          createSignedMediaToken(c.user_id, 'music', c.id, 7200)
        )}`
      : null,
  };
}

// ---------- HEALTH & SERVICE STATUS ----------
app.get('/api/health', async (_req, res) => {
  const [ffmpegInfo, ffprobeInfo] = await Promise.all([
    checkBinary('ffmpeg'),
    checkBinary('ffprobe'),
  ]);
  const queue = getQueueStats();
  let diskFreeBytes: number | null = null;
  let diskTotalBytes: number | null = null;
  try {
    const statfs = fs.statfsSync(STORAGE_ROOT);
    diskFreeBytes = statfs.bavail * statfs.bsize;
    diskTotalBytes = statfs.blocks * statfs.bsize;
  } catch {
    // Ignore if unsupported
  }

  res.json({
    status: ffmpegInfo.available && ffprobeInfo.available ? 'ok' : 'degraded',
    services: {
      ffmpeg: ffmpegInfo,
      ffprobe: ffprobeInfo,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      youtubeDataApiConfigured: Boolean(process.env.YOUTUBE_API_KEY),
      supabaseConfigured: Boolean(
        process.env.VITE_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
      ),
      redisConfigured: Boolean(process.env.REDIS_URL),
      queue,
      maxUploadSizeBytes: MAX_UPLOAD_SIZE,
      diskFreeBytes,
      diskTotalBytes,
    },
  });
});

// ---------- AUTH ROUTES ----------
app.post('/api/auth/register', rateLimit(20, 60_000), (req, res) => {
  const { email, password, username } = req.body as {
    email?: string;
    password?: string;
    username?: string;
  };
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanUsername = (username || cleanEmail.split('@')[0] || '').trim();

  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    res.status(400).json({ error: 'Enter a valid email address.' });
    return;
  }
  if (!password || password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    return;
  }
  if (!cleanUsername || cleanUsername.length < 2) {
    res.status(400).json({ error: 'Username must be at least 2 characters.' });
    return;
  }

  const existing = db.prepare(`SELECT id FROM profiles WHERE email = ?`).get(cleanEmail);
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }

  const userId = uuidv4();
  const now = new Date().toISOString();
  const passwordHash = hashPassword(password);

  db.prepare(
    `INSERT INTO profiles (id, email, password_hash, username, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(userId, cleanEmail, passwordHash, cleanUsername.slice(0, 60), now);

  db.prepare(
    `INSERT INTO user_settings (id, user_id, default_caption_style, default_aspect_ratio, default_clip_length, export_resolution, updated_at)
     VALUES (?, ?, 'DARK CINEMATIC', '9:16', '30-45', '1080p', ?)`
  ).run(uuidv4(), userId, now);

  const session = createSession(userId);
  setSessionCookie(res, session.token);

  res.status(201).json({
    token: session.token,
    user: {
      id: userId,
      email: cleanEmail,
      username: cleanUsername.slice(0, 60),
      avatar_url: null,
      created_at: now,
    },
  });
});

app.post('/api/auth/login', rateLimit(30, 60_000), (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanEmail || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const user = db
    .prepare(`SELECT * FROM profiles WHERE email = ?`)
    .get(cleanEmail) as
    | {
        id: string;
        email: string;
        password_hash: string;
        username: string;
        avatar_url: string | null;
        created_at: string;
      }
    | undefined;

  if (!user || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  const session = createSession(user.id);
  setSessionCookie(res, session.token);

  res.json({
    token: session.token,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      avatar_url: user.avatar_url,
      created_at: user.created_at,
    },
  });
});

app.post('/api/auth/logout', (req, res) => {
  const { token } = extractSessionToken(req);
  if (token) revokeSession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const { token } = extractSessionToken(req);
  if (!token) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }
  const user = lookupUserBySessionToken(token);
  if (!user) {
    clearSessionCookie(res);
    res.status(401).json({ error: 'Session expired.' });
    return;
  }
  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      avatar_url: user.avatar_url,
      created_at: user.created_at,
    },
  });
});

app.post('/api/auth/request-reset', rateLimit(10, 60_000), (req, res) => {
  const { email } = req.body as { email?: string };
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanEmail) {
    res.status(400).json({ error: 'Email address is required.' });
    return;
  }
  const user = db.prepare(`SELECT id FROM profiles WHERE email = ?`).get(cleanEmail) as
    | { id: string }
    | undefined;
  if (!user) {
    res.json({
      ok: true,
      message:
        'If an account exists for that email, a password reset code has been generated.',
      resetConfigured: false,
    });
    return;
  }

  // Note: Without an external SMTP provider configured, return explicit status instead of pretending email was delivered
  const resetToken = crypto.randomBytes(4).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO password_resets (token, user_id, expires_at, used, created_at) VALUES (?, ?, ?, 0, ?)`
  ).run(resetToken, user.id, expiresAt, new Date().toISOString());

  res.json({
    ok: true,
    emailDeliveryConfigured: false,
    message:
      'Outbound SMTP email delivery is not configured in this local environment. Use your signed-in Settings panel or configure SMTP/Supabase Auth for email reset links.',
  });
});

app.post('/api/auth/change-password', requireAuth, (req: AuthenticatedRequest, res) => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };
  if (!currentPassword || !newPassword || newPassword.length < 8) {
    res
      .status(400)
      .json({ error: 'Current password and a new password (8+ chars) are required.' });
    return;
  }
  const user = db
    .prepare(`SELECT password_hash FROM profiles WHERE id = ?`)
    .get(req.user!.id) as { password_hash: string } | undefined;
  if (!user || !verifyPassword(currentPassword, user.password_hash)) {
    res.status(401).json({ error: 'Current password is incorrect.' });
    return;
  }
  db.prepare(`UPDATE profiles SET password_hash = ? WHERE id = ?`).run(
    hashPassword(newPassword),
    req.user!.id
  );
  res.json({ ok: true });
});

// ---------- SETTINGS & STORAGE ----------
app.get('/api/settings', requireAuth, (req: AuthenticatedRequest, res) => {
  let settings = db
    .prepare(`SELECT * FROM user_settings WHERE user_id = ?`)
    .get(req.user!.id) as UserSettingsRow | undefined;

  if (!settings) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO user_settings (id, user_id, default_caption_style, default_aspect_ratio, default_clip_length, export_resolution, updated_at)
       VALUES (?, ?, 'CINEMATIC', '9:16', '30-45', '1080p', ?)`
    ).run(uuidv4(), req.user!.id, now);
    settings = db
      .prepare(`SELECT * FROM user_settings WHERE user_id = ?`)
      .get(req.user!.id) as unknown as UserSettingsRow;
  }

  res.json({ settings });
});

app.patch('/api/settings', requireAuth, (req: AuthenticatedRequest, res) => {
  const {
    default_caption_style,
    default_aspect_ratio,
    default_clip_length,
    export_resolution,
  } = req.body as Partial<UserSettingsRow>;

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE user_settings
     SET default_caption_style = COALESCE(?, default_caption_style),
         default_aspect_ratio = COALESCE(?, default_aspect_ratio),
         default_clip_length = COALESCE(?, default_clip_length),
         export_resolution = COALESCE(?, export_resolution),
         updated_at = ?
     WHERE user_id = ?`
  ).run(
    default_caption_style || null,
    default_aspect_ratio || null,
    default_clip_length || null,
    export_resolution || null,
    now,
    req.user!.id
  );

  const settings = db
    .prepare(`SELECT * FROM user_settings WHERE user_id = ?`)
    .get(req.user!.id) as unknown as UserSettingsRow;
  res.json({ settings });
});

app.patch('/api/profile', requireAuth, (req: AuthenticatedRequest, res) => {
  const { username } = req.body as { username?: string };
  const clean = (username || '').trim();
  if (clean.length < 2 || clean.length > 60) {
    res.status(400).json({ error: 'Username must be between 2 and 60 characters.' });
    return;
  }
  db.prepare(`UPDATE profiles SET username = ? WHERE id = ?`).run(clean, req.user!.id);
  res.json({
    user: {
      ...req.user!,
      username: clean,
    },
  });
});

app.get('/api/storage', requireAuth, (req: AuthenticatedRequest, res) => {
  const projects = db
    .prepare(`SELECT source_file, audio_file, file_size FROM projects WHERE user_id = ?`)
    .all(req.user!.id) as Array<{
    source_file: string | null;
    audio_file: string | null;
    file_size: number;
  }>;

  const clips = db
    .prepare(`SELECT output_file, output_size, music_file FROM clips WHERE user_id = ?`)
    .all(req.user!.id) as Array<{
    output_file: string | null;
    output_size: number;
    music_file: string | null;
  }>;

  let sourceBytes = 0;
  let exportBytes = 0;

  for (const p of projects) {
    if (p.source_file) {
      try {
        const st = fs.statSync(resolveInside(UPLOAD_DIR, p.source_file));
        sourceBytes += st.size;
      } catch {
        // File already deleted
      }
    }
    if (p.audio_file) {
      try {
        const st = fs.statSync(resolveInside(AUDIO_DIR, p.audio_file));
        sourceBytes += st.size;
      } catch {
        // Ignore
      }
    }
  }

  for (const c of clips) {
    if (c.output_file) {
      try {
        const st = fs.statSync(resolveInside(EXPORT_DIR, c.output_file));
        exportBytes += st.size;
      } catch {
        // Ignore
      }
    }
  }

  let diskFreeBytes: number | null = null;
  let diskTotalBytes: number | null = null;
  try {
    const statfs = fs.statfsSync(STORAGE_ROOT);
    diskFreeBytes = statfs.bavail * statfs.bsize;
    diskTotalBytes = statfs.blocks * statfs.bsize;
  } catch {
    // Ignore
  }

  res.json({
    sourceBytes,
    exportBytes,
    totalUsedBytes: sourceBytes + exportBytes,
    diskFreeBytes,
    diskTotalBytes,
  });
});

// ---------- RESUMABLE UPLOAD ROUTES ----------
function parseClipLengthRange(rangeStr?: string | null): {
  minDuration: number;
  maxDuration: number;
} {
  if (rangeStr === '15-30') return { minDuration: 15, maxDuration: 30 };
  if (rangeStr === '45-60') return { minDuration: 45, maxDuration: 60 };
  if (rangeStr === '60-90') return { minDuration: 60, maxDuration: 90 };
  return { minDuration: 30, maxDuration: 45 };
}

function maybeAutoStartAiPipeline(
  userId: string,
  projectId: string,
  shouldAutoAnalyze: boolean
): {
  started: boolean;
  action?: 'analyze' | 'youtube_analyze' | 'rendering_clips';
  queuedCount?: number;
  job?: ProcessingJobRow;
  reason?: string;
} {
  if (!shouldAutoAnalyze) {
    return { started: false };
  }

  const project = db
    .prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`)
    .get(projectId, userId) as ProjectRow | undefined;

  // If candidate clips already exist (e.g. from YouTube transcript analysis), automatically render selected clips!
  const existingSelectedClips = db
    .prepare(
      `SELECT * FROM clips WHERE project_id = ? AND user_id = ? AND is_selected = 1 AND output_file IS NULL
       ORDER BY CASE WHEN clip_index > 0 THEN clip_index ELSE 9999 END ASC`
    )
    .all(projectId, userId) as unknown as ClipRow[];

  if (existingSelectedClips.length > 0) {
    db.prepare(`UPDATE projects SET status = 'Rendering clips', updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      projectId
    );
    const jobs = existingSelectedClips.map((c) => enqueueExportJob(userId, c.id));
    return {
      started: true,
      action: 'rendering_clips',
      queuedCount: jobs.length,
      job: jobs[0],
    };
  }

  if (!process.env.GEMINI_API_KEY) {
    return {
      started: false,
      reason:
        'GEMINI_API_KEY is not configured in the server environment. You can still preview, manually mark clips, and export MP4s.',
    };
  }

  const settings = db
    .prepare(`SELECT default_clip_length FROM user_settings WHERE user_id = ?`)
    .get(userId) as { default_clip_length: string } | undefined;
  const { minDuration, maxDuration } = parseClipLengthRange(settings?.default_clip_length);

  if (project && (project.youtube_video_id || project.source_platform === 'YouTube')) {
    const job = enqueueYouTubeAnalyzeJob(userId, projectId, {
      minDuration,
      maxDuration,
      clipCount: 10,
      contentStyle: 'Relationship',
      preset: 'DARK CINEMATIC',
      autoRenderWhenReady: true,
    });
    return { started: true, action: 'youtube_analyze', job };
  }

  const job = enqueueAnalyzeJob(userId, projectId, {
    minDuration,
    maxDuration,
    clipCount: 5,
    contentStyle: 'Balanced',
  });
  return { started: true, action: 'analyze', job };
}

const activeUploads = new Map<
  string,
  {
    userId: string;
    projectId: string | null;
    autoAnalyze: boolean;
    title: string;
    filename: string;
    ext: string;
    totalSize: number;
    totalChunks: number;
    receivedChunks: Set<number>;
    createdAt: number;
  }
>();

app.post('/api/projects/upload/init', requireAuth, (req: AuthenticatedRequest, res) => {
  const { filename, totalSize, totalChunks, title, projectId, autoAnalyze } = req.body as {
    filename?: string;
    totalSize?: number;
    totalChunks?: number;
    title?: string;
    projectId?: string;
    autoAnalyze?: boolean;
  };
  if (!filename || !totalSize || !totalChunks) {
    res.status(400).json({ error: 'Missing filename, totalSize, or totalChunks.' });
    return;
  }
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_VIDEO_EXTS.has(ext)) {
    res
      .status(400)
      .json({ error: 'Unsupported format. Please upload MP4, MOV, WEBM, or MKV.' });
    return;
  }
  if (totalSize > MAX_UPLOAD_SIZE) {
    res.status(413).json({
      error: `File exceeds the maximum allowed upload limit of ${Math.round(
        MAX_UPLOAD_SIZE / (1024 * 1024)
      )} MB.`,
    });
    return;
  }

  let verifiedProjectId: string | null = null;
  let resolvedTitle =
    (title || path.basename(filename, ext)).trim().slice(0, 120) || 'Untitled Project';

  if (projectId) {
    const existingProject = db
      .prepare(`SELECT id, title FROM projects WHERE id = ? AND user_id = ?`)
      .get(String(projectId), req.user!.id) as { id: string; title: string } | undefined;
    if (!existingProject) {
      res.status(404).json({ error: 'Target project not found.' });
      return;
    }
    verifiedProjectId = existingProject.id;
    resolvedTitle = (title || existingProject.title).trim().slice(0, 120) || existingProject.title;
  }

  const uploadId = uuidv4();
  const chunkFolder = resolveInside(CHUNK_DIR, uploadId);
  fs.mkdirSync(chunkFolder, { recursive: true });

  activeUploads.set(uploadId, {
    userId: req.user!.id,
    projectId: verifiedProjectId,
    autoAnalyze: Boolean(autoAnalyze),
    title: resolvedTitle,
    filename,
    ext,
    totalSize,
    totalChunks,
    receivedChunks: new Set(),
    createdAt: Date.now(),
  });

  res.json({ uploadId });
});

app.post(
  '/api/projects/upload/chunk',
  requireAuth,
  express.raw({ type: 'application/octet-stream', limit: '25mb' }),
  (req: AuthenticatedRequest, res) => {
    const uploadId = String(req.headers['x-upload-id'] || '');
    const chunkIndex = Number(req.headers['x-chunk-index']);
    const meta = activeUploads.get(uploadId);

    if (!meta || meta.userId !== req.user!.id) {
      res.status(404).json({ error: 'Upload session not found.' });
      return;
    }
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= meta.totalChunks) {
      res.status(400).json({ error: 'Invalid chunk index.' });
      return;
    }
    if (!Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: 'Missing binary chunk payload.' });
      return;
    }

    const chunkPath = resolveInside(CHUNK_DIR, path.join(uploadId, `chunk_${chunkIndex}`));
    fs.writeFileSync(chunkPath, req.body);
    meta.receivedChunks.add(chunkIndex);

    res.json({
      received: meta.receivedChunks.size,
      totalChunks: meta.totalChunks,
    });
  }
);

app.post('/api/projects/upload/complete', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { uploadId, autoAnalyze } = req.body as { uploadId?: string; autoAnalyze?: boolean };
  const meta = uploadId ? activeUploads.get(uploadId) : undefined;
  if (!meta || meta.userId !== req.user!.id || !uploadId) {
    res.status(404).json({ error: 'Upload session not found.' });
    return;
  }

  if (meta.receivedChunks.size !== meta.totalChunks) {
    res.status(400).json({
      error: `Upload incomplete: received ${meta.receivedChunks.size} of ${meta.totalChunks} chunks.`,
    });
    return;
  }

  const finalFilename = `${uuidv4()}${meta.ext}`;
  const finalPath = resolveInside(UPLOAD_DIR, finalFilename);
  const chunkFolder = resolveInside(CHUNK_DIR, uploadId);

  try {
    const outStream = fs.createWriteStream(finalPath);
    for (let i = 0; i < meta.totalChunks; i++) {
      const chunkPath = resolveInside(chunkFolder, `chunk_${i}`);
      const data = fs.readFileSync(chunkPath);
      outStream.write(data);
    }
    await new Promise<void>((resolve, reject) => {
      outStream.end(() => resolve());
      outStream.on('error', reject);
    });

    const probe = await probeVideoFile(finalPath);
    const now = new Date().toISOString();
    let targetProjectId: string;

    if (meta.projectId) {
      const existing = db
        .prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`)
        .get(meta.projectId, req.user!.id) as ProjectRow | undefined;
      if (!existing) {
        if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
        res.status(404).json({ error: 'Target project not found.' });
        return;
      }

      if (existing.source_file) {
        const oldSource = resolveInside(UPLOAD_DIR, existing.source_file);
        if (fs.existsSync(oldSource)) fs.unlinkSync(oldSource);
      }
      if (existing.audio_file) {
        const oldAudio = resolveInside(AUDIO_DIR, existing.audio_file);
        if (fs.existsSync(oldAudio)) fs.unlinkSync(oldAudio);
      }

      targetProjectId = existing.id;
      db.prepare(
        `UPDATE projects
         SET source_file = ?,
             audio_file = NULL,
             duration = ?,
             width = ?,
             height = ?,
             fps = ?,
             codec = ?,
             has_audio = ?,
             file_size = ?,
             resolution = ?,
             status = 'Uploaded',
             error_message = NULL,
             updated_at = ?
         WHERE id = ? AND user_id = ?`
      ).run(
        finalFilename,
        probe.duration,
        probe.width,
        probe.height,
        probe.fps,
        probe.codec,
        probe.hasAudio ? 1 : 0,
        probe.fileSize,
        probe.resolution,
        now,
        targetProjectId,
        req.user!.id
      );
    } else {
      targetProjectId = uuidv4();
      db.prepare(
        `INSERT INTO projects (
          id, user_id, title, source_file, source_platform, duration, width, height, fps, codec,
          has_audio, file_size, resolution, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'Direct Upload', ?, ?, ?, ?, ?, ?, ?, ?, 'Uploaded', ?, ?)`
      ).run(
        targetProjectId,
        req.user!.id,
        meta.title,
        finalFilename,
        probe.duration,
        probe.width,
        probe.height,
        probe.fps,
        probe.codec,
        probe.hasAudio ? 1 : 0,
        probe.fileSize,
        probe.resolution,
        now,
        now
      );
    }

    const shouldAnalyze =
      autoAnalyze !== undefined ? Boolean(autoAnalyze) : meta.autoAnalyze;
    const autoAnalysis = maybeAutoStartAiPipeline(req.user!.id, targetProjectId, shouldAnalyze);

    const project = db
      .prepare(`SELECT * FROM projects WHERE id = ?`)
      .get(targetProjectId) as unknown as ProjectRow;
    res.status(meta.projectId ? 200 : 201).json({
      project: serializeProject(project),
      autoAnalysis,
    });
  } catch (err) {
    if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Uploaded file could not be verified as video.',
    });
  } finally {
    activeUploads.delete(uploadId);
    fs.rmSync(chunkFolder, { recursive: true, force: true });
  }
});

app.delete('/api/projects/upload/:uploadId', requireAuth, (req: AuthenticatedRequest, res) => {
  const uploadId = String(req.params.uploadId);
  const meta = activeUploads.get(uploadId);
  if (meta && meta.userId === req.user!.id) {
    activeUploads.delete(uploadId);
    const chunkFolder = resolveInside(CHUNK_DIR, uploadId);
    fs.rmSync(chunkFolder, { recursive: true, force: true });
  }
  res.json({ ok: true });
});

// Single-request upload fallback
app.post(
  '/api/projects/upload',
  requireAuth,
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    videoUpload.single('video')(req, res, (err) => {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      next();
    });
  },
  async (req: AuthenticatedRequest, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'No video file provided.' });
      return;
    }

    const filePath = req.file.path;
    try {
      const probe = await probeVideoFile(filePath);
      const projectId = uuidv4();
      const now = new Date().toISOString();
      const ext = path.extname(req.file.originalname);
      const title =
        ((req.body as { title?: string })?.title || path.basename(req.file.originalname, ext))
          .trim()
          .slice(0, 120) || 'Untitled Project';

      db.prepare(
        `INSERT INTO projects (
          id, user_id, title, source_file, source_platform, duration, width, height, fps, codec,
          has_audio, file_size, resolution, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'Direct Upload', ?, ?, ?, ?, ?, ?, ?, ?, 'Uploaded', ?, ?)`
      ).run(
        projectId,
        req.user!.id,
        title,
        req.file.filename,
        probe.duration,
        probe.width,
        probe.height,
        probe.fps,
        probe.codec,
        probe.hasAudio ? 1 : 0,
        probe.fileSize,
        probe.resolution,
        now,
        now
      );

      const project = db
        .prepare(`SELECT * FROM projects WHERE id = ?`)
        .get(projectId) as unknown as ProjectRow;
      res.status(201).json({ project: serializeProject(project) });
    } catch (err) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Invalid video file.',
      });
    }
  }
);

// ---------- SSRF-SAFE VIDEO URL VALIDATION & DIRECT IMPORT ----------
function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 0) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    return low === '::1' || low.startsWith('fc') || low.startsWith('fd') || low.startsWith('fe80');
  }
  return true;
}

app.post('/api/projects', requireAuth, rateLimit(20, 60_000), async (req: AuthenticatedRequest, res) => {
  const { url, title, preserveForUpload } = req.body as {
    url?: string;
    title?: string;
    preserveForUpload?: boolean;
  };
  if (!url) {
    res.status(400).json({ error: 'Video URL is required.' });
    return;
  }

  const inspection = inspectVideoUrl(url);
  if (!inspection.valid) {
    res.status(400).json({
      error: inspection.error || 'Please enter a valid video URL.',
      platform: inspection.platform,
    });
    return;
  }

  const parsedUrl = new URL(inspection.normalizedUrl);
  const host = parsedUrl.hostname.toLowerCase();
  const bareHost = host.replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host.endsWith('.local') || (net.isIP(bareHost) && isPrivateIp(bareHost))) {
    res.status(400).json({ error: 'Local or private network URLs are not permitted.' });
    return;
  }

  // Always enforce SSRF protection on hostname resolution
  try {
    const resolved = await dns.lookup(host, { all: true });
    if (resolved.length === 0 || resolved.some((r) => isPrivateIp(r.address))) {
      res.status(400).json({ error: 'URL resolves to a restricted private or loopback network.' });
      return;
    }
  } catch {
    // Allow preserving verified public platform URLs even if DNS is offline/proxied,
    // while still blocking direct fetches when hostname cannot resolve.
    if (!inspection.requiresAuthorizedUpload) {
      res.status(400).json({ error: 'Could not resolve the video URL hostname.' });
      return;
    }
  }

  // YouTube, TikTok, Instagram, and other protected platforms:
  // Never scrape or bypass protections — preserve the project with the identified platform and link,
  // and invite the user to upload their downloaded creator-studio file.
  if (inspection.requiresAuthorizedUpload || preserveForUpload) {
    const projectId = uuidv4();
    const now = new Date().toISOString();
    const cleanTitle = (title || inspection.suggestedTitle || 'Linked Video Project')
      .trim()
      .slice(0, 120);

    db.prepare(
      `INSERT INTO projects (
        id, user_id, title, source_file, source_url, source_platform, duration, width, height, fps,
        codec, has_audio, file_size, resolution, status, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, ?, 0, 0, 0, 0, NULL, 1, 0, NULL, 'Awaiting Upload', ?, ?)`
    ).run(
      projectId,
      req.user!.id,
      cleanTitle,
      inspection.normalizedUrl,
      inspection.platform,
      now,
      now
    );

    const project = db
      .prepare(`SELECT * FROM projects WHERE id = ?`)
      .get(projectId) as unknown as ProjectRow;
    res.status(201).json({
      project: serializeProject(project),
      requiresAuthorizedUpload: true,
      platform: inspection.platform,
      studioHint: inspection.studioHint,
    });
    return;
  }

  const ext = path.extname(parsedUrl.pathname).toLowerCase();
  const safeExt = ALLOWED_VIDEO_EXTS.has(ext) ? ext : '.mp4';
  const filename = `${uuidv4()}${safeExt}`;
  const destPath = resolveInside(UPLOAD_DIR, filename);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    const response = await fetch(parsedUrl.toString(), {
      signal: controller.signal,
      redirect: 'manual',
    });
    clearTimeout(timeout);

    if (response.status >= 300 && response.status < 400) {
      res.status(422).json({
        error:
          'Direct video URL redirects cannot be fetched automatically. You can preserve this project and upload the video file directly instead.',
        canPreserveProject: true,
        platform: inspection.platform,
        normalizedUrl: inspection.normalizedUrl,
      });
      return;
    }
    if (!response.ok || !response.body) {
      res.status(422).json({
        error: `Remote server returned HTTP ${response.status}. If this video requires sign-in or platform permissions, preserve your project and upload your authorized video file directly.`,
        canPreserveProject: true,
        platform: inspection.platform,
        normalizedUrl: inspection.normalizedUrl,
      });
      return;
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (
      contentType &&
      !contentType.includes('video/') &&
      !contentType.includes('application/octet-stream')
    ) {
      res.status(422).json({
        error: `This URL points to a web page (${contentType.split(';')[0]}) rather than a direct video file. Preserve your project and upload the downloaded MP4, MOV, or WEBM file directly.`,
        canPreserveProject: true,
        platform: inspection.platform,
        normalizedUrl: inspection.normalizedUrl,
      });
      return;
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_UPLOAD_SIZE) {
      res.status(413).json({ error: 'Remote video exceeds maximum upload size.' });
      return;
    }

    const writer = fs.createWriteStream(destPath);
    let downloaded = 0;
    const reader = response.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      downloaded += value.byteLength;
      if (downloaded > MAX_UPLOAD_SIZE) {
        writer.destroy();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        res.status(413).json({ error: 'Remote video stream exceeded maximum upload size.' });
        return;
      }
      writer.write(Buffer.from(value));
    }
    await new Promise<void>((resolve, reject) => {
      writer.end(() => resolve());
      writer.on('error', reject);
    });

    const probe = await probeVideoFile(destPath);
    const projectId = uuidv4();
    const now = new Date().toISOString();
    const cleanTitle =
      (title || path.basename(parsedUrl.pathname, safeExt) || 'Imported Video')
        .trim()
        .slice(0, 120);

    db.prepare(
      `INSERT INTO projects (
        id, user_id, title, source_file, source_url, source_platform, duration, width, height, fps, codec,
        has_audio, file_size, resolution, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'Direct URL', ?, ?, ?, ?, ?, ?, ?, 'Uploaded', ?, ?)`
    ).run(
      projectId,
      req.user!.id,
      cleanTitle,
      filename,
      parsedUrl.toString(),
      probe.duration,
      probe.width,
      probe.height,
      probe.fps,
      probe.codec,
      probe.hasAudio ? 1 : 0,
      probe.fileSize,
      probe.resolution,
      now,
      now
    );

    const project = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId) as unknown as ProjectRow;
    res.status(201).json({
      project: serializeProject(project),
      requiresAuthorizedUpload: false,
      platform: 'Direct URL',
    });
  } catch (err) {
    if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
    res.status(422).json({
      error:
        err instanceof Error
          ? err.message
          : 'Failed to download and inspect the video URL. You can still preserve the project and upload the video file directly.',
      canPreserveProject: true,
      platform: inspection.platform,
      normalizedUrl: inspection.normalizedUrl,
    });
  }
});

// ---------- UNIVERSAL YOUTUBE LINK CLIPPING API ----------
app.post('/api/youtube/validate', requireAuth, rateLimit(30, 60_000), async (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url) {
    res.status(400).json({ valid: false, error: 'YouTube URL is required.' });
    return;
  }

  const validation = extractYouTubeVideoId(url);
  if (!validation.valid || !validation.videoId) {
    res.status(400).json({
      valid: false,
      error: validation.error || 'Invalid YouTube URL.',
    });
    return;
  }

  try {
    const metadata = await fetchOfficialYouTubeMetadata(validation.videoId);
    res.json({
      valid: true,
      videoId: validation.videoId,
      normalizedUrl: validation.normalizedUrl,
      urlType: validation.urlType,
      metadata,
    });
  } catch (err) {
    res.status(422).json({
      valid: false,
      videoId: validation.videoId,
      normalizedUrl: validation.normalizedUrl,
      error:
        err instanceof Error
          ? err.message
          : 'Could not retrieve metadata for this YouTube video.',
    });
  }
});

app.post(
  '/api/youtube/analyze',
  requireAuth,
  rateLimit(20, 60_000),
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (req.is('multipart/form-data')) {
      subtitleUpload.single('subtitle')(req, res, (err) => {
        if (err) {
          res.status(400).json({ error: err.message });
          return;
        }
        next();
      });
    } else {
      next();
    }
  },
  async (req: AuthenticatedRequest, res) => {
    const body = (req.body || {}) as {
      url?: string;
      projectId?: string;
      title?: string;
      transcriptText?: string;
      minDuration?: number | string;
      maxDuration?: number | string;
      clipCount?: number | string;
      contentStyle?: string;
      preset?: CaptionPresetId;
      autoRenderWhenReady?: boolean | string;
    };

    let project: ProjectRow | undefined;

    if (body.projectId) {
      project = db
        .prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`)
        .get(String(body.projectId), req.user!.id) as ProjectRow | undefined;
      if (!project) {
        res.status(404).json({ error: 'YouTube project not found.' });
        return;
      }
    } else {
      if (!body.url) {
        res.status(400).json({ error: 'Provide either a YouTube URL or an existing projectId.' });
        return;
      }

      const validation = extractYouTubeVideoId(body.url);
      if (!validation.valid || !validation.videoId) {
        res.status(400).json({ error: validation.error || 'Invalid YouTube URL.' });
        return;
      }

      let metadata: YouTubeMetadata;
      try {
        metadata = await fetchOfficialYouTubeMetadata(validation.videoId);
      } catch (err) {
        res.status(422).json({
          error:
            err instanceof Error
              ? err.message
              : 'Could not retrieve official YouTube video metadata.',
        });
        return;
      }

      const newId = uuidv4();
      const now = new Date().toISOString();
      const cleanTitle = (body.title || metadata.title || `YouTube Video (${validation.videoId})`)
        .trim()
        .slice(0, 120);

      db.prepare(
        `INSERT INTO projects (
          id, user_id, title, source_file, source_url, source_platform, youtube_video_id,
          youtube_metadata_json, duration, width, height, fps, codec, has_audio, file_size,
          resolution, status, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, ?, 'YouTube', ?, ?, ?, 0, 0, 0, NULL, 1, 0, NULL, 'Fetching video information', ?, ?)`
      ).run(
        newId,
        req.user!.id,
        cleanTitle,
        validation.normalizedUrl,
        validation.videoId,
        JSON.stringify(metadata),
        metadata.durationSec || 0,
        now,
        now
      );

      project = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(newId) as unknown as ProjectRow;
    }

    // Parse provided subtitle file or pasted transcript text if included
    const rawTranscript = req.file
      ? req.file.buffer.toString('utf8')
      : typeof body.transcriptText === 'string'
        ? body.transcriptText
        : '';

    if (rawTranscript.trim().length > 0) {
      const parsed = parseTranscriptInput(rawTranscript, req.file?.originalname);
      if (parsed.error || parsed.segments.length === 0) {
        db.prepare(
          `UPDATE projects SET status = 'Waiting for source video', error_message = ?, updated_at = ? WHERE id = ?`
        ).run(parsed.error || 'Could not parse transcript.', new Date().toISOString(), project.id);

        const latest = db
          .prepare(`SELECT * FROM projects WHERE id = ?`)
          .get(project.id) as unknown as ProjectRow;
        res.status(422).json({
          error: parsed.error || 'Transcript could not be parsed.',
          requiresTranscriptOrSource: true,
          project: serializeProject(latest),
        });
        return;
      }

      const transcriptSource = req.file ? 'subtitle_file' : 'pasted_transcript';
      const maxSegEnd = Math.max(...parsed.segments.map((s) => s.end), project.duration || 0);
      db.prepare(
        `UPDATE projects
         SET transcript_json = ?, transcript_source = ?, duration = ?, error_message = NULL, updated_at = ?
         WHERE id = ?`
      ).run(
        JSON.stringify(parsed.segments),
        transcriptSource,
        project.duration > 0 ? project.duration : maxSegEnd,
        new Date().toISOString(),
        project.id
      );

      project = db
        .prepare(`SELECT * FROM projects WHERE id = ?`)
        .get(project.id) as unknown as ProjectRow;
    }

    const hasTranscript = Boolean(
      project.transcript_json &&
        (() => {
          try {
            const arr = JSON.parse(project.transcript_json!) as TranscriptSegment[];
            return Array.isArray(arr) && arr.length > 0;
          } catch {
            return false;
          }
        })()
    );

    if (!hasTranscript && !project.source_file) {
      db.prepare(
        `UPDATE projects SET status = 'Waiting for source video', updated_at = ? WHERE id = ?`
      ).run(new Date().toISOString(), project.id);

      const latest = db
        .prepare(`SELECT * FROM projects WHERE id = ?`)
        .get(project.id) as unknown as ProjectRow;

      res.status(422).json({
        error:
          'No accessible transcript or authorized source video is attached yet. Upload an .srt/.vtt subtitle file, paste a timestamped transcript, or upload your authorized source video.',
        requiresTranscriptOrSource: true,
        project: serializeProject(latest),
      });
      return;
    }

    if (!process.env.GEMINI_API_KEY) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured in the server environment. Add it in Settings > Secrets to run AI moment detection.',
        project: serializeProject(project),
      });
      return;
    }

    const job = enqueueYouTubeAnalyzeJob(req.user!.id, project.id, {
      minDuration: Number(body.minDuration) || 25,
      maxDuration: Number(body.maxDuration) || 55,
      clipCount: Math.max(1, Math.min(15, Number(body.clipCount) || 10)),
      contentStyle: (body.contentStyle || 'Relationship').slice(0, 60),
      preset: body.preset || 'DARK CINEMATIC',
      autoRenderWhenReady:
        body.autoRenderWhenReady === true || body.autoRenderWhenReady === 'true',
    });

    const latest = db
      .prepare(`SELECT * FROM projects WHERE id = ?`)
      .get(project.id) as unknown as ProjectRow;
    res.status(202).json({
      project: serializeProject(latest),
      job,
    });
  }
);

app.get('/api/youtube/projects', requireAuth, (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM projects
       WHERE user_id = ? AND (source_platform = 'YouTube' OR youtube_video_id IS NOT NULL)
       ORDER BY updated_at DESC`
    )
    .all(req.user!.id) as unknown as ProjectRow[];

  const clipCounts = db
    .prepare(
      `SELECT project_id,
              COUNT(*) as clip_count,
              SUM(CASE WHEN output_file IS NOT NULL THEN 1 ELSE 0 END) as exported_count
       FROM clips WHERE user_id = ? GROUP BY project_id`
    )
    .all(req.user!.id) as Array<{
    project_id: string;
    clip_count: number;
    exported_count: number;
  }>;
  const countMap = new Map(clipCounts.map((c) => [c.project_id, c]));

  res.json({
    projects: rows.map((p) => ({
      ...serializeProject(p),
      clip_count: countMap.get(p.id)?.clip_count || 0,
      exported_count: countMap.get(p.id)?.exported_count || 0,
    })),
  });
});

app.get('/api/youtube/projects/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const project = db
    .prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`)
    .get(String(req.params.id), req.user!.id) as ProjectRow | undefined;
  if (!project) {
    res.status(404).json({ error: 'YouTube project not found.' });
    return;
  }

  const clips = db
    .prepare(
      `SELECT * FROM clips
       WHERE project_id = ? AND user_id = ?
       ORDER BY CASE WHEN clip_index > 0 THEN clip_index ELSE 9999 END ASC, ai_score DESC, start_time ASC`
    )
    .all(project.id, req.user!.id) as unknown as ClipRow[];

  const jobs = db
    .prepare(
      `SELECT * FROM processing_jobs WHERE project_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 25`
    )
    .all(project.id, req.user!.id) as unknown as ProcessingJobRow[];

  const serializedClips = clips.map(serializeClip);
  res.json({
    project: serializeProject(project),
    clips: serializedClips,
    jobs,
    renderSummary: {
      hasSourceVideo: Boolean(project.source_file),
      totalClips: serializedClips.length,
      selectedClips: serializedClips.filter((c) => c.is_selected).length,
      renderedClips: serializedClips.filter((c) => Boolean(c.output_file)).length,
    },
  });
});

app.get('/api/youtube/projects/:id/clips', requireAuth, (req: AuthenticatedRequest, res) => {
  const project = db
    .prepare(`SELECT id FROM projects WHERE id = ? AND user_id = ?`)
    .get(String(req.params.id), req.user!.id);
  if (!project) {
    res.status(404).json({ error: 'YouTube project not found.' });
    return;
  }

  const clips = db
    .prepare(
      `SELECT * FROM clips
       WHERE project_id = ? AND user_id = ?
       ORDER BY CASE WHEN clip_index > 0 THEN clip_index ELSE 9999 END ASC, ai_score DESC, start_time ASC`
    )
    .all(String(req.params.id), req.user!.id) as unknown as ClipRow[];

  res.json({ clips: clips.map(serializeClip) });
});

app.post('/api/youtube/projects/:id/render', requireAuth, (req: AuthenticatedRequest, res) => {
  const projectId = String(req.params.id);
  const project = db
    .prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`)
    .get(projectId, req.user!.id) as ProjectRow | undefined;

  if (!project) {
    res.status(404).json({ error: 'YouTube project not found.' });
    return;
  }

  if (!project.source_file) {
    db.prepare(
      `UPDATE projects SET status = 'Waiting for source video', updated_at = ? WHERE id = ?`
    ).run(new Date().toISOString(), projectId);
    const updated = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId) as unknown as ProjectRow;
    res.status(409).json({
      error:
        'An authorized source video file is required before rendering MP4 files. Upload your source video to render the selected clips.',
      requiresSourceUpload: true,
      project: serializeProject(updated),
    });
    return;
  }

  const { clipIds, preset } = (req.body || {}) as {
    clipIds?: string[];
    preset?: CaptionPresetId;
  };

  let targetClips: ClipRow[];
  if (Array.isArray(clipIds) && clipIds.length > 0) {
    const allowedIds = new Set(clipIds.map(String));
    const allProjectClips = db
      .prepare(`SELECT * FROM clips WHERE project_id = ? AND user_id = ?`)
      .all(projectId, req.user!.id) as unknown as ClipRow[];
    targetClips = allProjectClips.filter((c) => allowedIds.has(c.id));
  } else {
    targetClips = db
      .prepare(
        `SELECT * FROM clips
         WHERE project_id = ? AND user_id = ? AND is_selected = 1
         ORDER BY CASE WHEN clip_index > 0 THEN clip_index ELSE 9999 END ASC`
      )
      .all(projectId, req.user!.id) as unknown as ClipRow[];
  }

  if (targetClips.length === 0) {
    res.status(400).json({ error: 'Select at least one clip to render.' });
    return;
  }

  if (preset === 'DARK CINEMATIC') {
    const updatePreset = db.prepare(
      `UPDATE clips
       SET caption_preset = 'DARK CINEMATIC',
           aspect_ratio = '9:16',
           dark_cinematic_fx = 1,
           highlight_color = '#D4AF37',
           subtitle_position = 'lower-middle',
           export_resolution = '1080p'
       WHERE id = ? AND user_id = ?`
    );
    for (const clip of targetClips) {
      updatePreset.run(clip.id, req.user!.id);
    }
  }

  db.prepare(`UPDATE projects SET status = 'Rendering clips', updated_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    projectId
  );

  const jobs = targetClips.map((clip) => enqueueExportJob(req.user!.id, clip.id));
  res.status(202).json({
    queuedCount: jobs.length,
    jobs,
  });
});

app.post(
  '/api/youtube/projects/:id/upload-source',
  requireAuth,
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (req.is('multipart/form-data')) {
      videoUpload.single('video')(req, res, (err) => {
        if (err) {
          res.status(400).json({ error: err.message });
          return;
        }
        next();
      });
    } else {
      next();
    }
  },
  async (req: AuthenticatedRequest, res) => {
    const projectId = String(req.params.id);
    const project = db
      .prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`)
      .get(projectId, req.user!.id) as ProjectRow | undefined;

    if (!project) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(404).json({ error: 'YouTube project not found.' });
      return;
    }

    const body = (req.body || {}) as {
      autoRender?: boolean | string;
      autoAnalyze?: boolean | string;
    };
    const shouldRender = body.autoRender !== false && body.autoRender !== 'false';
    const shouldAnalyze = body.autoAnalyze !== false && body.autoAnalyze !== 'false';

    if (req.file) {
      const filePath = req.file.path;
      try {
        const probe = await probeVideoFile(filePath);
        if (project.source_file) {
          const oldSource = resolveInside(UPLOAD_DIR, project.source_file);
          if (fs.existsSync(oldSource)) fs.unlinkSync(oldSource);
        }
        if (project.audio_file) {
          const oldAudio = resolveInside(AUDIO_DIR, project.audio_file);
          if (fs.existsSync(oldAudio)) fs.unlinkSync(oldAudio);
        }

        const now = new Date().toISOString();
        db.prepare(
          `UPDATE projects
           SET source_file = ?,
               audio_file = NULL,
               duration = ?,
               width = ?,
               height = ?,
               fps = ?,
               codec = ?,
               has_audio = ?,
               file_size = ?,
               resolution = ?,
               status = 'Uploaded',
               error_message = NULL,
               updated_at = ?
           WHERE id = ? AND user_id = ?`
        ).run(
          req.file.filename,
          probe.duration,
          probe.width,
          probe.height,
          probe.fps,
          probe.codec,
          probe.hasAudio ? 1 : 0,
          probe.fileSize,
          probe.resolution,
          now,
          projectId,
          req.user!.id
        );
      } catch (err) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.status(400).json({
          error:
            err instanceof Error
              ? err.message
              : 'Uploaded file could not be verified as video.',
        });
        return;
      }
    }

    const refreshed = db
      .prepare(`SELECT * FROM projects WHERE id = ?`)
      .get(projectId) as unknown as ProjectRow;

    if (!refreshed.source_file) {
      res.status(400).json({ error: 'No authorized source video file provided.' });
      return;
    }

    const existingSelectedClips = db
      .prepare(
        `SELECT * FROM clips WHERE project_id = ? AND user_id = ? AND is_selected = 1
         ORDER BY CASE WHEN clip_index > 0 THEN clip_index ELSE 9999 END ASC`
      )
      .all(projectId, req.user!.id) as unknown as ClipRow[];

    if (existingSelectedClips.length > 0 && shouldRender) {
      db.prepare(`UPDATE projects SET status = 'Rendering clips', updated_at = ? WHERE id = ?`).run(
        new Date().toISOString(),
        projectId
      );
      const jobs = existingSelectedClips.map((c) => enqueueExportJob(req.user!.id, c.id));
      const updatedProj = db
        .prepare(`SELECT * FROM projects WHERE id = ?`)
        .get(projectId) as unknown as ProjectRow;
      res.status(202).json({
        action: 'rendering_clips',
        queuedCount: jobs.length,
        jobs,
        project: serializeProject(updatedProj),
      });
      return;
    }

    if (existingSelectedClips.length === 0 && shouldAnalyze && process.env.GEMINI_API_KEY) {
      const job = enqueueYouTubeAnalyzeJob(req.user!.id, projectId, {
        minDuration: 25,
        maxDuration: 55,
        clipCount: 10,
        contentStyle: 'Relationship',
        preset: 'DARK CINEMATIC',
        autoRenderWhenReady: shouldRender,
      });
      const updatedProj = db
        .prepare(`SELECT * FROM projects WHERE id = ?`)
        .get(projectId) as unknown as ProjectRow;
      res.status(202).json({
        action: 'analyzing_and_rendering',
        job,
        project: serializeProject(updatedProj),
      });
      return;
    }

    res.json({
      action: 'uploaded',
      project: serializeProject(refreshed),
    });
  }
);

// ---------- PROJECT CRUD & ANALYSIS ----------
app.get('/api/projects', requireAuth, (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare(`SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC`)
    .all(req.user!.id) as unknown as ProjectRow[];
  const clipCounts = db
    .prepare(
      `SELECT project_id, COUNT(*) as clip_count FROM clips WHERE user_id = ? GROUP BY project_id`
    )
    .all(req.user!.id) as Array<{ project_id: string; clip_count: number }>;
  const countMap = new Map(clipCounts.map((c) => [c.project_id, c.clip_count]));

  res.json({
    projects: rows.map((p) => ({
      ...serializeProject(p),
      clip_count: countMap.get(p.id) || 0,
    })),
  });
});

app.get('/api/projects/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const project = db
    .prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`)
    .get(String(req.params.id), req.user!.id) as ProjectRow | undefined;
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  const clips = db
    .prepare(`SELECT * FROM clips WHERE project_id = ? AND user_id = ? ORDER BY start_time ASC`)
    .all(project.id, req.user!.id) as unknown as ClipRow[];
  const jobs = db
    .prepare(
      `SELECT * FROM processing_jobs WHERE project_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 20`
    )
    .all(project.id, req.user!.id) as unknown as ProcessingJobRow[];

  res.json({
    project: serializeProject(project),
    clips: clips.map(serializeClip),
    jobs,
  });
});

app.patch('/api/projects/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const { title } = req.body as { title?: string };
  const cleanTitle = (title || '').trim().slice(0, 120);
  if (!cleanTitle) {
    res.status(400).json({ error: 'Project title cannot be empty.' });
    return;
  }
  const info = db
    .prepare(`UPDATE projects SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(cleanTitle, new Date().toISOString(), String(req.params.id), req.user!.id);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  const project = db
    .prepare(`SELECT * FROM projects WHERE id = ?`)
    .get(String(req.params.id)) as unknown as ProjectRow;
  res.json({ project: serializeProject(project) });
});

app.delete('/api/projects/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const projectId = String(req.params.id);
  const sourceOnly = req.query.sourceOnly === 'true';

  const project = db
    .prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`)
    .get(projectId, req.user!.id) as ProjectRow | undefined;
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  if (project.source_file) {
    const sourcePath = resolveInside(UPLOAD_DIR, project.source_file);
    if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath);
  }
  if (project.audio_file) {
    const audioPath = resolveInside(AUDIO_DIR, project.audio_file);
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
  }

  if (sourceOnly) {
    db.prepare(
      `UPDATE projects SET source_file = NULL, audio_file = NULL, file_size = 0, updated_at = ? WHERE id = ?`
    ).run(new Date().toISOString(), projectId);
    res.json({ ok: true, sourceDeleted: true });
    return;
  }

  const clips = db
    .prepare(`SELECT output_file, music_file FROM clips WHERE project_id = ?`)
    .all(projectId) as Array<{ output_file: string | null; music_file: string | null }>;
  for (const c of clips) {
    if (c.output_file) {
      const p = resolveInside(EXPORT_DIR, c.output_file);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    if (c.music_file) {
      const m = resolveInside(MUSIC_DIR, c.music_file);
      if (fs.existsSync(m)) fs.unlinkSync(m);
    }
  }

  db.prepare(`DELETE FROM projects WHERE id = ? AND user_id = ?`).run(projectId, req.user!.id);
  res.json({ ok: true });
});

function handleAnalyzeRequest(req: AuthenticatedRequest, res: Response) {
  const projectId = String(req.params.id);
  const project = db
    .prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`)
    .get(projectId, req.user!.id) as ProjectRow | undefined;
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  if (!project.source_file) {
    res.status(400).json({ error: 'Source video has been deleted or is missing.' });
    return;
  }
  if (!process.env.GEMINI_API_KEY) {
    res.status(503).json({
      error:
        'GEMINI_API_KEY is not configured in the server environment. Add it in Settings > Secrets to run AI transcription and clip selection.',
    });
    return;
  }

  const body = (req.body || {}) as {
    minDuration?: number;
    maxDuration?: number;
    clipCount?: number;
    contentStyle?: string;
  };
  const job = enqueueAnalyzeJob(req.user!.id, projectId, {
    minDuration: Number(body.minDuration) || 25,
    maxDuration: Number(body.maxDuration) || 55,
    clipCount: Number(body.clipCount) || 5,
    contentStyle: (body.contentStyle || 'Balanced').slice(0, 60),
  });

  res.status(202).json({ job });
}

app.post('/api/projects/:id/analyze', requireAuth, handleAnalyzeRequest);
app.post('/api/projects/:id/generate-clips', requireAuth, handleAnalyzeRequest);

// ---------- CLIPS & EXPORT ----------
app.get('/api/projects/:id/clips', requireAuth, (req: AuthenticatedRequest, res) => {
  const clips = db
    .prepare(`SELECT * FROM clips WHERE project_id = ? AND user_id = ? ORDER BY start_time ASC`)
    .all(String(req.params.id), req.user!.id) as unknown as ClipRow[];
  res.json({ clips: clips.map(serializeClip) });
});

app.get('/api/clips', requireAuth, (req: AuthenticatedRequest, res) => {
  const clips = db
    .prepare(
      `SELECT c.*, p.title as project_title
       FROM clips c
       JOIN projects p ON p.id = c.project_id
       WHERE c.user_id = ?
       ORDER BY c.created_at DESC`
    )
    .all(req.user!.id) as unknown as Array<ClipRow & { project_title: string }>;

  res.json({
    clips: clips.map((c) => ({
      ...serializeClip(c),
      project_title: c.project_title,
    })),
  });
});

app.post('/api/projects/:id/clips', requireAuth, (req: AuthenticatedRequest, res) => {
  const projectId = String(req.params.id);
  const project = db
    .prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`)
    .get(projectId, req.user!.id) as ProjectRow | undefined;
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const { title, start_time, end_time } = req.body as {
    title?: string;
    start_time?: number;
    end_time?: number;
  };
  const start = Math.max(0, Number(start_time) || 0);
  const end = Math.min(project.duration || 60, Math.max(start + 2, Number(end_time) || start + 25));

  // Extract verbatim transcript within range if project already transcribed
  let transcript = '';
  let wordTimings: unknown[] = [];
  if (project.transcript_json) {
    try {
      const segs = JSON.parse(project.transcript_json) as Array<{
        start: number;
        end: number;
        text: string;
        words?: Array<{ word: string; start: number; end: number }>;
      }>;
      const matched = segs.filter((s) => s.end > start && s.start < end);
      transcript = matched.map((m) => m.text).join(' ').trim();
      wordTimings = matched.flatMap((m) => m.words || []);
    } catch {
      transcript = '';
    }
  }

  const settings = db
    .prepare(`SELECT * FROM user_settings WHERE user_id = ?`)
    .get(req.user!.id) as UserSettingsRow | undefined;

  const clipId = uuidv4();
  const now = new Date().toISOString();
  const preset = settings?.default_caption_style || 'CINEMATIC';
  db.prepare(
    `INSERT INTO clips (
      id, project_id, user_id, title, hook, reason, start_time, end_time,
      transcript, word_timings_json, category, ai_score, caption_preset,
      aspect_ratio, crop_x, crop_y, zoom, font_family, font_size,
      highlight_color, subtitle_position, bg_opacity, outline_width,
      burn_subtitles, export_resolution, dark_cinematic_fx, music_volume,
      status, created_at
    ) VALUES (?, ?, ?, ?, NULL, 'Manual timeline selection', ?, ?, ?, ?, 'Manual', 0, ?, ?, 0.5, 0.5, 1.0, 'Liberation Sans', 52, '#8B5CF6', 'lower-middle', 0.0, 3, 1, ?, ?, 0.18, 'Completed', ?)`
  ).run(
    clipId,
    projectId,
    req.user!.id,
    (title || 'Custom Clip').trim().slice(0, 120),
    start,
    end,
    transcript,
    JSON.stringify(wordTimings),
    preset,
    settings?.default_aspect_ratio || '9:16',
    settings?.export_resolution || '1080p',
    preset === 'DARK CINEMATIC' ? 1 : 0,
    now
  );

  const clip = db.prepare(`SELECT * FROM clips WHERE id = ?`).get(clipId) as unknown as ClipRow;
  res.status(201).json({ clip: serializeClip(clip) });
});

app.patch('/api/clips/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const clipId = String(req.params.id);
  const existing = db
    .prepare(`SELECT * FROM clips WHERE id = ? AND user_id = ?`)
    .get(clipId, req.user!.id) as ClipRow | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Clip not found.' });
    return;
  }

  const b = req.body as Record<string, unknown>;
  const start =
    b.start_time !== undefined ? Math.max(0, Number(b.start_time)) : existing.start_time;
  const end =
    b.end_time !== undefined ? Math.max(start + 1, Number(b.end_time)) : existing.end_time;

  db.prepare(
    `UPDATE clips SET
      title = ?,
      start_time = ?,
      end_time = ?,
      transcript = ?,
      word_timings_json = ?,
      is_selected = ?,
      caption_preset = ?,
      aspect_ratio = ?,
      crop_x = ?,
      crop_y = ?,
      zoom = ?,
      font_family = ?,
      font_size = ?,
      highlight_color = ?,
      subtitle_position = ?,
      bg_opacity = ?,
      outline_width = ?,
      burn_subtitles = ?,
      export_resolution = ?,
      dark_cinematic_fx = ?,
      music_volume = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    typeof b.title === 'string' && b.title.trim() ? b.title.trim().slice(0, 120) : existing.title,
    start,
    end,
    typeof b.transcript === 'string' ? b.transcript : existing.transcript,
    Array.isArray(b.word_timings)
      ? JSON.stringify(b.word_timings)
      : existing.word_timings_json,
    b.is_selected !== undefined ? (b.is_selected ? 1 : 0) : existing.is_selected,
    typeof b.caption_preset === 'string' ? b.caption_preset : existing.caption_preset,
    typeof b.aspect_ratio === 'string' ? b.aspect_ratio : existing.aspect_ratio,
    b.crop_x !== undefined ? Math.max(0, Math.min(1, Number(b.crop_x))) : existing.crop_x,
    b.crop_y !== undefined ? Math.max(0, Math.min(1, Number(b.crop_y))) : existing.crop_y,
    b.zoom !== undefined ? Math.max(1, Math.min(2.5, Number(b.zoom))) : existing.zoom,
    typeof b.font_family === 'string' ? b.font_family : existing.font_family,
    b.font_size !== undefined
      ? Math.max(24, Math.min(96, Number(b.font_size)))
      : existing.font_size,
    typeof b.highlight_color === 'string' ? b.highlight_color : existing.highlight_color,
    typeof b.subtitle_position === 'string' ? b.subtitle_position : existing.subtitle_position,
    b.bg_opacity !== undefined
      ? Math.max(0, Math.min(1, Number(b.bg_opacity)))
      : existing.bg_opacity,
    b.outline_width !== undefined
      ? Math.max(0, Math.min(8, Number(b.outline_width)))
      : existing.outline_width,
    b.burn_subtitles !== undefined ? (b.burn_subtitles ? 1 : 0) : existing.burn_subtitles,
    typeof b.export_resolution === 'string' ? b.export_resolution : existing.export_resolution,
    b.dark_cinematic_fx !== undefined
      ? b.dark_cinematic_fx
        ? 1
        : 0
      : existing.dark_cinematic_fx,
    b.music_volume !== undefined
      ? Math.max(0, Math.min(0.8, Number(b.music_volume)))
      : existing.music_volume,
    clipId,
    req.user!.id
  );

  const updated = db.prepare(`SELECT * FROM clips WHERE id = ?`).get(clipId) as unknown as ClipRow;
  res.json({ clip: serializeClip(updated) });
});

app.post(
  '/api/clips/:id/music',
  requireAuth,
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    musicUpload.single('music')(req, res, (err) => {
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      next();
    });
  },
  (req: AuthenticatedRequest, res) => {
    const clipId = String(req.params.id);
    const clip = db
      .prepare(`SELECT * FROM clips WHERE id = ? AND user_id = ?`)
      .get(clipId, req.user!.id) as ClipRow | undefined;
    if (!clip) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(404).json({ error: 'Clip not found.' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'No audio file uploaded.' });
      return;
    }
    if (clip.music_file) {
      const oldMusic = resolveInside(MUSIC_DIR, clip.music_file);
      if (fs.existsSync(oldMusic)) fs.unlinkSync(oldMusic);
    }
    db.prepare(`UPDATE clips SET music_file = ? WHERE id = ?`).run(req.file.filename, clipId);
    const updated = db.prepare(`SELECT * FROM clips WHERE id = ?`).get(clipId) as unknown as ClipRow;
    res.json({ clip: serializeClip(updated) });
  }
);

app.delete('/api/clips/:id/music', requireAuth, (req: AuthenticatedRequest, res) => {
  const clipId = String(req.params.id);
  const clip = db
    .prepare(`SELECT * FROM clips WHERE id = ? AND user_id = ?`)
    .get(clipId, req.user!.id) as ClipRow | undefined;
  if (!clip) {
    res.status(404).json({ error: 'Clip not found.' });
    return;
  }
  if (clip.music_file) {
    const oldMusic = resolveInside(MUSIC_DIR, clip.music_file);
    if (fs.existsSync(oldMusic)) fs.unlinkSync(oldMusic);
  }
  db.prepare(`UPDATE clips SET music_file = NULL WHERE id = ?`).run(clipId);
  const updated = db.prepare(`SELECT * FROM clips WHERE id = ?`).get(clipId) as unknown as ClipRow;
  res.json({ clip: serializeClip(updated) });
});

app.delete('/api/clips/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const clipId = String(req.params.id);
  const clip = db
    .prepare(`SELECT * FROM clips WHERE id = ? AND user_id = ?`)
    .get(clipId, req.user!.id) as ClipRow | undefined;
  if (!clip) {
    res.status(404).json({ error: 'Clip not found.' });
    return;
  }
  if (clip.output_file) {
    const p = resolveInside(EXPORT_DIR, clip.output_file);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  if (clip.music_file) {
    const m = resolveInside(MUSIC_DIR, clip.music_file);
    if (fs.existsSync(m)) fs.unlinkSync(m);
  }
  db.prepare(`DELETE FROM clips WHERE id = ? AND user_id = ?`).run(clipId, req.user!.id);
  res.json({ ok: true });
});

app.post('/api/clips/:id/export', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const job = enqueueExportJob(req.user!.id, String(req.params.id));
    res.status(202).json({ job });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Unable to start export job.',
    });
  }
});

// ---------- JOB QUEUE ROUTES ----------
app.get('/api/jobs', requireAuth, (req: AuthenticatedRequest, res) => {
  const jobs = db
    .prepare(
      `SELECT j.*, p.title as project_title, c.title as clip_title
       FROM processing_jobs j
       LEFT JOIN projects p ON p.id = j.project_id
       LEFT JOIN clips c ON c.id = j.clip_id
       WHERE j.user_id = ?
       ORDER BY j.created_at DESC
       LIMIT 40`
    )
    .all(req.user!.id);
  res.json({ jobs });
});

app.get('/api/jobs/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const job = db
    .prepare(`SELECT * FROM processing_jobs WHERE id = ? AND user_id = ?`)
    .get(String(req.params.id), req.user!.id) as ProcessingJobRow | undefined;
  if (!job) {
    res.status(404).json({ error: 'Job not found.' });
    return;
  }
  res.json({ job });
});

app.post('/api/jobs/:id/cancel', requireAuth, (req: AuthenticatedRequest, res) => {
  const job = cancelProcessingJob(String(req.params.id), req.user!.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found.' });
    return;
  }
  res.json({ job });
});

app.post('/api/jobs/:id/retry', requireAuth, (req: AuthenticatedRequest, res) => {
  const oldJob = db
    .prepare(`SELECT * FROM processing_jobs WHERE id = ? AND user_id = ?`)
    .get(String(req.params.id), req.user!.id) as ProcessingJobRow | undefined;
  if (!oldJob) {
    res.status(404).json({ error: 'Job not found.' });
    return;
  }
  if (oldJob.job_type === 'export' && oldJob.clip_id) {
    const job = enqueueExportJob(req.user!.id, oldJob.clip_id);
    res.status(202).json({ job });
    return;
  }
  if (oldJob.job_type === 'analyze') {
    const job = enqueueAnalyzeJob(req.user!.id, oldJob.project_id, {
      minDuration: 25,
      maxDuration: 55,
      clipCount: 5,
      contentStyle: 'Balanced',
    });
    res.status(202).json({ job });
    return;
  }
  if (oldJob.job_type === 'youtube_analyze') {
    const job = enqueueYouTubeAnalyzeJob(req.user!.id, oldJob.project_id, {
      minDuration: 25,
      maxDuration: 55,
      clipCount: 10,
      contentStyle: 'Relationship',
      preset: 'DARK CINEMATIC',
    });
    res.status(202).json({ job });
    return;
  }
  res.status(400).json({ error: 'This job type cannot be retried.' });
});

// ---------- PRIVATE SIGNED MEDIA STREAMING & DOWNLOAD ----------
app.get('/api/media/:kind/:resourceId', (req, res) => {
  const kind = String(req.params.kind) as 'source' | 'export' | 'music';
  const resourceId = String(req.params.resourceId);
  if (!['source', 'export', 'music'].includes(kind)) {
    res.status(400).json({ error: 'Invalid media kind.' });
    return;
  }

  let authorizedUserId: string | null = null;
  const st = typeof req.query.st === 'string' ? req.query.st : '';
  if (st) {
    const verified = verifySignedMediaToken(st, kind, resourceId);
    if (verified) authorizedUserId = verified.userId;
  }

  if (!authorizedUserId) {
    const { token } = extractSessionToken(req);
    if (token) {
      const user = lookupUserBySessionToken(token);
      if (user) authorizedUserId = user.id;
    }
  }

  if (!authorizedUserId) {
    res.status(401).json({ error: 'Signed media URL expired or unauthorized.' });
    return;
  }

  let filePath: string | null = null;
  let downloadName = 'clipforge-video.mp4';
  let mimeType = 'video/mp4';

  if (kind === 'source') {
    const project = db
      .prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`)
      .get(resourceId, authorizedUserId) as ProjectRow | undefined;
    if (project?.source_file) {
      filePath = resolveInside(UPLOAD_DIR, project.source_file);
      const ext = path.extname(project.source_file) || '.mp4';
      downloadName = `${project.title.replace(/[^a-zA-Z0-9_-]+/g, '_')}${ext}`;
      if (ext === '.webm') mimeType = 'video/webm';
      else if (ext === '.mov') mimeType = 'video/quicktime';
      else if (ext === '.mkv') mimeType = 'video/x-matroska';
    }
  } else if (kind === 'export') {
    const clip = db
      .prepare(`SELECT * FROM clips WHERE id = ? AND user_id = ?`)
      .get(resourceId, authorizedUserId) as ClipRow | undefined;
    if (clip?.output_file) {
      filePath = resolveInside(EXPORT_DIR, clip.output_file);
      downloadName = `${clip.title.replace(/[^a-zA-Z0-9_-]+/g, '_')}.mp4`;
    }
  } else if (kind === 'music') {
    const clip = db
      .prepare(`SELECT * FROM clips WHERE id = ? AND user_id = ?`)
      .get(resourceId, authorizedUserId) as ClipRow | undefined;
    if (clip?.music_file) {
      filePath = resolveInside(MUSIC_DIR, clip.music_file);
      mimeType = 'audio/mpeg';
      downloadName = clip.music_file;
    }
  }

  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Media file not found.' });
    return;
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  if (req.query.download === '1') {
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
  }

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (Number.isNaN(start) || start >= fileSize) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }
    const chunksize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': mimeType,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// ---------- VITE / STATIC SPA ENTRY ----------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
      cacheDir: path.join(os.tmpdir(), 'clipforge-vite-cache'),
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CLIPFORGE server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start CLIPFORGE server:', err);
  process.exit(1);
});
