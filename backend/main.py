import os
import shutil
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from worker import analyze_project_task, export_clip_task

app = FastAPI(title="CLIPFORGE Processing Worker API")


class AnalyzePayload(BaseModel):
    source_path: str
    min_duration: int = 25
    max_duration: int = 55
    clip_count: int = 5
    content_style: str = "Balanced"


class ExportPayload(BaseModel):
    source_path: str
    output_path: str
    start_time: float
    end_time: float
    vf_filter: str = "scale=1080:1920"
    ass_path: str | None = None


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "ffprobe": shutil.which("ffprobe") is not None,
        "redis_url_configured": bool(os.getenv("REDIS_URL")),
    }


@app.post("/api/projects/{project_id}/analyze")
def enqueue_analyze(project_id: str, payload: AnalyzePayload):
    if not os.path.exists(payload.source_path):
        raise HTTPException(status_code=404, detail="Source file not found")
    task = analyze_project_task.delay(project_id, payload.source_path, payload.model_dump())
    return {"job_id": task.id, "status": "Queued"}


@app.post("/api/clips/{clip_id}/export")
def enqueue_export(clip_id: str, payload: ExportPayload):
    if not os.path.exists(payload.source_path):
        raise HTTPException(status_code=404, detail="Source file not found")
    task = export_clip_task.delay(
        clip_id,
        payload.source_path,
        payload.output_path,
        payload.start_time,
        payload.end_time,
        payload.vf_filter,
        payload.ass_path,
    )
    return {"job_id": task.id, "status": "Queued"}
