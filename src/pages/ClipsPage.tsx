import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Check,
  Download,
  Edit3,
  ExternalLink,
  LayoutGrid,
  List,
  Play,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { useToast } from '../context/ToastContext';
import { apiRequest } from '../lib/api';
import { formatBytes, formatDuration } from '../lib/presets';
import type { Clip, Project } from '../types';

export function ClipsPage() {
  const { notify } = useToast();

  const [clips, setClips] = useState<Clip[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'score'>('newest');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [previewClip, setPreviewClip] = useState<Clip | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [cRes, pRes] = await Promise.all([
        apiRequest<{ clips: Clip[] }>('/api/clips'),
        apiRequest<{ projects: Project[] }>('/api/projects'),
      ]);
      setClips(cRes.clips);
      setProjects(pRes.projects);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load clips.', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleRename = async (clipId: string) => {
    if (!renameValue.trim()) return;
    try {
      const res = await apiRequest<{ clip: Clip }>(`/api/clips/${clipId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: renameValue.trim() }),
      });
      setClips((prev) =>
        prev.map((c) => (c.id === clipId ? { ...c, title: res.clip.title } : c))
      );
      setEditingId(null);
      notify('Clip renamed.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to rename clip.', 'error');
    }
  };

  const handleDelete = async (clipId: string) => {
    try {
      await apiRequest(`/api/clips/${clipId}`, { method: 'DELETE' });
      setClips((prev) => prev.filter((c) => c.id !== clipId));
      notify('Clip deleted.', 'info');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete clip.', 'error');
    }
  };

  const filtered = clips
    .filter((c) => {
      if (projectFilter !== 'all' && c.project_id !== projectFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return (
          c.title.toLowerCase().includes(q) ||
          c.transcript.toLowerCase().includes(q) ||
          (c.project_title || '').toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'oldest') return a.created_at.localeCompare(b.created_at);
      if (sortBy === 'score') return (b.ai_score || 0) - (a.ai_score || 0);
      return b.created_at.localeCompare(a.created_at);
    });

  return (
    <WorkspaceLayout title="My Clips" breadcrumb="CLIPFORGE / Clips">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[260px]">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title or transcript..."
              className="w-full rounded-lg bg-[#141414] border border-white/[0.08] pl-9 pr-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#8B5CF6]"
            />
          </div>

          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            aria-label="Filter by project"
            className="rounded-lg bg-[#141414] border border-white/[0.08] px-3 py-2 text-xs text-white focus:outline-none focus:border-[#8B5CF6]"
          >
            <option value="all">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'newest' | 'oldest' | 'score')}
            aria-label="Sort clips"
            className="rounded-lg bg-[#141414] border border-white/[0.08] px-3 py-2 text-xs text-white focus:outline-none focus:border-[#8B5CF6]"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="score">Highest AI score</option>
          </select>
        </div>

        <div className="inline-flex items-center p-0.5 rounded-lg bg-[#141414] border border-white/[0.08]">
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            aria-label="Grid view"
            className={`p-2 rounded-md ${
              viewMode === 'grid' ? 'bg-[#8B5CF6] text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            aria-label="List view"
            className={`p-2 rounded-md ${
              viewMode === 'list' ? 'bg-[#8B5CF6] text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <List className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 rounded-xl bg-[#141414] animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-12 text-center">
          <p className="text-sm font-medium text-white">No clips found</p>
          <p className="mt-1 text-xs text-zinc-400">
            Generate or export clips inside a project studio to view them here.
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((clip) => (
            <div
              key={clip.id}
              className="bg-[#141414] border border-white/[0.08] rounded-xl p-5 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  {editingId === clip.id ? (
                    <div className="flex items-center gap-1.5 flex-1">
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        className="flex-1 rounded bg-[#090909] border border-[#8B5CF6] px-2 py-1 text-xs text-white"
                      />
                      <button
                        type="button"
                        onClick={() => handleRename(clip.id)}
                        className="p-1 text-emerald-400"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="p-1 text-zinc-400"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <h3 className="font-display text-sm font-semibold text-white line-clamp-1">
                      {clip.title}
                    </h3>
                  )}

                  {editingId !== clip.id && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(clip.id);
                        setRenameValue(clip.title);
                      }}
                      aria-label="Rename clip"
                      className="text-zinc-500 hover:text-white shrink-0"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] font-mono text-zinc-400">
                  <span>{formatDuration(clip.end_time - clip.start_time)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{clip.aspect_ratio}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-sans">{clip.caption_preset}</span>
                  {clip.output_size > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{formatBytes(clip.output_size)}</span>
                    </>
                  )}
                </div>

                <p className="mt-3 text-xs text-zinc-400 line-clamp-3 leading-relaxed">
                  {clip.transcript || 'No transcript text.'}
                </p>
              </div>

              <div className="mt-5 pt-3.5 border-t border-white/[0.06] flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {clip.export_media_url && (
                    <>
                      <button
                        type="button"
                        onClick={() => setPreviewClip(clip)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#1B1B1B] hover:bg-white/10 text-xs text-white transition-colors"
                      >
                        <Play className="w-3 h-3" />
                        Preview
                      </button>
                      <a
                        href={`${clip.export_media_url}&download=1`}
                        download
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-xs font-semibold text-white transition-colors"
                      >
                        <Download className="w-3 h-3" />
                        MP4
                      </a>
                    </>
                  )}
                  <Link
                    to={`/dashboard/project/${clip.project_id}?clip=${clip.id}`}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/10 hover:bg-white/[0.05] text-xs text-zinc-300"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Studio
                  </Link>
                </div>

                <button
                  type="button"
                  onClick={() => handleDelete(clip.id)}
                  aria-label="Delete clip"
                  className="p-1.5 text-zinc-500 hover:text-rose-400 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-[#141414] border border-white/[0.08] rounded-xl divide-y divide-white/[0.08]">
          {filtered.map((clip) => (
            <div
              key={clip.id}
              className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate">{clip.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400 font-mono">
                  <span className="font-sans">{clip.project_title}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatDuration(clip.end_time - clip.start_time)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{clip.aspect_ratio}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-sans">{clip.caption_preset}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {clip.export_media_url && (
                  <>
                    <button
                      type="button"
                      onClick={() => setPreviewClip(clip)}
                      className="px-3 py-1.5 rounded-lg bg-[#1B1B1B] text-xs text-white"
                    >
                      Preview
                    </button>
                    <a
                      href={`${clip.export_media_url}&download=1`}
                      download
                      className="px-3 py-1.5 rounded-lg bg-[#8B5CF6] text-xs font-semibold text-white"
                    >
                      Download MP4
                    </a>
                  </>
                )}
                <Link
                  to={`/dashboard/project/${clip.project_id}?clip=${clip.id}`}
                  className="px-3 py-1.5 rounded-lg border border-white/10 text-xs text-zinc-300"
                >
                  Edit
                </Link>
                <button
                  type="button"
                  onClick={() => handleDelete(clip.id)}
                  className="p-1.5 text-zinc-500 hover:text-rose-400"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Video Preview Modal */}
      {previewClip && previewClip.export_media_url && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-[#141414] border border-white/15 rounded-xl max-w-lg w-full p-5">
            <div className="flex items-center justify-between gap-4 mb-4">
              <h3 className="font-display text-sm font-semibold text-white truncate">
                {previewClip.title}
              </h3>
              <button
                type="button"
                onClick={() => setPreviewClip(null)}
                className="text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <video
              src={previewClip.export_media_url}
              controls
              autoPlay
              className="w-full max-h-[65vh] rounded-lg bg-black"
            />
            <div className="mt-4 flex justify-end gap-2">
              <a
                href={`${previewClip.export_media_url}&download=1`}
                download
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold"
              >
                <Download className="w-3.5 h-3.5" />
                Download MP4
              </a>
            </div>
          </div>
        </div>
      )}
    </WorkspaceLayout>
  );
}
