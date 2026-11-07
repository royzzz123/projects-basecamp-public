#!/usr/bin/env python3
import os
import sys
import json
import time
import logging
import argparse
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

from minio import Minio
from minio.error import S3Error

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "output")
FAILED_LOG = os.path.join(OUTPUT_DIR, "failed_uploads.json")
BUCKET_NAME = "complaints"
DEFAULT_ENDPOINT = "minio:9000"

os.makedirs(OUTPUT_DIR, exist_ok=True)

_file_handler = logging.FileHandler(os.path.join(OUTPUT_DIR, "upload_errors.log"))
_file_handler.setLevel(logging.WARNING)
_file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))

_stream_handler = logging.StreamHandler(sys.stdout)
_stream_handler.setLevel(logging.INFO)
_stream_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))

logging.basicConfig(level=logging.DEBUG, handlers=[_stream_handler, _file_handler])
log = logging.getLogger(__name__)

_failed_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Failed log helpers
# ---------------------------------------------------------------------------

def _load_failed_log():
    if os.path.exists(FAILED_LOG):
        try:
            with open(FAILED_LOG, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return []
    return []


def _append_failed(key, filename, object_name, error_msg):
    entry = {
        "key": key,
        "filename": filename,
        "object_name": object_name,
        "error": str(error_msg),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    with _failed_lock:
        failed = _load_failed_log()
        failed.append(entry)
        with open(FAILED_LOG, "w") as f:
            json.dump(failed, f, indent=2)


def _remove_from_failed_log(object_name):
    with _failed_lock:
        current = _load_failed_log()
        updated = [e for e in current if e["object_name"] != object_name]
        with open(FAILED_LOG, "w") as f:
            json.dump(updated, f, indent=2)


# ---------------------------------------------------------------------------
# Progress bar (same style as download.py)
# ---------------------------------------------------------------------------

class ProgressBar:
    def __init__(self, total, desc="Progress", bar_width=40):
        self.total = total
        self.desc = desc
        self.bar_width = bar_width
        self.current = 0
        self.success = 0
        self.failed = 0
        self.skipped = 0
        self.start_time = time.time()
        self._last_len = 0
        self._lock = threading.Lock()

    def update(self, n=1, success=False, failed=False, skipped=False):
        with self._lock:
            self.current += n
            if success:
                self.success += 1
            elif failed:
                self.failed += 1
            elif skipped:
                self.skipped += 1
            self._render()

    def _render(self):
        elapsed = time.time() - self.start_time
        rate = self.current / elapsed if elapsed > 0 and self.current > 0 else 0
        remaining = (self.total - self.current) / rate if rate > 0 else 0
        pct = self.current / self.total * 100 if self.total > 0 else 0
        filled = int(self.bar_width * self.current / self.total) if self.total > 0 else 0
        bar = "\u2588" * filled + "\u2591" * (self.bar_width - filled)
        eta_mins, eta_secs = divmod(int(remaining), 60)
        line = (
            f"\r{self.desc}: |{bar}| {self.current}/{self.total} "
            f"({pct:.1f}%) "
            f"\u2713{self.success} \u2717{self.failed} \u2298{self.skipped} "
            f"ETA {eta_mins:02d}:{eta_secs:02d}"
        )
        pad = self._last_len - len(line)
        sys.stdout.write(line + (" " * max(pad, 0)))
        sys.stdout.flush()
        self._last_len = len(line)

    def finish(self):
        with self._lock:
            elapsed = time.time() - self.start_time
            mins, secs = divmod(int(elapsed), 60)
            bar = "\u2588" * self.bar_width
            line = (
                f"\r{self.desc}: |{bar}| {self.total}/{self.total} "
                f"(100.0%) "
                f"\u2713{self.success} \u2717{self.failed} \u2298{self.skipped} "
                f"Done {mins:02d}:{secs:02d}"
            )
            sys.stdout.write(line + " " * max(self._last_len - len(line), 0) + "\n")
            sys.stdout.flush()


# ---------------------------------------------------------------------------
# MinIO client factory
# ---------------------------------------------------------------------------

def make_client(endpoint, access_key, secret_key):
    return Minio(
        endpoint,
        access_key=access_key,
        secret_key=secret_key,
        secure=False,  # http (local MinIO)
    )


def ensure_bucket(client):
    if not client.bucket_exists(BUCKET_NAME):
        client.make_bucket(BUCKET_NAME)
        log.info("Created bucket: %s", BUCKET_NAME)
    else:
        log.info("Bucket already exists: %s", BUCKET_NAME)


# ---------------------------------------------------------------------------
# Upload a single file
# ---------------------------------------------------------------------------

def upload_one(client, key, filename, pbar=None):
    file_path = os.path.join(OUTPUT_DIR, key, filename)
    object_name = f"{key}/{filename}"

    # Skip if object already exists in MinIO
    try:
        client.stat_object(BUCKET_NAME, object_name)
        if pbar:
            pbar.update(skipped=True)
        return True
    except S3Error as e:
        if e.code != "NoSuchKey":
            log.error("stat_object failed for %s: %s", object_name, e)
            _append_failed(key, filename, object_name, f"stat_error: {e}")
            if pbar:
                pbar.update(failed=True)
            return False
        # NoSuchKey means it doesn't exist yet — proceed with upload

    # Determine content type from extension
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    content_type_map = {
        "pdf": "application/pdf",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "tiff": "image/tiff",
        "tif": "image/tiff",
        "doc": "application/msword",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }
    content_type = content_type_map.get(ext, "application/octet-stream")

    try:
        file_size = os.path.getsize(file_path)
        client.fput_object(
            BUCKET_NAME,
            object_name,
            file_path,
            content_type=content_type,
        )
        log.debug("Uploaded %s (%d bytes)", object_name, file_size)
        if pbar:
            pbar.update(success=True)
        return True
    except Exception as e:
        log.error("Failed upload for %s: %s", object_name, e)
        _append_failed(key, filename, object_name, f"upload_error: {e}")
        if pbar:
            pbar.update(failed=True)
        return False


# ---------------------------------------------------------------------------
# Collect all tasks from output/ directory
# ---------------------------------------------------------------------------

def collect_tasks():
    tasks = []
    if not os.path.isdir(OUTPUT_DIR):
        log.error("Output directory not found: %s", OUTPUT_DIR)
        sys.exit(1)
    for key in sorted(os.listdir(OUTPUT_DIR)):
        key_dir = os.path.join(OUTPUT_DIR, key)
        if not os.path.isdir(key_dir):
            continue
        for filename in sorted(os.listdir(key_dir)):
            file_path = os.path.join(key_dir, filename)
            if os.path.isfile(file_path):
                tasks.append((key, filename))
    return tasks


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_upload(endpoint, access_key, secret_key, workers=20):
    client = make_client(endpoint, access_key, secret_key)
    ensure_bucket(client)

    tasks = collect_tasks()
    total = len(tasks)
    if total == 0:
        log.info("No files found in %s to upload.", OUTPUT_DIR)
        return

    log.info("Starting upload: %d files, %d workers, bucket=%s", total, workers, BUCKET_NAME)
    pbar = ProgressBar(total, desc="Upload   ")
    last_milestone = 0

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(upload_one, client, key, filename, pbar): (key, filename)
            for key, filename in tasks
        }
        for future in as_completed(futures):
            key, filename = futures[future]
            try:
                future.result()
            except Exception as e:
                object_name = f"{key}/{filename}"
                log.error("Unhandled error uploading %s: %s", object_name, e)
                _append_failed(key, filename, object_name, f"unhandled: {e}")
                pbar.update(failed=True)
            if pbar.current - last_milestone >= 1000:
                last_milestone = pbar.current
                log.info(
                    "Progress: %d/%d (%.1f%%) — %d success, %d failed, %d skipped",
                    pbar.current, total, pbar.current / total * 100,
                    pbar.success, pbar.failed, pbar.skipped,
                )

    pbar.finish()
    failed_count = len(_load_failed_log())
    log.info("=" * 60)
    log.info(
        "UPLOAD DONE: success=%d, failed=%d, skipped=%d",
        pbar.success, failed_count, pbar.skipped,
    )
    if failed_count > 0:
        log.info("%d failures logged to %s", failed_count, FAILED_LOG)
    log.info("=" * 60)


def cmd_retry_upload(endpoint, access_key, secret_key, workers=20):
    failed = _load_failed_log()
    if not failed:
        log.info("No failed uploads to retry.")
        return

    client = make_client(endpoint, access_key, secret_key)
    ensure_bucket(client)

    log.info("Retrying %d failed uploads, %d workers", len(failed), workers)
    pbar = ProgressBar(len(failed), desc="Retry    ")
    recovered = []
    still_failed = []

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(upload_one, client, e["key"], e["filename"], pbar): e
            for e in failed
        }
        for future in as_completed(futures):
            entry = futures[future]
            try:
                ok = future.result()
            except Exception as ex:
                log.error("Unhandled error retrying %s: %s", entry["object_name"], ex)
                ok = False
            if ok:
                recovered.append(entry)
                _remove_from_failed_log(entry["object_name"])  # remove immediately on success
            else:
                still_failed.append(entry)

    pbar.finish()
    log.info("=" * 60)
    log.info("RETRY DONE: recovered=%d, still_failed=%d", len(recovered), len(still_failed))
    if still_failed:
        log.info("%d failures remain in %s", len(still_failed), FAILED_LOG)
    log.info("=" * 60)


