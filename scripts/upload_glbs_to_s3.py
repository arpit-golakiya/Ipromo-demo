from __future__ import annotations

import argparse
import asyncio
import csv
import hashlib
import mimetypes
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import boto3
from botocore.exceptions import ClientError

from dotenv import load_dotenv

load_dotenv()

@dataclass(frozen=True)
class Item:
    path: Path
    product: str
    color: str
    filename: str


def _iter_glbs(root: Path) -> list[Item]:
    items: list[Item] = []
    for p in root.rglob("*.glb"):
        rel = p.relative_to(root)
        parts = rel.parts
        if len(parts) < 3:
            # require product/color/file.glb
            continue
        product = parts[0]
        color = parts[1]
        filename = parts[-1]
        items.append(Item(path=p, product=product, color=color, filename=filename))
    return sorted(items, key=lambda x: str(x.path).lower())


def _join_key(prefix: str, product: str, color: str, filename: str) -> str:
    prefix = (prefix or "").strip().strip("/")
    if prefix:
        return f"{prefix}/{product}/{color}/{filename}"
    return f"{product}/{color}/{filename}"


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _content_type(path: Path) -> str:
    # GLB
    return "model/gltf-binary"


async def _upload_one(
    sem: asyncio.Semaphore,
    s3,
    bucket: str,
    key: str,
    item: Item,
    overwrite: bool,
    dry_run: bool,
) -> tuple[Item, bool, str, Optional[str], Optional[int], Optional[str]]:
    async with sem:
        try:
            if not overwrite:
                try:
                    s3.head_object(Bucket=bucket, Key=key)
                    return (item, True, "skip: exists", None, None, None)
                except ClientError as e:
                    code = str(e.response.get("Error", {}).get("Code", ""))
                    if code not in ("404", "NoSuchKey", "NotFound"):
                        return (item, False, f"head error: {code}", None, None, None)

            size = item.path.stat().st_size
            sha = _sha256_file(item.path)
            if dry_run:
                return (item, True, "dry-run", None, size, sha)

            # Upload (private bucket)
            extra = {
                "ContentType": _content_type(item.path),
                "Metadata": {"sha256": sha},
            }
            s3.upload_file(str(item.path), bucket, key, ExtraArgs=extra)

            # Fetch ETag
            try:
                head = s3.head_object(Bucket=bucket, Key=key)
                etag = (head.get("ETag") or "").strip('"') or None
            except Exception:
                etag = None

            return (item, True, "ok", etag, size, sha)
        except Exception as e:
            return (item, False, f"error: {type(e).__name__}: {e}", None, None, None)


async def run(args: argparse.Namespace) -> int:
    in_dir = Path(args.input).resolve()
    manifest_path = Path(args.manifest).resolve()
    bucket = args.bucket
    region = args.region
    prefix = args.prefix or ""
    concurrency = max(1, int(args.concurrency))
    overwrite = bool(args.overwrite)
    dry_run = bool(args.dry_run)

    if not in_dir.exists():
        print(f"Input folder not found: {in_dir}")
        return 2

    items = _iter_glbs(in_dir)
    if not items:
        print(f"No .glb files found under: {in_dir}")
        return 0

    # boto3 client (thread-safe enough for our single-thread async wrapper)
    session = boto3.session.Session(region_name=region)
    s3 = session.client("s3")

    sem = asyncio.Semaphore(concurrency)

    ok = 0
    failed = 0
    skipped = 0

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    with manifest_path.open("w", encoding="utf-8", newline="") as mf:
        w = csv.writer(mf)
        w.writerow(
            [
                "local_path",
                "product",
                "color",
                "filename",
                "bucket",
                "s3_key",
                "s3_uri",
                "status",
                "etag",
                "size_bytes",
                "sha256",
            ]
        )

        tasks = []
        for it in items:
            key = _join_key(prefix, it.product, it.color, it.filename)
            tasks.append(_upload_one(sem, s3, bucket, key, it, overwrite, dry_run))

        for coro in asyncio.as_completed(tasks):
            it, success, msg, etag, size, sha = await coro
            key = _join_key(prefix, it.product, it.color, it.filename)
            s3_uri = f"s3://{bucket}/{key}"
            w.writerow(
                [
                    str(it.path),
                    it.product,
                    it.color,
                    it.filename,
                    bucket,
                    key,
                    s3_uri,
                    msg,
                    etag or "",
                    size if size is not None else "",
                    sha or "",
                ]
            )
            print(f"[{it.product}/{it.color}/{it.filename}] {msg}")
            if msg.startswith("skip:"):
                skipped += 1
            elif success:
                ok += 1
            else:
                failed += 1

    print(f"\nDone. Uploaded: {ok}. Skipped: {skipped}. Failed: {failed}. Manifest: {manifest_path}")
    return 0 if failed == 0 else 1


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="input", default="glb_downloads", help="Input folder (default: glb_downloads)")
    p.add_argument("--bucket", required=True, help="S3 bucket name")
    p.add_argument("--region", required=True, help="AWS region, e.g. us-east-1")
    p.add_argument("--prefix", default="", help="Optional S3 prefix, e.g. models")
    p.add_argument("--concurrency", type=int, default=16, help="Concurrent uploads (default: 16)")
    p.add_argument("--overwrite", action="store_true", help="Overwrite existing objects")
    p.add_argument("--dry-run", action="store_true", help="Do not upload, just write manifest")
    p.add_argument("--manifest", default="s3_manifest.csv", help="Output manifest CSV (default: s3_manifest.csv)")
    args = p.parse_args()

    return asyncio.run(run(args))


if __name__ == "__main__":
    raise SystemExit(main())

