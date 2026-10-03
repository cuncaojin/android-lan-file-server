(function () {
  "use strict";

  var cfg = window.__ANDROID_LAN__ || {};
  var state = {
    path: cfg.startPath || "",
    hidden: false,
    data: null,
    query: "",
  };

  var els = {
    crumbs: document.getElementById("crumbs"),
    tree: document.getElementById("tree"),
    fileBody: document.getElementById("fileBody"),
    emptyState: document.getElementById("emptyState"),
    curTitle: document.getElementById("curTitle"),
    curMeta: document.getElementById("curMeta"),
    upBtn: document.getElementById("upBtn"),
    refreshBtn: document.getElementById("refreshBtn"),
    openSideBtn: document.getElementById("openSideBtn"),
    closeSide: document.getElementById("closeSide"),
    sidePanel: document.getElementById("sidePanel"),
    hiddenToggle: document.getElementById("hiddenToggle"),
    searchInput: document.getElementById("searchInput"),
    toast: document.getElementById("toast"),
  };

  // HTTP 局域网非安全上下文无 clipboard API，回退 execCommand
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (e) {}
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error("copy failed"));
    });
  }

  function toast(msg) {
    if (!els.toast) return;
    els.toast.hidden = false;
    els.toast.textContent = msg;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      els.toast.hidden = true;
    }, 2400);
  }

  function qs(obj) {
    var p = new URLSearchParams();
    Object.keys(obj || {}).forEach(function (k) {
      if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") {
        p.set(k, obj[k]);
      }
    });
    var s = p.toString();
    return s ? "?" + s : "";
  }

  function iconFor(item) {
    if (item.is_dir) return "📁";
    switch (item.kind) {
      case "pdf": return "📄";
      case "ppt": return "📊";
      case "office": return "📑";
      case "markdown": return "📝";
      case "text": return "📃";
      case "audio": return "🎵";
      case "video": return "🎬";
      case "image": return "🖼️";
      case "epub": return "📖";
      default: return "📦";
    }
  }

  function previewUrl(path, kind, download) {
    var q = qs({ kind: kind, download: download ? 1 : "" });
    return "/preview/" + encodePath(path) + q;
  }

  function encodePath(path) {
    return String(path || "")
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/");
  }

  function rawUrl(path, download) {
    return "/raw/" + encodePath(path) + qs({ download: download ? 1 : "" });
  }

  function browseUrl(path) {
    return "/?path=" + encodeURIComponent(path || "");
  }

  function setHistory(path) {
    var url = browseUrl(path);
    if (location.pathname + location.search !== url) {
      history.pushState({ path: path }, "", url);
    }
  }

  async function fetchLs(path) {
    var url =
      "/api/ls" +
      qs({
        path: path || "",
        hidden: state.hidden ? 1 : "",
      });
    var res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) {
      var err = await res.json().catch(function () {
        return { error: res.statusText };
      });
      throw new Error(err.error || "加载失败");
    }
    return res.json();
  }

  // 单行完整绝对路径：任意中间段可点击跳转；
  // 分享根之外的段按 allow_outside 决定可点（否则置灰不可跳）
  function renderPathRow(data) {
    var abs = data.path_abs || "";
    if (!abs) {
      var root = String(cfg.rootPath || "").replace(/\/+$/, "");
      var sp = state.path || "";
      abs = sp.charAt(0) === "@" ? sp.slice(1) : root + (sp ? "/" + sp : "");
    }
    var rootNorm = String(cfg.rootPath || "").replace(/\/+$/, "");
    var parts = abs.split("/").filter(Boolean);
    if (!parts.length) {
      els.crumbs.innerHTML = '<span class="sep">/</span>';
      return;
    }
    var html = ['<span class="sep root-sep">/</span>'];
    var acc = "";
    parts.forEach(function (seg, i) {
      acc += "/" + seg;
      var last = i === parts.length - 1;
      if (last) {
        html.push('<strong title="' + escapeHtml(abs) + '">' + escapeHtml(seg) + "</strong>");
        return;
      }
      var inRoot =
        rootNorm &&
        (acc === rootNorm || acc.indexOf(rootNorm + "/") === 0);
      if (inRoot) {
        var rel = acc === rootNorm ? "" : acc.slice(rootNorm.length + 1);
        html.push(
          '<a href="' + browseUrl(rel) + '" data-path="' + escapeHtml(rel) + '">' +
            escapeHtml(seg) +
            "</a>"
        );
      } else if (cfg.allowOutside) {
        var outside = "@" + acc;
        html.push(
          '<a href="' + browseUrl(outside) + '" data-path="' + escapeHtml(outside) + '">' +
            escapeHtml(seg) +
            "</a>"
        );
      } else {
        html.push('<span class="dead" title="超出分享根目录，不可访问">' + escapeHtml(seg) + "</span>");
      }
      html.push('<span class="sep">/</span>');
    });
    els.crumbs.innerHTML = html.join("");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderTable(data) {
    var rows = [];
    var items = []
      .concat(data.dirs || [], data.files || [])
      .filter(function (item) {
        if (!state.query) return true;
        return item.name.toLowerCase().indexOf(state.query.toLowerCase()) !== -1;
      });

    items.sort(function (a, b) {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      return String(a.name).localeCompare(String(b.name), "zh");
    });

    if (!items.length) {
      els.fileBody.innerHTML =
        '<tr><td colspan="4" class="muted">没有匹配的文件</td></tr>';
      els.emptyState.hidden = items.length > 0;
      return;
    }

    els.emptyState.hidden = true;
    items.forEach(function (item) {
      var nameHtml =
        '<div class="name-cell">' +
        '<span class="icon">' +
        iconFor(item) +
        "</span>" +
        '<a href="' +
        (item.is_dir ? browseUrl(item.path) : previewUrl(item.path, item.kind)) +
        '" data-path="' +
        escapeHtml(item.path) +
        '" data-dir="' +
        (item.is_dir ? "1" : "0") +
        '" data-kind="' +
        escapeHtml(item.kind || "") +
        '" title="' +
        escapeHtml(item.name) +
        '">' +
        escapeHtml(item.name) +
        "</a>" +
        "</div>";

      var full = (cfg.rootPath || "").replace(/\/+$/, "") + "/" + item.path;
      var ops = [];
      if (item.is_dir) {
        ops.push(
          '<a class="btn ghost" href="' + browseUrl(item.path) + '">打开</a>'
        );
      } else {
        if (item.previewable) {
          ops.push(
            '<a class="btn" href="' +
              previewUrl(item.path, item.kind) +
              '">预览</a>'
          );
        }
        ops.push(
          '<a class="btn ghost" href="' +
            rawUrl(item.path, true) +
            '" download="' +
            escapeHtml(item.name) +
            '">下载</a>'
        );
        ops.push(
          '<a class="btn ghost" href="' +
            rawUrl(item.path, false) +
            '" target="_blank" rel="noopener">原始</a>'
        );
      }
      ops.push(
        '<button type="button" class="btn ghost" data-copy="' +
          escapeHtml(full) +
          '" title="复制服务器完整路径，可在终端直接使用" aria-label="复制完整路径">📋</button>'
      );

      rows.push(
        "<tr>" +
          "<td>" +
          nameHtml +
          "</td>" +
          '<td class="muted">' +
          (item.is_dir ? "目录" : escapeHtml(item.size_h || "")) +
          "</td>" +
          '<td class="muted">' +
          escapeHtml(item.mtime_h || "") +
          "</td>" +
          '<td><div class="ops">' +
          ops.join("") +
          "</div></td>" +
          "</tr>"
      );
    });
    els.fileBody.innerHTML = rows.join("");
  }

  function renderTree(data) {
    // Lightweight: current path + first-level siblings of parent
    var html = [];
    var rootName = cfg.rootName || "sdcard";
    html.push(
      '<button type="button" class="tree-item' +
        (!state.path ? " active" : "") +
        '" data-path="">📱 ' +
        escapeHtml(rootName) +
        "</button>"
    );

    // Show current path chain
    if (state.path) {
      var parts = state.path.split("/").filter(Boolean);
      var acc = "";
      parts.forEach(function (p, idx) {
        acc = acc ? acc + "/" + p : p;
        html.push(
          '<button type="button" class="tree-item' +
            (idx === parts.length - 1 ? " active" : "") +
            '" data-path="' +
            escapeHtml(acc) +
            '">' +
            escapeHtml(p) +
            "</button>"
        );
      });
    }

    // Show children of current directory as tree
    var children = []
      .concat(data.dirs || [])
      .filter(function (d) {
        return d.is_dir;
      })
      .slice(0, 200);
    if (children.length) {
      html.push('<div class="tree-children">');
      children.forEach(function (d) {
        html.push(
          '<button type="button" class="tree-item" data-path="' +
            escapeHtml(d.path) +
            '">' +
            escapeHtml(d.name) +
            "</button>"
        );
      });
      html.push("</div>");
    }

    els.tree.innerHTML = html.join("");
  }

  function renderHeader(data) {
    // 面板标题只显示目录名（完整路径已在顶栏路径行展示）
    var parts = String(data.path || "").split("/").filter(Boolean);
    els.curTitle.textContent = parts.length
      ? parts[parts.length - 1]
      : cfg.rootName || "/";
    var bits = [];
    bits.push(data.count + " 项");
    if (data.truncated) bits.push("（数量过大已截断）");
    els.curMeta.textContent = bits.join(" · ");
    els.upBtn.disabled = !state.path;
  }

  // 预览页退出时写入 sessionStorage；此处消费一次，把焦点还给刚看过的文件
  function focusLastPreviewed() {
    var want = null;
    try {
      want = sessionStorage.getItem("alfs-preview-focus");
      if (want) sessionStorage.removeItem("alfs-preview-focus");
    } catch (e) {
      return;
    }
    if (!want) return;
    // 逐个比对属性，避免文件名含引号/反斜杠时 CSS 选择器报错
    var links = els.fileBody.querySelectorAll("a[data-path]");
    var a = null;
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute("data-path") === want) {
        a = links[i];
        break;
      }
    }
    if (!a) return;
    try {
      a.focus({ preventScroll: true });
    } catch (e) {
      a.focus();
    }
    a.scrollIntoView({ block: "center" });
  }

  async function load(path, opts) {
    opts = opts || {};
    state.path = path || "";
    if (opts.push !== false) setHistory(state.path);

    els.curTitle.textContent = "正在加载…";
    try {
      var data = await fetchLs(state.path);
      state.data = data;
      renderPathRow(data);
      renderTree(data);
      renderHeader(data);
      renderTable(data);
      focusLastPreviewed();
      if (opts.focusSearch) {
        els.searchInput.value = "";
        state.query = "";
      }
      document.title = (state.path || "lan file server") + " · 文件浏览";
    } catch (e) {
      els.fileBody.innerHTML =
        '<tr><td colspan="4" class="muted">加载失败：' +
        escapeHtml(e.message || String(e)) +
        "</td></tr>";
      toast(e.message || "加载失败");
    }
  }

  function goParent() {
    if (!state.path) return;
    var parts = state.path.split("/").filter(Boolean);
    parts.pop();
    load(parts.join("/"));
  }

  // Events
  els.fileBody.addEventListener("click", function (e) {
    var cp = e.target.closest("[data-copy]");
    if (cp) {
      e.preventDefault();
      copyText(cp.getAttribute("data-copy")).then(
        function () {
          toast("已复制完整路径");
        },
        function () {
          toast("复制失败，请手动选择复制");
        }
      );
      return;
    }
    var a = e.target.closest("a[data-path]");
    if (!a) return;
    // allow browser default for download / target=_blank
    if (a.getAttribute("download") || a.getAttribute("target") === "_blank") return;
    e.preventDefault();
    var path = a.getAttribute("data-path");
    if (a.getAttribute("data-dir") === "1") {
      load(path);
    } else {
      var kind = a.getAttribute("data-kind") || "";
      location.href = previewUrl(path, kind, false);
    }
  });

  els.crumbs.addEventListener("click", function (e) {
    var a = e.target.closest("a[data-path]");
    if (!a) return;
    e.preventDefault();
    load(a.getAttribute("data-path"));
  });

  els.tree.addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-path]");
    if (!btn) return;
    load(btn.getAttribute("data-path") || "");
    els.sidePanel.classList.remove("open");
  });

  els.upBtn.addEventListener("click", goParent);
  els.refreshBtn.addEventListener("click", function () {
    load(state.path, { push: false });
    toast("已刷新");
  });
  els.openSideBtn.addEventListener("click", function () {
    els.sidePanel.classList.add("open");
  });
  els.closeSide.addEventListener("click", function () {
    els.sidePanel.classList.remove("open");
  });
  els.hiddenToggle.addEventListener("change", function () {
    state.hidden = els.hiddenToggle.checked;
    load(state.path, { push: false });
  });
  els.searchInput.addEventListener("input", function () {
    state.query = els.searchInput.value || "";
    if (state.data) renderTable(state.data);
  });

  window.addEventListener("popstate", function (e) {
    var path = (e.state && e.state.path) || "";
    load(path, { push: false });
  });

  // 触摸设备（手机/平板）用下拉刷新替代刷新按钮；桌面保留按钮
  function bindPullRefresh() {
    var coarse = false;
    try {
      coarse =
        (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) ||
        (navigator.maxTouchPoints || 0) > 0;
    } catch (e) {}
    if (!coarse) return;
    var startY = 0;
    var startX = 0;
    var armed = false;
    document.addEventListener(
      "touchstart",
      function (e) {
        if (e.touches.length !== 1) {
          armed = false;
          return;
        }
        var y = window.scrollY || document.documentElement.scrollTop || 0;
        armed = y <= 0;
        startY = e.touches[0].clientY;
        startX = e.touches[0].clientX;
      },
      { passive: true }
    );
    document.addEventListener(
      "touchend",
      function (e) {
        if (!armed) return;
        armed = false;
        if (!e.changedTouches || !e.changedTouches.length) return;
        var y = window.scrollY || document.documentElement.scrollTop || 0;
        if (y > 0) return;
        var dy = e.changedTouches[0].clientY - startY;
        var dx = e.changedTouches[0].clientX - startX;
        if (dy > 80 && Math.abs(dx) < 50) {
          load(state.path, { push: false });
          toast("已刷新");
        }
      },
      { passive: true }
    );
  }

  // 浏览器返回若命中 bfcache（不重新加载），列表原样恢复时补一次焦点
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) focusLastPreviewed();
  });

  bindPullRefresh();
  load(state.path, { push: false, focusSearch: true });
})();
