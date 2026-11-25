import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ExternalLink, Plus, Search, Trash2 } from 'lucide-react';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { useToast } from '../context/ToastContext';
import { apiRequest } from '../lib/api';
import { formatBytes, formatDuration } from '../lib/presets';
import { isSafeExternalUrl } from '../lib/urlPlatform';
import type { Project } from '../types';

export function ProjectsPage() {
  const { notify } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const loadProjects = useCallback(async () => {
    try {
      const res = await apiRequest<{ projects: Project[] }>('/api/projects');
      setProjects(res.projects);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load projects.', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleDeleteSource = async (id: string) => {
    try {
      await apiRequest(`/api/projects/${id}?sourceOnly=true`, { method: 'DELETE' });
      notify('Source video removed while keeping generated clips.', 'info');
      loadProjects();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to delete source file.', 'error');
    }
  };

  const handleDeleteProject = async (id: string) => {
    try {
      await apiRequest(`/api/projects/${id}`, { method: 'DELETE' });
      notify('Project and associated clips deleted.', 'info');
      loadProjects();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to delete project.', 'error');
    }
  };

  const filtered = projects.filter((p) =>
    p.title.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <WorkspaceLayout
      title="My Projects"
      breadcrumb="CLIPFORGE / Projects"
      action={
        <Link
          to="/dashboard/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          New Project
        </Link>
      }
    >
      <div className="mb-6 max-w-sm relative">
        <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects..."
          className="w-full rounded-lg bg-[#141414] border border-white/[0.08] pl-10 pr-4 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-[#8B5CF6]"
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-[#141414] animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-12 text-center">
          <p className="text-sm font-medium text-white">No projects match your view</p>
          <p className="mt-1 text-xs text-zinc-400">
            Upload a long-form video to begin analyzing and clipping.
          </p>
        </div>
      ) : (
        <div className="bg-[#141414] border border-white/[0.08] rounded-xl divide-y divide-white/[0.08]">
          {filtered.map((proj) => {
            const awaitingSource =
              !proj.source_file &&
              (proj.status === 'Awaiting Upload' || proj.status === 'Waiting for source video');
            const thumbUrl =
              proj.youtube_metadata?.thumbnailUrl &&
              isSafeExternalUrl(proj.youtube_metadata.thumbnailUrl)
                ? proj.youtube_metadata.thumbnailUrl
                : null;
            const primaryRoute = proj.youtube_video_id
              ? `/dashboard/youtube/${proj.id}`
              : `/dashboard/project/${proj.id}`;

            return (
              <div
                key={proj.id}
                className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="min-w-0 flex items-start gap-3.5">
                  {thumbUrl && (
                    <Link
                      to={primaryRoute}
                      className="hidden sm:block w-24 h-14 rounded-lg overflow-hidden border border-white/10 bg-black shrink-0"
                    >
                      <img
                        src={thumbUrl}
                        alt={proj.title}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </Link>
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={primaryRoute}
                        className="font-display text-sm sm:text-base font-semibold text-white hover:text-[#C4B5FD] transition-colors truncate"
                      >
                        {proj.title}
                      </Link>
                      {proj.source_platform && (
                        <span className="px-2 py-0.5 rounded bg-[#8B5CF6]/15 border border-[#8B5CF6]/35 text-[10px] font-medium text-[#C4B5FD] shrink-0">
                          {proj.source_platform}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-zinc-400 font-mono">
                      <span>{formatDuration(proj.duration)}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {proj.resolution ||
                          (awaitingSource ? 'Awaiting upload' : '—')}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{proj.fps ? `${proj.fps} fps` : '—'}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {proj.source_file
                          ? formatBytes(proj.file_size)
                          : awaitingSource
                            ? 'Source needed'
                            : 'Source deleted'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{proj.clip_count ?? 0} clips</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={`font-sans ${
                          awaitingSource
                            ? 'text-amber-300'
                            : proj.status === 'Completed'
                              ? 'text-emerald-400'
                              : 'text-zinc-300'
                        }`}
                      >
                        {proj.status}
                      </span>
                    </div>
                    {proj.source_url && isSafeExternalUrl(proj.source_url) && (
                      <a
                        href={proj.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1.5 inline-flex items-center gap-1 max-w-md text-[11px] text-zinc-400 hover:text-[#C4B5FD] underline"
                      >
                        <span className="truncate">{proj.source_url}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {proj.source_file && (
                    <button
                      type="button"
                      onClick={() => handleDeleteSource(proj.id)}
                      className="px-3 py-1.5 rounded-lg border border-white/10 text-xs text-zinc-300 hover:text-white hover:bg-white/[0.05] transition-colors whitespace-nowrap"
                    >
                      Delete source
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDeleteProject(proj.id)}
                    aria-label="Delete project"
                    className="p-2 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  {proj.youtube_video_id && (
                    <Link
                      to={`/dashboard/project/${proj.id}`}
                      className="px-3 py-1.5 rounded-lg border border-white/10 text-xs text-zinc-300 hover:text-white hover:bg-white/[0.05] transition-colors whitespace-nowrap"
                    >
                      Studio
                    </Link>
                  )}
                  <Link
                    to={primaryRoute}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold transition-colors whitespace-nowrap"
                  >
                    {proj.youtube_video_id
                      ? 'YouTube Clipper'
                      : awaitingSource
                        ? 'Upload Video'
                        : 'Open Studio'}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </WorkspaceLayout>
  );
}
