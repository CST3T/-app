# 会记 Minutes API

前端已按契约完成，本目录是与之对齐的后端实现：**关掉前端 Mock 即可直连**。

- 契约：[packages/contracts/openapi.yaml](../../packages/contracts/openapi.yaml)
- 行为基准：[apps/web/mocks/handlers.ts](../web/mocks/handlers.ts)（接口、错误码、SSE、上传解析）
- 部署形态：FastAPI + 进程内存储 + 本地文件存储（演示版，重启恢复种子数据）

## 启动

```powershell
cd apps/api
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
# 必填：至少 24 位随机密钥（缺失/过短/示例值会拒绝启动）
$env:MINUTES_JWT_SECRET = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
# 不想设密钥时，本地可临时放行：$env:MINUTES_ALLOW_INSECURE_JWT = '1'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

- API 根路径：`http://localhost:8000/api/v1`
- 交互文档：`http://localhost:8000/docs`
- 健康检查：`GET http://localhost:8000/api/v1/health`
- 就绪探针：`GET http://localhost:8000/api/v1/ready`（PostgreSQL / Redis / 存储）
- 演示账号：`demo@minutes.dev / minutes2026`，工作区 `ws_demo`

## 前端联调

在 `apps/web` 下创建 `.env.local`：

```env
NEXT_PUBLIC_API_MOCKING=off
NEXT_PUBLIC_API_BASE=http://localhost:8000/api/v1
```

重启 `npm run dev` 即可。后端已放开 CORS（`localhost` / `127.0.0.1` 任意端口）。

## 已实现接口

| 模块 | 能力 |
| --- | --- |
| 认证 | 注册、登录、refresh 旋转、`/me` |
| 工作区 | 列表/创建/详情/改名、成员列表、人员库、添加/改角色/移除、审计日志 |
| 会议 | 列表（状态/搜索/分页）、multipart 创建（幂等键）、详情聚合、编辑、软删除、音频替换 |
| 处理 | 触发处理、失败重试（断点）、SSE `status/progress/error/done/ping`、转写、摘要（版本历史 + 重新生成） |
| 协作 | 待办 CRUD、工作区待办聚合与逾期提醒、评论、全文检索、分享链接与公开只读页、参会成员与会议资料 |
| 资料 | 上传（≤50MB）、内容流、删除；种子资料提供可视化占位内容 |

响应统一为 `{ data, request_id }`，错误统一为 `{ error: { code, message, details }, request_id }`。

## 演示行为

- 处理流水线：转写 9s（2%→70%）、摘要 6s（70%→100%）；标题包含「失败/超时/fail」会在摘要阶段模拟失败，用于演示断点重试。
- 种子数据与前端 Mock 完全一致：3 场会议、12 条待办（含 3 条逾期）、4 份资料、分享链接、审计日志等。
- 数据存内存，文件落盘 `apps/api/storage/`（已 gitignore）。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `MINUTES_JWT_SECRET` | **无，必填** | JWT 签名密钥（≥24 位），缺失/过短/示例值拒绝启动 |
| `MINUTES_ALLOW_INSECURE_JWT` | `0` | 本地单测/无密钥演示时放行固定开发密钥，生产禁止 |
| `MINUTES_ACCESS_TTL` | `3600` | access token 秒数 |
| `MINUTES_STORAGE_DIR` | `apps/api/storage` | 附件/音频目录 |
| `MINUTES_PIPELINE_SCALE` | `1` | 流水线倍速，测试可调大（如 `60`） |
| `MINUTES_LOG_FORMAT` | `text` | 日志格式：`text` / `json` |
| `MINUTES_ENABLE_RESET` | `0` | 是否开放 `POST /dev/reset`，本地 E2E 需显式置 `1` |
| `DATABASE_URL` | 空 | 配置后 `/ready` 会真实探测 PostgreSQL（本地内存模式留空） |
| `REDIS_URL` | 空 | 配置后 `/ready` 探测 Redis |
| `S3_ENDPOINT` | 空 | 对象存储内部地址（如 `http://minio:9000`）；四项 `S3_*` 齐全才启用 |
| `S3_PUBLIC_ENDPOINT` | 同 `S3_ENDPOINT` | 生成预签名 URL 用的对外地址（本地 `http://localhost:9000`） |

