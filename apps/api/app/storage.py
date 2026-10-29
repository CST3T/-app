"""附件与音频落盘（演示版存本地 storage/，生产环境替换为对象存储 MinIO/S3）。"""

from __future__ import annotations

import math
import os
import struct
from pathlib import Path

from .store import db

STORAGE_ROOT = Path(os.getenv("MINUTES_STORAGE_DIR", Path(__file__).resolve().parent.parent / "storage"))
ATTACHMENT_DIR = STORAGE_ROOT / "attachments"
AUDIO_DIR = STORAGE_ROOT / "audio"


def delete_attachment_file(attachment_id: str) -> None:
    path = db["attachment_files"].pop(attachment_id, None)
    if path:
        try:
            Path(path).unlink(missing_ok=True)
        except OSError:
            pass


def attachment_bytes(meta: dict) -> tuple[bytes, str]:
    attachment_id = meta["id"]
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
