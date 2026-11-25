import json
import os
import subprocess
from celery import Celery
from dotenv import load_dotenv

load_dotenv()

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
celery_app = Celery("clipforge_worker", broker=REDIS_URL, backend=REDIS_URL)


def ffprobe_inspect(file_path: str) -> dict:
    cmd = [
        "ffprobe",
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        file_path,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=30)
    data = json.loads(proc.stdout)
    video_stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    if not video_stream:
        raise ValueError("No video stream found in file")
    audio_stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    return {
        "duration": float(data.get("format", {}).get("duration", 0)),
        "width": int(video_stream.get("width", 0)),
        "height": int(video_stream.get("height", 0)),
        "codec": video_stream.get("codec_name", "unknown"),
        "has_audio": audio_stream is not None,
    }


@celery_app.task(bind=True, name="clipforge.analyze_project")
def analyze_project_task(self, project_id: str, source_path: str, options: dict):
    metadata = ffprobe_inspect(source_path)
    audio_out = f"/tmp/{project_id}.mp3"
    subprocess.run(
        ["ffmpeg", "-y", "-i", source_path, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", audio_out],
        check=True,
        timeout=180,
    )
    return {"project_id": project_id, "metadata": metadata, "audio_path": audio_out, "options": options}


@celery_app.task(bind=True, name="clipforge.export_clip")
def export_clip_task(
    self,
    clip_id: str,
    source_path: str,
    output_path: str,
    start_time: float,
    end_time: float,
    vf_filter: str,
    ass_path: str | None = None,
):
    duration = max(0.5, end_time - start_time)
    filters = [vf_filter]
    if ass_path and os.path.exists(ass_path):
        filters.append(f"ass={ass_path}")

    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{start_time:.3f}",
        "-t",
        f"{duration:.3f}",
        "-i",
        source_path,
        "-vf",
        ",".join(filters),
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        output_path,
    ]
    subprocess.run(cmd, check=True, timeout=600)
    return {"clip_id": clip_id, "output_path": output_path}
