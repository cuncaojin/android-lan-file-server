#!/usr/bin/env bash
# =============================================================================
# android-lan-file-server 一键部署脚本
# 环境：Termux + Ubuntu 子系统 (proot-distro)
# 功能：校验/挂载指定目录、安装依赖、启动本地文件预览服务
# 访问：仅手机本机浏览器，默认 http://127.0.0.1:9523
#
# 用法:
#   bash deploy.sh
#   bash deploy.sh /sdcard
#   bash deploy.sh /sdcard/DCIM/video
#   ANDROID_LAN_ROOT=/sdcard/Download bash deploy.sh
#   bash deploy.sh --root /sdcard/Download --port 8081
#
# 目录访问失败时：直接报错退出，不会静默成功。
# =============================================================================
set -euo pipefail

# 默认配置（可被环境变量或命令行覆盖）
export ANDROID_LAN_ROOT="${ANDROID_LAN_ROOT:-/sdcard}"
export ANDROID_LAN_HOST="${ANDROID_LAN_HOST:-127.0.0.1}"
export ANDROID_LAN_PORT="${ANDROID_LAN_PORT:-9523}"
export ANDROID_LAN_HOME="${ANDROID_LAN_HOME:-/opt/android-lan-file-server}"
export ANDROID_LAN_CACHE="${ANDROID_LAN_CACHE:-/tmp/android-lan-file-server-cache}"
# 默认禁止访问根目录以外；yes 则允许
export ANDROID_LAN_ALLOW_OUTSIDE_ROOT="${ANDROID_LAN_ALLOW_OUTSIDE_ROOT:-no}"
INSTALL_LIBREOFFICE="${INSTALL_LIBREOFFICE:-yes}"

SCRIPT_SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log()  { printf '\033[1;32m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m  %s\n' "$*"; }
err()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

usage() {
  cat <<'USAGE'
android-lan-file-server 部署脚本

用法:
  bash deploy.sh
  bash deploy.sh /sdcard/Download
  bash deploy.sh --root /sdcard/Download
  bash deploy.sh --root /sdcard --port 9523
  bash deploy.sh --allow-outside
  bash deploy.sh --deny-outside
  bash deploy.sh --no-libreoffice
  bash deploy.sh --help

配置文件: $ANDROID_LAN_HOME/android-lan-file-server.conf（默认 /opt/android-lan-file-server/android-lan-file-server.conf）
  DEFAULT_ROOT=...            默认浏览根目录
  ALLOW_OUTSIDE_ROOT=no|yes   是否允许访问根目录以外路径（默认 no）

示例:
  # 部署到指定目录（仅允许该目录及子目录）
  bash deploy.sh --root /sdcard/Download

  # 允许访问根目录以外
  bash deploy.sh --root /sdcard/Download --allow-outside
USAGE
}

