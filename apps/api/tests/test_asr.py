"""阿里云 ASR 适配层单测：只验证配置判定与结果解析，不发真实网络请求。"""

from __future__ import annotations

import pytest

from app import asr


def test_default_is_mock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ASR_PROVIDER", raising=False)
    assert asr.provider() == "mock"
    assert asr.enabled() is False


def test_enabled_requires_appkey_and_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ASR_PROVIDER", "aliyun")
    monkeypatch.setenv("ALIYUN_NLS_APP_KEY", "appkey-demo")
    monkeypatch.delenv("ALIYUN_NLS_TOKEN", raising=False)
    monkeypatch.delenv("ALIYUN_ACCESS_KEY_ID", raising=False)
    monkeypatch.delenv("ALIYUN_ACCESS_KEY_SECRET", raising=False)
    assert asr.enabled() is False

    monkeypatch.setenv("ALIYUN_NLS_TOKEN", "token-demo")
    assert asr.enabled() is True

    monkeypatch.delenv("ALIYUN_NLS_TOKEN")
    monkeypatch.setenv("ALIYUN_ACCESS_KEY_ID", "ak")
    monkeypatch.setenv("ALIYUN_ACCESS_KEY_SECRET", "sk")
    assert asr.enabled() is True


def test_enabled_ignores_other_providers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ASR_PROVIDER", "other")
    monkeypatch.setenv("ALIYUN_NLS_APP_KEY", "appkey-demo")
    monkeypatch.setenv("ALIYUN_NLS_TOKEN", "token-demo")
    assert asr.enabled() is False


def test_parse_result_success() -> None:
    data = {
        "status": asr.SUCCESS_STATUS,
        "flash_result": {
            "sentences": [
                {"begin_time": 0, "end_time": 3000, "text": "大家好，我们开始。", "channel_id": 0},
                {"begin_time": 3000, "end_time": 8000, "text": "   ", "channel_id": 0},
                {"begin_time": 8000, "end_time": 12000, "text": "今天过一下上线节奏。", "channel_id": 0},
            ]
        },
    }
    segments = asr.parse_result(data)
    assert [s["content"] for s in segments] == ["大家好，我们开始。", "今天过一下上线节奏。"]
    assert segments[0]["start_ms"] == 0
    assert segments[-1]["end_ms"] == 12000
    assert segments[0]["speaker"] is None


def test_parse_result_failure() -> None:
    with pytest.raises(asr.AsrError) as exc:
        asr.parse_result({"status": 40000001, "message": "APPKEY_NOT_EXIST"})
    assert "APPKEY_NOT_EXIST" in str(exc.value)


def test_parse_result_empty() -> None:
    with pytest.raises(asr.AsrError):
        asr.parse_result({"status": asr.SUCCESS_STATUS, "flash_result": {"sentences": []}})


def test_audio_format_mapping() -> None:
    assert asr.audio_format("WAV") == "wav"
    assert asr.audio_format(".mp3") == "mp3"
    assert asr.audio_format("m4a") == "mp4"
    with pytest.raises(asr.AsrError):
        asr.audio_format("flac")


def test_transcribe_requires_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ASR_PROVIDER", "mock")
    with pytest.raises(asr.AsrError):
        asr.transcribe(b"audio", "wav")


def test_local_provider_enabled_without_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ASR_PROVIDER", "local")
    monkeypatch.delenv("ALIYUN_NLS_APP_KEY", raising=False)
    assert asr.enabled() is True


