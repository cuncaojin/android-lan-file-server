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

  function renderCrumbs(data) {
    var html = [];
    (data.crumbs || []).forEach(function (c, idx, arr) {
      if (idx > 0) html.push('<span class="sep">/</span>');
      if (idx === arr.length - 1) {
        html.push("<strong>" + escapeHtml(c.name) + "</strong>");
      } else {
        html.push(
          '<a href="' + browseUrl(c.path) + '" data-path="' + escapeHtml(c.path) + '">' +
            escapeHtml(c.name) +
            "</a>"
        );
      }
    });
    els.crumbs.innerHTML = html.join(" ");
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
    els.curTitle.textContent = data.path || "/sdcard";
    var bits = [];
    bits.push(data.count + " 项");
    if (data.truncated) bits.push("（数量过大已截断）");
    bits.push(data.path_abs);
    els.curMeta.textContent = bits.join(" · ");
    els.upBtn.disabled = !data.path;
  }

  async function load(path, opts) {
    opts = opts || {};
    state.path = path || "";
    if (opts.push !== false) setHistory(state.path);

    els.curTitle.textContent = "正在加载…";
    try {
      var data = await fetchLs(state.path);
      state.data = data;
      renderCrumbs(data);
      renderTree(data);
      renderHeader(data);
      renderTable(data);
      if (opts.focusSearch) {
        els.searchInput.value = "";
        state.query = "";
      }
      document.title = (state.path || "手机存储") + " · 文件浏览";
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

  load(state.path, { push: false, focusSearch: true });
})();
