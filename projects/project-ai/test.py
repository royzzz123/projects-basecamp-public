"""
Smoke test for the SEBI AI service.

Designed to be run from INSIDE the running container:

    docker exec -it sebi-ai bash
    python test.py 12345                  # hits BOTH endpoints with live log streaming
    python test.py 12345 --summary        # only /complaint-summary
    python test.py 12345 --analysis       # only /complaint-workflow-analysis
    python test.py 12345 --no-stream      # plain JSON, no live logs
    python test.py 12345 --host http://localhost:9000

By default the script appends `?stream=true` to each endpoint and reads the
NDJSON stream line-by-line, printing each `[STEP]`/INFO log as the server
emits it, followed by the final JSON result. No second terminal needed.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

import httpx


DEFAULT_HOST = os.environ.get("SEBI_AI_HOST", "http://localhost:9000")
DEFAULT_TIMEOUT = float(os.environ.get("SEBI_AI_TIMEOUT", "600"))


def _print_header(title: str) -> None:
    bar = "=" * 72
    print(f"\n{bar}\n{title}\n{bar}", flush=True)


def _call_plain(client: httpx.Client, path: str) -> bool:
    url = f"{client.base_url}{path}"
    _print_header(f"GET {url}")
    started = time.monotonic()
    try:
        resp = client.get(path)
    except httpx.HTTPError as e:
        elapsed = time.monotonic() - started
        print(f"REQUEST FAILED after {elapsed:.2f}s: {type(e).__name__}: {e}", flush=True)
        return False

    elapsed = time.monotonic() - started
    print(f"status={resp.status_code}  elapsed={elapsed:.2f}s", flush=True)

    try:
        body = resp.json()
        print(json.dumps(body, indent=2, ensure_ascii=False, default=str), flush=True)
    except ValueError:
        print("(non-JSON body)", flush=True)
        print(resp.text, flush=True)

    return resp.is_success


def _call_streaming(client: httpx.Client, path: str) -> bool:
    """Hit the endpoint with ?stream=true and print each NDJSON event as it arrives."""
    sep = "&" if "?" in path else "?"
    stream_path = f"{path}{sep}stream=true"
    url = f"{client.base_url}{stream_path}"
    _print_header(f"GET {url}  (streaming)")
    started = time.monotonic()

    ok = True
    got_result = False
    try:
        with client.stream("GET", stream_path) as resp:
            print(f"status={resp.status_code}", flush=True)
            if not resp.is_success:
                # Non-streaming error response (e.g. validation 422 before stream starts)
                body = resp.read().decode("utf-8", errors="replace")
                print(body, flush=True)
                return False

            for line in resp.iter_lines():
                if not line:
                    continue
                try:
                    evt = json.loads(line)
                except json.JSONDecodeError:
                    print(f"[unparseable] {line}", flush=True)
                    continue

                etype = evt.get("type")
                if etype == "log":
                    level = evt.get("level", "INFO")
                    msg = evt.get("msg", "")
                    elapsed = time.monotonic() - started
                    print(f"  [{elapsed:6.1f}s] {level:<7} {msg}", flush=True)
                elif etype == "result":
                    got_result = True
                    elapsed = time.monotonic() - started
                    print(f"\n--- RESULT (after {elapsed:.2f}s) ---", flush=True)
                    print(
                        json.dumps(evt.get("data"), indent=2, ensure_ascii=False, default=str),
                        flush=True,
                    )
                elif etype == "error":
                    ok = False
                    elapsed = time.monotonic() - started
                    print(f"\n--- ERROR (after {elapsed:.2f}s) ---", flush=True)
                    print(evt.get("msg", ""), flush=True)
                else:
                    print(f"[unknown event] {evt}", flush=True)
    except httpx.HTTPError as e:
        elapsed = time.monotonic() - started
        print(f"STREAM FAILED after {elapsed:.2f}s: {type(e).__name__}: {e}", flush=True)
        return False

    return ok and got_result


def main() -> int:
    parser = argparse.ArgumentParser(description="Hit the SEBI AI endpoints for a complaint id.")
    parser.add_argument("complaint_id", type=int, help="Complaint id to test")
    parser.add_argument(
        "--host", default=DEFAULT_HOST, help=f"Base URL (default: {DEFAULT_HOST})"
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT,
        help=f"Per-request timeout in seconds (default: {DEFAULT_TIMEOUT})",
    )
    parser.add_argument("--summary", action="store_true", help="Only call /complaint-summary")
    parser.add_argument(
        "--analysis", action="store_true", help="Only call /complaint-workflow-analysis"
    )
    parser.add_argument(
        "--no-stream",
        action="store_true",
        help="Disable live log streaming; fetch plain JSON instead.",
    )
    args = parser.parse_args()

    run_summary = args.summary or not (args.summary or args.analysis)
    run_analysis = args.analysis or not (args.summary or args.analysis)
    caller = _call_plain if args.no_stream else _call_streaming

    with httpx.Client(base_url=args.host, timeout=args.timeout) as client:
        _print_header(f"Health check  ->  {args.host}/health")
        try:
            health = client.get("/health")
            print(f"status={health.status_code}  body={health.text}", flush=True)
        except httpx.HTTPError as e:
            print(f"HEALTH CHECK FAILED: {type(e).__name__}: {e}", flush=True)
            return 1

        results: dict[str, bool] = {}
        if run_summary:
            results["complaint-summary"] = caller(
                client, f"/complaint-summary/{args.complaint_id}"
            )
        if run_analysis:
            results["complaint-workflow-analysis"] = caller(
                client, f"/complaint-workflow-analysis/{args.complaint_id}"
            )

    _print_header("Summary")
    for name, ok in results.items():
        print(f"  {name:30s}  {'OK' if ok else 'FAIL'}", flush=True)

    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
