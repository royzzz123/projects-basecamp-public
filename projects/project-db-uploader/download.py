#!/usr/bin/env python3
import json
import os
import sys
import time
import logging
import threading
import argparse
import urllib.request
import urllib.parse
import urllib.error
import ssl
from concurrent.futures import ThreadPoolExecutor, as_completed

TOKEN_URL = "https://scoresinternal.sebi.gov.in/o/oauth2/token"
DEFAULT_SITE_ID = "163175"
METADATA_URL = "https://scoresinternal.sebi.gov.in:443/o/headless-delivery/v1.0/sites/{site_id}/documents/by-external-reference-code/{doc_id}"
BASE_URL = "https://scoresinternal.sebi.gov.in"
CLIENT_ID = "replace-me-client-id"
CLIENT_SECRET = "replace-me-client-secret"
TOKEN_REFRESH_MARGIN = 200
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
JSON_FILE = os.path.join(SCRIPT_DIR, "complaint_doc_urls.json")
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "output")
FAILED_LOG = os.path.join(OUTPUT_DIR, "failed_downloads.json")

os.makedirs(OUTPUT_DIR, exist_ok=True)

_file_handler = logging.FileHandler(os.path.join(OUTPUT_DIR, "errors.log"))
_file_handler.setLevel(logging.WARNING)
_file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))

_stream_handler = logging.StreamHandler(sys.stdout)
_stream_handler.setLevel(logging.INFO)
_stream_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))

logging.basicConfig(
    level=logging.DEBUG,
    handlers=[_stream_handler, _file_handler],
)
log = logging.getLogger(__name__)

_token_cache = {"access_token": None, "expires_at": 0}
_token_lock = threading.Lock()

_ssl_ctx = ssl.create_default_context()

_failed_lock = threading.Lock()


