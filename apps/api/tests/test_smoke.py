"""后端冒烟测试：覆盖前端依赖的核心链路。

运行：.venv/Scripts/python -m pytest -q
"""

from __future__ import annotations

import json
import os
import tempfile
import time

os.environ.setdefault("MINUTES_STORAGE_DIR", tempfile.mkdtemp(prefix="minutes-test-"))
os.environ.setdefault("MINUTES_PIPELINE_SCALE", "60")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

DEMO_EMAIL = "demo@minutes.dev"
DEMO_PASSWORD = "minutes2026"


def _client() -> TestClient:
    return TestClient(app)


def _login(client: TestClient, email: str = DEMO_EMAIL) -> dict:
    res = client.post("/api/v1/auth/login", json={"email": email, "password": DEMO_PASSWORD})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['data']['access_token']}"}


def test_health():
    with _client() as client:
        res = client.get("/api/v1/health")
        assert res.status_code == 200
        assert res.json()["data"]["status"] == "ok"


def test_login_me_and_workspaces():
    with _client() as client:
        headers = _login(client)
        me = client.get("/api/v1/me", headers=headers)
        assert me.status_code == 200
        payload = me.json()["data"]
        assert payload["user"]["name"] == "林知远"
        assert {w["id"] for w in payload["workspaces"]} == {"ws_demo", "ws_lab"}

        workspaces = client.get("/api/v1/workspaces", headers=headers).json()["data"]
        demo = next(w for w in workspaces if w["id"] == "ws_demo")
        assert demo["role"] == "owner"
        assert demo["member_count"] == 4

        members = client.get("/api/v1/workspaces/ws_demo/members", headers=headers)
        assert members.status_code == 200
        assert len(members.json()["data"]) == 4

        directory = client.get("/api/v1/workspaces/ws_demo/member-directory", headers=headers)
        assert directory.status_code == 200
        candidates = directory.json()["data"]
        assert len(candidates) == 6
        assert next(c for c in candidates if c["user_id"] == "u_lin")["in_workspace"] is True


def test_login_failure_and_refresh():
    with _client() as client:
        bad = client.post(
            "/api/v1/auth/login",
            json={"email": DEMO_EMAIL, "password": "wrong-password"},
        )
        assert bad.status_code == 401
        assert bad.json()["error"]["code"] == "UNAUTHORIZED"

        tokens = client.post(
            "/api/v1/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}
        ).json()["data"]
        refreshed = client.post(
            "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
        )
        assert refreshed.status_code == 200
        assert refreshed.json()["data"]["access_token"]


def test_meeting_list_and_detail():
    with _client() as client:
        headers = _login(client)
        page = client.get(
            "/api/v1/workspaces/ws_demo/meetings", headers=headers, params={"status": "done"}
        ).json()["data"]
        assert page["total"] == 2
        assert page["items"][0]["permissions"]["can_delete"] is True

        detail = client.get("/api/v1/meetings/mtg_01JABCWEEKLY", headers=headers).json()["data"]
        assert detail["meeting"]["title"] == "产品周会 · Q4 首个迭代"
        assert len(detail["participants"]) == 4
        assert detail["participants"][0]["meeting_role"] == "host"
        assert len(detail["attachments"]) == 3
        assert detail["summary"]["version"] == 2
        assert detail["counts"]["segments"] == 13

        transcript = client.get(
            "/api/v1/meetings/mtg_01JABCWEEKLY/transcript", headers=headers
        ).json()["data"]
        assert transcript[0]["seq"] == 1

        summary = client.get(
            "/api/v1/meetings/mtg_01JABCWEEKLY/summary", headers=headers
        ).json()["data"]
        assert summary["latest"]["id"] == "sum_weekly_v2"
        assert len(summary["history"]) == 2


