"""语音识别适配层：本地 faster-whisper（免费离线）/ 阿里云智能语音交互。

环境变量：
- ASR_PROVIDER                 mock（默认演示模板）/ local（本地 faster-whisper）/ aliyun
- LOCAL_ASR_MODEL              faster-whisper 模型，默认 small（tiny/base/small/medium）
- LOCAL_ASR_DEVICE             cpu / cuda，默认 cpu
- LOCAL_ASR_COMPUTE_TYPE       cpu 默认 int8；cuda 默认 float16
- LOCAL_ASR_MODEL_DIR          模型缓存目录，默认 HuggingFace 缓存
- LOCAL_ASR_MAX_WORKERS        长音频并行进程数，默认按物理核自动（通常 4）；1 = 关闭并行
- LOCAL_ASR_WORKER_THREADS     每个并行进程的 CPU 线程数，默认物理核/进程数
- LOCAL_ASR_CHUNK_SECONDS      并行分块目标长度（秒），默认 300；切点自动落在静音处
- ALIYUN_NLS_APP_KEY           阿里云「全部项目」项目 Appkey（aliyun 模式必填）
- ALIYUN_NLS_TOKEN             可选：控制台临时 Token，优先使用（有有效期，过期需更换）
- ALIYUN_ACCESS_KEY_ID         可选：RAM 用户 AccessKey，用于自动换取并缓存 Token
- ALIYUN_ACCESS_KEY_SECRET     可选：同上
- ALIYUN_NLS_REGION            Token 服务地域，默认 cn-shanghai
- ALIYUN_NLS_SAMPLE_RATE       8000（电话）/ 16000（非电话），默认 16000

说明：
- local：完全免费、可离线；模型已内置在 apps/api/models 并随镜像构建拷入，运行时无需下载
- aliyun：极速版支持 MP4 / AAC / MP3 / OPUS / WAV，单文件 ≤ 100 MB、时长 ≤ 2 小时
- 两种真实识别都不做说话人分离，speaker 统一为 None
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import logging
import math
import multiprocessing
import os
import threading
import time
import urllib.parse
import uuid
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone

import httpx

logger = logging.getLogger("minutes.asr")

SUCCESS_STATUS = 20000000
_FORMATS = {
    "wav": "wav",
    "mp3": "mp3",
    "m4a": "mp4",
    "mp4": "mp4",
    "aac": "aac",
    "opus": "opus",
    "ogg": "opus",
}

_token_cache: dict[str, float | str] = {"value": "", "expire": 0.0}


class AsrError(RuntimeError):
    """识别失败：调用方应把会议标记为 failed 并允许重试。"""


def _env(name: str) -> str:
    return (os.getenv(name) or "").strip()


def provider() -> str:
    return _env("ASR_PROVIDER").lower() or "mock"


def _appkey() -> str:
    return _env("ALIYUN_NLS_APP_KEY")


def _creds() -> tuple[str, str]:
    return _env("ALIYUN_ACCESS_KEY_ID"), _env("ALIYUN_ACCESS_KEY_SECRET")


def enabled() -> bool:
    """是否走真实识别：local 无凭证要求；aliyun 需 Appkey 与鉴权凭证齐备。"""
    if provider() == "local":
        return True
    if provider() != "aliyun" or not _appkey():
        return False
    if _env("ALIYUN_NLS_TOKEN"):
        return True
    ak, sk = _creds()
    return bool(ak and sk)


def region() -> str:
    return _env("ALIYUN_NLS_REGION") or "cn-shanghai"


def sample_rate() -> int:
    raw = _env("ALIYUN_NLS_SAMPLE_RATE")
    return 8000 if raw == "8000" else 16000


def audio_format(ext: str) -> str:
    fmt = _FORMATS.get((ext or "").lower().lstrip("."))
    if not fmt:
        raise AsrError(f"阿里云极速版不支持该音频格式：{ext or '未知'}")
    return fmt


# --------------------------------------------------------------------------- #
# 本地识别：faster-whisper（免费、离线；首次运行下载模型并缓存）
# --------------------------------------------------------------------------- #

_model_lock = threading.Lock()
_model = None
_model_key: tuple[str, str, str] | None = None


def _whisper():
    """按环境变量懒加载并复用 WhisperModel（模型加载很慢，进程内只做一次）。"""
    global _model, _model_key

    name = _env("LOCAL_ASR_MODEL") or "small"
    device = _env("LOCAL_ASR_DEVICE") or "cpu"
    compute = _env("LOCAL_ASR_COMPUTE_TYPE") or ("int8" if device == "cpu" else "float16")
    key = (name, device, compute)

    with _model_lock:
        if _model is not None and _model_key == key:
            return _model
        if os.path.isabs(name) and not os.path.isdir(name):
            raise AsrError(f"本地语音识别模型目录不存在：{name}（请确认镜像或安装包内已内置模型）")
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise AsrError("未安装 faster-whisper，请先执行 pip install faster-whisper") from exc

        try:
            _model = WhisperModel(
                name,
                device=device,
                compute_type=compute,
                download_root=_env("LOCAL_ASR_MODEL_DIR") or None,
            )
        except Exception as exc:  # 下载失败 / 显存不足 / 模型名不存在
            raise AsrError(f"加载本地语音识别模型失败（{name}/{device}/{compute}）：{exc}") from exc
        _model_key = key
        return _model


def _whisper_language(language: str) -> str | None:
    code = (language or "").strip().lower()
    if code.startswith("zh"):
        return "zh"
    if code.startswith("en"):
        return "en"
    return None  # 交给模型自动检测


# --------------------------------------------------------------------------- #
# 长音频并行识别：解码为 16k PCM → VAD 找静音下刀分块 → 多进程贪心解码 → 归并去重
# --------------------------------------------------------------------------- #

SAMPLE_RATE = 16000
DEFAULT_CHUNK_SECONDS = 300.0
DEFAULT_GAP_SEARCH_SECONDS = 45.0   # 在目标切点 ±45s 内寻找最长静音下刀
SOFT_PAD_SECONDS = 0.3              # 软切点（静音处）两侧仅留 0.3s 解码余量
HARD_PAD_SECONDS = 20.0             # 硬切点（连续说话被迫切开）两侧留 20s，交给中点去重
VAD_MIN_SILENCE_MS = 500            # 允许在 ≥0.5s 的停顿处切分
VAD_SPEECH_PAD_MS = 200
VAD_SHARD_CARRY_SECONDS = 0.5       # 并行 VAD 分片右缘多带 0.5s，避免接缝处语音被截断

# 子进程内复用的模型（spawn 后由 initializer 填充）
_worker_model = None
_worker_lang: str | None = None
_worker_prompt: str | None = None


def _decode_pcm16k(audio: bytes):
    """任意 ffmpeg 支持的格式 → 16kHz 单声道 float32 PCM。"""
    import numpy as np

    try:
        import av
    except ImportError as exc:
        raise AsrError("缺少音频解码库 av（PyAV），无法识别该音频") from exc

    try:
        container = av.open(io.BytesIO(audio))
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=SAMPLE_RATE)
        chunks: list = []
        for frame in container.decode(audio=0):
            for out in resampler.resample(frame):
                chunks.append(out.to_ndarray().reshape(-1))
        # 冲刷重采样缓冲（旧版本 PyAV 可能不支持 None flush，忽略即可）
        try:
            for out in resampler.resample(None):
                chunks.append(out.to_ndarray().reshape(-1))
        except Exception:  # noqa: BLE001
            pass
    except AsrError:
        raise
    except Exception as exc:
        raise AsrError(f"音频解码失败：{exc}（请确认文件未损坏且为常见音频格式）") from exc

    if not chunks:
        raise AsrError("音频解码为空：未读取到音轨，请确认文件未损坏")
    pcm = np.concatenate(chunks).astype(np.float32, copy=False)
    if pcm.size < SAMPLE_RATE:  # 短于 1 秒
        raise AsrError("音频时长过短（不足 1 秒），无法识别")
    return pcm


def _group_speech_cuts(
    regions: list[tuple[int, int]], total_samples: int, target: int, search: int
) -> list[tuple[int, bool]]:
    """按语音段把音频切成 ≤target 的块，切点优先落在最长静音里。

    返回 [(切点样本, 是否硬切), ...]，首尾分别为 0 和 total_samples。
    硬切 = 搜索范围内找不到静音（连续讲话），调用方需加大重叠并做中点去重。
    """
    cuts: list[tuple[int, bool]] = [(0, False)]
    anchor = 0
    i = 0
    n = len(regions)
    while i < n:
        nominal = anchor + target
        if nominal >= total_samples:
            break
        # 在 nominal ± search 的缝隙里选“最长静音”下刀（缝隙中点为切点）
        best: tuple[int, int] | None = None  # (缝隙长度, 切点)
        k = i
        while k < n - 1:
            gap_start = regions[k][1]
            gap_end = regions[k + 1][0]
            mid = (gap_start + gap_end) // 2
            if mid > nominal + search:
                break
            if mid >= nominal - search and gap_end > gap_start:
                gap_len = gap_end - gap_start
                if best is None or gap_len > best[0]:
                    best = (gap_len, mid)
            k += 1
        if best is not None:
            cut = best[1]
            cuts.append((cut, False))
            anchor = cut
            # 下一块从切点之后的第一个语音段开始
            while i < n and regions[i][1] <= cut:
                i += 1
        else:
            # 连续语音无静音可切：硬切，两侧靠重叠 + 中点归属兜底
            cut = min(nominal, total_samples)
            cuts.append((cut, True))
            anchor = cut
            while i < n and regions[i][1] <= cut:
                i += 1
    cuts.append((total_samples, False))
    return cuts


def _chunk_samples() -> int:
    return max(1, int(float(_env("LOCAL_ASR_CHUNK_SECONDS") or DEFAULT_CHUNK_SECONDS) * SAMPLE_RATE))


def _vad_regions(pcm) -> list[tuple[int, int]]:
    """Silero VAD 找语音段，返回 [(起点样本, 终点样本), ...]；失败/无人声返回空列表。"""
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    chunks = get_speech_timestamps(
        pcm,
        VadOptions(
            min_silence_duration_ms=VAD_MIN_SILENCE_MS,
            speech_pad_ms=VAD_SPEECH_PAD_MS,
        ),
        sampling_rate=SAMPLE_RATE,
    )
    return [(int(c["start"]), int(c["end"])) for c in chunks]


def _merge_shard_regions(shard_regions: list[tuple[int, int, list[tuple[int, int]]]],
                         total_samples: int) -> list[tuple[int, int]]:
    """合并并行 VAD 分片结果（已换绝对样本坐标）：接缝处被截断的邻段重新拼回。

    阈值只用于拼接同一语音在接缝两侧的片段；即便偶尔跨过短停顿拼接，
    也只会少一个候选切点（±搜索范围内仍有其他停顿），不影响识别正确性。
    """
    join_gap = int(SAMPLE_RATE * 0.3)
    merged: list[tuple[int, int]] = []
    flat = sorted((s + off, e + off) for _idx, off, regs in shard_regions for s, e in regs)
    for start, end in flat:
        start = max(0, start)
        end = min(total_samples, end)
        if merged and start <= merged[-1][1] + join_gap:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _plan_from_regions(regions: list[tuple[int, int]], total_samples: int
                       ) -> tuple[list[tuple[int, int, int]], list[int]]:
    """语音段 → 切点规划 → [(序号, 切片起点, 切片终点)] 与归属边界毫秒。"""
    target = _chunk_samples()
    search = int(DEFAULT_GAP_SEARCH_SECONDS * SAMPLE_RATE)
    soft_pad = int(SOFT_PAD_SECONDS * SAMPLE_RATE)
    hard_pad = int(HARD_PAD_SECONDS * SAMPLE_RATE)

    if not regions:
        # 纯静音/无人声：单块交给识别（最终会按“无有效内容”报错）
        return [(0, 0, total_samples)], [0, total_samples * 1000 // SAMPLE_RATE]

    cuts = _group_speech_cuts(regions, total_samples, target, search)
    windows: list[tuple[int, int, int]] = []
    for idx in range(len(cuts) - 1):
        left_hard = cuts[idx][1]
        right_hard = cuts[idx + 1][1]
        pad_l = hard_pad if left_hard else soft_pad
        pad_r = hard_pad if right_hard else soft_pad
        start = 0 if idx == 0 else max(0, cuts[idx][0] - pad_l)
        end = min(total_samples, cuts[idx + 1][0] + pad_r)
        windows.append((idx, start, end))
    bounds_ms = [position * 1000 // SAMPLE_RATE for position, _ in cuts]
    return windows, bounds_ms


def _plan_windows(pcm) -> tuple[list[tuple[int, int, int]], list[int]]:
    """串行版：VAD 找语音段 → 静音处分块（并行失败时的降级路径）。"""
    try:
        regions = _vad_regions(pcm)
    except Exception as exc:  # noqa: BLE001 - VAD 失败退回硬切，保证可用
        logger.warning("VAD 分段失败，按固定长度硬切：%s", exc)
        regions = []
    return _plan_from_regions(regions, int(pcm.shape[0]))


def _physical_cores() -> int:
    logical = os.cpu_count() or 4
    return max(1, logical // 2) if logical >= 4 else logical


def _pool_config(num_windows: int) -> tuple[int, int]:
    """并行进程数 / 每进程线程数，默认占满物理核但不超发。"""
    phys = _physical_cores()
    env_workers = _env("LOCAL_ASR_MAX_WORKERS")
    workers = int(env_workers) if env_workers else min(num_windows, max(2, phys // 2))
    workers = max(1, min(workers, num_windows))
    env_threads = _env("LOCAL_ASR_WORKER_THREADS")
    threads = int(env_threads) if env_threads else max(1, phys // workers)
    return workers, threads


def _run_window(model, pcm_chunk, language, prompt) -> list[dict]:
    """对一个 PCM 块执行贪心解码；短音频用 beam_size=1 比束搜索快约 2 倍，准确率基本持平。"""
    raw_segments, _info = model.transcribe(
        pcm_chunk,
        language=language,
        initial_prompt=prompt,
        vad_filter=True,
        beam_size=1,
        condition_on_previous_text=False,
    )
    return [
        {
            "start_ms": int(segment.start * 1000),
            "end_ms": int(segment.end * 1000),
            "content": segment.text.strip(),
        }
        for segment in raw_segments
        if segment.text and segment.text.strip()
    ]


def _pool_init(model_name: str, device: str, compute: str, threads: int,
               language: str | None, prompt: str | None) -> None:
    global _worker_model, _worker_lang, _worker_prompt
    os.environ.setdefault("OMP_NUM_THREADS", str(threads))
    from faster_whisper import WhisperModel

    _worker_model = WhisperModel(
        model_name,
        device=device,
        compute_type=compute,
        download_root=_env("LOCAL_ASR_MODEL_DIR") or None,
        cpu_threads=threads,
    )
    _worker_lang = language
    _worker_prompt = prompt


def _pool_vad(task: tuple[int, int, bytes]) -> tuple[int, int, list[tuple[int, int]]]:
    """子进程入口：对一个 VAD 分片跑语音检测，返回分片内坐标的语音段。"""
    import numpy as np

    index, start_sample, pcm_bytes = task
    pcm_chunk = np.frombuffer(pcm_bytes, dtype=np.float32)
    try:
        regions = _vad_regions(pcm_chunk)
    except Exception:  # noqa: BLE001 - 单分片失败不致命，按无语音处理
        regions = []
    return index, start_sample, regions


def _pool_transcribe(task: tuple) -> tuple[int, list[dict]]:
    """子进程入口：识别一个窗口并把时间戳换算为整条音频的绝对毫秒值。"""
    import numpy as np

    index, start_sample, pcm_bytes = task
    pcm_chunk = np.frombuffer(pcm_bytes, dtype=np.float32)
    local = _run_window(_worker_model, pcm_chunk, _worker_lang, _worker_prompt)
    offset_ms = int(start_sample * 1000 / SAMPLE_RATE)
    for seg in local:
        seg["start_ms"] += offset_ms
        seg["end_ms"] += offset_ms
        seg["speaker"] = None
    return index, local


def _vad_shards(pcm, workers: int) -> list[tuple[int, int, bytes]]:
    """整段 PCM 均分给 workers 个进程，右缘多带 carry 防止接缝丢语音。"""
    import numpy as np

    total = int(pcm.shape[0])
    base = total // workers
    carry = int(VAD_SHARD_CARRY_SECONDS * SAMPLE_RATE)
    tasks: list[tuple[int, int, bytes]] = []
    for i in range(workers):
        start = i * base
        end = total if i == workers - 1 else min(total, (i + 1) * base + carry)
        tasks.append((i, start, np.ascontiguousarray(pcm[start:end]).tobytes()))
    return tasks


def _dedupe_overlaps(segments: list[dict]) -> list[dict]:
    """丢弃跨窗口重复识别的同一段时间：相邻段时间重叠 >50% 短段时长时，保留较长段。"""
    deduped: list[dict] = []
    for seg in sorted(segments, key=lambda s: (s["start_ms"], s["end_ms"])):
        if deduped:
            prev = deduped[-1]
            overlap = min(seg["end_ms"], prev["end_ms"]) - max(seg["start_ms"], prev["start_ms"])
            prev_len = prev["end_ms"] - prev["start_ms"]
            cur_len = seg["end_ms"] - seg["start_ms"]
            if min(prev_len, cur_len) > 0 and overlap > min(prev_len, cur_len) / 2:
                if cur_len > prev_len:
                    deduped[-1] = seg
                continue
        deduped.append(seg)
    return deduped


def _merge_windows(results: list[tuple[int, list[dict]]], bounds_ms: list[int]) -> list[dict]:
    """合并各窗口结果：窗口 i 只保留中点落在 [bounds[i], bounds[i+1]) 的段，再按时间重叠去重。"""
    last_index = max((i for i, _ in results), default=0)
    kept: list[dict] = []
    for index, segs in results:
        lo = bounds_ms[index]
        hi = bounds_ms[index + 1]
        for seg in segs:
            mid = (seg["start_ms"] + seg["end_ms"]) // 2
            if mid < lo:
                continue
            if index < last_index and mid >= hi:
                continue
            kept.append(seg)
    return _dedupe_overlaps(kept)


def _transcribe_windows(pcm, language: str | None, prompt: str | None) -> list[dict]:
    """长音频并行：进程池内先并行 VAD 分块，再并行识别；任何失败都降级为父进程顺序执行。"""
    import numpy as np

    total = int(pcm.shape[0])
    # 窗口数尚未经 VAD 确定，按目标块长估算（只用于进程数上限，偏多偏少都不影响正确性）
    est_windows = max(2, math.ceil(total / _chunk_samples()))
    workers, threads = _pool_config(est_windows)

    def window_tasks(windows: list[tuple[int, int, int]]) -> list[tuple]:
        # 传 bytes 而非 ndarray，减少跨进程序列化开销
        return [
            (i, start, np.ascontiguousarray(pcm[start:end]).tobytes())
            for i, start, end in windows
        ]

    if workers > 1:
        name = _env("LOCAL_ASR_MODEL") or "small"
        device = _env("LOCAL_ASR_DEVICE") or "cpu"
        compute = _env("LOCAL_ASR_COMPUTE_TYPE") or ("int8" if device == "cpu" else "float16")
        try:
            ctx = multiprocessing.get_context("spawn")
            with ProcessPoolExecutor(
                max_workers=workers,
                mp_context=ctx,
                initializer=_pool_init,
                initargs=(name, device, compute, threads, language, prompt),
            ) as executor:
                shard_results = list(executor.map(_pool_vad, _vad_shards(pcm, workers)))
                regions = _merge_shard_regions(shard_results, total)
                windows, bounds_ms = _plan_from_regions(regions, total)
                results = list(executor.map(_pool_transcribe, window_tasks(windows)))
            logger.info("asr parallel workers=%s threads=%s windows=%s", workers, threads, len(windows))
            return _merge_windows(results, bounds_ms)
        except Exception as exc:  # noqa: BLE001 - 并行失败必须降级，不能让会议直接失败
            logger.warning("并行识别失败，降级为顺序识别：%s", exc)

    # 降级路径：父进程串行 VAD + 串行识别
    windows, bounds_ms = _plan_windows(pcm)
    model = _whisper()
    results: list[tuple[int, list[dict]]] = []
    for i, start, end in windows:
        local = _run_window(model, pcm[start:end], language, prompt)
        offset_ms = int(start * 1000 / SAMPLE_RATE)
        for seg in local:
            seg["start_ms"] += offset_ms
            seg["end_ms"] += offset_ms
            seg["speaker"] = None
        results.append((i, local))
    return _merge_windows(results, bounds_ms)


def transcribe_local(audio: bytes, language: str = "zh") -> list[dict]:
    lang = _whisper_language(language)
    # 中文加默认提示词，避免输出繁体；可用 LOCAL_ASR_PROMPT 覆盖（如会议热词）
    prompt = _env("LOCAL_ASR_PROMPT") or ("以下是普通话的句子。" if lang == "zh" else None)
    try:
        pcm = _decode_pcm16k(audio)
        # 不超过一个目标块长的音频直接整块识别（窗口内部自带 VAD 过滤），省去规划开销
        if int(pcm.shape[0]) <= _chunk_samples():
            raw_segments = _run_window(_whisper(), pcm, lang, prompt)
            segments = [
                {"start_ms": s["start_ms"], "end_ms": s["end_ms"], "speaker": None, "content": s["content"]}
                for s in raw_segments
            ]
        else:
            segments = _transcribe_windows(pcm, lang, prompt)
    except AsrError:
        raise
    except Exception as exc:
        raise AsrError(f"本地语音识别失败：{exc}") from exc

    if not segments:
        raise AsrError("本地语音识别没有识别到有效内容：请确认音频有清晰人声")
    return segments


# --------------------------------------------------------------------------- #
# Token：优先用控制台 Token，其次用 AccessKey 走 OpenAPI 自动获取并缓存
# --------------------------------------------------------------------------- #

def _percent(value: str) -> str:
    return urllib.parse.quote(value, safe="~")


def _create_token(ak: str, sk: str) -> tuple[str, float]:
    params = {
        "AccessKeyId": ak,
        "Action": "CreateToken",
        "Format": "JSON",
        "SignatureMethod": "HMAC-SHA1",
        "SignatureNonce": uuid.uuid4().hex,
        "SignatureVersion": "1.0",
        "Timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "Version": "2019-08-08",
    }
    query = "&".join(f"{_percent(k)}={_percent(v)}" for k, v in sorted(params.items()))
    string_to_sign = f"GET&%2F&{_percent(query)}"
    digest = hmac.new((sk + "&").encode("utf-8"), string_to_sign.encode("utf-8"), hashlib.sha1).digest()
    signature = base64.b64encode(digest).decode("utf-8")
    url = f"https://nls-meta.{region()}.aliyuncs.com/?{query}&Signature={_percent(signature)}"

    try:
        with httpx.Client(timeout=15) as client:
            res = client.get(url)
    except httpx.HTTPError as exc:
        raise AsrError(f"获取阿里云 NLS Token 网络异常：{exc}") from exc

    try:
        data = res.json()
    except ValueError:
        data = {}
    token_info = data.get("Token") or {}
    token = token_info.get("Id")
    if res.status_code != 200 or not token:
        detail = data.get("Message") or res.text[:200]
        raise AsrError(f"获取阿里云 NLS Token 失败（HTTP {res.status_code}）：{detail}")
    return token, float(token_info.get("ExpireTime") or 0)


def token() -> str:
    fixed = _env("ALIYUN_NLS_TOKEN")
    if fixed:
        return fixed

    ak, sk = _creds()
    if not ak or not sk:
        raise AsrError("缺少阿里云鉴权：请配置 ALIYUN_NLS_TOKEN 或 ALIYUN_ACCESS_KEY_ID/SECRET")

    cached = str(_token_cache.get("value") or "")
    if cached and float(_token_cache.get("expire") or 0) - 60 > time.time():
        return cached

    value, expire = _create_token(ak, sk)
    _token_cache["value"], _token_cache["expire"] = value, expire
    return value


# --------------------------------------------------------------------------- #
# 识别
# --------------------------------------------------------------------------- #

def parse_result(data: dict) -> list[dict]:
    """把极速版响应转成 pipeline 的分段结构；失败抛 AsrError。"""
    status = data.get("status")
    if status != SUCCESS_STATUS:
        message = data.get("message") or data.get("status_text") or "未知错误"
        raise AsrError(f"阿里云语音识别失败（status={status}）：{message}")

    sentences = (data.get("flash_result") or {}).get("sentences") or []
    segments: list[dict] = []
    for sentence in sentences:
        text = (sentence.get("text") or "").strip()
        if not text:
            continue
        start = int(sentence.get("begin_time") or 0)
        end = int(sentence.get("end_time") or start)
        segments.append({"start_ms": start, "end_ms": max(end, start), "speaker": None, "content": text})

    if not segments:
        raise AsrError("阿里云语音识别返回空结果：请确认音频编码与 sample_rate 是否匹配")
    return segments


def transcribe(audio: bytes, ext: str, language: str = "zh") -> list[dict]:
    """真实识别一段音频；失败抛 AsrError（含可直接展示给用户的原因）。"""
    if provider() == "local":
        if not audio:
            raise AsrError("音频内容为空，无法识别")
        return transcribe_local(audio, language)

    if not enabled():
        raise AsrError("未启用阿里云语音识别（检查 ASR_PROVIDER / Appkey / 凭证）")
    if not audio:
        raise AsrError("音频内容为空，无法识别")

    fmt = audio_format(ext)
    query = urllib.parse.urlencode(
        {
            "appkey": _appkey(),
            "token": token(),
            "format": fmt,
            "sample_rate": sample_rate(),
        }
    )
    url = f"https://nls-gateway-{region()}.aliyuncs.com/stream/v1/FlashRecognizer?{query}"

    try:
        with httpx.Client(timeout=120) as client:
            res = client.post(
                url,
                content=audio,
                headers={"Content-Type": "application/octet-stream"},
            )
    except httpx.HTTPError as exc:
        raise AsrError(f"调用阿里云语音识别网络异常：{exc}") from exc

    try:
        data = res.json()
    except ValueError as exc:
        raise AsrError(f"阿里云语音识别返回非 JSON（HTTP {res.status_code}）") from exc
    if res.status_code != 200:
        raise AsrError(f"阿里云语音识别 HTTP {res.status_code}：{str(data)[:200]}")
    return parse_result(data)
