import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Film,
  Scissors,
  Sliders,
  Subtitles,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { CAPTION_PRESETS } from '../lib/presets';
import type { AspectRatio, CaptionPresetId } from '../types';

const FAQS = [
  {
    q: 'Which video formats and file sizes does CLIPFORGE support?',
    a: 'You can upload MP4, MOV, WEBM, and MKV files directly from your computer using our chunked resumable uploader. Every uploaded file is inspected with FFprobe before transcription begins.',
  },
  {
    q: 'Can I paste YouTube, TikTok, or Instagram links?',
    a: 'Yes. Paste a YouTube, TikTok, or Instagram link to validate the source, identify the platform, and save your project with the original video link. Because CLIPFORGE never scrapes or bypasses platform protections, you simply upload your downloaded creator-studio MP4, MOV, or WEBM file to start AI clipping automatically.',
  },
  {
    q: 'How are the subtitles generated and burned into the final video?',
    a: 'Audio is extracted with FFmpeg and transcribed verbatim with timestamps. When you export a clip, CLIPFORGE generates a styled ASS subtitle track matching your preset and burns it directly into the 1080p or 720p H.264 MP4.',
  },
  {
    q: 'What is included in the Dark Cinematic preset?',
    a: 'Dark Cinematic formats your clip to 9:16 vertical (1080x1920), applies a subtle vignette and gentle contrast grading, adds a slow framing push-in, and renders bold white subtitles with gold or violet keyword emphasis.',
  },
  {
    q: 'Can I adjust clip timestamps, crop framing, and captions before exporting?',
    a: 'Yes. In the Clipping Studio you can drag start and end boundaries on the timeline, pan the crop frame horizontally or vertically, zoom in, edit every spoken word in the subtitle box, and preview before starting the FFmpeg render.',
  },
];

const USE_CASES = [
  {
    title: 'Podcast Clippers',
    detail: 'Extract complete 30–60 second conversational arcs from two-hour episodes without cutting mid-thought.',
  },
  {
    title: 'Relationship Creators',
    detail: 'Apply the Dark Cinematic preset for moody 9:16 vertical framing, warm gold keyword highlights, and clean pacing.',
  },
  {
    title: 'Motivational & Faith Creators',
    detail: 'Turn sermons, talks, and keynotes into focused vertical clips with accurate verbatim subtitles.',
  },
  {
    title: 'Interview Editors',
    detail: 'Jump directly to high-retention stories, unexpected revelations, and clear standalone answers.',
  },
  {
    title: 'Streamers',
    detail: 'Upload VOD recordings in MP4 or MKV, isolate funny or intense moments, and export clean 1080p vertical shorts.',
  },
  {
    title: 'Social Media Managers',
    detail: 'Switch between 9:16 Reels, 4:5 Feed Portrait, 1:1 Square, and 16:9 landscape from a single project.',
  },
];

