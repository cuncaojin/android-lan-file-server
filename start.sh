#!/usr/bin/env bash
# =============================================================================
# android-lan-file-server 启动脚本
#
# 1) 默认启动目录：配置文件 android-lan-file-server.conf 的 DEFAULT_ROOT
# 2) 命令行指定目录：
#      bash start.sh --root /sdcard/yourname/work/gitee/share
# 3) 越权访问开关：
#      配置文件 ALLOW_OUTSIDE_ROOT=no/yes
#      命令行 --allow-outside / --deny-outside
# 4) 后台常驻开关：
#      配置文件 ANDROID_LAN_DAEMON=no/yes
#      no=跟随当前终端（默认），yes=关终端后仍可访问（日志 logs/android-lan-file-server.log）
# 5) 本地私有配置 android-lan-file-server.local.conf（gitignore 不入库），优先级高于 conf
# 6) 启动后会打印访问链接
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="${ANDROID_LAN_CONF:-$SCRIPT_DIR/android-lan-file-server.conf}"
ROOT_FROM_CLI=""
OUTSIDE_FROM_CLI=""

# 从配置文件读取 DEFAULT_ROOT / ALLOW_OUTSIDE_ROOT
CONF_ROOT=""
CONF_OUTSIDE=""
CONF_HOST=""
CONF_PORT=""
CONF_DAEMON=""
if [[ -f "$CONF" ]]; then
  # shellcheck disable=SC1090
  set -a
  . "$CONF"
  set +a
  CONF_ROOT="${DEFAULT_ROOT:-}"
  CONF_OUTSIDE="${ALLOW_OUTSIDE_ROOT:-}"
  CONF_HOST="${ANDROID_LAN_HOST:-}"
  CONF_PORT="${ANDROID_LAN_PORT:-}"
  CONF_DAEMON="${ANDROID_LAN_DAEMON:-}"
fi
# 兼容旧 config.env（仅补充，不覆盖 conf 的 DEFAULT_ROOT）
if [[ -f "$SCRIPT_DIR/config.env" ]]; then
  # shellcheck disable=SC1090
  set -a
  . "$SCRIPT_DIR/config.env"
  set +a
fi
# 若 conf 有 DEFAULT_ROOT，则以 conf 为准（避免旧 config.env 干扰）
[[ -n "$CONF_ROOT" ]] && ANDROID_LAN_ROOT="$CONF_ROOT"
[[ -n "$CONF_OUTSIDE" ]] && ANDROID_LAN_ALLOW_OUTSIDE_ROOT="$CONF_OUTSIDE"
[[ -n "$CONF_HOST" ]] && ANDROID_LAN_HOST="$CONF_HOST"
[[ -n "$CONF_PORT" ]] && ANDROID_LAN_PORT="$CONF_PORT"
[[ -n "$CONF_DAEMON" ]] && ANDROID_LAN_DAEMON="$CONF_DAEMON"

# 本地私有配置：优先级高于 conf（文件已加入 .gitignore，不随仓库提交）
LOCAL_CONF="${ANDROID_LAN_LOCAL_CONF:-$SCRIPT_DIR/android-lan-file-server.local.conf}"
if [[ -f "$LOCAL_CONF" ]]; then
  # shellcheck disable=SC1090
  set -a
  . "$LOCAL_CONF"
  set +a
  [[ -n "${DEFAULT_ROOT:-}" ]] && ANDROID_LAN_ROOT="$DEFAULT_ROOT"
  [[ -n "${ALLOW_OUTSIDE_ROOT:-}" ]] && ANDROID_LAN_ALLOW_OUTSIDE_ROOT="$ALLOW_OUTSIDE_ROOT"
  [[ -n "${ANDROID_LAN_HOST:-}" ]] && ANDROID_LAN_HOST="$ANDROID_LAN_HOST"
  [[ -n "${ANDROID_LAN_PORT:-}" ]] && ANDROID_LAN_PORT="$ANDROID_LAN_PORT"
  [[ -n "${ANDROID_LAN_DAEMON:-}" ]] && ANDROID_LAN_DAEMON="$ANDROID_LAN_DAEMON"
fi

# CLI overrides
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)
      ANDROID_LAN_ROOT="${2:-}"
      ROOT_FROM_CLI=1
      shift 2
      ;;
    --root=*)
      ANDROID_LAN_ROOT="${1#*=}"
      ROOT_FROM_CLI=1
      shift
      ;;
    --host)
      ANDROID_LAN_HOST="${2:-127.0.0.1}"
      shift 2
      ;;
    --host=*)
      ANDROID_LAN_HOST="${1#*=}"
      shift
      ;;
    --port)
      ANDROID_LAN_PORT="${2:-9523}"
      shift 2
      ;;
    --port=*)
      ANDROID_LAN_PORT="${1#*=}"
      shift
      ;;
    --allow-outside)
      ANDROID_LAN_ALLOW_OUTSIDE_ROOT=yes
      OUTSIDE_FROM_CLI=1
      shift
      ;;
    --deny-outside)
      ANDROID_LAN_ALLOW_OUTSIDE_ROOT=no
      OUTSIDE_FROM_CLI=1
      shift
      ;;
    --conf)
      CONF="${2:-}"
      shift 2
      ;;
    --conf=*)
      CONF="${1#*=}"
      shift
      ;;
    -h|--help)
      cat <<'HELP'
