# 会记 Minutes · AI 会议纪要 App

> 上传录音 → 自动转写 → 结构化摘要 → 提取待办 → 看板跟进。
> 让每场会议从「开完就忘」变成「有负责人、有截止时间、有完成状态」的下一步。

一个可完整运行、可当场演示的 AI 会议纪要 Web / PWA 应用。采用 monorepo（前后端同仓），
同步接口做 CRUD，异步 Worker 跑 AI，SSE 把处理进度实时推回前端。

- 演示账号：`demo@minutes.dev` / `minutes2026`
- 文档版本：v1.4（2026-10-30）

---

## 一、项目简介

**会记 Minutes** 面向 5–30 人的研发 / 产品团队，解决周会、复盘会、对齐会「无纪要、待办
不落、开完就忘」的问题。一段会议录音上传后，系统自动完成：

1. **异步语音转写（ASR）**：本地 faster-whisper 离线识别（免费、可无网运行），按时间戳
   分段，点击任意一段即可跳转到音频对应位置；
2. **结构化摘要（LLM）**：生成议题、关键结论、决策、风险与待办，摘要保留版本历史，可
   重新生成与对比回退；
3. **行动项提取与看板跟进**：待办自动带出负责人 / 截止时间 / 优先级，支持三列看板拖拽、
   跨会议按人聚合、逾期一键提醒；
4. **团队协作**：四角色权限（Owner / Admin / Member / Viewer）、会议身份（主持 / 记录 /
   参会 / 旁听）、会议资料共享、评论、只读分享链接、操作审计。

核心链路：`uploaded → transcribing → summarizing → done / failed`，失败可从断点重试，
已完成阶段不重复执行。

---

## 二、技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 前端 | Next.js 15 (App Router) + React 19 + TypeScript 5 + Tailwind CSS 3 | 页面、上传、播放器联动、看板、PWA |
| 前端数据 | TanStack Query 5、Radix UI、dnd-kit（看板拖拽）、wavesurfer.js、Zod | MSW 提供 49 个接口的浏览器内 Mock，零后端也能演示 |
| 后端 | Python 3.11 + FastAPI 0.116 + Pydantic v2 + SQLAlchemy 2 + Alembic | 49 个 REST 接口，统一响应信封，自动生成 OpenAPI `/docs` |
| 认证安全 | JWT（HS256，access 1h / refresh 30d 旋转）、PBKDF2 口令哈希、RBAC | 登录失败限流、JWT 密钥强制配置 |
| 异步 | Redis 队列（List + processing 回灌 + 死信）+ 独立 Worker 进程 | 未配 Redis 时自动降级为进程内 asyncio |
| 数据库 | PostgreSQL 16 + pgvector | 14 张业务表，全文 GIN 索引 + 向量 HNSW 索引；未配库时降级内存存储 |
| 对象存储 | MinIO / S3（私有桶 + 10 分钟预签名 URL） | 未配置时回退本地 `apps/api/storage/` |
| AI | faster-whisper small（本地离线转写）/ 阿里云 NLS（可选）；通义千问 qwen-plus（OpenAI 兼容，可选） | 未配置时回退内置 mock 演示模板 |
| 工程化 | Docker Compose、GitHub Actions CI、Makefile | 一条命令拉起 postgres/redis/minio/api/worker/web |
| 测试 | Playwright（20 条 E2E）、pytest（13 条）、Vitest | Mock 与真实后端两种模式下 E2E 均通过 |
| 实时通信 | SSE（`text/event-stream`）+ Redis Pub/Sub | 进度 / 状态 / 错误 / done 推送，15s 心跳，5s 按库兜底 |

---

## 三、目录结构

