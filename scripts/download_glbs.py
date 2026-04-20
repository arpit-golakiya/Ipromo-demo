#!/usr/bin/env python3
"""
Download GLB files listed in preloaded_models_rows.csv.

- Skips rows with missing/empty glb_url
- Continues on errors (expired signed URLs, 403/404, network errors)
- Concurrent downloads for speed

Usage:
  python scripts/download_glbs.py --csv preloaded_models_rows.csv --out glb_downloads --concurrency 8
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

import aiohttp


@dataclass(frozen=True)
class Row:
    row_no: int
    id: str
    product_name: str
    product_key: str
    group: str
    color_label: str
    glb_url: str


def _safe_slug(s: str, max_len: int = 80) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    if not s:
        return "item"
    return s[:max_len].rstrip("-")


def _guess_filename(r: Row) -> str:
    # Prefer stable, readable names; avoid super long paths.
    # Example: 89-group-1.glb
    base = "-".join(
        [
            _safe_slug(r.id, 20),
            _safe_slug(r.group, 30),
        ]
    )
    return f"{base}.glb"


def _product_dirname(r: Row) -> str:
    return _safe_slug(r.product_key or r.product_name, 120)


def _color_dirname(r: Row) -> str:
    # Prefer the actual color label; fall back to group id.
    return _safe_slug(r.color_label or r.group, 80)


def _is_probably_glb_url(url: str) -> bool:
    try:
        p = urlparse(url)
    except Exception:
        return False
    if p.scheme not in ("http", "https"):
        return False
    # Many signed URLs include ".glb" only in the path.
    return ".glb" in (p.path or "").lower()


def _parse_rows(csv_path: Path) -> list[Row]:
    rows: list[Row] = []
    with csv_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        for i, cols in enumerate(reader, start=1):
            # Expected (no header) based on your file:
            # 0 id
            # 1 product_url
            # 2 group
            # 3 color_label
            # 4 color_hex
            # 5 image_url
            # 6 task_uuid
            # 7 glb_url
            # 8 created_at
            # 9 updated_at
            # 10 product_name
            # 11 product_key
            # 12 decal_json
            if not cols or len(cols) < 8:
                continue
            rid = (cols[0] or "").strip()
            group = (cols[2] or "").strip() or "group"
            color_label = (cols[3] or "").strip() if len(cols) > 3 else ""
            glb_url = (cols[7] or "").strip()
            product_name = (cols[10] or "").strip() if len(cols) > 10 else ""
            product_key = (cols[11] or "").strip() if len(cols) > 11 else ""

            if not rid:
                continue
            if not glb_url:
                continue
            rows.append(
                Row(
                    row_no=i,
                    id=rid,
                    product_name=product_name,
                    product_key=product_key,
                    group=group,
                    color_label=color_label,
                    glb_url=glb_url,
                )
            )
    return rows


async def _download_one(
    session: aiohttp.ClientSession,
    sem: asyncio.Semaphore,
    r: Row,
    out_dir: Path,
    timeout_s: int,
    overwrite: bool,
) -> tuple[Row, bool, str]:
    async with sem:
        if not _is_probably_glb_url(r.glb_url):
            return (r, False, "skip: url does not look like .glb")

        product_dir = out_dir / _product_dirname(r)
        color_dir = product_dir / _color_dirname(r)
        out_path = color_dir / _guess_filename(r)
        if out_path.exists() and not overwrite:
            return (r, True, "skip: already downloaded")

        tmp_path = out_path.with_suffix(".glb.part")
        try:
            async with session.get(r.glb_url, timeout=aiohttp.ClientTimeout(total=timeout_s)) as resp:
                if resp.status != 200:
                    return (r, False, f"http {resp.status}")

                ctype = (resp.headers.get("content-type") or "").lower()
                # Some providers return application/octet-stream; accept it.
                if "html" in ctype:
                    return (r, False, "unexpected content-type (html)")

                color_dir.mkdir(parents=True, exist_ok=True)
                with tmp_path.open("wb") as f:
                    async for chunk in resp.content.iter_chunked(1024 * 256):
                        if chunk:
                            f.write(chunk)
                os.replace(tmp_path, out_path)
                return (r, True, "ok")
        except asyncio.TimeoutError:
            return (r, False, "timeout")
        except aiohttp.ClientError as e:
            return (r, False, f"client error: {e.__class__.__name__}")
        except Exception as e:
            return (r, False, f"error: {type(e).__name__}: {e}")
        finally:
            try:
                if tmp_path.exists():
                    tmp_path.unlink()
            except Exception:
                pass


async def run(args: argparse.Namespace) -> int:
    csv_path = Path(args.csv).resolve()
    out_dir = Path(args.out).resolve()
    concurrency = int(args.concurrency)
    timeout_s = int(args.timeout)
    overwrite = bool(args.overwrite)

    if not csv_path.exists():
        print(f"CSV not found: {csv_path}", file=sys.stderr)
        return 2

    rows = _parse_rows(csv_path)
    if not rows:
        print("No rows with glb_url found. Nothing to do.")
        return 0

    sem = asyncio.Semaphore(max(1, concurrency))

    connector = aiohttp.TCPConnector(limit=concurrency, ttl_dns_cache=60)
    headers = {
        "accept": "model/gltf-binary,application/octet-stream;q=0.9,*/*;q=0.8",
        "user-agent": "ipromo-glb-downloader/1.0",
    }

    ok = 0
    skipped_or_failed = 0
    # Per-product success tracking: a "skipped product" means 0 successful downloads for that product.
    product_total: dict[str, int] = {}
    product_ok: dict[str, int] = {}

    async with aiohttp.ClientSession(connector=connector, headers=headers) as session:
        tasks = [
            _download_one(session, sem, r, out_dir, timeout_s, overwrite)
            for r in rows
        ]
        for r in rows:
            pk = (r.product_key or r.product_name or "unknown").strip().lower()
            product_total[pk] = product_total.get(pk, 0) + 1
            product_ok.setdefault(pk, 0)

        for coro in asyncio.as_completed(tasks):
            r, success, msg = await coro
            if success and msg == "ok":
                ok += 1
                pk = (r.product_key or r.product_name or "unknown").strip().lower()
                product_ok[pk] = product_ok.get(pk, 0) + 1
            elif success:
                # "skip: already downloaded"
                skipped_or_failed += 1
            else:
                skipped_or_failed += 1

            # Compact progress output
            print(f"[row {r.row_no} id={r.id} {r.group} {r.color_label or ''}] {msg}")

    skipped_products = sum(1 for pk, total in product_total.items() if product_ok.get(pk, 0) == 0 and total > 0)

    print(
        f"\nDone. Downloaded: {ok}. Skipped/failed: {skipped_or_failed}. "
        f"Products fully skipped (0 colors downloaded): {skipped_products}. Output: {out_dir}"
    )
    return 0


def main() -> int:
    # The CSV includes very long fields (signed URLs + JSON). Raise the parser limit.
    try:
        csv.field_size_limit(sys.maxsize)
    except (OverflowError, ValueError):
        # Some platforms cap this; pick a high safe value.
        csv.field_size_limit(10_000_000)

    p = argparse.ArgumentParser()
    p.add_argument("--csv", default="preloaded_models_rows.csv", help="Path to CSV (default: preloaded_models_rows.csv)")
    p.add_argument("--out", default="glb_downloads", help="Output directory (default: glb_downloads)")
    p.add_argument("--concurrency", type=int, default=8, help="Concurrent downloads (default: 8)")
    p.add_argument("--timeout", type=int, default=120, help="Per-download timeout seconds (default: 120)")
    p.add_argument("--overwrite", action="store_true", help="Overwrite existing files")
    args = p.parse_args()

    try:
        return asyncio.run(run(args))
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())