def cmd_status_upload(endpoint, access_key, secret_key):
    tasks = collect_tasks()
    total = len(tasks)
    client = make_client(endpoint, access_key, secret_key)

    uploaded = 0
    for key, filename in tasks:
        object_name = f"{key}/{filename}"
        try:
            client.stat_object(BUCKET_NAME, object_name)
            uploaded += 1
        except S3Error:
            pass

    remaining = total - uploaded
    pct = (uploaded / total * 100) if total > 0 else 0
    print(f"Progress: {uploaded}/{total} ({pct:.1f}%) files uploaded")
    print(f"Remaining: {remaining} files")
    print(f"Bucket: {BUCKET_NAME} @ {endpoint}")
    if os.path.exists(FAILED_LOG):
        print(f"Failed uploads: {len(_load_failed_log())} (see {FAILED_LOG})")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="SEBI Complaint Document Uploader — MinIO")
    parser.add_argument("--endpoint",   default=DEFAULT_ENDPOINT, help=f"MinIO endpoint (default: {DEFAULT_ENDPOINT})")
    parser.add_argument("--access-key", required=True,            help="MinIO access key")
    parser.add_argument("--secret-key", required=True,            help="MinIO secret key")

    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    sub_upload = subparsers.add_parser("upload", help="Upload all files from output/ to MinIO")
    sub_upload.add_argument("--workers", type=int, default=20, help="Concurrent workers (default: 20)")

    sub_retry = subparsers.add_parser("retry", help="Retry failed uploads from failed_uploads.json")
    sub_retry.add_argument("--workers", type=int, default=20, help="Concurrent workers (default: 20)")

    subparsers.add_parser("status", help="Show upload progress")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    if args.command == "upload":
        cmd_upload(args.endpoint, args.access_key, args.secret_key, workers=args.workers)
    elif args.command == "retry":
        cmd_retry_upload(args.endpoint, args.access_key, args.secret_key, workers=args.workers)
    elif args.command == "status":
        cmd_status_upload(args.endpoint, args.access_key, args.secret_key)


if __name__ == "__main__":
    main()