android-lan-file-server 启动脚本

用法:
  bash start.sh
  bash start.sh --root /sdcard/yourname/work/gitee/share
  bash start.sh --root /sdcard/Download --port 9523
  bash start.sh --allow-outside          # 允许访问根目录以外路径
  bash start.sh --deny-outside           # 强制仅限根目录及子目录
  bash start.sh --conf /opt/android-lan-file-server/android-lan-file-server.conf

默认目录、端口与开关写在配置文件 android-lan-file-server.conf 中:
  DEFAULT_ROOT=/sdcard/yourname/work/gitee/share
  ALLOW_OUTSIDE_ROOT=no|yes
  ANDROID_LAN_PORT=9523
  ANDROID_LAN_DAEMON=no|yes   # yes=后台常驻，关终端后仍可访问
HELP
      exit 0
      ;;
    *)
      shift
      ;;
  esac
done

# 默认值
export ANDROID_LAN_ROOT="${ANDROID_LAN_ROOT:-${CONF_ROOT:-/sdcard}}"
export ANDROID_LAN_HOST="${ANDROID_LAN_HOST:-${CONF_HOST:-127.0.0.1}}"
export ANDROID_LAN_PORT="${ANDROID_LAN_PORT:-${CONF_PORT:-9523}}"
export ANDROID_LAN_CACHE="${ANDROID_LAN_CACHE:-/tmp/android-lan-file-server-cache}"
export ANDROID_LAN_ALLOW_OUTSIDE_ROOT="${ANDROID_LAN_ALLOW_OUTSIDE_ROOT:-${CONF_OUTSIDE:-no}}"
export ANDROID_LAN_DAEMON="${ANDROID_LAN_DAEMON:-${CONF_DAEMON:-no}}"
export ANDROID_LAN_CONF="$CONF"
export PYTHONUNBUFFERED=1

# 去掉路径末尾斜杠，避免 root 拼接歧义
ANDROID_LAN_ROOT="${ANDROID_LAN_ROOT%/}"
export ANDROID_LAN_ROOT

if [[ ! -e "$ANDROID_LAN_ROOT" ]]; then
  echo "[start] 错误: 根目录不存在: $ANDROID_LAN_ROOT" >&2
  echo "[start] 请确认路径正确，或改用你确保存在的目录。" >&2
  echo "[start] 可修改配置文件 DEFAULT_ROOT，或使用 --root 指定。" >&2
  exit 2
fi
if [[ ! -d "$ANDROID_LAN_ROOT" ]]; then
  echo "[start] 错误: 根路径不是目录: $ANDROID_LAN_ROOT" >&2
  exit 2
fi
if [[ ! -r "$ANDROID_LAN_ROOT" ]]; then
  echo "[start] 错误: 根目录不可读: $ANDROID_LAN_ROOT" >&2
  echo "[start] 请确认路径已挂载/授权，且你对该目录有读权限。" >&2
  exit 3
fi
if ! timeout 3 ls -A "$ANDROID_LAN_ROOT" >/dev/null 2>&1; then
  echo "[start] 错误: 无法列出目录内容: $ANDROID_LAN_ROOT" >&2
  echo "[start] 目录可能存在，但当前环境无法访问。" >&2
  exit 4
fi

OUTSIDE_FLAG="--deny-outside"
[[ "$ANDROID_LAN_ALLOW_OUTSIDE_ROOT" == "yes" ]] && OUTSIDE_FLAG="--allow-outside"

# 局域网 IPv4 地址列表（排除 127.x）
lan_ips=()
if command -v hostname >/dev/null 2>&1; then
  while IFS= read -r ip; do
    [[ -n "$ip" ]] || continue
    [[ "$ip" == 127.* ]] && continue
    lan_ips+=("$ip")
  done < <(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || true)