def test_workspace_member_management():
    with _client() as client:
        headers = _login(client)
        created = client.post(
            "/api/v1/workspaces", headers=headers, json={"name": "冒烟工作区"}
        )
        assert created.status_code == 201
        wid = created.json()["data"]["id"]

        added = client.post(
            f"/api/v1/workspaces/{wid}/members",
            headers=headers,
            json={"name": "孙澄", "phone": "13800138005", "role": "member"},
        )
        assert added.status_code == 201, added.text
        member = added.json()["data"]
        assert member["user_id"] == "u_sun"
        assert member["role"] == "member"

        duplicate = client.post(
            f"/api/v1/workspaces/{wid}/members",
            headers=headers,
            json={"name": "孙澄", "phone": "13800138005", "role": "member"},
        )
        assert duplicate.status_code == 409

        bad_phone = client.post(
            f"/api/v1/workspaces/{wid}/members",
            headers=headers,
            json={"name": "测试", "phone": "123"},
        )
        assert bad_phone.status_code == 400
        assert bad_phone.json()["error"]["details"]["phone"]

        promoted = client.patch(
            f"/api/v1/workspaces/{wid}/members/{member['user_id']}",
            headers=headers,
            json={"role": "admin"},
        )
        assert promoted.status_code == 200
        assert promoted.json()["data"]["role"] == "admin"

        removed = client.delete(
            f"/api/v1/workspaces/{wid}/members/{member['user_id']}", headers=headers
        )
        assert removed.status_code == 204


def test_create_meeting_with_participants_and_pipeline():
    with _client() as client:
        headers = _login(client)
        res = client.post(
            "/api/v1/workspaces/ws_demo/meetings",
            headers=headers,
            data={
                "title": "冒烟评审会",
                "started_at": "2026-10-27T02:00:00Z",
                "language": "zh",
                "participants": json.dumps(
                    [
                        {"user_id": "u_chen", "meeting_role": "recorder"},
                        {"user_id": "u_wang", "meeting_role": "participant"},
                    ]
                ),
            },
            files={"audio": ("smoke.m4a", b"fake-audio-bytes", "audio/mp4")},
        )
        assert res.status_code == 202, res.text
        data = res.json()["data"]
        meeting_id = data["meeting_id"]
        assert data["status"] == "uploaded"
        assert data["job_id"].startswith("job_")

        detail = client.get(f"/api/v1/meetings/{meeting_id}", headers=headers).json()["data"]
        roles = {p["user_id"]: p["meeting_role"] for p in detail["participants"]}
        assert roles == {"u_lin": "host", "u_chen": "recorder", "u_wang": "participant"}

        # 处理流水线：转写 → 摘要 → 完成
        deadline = time.time() + 10
        status = None
        while time.time() < deadline:
            status = client.get(f"/api/v1/meetings/{meeting_id}", headers=headers).json()["data"][
                "meeting"
            ]["status"]
            if status == "done":
                break
            time.sleep(0.05)
        assert status == "done"

        detail = client.get(f"/api/v1/meetings/{meeting_id}", headers=headers).json()["data"]
        segments = client.get(f"/api/v1/meetings/{meeting_id}/transcript", headers=headers).json()[
            "data"
        ]
        assert len(segments) == 9
        assert detail["summary"]["status"] == "ok"
        assert len(detail["action_items"]) == 2
        assert detail["counts"]["attachments"] == 0


# SSE 为长连接，TestClient（ASGITransport）会缓冲整个响应体而挂起，
# 因此 SSE 放到联调阶段用真实 uvicorn + 浏览器/脚本验证，不放进单测。


def test_attachments_upload_and_delete():
    with _client() as client:
        headers = _login(client)
        uploaded = client.post(
            "/api/v1/meetings/mtg_01JABCAPI/attachments",
            headers=headers,
            files={"file": ("评审记录.md", b"# hello", "text/markdown")},
        )
        assert uploaded.status_code == 201, uploaded.text
        attachment = uploaded.json()["data"]
        assert attachment["kind"] == "doc"
        assert attachment["uploader_name"] == "林知远"

        content = client.get(f"/api/v1/attachments/{attachment['id']}/content")
        assert content.status_code == 200
        assert content.content == b"# hello"

        seed_image = client.get("/api/v1/attachments/att_board/content")
        assert seed_image.status_code == 200
        assert seed_image.headers["content-type"].startswith("image/svg+xml")

        deleted = client.delete(f"/api/v1/attachments/{attachment['id']}", headers=headers)
        assert deleted.status_code == 204
        assert client.get(f"/api/v1/attachments/{attachment['id']}/content").status_code == 404


