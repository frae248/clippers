import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  FileVideo,
  RotateCcw,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { uploadVideoResumable } from '../lib/api';
import { formatBytes } from '../lib/presets';
import type { ProcessingJob, Project } from '../types';

const ACCEPTED_EXTS = ['.mp4', '.mov', '.webm', '.mkv'];

export interface UploadCompletePayload {
  project: Project;
  autoAnalysis?: {
    started: boolean;
    action?: 'analyze' | 'youtube_analyze' | 'rendering_clips';
    queuedCount?: number;
    job?: ProcessingJob;
    reason?: string;
  };
}

interface AuthorizedUploadZoneProps {
  projectId?: string;
  projectTitle: string;
  defaultAutoAnalyze?: boolean;
  showAutoAnalyzeToggle?: boolean;
  autoAnalyzeLabel?: string;
  submitLabel?: string;
  onFileSelected?: (file: File) => void;
  onUploadComplete: (result: UploadCompletePayload) => void;
}

export function AuthorizedUploadZone({
  projectId,
  projectTitle,
  defaultAutoAnalyze = false,
  showAutoAnalyzeToggle = true,
  autoAnalyzeLabel = 'Automatically run AI transcription & moment detection after upload',
  submitLabel = 'Upload and inspect video',
  onFileSelected,
  onUploadComplete,
}: AuthorizedUploadZoneProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [autoAnalyze, setAutoAnalyze] = useState(defaultAutoAnalyze);
  const [uploading, setUploading] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const validateAndSelectFile = (file: File) => {
    setError(null);
    const lower = file.name.toLowerCase();
    const valid = ACCEPTED_EXTS.some((ext) => lower.endsWith(ext));
    if (!valid) {
      setError('Unsupported file format. Please choose an MP4, MOV, WEBM, or MKV video.');
      return;
    }
    if (file.size === 0) {
      setError('Selected file is empty.');
      return;
    }
    setSelectedFile(file);
    onFileSelected?.(file);
  };

  const handleStartUpload = async () => {
    if (!selectedFile) return;
    setError(null);
    setUploading(true);
    setProgressPct(0);
    setUploadedBytes(0);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await uploadVideoResumable<UploadCompletePayload>(
        selectedFile,
        projectTitle.trim() || selectedFile.name,
        {
          projectId,
          autoAnalyze,
          signal: controller.signal,
          onProgress: (pct, bytes) => {
            setProgressPct(pct);
            setUploadedBytes(bytes);
          },
          onStatus: (msg) => setUploadStatus(msg),
        }
      );
      onUploadComplete(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload interrupted.';
      if (!controller.signal.aborted) {
        setError(msg);
      } else {
        setUploadStatus('Upload cancelled.');
      }
    } finally {
      setUploading(false);
      abortRef.current = null;
    }
  };

  const handleCancelUpload = () => {
    abortRef.current?.abort();
    setUploading(false);
    setProgressPct(0);
    setUploadStatus('Cancelled');
  };

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 flex items-start gap-2.5 text-xs text-rose-200 leading-relaxed">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p>{error}</p>
            {selectedFile && !uploading && (
              <button
                type="button"
                onClick={handleStartUpload}
                className="mt-2 inline-flex items-center gap-1.5 text-white font-medium underline"
              >
                <RotateCcw className="w-3 h-3" />
                Retry upload
              </button>
            )}
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".mp4,.mov,.webm,.mkv,video/mp4,video/quicktime,video/webm,video/x-matroska"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) validateAndSelectFile(file);
        }}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          const file = e.dataTransfer.files?.[0];
          if (file) validateAndSelectFile(file);
        }}
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-7 sm:p-9 text-center cursor-pointer transition-colors ${
          dragActive
            ? 'border-[#8B5CF6] bg-[#8B5CF6]/10'
            : 'border-white/15 hover:border-white/30 bg-[#090909]'
        }`}
      >
        <FileVideo className="w-8 h-8 text-[#8B5CF6] mx-auto mb-3" />
        <p className="text-sm font-medium text-white">
          {selectedFile ? selectedFile.name : 'Drop your video here, or click to browse'}
        </p>
        <p className="mt-1.5 text-xs text-zinc-400">
          {selectedFile
            ? `File size: ${formatBytes(selectedFile.size)} · Resumable 4 MB chunk upload`
            : 'Accepted formats: MP4, MOV, WEBM, MKV · Upload your original or creator-studio file'}
        </p>
      </div>

      {showAutoAnalyzeToggle && (
        <label className="mt-4 flex items-center gap-2.5 text-xs text-zinc-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoAnalyze}
            disabled={uploading}
            onChange={(e) => setAutoAnalyze(e.target.checked)}
            className="accent-[#8B5CF6]"
          />
          <Sparkles className="w-3.5 h-3.5 text-[#8B5CF6] shrink-0" />
          <span>{autoAnalyzeLabel}</span>
        </label>
      )}

      {uploading && (
        <div className="mt-5 rounded-lg bg-[#1B1B1B] border border-white/[0.08] p-4">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-zinc-200 font-medium">{uploadStatus}</span>
            <span className="font-mono text-zinc-400">
              {formatBytes(uploadedBytes)} / {formatBytes(selectedFile?.size)} ({progressPct}%)
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-[#090909] overflow-hidden">
            <div
              style={{ width: `${progressPct}%` }}
              className="h-full bg-[#8B5CF6] transition-all duration-200"
            />
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {!uploading ? (
          <button
            type="button"
            disabled={!selectedFile}
            onClick={handleStartUpload}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
          >
            <Upload className="w-4 h-4" />
            {submitLabel}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleCancelUpload}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-200 text-sm font-medium transition-colors"
          >
            <X className="w-4 h-4" />
            Cancel upload
          </button>
        )}

        {selectedFile && !uploading && (
          <button
            type="button"
            onClick={() => {
              setSelectedFile(null);
              setError(null);
            }}
            className="px-4 py-2.5 rounded-lg text-xs text-zinc-400 hover:text-white"
          >
            Clear selection
          </button>
        )}
      </div>
    </div>
  );
}
