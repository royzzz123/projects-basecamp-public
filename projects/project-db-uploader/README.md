# SEBI Complaint Document Downloader & Uploader

## Overview

Two scripts:

- **`download.py`** — downloads complaint documents from SEBI's SCORES internal portal. The data in `complaint_doc_urls.json` contains **15,568 complaint keys** with **42,236 total documents** to download.
- **`upload.py`** — uploads the downloaded files from `output/` into a MinIO bucket (`complaints`).

## How It Works

### Download (`download.py`)

1. **Auth**: POST to `https://scoresinternal.sebi.gov.in/o/oauth2/token` to get a Bearer token (expires in 20 min, auto-refreshes 3 min early)
2. **Metadata**: GET document metadata by `doc_id` using the Bearer token — URL uses the configured `site_id` (default: `163175`)
3. **Download**: Download the file from the `contentUrl` in the metadata response, also authenticated with the Bearer token

Downloads are **concurrent** using a thread pool — configurable via `--workers`.

### Upload (`upload.py`)

1. **Connect**: Initialize a MinIO client using `--endpoint`, `--access-key`, `--secret-key` (default endpoint: `minio:9000`, plain HTTP)
2. **Bucket**: Ensure the `complaints` bucket exists (created if missing)
3. **Walk**: Enumerate every file under `output/<key>/<filename>` and upload as object `<key>/<filename>`
4. **Skip-if-exists**: Each file is `stat_object`-checked first; existing objects are skipped
5. **Content-Type**: Inferred from file extension (`pdf`, `jpg/jpeg`, `png`, `tiff/tif`, `doc`, `docx`, else `application/octet-stream`)

Uploads are **concurrent** using a thread pool — configurable via `--workers`.

### File Structure

```
minio/
├── download.py              # Downloader script (SEBI → output/)
├── upload.py                # Uploader script (output/ → MinIO)
├── complaint_doc_urls.json  # Source data (key -> [doc_ids])
├── Dockerfile               # Docker image definition
├── .dockerignore
├── README.md
├── output/                   # Downloaded files (created at runtime)
│   ├── 1743302/
│   │   ├── 0e9b8d25-73a7-cf67-475c-ea8e68b463fe.jpeg
│   │   ├── 99d5847c-364d-88d7-9648-6df291c367c3.pdf
│   │   └── ...
│   ├── 1743303/
│   │   └── ...
│   ├── failed_downloads.json # Structured log of failed downloads
│   ├── errors.log            # Downloader error log
│   ├── failed_uploads.json   # Structured log of failed uploads
│   └── upload_errors.log     # Uploader error log
```

## Building the Docker Image

```bash
docker build -t sebi-downloader .
```

```bash
docker run -d --name sebi-downloader \
  -v $(pwd)/output:/app/output \
  sebi-downloader
```

**IN SEBI VM RUN THIS:-**

```bash
docker run -d --name sebi-downloader \
  -v /home/spiuser3/complaints_data:/app/output \
  sebi-downloader

```

This keeps the container running with `sleep infinity` so you can execute commands via `docker exec`.

## Commands — Downloader

All commands are run inside the container:

```bash
# Download ALL documents (default 20 workers)
docker exec sebi-downloader python download.py all

# Download ALL documents with 100 concurrent workers
docker exec sebi-downloader python download.py all --workers 100

# Download documents for a specific complaint key
docker exec sebi-downloader python download.py key 1743302

# Download with 50 workers for a specific key
docker exec sebi-downloader python download.py key 1743302 --workers 50

# Check download progress
docker exec sebi-downloader python download.py status

# Test auth token retrieval
docker exec sebi-downloader python download.py token

# List all available complaint keys
docker exec sebi-downloader python download.py keys

# Retry all failed downloads (from failed_downloads.json)
docker exec sebi-downloader python download.py retry

# Retry with more workers
docker exec sebi-downloader python download.py retry --workers 50

# Retry with a different site ID
docker exec sebi-downloader python download.py retry --site-id 999999

# Retry with a different site ID and more workers
docker exec sebi-downloader python download.py retry --site-id 999999 --workers 50

# Get an interactive shell inside the container
docker exec -it sebi-downloader bash
```

## Commands — Uploader

`upload.py` requires `--access-key` and `--secret-key`. `--endpoint` defaults to `minio:9000`.

