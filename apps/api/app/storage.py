"""附件与音频存储：配置了 S3/MinIO 走对象存储（私有桶 + 预签名 URL），否则落本地 storage/。"""

from __future__ import annotations

import math
import mimetypes
import os
import struct
from pathlib import Path

from . import objectstore
from .store import db

STORAGE_ROOT = Path(os.getenv("MINUTES_STORAGE_DIR", Path(__file__).resolve().parent.parent / "storage"))
ATTACHMENT_DIR = STORAGE_ROOT / "attachments"
AUDIO_DIR = STORAGE_ROOT / "audio"


def s3_enabled() -> bool:
    return objectstore.enabled()


def _attachment_key(attachment_id: str) -> str:
    return f"attachments/{attachment_id}"


def save_attachment(attachment_id: str, data: bytes, mime_type: str) -> None:
    if s3_enabled():
        objectstore.put(_attachment_key(attachment_id), data, mime_type)
        return
    ATTACHMENT_DIR.mkdir(parents=True, exist_ok=True)
    path = ATTACHMENT_DIR / attachment_id
    path.write_bytes(data)
    db["attachment_files"][attachment_id] = str(path)


def save_audio(meeting: dict, data: bytes) -> None:
    """按会议已有的 audio_key 落对象；未配对象存储时写本地目录。"""
    key = meeting["audio_key"]
    ext = key.rsplit(".", 1)[-1] if "." in key else "m4a"
    if s3_enabled():
        mime = mimetypes.guess_type(f"audio.{ext}")[0] or "application/octet-stream"
        objectstore.put(key, data, mime)
        return
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    path = AUDIO_DIR / f"{meeting['id']}.{ext}"
    path.write_bytes(data)
    db["audio_files"][meeting["id"]] = str(path)


def audio_url_for(meeting: dict) -> str | None:
    """播放地址：对象存储启用且对象存在时返回 10 分钟签名 URL，否则沿用原值。"""
    key = meeting.get("audio_key")
    if s3_enabled() and key and objectstore.exists(key):
        return objectstore.signed_url(key)
    return meeting.get("audio_url")


def attachment_url_for(meta: dict) -> str:
    """资料下载地址：对象存在时返回签名 URL，种子占位资料仍走 API 路径。"""
    if s3_enabled() and objectstore.exists(_attachment_key(meta["id"])):
        return objectstore.signed_url(_attachment_key(meta["id"]))
    return meta.get("url") or f"/api/v1/attachments/{meta['id']}/content"


def delete_attachment_file(attachment_id: str) -> None:
    path = db["attachment_files"].pop(attachment_id, None)
    if path:
        try:
            Path(path).unlink(missing_ok=True)
        except OSError:
            pass
    if s3_enabled():
        objectstore.delete(_attachment_key(attachment_id))


def attachment_bytes(meta: dict) -> tuple[bytes, str]:
    attachment_id = meta["id"]
    if s3_enabled():
        data = objectstore.read(_attachment_key(attachment_id))
        if data is not None:
            return data, meta["mime_type"]

    path = db["attachment_files"].get(attachment_id)
    if path and Path(path).exists():
        return Path(path).read_bytes(), meta["mime_type"]

    kind = meta["kind"]
    if kind == "image":
        return demo_image_svg(meta["file_name"]).encode("utf-8"), "image/svg+xml; charset=utf-8"
    if kind == "audio":
        return demo_tone_wav(), "audio/wav"
    if kind == "doc":
        text = (
            "演示环境占位文件\n\n"
            f"文件名：{meta['file_name']}\n"
            f"上传者：{meta['uploader_name']}\n\n"
            "真实环境会返回对象存储的签名下载地址。"
        )
        return text.encode("utf-8"), "text/plain; charset=utf-8"

    from .errors import not_found

    raise not_found("资料内容不存在")


def demo_image_svg(file_name: str) -> str:
    safe = "".join(ch for ch in file_name if ch not in '<>&"')
    lines = "".join(f'<line x1="0" y1="{y}" x2="640" y2="{y}"/>' for y in (100, 200, 300))
    cols = "".join(f'<line x1="{x}" y1="0" x2="{x}" y2="400"/>' for x in (160, 320, 480))
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400" role="img" aria-label="{safe}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1b2333"/><stop offset="1" stop-color="#2b3550"/>
    </linearGradient>
  </defs>
  <rect width="640" height="400" fill="url(#g)"/>
  <g stroke="#4d5b7d" stroke-opacity="0.3" stroke-width="1">{lines}{cols}</g>
  <rect x="80" y="76" width="200" height="110" rx="14" fill="#6f8cff" fill-opacity="0.28" stroke="#8aa2ff"/>
  <rect x="300" y="116" width="200" height="110" rx="14" fill="#4fd1b5" fill-opacity="0.2" stroke="#63d9c0"/>
  <rect x="176" y="228" width="260" height="92" rx="14" fill="#f5b544" fill-opacity="0.16" stroke="#f0bd63"/>
</svg>"""


def demo_tone_wav(seconds: float = 1.2, freq: float = 320.0) -> bytes:
    rate = 8000
    samples = int(rate * seconds)
    data = bytearray()
    for i in range(samples):
        t = i / rate
        env = max(0.0, min(1.0, t / 0.05, (seconds - t) / 0.2))
        value = math.sin(2 * math.pi * freq * t) * 0.18 * env
        data += struct.pack("<h", int(value * 0x7FFF))

    header = bytearray()
    header += b"RIFF"
    header += struct.pack("<I", 36 + len(data))
    header += b"WAVEfmt "
    header += struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
    header += b"data"
    header += struct.pack("<I", len(data))
    return bytes(header + data)