def test_transcribe_local_maps_segments(monkeypatch: pytest.MonkeyPatch) -> None:
    import numpy as np

    class _Segment:
        def __init__(self, start: float, end: float, text: str) -> None:
            self.start = start
            self.end = end
            self.text = text

    class _Model:
        def transcribe(self, audio, **kwargs):
            self.prompt = kwargs.get("initial_prompt")
            assert kwargs.get("beam_size") == 1  # 贪心解码
            return [
                _Segment(0.0, 2.5, " 大家好，我们开始。 "),
                _Segment(2.5, 3.0, "   "),
                _Segment(3.0, 6.4, "今天过一下上线节奏。"),
            ], None

    monkeypatch.setenv("ASR_PROVIDER", "local")
    monkeypatch.setattr(asr, "_whisper", lambda: _Model())
    # 单窗口短音频：跳过真实解码
    monkeypatch.setattr(asr, "_decode_pcm16k", lambda raw: np.zeros(asr.SAMPLE_RATE * 2, dtype=np.float32))

    segments = asr.transcribe(b"audio", "wav", "zh-CN")
    assert [s["content"] for s in segments] == ["大家好，我们开始。", "今天过一下上线节奏。"]
    assert segments[0]["start_ms"] == 0 and segments[0]["end_ms"] == 2500
    assert segments[-1]["end_ms"] == 6400
    assert segments[0]["speaker"] is None


def test_group_speech_cuts_hard_when_continuous() -> None:
    """连续讲话、搜索范围内没有静音：按目标长度硬切，切点标记为 hard。"""
    sr = asr.SAMPLE_RATE
    regions = [(0, sr * 25)]
    cuts = asr._group_speech_cuts(regions, sr * 25, sr * 10, sr * 2)
    assert cuts == [(0, False), (sr * 10, True), (sr * 20, True), (sr * 25, False)]


def test_group_speech_cuts_prefers_silence_gap() -> None:
    """目标切点附近有静音缝隙时，在缝隙中点软切（而非固定长度硬切）。"""
    sr = asr.SAMPLE_RATE
    # 0-9s 讲话、9-11s 静音、11-25s 讲话
    regions = [(0, sr * 9), (sr * 11, sr * 25)]
    cuts = asr._group_speech_cuts(regions, sr * 25, sr * 10, sr * 2)
    assert cuts[0] == (0, False) and cuts[-1] == (sr * 25, False)
    # 第一刀落在 10s 的静音中点且为软切
    assert cuts[1] == (sr * 10, False)