```bash
# Upload ALL files in output/ to MinIO (default 20 workers)
docker exec sebi-downloader python upload.py \
  --access-key <KEY> --secret-key <SECRET> upload

# Upload with 100 concurrent workers
docker exec sebi-downloader python upload.py \
  --access-key <KEY> --secret-key <SECRET> upload --workers 100

# Upload against a non-default MinIO endpoint
docker exec sebi-downloader python upload.py \
  --endpoint minio.internal:9000 \
  --access-key <KEY> --secret-key <SECRET> upload

# Check upload progress (counts files in output/ vs objects in the bucket)
docker exec sebi-downloader python upload.py \
  --access-key <KEY> --secret-key <SECRET> status

# Retry all failed uploads (from failed_uploads.json)
docker exec sebi-downloader python upload.py \
  --access-key <KEY> --secret-key <SECRET> retry

# Retry with more workers
docker exec sebi-downloader python upload.py \
  --access-key <KEY> --secret-key <SECRET> retry --workers 50
```

## Running Without Docker

### Downloader

```bash
python3 download.py all
python3 download.py all --workers 100
python3 download.py key 1743302
python3 download.py key 1743302 --workers 50
python3 download.py status
python3 download.py token
python3 download.py keys
python3 download.py retry
python3 download.py retry --workers 50
python3 download.py retry --site-id 999999
python3 download.py retry --site-id 999999 --workers 50
```

`download.py` has no third-party dependencies — it uses only Python stdlib (`urllib`, `concurrent.futures`, `threading`, `argparse`).

### Uploader

```bash
python3 upload.py --access-key <KEY> --secret-key <SECRET> upload
python3 upload.py --access-key <KEY> --secret-key <SECRET> upload --workers 100
python3 upload.py --endpoint localhost:9000 --access-key <KEY> --secret-key <SECRET> upload
python3 upload.py --access-key <KEY> --secret-key <SECRET> status
python3 upload.py --access-key <KEY> --secret-key <SECRET> retry
python3 upload.py --access-key <KEY> --secret-key <SECRET> retry --workers 50
```

`upload.py` requires the `minio` Python package:

```bash
pip install minio
```

## Concurrency

- Default: **20 concurrent workers**
- Configurable via `--workers N` flag
- Thread-safe token caching with mutex lock (only one thread refreshes at a time)
- Thread-safe progress bar updates
- `--workers 100` is safe for this API — cuts ~42K downloads from ~12 hours down to ~7-15 minutes

## Progress Bar

The script shows a live progress bar during downloads:

```
Overall  : |████████░░░░░░░░░░░░░░░░░░░░░░░| 4200/42236 (10.0%) ✓4000 ✗3 ⊘197 ETA 05:30
```

- **✓** = successfully downloaded
- **✗** = failed
- **⊘** = skipped (already exists)
- **ETA** = estimated time remaining

## Failed Downloads & Uploads

### Failed downloads

Any failed download is logged to `failed_downloads.json`:

```json
[
  {
    "key": "1743302",
    "doc_id": "0e9b8d25-73a7-cf67-475c-ea8e68b463fe",
    "error": "metadata_error: HTTP Error 404: Not Found",
    "timestamp": "2026-05-06T10:30:45"
  }
]
```

- `status` command also shows the count of failed downloads
- Partial files from failed downloads are cleaned up automatically

### Retrying failed downloads

Use the `retry` command to re-attempt everything in `failed_downloads.json`:

```bash
python3 download.py retry
python3 download.py retry --workers 50
python3 download.py retry --site-id 999999          # use a different site ID
python3 download.py retry --site-id 999999 --workers 50
```

**Progressive cleanup**: as each file succeeds, it is **immediately removed** from `failed_downloads.json`. If you Ctrl+C mid-run, all successes up to that point are already removed. Run `retry` again and it picks up only the remaining failures.

### Failed uploads

Any failed upload is logged to `failed_uploads.json`:

```json
[
  {
    "key": "1743302",
    "filename": "0e9b8d25-73a7-cf67-475c-ea8e68b463fe.jpeg",
    "object_name": "1743302/0e9b8d25-73a7-cf67-475c-ea8e68b463fe.jpeg",
    "error": "upload_error: ...",
    "timestamp": "2026-05-06T10:30:45"
  }
]
```