```
会议纪要app/
├── apps/
│   ├── web/                  # Next.js 15 前端
│   │   ├── app/              # 10 个路由 + 公开分享页（App Router）
│   │   ├── components/       # app-shell / meetings / board / ui 等组件
│   │   ├── lib/              # API client、hooks、类型定义
│   │   ├── mocks/            # MSW：49 个接口的内存实现
│   │   ├── e2e/              # Playwright 端到端用例（20 条）
│   │   └── package.json
│   └── api/                  # FastAPI 后端
│       ├── app/
│       │   ├── main.py       # 应用入口、路由挂载、异常处理
│       │   ├── routers/      # auth / workspaces / meetings / collaboration
│       │   ├── pipeline.py   # 转写 + 摘要处理流水线
│       │   ├── queue.py      # Redis 队列 / 死信 / Pub-Sub 广播
│       │   ├── worker.py     # 独立 Worker：消费队列、推进流水线
│       │   ├── asr.py        # 语音识别适配层（local / aliyun / mock）
│       │   ├── llm.py        # LLM 摘要适配层（OpenAI 兼容 / mock）
│       │   ├── repository.py # PostgreSQL 仓储（水合 / 写穿 / 降级）
│       │   ├── security.py   # JWT 与口令哈希
│       │   ├── models.py     # SQLAlchemy 14 表模型
│       │   └── seed.py       # 演示种子（与前端 Mock 同源）
│       ├── alembic/          # 数据库迁移（0001_init）
│       ├── tests/            # pytest 用例（13 条）
│       ├── requirements.txt  # Python 依赖说明
│       └── Dockerfile
├── packages/contracts/       # openapi.yaml（前后端共用接口契约，49 个接口）
├── infra/                    # docker-compose.yml、.env.example、schema.sql
├── scripts/                  # backup.sh / restore.sh
├── .github/workflows/        # CI（pytest / 迁移 SQL / typecheck / build / E2E）
├── Makefile                  # env/up/migrate/seed/test/backup 等命令
└── 项目开发文档.md            # 完整项目开发文档（架构 / 功能 / 开发 / 验收）
```

---

## 四、环境配置

### 4.1 环境要求

| 软件 | 版本要求 | 用途 |
|---|---|---|
| Node.js | 20+ | 前端开发、构建、Playwright |
| Python | 3.11+ | 后端与 Worker |
| Docker Desktop | 24+（可选） | 仅「完整版一键启动」需要，用于 PostgreSQL/Redis/MinIO |

> 只看界面演示：无需 Python、无需 Docker、无需任何 API Key（前端内置 MSW Mock）。

### 4.2 依赖安装

前端：

```powershell
cd apps/web
npm install
```

后端：

```powershell
cd apps/api
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

完整依赖清单分别见 [apps/web/package.json](apps/web/package.json) 与
[apps/api/requirements.txt](apps/api/requirements.txt)。

### 4.3 关键环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `NEXT_PUBLIC_API_MOCKING` | 前端是否启用 MSW Mock（`off` 连接真实后端） | 开启 |
| `NEXT_PUBLIC_API_BASE` | 前端请求的 API 前缀 | `/api/v1` |
| `MINUTES_JWT_SECRET` | JWT 签名密钥（**真实后端必填**，至少 24 位） | 无 |
| `MINUTES_ALLOW_INSECURE_JWT` | 本地无密钥临时放行（生产禁止） | `0` |
| `DATABASE_URL` | PostgreSQL 连接串；不设则用内存存储 | 空（内存） |
| `REDIS_URL` | Redis 地址；不设则用进程内队列 | 空（进程内） |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` | MinIO/S3 对象存储 | 空（本地磁盘） |
| `ASR_PROVIDER` | 转写提供方：`local` / `aliyun` / `mock` | `local` |
| `LLM_API_KEY` / `LLM_MODEL` | 云端大模型摘要（OpenAI 兼容，默认通义 qwen-plus） | 空（演示模板） |
| `MINUTES_ENABLE_RESET` | 是否开放 `POST /dev/reset`（E2E 用） | `0` |
| `MINUTES_PIPELINE_SCALE` | 流水线倍速（越大越快，便于演示） | `1` |

完整变量见 [项目开发文档.md](项目开发文档.md)「3.4 本地环境」与
[infra/.env.example](infra/.env.example)。

---

## 五、启动 / 运行方法

提供三种运行方式，按场景选择。

### 方式 A：只跑前端（最快，零依赖，默认 Mock）

