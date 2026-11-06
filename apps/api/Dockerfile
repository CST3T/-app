FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt ./
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
RUN pip install --no-cache-dir -i "$PIP_INDEX_URL" -r requirements.txt

# 语音识别模型：
# - 随包内置（apps/api/models/faster-whisper-small）时直接拷入，运行时离线可用
# - 仅源码（无模型权重）时，构建阶段自动从 HuggingFace 下载（默认走国内镜像）
COPY models/ /models/
ARG HF_ENDPOINT=https://hf-mirror.com
ENV HF_ENDPOINT=$HF_ENDPOINT \
    HF_HUB_DISABLE_XET=1
RUN if [ ! -f /models/faster-whisper-small/model.bin ]; then \
      echo "未发现内置模型，构建阶段下载 Systran/faster-whisper-small ..." && \
      HF_HUB_DISABLE_XET=1 python -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='Systran/faster-whisper-small', local_dir='/models/faster-whisper-small')"; \
    else echo "使用内置语音模型，跳过下载"; fi

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

RUN mkdir -p /data/storage

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