- `status` command also shows the count of failed uploads
- Each entry records the local `filename` and the resulting `object_name` (key + filename)

### Retrying failed uploads

```bash
python3 upload.py --access-key <KEY> --secret-key <SECRET> retry
python3 upload.py --access-key <KEY> --secret-key <SECRET> retry --workers 50
```

**Progressive cleanup** (same semantics as download retry): each successfully re-uploaded object is **immediately removed** from `failed_uploads.json`, so Ctrl+C mid-run is safe — re-running `retry` only re-attempts what's still failing.

## Resume Support

Both scripts are safely resumable:

- **Downloader** skips any `doc_id` that already exists on disk under `output/<key>/<doc_id>.<ext>`.
- **Uploader** does a `stat_object` for each file before uploading; objects already present in the bucket are skipped.

If either script is interrupted, just re-run the same command — it will pick up where it left off.

## Monitoring Progress

```bash
# Downloader: overall progress
docker exec sebi-downloader python download.py status

# Uploader: overall progress
docker exec sebi-downloader python upload.py \
  --access-key <KEY> --secret-key <SECRET> status

# View the error logs (also on host in output/)
docker exec sebi-downloader cat /app/output/errors.log
docker exec sebi-downloader cat /app/output/upload_errors.log

# View failed records (also on host in output/)
docker exec sebi-downloader cat /app/output/failed_downloads.json
docker exec sebi-downloader cat /app/output/failed_uploads.json

# Follow the logs in real-time
docker exec sebi-downloader tail -f /app/output/errors.log
docker exec sebi-downloader tail -f /app/output/upload_errors.log

# Count downloaded files
find output/ -type f | wc -l
```

## Logging

### What gets logged

| Where                            | What                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Progress bar** (stdout)        | Live progress with ✓/✗/⊘ counts + ETA (both scripts)                                                              |
| **stdout**                       | Downloader: token refreshes, milestones every 1000 docs, start/finish summary. Uploader: milestones + summary.    |
| **`errors.log`**                 | Downloader failures only (WARNING and above)                                                                      |
| **`upload_errors.log`**          | Uploader failures only (WARNING and above)                                                                        |
| **`failed_downloads.json`**      | Structured JSON for every failed download (key, doc_id, error, timestamp)                                         |
| **`failed_uploads.json`**        | Structured JSON for every failed upload (key, filename, object_name, error, timestamp)                            |

### What is NOT logged

- Per-document success messages (progress bar handles this visually)
- Per-document skip messages (counted in progress bar)

### Example `errors.log`

```
2026-05-06 10:30:45 [ERROR] Failed download for 1743302/0e9b8d25-abcd: HTTP Error 404: Not Found
2026-05-06 10:31:12 [ERROR] Failed metadata for 1743303/43586fdd-abcd: URLError timed out
```

### Example stdout during `all` run

```
2026-05-06 10:00:00 [INFO] Starting download: 15568 keys, 42236 total documents, 100 workers
2026-05-06 10:00:01 [INFO] Refreshing auth token...
2026-05-06 10:00:02 [INFO] Token refreshed, expires in 1200s
Overall  : |████░░░░░░░░░░░░░░░░░░░░░░░░| 1000/42236 (2.4%) ✓950 ✗2 ⊘48 ETA 07:30
2026-05-06 10:05:30 [INFO] Progress: 1000/42236 (2.4%) — 950 success, 2 failed, 48 skipped
Overall  : |████████░░░░░░░░░░░░░░░░░░░░| 2000/42236 (4.7%) ✓1900 ✗5 ⊘95 ETA 06:45
...
2026-05-06 10:40:00 [INFO] Refreshing auth token...
Overall  : |████████████████████████████████| 42236/42236 (100.0%) ✓42100 ✗5 ⊘131 Done 00:12
2026-05-06 10:12:00 [INFO] ALL DONE: success=42100, failed=5, skipped=131
```

## Stopping & Cleanup

```bash
# Stop the container
docker stop sebi-downloader

# Remove the container
docker rm sebi-downloader

# Remove the image
docker rmi sebi-downloader
```

Downloaded files in `output/` persist on the host via the volume mount, including `failed_downloads.json` and `errors.log`.
