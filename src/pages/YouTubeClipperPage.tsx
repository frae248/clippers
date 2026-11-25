import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Film,
  History,
  Link2,
  Loader2,
  Play,
  RefreshCw,
  Save,
  Scissors,
  ShieldCheck,
  Sliders,
  Sparkles,
  Upload,
  XCircle,
  Youtube,
} from 'lucide-react';
import {
  AuthorizedUploadZone,
  type UploadCompletePayload,
} from '../components/AuthorizedUploadZone';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { YouTubeEmbedPlayer } from '../components/YouTubeEmbedPlayer';
import { useToast } from '../context/ToastContext';
import { ApiError, apiRequest } from '../lib/api';
import {
  CAPTION_PRESETS,
  CONTENT_STYLES,
  formatBytes,
  formatDuration,
  formatTimecode,
} from '../lib/presets';
import { isSafeExternalUrl } from '../lib/urlPlatform';
import type {
  CaptionPresetId,
  Clip,
  JobStatus,
  ProcessingJob,
  Project,
  YouTubeMetadata,
} from '../types';

interface ValidateResponse {
  valid: boolean;
  videoId: string;
  normalizedUrl: string;
  urlType?: string;
  metadata: YouTubeMetadata;
}

interface YouTubeProjectDetailResponse {
  project: Project;
  clips: Clip[];
  jobs: ProcessingJob[];
  renderSummary: {
    hasSourceVideo: boolean;
    totalClips: number;
    selectedClips: number;
    renderedClips: number;
  };
}

interface YouTubeHistoryItem extends Project {
  exported_count?: number;
}

const ACTIVE_STATUSES: JobStatus[] = [
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
];

const YOUTUBE_STAGE_STEPS: Array<{ status: JobStatus; label: string }> = [
  { status: 'Validating YouTube URL', label: 'Validating URL' },
  { status: 'Fetching video information', label: 'Fetching video info' },
  { status: 'Retrieving available captions', label: 'Retrieving captions' },
  { status: 'Analyzing transcript', label: 'Analyzing transcript' },
  { status: 'Finding viral moments', label: 'Finding viral moments' },
  { status: 'Preparing clip suggestions', label: 'Preparing suggestions' },
];