def _load_failed_log():
    if os.path.exists(FAILED_LOG):
        try:
            with open(FAILED_LOG, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return []
    return []


def _append_failed(key, doc_id, error_msg):
    entry = {
        "key": key,
        "doc_id": doc_id,
        "error": str(error_msg),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    with _failed_lock:
        failed = _load_failed_log()
        # Upsert: update existing entry if (key, doc_id) already present,
        # otherwise append. Prevents duplicates when retry also fails.
        # Also requires both doc_ids to be non-None to avoid matching two null entries.
        for existing in failed:
            if (doc_id is not None
                    and existing["doc_id"] is not None
                    and existing["key"] == key
                    and existing["doc_id"] == doc_id):
                existing["error"] = entry["error"]
                existing["timestamp"] = entry["timestamp"]
                break
        else:
            failed.append(entry)
        with open(FAILED_LOG, "w") as f:
            json.dump(failed, f, indent=2)


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
        if self.current > 0:
            rate = self.current / elapsed
            remaining = (self.total - self.current) / rate if rate > 0 else 0
        else:
            remaining = 0
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


def http_post(url, data=None, headers=None, timeout=30):
    if data:
        data = data.encode("utf-8") if isinstance(data, str) else data
    req = urllib.request.Request(url, data=data, headers=headers or {}, method="POST")
    resp = urllib.request.urlopen(req, timeout=timeout, context=_ssl_ctx)
    return resp


def http_get(url, headers=None, timeout=60):
    req = urllib.request.Request(url, headers=headers or {})
    resp = urllib.request.urlopen(req, timeout=timeout, context=_ssl_ctx)
    return resp


def get_token():
    with _token_lock:
        now = time.time()
        if _token_cache["access_token"] and now < _token_cache["expires_at"] - TOKEN_REFRESH_MARGIN:
            return _token_cache["access_token"]
        log.info("Refreshing auth token...")
        body = urllib.parse.urlencode({
            "grant_type": "client_credentials",
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
        })
        resp = http_post(TOKEN_URL, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
        data = json.loads(resp.read().decode("utf-8"))
        _token_cache["access_token"] = data["access_token"]
        _token_cache["expires_at"] = now + data.get("expires_in", 1200)
        log.info("Token refreshed, expires in %ds", data.get("expires_in", 1200))
        return _token_cache["access_token"]


def get_metadata(doc_id, site_id=DEFAULT_SITE_ID):
    token = get_token()
    url = METADATA_URL.format(site_id=site_id, doc_id=doc_id)
    resp = http_get(url, headers={"Authorization": f"Bearer {token}"}, timeout=30)
    return json.loads(resp.read().decode("utf-8"))


def download_one(key, doc_id, pbar=None, site_id=DEFAULT_SITE_ID):
    # Guard: skip entries with missing/null doc_id
    if not doc_id:
        log.warning("Skipping entry for key %s: doc_id is null/empty", key)
        if pbar:
            pbar.update(skipped=True)
        return True
    key_dir = os.path.join(OUTPUT_DIR, key)
    os.makedirs(key_dir, exist_ok=True)
    existing = [f for f in os.listdir(key_dir) if f.startswith(doc_id + ".")]
    if existing:
        if pbar:
            pbar.update(skipped=True)
        return True
    try:
        metadata = get_metadata(doc_id, site_id=site_id)
    except Exception as e:
        log.error("Failed metadata for %s/%s: %s", key, doc_id, e)
        _append_failed(key, doc_id, f"metadata_error: {e}")
        if pbar:
            pbar.update(failed=True)
        return False
    content_url = metadata.get("contentUrl", "")
    file_ext = metadata.get("fileExtension", "").lower()
    if not file_ext:
        file_ext = metadata.get("fileName", "").rsplit(".", 1)[-1].lower() if "." in metadata.get("fileName", "") else "bin"
    if not content_url:
        log.error("No contentUrl for %s/%s", key, doc_id)
        _append_failed(key, doc_id, "no_content_url")
        if pbar:
            pbar.update(failed=True)
        return False
    file_path = os.path.join(key_dir, f"{doc_id}.{file_ext}")
    try:
        download_url = BASE_URL + content_url
        token = get_token()
        resp = http_get(download_url, headers={"Authorization": f"Bearer {token}"}, timeout=120)
        with open(file_path, "wb") as f:
            while True:
                chunk = resp.read(8192)
                if not chunk:
                    break
                f.write(chunk)
        if pbar:
            pbar.update(success=True)
        return True
    except Exception as e:
        log.error("Failed download for %s/%s: %s", key, doc_id, e)
        _append_failed(key, doc_id, f"download_error: {e}")
        if pbar:
            pbar.update(failed=True)
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except OSError:
                pass
        return False


def load_data():
    with open(JSON_FILE, "r") as f:
        return json.load(f)


def cmd_all(workers=20):
    data = load_data()
    total_keys = len(data)
    total_docs = sum(len(ids) for ids in data.values())
    all_tasks = []
    for key, doc_ids in data.items():
        for doc_id in doc_ids:
            all_tasks.append((key, doc_id))
    log.info("Starting download: %d keys, %d total documents, %d workers", total_keys, total_docs, workers)
    pbar = ProgressBar(total_docs, desc="Overall  ")
    last_milestone = 0
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {}
        for key, doc_id in all_tasks:
            future = executor.submit(download_one, key, doc_id, pbar)
            futures[future] = (key, doc_id)
        for future in as_completed(futures):
            key, doc_id = futures[future]
            try:
                future.result()
            except Exception as e:
                log.error("Unhandled error for %s/%s: %s", key, doc_id, e)
                _append_failed(key, doc_id, f"unhandled: {e}")
                pbar.update(failed=True)
            if pbar.current - last_milestone >= 1000:
                last_milestone = pbar.current
                log.info("Progress: %d/%d (%.1f%%) — %d success, %d failed, %d skipped",
                         pbar.current, total_docs, pbar.current / total_docs * 100,
                         pbar.success, pbar.failed, pbar.skipped)
    pbar.finish()
    failed_count = len(_load_failed_log())
    skipped_count = pbar.skipped
    success_count = pbar.success
    log.info("=" * 60)
    log.info("ALL DONE: success=%d, failed=%d, skipped=%d", success_count, failed_count, skipped_count)
    if failed_count > 0:
        log.info("%d failures logged to %s", failed_count, FAILED_LOG)
    log.info("=" * 60)


def cmd_key(key, workers=20):
    data = load_data()
    if key not in data:
        log.error("Key %s not found in data. Available keys: %s", key, ", ".join(list(data.keys())[:10]) + "...")
        sys.exit(1)
    doc_ids = data[key]
    log.info("Downloading key %s (%d documents, %d workers)", key, len(doc_ids), workers)
    pbar = ProgressBar(len(doc_ids), desc=f"Key {key}")
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {}
        for doc_id in doc_ids:
            future = executor.submit(download_one, key, doc_id, pbar)
            futures[future] = doc_id
        for future in as_completed(futures):
            doc_id = futures[future]
            try:
                future.result()
            except Exception as e:
                log.error("Unhandled error for %s/%s: %s", key, doc_id, e)
                _append_failed(key, doc_id, f"unhandled: {e}")
                pbar.update(failed=True)
    pbar.finish()
    failed_count = len([e for e in _load_failed_log() if e["key"] == key])
    log.info("Key %s: success=%d, failed=%d, skipped=%d", key, pbar.success, failed_count, pbar.skipped)
    if failed_count > 0:
        log.info("%d failures for key %s logged to %s", failed_count, key, FAILED_LOG)


def cmd_status():
    data = load_data()
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    total_docs = sum(len(ids) for ids in data.values())
    downloaded = 0
    keys_done = 0
    for key, doc_ids in data.items():
        key_dir = os.path.join(OUTPUT_DIR, key)
        key_complete = True
        for doc_id in doc_ids:
            if os.path.isdir(key_dir):
                existing = [f for f in os.listdir(key_dir) if f.startswith(doc_id + ".")]
                if existing:
                    downloaded += 1
                else:
                    key_complete = False
            else:
                key_complete = False
        if key_complete and len(doc_ids) > 0:
            keys_done += 1
    remaining = total_docs - downloaded
    pct = (downloaded / total_docs * 100) if total_docs > 0 else 0
    print(f"Progress: {downloaded}/{total_docs} ({pct:.1f}%) documents downloaded")
    print(f"Keys: {keys_done}/{len(data)} complete")
    print(f"Remaining: {remaining} documents")
    print(f"Output dir: {OUTPUT_DIR}")
    if os.path.exists(FAILED_LOG):
        failed = _load_failed_log()
        print(f"Failed downloads: {len(failed)} (see {FAILED_LOG})")


def cmd_token():
    try:
        token = get_token()
        log.info("Token obtained successfully (length=%d)", len(token))
        log.info("Token prefix: %s...", token[:30])
    except Exception as e:
        log.error("Failed to get token: %s", e)
        sys.exit(1)


def _remove_from_failed_log(entry):
    """Remove a single entry from failed_downloads.json immediately after it succeeds."""
    with _failed_lock:
        current = _load_failed_log()
        updated = [
            e for e in current
            if not (e["key"] == entry["key"] and e["doc_id"] == entry["doc_id"])
        ]
        with open(FAILED_LOG, "w") as f:
            json.dump(updated, f, indent=2)


def cmd_retry(workers=20, site_id=DEFAULT_SITE_ID):
    failed = _load_failed_log()
    if not failed:
        log.info("No failed downloads to retry.")
        return

    log.info("Retrying %d failed downloads, %d workers, site_id=%s", len(failed), workers, site_id)
    pbar = ProgressBar(len(failed), desc="Retry    ")
    recovered = []
    still_failed = []

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(download_one, e["key"], e["doc_id"], pbar, site_id): e for e in failed}
        for future in as_completed(futures):
            entry = futures[future]
            try:
                ok = future.result()
            except Exception as ex:
                log.error("Unhandled error retrying %s/%s: %s", entry["key"], entry["doc_id"], ex)
                ok = False
            if ok:
                recovered.append(entry)
                _remove_from_failed_log(entry)  # remove immediately on success
            else:
                still_failed.append(entry)

    pbar.finish()

    log.info("=" * 60)
    log.info("RETRY DONE: recovered=%d, still_failed=%d", len(recovered), len(still_failed))
    if still_failed:
        log.info("%d failures remain in %s", len(still_failed), FAILED_LOG)
    log.info("=" * 60)


def cmd_keys():
    data = load_data()
    for key in data:
        print(key)


def main():
    parser = argparse.ArgumentParser(description="SEBI Complaint Document Downloader")
    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    sub_all = subparsers.add_parser("all", help="Download all documents")
    sub_all.add_argument("--workers", type=int, default=20, help="Number of concurrent workers (default: 20)")

    sub_key = subparsers.add_parser("key", help="Download documents for a specific key")
    sub_key.add_argument("key", help="Complaint key to download")
    sub_key.add_argument("--workers", type=int, default=20, help="Number of concurrent workers (default: 20)")

    subparsers.add_parser("status", help="Show download progress")
    subparsers.add_parser("token", help="Test auth token retrieval")
    subparsers.add_parser("keys", help="List all available keys")

    sub_retry = subparsers.add_parser("retry", help="Retry all failed downloads from failed_downloads.json")
    sub_retry.add_argument("--workers", type=int, default=20, help="Number of concurrent workers (default: 20)")
    sub_retry.add_argument("--site-id", type=str, default=DEFAULT_SITE_ID, help=f"Site ID for metadata URL (default: {DEFAULT_SITE_ID})")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    if args.command == "all":
        cmd_all(workers=args.workers)
    elif args.command == "key":
        cmd_key(args.key, workers=args.workers)
    elif args.command == "status":
        cmd_status()
    elif args.command == "token":
        cmd_token()
    elif args.command == "keys":
        cmd_keys()
    elif args.command == "retry":
        cmd_retry(workers=args.workers, site_id=args.site_id)


if __name__ == "__main__":
    main()