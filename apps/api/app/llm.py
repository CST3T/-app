"""云端 LLM 摘要适配层（OpenAI 兼容接口，默认阿里云 DashScope 通义千问）。

环境变量：
- LLM_PROVIDER     auto（默认，配了 Key 就启用）/ cloud / openai / aliyun / mock / off
- LLM_BASE_URL     OpenAI 兼容服务地址，默认阿里云 DashScope 兼容模式
- LLM_API_KEY      API Key（仅后端持有，不下发浏览器）；留空则摘要走内置演示模板
- LLM_MODEL        模型名，默认 qwen-plus
- LLM_TIMEOUT      单次请求超时秒数，默认 90

未配置 Key 时 enabled() 为 False，pipeline 自动回退演示模板，不影响转写等其他功能。
"""

from __future__ import annotations

import json
import os
import re

import httpx

DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_MODEL = "qwen-plus"

_SYSTEM_PROMPT = (
    "你是专业的会议纪要助手。只根据用户给出的会议转写内容提炼信息，"
    "不得编造转写中没有的事实。全部输出简体中文。"
    "必须只输出一个 JSON 对象，不要输出 markdown 代码块或任何解释文字，结构为：\n"
    '{"topics": string[], "key_points": string[], "decisions": string[], '
    '"risks": string[], "action_items": [{"title": string, '
    '"owner": string|null, "due_date": "YYYY-MM-DD"|null}]}\n'
    "要求：topics 为 3~6 个议题；key_points 为关键讨论要点；decisions 为已确定的结论；"
    "risks 为风险或待确认问题；action_items 为明确的后续行动，owner 只能填写转写中出现过的"
    "人名，无法判断时填 null，due_date 没有明确日期时填 null；"
    "某一类确实没有内容时给空数组。每个字段值简洁明确，单条不超过 80 字。"
)


class LlmError(RuntimeError):
    """LLM 调用失败：调用方应把会议标记为 summarizing 失败并允许重试。"""


def _env(name: str) -> str:
    return (os.getenv(name) or "").strip()


def provider() -> str:
    return _env("LLM_PROVIDER").lower() or "auto"


def enabled() -> bool:
    """auto/cloud/openai/aliyun 且配置了 Key 时启用；mock/off/disabled 强制关闭。"""
    p = provider()
    if p in ("mock", "off", "disabled", "none"):
        return False
    return bool(_env("LLM_API_KEY"))


def base_url() -> str:
    return _env("LLM_BASE_URL").rstrip("/") or DEFAULT_BASE_URL


def model_name() -> str:
    return _env("LLM_MODEL") or DEFAULT_MODEL


def timeout() -> float:
    try:
        return max(10.0, float(_env("LLM_TIMEOUT") or "90"))
    except ValueError:
        return 90.0


def _build_user_prompt(transcript: str, title: str | None) -> str:
    header = f"会议主题：{title}\n\n" if title else ""
    return f"{header}会议转写：\n{transcript}\n\n请按要求输出会议摘要 JSON。"


def _strip_code_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    return text.strip()


def _coerce_str_list(value) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _coerce_action_items(value) -> list[dict]:
    items: list[dict] = []
    if not isinstance(value, list):
        return items
    for raw in value:
        if not isinstance(raw, dict):
            continue
        title = str(raw.get("title") or "").strip()
        if not title:
            continue
        owner = raw.get("owner")
        owner = str(owner).strip() if owner and str(owner).strip() else None
        due = raw.get("due_date")
        due = str(due).strip() if due and str(due).strip() else None
        if due and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", due):
            due = None
        items.append({"title": title, "owner": owner, "due_date": due})
    return items


def _parse_content(raw_text: str) -> dict:
    try:
        data = json.loads(_strip_code_fence(raw_text))
    except (ValueError, TypeError) as exc:
        raise LlmError(f"大模型返回不是合法 JSON：{str(exc)[:120]}") from exc
    if not isinstance(data, dict):
        raise LlmError("大模型返回结构不是 JSON 对象")

    content = {
        "topics": _coerce_str_list(data.get("topics")),
        "key_points": _coerce_str_list(data.get("key_points")),
        "decisions": _coerce_str_list(data.get("decisions")),
        "risks": _coerce_str_list(data.get("risks")),
        "action_items": _coerce_action_items(data.get("action_items")),
    }
    if not any(content[key] for key in ("topics", "key_points", "decisions", "action_items")):
        raise LlmError("大模型返回的摘要内容为空")
    return content


