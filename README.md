# CLIPFORGE — AI Video Clipping & Cinematic Subtitle Studio

CLIPFORGE turns long-form podcasts, interviews, sermons, and streams into edited short vertical clips with AI-selected moments, reframing, and burned-in animated subtitles via FFmpeg.

## Architecture

- **Frontend**: React, TypeScript, Tailwind CSS, React Router
- **Application Server & Local Worker**: Node.js + Express (`server.ts`), SQLite (`node:sqlite`), FFmpeg/FFprobe, and `@google/genai`
- **Optional Distributed Worker**: Python FastAPI + Celery + Redis (`backend/`) & Supabase PostgreSQL (`supabase/migrations/`)

## Prerequisites

- **Node.js** `>= 22.18`
- **FFmpeg & FFprobe** (with `libass` and `libx264` enabled)
  - Ubuntu/Debian: `sudo apt-get update && sudo apt-get install -y ffmpeg`
  - macOS: `brew install ffmpeg`
- **Gemini API Key**: Required for speech transcription and transcript-grounded clip selection (`GEMINI_API_KEY`).

## Quick Local Setup

1. Copy environment variables:
   ```bash
   cp .env.example .env
   ```
   Set `GEMINI_API_KEY` in `.env`.

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the full-stack server (port `3000`):
   ```bash
   npm run dev
   ```

4. Open `http://localhost:3000`, create an account at `/signup`, and upload an MP4, MOV, WEBM, or MKV video.

## Optional: Separate Python Worker + Redis + Supabase

For separate worker deployment:

1. Apply `supabase/migrations/001_initial_schema.sql` to your Supabase PostgreSQL project.
2. Fill in `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, and `REDIS_URL` in `.env`.
3. Launch Redis, FastAPI, and the Celery FFmpeg worker:
   ```bash
   docker compose up --build
   ```
