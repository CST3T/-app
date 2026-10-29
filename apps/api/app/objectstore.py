"""S3 兼容对象存储客户端（本地默认 MinIO）。

只在 S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY 全部配置时启用；
未配置则调用方自动回退本地目录存储（见 storage.py），保证纯演示零依赖。
"""

from __future__ import annotations

import os
from functools import lru_cache

DEFAULT_EXPIRES = 600  # 10 分钟，与契约一致


def enabled() -> bool:
    return all(
        (os.getenv(name) or "").strip()
        for name in ("S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY")
    )


def _endpoint(public: bool = False) -> str:
    if public:
        return (os.getenv("S3_PUBLIC_ENDPOINT") or os.getenv("S3_ENDPOINT") or "").rstrip("/")
    return (os.getenv("S3_ENDPOINT") or "").rstrip("/")


@lru_cache(maxsize=2)
def _client(endpoint: str):
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=os.getenv("S3_ACCESS_KEY"),
        aws_secret_access_key=os.getenv("S3_SECRET_KEY"),
        region_name=os.getenv("S3_REGION", "us-east-1"),
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def _bucket() -> str:
    return os.getenv("S3_BUCKET", "minutes")


def put(key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    _client(_endpoint()).put_object(
        Bucket=_bucket(), Key=key, Body=data, ContentType=content_type
    )


def read(key: str) -> bytes | None:
    from botocore.exceptions import ClientError

    try:
        res = _client(_endpoint()).get_object(Bucket=_bucket(), Key=key)
        return res["Body"].read()
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in ("NoSuchKey", "404", "NoSuchBucket"):
            return None
        raise


def exists(key: str) -> bool:
    from botocore.exceptions import ClientError

    try:
        _client(_endpoint()).head_object(Bucket=_bucket(), Key=key)
        return True
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchKey", "NoSuchBucket"):
            return False
        raise


def delete(key: str) -> None:
    from botocore.exceptions import ClientError

    try:
        _client(_endpoint()).delete_object(Bucket=_bucket(), Key=key)
    except ClientError:
        pass


def signed_url(key: str, expires: int = DEFAULT_EXPIRES) -> str:
    """生成对外可访问的预签名 GET 地址（默认 10 分钟）。"""
    return _client(_endpoint(public=True)).generate_presigned_url(
        "get_object",
        Params={"Bucket": _bucket(), "Key": key},
        ExpiresIn=expires,
    )
