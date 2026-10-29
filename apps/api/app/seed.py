"""种子数据：与 apps/web/mocks/data.ts 完全对齐（字段、id、相对日期）。"""

from __future__ import annotations

from datetime import date, timedelta

from .security import hash_password

DEMO_PASSWORD = "minutes2026"
_DEMO_HASH = hash_password(DEMO_PASSWORD)


def due_in(days: int) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


def _user(uid: str, email: str, name: str, phone: str) -> dict:
    return {
        "id": uid,
        "email": email,
        "name": name,
        "phone": phone,
        "password_hash": _DEMO_HASH,
        "avatar_url": None,
    }


def _member(uid: str, email: str, name: str, phone: str, role: str, joined_at: str) -> dict:
    return {
        "user_id": uid,
        "email": email,
        "name": name,
        "phone": phone,
        "avatar_url": None,
        "role": role,
        "joined_at": joined_at,
    }


def _meeting(**kwargs) -> dict:
    base = {
        "audio_url": None,
        "duration_sec": None,
        "deleted_at": None,
        "error": None,
    }
    base.update(kwargs)
    return base


def _seg(meeting_id: str, seq: int, start_ms: int, end_ms: int, speaker: str | None, content: str) -> dict:
    return {
        "id": f"{meeting_id}_s{seq:03d}",
        "meeting_id": meeting_id,
        "seq": seq,
        "start_ms": start_ms,
        "end_ms": end_ms,
        "speaker": speaker,
        "content": content,
    }