def summarize(transcript: str, title: str | None = None) -> tuple[dict, str]:
    """根据转写文本生成结构化摘要；失败抛 LlmError。返回 (content, model)。"""
    if not transcript or not transcript.strip():
        raise LlmError("转写内容为空，无法生成摘要")
    if not enabled():
        raise LlmError("未配置 LLM_API_KEY，无法调用云端大模型")

    payload = {
        "model": model_name(),
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_prompt(transcript.strip()[:20000], title)},
        ],
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
    }
    url = f"{base_url()}/chat/completions"
    headers = {
        "Authorization": f"Bearer {_env('LLM_API_KEY')}",
        "Content-Type": "application/json",
    }
    try:
        with httpx.Client(timeout=timeout()) as client:
            res = client.post(url, headers=headers, json=payload)
    except httpx.HTTPError as exc:
        raise LlmError(f"调用云端大模型网络异常：{str(exc)[:150]}") from exc

    if res.status_code != 200:
        detail = res.text[:200].replace("\n", " ")
        raise LlmError(f"云端大模型返回 HTTP {res.status_code}：{detail}")

    try:
        data = res.json()
        raw_text = data["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise LlmError(f"云端大模型响应结构异常：{str(exc)[:120]}") from exc

    return _parse_content(raw_text), str(data.get("model") or model_name())


_DOC_SYSTEM_PROMPT = (
    "你是专业的会议纪要撰写助手。只根据用户给出的会议资料（转写稿/摘要）撰写一份结构清晰的会议纪要文档，"
    "不得编造资料中没有的事实。全部输出简体中文。"
    "必须只输出一个 JSON 对象，不要输出 markdown 代码块或任何解释文字，结构为：\n"
    '{"title": string, "overview": string, '
    '"sections": [{"heading": string, "paragraphs": string[], "bullets": string[]}]}\n'
    "要求：title 为会议纪要标题；overview 为 2~4 句的会议总览；sections 为 3~6 个小节，"
    "覆盖讨论要点、结论决议、风险与待办等，每节 paragraphs 为 0~3 段完整叙述，bullets 为 0~6 条要点，"
    "至少安排一节「后续行动」列出责任人（如有）与时限。单条不超过 120 字。"
)


def compose_document(
    transcript: str,
    title: str | None,
    summary_content: dict | None = None,
) -> tuple[dict, str]:
    """让大模型把会议内容整理成结构化文档；返回 (doc, model)。

    doc 结构：{"title": str, "overview": str,
              "sections": [{"heading": str, "paragraphs": [str], "bullets": [str]}]}
    """
    user_parts: list[str] = []
    if title:
        user_parts.append(f"会议主题：{title}")
    if summary_content:
        summary_text = json.dumps(summary_content, ensure_ascii=False)
        user_parts.append(f"已有的结构化摘要：{summary_text[:6000]}")
    if transcript and transcript.strip():
        user_parts.append(f"会议转写：\n{transcript.strip()[:16000]}")
    if not user_parts:
        raise LlmError("没有可用的会议内容，无法生成文档")
    user_parts.append("请把以上内容整理成一份专业、可直接存档的会议纪要文档。")

    payload = {
        "model": model_name(),
        "messages": [
            {"role": "system", "content": _DOC_SYSTEM_PROMPT},
            {"role": "user", "content": "\n\n".join(user_parts)},
        ],
        "temperature": 0.3,
        "response_format": {"type": "json_object"},
    }
    url = f"{base_url()}/chat/completions"
    headers = {
        "Authorization": f"Bearer {_env('LLM_API_KEY')}",
        "Content-Type": "application/json",
    }
    try:
        with httpx.Client(timeout=timeout()) as client:
            res = client.post(url, headers=headers, json=payload)
    except httpx.HTTPError as exc:
        raise LlmError(f"调用云端大模型网络异常：{str(exc)[:150]}") from exc

    if res.status_code != 200:
        detail = res.text[:200].replace("\n", " ")
        raise LlmError(f"云端大模型返回 HTTP {res.status_code}：{detail}")

    try:
        data = res.json()
        raw_text = data["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise LlmError(f"云端大模型响应结构异常：{str(exc)[:120]}") from exc

    try:
        doc = json.loads(_strip_code_fence(raw_text))
    except (ValueError, TypeError) as exc:
        raise LlmError(f"大模型返回不是合法 JSON：{str(exc)[:120]}") from exc
    if not isinstance(doc, dict) or not isinstance(doc.get("sections"), list):
        raise LlmError("大模型返回的文档结构不合法")

    sections = []
    for section in doc["sections"]:
        if not isinstance(section, dict):
            continue
        heading = str(section.get("heading") or "").strip()
        if not heading:
            continue
        sections.append(
            {
                "heading": heading,
                "paragraphs": _coerce_str_list(section.get("paragraphs")),
                "bullets": _coerce_str_list(section.get("bullets")),
            }
        )
    overview = str(doc.get("overview") or "").strip()
    if not sections:
        raise LlmError("大模型返回的文档内容为空")
    return (
        {
            "title": str(doc.get("title") or "").strip() or (title or "会议纪要"),
            "overview": overview,
            "sections": sections,
        },
        str(data.get("model") or model_name()),
    )