## 测试

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m pytest -q
```

前端 E2E 连真实后端时，后端是全局状态（Mock 是每页重建种子），因此需要每个用例前恢复种子。
已提供 `POST /api/v1/dev/reset`（**默认关闭**，需设 `MINUTES_ENABLE_RESET=1` 后重启后端），并在前端 E2E 夹具里用
`E2E_RESET_API` 启用自动重置：

```powershell
cd apps/web
$env:BASE_URL='http://localhost:3000'
$env:E2E_RESET_API='http://127.0.0.1:8000/api/v1/dev/reset'
npx playwright test   # 真实后端 20/20 通过
```

## 数据与平台（v0.2 数据负责人交付，v1.2 增补对象存储）

| 能力 | 位置 | 状态 |
| --- | --- | --- |
| 14 表模型 | `app/models.py` | 完成（与文档 1.4 对应） |
| 迁移 | `alembic/versions/0001_init.py` | 完成；`alembic upgrade head --sql` 可离线校验 |
| 种子入库 | `app/seed_db.py`（`python -m app.seed_db [--reset]`） | 完成，与 `build_seed()` 同源 |
| 对象存储 | `app/objectstore.py`、`app/storage.py` | 完成：MinIO 私有桶 + 10 分钟预签名 URL；未配 S3 回退本地 |
| 连接与就绪探测 | `app/db.py`、`GET /api/v1/ready` | 完成；未配置依赖时按「未启用」放行 |
| 结构化日志 | `app/logging.py`（`MINUTES_LOG_FORMAT=json`） | 完成 |
| 编排 | [infra/docker-compose.yml](../../infra/docker-compose.yml)、两个 Dockerfile、[Makefile](../../Makefile) | 完成，2026-10-29 实机跑通 |
| 备份/恢复 | `scripts/backup.sh`、`scripts/restore.sh` | 完成（14 天保留），已演练一次 |
| CI | [.github/workflows/ci.yml](../../.github/workflows/ci.yml) | 完成（pytest / 迁移 SQL / typecheck / lint / build / E2E） |

迁移与种子（Docker 已可用）：

```bash
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
docker compose -f infra/docker-compose.yml --env-file .env run --rm api alembic upgrade head
docker compose -f infra/docker-compose.yml --env-file .env run --rm api python -m app.seed_db
```

本机实测结果（Docker Desktop 4.97 / CLI 29.9.2）：

- 5 个服务全部 Up（postgres/redis/minio/api healthy，web 运行中），`minio-init` 建桶后退 0
- 迁移后 15 张表（14 业务表 + `alembic_version`），`vector` 扩展与 4 个关键索引齐全
- 种子：6 用户 / 2 工作区 / 3 会议 / 28 分段 / 3 摘要 / 12 待办 / 4 资料 / 5 审计
- `/api/v1/ready`：database / redis / storage 均 `configured:true, ok:true`
- 备份恢复演练：`pg_dump | gzip` → 临时库恢复，表数与行数一致
- 镜像拉取提示：Docker Hub 直连超时，需配 `registry-mirrors`；minio 系列在 `docker.1panel.live` 可用

离线校验迁移（无需数据库）：

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m alembic upgrade head --sql
```

> 当前业务读写仍走 `store.py` 内存结构；上表是生产化的数据底座，接入时按 Repository 层替换，接口与前端不变。

## 与生产形态的差距

演示版刻意收敛了基础设施：进程内存储、进程内 asyncio 流水线、单进程 SSE。生产化路径见
[项目开发文档.md](../../项目开发文档.md)：PostgreSQL（14 张表）、Redis 队列 + Worker、MinIO 对象存储、多副本 SSE。接口层与前端契约不变，替换存储与队列即可。
