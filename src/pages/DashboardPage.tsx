import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Film,
  FolderOpen,
  HardDrive,
  Loader2,
  Plus,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiRequest } from '../lib/api';
import { formatBytes, formatDuration } from '../lib/presets';
import type { Clip, ProcessingJob, Project, StorageStats } from '../types';

export function DashboardPage() {
  const { user } = useAuth();
  const { notify } = useToast();

  const [projects, setProjects] = useState<Project[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [storage, setStorage] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [projRes, clipRes, jobRes, storeRes] = await Promise.all([
        apiRequest<{ projects: Project[] }>('/api/projects'),
        apiRequest<{ clips: Clip[] }>('/api/clips'),
        apiRequest<{ jobs: ProcessingJob[] }>('/api/jobs'),
        apiRequest<StorageStats>('/api/storage'),
      ]);
      setProjects(projRes.projects);
      setClips(clipRes.clips);
      setJobs(jobRes.jobs);
      setStorage(storeRes);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load dashboard data.', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Poll automatically while jobs are active
  useEffect(() => {
    const activeSet = new Set([
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
    ]);
    const hasActive = jobs.some((j) => activeSet.has(j.status));
    if (!hasActive) return;
    const timer = setInterval(loadData, 2500);
    return () => clearInterval(timer);
  }, [jobs, loadData]);

  const handleCancelJob = async (jobId: string) => {
    try {
      await apiRequest(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
      notify('Processing job cancelled.', 'info');
      loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to cancel job.', 'error');
    }
  };

  const handleRetryJob = async (jobId: string) => {
    try {
      await apiRequest(`/api/jobs/${jobId}/retry`, { method: 'POST' });
      notify('Job queued for retry.', 'info');
      loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to retry job.', 'error');
    }
  };

  const activeJobs = jobs.filter((j) =>
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

  return (
    <WorkspaceLayout
      title={`Welcome back, ${user?.username || 'Creator'}`}
      breadcrumb="CLIPFORGE Studio"
      action={
        <Link
          to="/dashboard/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          New Project
        </Link>
      }
    >
      {/* Real Account Summary Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Projects</span>
            <FolderOpen className="w-4 h-4 text-zinc-500" />
          </div>
          <p className="mt-2 font-display text-2xl font-bold tabular-nums text-white">
            {loading ? '—' : projects.length}
          </p>
        </div>

        <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Generated Clips</span>
            <Film className="w-4 h-4 text-zinc-500" />
          </div>
          <p className="mt-2 font-display text-2xl font-bold tabular-nums text-white">
            {loading ? '—' : clips.length}
          </p>
        </div>

        <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Active Queue</span>
            <Clock className="w-4 h-4 text-zinc-500" />
          </div>
          <p className="mt-2 font-display text-2xl font-bold tabular-nums text-white">
            {loading ? '—' : activeJobs.length}
          </p>
        </div>

        <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Storage Used</span>
            <HardDrive className="w-4 h-4 text-zinc-500" />
          </div>
          <p className="mt-2 font-display text-2xl font-bold tabular-nums text-white">
            {storage ? formatBytes(storage.totalUsedBytes) : '—'}
          </p>
          {storage?.diskFreeBytes !== null && storage?.diskFreeBytes !== undefined && (
            <p className="mt-1 text-[11px] text-zinc-500 font-mono">
              {formatBytes(storage.diskFreeBytes)} volume free
            </p>
          )}
        </div>
      </div>

      {/* Main Content Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Recent Projects */}
        <section className="lg:col-span-7 bg-[#141414] border border-white/[0.08] rounded-xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4 mb-5">
            <h2 className="font-display text-base font-semibold text-white">Recent Projects</h2>
            <Link
              to="/dashboard/projects"
              className="text-xs text-zinc-400 hover:text-white transition-colors whitespace-nowrap"
            >
              View all
            </Link>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 rounded-lg bg-[#1B1B1B] animate-pulse" />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="py-10 text-center border border-dashed border-white/10 rounded-xl px-4">
              <p className="text-sm font-medium text-white">No video projects yet</p>
              <p className="mt-1 text-xs text-zinc-400">
                Upload a long-form MP4, MOV, WEBM, or MKV to start generating vertical clips.
              </p>
              <Link
                to="/dashboard/new"
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Upload First Video
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {projects.slice(0, 5).map((proj) => (
                <Link
                  key={proj.id}
                  to={
                    proj.youtube_video_id
                      ? `/dashboard/youtube/${proj.id}`
                      : `/dashboard/project/${proj.id}`
                  }
                  className="py-3.5 flex items-center justify-between gap-4 hover:bg-white/[0.02] -mx-2 px-2 rounded-lg transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white truncate">{proj.title}</p>
                      {proj.source_platform && (
                        <span className="px-1.5 py-0.5 rounded bg-[#8B5CF6]/15 border border-[#8B5CF6]/35 text-[10px] font-medium text-[#C4B5FD] shrink-0">
                          {proj.source_platform}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400 font-mono">
                      <span>{formatDuration(proj.duration)}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {proj.resolution ||
                          (proj.status === 'Awaiting Upload'
                            ? 'Awaiting upload'
                            : proj.status === 'Waiting for source video'
                              ? 'Waiting for source'
                              : proj.status === 'Failed'
                                ? 'Failed'
                                : 'Inspecting')}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{proj.clip_count ?? 0} clips</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={`font-sans ${
                          proj.status === 'Awaiting Upload' ||
                          proj.status === 'Waiting for source video'
                            ? 'text-amber-300'
                            : proj.status === 'Completed'
                              ? 'text-emerald-400'
                              : 'text-zinc-300'
                        }`}
                      >
                        {proj.status}
                      </span>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-zinc-500 shrink-0" />
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Processing Queue */}
        <section className="lg:col-span-5 bg-[#141414] border border-white/[0.08] rounded-xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4 mb-5">
            <h2 className="font-display text-base font-semibold text-white">Processing Queue</h2>
            <button
              type="button"
              onClick={loadData}
              className="text-xs text-zinc-400 hover:text-white flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-16 rounded-lg bg-[#1B1B1B] animate-pulse" />
              ))}
            </div>
          ) : jobs.length === 0 ? (
            <div className="py-10 text-center border border-dashed border-white/10 rounded-xl px-4">
              <p className="text-sm text-zinc-300">Queue is idle</p>
              <p className="mt-1 text-xs text-zinc-500">
                Analysis and MP4 render jobs will report real status here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {jobs.slice(0, 6).map((job) => {
                const isRunning = [
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
                ].includes(job.status);

                return (
                  <div
                    key={job.id}
                    className="rounded-lg bg-[#1B1B1B] border border-white/[0.06] p-3.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-white truncate">
                          {job.job_type === 'export'
                            ? `Export: ${job.clip_title || 'Clip'}`
                            : job.job_type === 'youtube_analyze'
                              ? `YouTube AI: ${job.project_title || 'Project'}`
                              : `Analyze: ${job.project_title || 'Project'}`}
                        </p>
                        <p className="mt-0.5 text-[11px] text-zinc-400">
                          {job.stage_label || job.status}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {isRunning && (
                          <>
                            <Loader2 className="w-3.5 h-3.5 text-[#8B5CF6] animate-spin" />
                            <button
                              type="button"
                              onClick={() => handleCancelJob(job.id)}
                              title="Cancel job"
                              className="text-zinc-400 hover:text-rose-400 p-0.5"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        {job.status === 'Completed' && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        )}
                        {job.status === 'Failed' && (
                          <>
                            <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                            <button
                              type="button"
                              onClick={() => handleRetryJob(job.id)}
                              className="text-[11px] text-[#8B5CF6] hover:underline ml-1"
                            >
                              Retry
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {isRunning && job.progress !== null && (
                      <div className="mt-2.5">
                        <div className="h-1.5 w-full rounded-full bg-[#090909] overflow-hidden">
                          <div
                            style={{ width: `${job.progress}%` }}
                            className="h-full bg-[#8B5CF6] transition-all duration-300"
                          />
                        </div>
                        <p className="mt-1 text-[10px] font-mono text-zinc-400 text-right">
                          {job.progress}%
                        </p>
                      </div>
                    )}

                    {job.error_message && (
                      <p className="mt-2 text-[11px] text-rose-300 leading-snug">
                        {job.error_message}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Recently Generated Clips */}
      <section className="mt-8 bg-[#141414] border border-white/[0.08] rounded-xl p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4 mb-5">
          <h2 className="font-display text-base font-semibold text-white">
            Recently Generated Clips
          </h2>
          <Link
            to="/dashboard/clips"
            className="text-xs text-zinc-400 hover:text-white transition-colors whitespace-nowrap"
          >
            Open My Clips
          </Link>
        </div>

        {clips.length === 0 ? (
          <p className="text-xs text-zinc-500">
            No clips generated yet. Open a project to run AI transcript analysis or mark a manual clip.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {clips.slice(0, 6).map((clip) => (
              <Link
                key={clip.id}
                to={`/dashboard/project/${clip.project_id}?clip=${clip.id}`}
                className="rounded-lg bg-[#1B1B1B] border border-white/[0.06] hover:border-white/15 p-4 transition-colors"
              >
                <p className="text-sm font-medium text-white truncate">{clip.title}</p>
                <div className="mt-1.5 flex items-center gap-2 text-xs text-zinc-400 font-mono">
                  <span>{formatDuration(clip.end_time - clip.start_time)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{clip.aspect_ratio}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-sans">{clip.caption_preset}</span>
                </div>
                <p className="mt-2.5 text-xs text-zinc-400 line-clamp-2">
                  {clip.transcript || 'No spoken transcript text yet.'}
                </p>
                <div className="mt-3 pt-2.5 border-t border-white/[0.06] flex items-center justify-between text-[11px] text-zinc-400">
                  <span>{clip.project_title || 'Project'}</span>
                  <span className={clip.output_file ? 'text-emerald-400' : 'text-zinc-500'}>
                    {clip.output_file ? 'Exported MP4' : 'Draft'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </WorkspaceLayout>
  );
}
