(function () {
  "use strict";

  var cfg = window.__ANDROID_LAN__ || {};

  // 排序状态：{key: name|time, dir: asc|desc}，跨会话记忆（预览页滑动顺序也读它）
  function loadSort() {
    try {
      var v = JSON.parse(localStorage.getItem("alfs-list-sort") || "{}");
      if (
        (v.key === "name" || v.key === "time") &&
        (v.dir === "asc" || v.dir === "desc")
      ) {
        return { key: v.key, dir: v.dir };
      }
    } catch (e) {}
    return { key: "name", dir: "asc" };
  }

  // 显示隐藏文件：全局设置，一处开关所有目录生效，跨会话记忆
  function loadHidden() {
    try {
      return localStorage.getItem("alfs-show-hidden") === "1";
    } catch (e) {
      return false;
    }
  }

  var state = {
    path: cfg.startPath || "",
    hidden: loadHidden(),
    data: null,
    query: "",
    sort: loadSort(),
  };

  var els = {
    dirTitle: document.getElementById("dirTitle"),
    pathLine: document.getElementById("pathLine"),
    countBadge: document.getElementById("countBadge"),
    tree: document.getElementById("tree"),
    fileBody: document.getElementById("fileBody"),
    emptyState: document.getElementById("emptyState"),
    refreshBtn: document.getElementById("refreshBtn"),
    moreBtn: document.getElementById("moreBtn"),
    moreMenu: document.getElementById("moreMenu"),
    hiddenToggle: document.getElementById("hiddenToggle"),
    miCopyPath: document.getElementById("miCopyPath"),
    miCopyName: document.getElementById("miCopyName"),
    sortToggle: document.getElementById("sortToggle"),
    sortNote: document.getElementById("sortNote"),
    sortMenu: document.getElementById("sortMenu"),
    aboutBtn: document.getElementById("aboutBtn"),
    aboutModal: document.getElementById("aboutModal"),
    aboutClose: document.getElementById("aboutClose"),
    openSideBtn: document.getElementById("openSideBtn"),
    closeSide: document.getElementById("closeSide"),
    sidePanel: document.getElementById("sidePanel"),
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

  // 当前目录绝对路径 / 目录名（复制与顶栏渲染共用）
  function currentAbs() {
    if (state.data && state.data.path_abs) return state.data.path_abs;
    var root = String(cfg.rootPath || "").replace(/\/+$/, "");
    var sp = state.path || "";
    return sp.charAt(0) === "@" ? sp.slice(1) : root + (sp ? "/" + sp : "");
  }
  function currentName() {
    var segs = currentAbs().split("/").filter(Boolean);
    return segs.length ? segs[segs.length - 1] : cfg.rootName || "/";
  }

  // 顶栏两行：第一行当前目录名，第二行父目录完整路径（分段可点，可换行）
  function renderPathLine() {
    var abs = currentAbs();
    var segs = abs.split("/").filter(Boolean);
    var cur = segs.length ? segs[segs.length - 1] : cfg.rootName || "/";
    if (els.dirTitle) els.dirTitle.textContent = cur;
    document.title = cur + " · 文件浏览";

    if (!els.pathLine) return;
    var rootNorm = String(cfg.rootPath || "").replace(/\/+$/, "");
    var parentSegs = segs.slice(0, -1); // 父目录 = 去掉当前目录名
    if (!parentSegs.length) {
      els.pathLine.innerHTML = '<span class="sep">/</span>';
      return;
    }
    var html = ['<span class="sep">/</span>'];
    var acc = "";
    parentSegs.forEach(function (seg, i) {
      acc += "/" + seg;
      var inRoot =
        rootNorm && (acc === rootNorm || acc.indexOf(rootNorm + "/") === 0);
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
      if (i < parentSegs.length - 1) html.push('<span class="sep">/</span>');
    });
    els.pathLine.innerHTML = html.join("");
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
      var r = 0;
      if (state.sort.key === "time") r = (a.mtime || 0) - (b.mtime || 0);
      if (r === 0)
        r = String(a.name).localeCompare(String(b.name), "zh");
      return state.sort.dir === "desc" ? -r : r;
    });

    if (!items.length) {
      els.fileBody.innerHTML =
        '<tr><td colspan="3" class="muted">没有匹配的文件</td></tr>';
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

      rows.push(
        "<tr>" +
          "<td>" +
          nameHtml +
          "</td>" +
          '<td class="muted">' +
          (item.is_dir ? "" : escapeHtml(item.size_h || "")) +
          "</td>" +
          '<td class="muted">' +
          escapeHtml(item.mtime_h || "") +
          "</td>" +
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
    var bits = [data.count + " 项"];
    if (data.truncated) bits.push("已截断");
    els.countBadge.textContent = bits.join(" · ");
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

    if (els.dirTitle) els.dirTitle.textContent = "正在加载…";
    try {
      var data = await fetchLs(state.path);
      state.data = data;
      renderPathLine();
      renderTree(data);
      renderHeader(data);
      renderTable(data);
      focusLastPreviewed();
      if (opts.focusSearch) {
        els.searchInput.value = "";
        state.query = "";
      }
    } catch (e) {
      els.fileBody.innerHTML =
        '<tr><td colspan="3" class="muted">加载失败：' +
        escapeHtml(e.message || String(e)) +
        "</td></tr>";
      toast(e.message || "加载失败");
    }
  }

  // Events
  els.fileBody.addEventListener("click", function (e) {
    var a = e.target.closest("a[data-path]");
    if (!a) return;
    e.preventDefault();
    var path = a.getAttribute("data-path");
    if (a.getAttribute("data-dir") === "1") {
      load(path);
    } else {
      var kind = a.getAttribute("data-kind") || "";
      location.href = previewUrl(path, kind, false);
    }
  });

  els.pathLine.addEventListener("click", function (e) {
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
  if (els.hiddenToggle) {
    els.hiddenToggle.checked = state.hidden; // 菜单勾选态与全局设置同步
    els.hiddenToggle.addEventListener("change", function () {
      state.hidden = els.hiddenToggle.checked;
      try {
        localStorage.setItem("alfs-show-hidden", state.hidden ? "1" : "0");
      } catch (e) {}
      load(state.path, { push: false });
    });
  }
  els.searchInput.addEventListener("input", function () {
    state.query = els.searchInput.value || "";
    if (state.data) renderTable(state.data);
  });

  // ── 顶栏 ⋮ 菜单：开关 / 排序子菜单 / 两项复制 / 关于 ──
  var SORT_LABELS = {
    "name:asc": "名称正序",
    "name:desc": "名称倒序",
    "time:asc": "时间正序",
    "time:desc": "时间倒序",
  };

  function sortKey() {
    return state.sort.key + ":" + state.sort.dir;
  }

  function closeMenu() {
    if (!els.moreMenu) return;
    els.moreMenu.hidden = true;
    if (els.moreBtn) els.moreBtn.setAttribute("aria-expanded", "false");
    if (els.sortMenu) els.sortMenu.hidden = true;
    if (els.sortToggle) els.sortToggle.setAttribute("aria-expanded", "false");
  }

  function syncSortUI() {
    if (!els.sortNote || !els.sortMenu) return;
    els.sortNote.textContent = SORT_LABELS[sortKey()] || "";
    var opts = els.sortMenu.querySelectorAll("[data-sort]");
    for (var i = 0; i < opts.length; i++) {
      opts[i].classList.toggle(
        "on",
        opts[i].getAttribute("data-sort") === sortKey()
      );
    }
  }

  if (els.moreBtn && els.moreMenu) {
    els.moreBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var opening = els.moreMenu.hidden;
      els.moreMenu.hidden = !opening;
      els.moreBtn.setAttribute("aria-expanded", opening ? "true" : "false");
    });
    document.addEventListener("click", function (e) {
      if (els.moreMenu.hidden) return;
      if (!e.target.closest) return;
      if (e.target.closest("#moreMenu") || e.target.closest("#moreBtn")) return;
      closeMenu();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMenu();
    });
  }

  if (els.sortToggle && els.sortMenu) {
    syncSortUI();
    els.sortToggle.addEventListener("click", function (e) {
      e.stopPropagation();
      var opening = els.sortMenu.hidden;
      els.sortMenu.hidden = !opening;
      els.sortToggle.setAttribute("aria-expanded", opening ? "true" : "false");
    });
    els.sortMenu.addEventListener("click", function (e) {
      e.stopPropagation();
      var b = e.target.closest("[data-sort]");
      if (!b) return;
      var parts = b.getAttribute("data-sort").split(":");
      state.sort = { key: parts[0], dir: parts[1] };
      try {
        localStorage.setItem("alfs-list-sort", JSON.stringify(state.sort));
      } catch (err) {}
      syncSortUI();
      if (state.data) renderTable(state.data);
      closeMenu();
      toast("已按" + SORT_LABELS[sortKey()]);
    });
  }

  if (els.miCopyPath) {
    els.miCopyPath.addEventListener("click", function () {
      closeMenu();
      copyText(currentAbs()).then(
        function () {
          toast("已复制完整路径");
        },
        function () {
          toast("复制失败，请手动选择复制");
        }
      );
    });
  }
  if (els.miCopyName) {
    els.miCopyName.addEventListener("click", function () {
      closeMenu();
      copyText(currentName()).then(
        function () {
          toast("已复制文件名");
        },
        function () {
          toast("复制失败，请手动选择复制");
        }
      );
    });
  }

  if (els.aboutBtn && els.aboutModal) {
    els.aboutBtn.addEventListener("click", function () {
      closeMenu();
      els.aboutModal.hidden = false;
    });
    if (els.aboutClose) {
      els.aboutClose.addEventListener("click", function () {
        els.aboutModal.hidden = true;
      });
    }
    // 点遮罩任意处立即跳过
    els.aboutModal.addEventListener("click", function (e) {
      if (e.target === els.aboutModal) els.aboutModal.hidden = true;
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") els.aboutModal.hidden = true;
    });
  }

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