fi
if [[ ${#lan_ips[@]} -eq 0 ]] && command -v ip >/dev/null 2>&1; then
  while IFS= read -r ip; do
    [[ -n "$ip" ]] || continue
    [[ "$ip" == 127.* ]] && continue
    lan_ips+=("$ip")
  done < <(ip -4 -o addr show 2>/dev/null | awk '{split($4,a,"/"); print a[1]}' || true)
fi

display_host="$ANDROID_LAN_HOST"
if [[ "$ANDROID_LAN_HOST" == "0.0.0.0" ]]; then
  display_host="0.0.0.0"
fi

# 输出颜色：仅在终端（TTY）启用，重定向到日志时不带控制符
if [[ -t 1 ]]; then
  C_B=$'\033[1m'; C_CY=$'\033[1;36m'; C_YE=$'\033[1;33m'; C_OFF=$'\033[0m'
else
  C_B=""; C_CY=""; C_YE=""; C_OFF=""
fi

LOGFILE="$SCRIPT_DIR/logs/android-lan-file-server.log"
echo "============================================================"
echo " android-lan-file-server 启动中"
echo "------------------------------------------------------------"
echo " 浏览根目录   : $ANDROID_LAN_ROOT"
if [[ "$ANDROID_LAN_ALLOW_OUTSIDE_ROOT" == "yes" ]]; then
  echo " 越权访问     : yes（允许访问根目录以外路径）"
else
  echo " 越权访问     : no（默认，仅限根目录及其子目录）"
fi
echo " 监听地址     : http://${display_host}:${ANDROID_LAN_PORT}/  (bind=${ANDROID_LAN_HOST})"
echo "------------------------------------------------------------"
echo " ${C_B}访问链接（手机本机）${C_OFF}:"
echo "   ${C_CY}→ http://127.0.0.1:${ANDROID_LAN_PORT}/${C_OFF}"
if [[ ${#lan_ips[@]} -gt 0 ]]; then
  echo " ${C_B}访问链接（局域网他人可打开）${C_OFF}:"
  for ip in "${lan_ips[@]}"; do
    echo "   ${C_CY}→ http://${ip}:${ANDROID_LAN_PORT}/${C_OFF}"
  done
  echo " 提示: 请保证 ANDROID_LAN_HOST=0.0.0.0，否则局域网无法连接。"
else
  echo " ${C_B}访问链接（局域网）${C_OFF}:"
  echo "   ${C_CY}→ http://<本机IP>:${ANDROID_LAN_PORT}/${C_OFF}"
  echo " 提示: 未检测到 IPv4 地址；监听需为 0.0.0.0 才能局域网访问。"
fi
echo "------------------------------------------------------------"
echo " 配置文件     : $CONF"
if [[ -f "$LOCAL_CONF" ]]; then
  echo " ${C_YE}本地私有配置 : 已加载${C_OFF} $LOCAL_CONF"
else
  echo " ${C_YE}本地私有配置 : 未创建${C_OFF} —— 换机器后如需本机专属默认值（如个人目录），"
  echo "                请新建 $LOCAL_CONF（gitignore 不入库，见 README 4.1）"
fi
if [[ "$ANDROID_LAN_DAEMON" == "yes" ]]; then
  echo " 运行模式     : 后台常驻（关闭终端后仍可访问）"
  echo " 日志         : $LOGFILE"
else
  echo " 运行模式     : 前台（跟随当前终端，关闭终端即停止）"
  echo " 日志         : 前台输出（当前终端，无日志文件）"
fi
echo " PID          : /tmp/android-lan-file-server.pid"
echo " 停止命令     : bash ${SCRIPT_DIR}/stop.sh"
echo "============================================================"

cd "$SCRIPT_DIR"
if [[ "$ANDROID_LAN_DAEMON" == "yes" ]]; then
  # 脱离当前终端常驻运行；日志写工程根目录 logs/，PID 由 server.py 自己写入
  mkdir -p "$SCRIPT_DIR/logs"
  # 端口预检：否则后台启动会在绑定失败后静默死掉，横幅却显示成功
  if (exec 3<>"/dev/tcp/127.0.0.1/${ANDROID_LAN_PORT}") 2>/dev/null; then
    exec 3>&- 3<&-
    echo "[start] 错误: 端口 ${ANDROID_LAN_PORT} 已被占用，先执行 bash ${SCRIPT_DIR}/stop.sh" >&2
    exit 5
  fi
  # 清掉旧 pid：避免轮询读到其他存活进程的残留 PID 而误报成功
  rm -f /tmp/android-lan-file-server.pid
  setsid nohup python3 server.py \
    --host "$ANDROID_LAN_HOST" \
    --port "$ANDROID_LAN_PORT" \
    --root "$ANDROID_LAN_ROOT" \
    $OUTSIDE_FLAG >>"$LOGFILE" 2>&1 </dev/null &
  # 等 server.py 自己写好 PID（导入依赖可能需要 1~2 秒）
  pid=""
  for _ in $(seq 1 15); do
    pid="$(cat /tmp/android-lan-file-server.pid 2>/dev/null || true)"
    [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null && break
    sleep 0.3
  done
  echo "[start] 已后台启动 pid=${pid:-?}（日志 $LOGFILE）"
else
  exec python3 server.py \
    --host "$ANDROID_LAN_HOST" \
    --port "$ANDROID_LAN_PORT" \
    --root "$ANDROID_LAN_ROOT" \
    $OUTSIDE_FLAG
fi
