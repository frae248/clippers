import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const APP_ROOT = process.cwd();
export const DATA_DIR = path.resolve(APP_ROOT, 'data');
export const STORAGE_ROOT = path.resolve(APP_ROOT, 'storage');
export const UPLOAD_DIR = path.resolve(STORAGE_ROOT, 'uploads');
export const CHUNK_DIR = path.resolve(STORAGE_ROOT, 'chunks');
export const AUDIO_DIR = path.resolve(STORAGE_ROOT, 'audio');
export const MUSIC_DIR = path.resolve(STORAGE_ROOT, 'music');
export const EXPORT_DIR = path.resolve(STORAGE_ROOT, 'exports');
export const TMP_DIR = path.resolve(STORAGE_ROOT, 'tmp');

for (const dir of [
  DATA_DIR,
  STORAGE_ROOT,
  UPLOAD_DIR,
  CHUNK_DIR,
  AUDIO_DIR,
  MUSIC_DIR,
  EXPORT_DIR,
  TMP_DIR,
]) {
  fs.mkdirSync(dir, { recursive: true });
}

export function resolveInside(baseDir: string, relativeOrName: string): string {
  const safeBase = path.resolve(baseDir);
  const resolved = path.resolve(safeBase, relativeOrName);
  if (resolved !== safeBase && !resolved.startsWith(safeBase + path.sep)) {
    throw new Error('Invalid storage path outside permitted boundary');
  }
  return resolved;
}

const DB_PATH = path.resolve(DATA_DIR, 'clipforge.db');
export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    username TEXT NOT NULL,
    avatar_url TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    source_file TEXT,
    source_url TEXT,
    source_platform TEXT,
    youtube_video_id TEXT,
    youtube_metadata_json TEXT,
    transcript_source TEXT,
    ai_analysis_summary TEXT,
    audio_file TEXT,
    duration REAL NOT NULL DEFAULT 0,
    width INTEGER NOT NULL DEFAULT 0,
    height INTEGER NOT NULL DEFAULT 0,
    fps REAL NOT NULL DEFAULT 0,
    codec TEXT,
    has_audio INTEGER NOT NULL DEFAULT 1,
    file_size INTEGER NOT NULL DEFAULT 0,
    resolution TEXT,
    status TEXT NOT NULL DEFAULT 'Uploaded',
    transcript_json TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    hook TEXT,
    reason TEXT,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    transcript TEXT NOT NULL DEFAULT '',
    word_timings_json TEXT,
    category TEXT NOT NULL DEFAULT 'Highlight',
    ai_score REAL NOT NULL DEFAULT 0,
    is_selected INTEGER NOT NULL DEFAULT 1,
    clip_index INTEGER NOT NULL DEFAULT 0,
    caption_preset TEXT NOT NULL DEFAULT 'DARK CINEMATIC',
    aspect_ratio TEXT NOT NULL DEFAULT '9:16',
    crop_x REAL NOT NULL DEFAULT 0.5,
    crop_y REAL NOT NULL DEFAULT 0.5,
    zoom REAL NOT NULL DEFAULT 1.0,
    font_family TEXT NOT NULL DEFAULT 'Liberation Sans',
    font_size INTEGER NOT NULL DEFAULT 54,
    highlight_color TEXT NOT NULL DEFAULT '#D4AF37',
    subtitle_position TEXT NOT NULL DEFAULT 'lower-middle',
    bg_opacity REAL NOT NULL DEFAULT 0.0,
    outline_width INTEGER NOT NULL DEFAULT 3,
    burn_subtitles INTEGER NOT NULL DEFAULT 1,
    export_resolution TEXT NOT NULL DEFAULT '1080p',
    dark_cinematic_fx INTEGER NOT NULL DEFAULT 1,
    music_file TEXT,
    music_volume REAL NOT NULL DEFAULT 0.18,
    output_file TEXT,
    output_size INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Completed',
    created_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS processing_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    clip_id TEXT,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL,
    progress REAL,
    stage_label TEXT,
    logs TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL,
    default_caption_style TEXT NOT NULL DEFAULT 'DARK CINEMATIC',
    default_aspect_ratio TEXT NOT NULL DEFAULT '9:16',
    default_clip_length TEXT NOT NULL DEFAULT '30-45',
    export_resolution TEXT NOT NULL DEFAULT '1080p',
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
  );
`);

const existingProjectCols = db.prepare(`PRAGMA table_info(projects)`).all() as Array<{ name: string }>;
for (const [col, def] of [
  ['source_platform', 'TEXT'],
  ['youtube_video_id', 'TEXT'],
  ['youtube_metadata_json', 'TEXT'],
  ['transcript_source', 'TEXT'],
  ['ai_analysis_summary', 'TEXT'],
] as const) {
  if (!existingProjectCols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE projects ADD COLUMN ${col} ${def}`);
  }
}

const existingClipCols = db.prepare(`PRAGMA table_info(clips)`).all() as Array<{ name: string }>;
if (!existingClipCols.some((c) => c.name === 'is_selected')) {
  db.exec(`ALTER TABLE clips ADD COLUMN is_selected INTEGER NOT NULL DEFAULT 1`);
}
if (!existingClipCols.some((c) => c.name === 'clip_index')) {
  db.exec(`ALTER TABLE clips ADD COLUMN clip_index INTEGER NOT NULL DEFAULT 0`);
}

// Recover any jobs left mid-flight if server restarted
db.prepare(
  `UPDATE processing_jobs
   SET status = 'Failed',
       error_message = 'Server restarted during processing. Retry the job to resume.',
       completed_at = ?
   WHERE status IN (
     'Validating YouTube URL',
     'Fetching video information',
     'Retrieving available captions',
     'Transcribing authorized source',
     'Analyzing transcript',
     'Finding viral moments',
     'Preparing clip suggestions',
     'Rendering clips',
     'Queued',
     'Inspecting',
     'Transcribing',
     'Analyzing',
     'Selecting clips',
     'Rendering',
     'Exporting'
   )`
).run(new Date().toISOString());
