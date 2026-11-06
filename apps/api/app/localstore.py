"""免安装版本地 JSON 快照持久化（零外部依赖，替代 PostgreSQL）。

配置了环境变量 MINUTES_LOCAL_SNAPSHOT（快照文件路径）时启用：
- 启动时读快照恢复 store.db；文件不存在时用种子数据并立即写一份
- 运行期由 repository.flush() 按脏标记周期落盘，关闭窗口（强杀）最多丢约 1 秒写入
- 写入采用「同目录临时文件 + os.replace 原子替换」，并保留上一版 .bak，
  主文件损坏时自动回退备份；两者都不可用则回退种子数据

快照只存业务数据，attachment_files / audio_files 这类运行时绝对路径指针
不入库，启动时按 storage 目录里的真实文件重新推导。
"""

from __future__ import annotations

import copy
import json
import logging
import os
import tempfile
from pathlib import Path

from . import storage
from .seed import build_seed

logger = logging.getLogger("minutes.localstore")

ENV_PATH = "MINUTES_LOCAL_SNAPSHOT"
SNAPSHOT_VERSION = 1

# 运行时按本机路径推导的指针集合，不进入快照
_RUNTIME_KEYS = ("attachment_files", "audio_files")


def enabled() -> bool:
    return bool((os.getenv(ENV_PATH) or "").strip())


def snapshot_path() -> Path:
    return Path(os.environ[ENV_PATH].strip()).expanduser()


def rebuild_file_pointers(data: dict) -> None:
    """按 storage 目录里的实体文件回填附件/音频的本地路径指针。"""
    attachment_files: dict[str, str] = {}
    audio_files: dict[str, str] = {}

    for meta in data.get("attachments", []):
        path = storage.ATTACHMENT_DIR / meta["id"]
        if path.exists():
            attachment_files[meta["id"]] = str(path)

    for meeting in data.get("meetings", []):
        key = meeting.get("audio_key")
        if not key:
            continue
        ext = key.rsplit(".", 1)[-1] if "." in key else "m4a"
        path = storage.AUDIO_DIR / f"{meeting['id']}.{ext}"
        if path.exists():
            audio_files[meeting["id"]] = str(path)

    data["attachment_files"] = attachment_files
    data["audio_files"] = audio_files


def _read_file(path: Path) -> dict:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or raw.get("version") != SNAPSHOT_VERSION:
        raise ValueError("不支持的快照版本或结构")
    saved = raw.get("data")
    if not isinstance(saved, dict):
        raise ValueError("快照数据结构缺失")

    # 以种子键为基准：只接收已知集合，缺失的键用新版种子补齐（前向兼容）
    seed = build_seed()
    data: dict = {}
    for key in seed:
        if key in _RUNTIME_KEYS:
            continue
        data[key] = copy.deepcopy(saved[key]) if key in saved else copy.deepcopy(seed[key])
    rebuild_file_pointers(data)
    return data


def load() -> dict | None:
    """读快照恢复数据；快照文件不存在返回 None；损坏时尝试 .bak，再失败抛异常。"""
    path = snapshot_path()
    if not path.exists():
        return None
    try:
        return _read_file(path)
    except Exception as exc_primary:  # noqa: BLE001 - 主文件损坏时回退上一版
        backup = path.with_name(path.name + ".bak")
        if backup.exists():
            try:
                data = _read_file(backup)
                logger.warning("主快照损坏，已从上一版备份恢复：%s", exc_primary)
                return data
            except Exception:  # noqa: BLE001
                pass
        raise


def save(store: dict) -> None:
    """把当前 store.db 原子写入快照；写入失败不得破坏已有快照。"""
    path = snapshot_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    data = {
        key: copy.deepcopy(value)
        for key, value in store.items()
        if key not in _RUNTIME_KEYS
    }
    blob = json.dumps(
        {"version": SNAPSHOT_VERSION, "data": data},
        ensure_ascii=False,
        default=str,
    )

    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(blob)
            handle.flush()
            os.fsync(handle.fileno())
        # 保留上一版为 .bak（首次保存时没有旧文件）
        if path.exists():
            os.replace(path, path.with_name(path.name + ".bak"))
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.remove(tmp_name)
        except OSError:
            pass
        raise