export function YouTubeClipperPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { notify } = useToast();
  const prefillHandledRef = useRef<string | null>(null);

  // Import & validation state
  const [urlInput, setUrlInput] = useState('');
  const [validating, setValidating] = useState(false);
  const [validatedMeta, setValidatedMeta] = useState<{
    videoId: string;
    normalizedUrl: string;
    metadata: YouTubeMetadata;
  } | null>(null);

  // Transcript source state
  const [transcriptText, setTranscriptText] = useState('');
  const [subtitleFile, setSubtitleFile] = useState<File | null>(null);
  const subtitleInputRef = useRef<HTMLInputElement | null>(null);

  // Analysis preferences (Dark Cinematic Relationship default)
  const [preset, setPreset] = useState<CaptionPresetId>('DARK CINEMATIC');
  const [contentStyle, setContentStyle] = useState('Relationship');
  const [durationRange, setDurationRange] = useState('30-45');
  const [clipCount, setClipCount] = useState(10);
  const [analyzing, setAnalyzing] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Active loaded project state
  const [project, setProject] = useState<Project | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [history, setHistory] = useState<YouTubeHistoryItem[]>([]);
  const [loadingProject, setLoadingProject] = useState(Boolean(id));

  // Clip editing drafts keyed by clip ID
  const [clipEdits, setClipEdits] = useState<
    Record<string, { title: string; start_time: number; end_time: number }>
  >({});
  const [savingClipId, setSavingClipId] = useState<string | null>(null);
  const [renderingAll, setRenderingAll] = useState(false);

  // Embedded YouTube player preview control
  const [seekSeconds, setSeekSeconds] = useState<number | null>(null);
  const [seekTrigger, setSeekTrigger] = useState(0);
  const [previewClipLabel, setPreviewClipLabel] = useState<string | null>(null);

  const uploadSectionRef = useRef<HTMLDivElement | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await apiRequest<{ projects: YouTubeHistoryItem[] }>('/api/youtube/projects');
      setHistory(res.projects);
    } catch {
      // Non-fatal
    }
  }, []);

  const loadProject = useCallback(async () => {
    if (!id) {
      setProject(null);
      setClips([]);
      setJobs([]);
      setLoadingProject(false);
      return;
    }
    try {
      const data = await apiRequest<YouTubeProjectDetailResponse>(`/api/youtube/projects/${id}`);
      setProject(data.project);
      setClips(data.clips);
      setJobs(data.jobs);
      if (data.project.source_url) {
        setUrlInput(data.project.source_url);
      }
      if (data.project.youtube_metadata && data.project.youtube_video_id) {
        setValidatedMeta({
          videoId: data.project.youtube_video_id,
          normalizedUrl:
            data.project.source_url ||
            `https://www.youtube.com/watch?v=${data.project.youtube_video_id}`,
          metadata: data.project.youtube_metadata,
        });
      }
      setClipEdits((prev) => {
        const next: Record<string, { title: string; start_time: number; end_time: number }> = {};
        for (const c of data.clips) {
          next[c.id] = prev[c.id] || {
            title: c.title,
            start_time: c.start_time,
            end_time: c.end_time,
          };
        }
        return next;
      });
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to load YouTube project.', 'error');
    } finally {
      setLoadingProject(false);
    }
  }, [id, notify]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    setLoadingProject(Boolean(id));
    loadProject();
  }, [id, loadProject]);

  const hasActiveJob =
    Boolean(project && ACTIVE_STATUSES.includes(project.status)) ||
    jobs.some((j) => ACTIVE_STATUSES.includes(j.status));

  useEffect(() => {
    if (!id || !hasActiveJob) return;
    const timer = setInterval(() => {
      loadProject();
      loadHistory();
    }, 2000);
    return () => clearInterval(timer);
  }, [id, hasActiveJob, loadProject, loadHistory]);

  const validateYouTubeUrlValue = useCallback(
    async (rawUrl: string) => {
      setImportError(null);
      if (!rawUrl.trim()) {
        setImportError('Paste a public YouTube URL first.');
        return;
      }
      setValidating(true);
      try {
        const res = await apiRequest<ValidateResponse>('/api/youtube/validate', {
          method: 'POST',
          body: JSON.stringify({ url: rawUrl.trim() }),
        });
        setValidatedMeta({
          videoId: res.videoId,
          normalizedUrl: res.normalizedUrl,
          metadata: res.metadata,
        });
        setUrlInput(res.normalizedUrl);
        notify(`Validated YouTube video: ${res.metadata.title}`, 'success');
      } catch (err) {
        setValidatedMeta(null);
        setImportError(err instanceof Error ? err.message : 'Failed to validate YouTube URL.');
      } finally {
        setValidating(false);
      }
    },
    [notify]
  );

  useEffect(() => {
    const urlParam = searchParams.get('url');
    if (!id && urlParam && prefillHandledRef.current !== urlParam) {
      prefillHandledRef.current = urlParam;
      setUrlInput(urlParam);
      void validateYouTubeUrlValue(urlParam);
    }
  }, [id, searchParams, validateYouTubeUrlValue]);

  const handleValidateUrl = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await validateYouTubeUrlValue(urlInput);
  };

  const getDurationBounds = () => {
    if (durationRange === '15-30') return { minDuration: 15, maxDuration: 30 };
    if (durationRange === '45-60') return { minDuration: 45, maxDuration: 60 };
    if (durationRange === '60-90') return { minDuration: 60, maxDuration: 90 };
    return { minDuration: 30, maxDuration: 45 };
  };

  const handleStartAnalysis = async () => {
    setImportError(null);
    const { minDuration, maxDuration } = getDurationBounds();

    if (!id && !urlInput.trim()) {
      setImportError('Enter a YouTube URL to start.');
      return;
    }

    setAnalyzing(true);
    try {
      let result: { project: Project; job?: ProcessingJob };

      if (subtitleFile) {
        const form = new FormData();
        form.append('subtitle', subtitleFile);
        if (id) form.append('projectId', id);
        else form.append('url', urlInput.trim());
        form.append('minDuration', String(minDuration));
        form.append('maxDuration', String(maxDuration));
        form.append('clipCount', String(clipCount));
        form.append('contentStyle', contentStyle);
        form.append('preset', preset);
        result = await apiRequest<{ project: Project; job?: ProcessingJob }>(
          '/api/youtube/analyze',
          {
            method: 'POST',
            body: form,
          }
        );
      } else {
        result = await apiRequest<{ project: Project; job?: ProcessingJob }>(
          '/api/youtube/analyze',
          {
            method: 'POST',
            body: JSON.stringify({
              projectId: id || undefined,
              url: id ? undefined : urlInput.trim(),
              transcriptText: transcriptText.trim() || undefined,
              minDuration,
              maxDuration,
              clipCount,
              contentStyle,
              preset,
            }),
          }
        );
      }

      notify('AI viral moment analysis started.', 'info');
      setSubtitleFile(null);
      loadHistory();
      if (!id || id !== result.project.id) {
        navigate(`/dashboard/youtube/${result.project.id}`);
      } else {
        loadProject();
      }
    } catch (err) {
      if (err instanceof ApiError && err.data?.project) {
        const preserved = err.data.project as Project;
        setImportError(err.message);
        loadHistory();
        if (!id && preserved.id) {
          notify(
            'YouTube project saved with metadata. Add an .srt/.vtt transcript or upload your source video below.',
            'info'
          );
          navigate(`/dashboard/youtube/${preserved.id}`);
        } else {
          loadProject();
        }
      } else {
        setImportError(err instanceof Error ? err.message : 'Unable to start analysis.');
      }
    } finally {
      setAnalyzing(false);
    }
  };

  const handleToggleSelectClip = async (clip: Clip) => {
    const nextSelected = !clip.is_selected;
    setClips((prev) =>
      prev.map((c) => (c.id === clip.id ? { ...c, is_selected: nextSelected } : c))
    );
    try {
      await apiRequest(`/api/clips/${clip.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_selected: nextSelected }),
      });
    } catch (err) {
      setClips((prev) =>
        prev.map((c) => (c.id === clip.id ? { ...c, is_selected: clip.is_selected } : c))
      );
      notify(err instanceof Error ? err.message : 'Could not update selection.', 'error');
    }
  };

  const handleBulkSelect = async (selected: boolean) => {
    setClips((prev) => prev.map((c) => ({ ...c, is_selected: selected })));
    try {
      await Promise.all(
        clips.map((c) =>
          apiRequest(`/api/clips/${c.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ is_selected: selected }),
          })
        )
      );
    } catch {
      loadProject();
    }
  };

  const handleSaveClipEdits = async (clip: Clip) => {
    const edit = clipEdits[clip.id];
    if (!edit) return;
    setSavingClipId(clip.id);
    try {
      const res = await apiRequest<{ clip: Clip }>(`/api/clips/${clip.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: edit.title,
          start_time: edit.start_time,
          end_time: edit.end_time,
        }),
      });
      setClips((prev) => prev.map((c) => (c.id === clip.id ? res.clip : c)));
      notify('Clip title and timestamps saved.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save clip edits.', 'error');
    } finally {
      setSavingClipId(null);
    }
  };

  const handleAdjustDuration = (clipId: string, deltaSeconds: number) => {
    setClipEdits((prev) => {
      const curr = prev[clipId];
      if (!curr) return prev;
      const nextEnd = Math.max(curr.start_time + 5, Number((curr.end_time + deltaSeconds).toFixed(1)));
      return {
        ...prev,
        [clipId]: { ...curr, end_time: nextEnd },
      };
    });
  };

  const handlePreviewClip = (clip: Clip) => {
    const edit = clipEdits[clip.id];
    const start = edit ? edit.start_time : clip.start_time;
    const end = edit ? edit.end_time : clip.end_time;
    setSeekSeconds(start);
    setSeekTrigger((n) => n + 1);
    setPreviewClipLabel(
      `#${clip.clip_index || ''} ${clip.title} (${formatTimecode(start)} – ${formatTimecode(end)})`
    );
  };

  const handleRenderSelected = async (clipIds?: string[]) => {
    if (!project) return;
    if (!project.source_file) {
      notify(
        'Upload your authorized source video below before rendering MP4 clips.',
        'info'
      );
      uploadSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    setRenderingAll(true);
    try {
      const res = await apiRequest<{ queuedCount: number }>(
        `/api/youtube/projects/${project.id}/render`,
        {
          method: 'POST',
          body: JSON.stringify({ clipIds, preset }),
        }
      );
      notify(
        `Queued ${res.queuedCount} Dark Cinematic 9:16 MP4 render job(s).`,
        'success'
      );
      loadProject();
    } catch (err) {
      if (err instanceof ApiError && err.data?.requiresSourceUpload) {
        notify(err.message, 'info');
        uploadSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        loadProject();
      } else {
        notify(err instanceof Error ? err.message : 'Could not start rendering.', 'error');
      }
    } finally {
      setRenderingAll(false);
    }
  };

  const handleCancelJob = async (jobId: string) => {
    try {
      await apiRequest(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
      notify('Job cancelled.', 'info');
      loadProject();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to cancel job.', 'error');
    }
  };

  const handleRetryJob = async (jobId: string) => {
    try {
      await apiRequest(`/api/jobs/${jobId}/retry`, { method: 'POST' });
      notify('Job queued for retry.', 'info');
      loadProject();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to retry job.', 'error');
    }
  };

  const activeMeta = project?.youtube_metadata || validatedMeta?.metadata || null;
  const activeVideoId = project?.youtube_video_id || validatedMeta?.videoId || '';
  const selectedClipsCount = clips.filter((c) => c.is_selected).length;
  const renderedClipsCount = clips.filter((c) => Boolean(c.output_file)).length;
  const latestAnalyzeJob = jobs.find(
    (j) => j.job_type === 'youtube_analyze' || j.job_type === 'analyze'
  );

  return (
    <WorkspaceLayout
      title={project ? project.title : 'YouTube AI Viral Clipper'}
      breadcrumb={
        project
          ? `CLIPFORGE / YouTube Clipper / ${project.status}`
          : 'CLIPFORGE / YouTube Clipper'
      }
      action={
        project ? (
          <div className="flex items-center gap-2">
            <Link
              to="/dashboard/youtube"
              onClick={() => {
                setValidatedMeta(null);
                setUrlInput('');
                setTranscriptText('');
                setSubtitleFile(null);
                setImportError(null);
              }}
              className="px-3 py-1.5 rounded-lg border border-white/15 bg-[#141414] hover:bg-[#1B1B1B] text-xs font-medium text-zinc-200 whitespace-nowrap"
            >
              New YouTube Link
            </Link>
            <Link
              to={`/dashboard/project/${project.id}`}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold whitespace-nowrap"
            >
              <Sliders className="w-3.5 h-3.5" />
              Fine-Tune Studio
            </Link>
          </div>
        ) : undefined
      }
    >
      {loadingProject ? (
        <div className="py-20 flex items-center justify-center gap-2 text-sm text-zinc-400">
          <Loader2 className="w-4 h-4 animate-spin text-[#8B5CF6]" />
          Loading YouTube clipping project...
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* LEFT / MAIN COLUMN */}
          <div className="xl:col-span-8 space-y-6">
            {/* 1. YouTube URL Import & Preview Card */}
            <section className="bg-[#141414] border border-white/[0.08] rounded-xl p-5 sm:p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-base font-semibold text-white flex items-center gap-2">
                    <Youtube className="w-4 h-4 text-[#8B5CF6]" />
                    {project ? 'Linked YouTube Source' : '1. Paste Public YouTube Link'}
                  </h2>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Supports standard YouTube watch URLs, youtu.be short links, and YouTube Shorts.
                  </p>
                </div>
                {project && (
                  <span
                    className={`px-2.5 py-1 rounded-md text-xs font-medium border ${
                      project.status === 'Completed'
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                        : project.status === 'Failed'
                          ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                          : project.status === 'Waiting for source video'
                            ? 'bg-amber-500/15 border-amber-500/30 text-amber-200'
                            : 'bg-[#8B5CF6]/15 border-[#8B5CF6]/35 text-[#C4B5FD]'
                    }`}
                  >
                    {project.status}
                  </span>
                )}
              </div>

              {!project && (
                <form onSubmit={handleValidateUrl} className="flex flex-col sm:flex-row gap-2.5">
                  <div className="relative flex-1">
                    <Link2 className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={urlInput}
                      onChange={(e) => {
                        setUrlInput(e.target.value);
                        setImportError(null);
                      }}
                      placeholder="https://www.youtube.com/watch?v=... or https://youtu.be/... or /shorts/..."
                      className="w-full rounded-lg bg-[#090909] border border-white/10 pl-10 pr-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-[#8B5CF6]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={validating}
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-white text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors"
                  >
                    {validating && <Loader2 className="w-4 h-4 animate-spin" />}
                    Validate & Preview
                  </button>
                </form>
              )}

              {importError && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-start gap-2.5 text-xs text-amber-100 leading-relaxed">
                  <AlertCircle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
                  <p>{importError}</p>
                </div>
              )}

              {/* Preview Card + Official Embedded Player */}
              {activeMeta && activeVideoId && (
                <div className="space-y-4">
                  <div className="rounded-xl bg-[#1B1B1B] border border-white/[0.08] p-4 flex flex-col sm:flex-row gap-4">
                    {activeMeta.thumbnailUrl && isSafeExternalUrl(activeMeta.thumbnailUrl) && (
                      <img
                        src={activeMeta.thumbnailUrl}
                        alt={activeMeta.title}
                        className="w-full sm:w-44 aspect-video rounded-lg object-cover bg-[#090909] shrink-0 border border-white/[0.08]"
                        referrerPolicy="no-referrer"
                      />
                    )}
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="px-2 py-0.5 rounded bg-[#8B5CF6]/20 border border-[#8B5CF6]/40 text-[#C4B5FD] font-medium">
                          YouTube · {activeVideoId}
                        </span>
                        {activeMeta.durationSec !== null && (
                          <span className="font-mono text-zinc-300 flex items-center gap-1">
                            <Clock className="w-3 h-3 text-zinc-400" />
                            {formatDuration(activeMeta.durationSec)}
                          </span>
                        )}
                        <span className="text-zinc-500">
                          {activeMeta.metadataSource === 'youtube_data_api'
                            ? 'YouTube Data API v3'
                            : 'YouTube Official oEmbed'}
                        </span>
                      </div>
                      <h3 className="text-sm sm:text-base font-semibold text-white line-clamp-2">
                        {activeMeta.title}
                      </h3>
                      <p className="text-xs text-zinc-400">
                        Channel: <span className="text-zinc-200">{activeMeta.channelTitle}</span>
                      </p>
                      {activeMeta.description && (
                        <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                          {activeMeta.description}
                        </p>
                      )}
                      {project?.source_url && isSafeExternalUrl(project.source_url) && (
                        <a
                          href={project.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-[#C4B5FD] hover:text-white underline pt-0.5"
                        >
                          Open original YouTube link
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>

                  <YouTubeEmbedPlayer
                    videoId={activeVideoId}
                    title={activeMeta.title}
                    thumbnailUrl={activeMeta.thumbnailUrl}
                    embeddable={activeMeta.embeddable}
                    seekToSeconds={seekSeconds}
                    seekTrigger={seekTrigger}
                    activeRangeLabel={previewClipLabel}
                  />
                </div>
              )}
            </section>

            {/* 2. Authorized Transcript & AI Analysis Setup */}
            {(validatedMeta || project) && (
              <section className="bg-[#141414] border border-white/[0.08] rounded-xl p-5 sm:p-6 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-base font-semibold text-white flex items-center gap-2">
                      <FileText className="w-4 h-4 text-[#8B5CF6]" />
                      2. Authorized Transcript & Dark Cinematic AI Analysis
                    </h2>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      {activeMeta?.captionsNote ||
                        'Provide an authorized .srt/.vtt subtitle file, timestamped transcript, or upload your source video.'}
                    </p>
                  </div>
                  {project?.transcript && project.transcript.length > 0 && (
                    <span className="px-2.5 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-xs font-medium text-emerald-300">
                      {project.transcript.length} transcript segments ready
                    </span>
                  )}
                </div>

                {/* Live processing stage indicator */}
                {latestAnalyzeJob && (
                  <div className="rounded-xl bg-[#1B1B1B] border border-white/[0.08] p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        {ACTIVE_STATUSES.includes(latestAnalyzeJob.status) ? (
                          <Loader2 className="w-4 h-4 animate-spin text-[#8B5CF6]" />
                        ) : latestAnalyzeJob.status === 'Completed' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-rose-400" />
                        )}
                        <span className="font-semibold text-white">
                          {project?.status || latestAnalyzeJob.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        {latestAnalyzeJob.progress !== null && (
                          <span className="font-mono text-zinc-300">
                            {latestAnalyzeJob.progress}%
                          </span>
                        )}
                        {ACTIVE_STATUSES.includes(latestAnalyzeJob.status) ? (
                          <button
                            type="button"
                            onClick={() => handleCancelJob(latestAnalyzeJob.id)}
                            className="text-rose-400 hover:underline flex items-center gap-1"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Cancel
                          </button>
                        ) : latestAnalyzeJob.status === 'Failed' ? (
                          <button
                            type="button"
                            onClick={() => handleRetryJob(latestAnalyzeJob.id)}
                            className="text-[#C4B5FD] hover:underline flex items-center gap-1"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            Retry
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <p className="text-xs text-zinc-400">{latestAnalyzeJob.stage_label}</p>

                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5 pt-1">
                      {YOUTUBE_STAGE_STEPS.map((step, idx) => {
                        const currIdx = YOUTUBE_STAGE_STEPS.findIndex(
                          (s) => s.status === latestAnalyzeJob.status || s.status === project?.status
                        );
                        const isDone =
                          latestAnalyzeJob.status === 'Completed' ||
                          (currIdx >= 0 && idx < currIdx);
                        const isCurrent =
                          latestAnalyzeJob.status !== 'Completed' && currIdx === idx;
                        return (
                          <div
                            key={step.status}
                            className={`px-2 py-1.5 rounded-md text-[10px] border truncate ${
                              isCurrent
                                ? 'bg-[#8B5CF6]/20 border-[#8B5CF6] text-white font-medium'
                                : isDone
                                  ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                                  : 'bg-[#090909] border-white/[0.06] text-zinc-500'
                            }`}
                          >
                            {step.label}
                          </div>
                        );
                      })}
                    </div>

                    {latestAnalyzeJob.error_message && (
                      <p className="text-xs text-rose-300">{latestAnalyzeJob.error_message}</p>
                    )}
                  </div>
                )}

                {project?.ai_analysis_summary && (
                  <div className="rounded-lg bg-[#1B1B1B] border border-[#D4AF37]/30 p-3.5 text-xs text-zinc-200 leading-relaxed">
                    <span className="font-semibold text-[#D4AF37] mr-1.5">AI Editorial Summary:</span>
                    {project.ai_analysis_summary}
                  </div>
                )}

                {/* Transcript Inputs (only needed if re-running or no transcript yet) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-zinc-300">
                      Upload subtitle or transcript file (.srt, .vtt, .txt, .json)
                    </label>
                    <input
                      ref={subtitleInputRef}
                      type="file"
                      accept=".srt,.vtt,.txt,.json"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) setSubtitleFile(f);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => subtitleInputRef.current?.click()}
                      className="w-full rounded-lg border border-dashed border-white/15 hover:border-[#8B5CF6] bg-[#090909] px-4 py-3 text-left transition-colors flex items-center justify-between gap-2"
                    >
                      <span className="text-xs text-zinc-300 truncate">
                        {subtitleFile
                          ? `${subtitleFile.name} (${formatBytes(subtitleFile.size)})`
                          : 'Choose .srt, .vtt, .txt, or .json transcript file'}
                      </span>
                      <Upload className="w-4 h-4 text-[#8B5CF6] shrink-0" />
                    </button>
                    {subtitleFile && (
                      <button
                        type="button"
                        onClick={() => setSubtitleFile(null)}
                        className="text-[11px] text-zinc-400 hover:text-white"
                      >
                        Remove file
                      </button>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-zinc-300">
                      Or paste timestamped transcript (YouTube transcript panel format)
                    </label>
                    <textarea
                      rows={3}
                      value={transcriptText}
                      onChange={(e) => setTranscriptText(e.target.value)}
                      placeholder={'0:00\nWhen someone shows you who they are...\n0:08\nBelieve them the first time.'}
                      className="w-full rounded-lg bg-[#090909] border border-white/10 px-3 py-2 text-xs font-mono text-white placeholder-zinc-600 focus:outline-none focus:border-[#8B5CF6]"
                    />
                  </div>
                </div>

                {/* Editorial Preset & Moment Detection Controls */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      Default editing preset
                    </label>
                    <select
                      value={preset}
                      onChange={(e) => setPreset(e.target.value as CaptionPresetId)}
                      className="w-full rounded-lg bg-[#090909] border border-white/10 px-2.5 py-2 text-xs text-white focus:outline-none focus:border-[#8B5CF6]"
                    >
                      {CAPTION_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} {p.id === 'DARK CINEMATIC' ? '(Default)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      Viral moment focus
                    </label>
                    <select
                      value={contentStyle}
                      onChange={(e) => setContentStyle(e.target.value)}
                      className="w-full rounded-lg bg-[#090909] border border-white/10 px-2.5 py-2 text-xs text-white focus:outline-none focus:border-[#8B5CF6]"
                    >
                      {CONTENT_STYLES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Clip duration</label>
                    <select
                      value={durationRange}
                      onChange={(e) => setDurationRange(e.target.value)}
                      className="w-full rounded-lg bg-[#090909] border border-white/10 px-2.5 py-2 text-xs text-white focus:outline-none focus:border-[#8B5CF6]"
                    >
                      <option value="15-30">15–30 seconds</option>
                      <option value="30-45">30–45 seconds</option>
                      <option value="45-60">45–60 seconds</option>
                      <option value="60-90">60–90 seconds</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      Candidate suggestions
                    </label>
                    <select
                      value={clipCount}
                      onChange={(e) => setClipCount(Number(e.target.value))}
                      className="w-full rounded-lg bg-[#090909] border border-white/10 px-2.5 py-2 text-xs text-white focus:outline-none focus:border-[#8B5CF6]"
                    >
                      <option value={5}>Top 5 moments</option>
                      <option value={10}>Top 10 moments (Recommended)</option>
                      <option value={15}>Top 15 moments</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <p className="text-[11px] text-zinc-400">
                    Dark Cinematic defaults: 9:16 vertical · white bold captions · gold/violet keyword highlights · subtle push-in zoom
                  </p>
                  <button
                    type="button"
                    disabled={analyzing || hasActiveJob}
                    onClick={handleStartAnalysis}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-white text-xs sm:text-sm font-semibold transition-colors"
                  >
                    {analyzing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                    {clips.length > 0 ? 'Re-Analyze & Refresh Suggestions' : `Find Top ${clipCount} Viral Moments`}
                  </button>
                </div>
              </section>
            )}

            {/* 3. Top 10 Candidate Clip Suggestions */}
            {project && (
              <section className="bg-[#141414] border border-white/[0.08] rounded-xl p-5 sm:p-6 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-base font-semibold text-white flex items-center gap-2">
                      <Scissors className="w-4 h-4 text-[#8B5CF6]" />
                      3. Viral Clip Suggestions ({clips.length})
                    </h2>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      {selectedClipsCount} selected · {renderedClipsCount} rendered MP4(s) ready
                    </p>
                  </div>

                  {clips.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleBulkSelect(true)}
                        className="px-2.5 py-1.5 rounded-lg border border-white/10 hover:bg-white/[0.05] text-xs text-zinc-300"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={() => handleBulkSelect(false)}
                        className="px-2.5 py-1.5 rounded-lg border border-white/10 hover:bg-white/[0.05] text-xs text-zinc-300"
                      >
                        Deselect all
                      </button>
                      <button
                        type="button"
                        disabled={renderingAll || selectedClipsCount === 0}
                        onClick={() => handleRenderSelected()}
                        className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-white text-xs font-semibold transition-colors"
                      >
                        {renderingAll ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Film className="w-3.5 h-3.5" />
                        )}
                        {project.source_file
                          ? `Render Selected (${selectedClipsCount})`
                          : `Provide Video to Render (${selectedClipsCount})`}
                      </button>
                    </div>
                  )}
                </div>

                {clips.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-xs text-zinc-400">
                    No clip suggestions generated yet. Provide an authorized .srt/.vtt transcript above or upload your source video below to detect up to 10 viral moments.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {clips.map((clip, idx) => {
                      const edit = clipEdits[clip.id] || {
                        title: clip.title,
                        start_time: clip.start_time,
                        end_time: clip.end_time,
                      };
                      const clipDuration = Math.max(0, edit.end_time - edit.start_time);
                      const exportJob = jobs.find(
                        (j) => j.job_type === 'export' && j.clip_id === clip.id
                      );
                      const isExporting =
                        exportJob &&
                        ['Queued', 'Rendering', 'Exporting'].includes(exportJob.status);
                      const isDirty =
                        edit.title !== clip.title ||
                        edit.start_time !== clip.start_time ||
                        edit.end_time !== clip.end_time;

                      return (
                        <div
                          key={clip.id}
                          className={`rounded-xl border p-4 sm:p-5 space-y-3 transition-colors ${
                            clip.is_selected
                              ? 'bg-[#1B1B1B] border-[#8B5CF6]/45'
                              : 'bg-[#111111] border-white/[0.07] opacity-80'
                          }`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="flex items-start gap-3 flex-1 min-w-0">
                              <input
                                type="checkbox"
                                checked={clip.is_selected}
                                onChange={() => handleToggleSelectClip(clip)}
                                aria-label={`Select clip ${idx + 1}`}
                                className="mt-1.5 accent-[#8B5CF6] w-4 h-4 shrink-0 cursor-pointer"
                              />
                              <div className="min-w-0 flex-1 space-y-1.5">
                                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                  <span className="px-2 py-0.5 rounded bg-[#090909] border border-white/10 font-mono text-white font-semibold">
                                    Clip #{clip.clip_index || idx + 1}
                                  </span>
                                  <span className="px-2 py-0.5 rounded bg-[#8B5CF6]/15 border border-[#8B5CF6]/35 text-[#C4B5FD]">
                                    {clip.category}
                                  </span>
                                  {clip.ai_score > 0 && (
                                    <span className="px-2 py-0.5 rounded bg-[#D4AF37]/15 border border-[#D4AF37]/35 text-[#D4AF37] font-mono">
                                      Score {clip.ai_score}/100
                                    </span>
                                  )}
                                  <span className="font-mono text-zinc-400">
                                    {formatTimecode(edit.start_time)} – {formatTimecode(edit.end_time)} ({clipDuration.toFixed(1)}s)
                                  </span>
                                </div>

                                <input
                                  type="text"
                                  value={edit.title}
                                  onChange={(e) =>
                                    setClipEdits((prev) => ({
                                      ...prev,
                                      [clip.id]: { ...edit, title: e.target.value },
                                    }))
                                  }
                                  aria-label="Clip title"
                                  className="w-full rounded-lg bg-[#090909] border border-white/10 px-3 py-1.5 text-sm font-semibold text-white focus:outline-none focus:border-[#8B5CF6]"
                                />
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              {activeVideoId && (
                                <button
                                  type="button"
                                  onClick={() => handlePreviewClip(clip)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 bg-[#090909] hover:bg-white/[0.06] text-xs font-medium text-white"
                                >
                                  <Play className="w-3.5 h-3.5 text-[#8B5CF6]" />
                                  Preview
                                </button>
                              )}
                              <Link
                                to={`/dashboard/project/${project.id}?clip=${clip.id}`}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/[0.06] text-xs text-zinc-300"
                              >
                                <Sliders className="w-3.5 h-3.5" />
                                Studio
                              </Link>
                              {clip.export_media_url ? (
                                <a
                                  href={`${clip.export_media_url}&download=1`}
                                  download
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 text-xs font-semibold text-emerald-200"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  MP4 ({formatBytes(clip.output_size)})
                                </a>
                              ) : project.source_file ? (
                                <button
                                  type="button"
                                  disabled={Boolean(isExporting)}
                                  onClick={() => handleRenderSelected([clip.id])}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-xs font-semibold text-white"
                                >
                                  {isExporting ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Film className="w-3.5 h-3.5" />
                                  )}
                                  {isExporting ? `${exportJob?.progress ?? 0}%` : 'Render MP4'}
                                </button>
                              ) : (
                                <span className="px-2.5 py-1 rounded-md bg-[#090909] border border-white/10 text-[11px] text-zinc-400">
                                  Needs source video
                                </span>
                              )}
                            </div>
                          </div>

                          {clip.hook && (
                            <p className="text-xs text-zinc-200 pl-7">
                              <span className="text-zinc-400 font-medium">Opening hook: </span>
                              {clip.hook}
                            </p>
                          )}

                          {clip.reason && (
                            <p className="text-[11px] text-zinc-400 pl-7">{clip.reason}</p>
                          )}

                          <div className="ml-7 rounded-lg bg-[#090909] border border-white/[0.06] p-3 text-xs text-zinc-300 leading-relaxed line-clamp-3">
                            “{clip.transcript}”
                          </div>

                          {/* Timestamp & Duration Editor */}
                          <div className="pl-7 flex flex-wrap items-center gap-3 pt-1 text-xs">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] text-zinc-400">Start (s)</span>
                              <input
                                type="number"
                                step="0.1"
                                min={0}
                                value={edit.start_time}
                                onChange={(e) =>
                                  setClipEdits((prev) => ({
                                    ...prev,
                                    [clip.id]: {
                                      ...edit,
                                      start_time: Math.max(0, Number(e.target.value)),
                                    },
                                  }))
                                }
                                className="w-20 rounded bg-[#090909] border border-white/10 px-2 py-1 text-xs font-mono text-white"
                              />
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] text-zinc-400">End (s)</span>
                              <input
                                type="number"
                                step="0.1"
                                min={edit.start_time + 1}
                                value={edit.end_time}
                                onChange={(e) =>
                                  setClipEdits((prev) => ({
                                    ...prev,
                                    [clip.id]: {
                                      ...edit,
                                      end_time: Math.max(
                                        edit.start_time + 1,
                                        Number(e.target.value)
                                      ),
                                    },
                                  }))
                                }
                                className="w-20 rounded bg-[#090909] border border-white/10 px-2 py-1 text-xs font-mono text-white"
                              />
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleAdjustDuration(clip.id, -5)}
                                className="px-2 py-1 rounded bg-[#090909] border border-white/10 hover:border-white/25 text-[11px] font-mono text-zinc-300"
                              >
                                -5s
                              </button>
                              <button
                                type="button"
                                onClick={() => handleAdjustDuration(clip.id, 5)}
                                className="px-2 py-1 rounded bg-[#090909] border border-white/10 hover:border-white/25 text-[11px] font-mono text-zinc-300"
                              >
                                +5s
                              </button>
                            </div>
                            {isDirty && (
                              <button
                                type="button"
                                disabled={savingClipId === clip.id}
                                onClick={() => handleSaveClipEdits(clip)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#8B5CF6]/20 border border-[#8B5CF6]/50 text-[11px] font-medium text-[#C4B5FD] hover:text-white"
                              >
                                {savingClipId === clip.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Save className="w-3 h-3" />
                                )}
                                Save edits
                              </button>
                            )}
                          </div>

                          {isExporting && exportJob && (
                            <div className="ml-7 pt-1 space-y-1">
                              <div className="flex justify-between text-[11px] text-zinc-400">
                                <span>{exportJob.stage_label}</span>
                                <span className="font-mono">{exportJob.progress ?? 0}%</span>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-[#090909] overflow-hidden">
                                <div
                                  style={{ width: `${exportJob.progress ?? 0}%` }}
                                  className="h-full bg-[#8B5CF6] transition-all"
                                />
                              </div>
                            </div>
                          )}

                          {exportJob?.status === 'Failed' && exportJob.error_message && (
                            <p className="ml-7 text-[11px] text-rose-300">
                              Export failed: {exportJob.error_message}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* 4. Authorized Source Video Upload & Rendering */}
            {project && (
              <section
                ref={uploadSectionRef}
                className="bg-[#141414] border border-white/[0.08] rounded-xl p-5 sm:p-6 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-base font-semibold text-white flex items-center gap-2">
                      <Film className="w-4 h-4 text-[#8B5CF6]" />
                      4. Authorized Source Video & MP4 Rendering
                    </h2>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      {project.source_file
                        ? `Source attached (${project.resolution} · ${formatBytes(project.file_size)}). Selected clips can be rendered directly with FFmpeg.`
                        : 'Suggested timestamps are ready, and no MP4 has been rendered yet. Upload your authorized video file to render 9:16 Dark Cinematic MP4s.'}
                    </p>
                  </div>
                  {project.source_file && (
                    <span className="px-2.5 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-xs font-medium text-emerald-300 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" />
                      Source verified
                    </span>
                  )}
                </div>

                {!project.source_file && (
                  <div className="rounded-lg bg-[#1B1B1B] border border-white/[0.08] p-3.5 flex items-start gap-2.5 text-xs text-zinc-300 leading-relaxed">
                    <ShieldCheck className="w-4 h-4 text-[#8B5CF6] shrink-0 mt-0.5" />
                    <p>
                      CLIPFORGE never downloads or bypasses protected YouTube streams. Upload your downloaded YouTube Studio MP4, MOV, WEBM, or MKV file below to automatically transcribe (if no transcript was supplied) and render Dark Cinematic 9:16 MP4 files for all selected clips.
                    </p>
                  </div>
                )}

                <AuthorizedUploadZone
                  projectId={project.id}
                  projectTitle={project.title}
                  defaultAutoAnalyze={true}
                  showAutoAnalyzeToggle={true}
                  autoAnalyzeLabel={
                    clips.length > 0
                      ? 'Automatically render Dark Cinematic 9:16 MP4s for selected clips after upload'
                      : 'Automatically transcribe audio & detect top 10 viral clips after upload'
                  }
                  submitLabel={
                    project.source_file
                      ? 'Replace Source Video'
                      : clips.length > 0
                        ? 'Upload Video & Render Selected Clips'
                        : 'Upload Video & Find Viral Clips'
                  }
                  onUploadComplete={(res: UploadCompletePayload) => {
                    if (res.autoAnalysis?.action === 'rendering_clips') {
                      notify(
                        `Source uploaded! Queued ${res.autoAnalysis.queuedCount || 1} Dark Cinematic MP4 render(s).`,
                        'success'
                      );
                    } else if (res.autoAnalysis?.started) {
                      notify(
                        'Source uploaded! AI transcription and viral moment detection started.',
                        'success'
                      );
                    } else {
                      notify('Authorized source video uploaded and verified.', 'success');
                    }
                    loadProject();
                    loadHistory();
                  }}
                />
              </section>
            )}
          </div>

          {/* RIGHT SIDEBAR: Dark Cinematic Spec + Project History */}
          <aside className="xl:col-span-4 space-y-6">
            {/* Dark Cinematic Relationship Preset Spec Card */}
            <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-white">Dark Cinematic Relationship Preset</p>
                <span className="px-2 py-0.5 rounded bg-[#D4AF37]/15 border border-[#D4AF37]/35 text-[10px] font-medium text-[#D4AF37]">
                  Default
                </span>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Tailored for relationship podcasts and commentary on TikTok, Instagram Reels, and YouTube Shorts:
              </p>
              <ul className="space-y-1.5 text-xs text-zinc-300">
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-[#D4AF37] shrink-0" />
                  <span>9:16 vertical (1080×1920) speaker framing</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-[#D4AF37] shrink-0" />
                  <span>White bold subtitles with gold/violet keyword emphasis</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-[#D4AF37] shrink-0" />
                  <span>Subtle vignette, contrast curve & slow push-in zoom</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-[#D4AF37] shrink-0" />
                  <span>Lower-middle safe zone above social app UI</span>
                </li>
              </ul>
            </div>

            {/* YouTube Project History */}
            <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-[#8B5CF6]" />
                  YouTube Project History ({history.length})
                </h2>
              </div>

              {history.length === 0 ? (
                <p className="text-xs text-zinc-500">
                  Validated and analyzed YouTube projects will appear here so you can reopen them anytime.
                </p>
              ) : (
                <div className="space-y-2.5 max-h-[540px] overflow-y-auto pr-1">
                  {history.map((item) => {
                    const thumb = item.youtube_metadata?.thumbnailUrl;
                    const active = item.id === id;
                    return (
                      <Link
                        key={item.id}
                        to={`/dashboard/youtube/${item.id}`}
                        className={`block rounded-xl p-3 border transition-colors ${
                          active
                            ? 'bg-[#1B1B1B] border-[#8B5CF6]/60'
                            : 'bg-[#090909] border-white/[0.06] hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          {thumb && isSafeExternalUrl(thumb) && (
                            <img
                              src={thumb}
                              alt={item.title}
                              className="w-16 aspect-video rounded object-cover bg-[#141414] shrink-0"
                              referrerPolicy="no-referrer"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-white line-clamp-1">
                              {item.title}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-zinc-400">
                              <span>{item.clip_count ?? 0} clips</span>
                              <span aria-hidden="true">·</span>
                              <span>{item.exported_count ?? 0} MP4</span>
                              <span aria-hidden="true">·</span>
                              <span
                                className={`font-sans ${
                                  item.status === 'Completed'
                                    ? 'text-emerald-400'
                                    : item.status === 'Waiting for source video'
                                      ? 'text-amber-300'
                                      : 'text-zinc-300'
                                }`}
                              >
                                {item.status}
                              </span>
                            </div>
                          </div>
                          <ArrowRight className="w-3.5 h-3.5 text-zinc-500 shrink-0 mt-1" />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </WorkspaceLayout>
  );
}