export function LandingPage() {
  const { user } = useAuth();
  const [demoPresetId, setDemoPresetId] = useState<CaptionPresetId>('DARK CINEMATIC');
  const [demoRatio, setDemoRatio] = useState<AspectRatio>('9:16');
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [heroImgError, setHeroImgError] = useState(false);
  const [demoPortraitError, setDemoPortraitError] = useState(false);
  const [demoWideError, setDemoWideError] = useState(false);

  const activePreset =
    CAPTION_PRESETS.find((p) => p.id === demoPresetId) || CAPTION_PRESETS[0];

  const primaryHref = user ? '/dashboard/new' : '/signup';

  return (
    <div className="min-h-screen bg-[#090909] text-white">
      {/* 3-Zone Top Bar */}
      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#090909]/95 backdrop-blur">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-8">
          <Link
            to="/"
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 flex items-center gap-2.5"
          >
            <span className="w-7 h-7 rounded-md bg-[#8B5CF6] flex items-center justify-center text-white">
              <Scissors className="w-4 h-4" />
            </span>
            CLIPFORGE
          </Link>

          <nav className="hidden md:flex items-center gap-7 text-sm text-zinc-400">
            <a href="#demo" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Studio Demo
            </a>
            <a href="#workflow" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Workflow
            </a>
            <a href="#captions" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Captions
            </a>
            <a href="#use-cases" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Creators
            </a>
            <a href="#faq" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              FAQ
            </a>
          </nav>

          <div className="flex items-center gap-4 shrink-0">
            <Link
              to={primaryHref}
              className="px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              {user ? 'Open Studio' : 'Start clipping'}
            </Link>
          </div>
        </div>
      </header>

      {/* 1. Hero Section */}
      <section className="max-w-[1280px] mx-auto px-5 sm:px-8 pt-14 pb-20 lg:pt-20 lg:pb-24">
        <div className="max-w-3xl">
          <h1
            style={{ fontSize: 'clamp(2.25rem, 4.4vw, 3.85rem)', textWrap: 'balance' }}
            className="font-display font-bold tracking-tight leading-[1.06] text-white"
          >
            Your long videos. Your best moments. Automatically.
          </h1>
          <p className="mt-5 text-base sm:text-lg text-zinc-400 leading-relaxed max-w-2xl">
            Turn podcasts, interviews, and long videos into scroll-stopping short clips with AI.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              to={primaryHref}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              Start clipping
              <ArrowRight className="w-4 h-4" />
            </Link>
            <a
              href="#demo"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-white/15 bg-[#141414] hover:bg-[#1B1B1B] text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0"
            >
              Explore the studio
            </a>
          </div>
        </div>

        <div className="mt-12 rounded-2xl overflow-hidden border border-white/[0.08] bg-[#141414]">
          {!heroImgError ? (
            <img
              src="/src/assets/images/hero_editing_suite_1795587387964.jpg"
              alt="CLIPFORGE dark video editing workstation showing multi-track timeline"
              referrerPolicy="no-referrer"
              onError={() => setHeroImgError(true)}
              className="w-full aspect-video object-cover"
            />
          ) : (
            <div className="w-full aspect-video bg-[#141414] flex flex-col items-center justify-center gap-3 text-zinc-500">
              <Film className="w-10 h-10 text-[#8B5CF6]" />
              <p className="text-sm">CLIPFORGE Nonlinear Clipping Studio</p>
            </div>
          )}
        </div>
      </section>

      {/* 2. Interactive Video Clipping Demonstration */}
      <section id="demo" className="border-t border-white/[0.08] bg-[#0D0D0D] py-20">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-8">
          <div className="max-w-2xl mb-10">
            <p className="text-xs font-medium text-[#8B5CF6] mb-2">Interactive Studio Demonstration</p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white">
              From 16:9 studio conversation to 9:16 vertical story
            </h2>
            <p className="mt-3 text-sm sm:text-base text-zinc-400">
              Switch aspect ratios and caption presets below to inspect how CLIPFORGE reframes landscape recordings and burns styled subtitles on export.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            {/* Source 16:9 Input Card */}
            <div className="lg:col-span-7 bg-[#141414] border border-white/[0.08] rounded-xl p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-xs text-zinc-400 mb-3">
                  <span>Source Recording · 16:9 Landscape</span>
                  <span className="font-mono">00:42:18</span>
                </div>
                <div className="relative rounded-lg overflow-hidden border border-white/[0.08] bg-black">
                  {!demoWideError ? (
                    <img
                      src="/src/assets/images/creator_interview_frame_1795587387194.jpg"
                      alt="Two podcast hosts conversing across a dark studio table"
                      referrerPolicy="no-referrer"
                      onError={() => setDemoWideError(true)}
                      className="w-full aspect-video object-cover"
                    />
                  ) : (
                    <div className="w-full aspect-video bg-[#1B1B1B] flex items-center justify-center text-zinc-500 text-sm">
                      Source 16:9 Interview Frame
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent pointer-events-none" />
                  <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-xs text-zinc-200 font-mono">
                    <span>Selected moment: 14:12.4 – 14:51.8 (39.4s)</span>
                    <span>H.264 · 1920x1080</span>
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div className="mt-5 pt-5 border-t border-white/[0.08] space-y-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-2">
                    Output Aspect Ratio
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {(['9:16', '4:5', '1:1', '16:9'] as AspectRatio[]).map((ratio) => (
                      <button
                        key={ratio}
                        type="button"
                        onClick={() => setDemoRatio(ratio)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                          demoRatio === ratio
                            ? 'bg-[#8B5CF6] text-white'
                            : 'bg-[#1B1B1B] text-zinc-300 hover:text-white border border-white/[0.08]'
                        }`}
                      >
                        {ratio}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-2">
                    Subtitle Preset
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {CAPTION_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setDemoPresetId(preset.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                          demoPresetId === preset.id
                            ? 'bg-white text-black'
                            : 'bg-[#1B1B1B] text-zinc-300 hover:text-white border border-white/[0.08]'
                        }`}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Reframed Output Preview */}
            <div className="lg:col-span-5 bg-[#141414] border border-white/[0.08] rounded-xl p-5 flex flex-col items-center justify-center">
              <div className="w-full flex items-center justify-between text-xs text-zinc-400 mb-3">
                <span>Reframed Export · {activePreset.name}</span>
                <span className="font-mono">{demoRatio} · 1080p</span>
              </div>

              <div className="w-full flex-1 flex items-center justify-center py-2">
                <div
                  className={`relative overflow-hidden rounded-xl border border-white/15 bg-black shadow-2xl transition-all duration-200 ${
                    demoRatio === '9:16'
                      ? 'w-[240px] aspect-[9/16]'
                      : demoRatio === '4:5'
                      ? 'w-[280px] aspect-[4/5]'
                      : demoRatio === '1:1'
                      ? 'w-[300px] aspect-square'
                      : 'w-full aspect-video'
                  }`}
                >
                  {!demoPortraitError ? (
                    <img
                      src="/src/assets/images/podcast_frame_demo_1795587386549.jpg"
                      alt="Speaker framed in dark studio lighting"
                      referrerPolicy="no-referrer"
                      onError={() => setDemoPortraitError(true)}
                      style={{
                        filter: activePreset.darkCinematicFx
                          ? 'contrast(1.06) saturate(0.92)'
                          : undefined,
                      }}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-[#1B1B1B] flex items-center justify-center text-xs text-zinc-500">
                      Reframed Subject
                    </div>
                  )}

                  {activePreset.darkCinematicFx && (
                    <div
                      aria-hidden="true"
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        background:
                          'radial-gradient(circle, rgba(0,0,0,0) 50%, rgba(0,0,0,0.52) 100%)',
                      }}
                    />
                  )}

                  <div
                    className={`absolute inset-x-3 flex justify-center text-center pointer-events-none ${
                      activePreset.defaultPosition === 'center'
                        ? 'top-1/2 -translate-y-1/2'
                        : activePreset.defaultPosition === 'bottom'
                        ? 'bottom-5'
                        : 'bottom-12'
                    }`}
                  >
                    <p
                      style={{
                        backgroundColor:
                          activePreset.defaultBgOpacity > 0
                            ? `rgba(9,9,9,${activePreset.defaultBgOpacity})`
                            : 'transparent',
                        padding: activePreset.defaultBgOpacity > 0 ? '4px 8px' : '0',
                        borderRadius: '6px',
                        textShadow: '0 2px 6px rgba(0,0,0,0.95)',
                      }}
                      className={`font-display text-sm sm:text-base leading-snug ${
                        activePreset.id === 'MINIMAL' ? 'font-medium' : 'font-extrabold'
                      } ${activePreset.uppercase ? 'uppercase tracking-tight' : ''}`}
                    >
                      {activePreset.sampleWords.map((w, idx) => (
                        <span
                          key={idx}
                          style={{
                            color: w.highlight ? activePreset.defaultHighlightColor : '#FFFFFF',
                          }}
                          className="mx-0.5"
                        >
                          {w.text}
                        </span>
                      ))}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. How It Works */}
      <section id="workflow" className="border-t border-white/[0.08] py-20">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-8">
          <div className="max-w-2xl mb-12">
            <p className="text-xs font-medium text-[#8B5CF6] mb-2">Workflow</p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Four deterministic steps from raw footage to exported MP4
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                num: '01. Upload & Inspect',
                desc: 'Upload MP4, MOV, WEBM, or MKV files via chunked upload. FFprobe reads duration, FPS, codec, and audio streams.',
              },
              {
                num: '02. Transcribe & Detect',
                desc: 'FFmpeg extracts a clean 16kHz speech track for verbatim timestamped transcription and standalone moment selection.',
              },
              {
                num: '03. Reframe & Subtitle',
                desc: 'Trim boundaries on the timeline, dial in 9:16 or 4:5 crop position, edit transcript lines, and choose a preset.',
              },
              {
                num: '04. Export 1080p MP4',
                desc: 'Background FFmpeg jobs burn ASS subtitles, apply optional Dark Cinematic grading, and deliver a downloadable MP4.',
              },
            ].map((step) => (
              <div
                key={step.num}
                className="bg-[#141414] border border-white/[0.08] rounded-xl p-6"
              >
                <h3 className="font-display text-base font-semibold text-white">{step.num}</h3>
                <p className="mt-3 text-sm text-zinc-400 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. Features Bento */}
      <section className="border-t border-white/[0.08] bg-[#0D0D0D] py-20">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-8">
          <div className="max-w-2xl mb-12">
            <p className="text-xs font-medium text-[#8B5CF6] mb-2">Built for Real Editing</p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Every slider in the studio changes the rendered video
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 bg-[#141414] border border-white/[0.08] rounded-xl p-7">
              <div className="flex items-center gap-2.5 text-[#8B5CF6] mb-3">
                <Sliders className="w-5 h-5" />
                <span className="text-sm font-semibold text-white">
                  Precision Timeline & Crop Reframing
                </span>
              </div>
              <p className="text-sm text-zinc-400 leading-relaxed max-w-xl">
                Adjust exact in/out timestamps, pan horizontal or vertical crop coordinates for off-center hosts, and scale zoom cleanly to 1080x1920 without distorting aspect ratio.
              </p>
            </div>

            <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-7">
              <div className="flex items-center gap-2.5 text-[#8B5CF6] mb-3">
                <Subtitles className="w-5 h-5" />
                <span className="text-sm font-semibold text-white">
                  Verbatim ASS Subtitles
                </span>
              </div>
              <p className="text-sm text-zinc-400 leading-relaxed">
                AI selects moments without inventing spoken dialogue. Edit text directly and export with burned-in ASS captions or clean video.
              </p>
            </div>

            <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-7">
              <div className="flex items-center gap-2.5 text-[#8B5CF6] mb-3">
                <Film className="w-5 h-5" />
                <span className="text-sm font-semibold text-white">
                  Dark Cinematic Preset
                </span>
              </div>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Designed for relationship and long-form podcasts: subtle vignette, gentle contrast curve, slow zoom push-in, and muted gold or violet highlights.
              </p>
            </div>

            <div className="md:col-span-2 bg-[#141414] border border-white/[0.08] rounded-xl p-7">
              <div className="flex items-center gap-2.5 text-[#8B5CF6] mb-3">
                <Scissors className="w-5 h-5" />
                <span className="text-sm font-semibold text-white">
                  Background Queue & Private Signed Downloads
                </span>
              </div>
              <p className="text-sm text-zinc-400 leading-relaxed max-w-xl">
                Navigate freely while FFmpeg encodes in the background. Finished exports stay private to your account and stream via short-lived signed URLs.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Caption Styles Showcase */}
      <section id="captions" className="border-t border-white/[0.08] py-20">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-8">
          <div className="max-w-2xl mb-12">
            <p className="text-xs font-medium text-[#8B5CF6] mb-2">Caption Engine</p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Six curated subtitle presets ready for burn-in
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {CAPTION_PRESETS.map((preset) => (
              <div
                key={preset.id}
                className="bg-[#141414] border border-white/[0.08] rounded-xl p-6 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="font-display text-base font-semibold text-white">
                      {preset.name}
                    </h3>
                    <span className="text-xs font-mono text-zinc-500">
                      {preset.defaultPosition}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-400 leading-relaxed">{preset.description}</p>
                </div>

                <div className="mt-6 h-24 rounded-lg bg-[#090909] border border-white/[0.06] flex items-center justify-center px-4 text-center">
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
            ))}
          </div>
        </div>
      </section>

      {/* 6. Creator Use Cases */}
      <section id="use-cases" className="border-t border-white/[0.08] bg-[#0D0D0D] py-20">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-8">
          <div className="max-w-2xl mb-12">
            <p className="text-xs font-medium text-[#8B5CF6] mb-2">Who Uses CLIPFORGE</p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Tailored for spoken-word creators and editors
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {USE_CASES.map((u) => (
              <div
                key={u.title}
                className="bg-[#141414] border border-white/[0.08] rounded-xl p-6"
              >
                <h3 className="font-display text-base font-semibold text-white">{u.title}</h3>
                <p className="mt-2.5 text-sm text-zinc-400 leading-relaxed">{u.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 7. FAQ */}
      <section id="faq" className="border-t border-white/[0.08] py-20">
        <div className="max-w-[900px] mx-auto px-5 sm:px-8">
          <div className="mb-10">
            <p className="text-xs font-medium text-[#8B5CF6] mb-2">Questions</p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Frequently asked questions
            </h2>
          </div>

          <div className="divide-y divide-white/[0.08] border-y border-white/[0.08]">
            {FAQS.map((item, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div key={item.q} className="py-5">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="w-full flex items-center justify-between gap-4 text-left"
                  >
                    <span className="font-display text-sm sm:text-base font-medium text-white">
                      {item.q}
                    </span>
                    {isOpen ? (
                      <ChevronUp className="w-4 h-4 text-zinc-400 shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0" />
                    )}
                  </button>
                  {isOpen && (
                    <p className="mt-3 text-sm text-zinc-400 leading-relaxed pr-8">{item.a}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 8. Footer */}
      <footer className="border-t border-white/[0.08] py-10">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-zinc-500">
          <div className="flex items-center gap-3">
            <span className="font-display font-semibold text-white">CLIPFORGE</span>
            <span aria-hidden="true">·</span>
            <span>AI Video Clipping & Cinematic Subtitle Studio</span>
          </div>
          <div className="flex items-center gap-5">
            <Link to="/login" className="hover:text-zinc-300 transition-colors">
              Sign in
            </Link>
            <Link to="/signup" className="hover:text-zinc-300 transition-colors">
              Create account
            </Link>
            <Link to="/dashboard" className="hover:text-zinc-300 transition-colors">
              Studio
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
