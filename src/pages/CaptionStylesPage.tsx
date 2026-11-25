import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { useToast } from '../context/ToastContext';
import { apiRequest } from '../lib/api';
import { CAPTION_PRESETS } from '../lib/presets';
import type { CaptionPresetId, UserSettings } from '../types';

export function CaptionStylesPage() {
  const { notify } = useToast();
  const [defaultPreset, setDefaultPreset] = useState<CaptionPresetId>('CINEMATIC');
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{ settings: UserSettings }>('/api/settings')
      .then((res) => setDefaultPreset(res.settings.default_caption_style))
      .catch(() => {});
  }, []);

  const handleSetDefault = async (presetId: CaptionPresetId) => {
    setSaving(presetId);
    try {
      await apiRequest('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          default_caption_style: presetId,
          ...(presetId === 'DARK CINEMATIC'
            ? { default_aspect_ratio: '9:16', export_resolution: '1080p' }
            : {}),
        }),
      });
      setDefaultPreset(presetId);
      notify(`Default caption style set to ${presetId}.`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to update default preset.', 'error');
    } finally {
      setSaving(null);
    }
  };

  return (
    <WorkspaceLayout title="Caption Styles" breadcrumb="CLIPFORGE / Caption Styles">
      <p className="text-sm text-zinc-400 mb-6 max-w-2xl">
        Preview each ASS burn-in subtitle preset and choose the default applied to newly generated clips.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {CAPTION_PRESETS.map((preset) => {
          const isDefault = defaultPreset === preset.id;
          return (
            <div
              key={preset.id}
              className={`bg-[#141414] border rounded-xl p-6 flex flex-col justify-between ${
                isDefault ? 'border-[#8B5CF6]' : 'border-white/[0.08]'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h2 className="font-display text-base font-semibold text-white">
                    {preset.name}
                  </h2>
                  <span className="text-[11px] font-mono text-zinc-500">
                    {preset.defaultPosition}
                  </span>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">{preset.description}</p>

                <div className="mt-5 h-28 rounded-lg bg-[#090909] border border-white/[0.06] flex items-center justify-center px-4 text-center">
                  <p
                    className={`font-display text-base ${
                      preset.id === 'MINIMAL' ? 'font-medium' : 'font-extrabold'
                    } ${preset.uppercase ? 'uppercase' : ''}`}
                  >
                    {preset.sampleWords.map((w, i) => (
                      <span
                        key={i}
                        style={{
                          color: w.highlight ? preset.defaultHighlightColor : '#FFFFFF',
                        }}
                        className="mx-0.5"
                      >
                        {w.text}
                      </span>
                    ))}
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={isDefault || saving === preset.id}
                onClick={() => handleSetDefault(preset.id)}
                className={`mt-5 w-full py-2 px-3 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                  isDefault
                    ? 'bg-[#8B5CF6]/20 text-[#C4B5FD] border border-[#8B5CF6]/40 cursor-default'
                    : 'bg-[#1B1B1B] hover:bg-white/10 text-white border border-white/10'
                }`}
              >
                {isDefault && <Check className="w-3.5 h-3.5" />}
                {isDefault ? 'Active Default Preset' : 'Set as Default'}
              </button>
            </div>
          );
        })}
      </div>
    </WorkspaceLayout>
  );
}