def build_seed() -> dict:
    users = [
        _user("u_lin", "demo@minutes.dev", "林知远", "13800138001"),
        _user("u_chen", "chen@minutes.dev", "陈慕", "13800138002"),
        _user("u_wang", "wang@minutes.dev", "王砚", "13800138003"),
        _user("u_zhao", "zhao@minutes.dev", "赵时", "13800138004"),
        _user("u_sun", "sun@minutes.dev", "孙澄", "13800138005"),
        _user("u_qian", "qian@minutes.dev", "钱屿", "13800138006"),
    ]

    workspaces = [
        {
            "id": "ws_demo",
            "name": "产品研发中心",
            "owner_id": "u_lin",
            "plan": "team",
            "role": "owner",
            "member_count": 4,
            "meeting_count": 3,
            "created_at": "2026-08-01T02:00:00Z",
        },
        {
            "id": "ws_lab",
            "name": "AI 实验室",
            "owner_id": "u_chen",
            "plan": "free",
            "role": "member",
            "member_count": 3,
            "meeting_count": 1,
            "created_at": "2026-09-12T06:30:00Z",
        },
    ]

    workspace_members = {
        "ws_demo": [
            _member("u_lin", "demo@minutes.dev", "林知远", "13800138001", "owner", "2026-08-01T02:00:00Z"),
            _member("u_chen", "chen@minutes.dev", "陈慕", "13800138002", "admin", "2026-08-02T03:10:00Z"),
            _member("u_wang", "wang@minutes.dev", "王砚", "13800138003", "member", "2026-08-05T07:20:00Z"),
            _member("u_zhao", "zhao@minutes.dev", "赵时", "13800138004", "viewer", "2026-09-01T01:00:00Z"),
        ],
        "ws_lab": [
            _member("u_chen", "chen@minutes.dev", "陈慕", "13800138002", "owner", "2026-09-12T06:30:00Z"),
            _member("u_lin", "demo@minutes.dev", "林知远", "13800138001", "member", "2026-09-12T06:31:00Z"),
            _member("u_wang", "wang@minutes.dev", "王砚", "13800138003", "viewer", "2026-09-20T02:00:00Z"),
        ],
    }

    meetings = [
        _meeting(
            id="mtg_01JABCWEEKLY",
            workspace_id="ws_demo",
            created_by="u_lin",
            title="产品周会 · Q4 首个迭代",
            status="done",
            progress=100,
            audio_key="ws_demo/mtg_01JABCWEEKLY/original.m4a",
            audio_bytes=18_452_480,
            duration_sec=2712,
            language="zh",
            started_at="2026-10-20T02:00:00Z",
            created_at="2026-10-20T02:46:00Z",
            updated_at="2026-10-20T02:52:00Z",
        ),
        _meeting(
            id="mtg_01JABCAPI",
            workspace_id="ws_demo",
            created_by="u_chen",
            title="跨团队接口对齐会",
            status="done",
            progress=100,
            audio_key="ws_demo/mtg_01JABCAPI/original.mp3",
            audio_bytes=11_204_608,
            duration_sec=1860,
            language="zh",
            started_at="2026-10-22T07:00:00Z",
            created_at="2026-10-22T07:33:00Z",
            updated_at="2026-10-22T07:39:00Z",
        ),
        _meeting(
            id="mtg_01JABCFAILED",
            workspace_id="ws_demo",
            created_by="u_wang",
            title="增长实验复盘",
            status="failed",
            progress=62,
            audio_key="ws_demo/mtg_01JABCFAILED/original.m4a",
            audio_bytes=24_117_248,
            duration_sec=2405,
            language="zh",
            started_at="2026-10-24T09:30:00Z",
            created_at="2026-10-24T10:12:00Z",
            updated_at="2026-10-24T10:19:00Z",
            error={
                "code": "INTERNAL_ERROR",
                "message": "摘要服务超时（LLM 响应超过 60s）",
                "stage": "summarizing",
                "retryable": True,
            },
        ),
    ]

    transcript_segments = [
        _seg("mtg_01JABCWEEKLY", 1, 0, 18400, "林知远", "大家早，今天周会控制在 45 分钟。先过一下上个迭代的完成度，然后定新迭代的范围。"),
        _seg("mtg_01JABCWEEKLY", 2, 18400, 46200, "陈慕", "上个迭代一共排了 14 个需求，交付 11 个，3 个顺延。顺延的里面两个是依赖后端接口，一个是设计稿改版。"),
        _seg("mtg_01JABCWEEKLY", 3, 46200, 78500, "林知远", "顺延的三个我们不要塞进新迭代，先把新迭代的目标定清楚。这个季度的核心目标是「会议纪要闭环可用」，也就是上传到待办能跑通。"),
        _seg("mtg_01JABCWEEKLY", 4, 78500, 112000, "王砚", "那前端这块我建议先把上传和进度做扎实。现在最大的体验问题是长音频上传到 100% 之后界面没反馈，用户不知道还在处理。"),
        _seg("mtg_01JABCWEEKLY", 5, 112000, 148600, "林知远", "同意。进度要分两段：上传进度和 AI 处理进度，AI 处理走 SSE 推送，断线要能恢复。这个作为 P0。"),
        _seg("mtg_01JABCWEEKLY", 6, 148600, 181000, "陈慕", "后端我这边接口契约这周冻结，先给 mock，前端不用等我。转写和摘要我会做成两个独立阶段，失败可以单独重试。"),
        _seg("mtg_01JABCWEEKLY", 7, 181000, 214500, "赵时", "从测试角度我关注两件事：一是失败态有没有明确的重试入口，二是权限矩阵。上次演示 viewer 账号能看到删除按钮，这个必须修。"),
        _seg("mtg_01JABCWEEKLY", 8, 214500, 248000, "林知远", "权限这块前端不要自己写判断，全部用接口下发的 permissions 字段。后端也会补权限矩阵的自动化测试。"),
        _seg("mtg_01JABCWEEKLY", 9, 248000, 279000, "王砚", "待办看板我想做成三列拖拽，待办、进行中、完成。AI 提取出来的负责人和截止时间要能直接改，不能是黑盒。"),
        _seg("mtg_01JABCWEEKLY", 10, 279000, 312400, "陈慕", "摘要我会做成结构化 JSON，主题、结论、风险、待办四块。如果模型返回不合法，就降级成纯文本加一个重试按钮。"),
        _seg("mtg_01JABCWEEKLY", 11, 312400, 345000, "林知远", "分享链接要做成可撤销、可设过期，不需要登录就能看。这条对销售同事很重要。"),
        _seg("mtg_01JABCWEEKLY", 12, 345000, 372000, "赵时", "我补一个验收标准：空状态、错误态、加载态三态齐全，不然不能标记完成。"),
        _seg("mtg_01JABCWEEKLY", 13, 372000, 405000, "林知远", "行，那就这么定。下周一之前把上传链路和 SSF 进度跑通，周三一起过看板。散会。"),
        _seg("mtg_01JABCAPI", 1, 0, 22100, "陈慕", "今天主要对齐三件事：会议创建接口的字段、音频上传的方式、还有错误码。"),
        _seg("mtg_01JABCAPI", 2, 22100, 51600, "王砚", "上传我倾向 multipart 直接传，不要前端先传对象存储再回调，多一步就多一个失败点。"),
        _seg("mtg_01JABCAPI", 3, 51600, 84300, "陈慕", "可以。但文件大小和时长要在服务端再校验一次，前端校验只是体验优化。超限返回 VALIDATION_ERROR，字段级提示。"),
        _seg("mtg_01JABCAPI", 4, 84300, 118000, "林知远", "创建接口返回 202 加 job_id，前端拿到就订阅 events，不要轮询。"),
        _seg("mtg_01JABCAPI", 5, 118000, 152000, "陈慕", "events 我用 SSE，事件类型有 progress、error、done，另外每 15 秒发一个 ping 保活。"),
        _seg("mtg_01JABCAPI", 6, 152000, 189400, "王砚", "断线重连前端会自己退避重试，但重连之后要能直接拿到最新状态，不能从零开始。"),
        _seg("mtg_01JABCAPI", 7, 189400, 223000, "陈慕", "这个没问题，重新连上来我先推一条 status 事件带当前 progress。"),
        _seg("mtg_01JABCAPI", 8, 223000, 258000, "赵时", "错误码我想在契约里写死一张表，前端按码做分支，不要按 message 文案匹配。"),
        _seg("mtg_01JABCAPI", 9, 258000, 291000, "林知远", "对，message 是给人看的，code 是给程序看的。这条写进规范。"),
        _seg("mtg_01JABCAPI", 10, 291000, 322000, "陈慕", "那我今天把 OpenAPI 更新一版，前端明天就能基于 mock 开工。"),
        _seg("mtg_01JABCFAILED", 1, 0, 24600, "王砚", "复盘一下上周的三组实验：新用户引导、价格页改版、还有分享入口前置。"),
        _seg("mtg_01JABCFAILED", 2, 24600, 58400, "赵时", "引导那一组注册转化提升了 8.2%，但次日留存没变化，说明进来的人质量没提升。"),
        _seg("mtg_01JABCFAILED", 3, 58400, 92700, "林知远", "价格页改版那组数据我看过了，转化掉了 3 个点，我建议直接回滚，别再投入了。"),
        _seg("mtg_01JABCFAILED", 4, 92700, 129000, "王砚", "分享入口前置的效果最好，分享率翻了一倍，但分享出去的页面没有登录引导，转化断层。"),
        _seg("mtg_01JABCFAILED", 5, 129000, 165400, "赵时", "那下一轮实验我建议就补这个断层，在公开分享页加一个轻量的注册引导。"),
    ]

    summaries = [
        {
            "id": "sum_weekly_v2",
            "meeting_id": "mtg_01JABCWEEKLY",
            "model": "mock-llm-v1",
            "version": 2,
            "status": "ok",
            "created_at": "2026-10-20T02:52:00Z",
            "content": {
                "topics": ["上迭代交付复盘", "Q4 迭代目标", "上传与进度体验", "待办看板", "分享与权限"],
                "key_points": [
                    "上迭代 14 个需求交付 11 个，3 个顺延（2 个依赖后端接口、1 个设计改版）",
                    "本季度核心目标锁定「会议纪要闭环可用」：上传 → 转写 → 摘要 → 待办全链路打通",
                    "进度拆成上传进度与 AI 处理进度两段，AI 处理走 SSE 推送，断线可恢复",
                    "待办看板采用三列拖拽，AI 提取的负责人与截止时间允许人工修改",
                    "权限判断统一使用接口下发的 permissions 字段，前端不自行推导角色",
                ],
                "decisions": [
                    "顺延需求不并入新迭代，先保证新迭代目标清晰",
                    "上传方式定为 multipart 直传，不做前端先传对象存储再回调",
                    "摘要采用结构化 JSON（主题/结论/风险/待办），非法结构降级为纯文本 + 重试",
                    "分享链接支持撤销与过期，无需登录只读访问",
                ],
                "risks": [
                    "长音频处理耗时长，用户容易误以为卡住 —— 需靠进度与阶段文案缓解",
                    "LLM 返回结构不合法会导致摘要流程失败 —— 需 Schema 校验 + 降级",
                    "权限判断散落在组件里会造成越权入口 —— 必须统一走 permissions",
                ],
                "action_items": [
                    {"title": "上传与 SSE 进度联调完成", "owner": "王砚", "due_date": due_in(2)},
                    {"title": "接口契约冻结并输出 mock", "owner": "陈慕", "due_date": due_in(-3)},
                    {"title": "待办看板三列拖拽实现", "owner": "王砚", "due_date": due_in(2)},
                    {"title": "权限矩阵自动化测试补齐", "owner": "陈慕", "due_date": due_in(3)},
                ],
            },
        },
        {
            "id": "sum_weekly_v1",
            "meeting_id": "mtg_01JABCWEEKLY",
            "model": "mock-llm-v1",
            "version": 1,
            "status": "ok",
            "created_at": "2026-10-20T02:48:00Z",
            "content": {
                "topics": ["迭代复盘"],
                "key_points": ["上个迭代 14 个需求交付 11 个，3 个顺延。"],
                "decisions": ["顺延需求不并入新迭代。"],
                "risks": ["长音频处理耗时长。"],
                "action_items": [
                    {"title": "上传与 SSA 进度联调完成", "owner": "王砚", "due_date": due_in(2)}
                ],
            },
        },
        {
            "id": "sum_api_v1",
            "meeting_id": "mtg_01JABCAPI",
            "model": "mock-llm-v1",
            "version": 1,
            "status": "ok",
            "created_at": "2026-10-22T07:39:00Z",
            "content": {
                "topics": ["会议创建接口字段", "音频上传方式", "错误码规范", "SSE 事件协议"],
                "key_points": [
                    "上传采用 multipart 直传，服务端二次校验大小与时长",
                    "创建接口返回 202 + job_id，前端订阅 events 而非轮询",
                    "SSE 事件类型：progress / error / done，另有 15 秒 ping 保活",
                    "前端断线后指数退避重连，重连即收到当前 status 与 progress",
                ],
                "decisions": [
                    "超限统一返回 VALIDATION_ERROR，前端做字段级提示且不清空表单",
                    "错误码在契约中固化，前端按 code 分支，不匹配 message 文案",
                    "OpenAPI 当日更新一版，前端基于 mock 并行开工",
                ],
                "risks": [
                    "若前端自行推导权限会出现越权入口",
                    "Reconnect 时若状态不同步，进度条会回退造成误解",
                ],
                "action_items": [
                    {"title": "更新 OpenAPI 并合入主干", "owner": "陈慕", "due_date": due_in(-5)},
                    {"title": "前端接入 events 并实现退避重连", "owner": "王砚", "due_date": due_in(-1)},
                ],
            },
        },
    ]

    def _item(item_id, meeting_id, owner_id, owner_name, title, status, priority, due, created, updated):
        return {
            "id": item_id,
            "meeting_id": meeting_id,
            "owner_id": owner_id,
            "owner_name": owner_name,
            "title": title,
            "status": status,
            "priority": priority,
            "due_date": due,
            "created_at": created,
            "updated_at": updated,
        }

    action_items = [
        _item("ai_upload_sse", "mtg_01JABCWEEKLY", "u_wang", "王砚", "上传链路与 SSE 进度联调完成", "in_progress", "high", due_in(2), "2026-10-20T02:52:00Z", "2026-10-24T06:10:00Z"),
        _item("ai_contract", "mtg_01JABCWEEKLY", "u_chen", "陈慕", "接口契约冻结并输出 mock server", "done", "high", due_in(-3), "2026-10-20T02:52:00Z", "2026-10-23T09:00:00Z"),
        _item("ai_board", "mtg_01JABCWEEKLY", "u_wang", "王砚", "待办看板三列拖拽实现", "todo", "medium", due_in(2), "2026-10-20T02:52:00Z", "2026-10-20T02:52:00Z"),
        _item("ai_policy", "mtg_01JABCWEEKLY", "u_chen", "陈慕", "权限矩阵自动化测试补齐", "todo", "high", due_in(3), "2026-10-20T02:52:00Z", "2026-10-20T02:52:00Z"),
        _item("ai_tristate", "mtg_01JABCWEEKLY", "u_zhao", "赵时", "三态（空/错/加载）走查清单产出", "todo", "low", None, "2026-10-20T02:52:00Z", "2026-10-20T02:52:00Z"),
        _item("ai_openapi", "mtg_01JABCAPI", "u_chen", "陈慕", "更新 OpenAPI 并合入主干", "done", "high", due_in(-5), "2026-10-22T07:39:00Z", "2026-10-22T09:20:00Z"),
        _item("ai_reconnect", "mtg_01JABCAPI", "u_wang", "王砚", "前端接入 events 并实现指数退避重连", "in_progress", "high", due_in(-1), "2026-10-22T07:39:00Z", "2026-10-25T01:40:00Z"),
        _item("ai_errorcode", "mtg_01JABCAPI", "u_zhao", "赵时", "错误码分支的场景用例（按 code 而非 message）", "todo", "medium", due_in(4), "2026-10-22T07:39:00Z", "2026-10-22T07:39:00Z"),
        _item("ai_rollback", "mtg_01JABCFAILED", "u_wang", "王砚", "回滚价格页改版实验", "todo", "high", due_in(2), "2026-10-24T10:12:00Z", "2026-10-24T10:12:00Z"),
        _item("ai_sharecta", "mtg_01JABCFAILED", "u_zhao", "赵时", "公开分享页补充注册引导 CTA", "todo", "medium", due_in(7), "2026-10-24T10:12:00Z", "2026-10-24T10:12:00Z"),
        _item("ai_template", "mtg_01JABCWEEKLY", "u_zhao", "赵时", "会议纪要模板走查并归档到知识库", "todo", "medium", due_in(-2), "2026-10-20T02:52:00Z", "2026-10-20T02:52:00Z"),
        _item("ai_archive", "mtg_01JABCWEEKLY", "u_lin", "林知远", "本周周会纪要归档并同步给干系人", "todo", "low", due_in(-1), "2026-10-20T02:52:00Z", "2026-10-20T02:52:00Z"),
    ]

    comments = [
        {
            "id": "cm_1",
            "target_type": "meeting",
            "target_id": "mtg_01JABCWEEKLY",
            "user_id": "u_chen",
            "user_name": "陈慕",
            "content": "契约这周冻结，前端不用等我，先按 mock 开工就行。",
            "created_at": "2026-10-20T03:10:00Z",
        },
        {
            "id": "cm_2",
            "target_type": "meeting",
            "target_id": "mtg_01JABCWEEKLY",
            "user_id": "u_zhao",
            "user_name": "赵时",
            "content": "补充一条验收：viewer 账号必须看不到任何写操作入口。",
            "created_at": "2026-10-20T05:42:00Z",
        },
        {
            "id": "cm_3",
            "target_type": "action_item",
            "target_id": "ai_upload_sse",
            "user_id": "u_lin",
            "user_name": "林知远",
            "content": "断线重连这块记得在演示脚本里演一下，这是加分项。",
            "created_at": "2026-10-24T07:05:00Z",
        },
    ]

    def _participant(uid, name, email, role, is_creator, joined_at):
        return {
            "user_id": uid,
            "name": name,
            "email": email,
            "avatar_url": None,
            "meeting_role": role,
            "is_creator": is_creator,
            "joined_at": joined_at,
        }

    meeting_participants = {
        "mtg_01JABCWEEKLY": [
            _participant("u_lin", "林知远", "demo@minutes.dev", "host", True, "2026-10-20T02:00:00Z"),
            _participant("u_chen", "陈慕", "chen@minutes.dev", "recorder", False, "2026-10-20T02:00:00Z"),
            _participant("u_wang", "王砚", "wang@minutes.dev", "participant", False, "2026-10-20T02:00:00Z"),
            _participant("u_zhao", "赵时", "zhao@minutes.dev", "observer", False, "2026-10-20T02:00:00Z"),
        ],
        "mtg_01JABCAPI": [
            _participant("u_chen", "陈慕", "chen@minutes.dev", "host", True, "2026-10-22T07:00:00Z"),
            _participant("u_wang", "王砚", "wang@minutes.dev", "recorder", False, "2026-10-22T07:00:00Z"),
            _participant("u_lin", "林知远", "demo@minutes.dev", "participant", False, "2026-10-22T07:05:00Z"),
        ],
        "mtg_01JABCFAILED": [
            _participant("u_wang", "王砚", "wang@minutes.dev", "host", True, "2026-10-24T09:30:00Z"),
            _participant("u_zhao", "赵时", "zhao@minutes.dev", "participant", False, "2026-10-24T09:30:00Z"),
        ],
    }

    def _attachment(aid, meeting_id, uploader_id, uploader_name, file_name, mime, size, kind, created_at):
        return {
            "id": aid,
            "meeting_id": meeting_id,
            "uploader_id": uploader_id,
            "uploader_name": uploader_name,
            "file_name": file_name,
            "mime_type": mime,
            "size_bytes": size,
            "kind": kind,
            "url": f"/api/v1/attachments/{aid}/content",
            "created_at": created_at,
        }

    attachments = [
        _attachment("att_board", "mtg_01JABCWEEKLY", "u_chen", "陈慕", "迭代排期白板.png", "image/png", 486_912, "image", "2026-10-20T02:30:00Z"),
        _attachment("att_contract", "mtg_01JABCWEEKLY", "u_chen", "陈慕", "接口契约 v0.1.pdf", "application/pdf", 2_284_560, "doc", "2026-10-20T02:34:00Z"),
        _attachment("att_voice", "mtg_01JABCWEEKLY", "u_wang", "王砚", "白板讨论片段.wav", "audio/wav", 88_200, "audio", "2026-10-20T02:40:00Z"),
        _attachment("att_api_doc", "mtg_01JABCAPI", "u_wang", "王砚", "SSE 事件协议.md", "text/markdown", 12_480, "doc", "2026-10-22T07:20:00Z"),
    ]

    share_links = [
        {
            "id": "sl_1",
            "meeting_id": "mtg_01JABCWEEKLY",
            "token": "shr_demo_weekly_2026",
            "scope": "read_transcript",
            "expires_at": "2026-11-20T02:00:00Z",
            "revoked_at": None,
            "created_at": "2026-10-20T03:00:00Z",
        }
    ]

    audit_logs = [
        {
            "id": "ad_1",
            "workspace_id": "ws_demo",
            "actor_id": "u_lin",
            "actor_name": "林知远",
            "action": "workspace.create",
            "target": "ws_demo",
            "created_at": "2026-08-01T02:00:00Z",
        },
        {
            "id": "ad_2",
            "workspace_id": "ws_demo",
            "actor_id": "u_lin",
            "actor_name": "林知远",
            "action": "member.invite",
            "target": "chen@minutes.dev · admin",
            "created_at": "2026-08-02T03:10:00Z",
        },
        {
            "id": "ad_3",
            "workspace_id": "ws_demo",
            "actor_id": "u_chen",
            "actor_name": "陈慕",
            "action": "meeting.create",
            "target": "mtg_01JABCAPI · 跨团队接口对齐会",
            "created_at": "2026-10-22T07:00:00Z",
        },
        {
            "id": "ad_4",
            "workspace_id": "ws_demo",
            "actor_id": "u_lin",
            "actor_name": "林知远",
            "action": "share.create",
            "target": "mtg_01JABCWEEKLY · 7 天内有效",
            "created_at": "2026-10-20T03:00:00Z",
        },
        {
            "id": "ad_5",
            "workspace_id": "ws_demo",
            "actor_id": "u_wang",
            "actor_name": "王砚",
            "action": "meeting.retry",
            "target": "mtg_01JABCFAILED · 从 summarizing 恢复",
            "created_at": "2026-10-24T10:26:00Z",
        },
    ]

    return {
        "users": users,
        "workspaces": workspaces,
        "workspace_members": workspace_members,
        "meetings": meetings,
        "transcript_segments": transcript_segments,
        "summaries": summaries,
        "action_items": action_items,
        "comments": comments,
        "meeting_participants": meeting_participants,
        "attachments": attachments,
        "share_links": share_links,
        "audit_logs": audit_logs,
        "todo_reminders": {},
        "attachment_files": {},
        "audio_files": {},
    }
