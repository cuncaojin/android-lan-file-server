# AGENTS.md

Single-package Flask file browser / in-browser preview server, meant to run in Termux Ubuntu (proot) on Android. Not a monorepo; no build step, no test suite, no CI, no linter/formatter. `README.md` (Simplified Chinese) is the primary user doc — keep it in sync when behavior changes.

## Commands

```bash
# Smoke-run without installing (the main verification loop for code changes)
python3 server.py --root /path/to/dir --host 127.0.0.1 --port 9523
curl -s http://127.0.0.1:9523/healthz

# The only automated checks that exist
bash -n deploy.sh start.sh stop.sh
python3 -m py_compile server.py

# Full deploy: validates root dir, installs deps (apt flask, pip python-pptx,
# LibreOffice + Noto CJK), rsyncs app to $ANDROID_LAN_HOME, starts, polls /healthz
bash deploy.sh --root /sdcard/Download

# Run/stop the installed copy (or from the repo: bash start.sh / bash stop.sh)
bash /opt/android-lan-file-server/stop.sh
bash /opt/android-lan-file-server/start.sh --root /sdcard/Download
```

There are no tests. After changing `server.py` or `static/`, verify with a smoke run + `/healthz` + one preview request, e.g. `curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:9523/preview/<file>"`. Server exits non-zero with a clear message if the root dir is missing/unreadable — that's intentional, don't soften it.

## Config

- Precedence: **CLI flags > env vars > `android-lan-file-server.local.conf` > `android-lan-file-server.conf` > built-in defaults**. Implemented separately in `start.sh` (shell-sources both confs) and `server.py` (`_cfg()`); config is resolved at import time, so changing a conf requires a restart.
- `.local.conf` is gitignored and holds machine-specific paths (e.g. `DEFAULT_ROOT`). A fresh clone lacks it and falls back to `/sdcard`. Never commit it.
- `deploy.sh` is the exception: it reads **only** env vars + its own flags (its `--conf` flag is parsed but unused), then overwrites `$ANDROID_LAN_HOME/android-lan-file-server.conf` with those values.
- Consequence: the repo conf sets `ANDROID_LAN_HOST=0.0.0.0`, but plain `bash deploy.sh` deploys with `127.0.0.1` (LAN unreachable) unless you pass `--host 0.0.0.0` / `ANDROID_LAN_HOST=0.0.0.0`. `bash start.sh` from the repo does honor the conf's `0.0.0.0`.
- After the first deploy the running service serves files from `/opt/android-lan-file-server`, **not** the repo. Re-run `bash deploy.sh` after edits (it re-syncs `server.py`, `static/`, `templates/`, `start.sh`, `stop.sh`).

## Code map

`server.py` (~900 lines) is the whole backend:

- `safe_path()` — the only path input from HTTP: rejects `..`/NUL, resolves symlinks, enforces `ALLOW_OUTSIDE_ROOT`, and handles the `@/abs/path` outside-root form. Any new route taking a path must go through it.
- `detect_kind()` — extension + byte-sniff classification that drives the preview UI.
- `convert_to_pdf()` / `_xlsx_for_preview()` — `soffice --headless` conversion cached under `/tmp/android-lan-file-server-cache`. Bump `_PDF_CACHE_VER` when conversion params change, or stale cached PDFs keep serving. The xlsx step strips headers/footers on a temp copy to stop LibreOffice from printing the sheet name on every page.
- Routes: `/`, `/api/ls`, `/preview/<rel>`, `/raw/<rel>` (Range support), `/doc-pdf/<rel>`, `/api/kind/<rel>`, `/healthz` (version string is hardcoded here).
- Runtime files: PID `/tmp/android-lan-file-server.pid` (written by `server.py` itself), log `logs/android-lan-file-server.log` (daemon mode only, gitignored).

Frontend is plain vanilla JS, edited directly:

- `static/app.js` (listing), `static/preview.js` (per-kind preview), `static/md.js` (Markdown — escape HTML before wrapping tags), `templates/*.html`. No bundler, no npm.
- PDF.js is vendored in `static/vendor/` and dynamically imported by `preview.js`. Don't swap it for a CDN link — the app must work offline on a LAN.

## Conventions & gotchas

- README, script banners, and user-facing error messages are Simplified Chinese; keep new ones consistent.
- No authentication by design — the service is meant for a trusted LAN only. Don't add defaults that expose it publicly.
- `requirements.txt` documents deps but nothing runs `pip install -r`; `deploy.sh` installs packages itself.
- `.local.conf`, `config.env`, `logs/`, `__pycache__/`, `.mimocode/` are gitignored; `config.env` contains machine-specific paths.
- Diagram sources in `docs/diagrams/*.mmd` mirror the Mermaid blocks in README §7 — update both.
- On this machine git may fail with "dubious ownership"; fix with `git config --global --add safe.directory /sdcard/cuncaojin/work/gitee/android-lan-file-server`.