def test_workspace_todos_and_remind():
    with _client() as client:
        headers = _login(client)
        todos = client.get("/api/v1/workspaces/ws_demo/todos", headers=headers).json()["data"]
        assert todos["summary"]["overdue"] == 3
        assert todos["permissions"]["can_remind"] is True
        overdue = next(
            item
            for group in todos["groups"]
            for item in group["items"]
            if item["is_overdue"] and item["owner_id"]
        )
        assert overdue["overdue_days"] >= 1

        reminded = client.post(
            f"/api/v1/workspaces/ws_demo/todos/{overdue['id']}/remind", headers=headers
        )
        assert reminded.status_code == 200, reminded.text
        assert reminded.json()["data"]["owner_name"] == overdue["owner_name"]

        again = client.get("/api/v1/workspaces/ws_demo/todos", headers=headers).json()["data"]
        match = next(
            item for group in again["groups"] for item in group["items"] if item["id"] == overdue["id"]
        )
        assert match["reminder_sent_at"]

        not_overdue = next(
            item
            for group in again["groups"]
            for item in group["items"]
            if not item["is_overdue"] and item["status"] != "done"
        )
        res = client.post(
            f"/api/v1/workspaces/ws_demo/todos/{not_overdue['id']}/remind", headers=headers
        )
        assert res.status_code == 400
        assert res.json()["error"]["code"] == "NOT_OVERDUE"


def test_search_and_shares():
    with _client() as client:
        headers = _login(client)
        hits = client.get(
            "/api/v1/workspaces/ws_demo/search", headers=headers, params={"q": "契约"}
        ).json()["data"]
        assert hits["query"] == "契约"
        assert len(hits["hits"]) > 0
        assert hits["hits"][0]["meeting_id"]

        created = client.post(
            "/api/v1/meetings/mtg_01JABCWEEKLY/share-links",
            headers=headers,
            json={"scope": "read", "expires_in_hours": 24},
        )
        assert created.status_code == 201, created.text
        link = created.json()["data"]

        public = client.get(f"/api/v1/public/shares/{link['token']}")
        assert public.status_code == 200
        payload = public.json()["data"]
        assert payload["transcript"] == []
        assert payload["summary"]["id"] == "sum_weekly_v2"

        revoked = client.delete(f"/api/v1/share-links/{link['id']}", headers=headers)
        assert revoked.status_code == 204
        assert client.get(f"/api/v1/public/shares/{link['token']}").status_code == 410


def test_permissions_matrix_and_delete():
    with _client() as client:
        viewer = _login(client, "zhao@minutes.dev")
        forbidden_create = client.post(
            "/api/v1/workspaces/ws_demo/meetings",
            headers=viewer,
            data={"title": "越权会议", "language": "zh"},
            files={"audio": ("x.m4a", b"x", "audio/mp4")},
        )
        assert forbidden_create.status_code == 403

        owner = _login(client)
        detail = client.get("/api/v1/meetings/mtg_01JABCAPI", headers=viewer).json()["data"]
        assert detail["permissions"]["can_comment"] is False
        assert detail["permissions"]["can_delete"] is False

        created = client.post(
            "/api/v1/workspaces/ws_demo/meetings",
            headers=owner,
            data={"title": "待删除会议", "language": "zh"},
            files={"audio": ("y.m4a", b"y", "audio/mp4")},
        )
        meeting_id = created.json()["data"]["meeting_id"]

        member = _login(client, "wang@minutes.dev")
        denied = client.delete(f"/api/v1/meetings/{meeting_id}", headers=member)
        assert denied.status_code == 403

        deleted = client.delete(f"/api/v1/meetings/{meeting_id}", headers=owner)
        assert deleted.status_code == 204
        assert client.get(f"/api/v1/meetings/{meeting_id}", headers=owner).status_code == 404
