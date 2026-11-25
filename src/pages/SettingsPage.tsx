import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiRequest } from '../lib/api';
import { CAPTION_PRESETS, formatBytes } from '../lib/presets';
import type {
  AspectRatio,
  CaptionPresetId,
  ExportResolution,
  HealthStatus,
  StorageStats,
  UserSettings,
} from '../types';

export function SettingsPage() {
  const { user, setUserDirect } = useAuth();
  const { notify } = useToast();

  const [username, setUsername] = useState(user?.username || '');
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [storage, setStorage] = useState<StorageStats | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      apiRequest<{ settings: UserSettings }>('/api/settings'),
      apiRequest<StorageStats>('/api/storage'),
      apiRequest<HealthStatus>('/api/health'),
    ])
      .then(([sRes, stRes, hRes]) => {
        setSettings(sRes.settings);
        setStorage(stRes);
        setHealth(hRes);
      })
      .catch((err) => {
        notify(err instanceof Error ? err.message : 'Failed to load settings.', 'error');
      });
  }, [notify]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiRequest<{ user: NonNullable<typeof user> }>('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({ username }),
      });
      setUserDirect(res.user);
      notify('Profile updated.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to update profile.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDefaults = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    try {
      const res = await apiRequest<{ settings: UserSettings }>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          default_aspect_ratio: settings.default_aspect_ratio,
          default_clip_length: settings.default_clip_length,
          default_caption_style: settings.default_caption_style,
          export_resolution: settings.export_resolution,
        }),
      });
      setSettings(res.settings);
      notify('Default clipping preferences saved.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save preferences.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      notify('Password updated.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to change password.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <WorkspaceLayout title="Settings" breadcrumb="CLIPFORGE / Settings">
      <div className="max-w-4xl space-y-6">
        {/* Profile */}
        <form
          onSubmit={handleSaveProfile}
          className="bg-[#141414] border border-white/[0.08] rounded-xl p-6 space-y-4"
        >
          <h2 className="font-display text-base font-semibold text-white">Account Profile</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Username</label>
              <input
                type="text"
                required
                minLength={2}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-lg bg-[#090909] border border-white/10 px-3.5 py-2 text-sm text-white focus:outline-none focus:border-[#8B5CF6]"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Email</label>
              <input
                type="email"
                disabled
                value={user?.email || ''}
                className="w-full rounded-lg bg-[#090909]/60 border border-white/5 px-3.5 py-2 text-sm text-zinc-500"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold"
          >
            Save Profile
          </button>
        </form>

        {/* Default Clipping Preferences */}
        {settings && (
          <form
            onSubmit={handleSaveDefaults}
            className="bg-[#141414] border border-white/[0.08] rounded-xl p-6 space-y-4"
          >
            <h2 className="font-display text-base font-semibold text-white">
              Default Clipping & Export Preferences
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">
                  Default aspect ratio
                </label>
                <select
                  value={settings.default_aspect_ratio}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      default_aspect_ratio: e.target.value as AspectRatio,
                    })
                  }
                  className="w-full rounded-lg bg-[#090909] border border-white/10 px-3 py-2 text-sm text-white"
                >
                  <option value="9:16">9:16 Vertical</option>
                  <option value="16:9">16:9 Landscape</option>
                  <option value="1:1">1:1 Square</option>
                  <option value="4:5">4:5 Portrait</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">
                  Default clip length
                </label>
                <select
                  value={settings.default_clip_length}
                  onChange={(e) =>
                    setSettings({ ...settings, default_clip_length: e.target.value })
                  }
                  className="w-full rounded-lg bg-[#090909] border border-white/10 px-3 py-2 text-sm text-white"
                >
                  <option value="15-30">15–30 seconds</option>
                  <option value="30-45">30–45 seconds</option>
                  <option value="45-60">45–60 seconds</option>
                  <option value="60-90">60–90 seconds</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">
                  Default caption preset
                </label>
                <select
                  value={settings.default_caption_style}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      default_caption_style: e.target.value as CaptionPresetId,
                    })
                  }
                  className="w-full rounded-lg bg-[#090909] border border-white/10 px-3 py-2 text-sm text-white"
                >
                  {CAPTION_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">
                  Export resolution
                </label>
                <select
                  value={settings.export_resolution}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      export_resolution: e.target.value as ExportResolution,
                    })
                  }
                  className="w-full rounded-lg bg-[#090909] border border-white/10 px-3 py-2 text-sm text-white"
                >
                  <option value="1080p">1080p (Full HD)</option>
                  <option value="720p">720p (HD)</option>
                </select>
              </div>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold"
            >
              Save Defaults
            </button>
          </form>
        )}

        {/* Password Update */}
        <form
          onSubmit={handleChangePassword}
          className="bg-[#141414] border border-white/[0.08] rounded-xl p-6 space-y-4"
        >
          <h2 className="font-display text-base font-semibold text-white">Change Password</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Current password</label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full rounded-lg bg-[#090909] border border-white/10 px-3.5 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">New password (8+ chars)</label>
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-lg bg-[#090909] border border-white/10 px-3.5 py-2 text-sm text-white"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg border border-white/15 bg-[#1B1B1B] hover:bg-white/10 text-white text-xs font-semibold"
          >
            Update Password
          </button>
        </form>

        {/* Storage Usage */}
        <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-6">
          <h2 className="font-display text-base font-semibold text-white mb-4">
            Private Storage Usage
          </h2>
          {storage ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div className="rounded-lg bg-[#1B1B1B] p-3.5">
                <p className="text-zinc-400">Source Videos & Audio</p>
                <p className="mt-1 font-mono text-base font-semibold text-white">
                  {formatBytes(storage.sourceBytes)}
                </p>
              </div>
              <div className="rounded-lg bg-[#1B1B1B] p-3.5">
                <p className="text-zinc-400">Exported MP4 Clips</p>
                <p className="mt-1 font-mono text-base font-semibold text-white">
                  {formatBytes(storage.exportBytes)}
                </p>
              </div>
              <div className="rounded-lg bg-[#1B1B1B] p-3.5">
                <p className="text-zinc-400">Available Disk Space</p>
                <p className="mt-1 font-mono text-base font-semibold text-white">
                  {formatBytes(storage.diskFreeBytes)}
                </p>
              </div>
            </div>
          ) : (
            <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
          )}
        </div>

        {/* Real Service & Worker Status */}
        <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-6">
          <h2 className="font-display text-base font-semibold text-white mb-4">
            Processing Engine & Service Status
          </h2>
          {health ? (
            <div className="divide-y divide-white/[0.06] text-xs">
              {[
                {
                  name: 'FFmpeg Video Renderer',
                  ok: health.services.ffmpeg.available,
                  detail: health.services.ffmpeg.version || 'Not installed on host',
                },
                {
                  name: 'FFprobe Media Inspector',
                  ok: health.services.ffprobe.available,
                  detail: health.services.ffprobe.version || 'Not installed on host',
                },
                {
                  name: 'Gemini AI Transcription & Moment Analysis',
                  ok: health.services.geminiConfigured,
                  detail: health.services.geminiConfigured
                    ? 'Server-side API key configured'
                    : 'Not configured (set GEMINI_API_KEY in Settings > Secrets)',
                },
                {
                  name: 'YouTube Metadata & Caption Retrieval',
                  ok: true,
                  detail: health.services.youtubeDataApiConfigured
                    ? 'YouTube Data API v3 configured'
                    : 'Official YouTube oEmbed active (add YOUTUBE_API_KEY in Secrets for duration & caption tracks)',
                },
                {
                  name: 'Background Job Queue',
                  ok: true,
                  detail: `${health.services.queue.active} active · ${health.services.queue.queued} queued · ${health.services.queue.concurrency} max workers`,
                },
                {
                  name: 'External Supabase + Redis Worker',
                  ok: health.services.supabaseConfigured && health.services.redisConfigured,
                  detail:
                    health.services.supabaseConfigured && health.services.redisConfigured
                      ? 'External Supabase and Redis worker configured'
                      : 'Running on built-in local SQLite + FFmpeg worker (see README.md for external Supabase/Celery setup)',
                },
              ].map((item) => (
                <div
                  key={item.name}
                  className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2">
                    {item.ok ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    )}
                    <span className="font-medium text-white">{item.name}</span>
                  </div>
                  <span className="text-zinc-400 font-mono text-[11px] truncate max-w-md">
                    {item.detail}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
          )}
        </div>
      </div>
    </WorkspaceLayout>
  );
}