def test_merge_shard_regions_joins_seam() -> None:
    """跨接缝的连续语音（左分片 carry 与右分片头部重叠）拼回同一段。"""
    sr = asr.SAMPLE_RATE
    seam = sr * 10
    shards = [
        (0, 0, [(sr, seam + sr // 2)]),       # 左分片报告到接缝后 0.5s
        (1, seam, [(0, sr * 2)]),             # 右分片开头即语音
    ]
    assert asr._merge_shard_regions(shards, sr * 20) == [(sr, seam + sr * 2)]


def test_merge_shard_regions_keeps_real_gap() -> None:
    """接缝两侧确实有 ≥1s 停顿（含 VAD 200ms padding）时保持两段独立。"""
    sr = asr.SAMPLE_RATE
    seam = sr * 10
    shards = [
        (0, 0, [(sr, seam - int(sr * 0.8))]),
        (1, seam, [(int(sr * 0.8), int(sr * 2.8))]),
    ]
    merged = asr._merge_shard_regions(shards, sr * 20)
    assert merged == [(sr, seam - int(sr * 0.8)), (seam + int(sr * 0.8), seam + int(sr * 2.8))]


def test_merge_windows_dedupes_overlap() -> None:
    bounds_ms = [0, 300000, 600000]
    # 同一内容在相邻窗口各识别一次：中点归属把窗口 1 的重复剔除
    results = [
        (0, [
            {"start_ms": 1000, "end_ms": 3000, "speaker": None, "content": "窗口0独有"},
            {"start_ms": 298000, "end_ms": 301000, "speaker": None, "content": "跨边界句"},
        ]),
        (1, [
            {"start_ms": 298500, "end_ms": 301200, "speaker": None, "content": "跨边界句重复"},
            {"start_ms": 305000, "end_ms": 307000, "speaker": None, "content": "窗口1独有"},
        ]),
    ]
    merged = asr._merge_windows(results, bounds_ms)
    assert [s["content"] for s in merged] == ["窗口0独有", "跨边界句", "窗口1独有"]
    assert merged[1]["start_ms"] == 298000 and merged[1]["end_ms"] == 301000


def test_merge_windows_drops_time_overlapping_duplicate() -> None:
    """硬切兜底：两段时间重叠超过短段一半时视为重复，保留较长段，正常邻句不误伤。"""
    bounds_ms = [0, 300000, 600000]
    results = [
        (0, [
            {"start_ms": 297000, "end_ms": 302000, "speaker": None, "content": "硬切处同一句"},
        ]),
        (1, [
            {"start_ms": 299000, "end_ms": 304000, "speaker": None, "content": "硬切处同一句重复"},
            {"start_ms": 303000, "end_ms": 305000, "speaker": None, "content": "正常邻句"},
        ]),
    ]
    merged = asr._merge_windows(results, bounds_ms)
    assert [s["content"] for s in merged] == ["硬切处同一句", "正常邻句"]


def test_pool_config_pins_threads_without_oversubscription(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LOCAL_ASR_MAX_WORKERS", raising=False)
    monkeypatch.delenv("LOCAL_ASR_WORKER_THREADS", raising=False)
    workers, threads = asr._pool_config(12)
    assert workers >= 2 and threads >= 1
    assert workers * threads <= asr._physical_cores()
    monkeypatch.setenv("LOCAL_ASR_MAX_WORKERS", "1")
    assert asr._pool_config(12)[0] == 1


def test_transcribe_local_empty_audio() -> None:
    with pytest.raises(asr.AsrError):
        asr.transcribe(b"", "wav")


def test_whisper_language_normalization() -> None:
    assert asr._whisper_language("zh-CN") == "zh"
    assert asr._whisper_language("en-US") == "en"
    assert asr._whisper_language("") is None


def test_token_uses_console_token_first(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ALIYUN_NLS_TOKEN", "console-token")
    assert asr.token() == "console-token"


def test_write_transcript_uses_real_asr(monkeypatch: pytest.MonkeyPatch) -> None:
    """验证流水线接线：ASR 可用时用真实分段覆盖转写，而非内置模板。"""
    from app import pipeline
    from app.store import db

    meeting_id = "mtg_asr_unit"
    db["meetings"].append(
        {
            "id": meeting_id,
            "workspace_id": "ws_demo",
            "title": "真实识别验证",
            "status": "transcribing",
            "progress": 60,
            "audio_key": "ws_demo/mtg_asr_unit/original.wav",
            "audio_url": None,
            "audio_bytes": 1024,
            "duration_sec": None,
            "language": "zh",
            "started_at": "2026-10-30T00:00:00Z",
            "created_at": "2026-10-30T00:00:00Z",
            "updated_at": "2026-10-30T00:00:00Z",
            "deleted_at": None,
            "error": None,
        }
    )

    monkeypatch.setenv("ASR_PROVIDER", "aliyun")
    monkeypatch.setattr(pipeline.asr, "enabled", lambda: True)
    monkeypatch.setattr(pipeline.storage, "audio_bytes", lambda meeting: (b"audio", "wav"))
    monkeypatch.setattr(
        pipeline.asr,
        "transcribe",
        lambda audio, ext, language: [
            {"start_ms": 0, "end_ms": 5200, "speaker": None, "content": "第一句真实识别结果"},
            {"start_ms": 5200, "end_ms": 9100, "speaker": None, "content": "第二句真实识别结果"},
        ],
    )

    try:
        pipeline.write_transcript(meeting_id)
        rows = [s for s in db["transcript_segments"] if s["meeting_id"] == meeting_id]
        assert [s["content"] for s in rows] == ["第一句真实识别结果", "第二句真实识别结果"]
        assert rows[0]["speaker"] is None
        meeting = next(m for m in db["meetings"] if m["id"] == meeting_id)
        assert meeting["duration_sec"] == 9.1
    finally:
        db["meetings"] = [m for m in db["meetings"] if m["id"] != meeting_id]
        db["transcript_segments"] = [
            s for s in db["transcript_segments"] if s["meeting_id"] != meeting_id
        ]
