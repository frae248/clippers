import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Info,
  Link2,
  Loader2,
  ShieldCheck,
  Upload,
  Youtube,
} from 'lucide-react';
import {
  AuthorizedUploadZone,
  type UploadCompletePayload,
} from '../components/AuthorizedUploadZone';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { useToast } from '../context/ToastContext';
import { ApiError, apiRequest } from '../lib/api';
import { inspectClientVideoUrl, isSafeExternalUrl } from '../lib/urlPlatform';
import type { Project } from '../types';

interface UrlCreateResponse {
  project: Project;
  requiresAuthorizedUpload?: boolean;
  platform?: string;
  studioHint?: string;
}

export function NewProjectPage() {
  const navigate = useNavigate();
  const { notify } = useToast();

  const [tab, setTab] = useState<'upload' | 'url'>('upload');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [videoUrl, setVideoUrl] = useState('');
  const [importingUrl, setImportingUrl] = useState(false);
  const [preservableFailure, setPreservableFailure] = useState<{
    message: string;
    url: string;
    platform: string;
  } | null>(null);

  // When a YouTube/TikTok/Instagram URL creates a preserved project awaiting authorized upload
  const [preservedProject, setPreservedProject] = useState<{
    project: Project;
    platform: string;
    studioHint: string;
  } | null>(null);

  const urlInspection = useMemo(() => inspectClientVideoUrl(videoUrl), [videoUrl]);

  const handleUploadComplete = (res: UploadCompletePayload) => {
    if (res.autoAnalysis?.started) {
      notify(
        'Video uploaded, verified with FFprobe, and connected to the AI clipping pipeline.',
        'success'
      );
    } else if (res.autoAnalysis?.reason) {
      notify(
        `Video uploaded and verified with FFprobe. ${res.autoAnalysis.reason}`,
        'info'
      );
    } else {
      notify('Video uploaded and inspected with FFprobe.', 'success');
    }
    navigate(`/dashboard/project/${res.project.id}`);
  };

  const submitUrlImport = async (preserveForUpload = false) => {
    setError(null);
    setPreservableFailure(null);

    if (!videoUrl.trim()) {
      setError('Enter a YouTube, TikTok, Instagram, or direct MP4/MOV/WEBM URL.');
      return;
    }

    if (urlInspection && !urlInspection.valid) {
      setError(urlInspection.error || 'Please enter a valid video URL.');
      return;
    }

    setImportingUrl(true);
    try {
      const res = await apiRequest<UrlCreateResponse>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          url: videoUrl.trim(),
          title: title.trim(),
          preserveForUpload,
        }),
      });

      if (res.requiresAuthorizedUpload) {
        const platform = res.platform || res.project.source_platform || 'External URL';
        setPreservedProject({
          project: res.project,
          platform,
          studioHint:
            res.studioHint ||
            'Direct extraction is unavailable for this platform. Upload your own authorized video file below to connect it to the AI clipping pipeline.',
        });
        if (!title.trim()) {
          setTitle(res.project.title);
        }
        notify(`Project saved with ${platform} link. Upload your video file to begin clipping.`, 'info');
      } else {
        notify('Video imported and verified with FFprobe.', 'success');
        navigate(`/dashboard/project/${res.project.id}`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.data?.canPreserveProject) {
        setPreservableFailure({
          message: err.message,
          url: String(err.data.normalizedUrl || videoUrl.trim()),
          platform: String(err.data.platform || 'Direct URL'),
        });
      } else {
        setError(err instanceof Error ? err.message : 'Failed to validate or import video URL.');
      }
    } finally {
      setImportingUrl(false);
    }
  };

  const handleUrlFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitUrlImport(false);
  };

  return (
    <WorkspaceLayout title="New Clipping Project" breadcrumb="CLIPFORGE / New Project">
      <div className="max-w-3xl">
        {/* Source Mode Tabs */}
        <div className="inline-flex items-center p-1 rounded-lg bg-[#141414] border border-white/[0.08] mb-6">
          <button
            type="button"
            onClick={() => {
              setTab('upload');
              setError(null);
              setPreservableFailure(null);
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              tab === 'upload'
                ? 'bg-[#8B5CF6] text-white'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            Upload video file (Primary)
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('url');
              setError(null);
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              tab === 'url'
                ? 'bg-[#8B5CF6] text-white'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Link2 className="w-3.5 h-3.5" />
            Paste video URL
          </button>
        </div>

        <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-6 sm:p-8">
          <div className="mb-6">
            <label htmlFor="project-title" className="block text-xs font-medium text-zinc-300 mb-1.5">
              Project title
            </label>
            <input
              id="project-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Episode 42 — Building Real Discipline"
              className="w-full rounded-lg bg-[#090909] border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-[#8B5CF6]"
            />
          </div>

          {error && (
            <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 flex items-start gap-2.5 text-xs text-rose-200 leading-relaxed">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <p className="flex-1">{error}</p>
            </div>
          )}

          {tab === 'upload' ? (
            <AuthorizedUploadZone
              projectTitle={title}
              defaultAutoAnalyze={true}
              showAutoAnalyzeToggle={true}
              submitLabel="Upload and inspect video"
              onFileSelected={(file) => {
                if (!title.trim()) {
                  setTitle(file.name.replace(/\.[^.]+$/, ''));
                }
              }}
              onUploadComplete={handleUploadComplete}
            />
          ) : preservedProject ? (
            <div className="space-y-6">
              {/* Preserved Linked Project Header */}
              <div className="rounded-xl bg-[#1B1B1B] border border-[#8B5CF6]/35 p-4 sm:p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-xs font-semibold text-white">
                      Project preserved · Ready for creator-studio upload
                    </span>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-md bg-[#8B5CF6]/20 border border-[#8B5CF6]/40 text-[11px] font-medium text-[#C4B5FD]">
                    {preservedProject.platform}
                  </span>
                </div>

                {preservedProject.project.source_url &&
                  isSafeExternalUrl(preservedProject.project.source_url) && (
                    <div className="rounded-lg bg-[#090909] border border-white/[0.08] px-3 py-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                          Original video link ({preservedProject.platform})
                        </p>
                        <a
                          href={preservedProject.project.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-[#C4B5FD] hover:text-white underline truncate block"
                        >
                          {preservedProject.project.source_url}
                        </a>
                      </div>
                      <a
                        href={preservedProject.project.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open original video link"
                        className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] shrink-0"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  )}

                <div className="flex items-start gap-2.5 text-xs text-zinc-300 leading-relaxed">
                  <ShieldCheck className="w-4 h-4 text-[#8B5CF6] shrink-0 mt-0.5" />
                  <p>{preservedProject.studioHint}</p>
                </div>
              </div>

              {/* Upload Authorized Video into Preserved Project */}
              <div>
                <p className="text-xs font-semibold text-white mb-3">
                  Upload your downloaded {preservedProject.platform} video (MP4, MOV, WEBM, MKV)
                </p>
                <AuthorizedUploadZone
                  projectId={preservedProject.project.id}
                  projectTitle={title || preservedProject.project.title}
                  defaultAutoAnalyze={true}
                  showAutoAnalyzeToggle={true}
                  submitLabel="Upload & start AI clipping"
                  onUploadComplete={handleUploadComplete}
                />
              </div>

              <div className="pt-4 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setPreservedProject(null);
                    setVideoUrl('');
                  }}
                  className="text-zinc-400 hover:text-white"
                >
                  Use a different URL
                </button>
                <Link
                  to={`/dashboard/project/${preservedProject.project.id}`}
                  className="inline-flex items-center gap-1.5 text-[#C4B5FD] hover:text-white font-medium"
                >
                  Open preserved project in Studio
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleUrlFormSubmit} className="space-y-5">
              <div>
                <label htmlFor="video-url" className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Video URL (YouTube, TikTok, Instagram, or direct MP4 / MOV / WEBM link)
                </label>
                <input
                  id="video-url"
                  type="text"
                  inputMode="url"
                  required
                  value={videoUrl}
                  onChange={(e) => {
                    setVideoUrl(e.target.value);
                    setError(null);
                    setPreservableFailure(null);
                  }}
                  placeholder="https://www.youtube.com/watch?v=... or https://cdn.example.com/episode.mp4"
                  className="w-full rounded-lg bg-[#090909] border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-[#8B5CF6]"
                />

                {/* Real-time platform detection */}
                {urlInspection && (
                  <div className="mt-3 rounded-lg bg-[#1B1B1B] border border-white/[0.08] p-3.5 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-zinc-400">Detected source:</span>
                        <span className="px-2 py-0.5 rounded bg-[#8B5CF6]/20 border border-[#8B5CF6]/40 text-[#C4B5FD] font-medium">
                          {urlInspection.platform}
                        </span>
                      </div>
                      {urlInspection.valid && isSafeExternalUrl(urlInspection.normalizedUrl) && (
                        <a
                          href={urlInspection.normalizedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-white truncate max-w-xs"
                        >
                          <span className="truncate">{urlInspection.normalizedUrl}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      )}
                    </div>
                    <p
                      className={`text-xs leading-relaxed ${
                        urlInspection.valid ? 'text-zinc-300' : 'text-amber-300'
                      }`}
                    >
                      {urlInspection.valid ? urlInspection.studioHint : urlInspection.error}
                    </p>
                  </div>
                )}
              </div>

              {preservableFailure && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 space-y-3 text-xs text-amber-100">
                  <div className="flex items-start gap-2.5 leading-relaxed">
                    <Info className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
                    <p>{preservableFailure.message}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 pl-6">
                    <button
                      type="button"
                      disabled={importingUrl}
                      onClick={() => submitUrlImport(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-semibold transition-colors"
                    >
                      Preserve project with link & upload video file
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTab('upload');
                        setPreservableFailure(null);
                      }}
                      className="text-zinc-300 hover:text-white underline"
                    >
                      Switch to direct upload tab
                    </button>
                  </div>
                </div>
              )}

              <div className="rounded-lg bg-[#1B1B1B] border border-white/[0.08] p-4 text-xs text-zinc-400 leading-relaxed space-y-1.5">
                <p className="font-medium text-zinc-200 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#8B5CF6]" />
                  Authorized Source & Platform Policy
                </p>
                <p>
                  Direct MP4, MOV, WEBM, and MKV uploads are our primary supported source. For YouTube, TikTok, and Instagram links, CLIPFORGE validates and saves your original video link and platform without scraping or bypassing platform protections—then lets you upload your downloaded creator-studio file straight into the AI clipping pipeline.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {urlInspection?.valid && urlInspection.platform === 'YouTube' && (
                  <Link
                    to={`/dashboard/youtube?url=${encodeURIComponent(urlInspection.normalizedUrl)}`}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-sm font-semibold transition-colors"
                  >
                    <Youtube className="w-4 h-4" />
                    Analyze in YouTube AI Clipper
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                )}

                <button
                  type="submit"
                  disabled={importingUrl || Boolean(urlInspection && !urlInspection.valid)}
                  className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 ${
                    urlInspection?.valid && urlInspection.platform === 'YouTube'
                      ? 'border border-white/15 bg-[#1B1B1B] hover:bg-white/10 text-white'
                      : 'bg-[#8B5CF6] hover:bg-[#7C3AED] text-white'
                  }`}
                >
                  {importingUrl && <Loader2 className="w-4 h-4 animate-spin" />}
                  {urlInspection?.requiresAuthorizedUpload
                    ? `Save ${urlInspection.platform} Project & Upload Video`
                    : 'Import and inspect URL'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </WorkspaceLayout>
  );
}
