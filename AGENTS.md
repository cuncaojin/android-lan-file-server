# AGENTS.md

Single-package Flask file browser / in-browser preview server, meant to run in Termux Ubuntu (proot) on Android. Not a monorepo; no build step, no test suite, no CI, no linter/formatter. `README.md` (Simplified Chinese) is the primary user doc — keep it in sync when behavior changes; `README.en.md` is its English twin, update both.

## Commands

```bash
# Smoke-run without installing (the main verification loop for code changes)
python3 server.py --root /path/to/dir --host 127.0.0.1 --port 9523
curl -s http://127.0.0.1:9523/healthz

# The only automated checks that exist
bash -n deploy.sh start.sh stop.sh
python3 -m py_compile server.py
for f in static/app.js static/preview.js static/md.js; do node --check "$f"; done

# Full deploy: validates root dir, installs deps (apt flask, pip python-pptx,
# LibreOffice + Noto CJK), rsyncs app to $ANDROID_LAN_HOME, starts, polls /healthz
bash deploy.sh --root /sdcard/Download

# Run/stop the installed copy (or from the repo: bash start.sh / bash stop.sh)
bash /opt/android-lan-file-server/stop.sh
bash /opt/android-lan-file-server/start.sh --root /sdcard/Download
```

There are no tests. After changing `server.py` or `static/`, verify with the checks above + a smoke run + `/healthz` + one preview request, e.g. `curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:9523/preview/<file>"`. Server exits non-zero with a clear message if the root dir is missing/unreadable — that's intentional, don't soften it.

## Config

- Precedence in `server.py` (`_cfg()`): **CLI flags > env vars > `android-lan-file-server.local.conf` > `android-lan-file-server.conf` > built-in defaults**. Config is resolved at import time, so changing a conf requires a restart.
- `start.sh` resolves differently: it shell-sources both confs with `set -a` **before** parsing its own flags, so **conf values overwrite pre-set env vars** (`ANDROID_LAN_HOST=1.2.3.4 bash start.sh` still ends up `0.0.0.0` from the conf). Effective order there: start.sh CLI > `.local.conf` > conf > inherited env. It then launches `server.py --host --port --root` explicitly, so start.sh flags always win.
- `start.sh --conf` is parsed **after** the conf was already sourced — it only re-points `ANDROID_LAN_CONF` for `server.py`'s own read; it does not re-read `DEFAULT_ROOT` etc. into start.sh.
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
- Preview ↔ list contract: preview page receives `window.__PREVIEW_META__` (`path`/`parent`/`kind`…); list rows are `a[data-path=…]`; `preview.js` writes `sessionStorage["alfs-preview-focus"]` on `pagehide` and `app.js` consumes it once to re-focus that file (also on `pageshow` bfcache return). `alfs-swipe-hinted` gates the one-time swipe toast.
- `bindSwipe()` in `preview.js` switches between previewable siblings in the same directory by **two-finger horizontal swipe**, **without wrap-around**; a single-finger horizontal swipe never switches — it shows a "请用双指左右滑动" teaching toast instead (first load shows a one-time hint via `alfs-swipe-hinted`). Its guards are deliberate: ignore gestures starting on links/buttons/`.modebar`/`.more-menu`/audio/video-control-zone, cancel when the two-finger distance changes >30px (pinch-zoom), yield to horizontal scrolling and in-progress text selection, reset on `touchcancel`/extra fingers. Preserve them when adding any touch handling. The preview `#topbar` (nav-row + modebar) auto-hides on scroll-down and re-shows on scroll-up (`bindToolbarAutohide`, `.tb-hidden`); text/markdown content scrolls with the page (no inner `max-height`) so that behavior works.
- PDF.js is vendored in `static/vendor/` and dynamically imported by `preview.js`. Don't swap it for a CDN link — the app must work offline on a LAN.

## Conventions & gotchas

- README, script banners, and user-facing error messages are Simplified Chinese; keep new ones consistent.
- No authentication by design — the service is meant for a trusted LAN only. Don't add defaults that expose it publicly.
- `requirements.txt` documents deps but nothing runs `pip install -r`; `deploy.sh` installs packages itself. It also lists `gunicorn`, which is never used — the app always runs Flask's dev server (`app.run` in `main()`); don't assume a production WSGI setup exists.
- `.local.conf`, `config.env`, `logs/`, `__pycache__/`, `.mimocode/`, `.opencode/` are gitignored; `config.env` and `.local.conf` contain machine-specific paths.
- Never hardcode machine-specific/personal absolute paths in tracked files (put them in `.local.conf` / `config.env`); never commit `.env`-style files or secrets.
- Diagrams: `README.md` and `README.en.md` each contain **6** Mermaid blocks in §7 (the two sets are byte-identical, English-labeled), but only **5** have sources under `docs/diagrams/*.mmd` (§7.5 has none) and `.mmd` labels can drift from the READMEs. When changing a diagram, update both README blocks and the matching `.mmd`.
- After each modification, append the modified file's full path to `.modify.txt` and commit with `<type>(<scope>): <description>` (descriptions in Chinese, matching history).
- On this machine git may fail with "dubious ownership"; fix with `git config --global --add safe.directory /sdcard/cuncaojin/work/gitee/android-lan-file-server`.