```powershell
cd apps/web
npm install
npm run dev
# 打开 http://localhost:3000
# 演示账号 demo@minutes.dev / minutes2026
```

全部 49 个接口由浏览器内 MSW Mock 提供，可完整体验界面与交互；刷新页面恢复演示种子。

### 方式 B：前端 + 真实后端（真实语音识别，无需 Docker）

终端 1 —— 启动后端（内置 faster-whisper 本地转写，模型位于 `apps/api/models`）：

```powershell
cd apps/api
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:MINUTES_ALLOW_INSECURE_JWT = "1"     # 本地演示临时放行；正式使用请设 MINUTES_JWT_SECRET
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

终端 2 —— 前端关闭 Mock 并指向后端：

```powershell
cd apps/web
# 创建 .env.local，内容：
# NEXT_PUBLIC_API_MOCKING=off
# NEXT_PUBLIC_API_BASE=http://localhost:8000/api/v1
npm run dev
```

- API 健康检查：http://localhost:8000/api/v1/health
- 接口文档（Swagger）：http://localhost:8000/docs
- 此模式数据存进程内存 + `apps/api/storage/`，重启恢复种子。

### 方式 C：完整版一键启动（Docker 全栈，含 PostgreSQL/Redis/MinIO/Worker）

**Windows 直接双击仓库根目录的 [`一键启动-完整版.bat`](一键启动-完整版.bat)**，脚本会自动
拉起 Docker Desktop → `compose up -d` → 等待服务就绪 → 打开浏览器。

或手动执行：

```powershell
copy infra\.env.example .env       # 然后编辑 .env，设置 MINUTES_JWT_SECRET
docker compose -f infra/docker-compose.yml up -d --build
docker compose -f infra/docker-compose.yml run --rm api alembic upgrade head
docker compose -f infra/docker-compose.yml run --rm api python -m app.seed_db
# 打开 http://localhost:3000
```

也可使用 Makefile：`make env && make up && make migrate && make seed`。

### 常用命令

```powershell
# 前端
cd apps/web
npm run dev          # 开发
npm run build        # 生产构建
npm run typecheck    # TypeScript 类型检查
npx playwright test  # 端到端测试（20 条）

# 后端
cd apps/api
.\.venv\Scripts\python.exe -m pytest -q          # 后端测试（13 条）
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000

# Docker 全栈
docker compose -f infra/docker-compose.yml ps     # 查看服务状态
docker compose -f infra/docker-compose.yml logs -f api
```

---

## 六、主要功能

- **会议记录与智能处理**：音频拖拽上传（≤200MB / 30 分钟）、异步转写、时间戳分段与
  播放器联动、结构化摘要（议题 / 结论 / 决策 / 风险 / 待办）、失败断点重试。
- **行动项与协作**：自动提取待办、三列看板拖拽、跨会议待办聚合、逾期提醒（站内消息 +
  审计留痕）、评论、只读分享链接（可设过期、可撤销）。
- **团队与权限**：工作区四角色 RBAC + 会议四身份（两者解耦）、人员库、姓名 + 手机号
  邀请成员、单一主持人保证（更换主持自动降级原主持）。
- **会议资料**：图片 / 音频 / 视频 / 文档上传（单文件 ≤50MB）、在线预览、私有桶存储。
- **搜索与审计**：关键词搜索（标题 / 转写 / 摘要 / 待办，结果高亮）、操作审计日志。
- **其他**：PWA 离线兜底、暗色商务科技主题、移动端 390px 适配、按键音效（可关）。

---

## 七、接口与文档

- 接口契约（49 个接口）：[packages/contracts/openapi.yaml](packages/contracts/openapi.yaml)
- 后端说明：[apps/api/README.md](apps/api/README.md)
- 完整开发文档（架构、数据模型 14 表、状态机、权限矩阵、开发规范、验收证据）：
  [项目开发文档.md](项目开发文档.md)
- 统一响应格式：成功 `{ "data": ..., "request_id": "req_xxx" }`；
  失败 `{ "error": { "code", "message", "details" }, "request_id" }`。
