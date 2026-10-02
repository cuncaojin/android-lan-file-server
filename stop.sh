#!/usr/bin/env bash
# =============================================================================
# android-lan-file-server 停止脚本
# 用法:
#   bash stop.sh
#   bash stop.sh --port 8081
# =============================================================================
set -euo pipefail

export ANDROID_LAN_PORT="${ANDROID_LAN_PORT:-9523}"
PIDFILE="${PIDFILE:-/tmp/android-lan-file-server.pid}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGFILE="${LOGFILE:-$SCRIPT_DIR/logs/android-lan-file-server.log}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      export ANDROID_LAN_PORT="$2"
      shift 2
      ;;
    --port=*)
      export ANDROID_LAN_PORT="${1#*=}"
      shift
      ;;
    -h|--help)
      echo "用法: bash stop.sh [--port N]"
      exit 0
      ;;
    *)
      shift
      ;;
  esac
done

log()  { printf '\033[1;32m[stop]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m  %s\n' "$*"; }

stopped_any=0

# 1) pid 文件
if [[ -f "$PIDFILE" ]]; then
  PID="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [[ -n "${PID:-}" ]] && kill -0 "$PID" 2>/dev/null; then
    log "停止进程 pid=$PID …"
    kill "$PID" 2>/dev/null || true
    for _ in $(seq 1 10); do
      if ! kill -0 "$PID" 2>/dev/null; then
        break
      fi
      sleep 0.5
    done
    if kill -0 "$PID" 2>/dev/null; then
      warn "进程未退出，强制结束"
      kill -9 "$PID" 2>/dev/null || true
    fi
    log "已停止 pid=$PID"
    stopped_any=1
  else
    warn "pid 文件存在但进程不存在：${PID:-空}"
  fi
  rm -f "$PIDFILE"
fi

# 2) 按端口清理（仅杀 server.py，避免误伤）
if command -v ss >/dev/null 2>&1; then
  PIDS="$(ss -lptn "sport = :$ANDROID_LAN_PORT" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
  if [[ -n "${PIDS:-}" ]]; then
    log "端口 $ANDROID_LAN_PORT 上仍有监听进程，尝试停止…"
    for p in $PIDS; do
      if tr '\0' ' ' <"/proc/$p/cmdline" 2>/dev/null | grep -q "server.py"; then
        kill "$p" 2>/dev/null || true
        sleep 0.3
        kill -9 "$p" 2>/dev/null || true
        log "已停止端口关联进程 pid=$p"
        stopped_any=1
      else
        warn "端口 $ANDROID_LAN_PORT 上的 pid=$p 不是 android-lan-file-server，跳过"
      fi
    done
  fi
fi

# 3) 按进程名兜底（^ 锚定：只匹配真正以 python3 server.py 开头的进程，
#    避免误杀命令行里恰好提到这串文字的其他进程）
PIDS="$(pgrep -f "android-lan-file-server/server.py|/opt/android-lan-file-server/server.py|^python3 server\.py" 2>/dev/null || true)"
if [[ -n "${PIDS:-}" ]]; then
  for p in $PIDS; do
    log "停止匹配到的 android-lan-file-server 进程 pid=$p"
    kill "$p" 2>/dev/null || true
    sleep 0.3
    kill -9 "$p" 2>/dev/null || true
    stopped_any=1
  done
fi

if [[ "$stopped_any" == "1" ]]; then
  log "android-lan-file-server 已停止"
else
  log "没有发现正在运行的 android-lan-file-server 服务"
fi

if command -v ss >/dev/null 2>&1; then
  if ss -lptn "sport = :$ANDROID_LAN_PORT" 2>/dev/null | grep -q LISTEN; then
    warn "端口 $ANDROID_LAN_PORT 仍在监听，请手动检查："
    ss -lptn "sport = :$ANDROID_LAN_PORT" || true
  else
    log "端口 $ANDROID_LAN_PORT 已释放"
  fi
fi

exit 0