# -----------------------------------------------------------------------------
# 参数解析
# -----------------------------------------------------------------------------
parse_args() {
  local positional=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        usage
        exit 0
        ;;
      --root)
        [[ $# -ge 2 ]] || die "--root 需要目录参数"
        ANDROID_LAN_ROOT="$2"
        _ROOT_EXPLICIT=1
        shift 2
        ;;
      --root=*)
        ANDROID_LAN_ROOT="${1#*=}"
        _ROOT_EXPLICIT=1
        shift
        ;;
      --host)
        [[ $# -ge 2 ]] || die "--host 需要地址参数"
        ANDROID_LAN_HOST="$2"
        shift 2
        ;;
      --host=*)
        ANDROID_LAN_HOST="${1#*=}"
        shift
        ;;
      --port)
        [[ $# -ge 2 ]] || die "--port 需要端口参数"
        ANDROID_LAN_PORT="$2"
        shift 2
        ;;
      --port=*)
        ANDROID_LAN_PORT="${1#*=}"
        shift
        ;;
      --allow-outside)
        ANDROID_LAN_ALLOW_OUTSIDE_ROOT=yes
        shift
        ;;
      --deny-outside)
        ANDROID_LAN_ALLOW_OUTSIDE_ROOT=no
        shift
        ;;
      --conf)
        [[ $# -ge 2 ]] || die "--conf 需要文件路径"
        ANDROID_LAN_CONF="$2"
        shift 2
        ;;
      --conf=*)
        ANDROID_LAN_CONF="${1#*=}"
        shift
        ;;
      --home)
        [[ $# -ge 2 ]] || die "--home 需要目录参数"
        ANDROID_LAN_HOME="$2"
        shift 2
        ;;
      --no-libreoffice)
        INSTALL_LIBREOFFICE=no
        shift
        ;;
      --*)
        die "未知参数: $1（可用 --help 查看）"
        ;;
      *)
        positional+=("$1")
        shift
        ;;
    esac
  done

  if [[ ${#positional[@]} -gt 0 ]]; then
    if [[ -z "${_ROOT_EXPLICIT:-}" ]]; then
      ANDROID_LAN_ROOT="${positional[0]}"
    fi
  fi
}

# 标记 root 是否被显式指定
mark_root_explicit() {
  local prev=()
  for a in "$@"; do
    if [[ ${#prev[@]} -ge 1 ]] && [[ "${prev[${#prev[@]}-1]}" == "--root" ]]; then
      _ROOT_EXPLICIT=1
      return
    fi
    if [[ "$a" == --root=* ]]; then
      _ROOT_EXPLICIT=1
      return
    fi
    prev+=("$a")
  done
}

# -----------------------------------------------------------------------------
# 0) 环境检测
# -----------------------------------------------------------------------------
check_environment() {
  log "检测运行环境…"
  [[ -f /etc/os-release ]] || die "未找到 /etc/os-release，请在 Ubuntu 子系统中运行"
  # shellcheck disable=SC1091
  . /etc/os-release
  log "系统：${PRETTY_NAME:-unknown} ($(uname -m))"

  if ! command -v python3 >/dev/null 2>&1; then
    die "未找到 python3，请先安装：sudo apt update && sudo apt install -y python3 python3-pip python3-venv"
  fi
}

# -----------------------------------------------------------------------------
# 1) 指定目录校验 / 尝试挂载 / 明确报错
# -----------------------------------------------------------------------------
ensure_root_mounted() {
  local root="$ANDROID_LAN_ROOT"
  log "校验浏览根目录：$root"

  # 绝对化
  if [[ "$root" != /* ]]; then
    root="$PWD/$root"
    ANDROID_LAN_ROOT="$root"
  fi

  # 1) 不存在：不自动乱建；只有明确是可写挂载点场景才尝试 mkdir
  if [[ ! -e "$root" ]]; then
    # 若父目录存在且可读，说明路径拼写错误或未挂载
    local parent
    parent="$(dirname "$root")"
    if [[ -d "$parent" && -r "$parent" ]]; then
      die "目录不存在：$root
父目录 $parent 可访问，但该目录不存在。
请确认路径是否正确，或先在安卓中创建/授权该目录后重试。"
    fi
    die "目录不存在：$root
父目录不可访问或路径无效：$parent
安卓受保护目录（如部分 /data/*、Android/data 未授权时）通常会表现为不存在或不可读。"
  fi

  # 2) 必须是目录
  if [[ ! -d "$root" ]]; then
    die "路径不是目录：$root
请提供一个可浏览的目录，而不是文件。"
  fi

  # 3) 可读性：EACCES / EPERM 等一律明确报错
  if [[ ! -r "$root" ]]; then
    local hint=""
    case "$root" in
      /sdcard/*|/storage/*|/mnt/*)
        hint="该路径看起来像安卓存储。请确认：
  1) Termux 中已执行过: termux-setup-storage
  2) 在 Ubuntu 子系统中该路径已被 proot 绑定
  3) 系统文件管理器授权了对应目录
"
        ;;
      /data/*)
        hint="安卓 /data 目录通常无权限访问，请改用 /sdcard 或 /storage/emulated/0 下你有权限的目录。
"
        ;;
      /Android/*|*/Android/*)
        hint="部分 Android 目录（如 Android/data）受系统限制，Ubuntu 子系统可能读不了。
请换到你确保存放了文件且可读的目录。
"
        ;;
    esac
    die "目录不可读：$root
${hint}当前用户: $(id -un 2>/dev/null || echo unknown)
可先手动验证: ls -la '$root'"
  fi

  # 4) 尝试列出内容，确认真实可访问（有些目录 r可读但 list 失败）
  local sample=""
  if ! sample="$(timeout 5 ls -A "$root" 2>&1 | head -5 | tr '\n' ' ')"; then
    die "无法列出目录内容（可能超时/权限/proc 特殊路径）：$root
$sample
若你确认该目录应可访问，请检查 proot 绑定 / 安卓授权；不要使用 /proc、/sys 等虚拟目录作为浏览根。"
  fi
  log "目录可访问。示例条目: ${sample:-（空目录）}"
  log "绝对路径: $(realpath "$root" 2>/dev/null || echo "$root")"

  # 5) 若是空目录，给出提示但不失败
  if [[ -z "${sample// }" ]]; then
    warn "目录为空：$root（服务仍可启动，但列表会是空的）"
  fi

  # 6) 可选：若目录是挂载点则记录；非挂载点也不强制 bind
  if mountpoint -q "$root" 2>/dev/null; then
    log "该路径已是挂载点"
  else
    log "该路径是普通目录（proot 绑定目录也属于这种情况，可正常读取）"
  fi
}

# 仅当 root 是默认 /sdcard 且不可读时，才尝试常见绑定
try_fallback_bind_for_default_sdcard() {
  [[ "$ANDROID_LAN_ROOT" == "/sdcard" ]] || return 0
  [[ -r /sdcard ]] && return 0
  log "尝试常见存储绑定源…"
  local src=""
  for c in /storage/emulated/0 /mnt/sdcard /sdcard; do
    if [[ -d "$c" && -r "$c" ]]; then
      src="$c"
      break
    fi
  done
  [[ -n "$src" ]] || return 0
  log "尝试 bind-mount: $src -> /sdcard"
  if mount --bind "$src" /sdcard 2>/dev/null; then
    log "bind-mount 成功"
  else
    warn "bind-mount 失败（proot 可能无 mount 权限），继续尝试直接读取"
  fi
}

# -----------------------------------------------------------------------------
# 2) 安装系统与 Python 依赖
# -----------------------------------------------------------------------------
install_deps() {
  # 依赖已齐时跳过 apt，避免在 proot 上 apt 挂起
  local need_apt=0
  python3 -c "import flask" >/dev/null 2>&1 || need_apt=1
  command -v curl >/dev/null 2>&1 || need_apt=1
  command -v python3 >/dev/null 2>&1 || need_apt=1

  if [[ "$need_apt" == "1" ]]; then
    log "安装/更新系统依赖…"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      python3-venv \
      python3-flask \
      ca-certificates \
      curl \
      file \
      qrencode \
      rsync || true
  else
    log "核心依赖已就绪，跳过 apt"
  fi

  if ! python3 -c "import pptx" >/dev/null 2>&1; then
    log "安装 python-pptx …"
    pip3 install --break-system-packages python-pptx 2>/dev/null \
      || pip3 install python-pptx \
      || warn "python-pptx 安装失败，PPT 将依赖 LibreOffice 转 PDF 或仅下载"
  fi

  if [[ "${INSTALL_LIBREOFFICE,,}" == "yes" ]]; then
    # 组件级检查：PPT→impress，Word→writer，Excel→calc；缺哪个补哪个
    # 字体：Noto CJK 保证中文文档转换观感（没有它会回退到系统默认/豆腐块）
    local lo_pkgs=()
    if command -v dpkg >/dev/null 2>&1; then
      local p
      for p in libreoffice-impress libreoffice-writer libreoffice-calc fonts-noto-cjk; do
        dpkg -s "$p" >/dev/null 2>&1 || lo_pkgs+=("$p")
      done
    elif ! command -v soffice >/dev/null 2>&1 && ! command -v libreoffice >/dev/null 2>&1; then
      lo_pkgs+=(libreoffice-impress libreoffice-writer libreoffice-calc fonts-noto-cjk)
    fi
    if [[ ${#lo_pkgs[@]} -gt 0 ]]; then
      log "安装 LibreOffice 组件与中文字体（${lo_pkgs[*]}，体积较大）…"
      apt-get install -y --no-install-recommends "${lo_pkgs[@]}" || {
        warn "LibreOffice 组件安装失败。PPT/Word/Excel 将回退为仅下载（PPT 另可文本提取）。"
      }
    else
      log "LibreOffice 组件与中文字体已就绪（impress/writer/calc + Noto CJK）"
    fi
  else
    log "跳过 LibreOffice 安装"
  fi

  if ! python3 -c "import flask" >/dev/null 2>&1; then
    pip3 install --break-system-packages 'flask>=3.0.0' || pip3 install 'flask>=3.0.0'
  fi
}

# -----------------------------------------------------------------------------
# 3) 部署应用文件
# -----------------------------------------------------------------------------
deploy_app() {
  log "部署应用到 $ANDROID_LAN_HOME …"
  mkdir -p "$ANDROID_LAN_HOME" "$ANDROID_LAN_CACHE" "$ANDROID_LAN_HOME/logs" "$ANDROID_LAN_HOME/static" "$ANDROID_LAN_HOME/templates"

  if command -v rsync >/dev/null 2>&1; then
    rsync -a \
      --exclude '.git' --exclude '__pycache__' --exclude '*.pyc' \
      "$SCRIPT_SRC_DIR/server.py" "$SCRIPT_SRC_DIR/requirements.txt" "$SCRIPT_SRC_DIR/README.md" \
      "$ANDROID_LAN_HOME/" 2>/dev/null || {
      cp -a "$SCRIPT_SRC_DIR/server.py" "$SCRIPT_SRC_DIR/requirements.txt" "$ANDROID_LAN_HOME/"
      [[ -f "$SCRIPT_SRC_DIR/README.md" ]] && cp -a "$SCRIPT_SRC_DIR/README.md" "$ANDROID_LAN_HOME/"
    }
    # 注意：static/ templates/ 末尾带斜杠，表示复制目录内容到目标子目录
    rsync -a "$SCRIPT_SRC_DIR/static/" "$ANDROID_LAN_HOME/static/"
    rsync -a "$SCRIPT_SRC_DIR/templates/" "$ANDROID_LAN_HOME/templates/"
  else
    cp -a "$SCRIPT_SRC_DIR/server.py" "$SCRIPT_SRC_DIR/requirements.txt" "$ANDROID_LAN_HOME/"
    [[ -f "$SCRIPT_SRC_DIR/README.md" ]] && cp -a "$SCRIPT_SRC_DIR/README.md" "$ANDROID_LAN_HOME/"
    mkdir -p "$ANDROID_LAN_HOME/static" "$ANDROID_LAN_HOME/templates"
    cp -a "$SCRIPT_SRC_DIR/static/." "$ANDROID_LAN_HOME/static/"
    cp -a "$SCRIPT_SRC_DIR/templates/." "$ANDROID_LAN_HOME/templates/"
  fi

  # 持久化配置（独立配置文件）
  cat > "$ANDROID_LAN_HOME/android-lan-file-server.conf" <<EOF
# android-lan-file-server 配置（部署脚本生成，可手工修改后重启）
DEFAULT_ROOT=$ANDROID_LAN_ROOT
ALLOW_OUTSIDE_ROOT=$ANDROID_LAN_ALLOW_OUTSIDE_ROOT
ANDROID_LAN_HOST=$ANDROID_LAN_HOST
ANDROID_LAN_PORT=$ANDROID_LAN_PORT
ANDROID_LAN_HOME=$ANDROID_LAN_HOME
ANDROID_LAN_CACHE=$ANDROID_LAN_CACHE
EOF

  # 兼容旧 config.env
  cat > "$ANDROID_LAN_HOME/config.env" <<EOF
export ANDROID_LAN_ROOT="$ANDROID_LAN_ROOT"
export ANDROID_LAN_HOST="$ANDROID_LAN_HOST"
export ANDROID_LAN_PORT="$ANDROID_LAN_PORT"
export ANDROID_LAN_CACHE="$ANDROID_LAN_CACHE"
export ANDROID_LAN_HOME="$ANDROID_LAN_HOME"
export ANDROID_LAN_ALLOW_OUTSIDE_ROOT="$ANDROID_LAN_ALLOW_OUTSIDE_ROOT"
EOF

  # 使用源码 start.sh（支持 conf + 打印访问链接 + 权限开关）
  if [[ -f "$SCRIPT_SRC_DIR/start.sh" ]]; then
    cp -a "$SCRIPT_SRC_DIR/start.sh" "$ANDROID_LAN_HOME/start.sh"
  fi
  if [[ -f "$SCRIPT_SRC_DIR/stop.sh" ]]; then
    cp -a "$SCRIPT_SRC_DIR/stop.sh" "$ANDROID_LAN_HOME/stop.sh"
  fi
  # 本地私有配置一并带上（含本机个人路径，不会出现在仓库里）
  if [[ -f "$SCRIPT_SRC_DIR/android-lan-file-server.local.conf" ]]; then
    cp -a "$SCRIPT_SRC_DIR/android-lan-file-server.local.conf" "$ANDROID_LAN_HOME/"
  fi
  chmod +x "$ANDROID_LAN_HOME/start.sh" "$ANDROID_LAN_HOME/stop.sh"
  log "应用文件已部署"
  log "配置文件: $ANDROID_LAN_HOME/android-lan-file-server.conf"
}

# -----------------------------------------------------------------------------
# 4) 启动服务
# -----------------------------------------------------------------------------
start_service() {
  log "启动 android-lan-file-server 服务…"

  if [[ -f /tmp/android-lan-file-server.pid ]]; then
    OLD="$(cat /tmp/android-lan-file-server.pid 2>/dev/null || true)"
    if [[ -n "${OLD:-}" ]] && kill -0 "$OLD" 2>/dev/null; then
      log "停止旧进程 pid=$OLD"
      kill "$OLD" 2>/dev/null || true
      sleep 1
      kill -9 "$OLD" 2>/dev/null || true
    fi
    rm -f /tmp/android-lan-file-server.pid
  fi

  if command -v ss >/dev/null 2>&1; then
    mapfile -t _old_pids < <(ss -lptn "sport = :$ANDROID_LAN_PORT" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)
    for p in "${_old_pids[@]:-}"; do
      [[ -n "${p:-}" ]] || continue
      kill "$p" 2>/dev/null || true
    done
    sleep 0.5
  fi

  if [[ ! -r "$ANDROID_LAN_ROOT" ]]; then
    die "启动前校验失败: $ANDROID_LAN_ROOT 不可读"
  fi

  local outside_flag="--deny-outside"
  if [[ "$ANDROID_LAN_ALLOW_OUTSIDE_ROOT" == "yes" ]]; then
    outside_flag="--allow-outside"
  fi

  nohup bash "$ANDROID_LAN_HOME/start.sh" \
    --root "$ANDROID_LAN_ROOT" \
    --host "$ANDROID_LAN_HOST" \
    --port "$ANDROID_LAN_PORT" \
    "$outside_flag" \
    > "$ANDROID_LAN_HOME/logs/android-lan-file-server.log" 2>&1 &
  echo $! > /tmp/android-lan-file-server.pid
  disown || true

  local ok=0
  for _ in $(seq 1 40); do
    if curl -fsS "http://${ANDROID_LAN_HOST}:${ANDROID_LAN_PORT}/healthz" >/dev/null 2>&1; then
      ok=1
      break
    fi
    sleep 0.5
  done

  if [[ "$ok" != "1" ]]; then
    err "服务启动失败，日志如下："
    tail -n 80 "$ANDROID_LAN_HOME/logs/android-lan-file-server.log" 2>/dev/null || true
    die "请检查端口 $ANDROID_LAN_PORT 是否被占用，或查看 $ANDROID_LAN_HOME/logs/android-lan-file-server.log
根目录: $ANDROID_LAN_ROOT"
  fi

  local health
  health="$(curl -fsS "http://${ANDROID_LAN_HOST}:${ANDROID_LAN_PORT}/healthz" 2>/dev/null || true)"
  log "健康检查通过: $health"
  echo "访问链接: http://${ANDROID_LAN_HOST}:${ANDROID_LAN_PORT}/"
}

# -----------------------------------------------------------------------------
# 5) 输出访问信息
# -----------------------------------------------------------------------------
print_info() {
  local soffice="未安装(PPT 仅文本预览/下载)"
  if command -v soffice >/dev/null 2>&1 || command -v libreoffice >/dev/null 2>&1; then
    soffice="已安装(PPT 可转 PDF 预览)"
  fi
  local ips=()
  local ip
  while IFS= read -r ip; do
    [[ -n "$ip" ]] || continue
    [[ "$ip" == 127.* ]] && continue
    ips+=("$ip")
  done < <(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || true)
  if [[ ${#ips[@]} -eq 0 ]]; then
    while IFS= read -r ip; do
      [[ -n "$ip" ]] || continue
      [[ "$ip" == 127.* ]] && continue
      ips+=("$ip")
    done < <(ip -4 -o addr show 2>/dev/null | awk '{split($4,a,"/"); print a[1]}' || true)
  fi

  local outside_note="no（默认）：仅允许访问根目录及其子目录"
  if [[ "$ANDROID_LAN_ALLOW_OUTSIDE_ROOT" == "yes" ]]; then
    outside_note="yes：允许访问根目录以外路径"
  fi

  cat <<EOF

============================================================
 android-lan-file-server 部署完成
============================================================
 监听绑定   : ${ANDROID_LAN_HOST}:${ANDROID_LAN_PORT}
 本机访问   : http://127.0.0.1:${ANDROID_LAN_PORT}/
EOF
  if [[ ${#ips[@]} -gt 0 ]]; then
    echo " 局域网访问（分享给同网段设备）:"
    for ip in "${ips[@]}"; do
      echo "   http://${ip}:${ANDROID_LAN_PORT}/"
    done
    if [[ "$ANDROID_LAN_HOST" != "0.0.0.0" ]]; then
      echo " 注意: 当前绑定为 ${ANDROID_LAN_HOST}，局域网可能连不上。"
      echo "       如需局域网访问，请设置 ANDROID_LAN_HOST=0.0.0.0 后重启。"
    else
      echo " 说明: 已监听 0.0.0.0，局域网设备可直接打开上述地址。"
    fi
  else
    echo " 局域网访问: 未检测到 IPv4，请使用 http://<手机IP>:${ANDROID_LAN_PORT}/"
  fi

  cat <<EOF
 浏览根目录 : $ANDROID_LAN_ROOT
 越权访问   : $outside_note
 服务目录   : $ANDROID_LAN_HOME
 配置文件   : $ANDROID_LAN_HOME/android-lan-file-server.conf
 健康检查   : http://127.0.0.1:${ANDROID_LAN_PORT}/healthz
 日志文件   : $ANDROID_LAN_HOME/logs/android-lan-file-server.log
 PID 文件   : /tmp/android-lan-file-server.pid
 LibreOffice: $soffice

 常用操作：
   查看状态 : cat /tmp/android-lan-file-server.pid && ps -p \$(cat /tmp/android-lan-file-server.pid)
   查看日志 : tail -f $ANDROID_LAN_HOME/logs/android-lan-file-server.log
   换目录启动（仅限该目录及子目录）:
     bash $ANDROID_LAN_HOME/stop.sh
     bash $ANDROID_LAN_HOME/start.sh --root /sdcard/Download
   允许访问其他路径:
     bash $ANDROID_LAN_HOME/start.sh --root /sdcard/Download --allow-outside
   修改默认目录/开关后重启:
     vi $ANDROID_LAN_HOME/android-lan-file-server.conf
     bash $ANDROID_LAN_HOME/stop.sh && bash $ANDROID_LAN_HOME/start.sh
   停止服务 : bash $ANDROID_LAN_HOME/stop.sh

 在线预览支持：
   PDF / 音频 / 视频 / Markdown / 纯文本 / 图片
   PPT/PPTX：优先 LibreOffice 转 PDF；否则提取文本预览
============================================================
EOF

  # 局域网二维码：对方连同一 Wi-Fi 扫码直接打开
  local lan_ip=""
  lan_ip="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | grep -v '^127\.' | head -1 || true)"
  if [[ -n "$lan_ip" ]] && command -v qrencode >/dev/null 2>&1; then
    echo ""
    echo "扫码访问（局域网）:"
    qrencode -t ANSIUTF8 "http://${lan_ip}:${ANDROID_LAN_PORT}/" | sed 's/^/  /'
  fi
}

# -----------------------------------------------------------------------------
main() {
  mark_root_explicit "$@"
  parse_args "$@"
  check_environment
  ensure_root_mounted
  try_fallback_bind_for_default_sdcard
  if [[ ! -r "$ANDROID_LAN_ROOT" ]]; then
    die "目录仍不可读：$ANDROID_LAN_ROOT
请提供你确保存在且可访问的目录，例如:
  bash deploy.sh --root /sdcard/Download
  bash deploy.sh --root /sdcard/Download"
  fi
  install_deps
  deploy_app
  start_service
  print_info
}

main "$@"
