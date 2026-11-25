export type JobStatus =
  | 'Awaiting Upload'
  | 'Uploading'
  | 'Uploaded'
  | 'Validating YouTube URL'
  | 'Fetching video information'
  | 'Retrieving available captions'
  | 'Transcribing authorized source'
  | 'Analyzing transcript'
  | 'Finding viral moments'
  | 'Preparing clip suggestions'
  | 'Waiting for source video'
  | 'Rendering clips'
  | 'Queued'
  | 'Inspecting'
  | 'Transcribing'
  | 'Analyzing'
  | 'Selecting clips'
  | 'Rendering'
  | 'Exporting'
  | 'Completed'
  | 'Failed'
  | 'Cancelled';

export type CaptionPresetId =
  | 'CINEMATIC'
  | 'HORMOZI'
  | 'MINIMAL'
  | 'PODCAST'
  | 'DARK STORY'
  | 'DARK CINEMATIC';

export type AspectRatio = '9:16' | '16:9' | '1:1' | '4:5';
export type ExportResolution = '720p' | '1080p';
export type SubtitlePosition = 'bottom' | 'lower-middle' | 'center' | 'top';

export interface WordTiming {
  word: string;
  start: number;
  end: number;
  highlight?: boolean;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words?: WordTiming[];
}

export interface YouTubeCaptionTrackInfo {
  id: string;
  language: string;
  name: string;
  trackKind?: string;
}

export interface YouTubeMetadata {
  videoId: string;
  title: string;
  channelTitle: string;
  description: string;
  thumbnailUrl: string;
  durationSec: number | null;
  publishedAt: string | null;
  embeddable: boolean;
  metadataSource: 'youtube_data_api' | 'oembed';
  captionTracks: YouTubeCaptionTrackInfo[];
  captionsNote: string;
}

export interface ProbeMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  hasAudio: boolean;
  fileSize: number;
  resolution: string;
}

export interface ProfileRow {
  id: string;
  email: string;
  password_hash: string;
  username: string;
  avatar_url: string | null;
  created_at: string;
}

export interface ProjectRow {
  id: string;
  user_id: string;
  title: string;
  source_file: string | null;
  source_url: string | null;
  source_platform: string | null;
  youtube_video_id: string | null;
  youtube_metadata_json: string | null;
  transcript_source: string | null;
  ai_analysis_summary: string | null;
  audio_file: string | null;
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string | null;
  has_audio: number;
  file_size: number;
  resolution: string | null;
  status: JobStatus;
  transcript_json: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClipRow {
  id: string;
  project_id: string;
  user_id: string;
  title: string;
  hook: string | null;
  reason: string | null;
  start_time: number;
  end_time: number;
  transcript: string;
  word_timings_json: string | null;
  category: string;
  ai_score: number;
  is_selected: number;
  clip_index: number;
  caption_preset: CaptionPresetId;
  aspect_ratio: AspectRatio;
  crop_x: number;
  crop_y: number;
  zoom: number;
  font_family: string;
  font_size: number;
  highlight_color: string;
  subtitle_position: SubtitlePosition;
  bg_opacity: number;
  outline_width: number;
  burn_subtitles: number;
  export_resolution: ExportResolution;
  dark_cinematic_fx: number;
  music_file: string | null;
  music_volume: number;
  output_file: string | null;
  output_size: number;
  status: JobStatus;
  created_at: string;
}

export interface ProcessingJobRow {
  id: string;
  user_id: string;
  project_id: string;
  clip_id: string | null;
  job_type: 'analyze' | 'export' | 'url_import' | 'youtube_analyze';
  status: JobStatus;
  progress: number | null;
  stage_label: string | null;
  logs: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface UserSettingsRow {
  id: string;
  user_id: string;
  default_caption_style: CaptionPresetId;
  default_aspect_ratio: AspectRatio;
  default_clip_length: string;
  export_resolution: ExportResolution;
  updated_at: string;
}
