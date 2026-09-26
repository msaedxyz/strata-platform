"""Object storage for raw files and normalised text.

The S3 backend (boto3) runs when STRATA_S3_ENDPOINT_URL is set. Docker Compose uses SeaweedFS.
Otherwise the filesystem backend writes under STRATA_STORAGE_DIR (default ./.data/objects).
A URI names each object: s3://<bucket>/<key> or fs://<key>.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Protocol

from .settings import REPO_ROOT, get_settings


class Storage(Protocol):
    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str: ...
    def get(self, uri: str) -> bytes: ...
    def delete(self, uri: str) -> None: ...
    def exists(self, uri: str) -> bool: ...


class FileStorage:
    scheme = "fs"

    def __init__(self, root: Path) -> None:
        self.root = Path(root).resolve()

    def _path(self, key_or_uri: str) -> Path:
        key = key_or_uri.split("://", 1)[1] if "://" in key_or_uri else key_or_uri
        path = (self.root / key).resolve()
        if self.root not in path.parents:
            raise ValueError(f"object key outside the storage root: {key}")
        return path

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_bytes(data)
        tmp.replace(path)
        return f"fs://{key}"

    def get(self, uri: str) -> bytes:
        return self._path(uri).read_bytes()

    def delete(self, uri: str) -> None:
        self._path(uri).unlink(missing_ok=True)

    def exists(self, uri: str) -> bool:
        return self._path(uri).exists()


class S3Storage:
    scheme = "s3"

    def __init__(self, endpoint_url: str, bucket: str, access_key: str | None, secret_key: str | None) -> None:
        import boto3
        from botocore.config import Config

        self.bucket = bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name="us-east-1",
            config=Config(s3={"addressing_style": "path"}, retries={"max_attempts": 3}),
        )
        self._bucket_ready = False
        self._lock = threading.Lock()

    def _ensure_bucket(self) -> None:
        if self._bucket_ready:
            return
        with self._lock:
            from botocore.exceptions import ClientError

            try:
                self.client.head_bucket(Bucket=self.bucket)
            except ClientError:
                self.client.create_bucket(Bucket=self.bucket)
            self._bucket_ready = True

    def _key(self, uri: str) -> str:
        prefix = f"s3://{self.bucket}/"
        if not uri.startswith(prefix):
            raise ValueError(f"object is not in bucket {self.bucket}: {uri}")
        return uri[len(prefix):]

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        self._ensure_bucket()
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)
        return f"s3://{self.bucket}/{key}"

    def get(self, uri: str) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=self._key(uri))["Body"].read()

    def delete(self, uri: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=self._key(uri))

    def exists(self, uri: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            self.client.head_object(Bucket=self.bucket, Key=self._key(uri))
            return True
        except ClientError:
            return False


_storage: Storage | None = None


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        s = get_settings()
        if s.s3_endpoint_url:
            _storage = S3Storage(s.s3_endpoint_url, s.s3_bucket, s.s3_access_key, s.s3_secret_key)
        else:
            _storage = FileStorage(s.storage_dir or (REPO_ROOT / ".data" / "objects"))
    return _storage


def reset_storage() -> None:
    """Tests call this after they change the storage settings."""
    global _storage
    _storage = None
