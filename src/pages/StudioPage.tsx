import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  Check,
  Download,
  ExternalLink,
  Film,
  Loader2,
  Music,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  XCircle,
  Youtube,
} from 'lucide-react';
import { AuthorizedUploadZone } from '../components/AuthorizedUploadZone';
import { ClipPreviewPlayer } from '../components/ClipPreviewPlayer';
import { Timeline } from '../components/Timeline';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { useToast } from '../context/ToastContext';
import { apiRequest, getInMemoryToken } from '../lib/api';
import {
  ASPECT_RATIO_OPTIONS,
  CAPTION_PRESETS,
  CONTENT_STYLES,
  formatBytes,
  formatTimecode,
} from '../lib/presets';
import { isSafeExternalUrl } from '../lib/urlPlatform';
import type {
  AspectRatio,
  CaptionPresetId,
  Clip,
  ExportResolution,
  ProcessingJob,
  Project,
  SubtitlePosition,
} from '../types';

export function StudioPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { notify } = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeClipId, setActiveClipId] = useState<string | null>(
    searchParams.get('clip')
  );
  const [previewMode, setPreviewMode] = useState<'edit' | 'exported'>('edit');
  const [currentTime, setCurrentTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // AI Selection form state
  const [durationRange, setDurationRange] = useState('30-45');
  const [customMinDur, setCustomMinDur] = useState(20);
  const [customMaxDur, setCustomMaxDur] = useState(60);
  const [clipCountOption, setClipCountOption] = useState('5');
  const [customClipCount, setCustomClipCount] = useState(4);
  const [contentStyle, setContentStyle] = useState('Balanced');
  const [analyzingSubmit, setAnalyzingSubmit] = useState(false);

  // Local editable clip state
  const [draft, setDraft] = useState<Clip | null>(null);
  const [savingClip, setSavingClip] = useState(false);
  const [exportSubmitting, setExportSubmitting] = useState(false);
  const [uploadingMusic, setUploadingMusic] = useState(false);

  const fetchProjectData = useCallback(async () => {
    if (!id) return;
    try {
      const data = await apiRequest<{
        project: Project;
        clips: Clip[];
        jobs: ProcessingJob[];
      }>(`/api/projects/${id}`);
      setProject(data.project);
      setClips(data.clips);
      setJobs(data.jobs);
      setError(null);

      const paramClip = searchParams.get('clip');
      if (paramClip && data.clips.some((c) => c.id === paramClip)) {
        setActiveClipId(paramClip);
      } else if (data.clips.length > 0) {
        setActiveClipId((prev) =>
          prev && data.clips.some((c) => c.id === prev) ? prev : data.clips[0].id
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load project.');
    } finally {
      setLoading(false);
    }
  }, [id, searchParams]);

  useEffect(() => {
    fetchProjectData();
  }, [fetchProjectData]);

  // Sync draft when switching active clip
  useEffect(() => {
    const found = clips.find((c) => c.id === activeClipId) || null;
    setDraft(found);
    if (found) {
      setCurrentTime(found.start_time);
      setPreviewMode(found.export_media_url ? 'exported' : 'edit');
    }
  }, [activeClipId, clips]);

  // Poll while any project job is running
  const activeJob = jobs.find((j) =>
    [
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
      'Exporting',
    ].includes(j.status)
  );

  useEffect(() => {
    if (!activeJob) return;
    const timer = setInterval(fetchProjectData, 2000);
    return () => clearInterval(timer);
  }, [activeJob, fetchProjectData]);

  const handleRunAnalysis = async () => {
    if (!project) return;
    let minDuration = 30;
    let maxDuration = 45;
    if (durationRange === '15-30') {
      minDuration = 15;
      maxDuration = 30;
    } else if (durationRange === '30-45') {
      minDuration = 30;
      maxDuration = 45;
    } else if (durationRange === '45-60') {
      minDuration = 45;
      maxDuration = 60;
    } else if (durationRange === '60-90') {
      minDuration = 60;
      maxDuration = 90;
    } else {
      minDuration = customMinDur;
      maxDuration = customMaxDur;
    }

    const clipCount =
      clipCountOption === 'custom' ? customClipCount : Number(clipCountOption);

    setAnalyzingSubmit(true);
    try {
      await apiRequest(`/api/projects/${project.id}/analyze`, {
        method: 'POST',
        body: JSON.stringify({
          minDuration,
          maxDuration,
          clipCount,
          contentStyle,
        }),
      });
      notify('AI transcription and moment detection started.', 'info');
      fetchProjectData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to start AI analysis.', 'error');
    } finally {
      setAnalyzingSubmit(false);
    }
  };

  const handleAddManualClip = async () => {
    if (!project) return;
    const start = Math.max(0, Math.min((project.duration || 30) - 5, currentTime));
    const end = Math.min(project.duration || 30, start + 30);
    try {
      const res = await apiRequest<{ clip: Clip }>(`/api/projects/${project.id}/clips`, {
        method: 'POST',
        body: JSON.stringify({
          title: `Manual Clip ${clips.length + 1}`,
          start_time: start,
          end_time: end,
        }),
      });
      setClips((prev) => [...prev, res.clip]);
      setActiveClipId(res.clip.id);
      setSearchParams({ clip: res.clip.id });
      notify('Manual clip added at playhead.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not create clip.', 'error');
    }
  };

  const saveDraftChanges = async (override?: Partial<Clip>): Promise<Clip | null> => {
    if (!draft) return null;
    const payload = { ...draft, ...override };
    setSavingClip(true);
    try {
      const res = await apiRequest<{ clip: Clip }>(`/api/clips/${draft.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: payload.title,
          start_time: payload.start_time,
          end_time: payload.end_time,
          transcript: payload.transcript,
          word_timings: payload.word_timings,
          caption_preset: payload.caption_preset,
          aspect_ratio: payload.aspect_ratio,
          crop_x: payload.crop_x,
          crop_y: payload.crop_y,
          zoom: payload.zoom,
          font_family: payload.font_family,
          font_size: payload.font_size,
          highlight_color: payload.highlight_color,
          subtitle_position: payload.subtitle_position,
          bg_opacity: payload.bg_opacity,
          outline_width: payload.outline_width,
          burn_subtitles: payload.burn_subtitles,
          export_resolution: payload.export_resolution,
          dark_cinematic_fx: payload.dark_cinematic_fx,
          music_volume: payload.music_volume,
        }),
      });
      setClips((prev) => prev.map((c) => (c.id === res.clip.id ? res.clip : c)));
      setDraft(res.clip);
      return res.clip;
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save clip edits.', 'error');
      return null;
    } finally {
      setSavingClip(false);
    }
  };

  const handleExportClip = async () => {
    if (!draft) return;
    setExportSubmitting(true);
    try {
      const saved = await saveDraftChanges();
      if (!saved) return;
      await apiRequest(`/api/clips/${saved.id}/export`, { method: 'POST' });
      notify('FFmpeg export job queued. You can monitor progress or keep editing.', 'info');
      fetchProjectData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to queue export.', 'error');
    } finally {
      setExportSubmitting(false);
    }
  };

  const handleDeleteClip = async (clipId: string) => {
    try {
      await apiRequest(`/api/clips/${clipId}`, { method: 'DELETE' });
      const remaining = clips.filter((c) => c.id !== clipId);
      setClips(remaining);
      if (activeClipId === clipId) {
        setActiveClipId(remaining[0]?.id || null);
      }
      notify('Clip deleted.', 'info');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete clip.', 'error');
    }
  };

  const handleApplyPreset = (presetId: CaptionPresetId) => {
    const preset = CAPTION_PRESETS.find((p) => p.id === presetId);
    if (!preset || !draft) return;
    setDraft({
      ...draft,
      caption_preset: preset.id,
      highlight_color: preset.defaultHighlightColor,
      subtitle_position: preset.defaultPosition,
      font_size: preset.defaultFontSize,
      outline_width: preset.defaultOutline,
      bg_opacity: preset.defaultBgOpacity,
      dark_cinematic_fx: preset.darkCinematicFx,
      aspect_ratio: preset.id === 'DARK CINEMATIC' ? '9:16' : draft.aspect_ratio,
      export_resolution:
        preset.id === 'DARK CINEMATIC' ? '1080p' : draft.export_resolution,
    });
    setPreviewMode('edit');
  };

  const handleMusicUpload = async (file: File) => {
    if (!draft) return;
    setUploadingMusic(true);
    try {
      const form = new FormData();
      form.append('music', file);
      const token = getInMemoryToken();
      const headers: Record<string, string> = {
        'X-Requested-With': 'XMLHttpRequest',
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`/api/clips/${draft.id}/music`, {
        method: 'POST',
        headers,
        body: form,
        credentials: 'include',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Music upload failed.');
      setClips((prev) => prev.map((c) => (c.id === json.clip.id ? json.clip : c)));
      setDraft(json.clip);
      notify('Background audio attached to clip.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Music upload failed.', 'error');
    } finally {
      setUploadingMusic(false);
    }
  };

  const handleRemoveMusic = async () => {
    if (!draft) return;
    try {
      const res = await apiRequest<{ clip: Clip }>(`/api/clips/${draft.id}/music`, {
        method: 'DELETE',
      });
      setClips((prev) => prev.map((c) => (c.id === res.clip.id ? res.clip : c)));
      setDraft(res.clip);
      notify('Background music removed.', 'info');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to remove music.', 'error');
    }
  };

  const handleCancelJob = async (jobId: string) => {
    try {
      await apiRequest(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
      notify('Job cancelled.', 'info');
      fetchProjectData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to cancel job.', 'error');
    }
  };

  const handleRetryJob = async (jobId: string) => {
    try {
      await apiRequest(`/api/jobs/${jobId}/retry`, { method: 'POST' });
      notify('Job queued for retry.', 'info');
      fetchProjectData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to retry job.', 'error');
    }
  };

  if (loading) {
    return (
      <WorkspaceLayout title="Loading Studio..." breadcrumb="CLIPFORGE / Studio" fullBleed>
        <div className="p-8 flex items-center justify-center text-sm text-zinc-400 gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-[#8B5CF6]" />
          Loading studio workspace...
        </div>
      </WorkspaceLayout>
    );
  }

  if (error || !project) {
    return (
      <WorkspaceLayout title="Project Error" breadcrumb="CLIPFORGE / Studio">
        <div className="bg-[#141414] border border-rose-500/30 rounded-xl p-6 text-sm text-rose-200">
          {error || 'Project could not be found.'}
        </div>
      </WorkspaceLayout>
    );
  }

  const latestClipExportJob = draft
    ? jobs.find((j) => j.job_type === 'export' && j.clip_id === draft.id)
    : undefined;
  const latestAnalyzeJob = jobs.find((j) => j.job_type === 'analyze');

  const safeSourceUrl = isSafeExternalUrl(project.source_url) ? project.source_url : null;
  const studioBreadcrumb =
    !project.source_file &&
    (project.status === 'Awaiting Upload' || project.status === 'Waiting for source video')
      ? `Studio · ${project.source_platform || 'External URL'} · ${project.status}`
      : `Studio · ${project.resolution || 'Media'} · ${formatTimecode(project.duration)}`;

  return (
    <WorkspaceLayout
      title={project.title}
      breadcrumb={studioBreadcrumb}
      fullBleed
      action={
        <div className="flex items-center gap-2">
          {project.youtube_video_id && (
            <Link
              to={`/dashboard/youtube/${project.id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 bg-[#141414] hover:bg-[#1B1B1B] text-xs font-medium text-[#C4B5FD] hover:text-white whitespace-nowrap"
            >
              <Youtube className="w-3.5 h-3.5" />
              YouTube Clipper
            </Link>
          )}
          {draft && (
            <>
              <button
                type="button"
                disabled={savingClip}
                onClick={async () => {
                  const res = await saveDraftChanges();
                  if (res) notify('Clip settings saved.', 'success');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 bg-[#141414] hover:bg-[#1B1B1B] text-xs font-medium text-white whitespace-nowrap"
              >
                {savingClip ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                Save
              </button>
              <button
                type="button"
                disabled={exportSubmitting || !project.source_file}
                onClick={handleExportClip}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-white text-xs font-semibold whitespace-nowrap"
              >
                {exportSubmitting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Film className="w-3.5 h-3.5" />
                )}
                Export MP4
              </button>
            </>
          )}
        </div>
      }
    >
      <div className="grid grid-cols-1 xl:grid-cols-12 min-h-[calc(100vh-4rem)]">
        {/* LEFT PANEL: Project & AI Analysis + Clip List */}
        <aside className="xl:col-span-3 border-b xl:border-b-0 xl:border-r border-white/[0.08] bg-[#0D0D0D] p-4 space-y-5 overflow-y-auto xl:max-h-[calc(100vh-4rem)]">
          {/* Source Metadata */}
          <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-white">Source Media</p>
              {project.source_platform && (
                <span className="px-2 py-0.5 rounded bg-[#8B5CF6]/20 border border-[#8B5CF6]/40 text-[10px] font-medium text-[#C4B5FD]">
                  {project.source_platform}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-y-1.5 text-[11px] font-mono text-zinc-400">
              <span>Platform</span>
              <span className="text-right text-zinc-200 font-sans">
                {project.source_platform || (project.source_file ? 'Direct Upload' : '—')}
              </span>
              <span>Resolution</span>
              <span className="text-right text-zinc-200">{project.resolution || '—'}</span>
              <span>Frame rate</span>
              <span className="text-right text-zinc-200">{project.fps ? `${project.fps} fps` : '—'}</span>
              <span>Codec</span>
              <span className="text-right text-zinc-200">{project.codec || '—'}</span>
              <span>Audio track</span>
              <span className="text-right text-zinc-200">
                {project.source_file ? (project.has_audio ? 'Detected' : 'Missing') : 'Pending upload'}
              </span>
              <span>File size</span>
              <span className="text-right text-zinc-200">
                {project.source_file ? formatBytes(project.file_size) : '—'}
              </span>
            </div>
            {safeSourceUrl && (
              <div className="pt-2 border-t border-white/[0.06]">
                <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
                  Original link
                </p>
                <a
                  href={safeSourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 max-w-full text-[11px] text-[#C4B5FD] hover:text-white underline"
                >
                  <span className="truncate">{safeSourceUrl}</span>
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              </div>
            )}
          </div>

          {/* AI Analysis Launcher */}
          <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#8B5CF6]" />
                AI Moment Detection
              </p>
            </div>

            <div className="space-y-2.5">
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Clip duration</label>
                <select
                  value={durationRange}
                  onChange={(e) => setDurationRange(e.target.value)}
                  className="w-full rounded-lg bg-[#090909] border border-white/10 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#8B5CF6]"
                >
                  <option value="15-30">15–30 seconds</option>
                  <option value="30-45">30–45 seconds</option>
                  <option value="45-60">45–60 seconds</option>
                  <option value="60-90">60–90 seconds</option>
                  <option value="custom">Custom range</option>
                </select>
              </div>

              {durationRange === 'custom' && (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min={5}
                    max={300}
                    value={customMinDur}
                    onChange={(e) => setCustomMinDur(Number(e.target.value))}
                    className="rounded-lg bg-[#090909] border border-white/10 px-2.5 py-1.5 text-xs font-mono text-white"
                    aria-label="Minimum duration seconds"
                  />
                  <input
                    type="number"
                    min={10}
                    max={300}
                    value={customMaxDur}
                    onChange={(e) => setCustomMaxDur(Number(e.target.value))}
                    className="rounded-lg bg-[#090909] border border-white/10 px-2.5 py-1.5 text-xs font-mono text-white"
                    aria-label="Maximum duration seconds"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">Clip count</label>
                  <select
                    value={clipCountOption}
                    onChange={(e) => setClipCountOption(e.target.value)}
                    className="w-full rounded-lg bg-[#090909] border border-white/10 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#8B5CF6]"
                  >
                    <option value="3">3 clips</option>
                    <option value="5">5 clips</option>
                    <option value="10">10 clips</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">Content style</label>
                  <select
                    value={contentStyle}
                    onChange={(e) => setContentStyle(e.target.value)}
                    className="w-full rounded-lg bg-[#090909] border border-white/10 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#8B5CF6]"
                  >
                    {CONTENT_STYLES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {clipCountOption === 'custom' && (
                <input
                  type="number"
                  min={1}
                  max={15}
                  value={customClipCount}
                  onChange={(e) => setCustomClipCount(Number(e.target.value))}
                  className="w-full rounded-lg bg-[#090909] border border-white/10 px-2.5 py-1.5 text-xs font-mono text-white"
                  placeholder="Number of clips (1–15)"
                />
              )}

              <button
                type="button"
                disabled={
                  analyzingSubmit ||
                  !project.source_file ||
                  Boolean(latestAnalyzeJob && ['Queued', 'Inspecting', 'Transcribing', 'Analyzing', 'Selecting clips'].includes(latestAnalyzeJob.status))
                }
                onClick={handleRunAnalysis}
                className="w-full py-2 px-3 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
              >
                {analyzingSubmit ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                Analyze & Generate Clips
              </button>
            </div>

            {latestAnalyzeJob && (
              <div className="pt-2.5 border-t border-white/[0.06] text-[11px]">
                <div className="flex items-center justify-between text-zinc-300">
                  <span>{latestAnalyzeJob.status}</span>
                  {['Queued', 'Inspecting', 'Transcribing', 'Analyzing', 'Selecting clips'].includes(
                    latestAnalyzeJob.status
                  ) ? (
                    <button
                      type="button"
                      onClick={() => handleCancelJob(latestAnalyzeJob.id)}
                      className="text-rose-400 hover:underline flex items-center gap-1"
                    >
                      <XCircle className="w-3 h-3" />
                      Cancel
                    </button>
                  ) : latestAnalyzeJob.status === 'Failed' ? (
                    <button
                      type="button"
                      onClick={() => handleRetryJob(latestAnalyzeJob.id)}
                      className="text-[#8B5CF6] hover:underline flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Retry
                    </button>
                  ) : null}
                </div>
                <p className="mt-1 text-zinc-400">
                  {latestAnalyzeJob.stage_label}
                </p>
                {latestAnalyzeJob.error_message && (
                  <p className="mt-1 text-rose-300">{latestAnalyzeJob.error_message}</p>
                )}
              </div>
            )}
          </div>

          {/* Generated Clip List */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-xs font-semibold text-white">Clips ({clips.length})</p>
              <button
                type="button"
                disabled={!project.source_file}
                onClick={handleAddManualClip}
                className="inline-flex items-center gap-1 text-xs text-[#C4B5FD] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus className="w-3.5 h-3.5" />
                Add clip
              </button>
            </div>

            {clips.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 p-4 text-center text-xs text-zinc-500">
                Run AI analysis above or click Add clip to select a segment manually.
              </div>
            ) : (
              <div className="space-y-2">
                {clips.map((c) => {
                  const selected = c.id === activeClipId;
                  return (
                    <div
                      key={c.id}
                      onClick={() => {
                        setActiveClipId(c.id);
                        setSearchParams({ clip: c.id });
                      }}
                      className={`rounded-xl p-3 border cursor-pointer transition-colors ${
                        selected
                          ? 'bg-[#1B1B1B] border-[#8B5CF6]/60'
                          : 'bg-[#141414] border-white/[0.08] hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium text-white line-clamp-1">
                          {c.title}
                        </p>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteClip(c.id);
                          }}
                          aria-label="Delete clip"
                          className="text-zinc-500 hover:text-rose-400 shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 text-[11px] font-mono text-zinc-400">
                        <span>
                          {formatTimecode(c.start_time)} – {formatTimecode(c.end_time)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-sans">{c.category}</span>
                        {c.ai_score > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{c.ai_score}</span>
                          </>
                        )}
                      </div>
                      {c.output_file && (
                        <p className="mt-1.5 text-[11px] text-emerald-400 flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          Exported MP4 ready
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        {/* CENTER PANEL: Video Preview + Timeline + Transcript */}
        <section className="xl:col-span-6 p-4 sm:p-6 space-y-5 overflow-y-auto xl:max-h-[calc(100vh-4rem)]">
          {project.source_file ? (
            <>
              <ClipPreviewPlayer
                sourceUrl={project.source_media_url}
                exportedUrl={draft?.export_media_url || null}
                previewMode={previewMode}
                onPreviewModeChange={setPreviewMode}
                startTime={draft?.start_time ?? 0}
                endTime={draft?.end_time ?? Math.min(30, project.duration || 30)}
                currentTime={currentTime}
                onTimeUpdate={setCurrentTime}
                aspectRatio={(draft?.aspect_ratio as AspectRatio) || '9:16'}
                cropX={draft?.crop_x ?? 0.5}
                cropY={draft?.crop_y ?? 0.5}
                zoom={draft?.zoom ?? 1}
                burnSubtitles={draft?.burn_subtitles ?? true}
                captionPreset={(draft?.caption_preset as CaptionPresetId) || 'CINEMATIC'}
                fontSize={draft?.font_size ?? 52}
                highlightColor={draft?.highlight_color || '#8B5CF6'}
                subtitlePosition={(draft?.subtitle_position as SubtitlePosition) || 'lower-middle'}
                bgOpacity={draft?.bg_opacity ?? 0}
                outlineWidth={draft?.outline_width ?? 3}
                darkCinematicFx={draft?.dark_cinematic_fx ?? false}
                transcript={draft?.transcript || ''}
                wordTimings={draft?.word_timings || []}
                videoRefExternal={videoRef}
              />

              <Timeline
                duration={project.duration || 60}
                currentTime={currentTime}
                clipStart={draft?.start_time ?? 0}
                clipEnd={draft?.end_time ?? Math.min(30, project.duration || 30)}
                clips={clips}
                activeClipId={activeClipId}
                onSeek={(t) => {
                  setPreviewMode('edit');
                  setCurrentTime(t);
                  if (videoRef.current) videoRef.current.currentTime = t;
                }}
                onChangeRange={(start, end) => {
                  if (!draft) return;
                  setPreviewMode('edit');
                  setDraft({ ...draft, start_time: start, end_time: end });
                }}
                onSelectClip={(cid) => {
                  setActiveClipId(cid);
                  setSearchParams({ clip: cid });
                }}
              />
            </>
          ) : (
            <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-base font-semibold text-white">
                    Upload authorized source video
                  </h2>
                  <p className="mt-1 text-xs text-zinc-400">
                    Your project and source link are preserved. Upload your downloaded file to start AI clipping.
                  </p>
                </div>
                {project.source_platform && (
                  <span className="px-2.5 py-1 rounded-md bg-[#8B5CF6]/20 border border-[#8B5CF6]/40 text-xs font-medium text-[#C4B5FD]">
                    {project.source_platform}
                  </span>
                )}
              </div>

              {safeSourceUrl && (
                <div className="rounded-lg bg-[#090909] border border-white/[0.08] px-3.5 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                      Original video link ({project.source_platform || 'External URL'})
                    </p>
                    <a
                      href={safeSourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[#C4B5FD] hover:text-white underline truncate block"
                    >
                      {safeSourceUrl}
                    </a>
                  </div>
                  <a
                    href={safeSourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open original video link"
                    className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] shrink-0"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}

              <div className="rounded-lg bg-[#1B1B1B] border border-white/[0.08] p-3.5 flex items-start gap-2.5 text-xs text-zinc-300 leading-relaxed">
                <ShieldCheck className="w-4 h-4 text-[#8B5CF6] shrink-0 mt-0.5" />
                <p>
                  CLIPFORGE never scrapes or bypasses DRM or platform protections. Download your own video from {project.source_platform || 'your creator studio'} (MP4, MOV, WEBM, or MKV) and upload it below—it will automatically connect to transcription and AI clip detection.
                </p>
              </div>

              <AuthorizedUploadZone
                projectId={project.id}
                projectTitle={project.title}
                defaultAutoAnalyze={true}
                showAutoAnalyzeToggle={true}
                submitLabel="Upload Video & Start AI Clipping"
                onUploadComplete={(res) => {
                  if (res.autoAnalysis?.started) {
                    notify(
                      'Video uploaded and connected to the AI clipping pipeline.',
                      'success'
                    );
                  } else if (res.autoAnalysis?.reason) {
                    notify(
                      `Video uploaded and verified. ${res.autoAnalysis.reason}`,
                      'info'
                    );
                  } else {
                    notify('Video uploaded and verified with FFprobe.', 'success');
                  }
                  fetchProjectData();
                }}
              />
            </div>
          )}

          {/* Verbatim Project Transcript */}
          <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-white">
                Source Transcript ({project.transcript.length} segments)
              </p>
              <span className="text-[11px] text-zinc-500">Click any line to seek</span>
            </div>
            {project.transcript.length === 0 ? (
              <p className="text-xs text-zinc-500">
                No transcript generated yet. Run AI Moment Detection to transcribe audio verbatim.
              </p>
            ) : (
              <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                {project.transcript.map((seg, idx) => {
                  const isActive = currentTime >= seg.start && currentTime <= seg.end;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setPreviewMode('edit');
                        setCurrentTime(seg.start);
                        if (videoRef.current) videoRef.current.currentTime = seg.start;
                      }}
                      className={`w-full text-left flex items-start gap-3 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                        isActive ? 'bg-[#8B5CF6]/15 text-white' : 'hover:bg-white/[0.04] text-zinc-300'
                      }`}
                    >
                      <span className="font-mono text-[11px] text-zinc-500 shrink-0 mt-0.5">
                        {formatTimecode(seg.start)}
                      </span>
                      <span className="leading-relaxed">{seg.text}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* RIGHT PANEL: Clip Inspector, Captions, Framing & Export */}
        <aside className="xl:col-span-3 border-t xl:border-t-0 xl:border-l border-white/[0.08] bg-[#0D0D0D] p-4 space-y-5 overflow-y-auto xl:max-h-[calc(100vh-4rem)]">
          {!draft ? (
            <div className="rounded-xl bg-[#141414] border border-white/[0.08] p-6 text-center text-xs text-zinc-400">
              Select or create a clip to customize framing, captions, and MP4 export settings.
            </div>
          ) : (
            <>
              {/* Title & Timestamps */}
              <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-3.5 space-y-3">
                <p className="text-xs font-semibold text-white">Clip Boundaries</p>
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">Clip title</label>
                  <input
                    type="text"
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    className="w-full rounded-lg bg-[#090909] border border-white/10 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#8B5CF6]"
                  />
                </div>

                {draft.reason && (
                  <p className="text-[11px] text-zinc-400 leading-relaxed">{draft.reason}</p>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] text-zinc-400">Start (s)</label>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            start_time: Math.max(0, Math.min(draft.end_time - 1, Number(currentTime.toFixed(2)))),
                          })
                        }
                        className="text-[10px] text-[#C4B5FD] hover:underline"
                      >
                        Set In
                      </button>
                    </div>
                    <input
                      type="number"
                      step="0.1"
                      min={0}
                      max={draft.end_time - 1}
                      value={draft.start_time}
                      onChange={(e) =>
                        setDraft({ ...draft, start_time: Math.max(0, Number(e.target.value)) })
                      }
                      className="w-full rounded-lg bg-[#090909] border border-white/10 px-2.5 py-1.5 text-xs font-mono text-white"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] text-zinc-400">End (s)</label>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            end_time: Math.min(
                              project.duration || 9999,
                              Math.max(draft.start_time + 1, Number(currentTime.toFixed(2)))
                            ),
                          })
                        }
                        className="text-[10px] text-[#C4B5FD] hover:underline"
                      >
                        Set Out
                      </button>
                    </div>
                    <input
                      type="number"
                      step="0.1"
                      min={draft.start_time + 1}
                      max={project.duration || 9999}
                      value={draft.end_time}
                      onChange={(e) =>
                        setDraft({ ...draft, end_time: Math.max(draft.start_time + 1, Number(e.target.value)) })
                      }
                      className="w-full rounded-lg bg-[#090909] border border-white/10 px-2.5 py-1.5 text-xs font-mono text-white"
                    />
                  </div>
                </div>
              </div>

              {/* Aspect Ratio & Reframing */}
              <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-3.5 space-y-3">
                <p className="text-xs font-semibold text-white">Aspect Ratio & Framing</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {ASPECT_RATIO_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setDraft({ ...draft, aspect_ratio: opt.id });
                        setPreviewMode('edit');
                      }}
                      className={`px-2.5 py-2 rounded-lg text-left text-xs border transition-colors ${
                        draft.aspect_ratio === opt.id
                          ? 'bg-[#8B5CF6]/20 border-[#8B5CF6] text-white'
                          : 'bg-[#090909] border-white/10 text-zinc-400 hover:text-white'
                      }`}
                    >
                      <span className="font-medium block">{opt.id}</span>
                      <span className="text-[10px] text-zinc-400">{opt.detail}</span>
                    </button>
                  ))}
                </div>

                <div className="space-y-2 pt-1">
                  <div>
                    <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                      <span>Horizontal crop</span>
                      <span className="font-mono">{Math.round(draft.crop_x * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={draft.crop_x}
                      onChange={(e) => {
                        setDraft({ ...draft, crop_x: Number(e.target.value) });
                        setPreviewMode('edit');
                      }}
                      className="w-full accent-[#8B5CF6]"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                      <span>Vertical crop</span>
                      <span className="font-mono">{Math.round(draft.crop_y * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={draft.crop_y}
                      onChange={(e) => {
                        setDraft({ ...draft, crop_y: Number(e.target.value) });
                        setPreviewMode('edit');
                      }}
                      className="w-full accent-[#8B5CF6]"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                      <span>Zoom</span>
                      <span className="font-mono">{draft.zoom.toFixed(2)}x</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={2.2}
                      step={0.05}
                      value={draft.zoom}
                      onChange={(e) => {
                        setDraft({ ...draft, zoom: Number(e.target.value) });
                        setPreviewMode('edit');
                      }}
                      className="w-full accent-[#8B5CF6]"
                    />
                  </div>
                </div>
              </div>

              {/* Caption Style & Text */}
              <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-white">Captions & Preset</p>
                  <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.burn_subtitles}
                      onChange={(e) =>
                        setDraft({ ...draft, burn_subtitles: e.target.checked })
                      }
                      className="accent-[#8B5CF6]"
                    />
                    Burn subtitles
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  {CAPTION_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleApplyPreset(p.id)}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium border text-left transition-colors ${
                        draft.caption_preset === p.id
                          ? 'bg-[#8B5CF6]/20 border-[#8B5CF6] text-white'
                          : 'bg-[#090909] border-white/10 text-zinc-400 hover:text-white'
                      }`}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>

                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">
                    Caption text (manual edit)
                  </label>
                  <textarea
                    rows={3}
                    value={draft.transcript}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        transcript: e.target.value,
                        word_timings: [],
                      })
                    }
                    className="w-full rounded-lg bg-[#090909] border border-white/10 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#8B5CF6]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Font</label>
                    <select
                      value={draft.font_family}
                      onChange={(e) => setDraft({ ...draft, font_family: e.target.value })}
                      className="w-full rounded-lg bg-[#090909] border border-white/10 px-2 py-1.5 text-xs text-white"
                    >
                      <option value="Liberation Sans">Liberation Sans</option>
                      <option value="DejaVu Sans">DejaVu Sans</option>
                      <option value="Noto Sans">Noto Sans</option>
                      <option value="JetBrains Mono">JetBrains Mono</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Position</label>
                    <select
                      value={draft.subtitle_position}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          subtitle_position: e.target.value as SubtitlePosition,
                        })
                      }
                      className="w-full rounded-lg bg-[#090909] border border-white/10 px-2 py-1.5 text-xs text-white"
                    >
                      <option value="lower-middle">Lower middle</option>
                      <option value="center">Center</option>
                      <option value="bottom">Bottom</option>
                      <option value="top">Top</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                      <span>Text size</span>
                      <span className="font-mono">{draft.font_size}px</span>
                    </div>
                    <input
                      type="range"
                      min={28}
                      max={84}
                      value={draft.font_size}
                      onChange={(e) =>
                        setDraft({ ...draft, font_size: Number(e.target.value) })
                      }
                      className="w-full accent-[#8B5CF6]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      Highlight color
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={draft.highlight_color}
                        onChange={(e) =>
                          setDraft({ ...draft, highlight_color: e.target.value })
                        }
                        className="w-8 h-7 rounded bg-transparent border border-white/15 cursor-pointer"
                      />
                      <span className="font-mono text-[11px] text-zinc-300">
                        {draft.highlight_color}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                      <span>Outline</span>
                      <span className="font-mono">{draft.outline_width}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={6}
                      step={1}
                      value={draft.outline_width}
                      onChange={(e) =>
                        setDraft({ ...draft, outline_width: Number(e.target.value) })
                      }
                      className="w-full accent-[#8B5CF6]"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                      <span>Box opacity</span>
                      <span className="font-mono">{Math.round(draft.bg_opacity * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={0.9}
                      step={0.05}
                      value={draft.bg_opacity}
                      onChange={(e) =>
                        setDraft({ ...draft, bg_opacity: Number(e.target.value) })
                      }
                      className="w-full accent-[#8B5CF6]"
                    />
                  </div>
                </div>

                <label className="flex items-center justify-between pt-2 border-t border-white/[0.06] text-xs text-zinc-300 cursor-pointer">
                  <span>Dark Cinematic grade + slow zoom</span>
                  <input
                    type="checkbox"
                    checked={draft.dark_cinematic_fx}
                    onChange={(e) =>
                      setDraft({ ...draft, dark_cinematic_fx: e.target.checked })
                    }
                    className="accent-[#8B5CF6]"
                  />
                </label>
              </div>

              {/* Optional Authorized Background Music */}
              <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-3.5 space-y-2.5">
                <p className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <Music className="w-3.5 h-3.5 text-[#8B5CF6]" />
                  Background Music (Optional)
                </p>
                <p className="text-[11px] text-zinc-400">
                  Upload audio you are authorized to use. Not applied unless uploaded.
                </p>
                {draft.music_file ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-zinc-200 bg-[#090909] px-2.5 py-1.5 rounded-lg">
                      <span className="truncate">{draft.music_file}</span>
                      <button
                        type="button"
                        onClick={handleRemoveMusic}
                        className="text-rose-400 hover:underline ml-2 shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                    <div>
                      <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                        <span>Music mix volume</span>
                        <span className="font-mono">{Math.round(draft.music_volume * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0.05}
                        max={0.6}
                        step={0.01}
                        value={draft.music_volume}
                        onChange={(e) =>
                          setDraft({ ...draft, music_volume: Number(e.target.value) })
                        }
                        className="w-full accent-[#8B5CF6]"
                      />
                    </div>
                  </div>
                ) : (
                  <label className="block w-full text-center py-2 px-3 rounded-lg border border-white/10 hover:border-white/25 bg-[#090909] text-xs text-zinc-300 cursor-pointer">
                    {uploadingMusic ? 'Uploading...' : 'Attach MP3 / WAV track'}
                    <input
                      type="file"
                      accept=".mp3,.wav,.m4a,.aac,.ogg"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleMusicUpload(f);
                      }}
                    />
                  </label>
                )}
              </div>

              {/* Export Controls */}
              <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-3.5 space-y-3">
                <p className="text-xs font-semibold text-white">Export H.264 MP4</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {(['720p', '1080p'] as ExportResolution[]).map((res) => (
                    <button
                      key={res}
                      type="button"
                      onClick={() => setDraft({ ...draft, export_resolution: res })}
                      className={`py-1.5 rounded-lg text-xs font-mono border transition-colors ${
                        draft.export_resolution === res
                          ? 'bg-[#8B5CF6]/20 border-[#8B5CF6] text-white'
                          : 'bg-[#090909] border-white/10 text-zinc-400'
                      }`}
                    >
                      {res}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  disabled={exportSubmitting || !project.source_file}
                  onClick={handleExportClip}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  {exportSubmitting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Film className="w-3.5 h-3.5" />
                  )}
                  Render & Export MP4
                </button>

                {latestClipExportJob && (
                  <div className="pt-2 border-t border-white/[0.06] text-[11px] space-y-1.5">
                    <div className="flex items-center justify-between text-zinc-300">
                      <span>{latestClipExportJob.status}</span>
                      {['Queued', 'Rendering', 'Exporting'].includes(
                        latestClipExportJob.status
                      ) ? (
                        <button
                          type="button"
                          onClick={() => handleCancelJob(latestClipExportJob.id)}
                          className="text-rose-400 hover:underline"
                        >
                          Cancel
                        </button>
                      ) : latestClipExportJob.status === 'Failed' ? (
                        <button
                          type="button"
                          onClick={() => handleRetryJob(latestClipExportJob.id)}
                          className="text-[#8B5CF6] hover:underline"
                        >
                          Retry
                        </button>
                      ) : null}
                    </div>
                    <p className="text-zinc-400">{latestClipExportJob.stage_label}</p>
                    {['Queued', 'Rendering', 'Exporting'].includes(latestClipExportJob.status) &&
                      latestClipExportJob.progress !== null && (
                        <div className="h-1.5 w-full rounded-full bg-[#090909] overflow-hidden">
                          <div
                            style={{ width: `${latestClipExportJob.progress}%` }}
                            className="h-full bg-[#8B5CF6] transition-all"
                          />
                        </div>
                      )}
                    {latestClipExportJob.error_message && (
                      <p className="text-rose-300 flex items-start gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{latestClipExportJob.error_message}</span>
                      </p>
                    )}
                  </div>
                )}

                {draft.export_media_url && (
                  <a
                    href={`${draft.export_media_url}&download=1`}
                    download
                    className="w-full py-2.5 px-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200 text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download MP4 ({formatBytes(draft.output_size)})
                  </a>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </WorkspaceLayout>
  );
}
