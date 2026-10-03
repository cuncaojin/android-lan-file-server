(function () {
  "use strict";

  var meta = window.__PREVIEW_META__ || {};

  function bindMarkdown() {
    var body = document.getElementById("mdBody");
    var source = document.getElementById("mdSource");
    var payload = document.getElementById("mdPayload");
    if (!body || !payload) return;

    var raw = "";
    try {
      raw = JSON.parse(payload.textContent || '""');
    } catch (e) {
      raw = payload.textContent || "";
    }

    // 相对路径图片按当前文件所在目录解析（md.js 拼到 /raw/<dir>/<file>）
    var rel = String(meta.path || "");
    var slash = rel.lastIndexOf("/");
    var basePath = slash >= 0 ? rel.slice(0, slash) : "";
    body.innerHTML = window.MDWeb
      ? window.MDWeb.render(raw, { basePath: basePath })
      : escapeHtml(raw);
    if (source) {
      source.textContent = raw;
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function bindText() {
    var view = document.getElementById("textView");
    var payload = document.getElementById("textPayload");
    if (!view || !payload) return;

    var raw = "";
    try {
      raw = JSON.parse(payload.textContent || '""');
    } catch (e) {
      raw = payload.textContent || "";
    }

    // --- 状态：默认不换行、显示行号、13px ---
    var st = { wrap: false, lines: true, size: 13 };
    try {
      var saved = JSON.parse(localStorage.getItem("sdcard-preview-text") || "{}");
      if (typeof saved.wrap === "boolean") st.wrap = saved.wrap;
      if (typeof saved.lines === "boolean") st.lines = saved.lines;
      if (typeof saved.size === "number") st.size = Math.min(28, Math.max(10, saved.size));
    } catch (e) {}
    function saveState() {
      try {
        localStorage.setItem("sdcard-preview-text", JSON.stringify(st));
      } catch (e) {}
    }

    // --- JSON 检测：可解析则提供格式化；.json 打开即格式化 ---
    var pretty = "";
    var jsonOk = false;
    try {
      var parsed = JSON.parse(raw);
      pretty = JSON.stringify(parsed, null, 2);
      jsonOk = typeof pretty === "string";
    } catch (e) {}
    var showPretty = jsonOk && (meta.ext || "").toLowerCase() === ".json";
    var current = showPretty ? pretty : raw;

    // --- 渲染 ---
    function renderNumbered(text) {
      var lines = escapeHtml(text).split("\n");
      var digits = String(lines.length).length + 1;
      view.style.setProperty("--tl-num-w", digits + "ch");
      var out = new Array(lines.length);
      for (var i = 0; i < lines.length; i++) {
        out[i] =
          '<div class="tl-row"><span class="tl-num">' +
          (i + 1) +
          '</span><span class="tl-code">' +
          lines[i] +
          "</span></div>";
      }
      view.innerHTML = out.join("");
    }
    function render(text) {
      if (st.lines) {
        renderNumbered(text);
      } else {
        view.textContent = text;
      }
    }

    // --- 工具栏 ---
    var btnWrap = document.getElementById("btnWrap");
    var btnLines = document.getElementById("btnLines");
    var btnFormat = document.getElementById("btnFormat");
    var btnZoomOut = document.getElementById("btnZoomOut");
    var btnZoomIn = document.getElementById("btnZoomIn");
    var btnZoomLabel = document.getElementById("btnZoomLabel");

    function applyState() {
      view.classList.toggle("wrap", st.wrap);
      view.style.fontSize = st.size + "px";
      if (btnWrap) btnWrap.classList.toggle("on", st.wrap);
      if (btnLines) btnLines.classList.toggle("on", st.lines);
      if (btnZoomLabel) btnZoomLabel.textContent = st.size + "px";
        if (btnFormat) {
          btnFormat.hidden = !jsonOk;
          btnFormat.textContent = showPretty ? "取消格式化" : "格式化";
          btnFormat.classList.toggle("on", showPretty);
        }
    }
    function setZoom(next) {
      st.size = Math.min(28, Math.max(10, next));
      saveState();
      applyState();
    }

    if (btnWrap) {
      btnWrap.addEventListener("click", function () {
        st.wrap = !st.wrap;
        saveState();
        applyState();
      });
    }
    if (btnLines) {
      btnLines.addEventListener("click", function () {
        st.lines = !st.lines;
        saveState();
        applyState();
        render(current);
      });
    }
    if (btnFormat) {
      btnFormat.addEventListener("click", function () {
        if (!jsonOk) return;
        showPretty = !showPretty;
        current = showPretty ? pretty : raw;
        saveState();
        applyState();
        render(current);
      });
    }
    if (btnZoomOut) {
      btnZoomOut.addEventListener("click", function () {
        setZoom(st.size - 1);
      });
    }
    if (btnZoomIn) {
      btnZoomIn.addEventListener("click", function () {
        setZoom(st.size + 1);
      });
    }
    if (btnZoomLabel) {
      btnZoomLabel.addEventListener("click", function () {
        setZoom(13);
      });
    }
    view.addEventListener(
      "wheel",
      function (ev) {
        if (!ev.ctrlKey && !ev.metaKey) return;
        ev.preventDefault();
        setZoom(st.size + (ev.deltaY < 0 ? 1 : -1));
      },
      { passive: false }
    );

    applyState();
    render(current);
  }

  // HTTP 局域网地址非安全上下文，navigator.clipboard 不可用，回退 execCommand
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

  // 顶栏 ⋮ 菜单：复制完整路径 / 复制文件名 / 下载 / 原始文件；长按或双击文件名也可打开
  function bindMoreMenu() {
    var btn = document.getElementById("moreBtn");
    var menu = document.getElementById("moreMenu");
    if (!btn || !menu) return;
    var title = document.querySelector(".topbar .title");

    function open() {
      menu.hidden = false;
      btn.setAttribute("aria-expanded", "true");
    }
    function close() {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (menu.hidden) open();
      else close();
    });
    document.addEventListener("click", function (e) {
      if (menu.hidden) return;
      if (!e.target.closest) return;
      if (e.target.closest("#moreMenu") || e.target.closest("#moreBtn")) return;
      close();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });

    if (title) {
      var lpTimer = 0;
      title.addEventListener(
        "touchstart",
        function () {
          lpTimer = setTimeout(open, 500);
        },
        { passive: true }
      );
      ["touchend", "touchmove", "touchcancel"].forEach(function (ev) {
        title.addEventListener(
          ev,
          function () {
            clearTimeout(lpTimer);
          },
          { passive: true }
        );
      });
      title.addEventListener("dblclick", open);
    }

    var copyPath = document.getElementById("miCopyPath");
    if (copyPath && meta.full_path) {
      copyPath.addEventListener("click", function () {
        close();
        copyText(meta.full_path).then(
          function () {
            showToast("完整路径已复制", 1500);
          },
          function () {
            window.prompt("自动复制失败，长按手动复制：", meta.full_path);
          }
        );
      });
    }
    var copyName = document.getElementById("miCopyName");
    if (copyName && meta.name) {
      copyName.addEventListener("click", function () {
        close();
        copyText(meta.name).then(
          function () {
            showToast("文件名已复制", 1500);
          },
          function () {
            window.prompt("自动复制失败，长按手动复制：", meta.name);
          }
        );
      });
    }
    ["miDownload", "miRaw"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("click", close);
    });
  }

  // 视图模式栏：左侧预览相关按钮（如 Markdown 渲染/源码）；原始文件统一走 ⋮ 菜单
  function bindModebar() {
    var modebar = document.querySelector(".modebar");
    if (!modebar || !modebar.querySelector("[data-view]")) return;
    var mdBody = document.getElementById("mdBody");
    var mdSource = document.getElementById("mdSource");

    function activate(view) {
      var btns = modebar.querySelectorAll("[data-view]");
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle(
          "on",
          btns[i].getAttribute("data-view") === view
        );
      }
      if (mdBody) {
        mdBody.hidden = view === "source";
        if (mdSource) mdSource.hidden = view === "render";
      }
    }

    modebar.addEventListener("click", function (e) {
      if (!e.target.closest) return;
      var b = e.target.closest("[data-view]");
      if (b) activate(b.getAttribute("data-view"));
    });
  }

  // Android 式工具栏：下滚隐藏（内容跟随滑出），上滚再显示
  function bindToolbarAutohide() {
    var bar = document.getElementById("topbar");
    if (!bar) return;
    var lastY = window.scrollY || 0;
    var down = 0;
    var up = 0;

    function closeMenu() {
      var menu = document.getElementById("moreMenu");
      var btn = document.getElementById("moreBtn");
      if (menu && !menu.hidden) {
        menu.hidden = true;
        if (btn) btn.setAttribute("aria-expanded", "false");
      }
    }

    window.addEventListener(
      "scroll",
      function () {
        var y = window.scrollY || document.documentElement.scrollTop || 0;
        var dy = y - lastY;
        lastY = y;
        if (y <= 4) {
          bar.classList.remove("tb-hidden");
          down = 0;
          up = 0;
          return;
        }
        if (dy > 0) {
          down += dy;
          up = 0;
          if (down > 24 && !bar.classList.contains("tb-hidden")) {
            closeMenu();
            bar.classList.add("tb-hidden");
          }
        } else if (dy < 0) {
          up -= dy;
          down = 0;
          if (up > 8) bar.classList.remove("tb-hidden");
        }
      },
      { passive: true }
    );
  }

  function bindMediaErrors() {
    var audio = document.getElementById("audioEl");
    var video = document.getElementById("videoEl");
    var img = document.getElementById("imgEl");

    function fail(el, label) {
      if (!el) return;
      el.addEventListener("error", function () {
        var box = document.createElement("div");
        box.className = "fallback";
        box.style.marginTop = "12px";
        box.innerHTML =
          "<p>" +
          label +
          " 加载失败。可能是格式不支持或文件损坏。</p>" +
          '<a class="btn primary" href="' +
          meta.download_url +
          '" download>下载文件</a>';
        el.insertAdjacentElement("afterend", box);
      });
    }
    fail(audio, "音频");
    fail(video, "视频");
    fail(img, "图片");
  }

  function bindPdfJs() {
    var shell = document.getElementById("pdfjsShell");
    if (!shell) return;
    var url = shell.getAttribute("data-url");
    if (!url) return;
    shell.innerHTML = '<div class="pdfjs-status">PDF 加载中…</div>';

    function fallback(msg) {
      shell.innerHTML =
        '<div class="pdfjs-status">无法内嵌显示（' +
        escapeHtml(msg) +
        '）<br /><a class="btn primary" href="' +
        escapeHtml(url) +
        '" target="_blank" rel="noopener">在新窗口打开</a> ' +
        '<a class="btn ghost" href="' +
        escapeHtml(url) +
        '" download>下载</a></div>';
    }

    import("/static/vendor/pdfjs.min.mjs")
      .then(function (lib) {
        lib.GlobalWorkerOptions.workerSrc =
          "/static/vendor/pdfjs.worker.min.mjs";
        return lib.getDocument({ url: url }).promise;
      })
      .then(function (pdf) {
        shell.innerHTML = "";
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var rendered = new Array(pdf.numPages).fill(false);
        var pages = [];
        for (var i = 1; i <= pdf.numPages; i++) {
          var div = document.createElement("div");
          div.className = "pdfjs-page";
          div.setAttribute("data-page", String(i));
          shell.appendChild(div);
          pages.push(div);
        }

        function render(n) {
          if (rendered[n - 1]) return Promise.resolve();
          rendered[n - 1] = true;
          return pdf.getPage(n).then(function (page) {
            var vp1 = page.getViewport({ scale: 1 });
            var scale = Math.max(0.2, (shell.clientWidth - 20) / vp1.width);
            var vp = page.getViewport({ scale: scale * dpr });
            var canvas = document.createElement("canvas");
            canvas.width = Math.floor(vp.width);
            canvas.height = Math.floor(vp.height);
            canvas.style.width = Math.floor(scale * vp1.width) + "px";
            canvas.style.height = Math.floor(scale * vp1.height) + "px";
            pages[n - 1].appendChild(canvas);
            return page
              .render({ canvasContext: canvas.getContext("2d"), viewport: vp })
              .promise.catch(function () {
                pages[n - 1].classList.add("pdfjs-page-error");
              });
          });
        }

        // 前两页立即渲染，其余进入视口附近再渲染（大文件不卡）
        if ("IntersectionObserver" in window) {
          var io = new IntersectionObserver(
            function (entries) {
              entries.forEach(function (en) {
                if (!en.isIntersecting) return;
                io.unobserve(en.target);
                render(Number(en.target.getAttribute("data-page")));
              });
            },
            { root: shell, rootMargin: "400px" }
          );
          pages.forEach(function (div, idx) {
            if (idx < 2) render(idx + 1);
            else io.observe(div);
          });
        } else {
          pages.forEach(function (div, idx) {
            render(idx + 1);
          });
        }
      })
      .catch(function (err) {
        var msg =
          err && err.name === "PasswordException"
            ? "文件已加密"
            : (err && err.message) || "渲染失败";
        fallback(msg);
      });
  }

  function improveBackLink() {
    var back = document.getElementById("backHome");
    if (!back) return;
    if (meta.parent) {
      back.href = "/?path=" + encodeURIComponent(meta.parent);
    }
  }

  // ---- 同目录可预览文件：双指左右滑动切换（到头即止，不循环）----
  // 单指横滑不切换，改为弹提示教用户改用双指（防内容横滑/缩放平移误触）
  function encodePath(p) {
    return String(p || "")
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/");
  }

  // ---- 底部轻提示：首次滑动提示与到头（第一个/最后一个）提示共用 ----
  var toastEl = null;
  var toastTimer = 0;
  function showToast(text, duration) {
    try {
      if (!toastEl || !toastEl.isConnected) {
        toastEl = document.createElement("div");
        toastEl.className = "swipe-toast";
        document.body.appendChild(toastEl);
      }
      toastEl.textContent = text;
      toastEl.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        if (toastEl) toastEl.classList.remove("show");
        setTimeout(function () {
          if (!toastEl) return;
          toastEl.remove();
          toastEl = null;
        }, 500);
      }, duration || 1600);
    } catch (e) {}
  }

  function bindSwipe() {
    if (!meta.path) return;
    var parent = meta.parent || "";
    var seq = [];
    var idx = -1;
    // 双指手势状态：起始/最新双指中点与间距
    var active = false;
    var sx = 0;
    var sy = 0;
    var lx = 0;
    var ly = 0;
    var dist0 = 0;
    var distL = 0;
    // 单指手势（仅用于弹提示，不切换文件）
    var single = false;
    var ssx = 0;
    var ssy = 0;
    var singleTarget = null;
    var hScroll0 = null;

    // 触点落在交互控件或媒体控制区时，不当作切换手势
    function skipStart(t, y) {
      if (!t || !t.closest) return true;
      if (t.closest("a, button, input, textarea, select, audio")) return true;
      if (t.closest(".modebar, .more-menu, .actions")) return true;
      if (t.tagName === "VIDEO") {
        var r = t.getBoundingClientRect();
        if (y > r.bottom - 64) return true; // 底部控制条（进度条拖动）区域
      }
      return false;
    }

    // 记录横向可滚动祖先的起始滚动位置
    function hScrollMark(t) {
      hScroll0 = [];
      for (var n = t; n && n !== document.body; n = n.parentElement) {
        if (n.scrollWidth <= n.clientWidth + 1) continue;
        var ox = window.getComputedStyle(n).overflowX;
        if (ox === "auto" || ox === "scroll") hScroll0.push([n, n.scrollLeft]);
      }
    }

    // 本次手势被内容横滑消费（位置发生位移）则让位，不切换文件
    function hScrollConsumed() {
      if (!hScroll0) return false;
      for (var i = 0; i < hScroll0.length; i++) {
        if (Math.abs(hScroll0[i][0].scrollLeft - hScroll0[i][1]) > 1) return true;
      }
      return false;
    }

    function selectionActive() {
      try {
        var sel = window.getSelection();
        return !!(sel && !sel.isCollapsed && String(sel).length);
      } catch (e) {
        return false;
      }
    }

    function midOf(t0, t1) {
      return [
        (t0.clientX + t1.clientX) / 2,
        (t0.clientY + t1.clientY) / 2
      ];
    }
    function distOf(t0, t1) {
      var dx = t0.clientX - t1.clientX;
      var dy = t0.clientY - t1.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    // 双指横滑判定并切换（间距剧变=捏合缩放，取消）
    function tryTwoFingerSwitch() {
      if (Math.abs(distL - dist0) > 30) return; // 缩放手势，不是切换
      var dx = lx - sx;
      var dy = ly - sy;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      if (hScrollConsumed()) return; // 手势在滚动内容上：让位
      if (selectionActive()) return;
      var next = idx + (dx < 0 ? 1 : -1); // 左滑下一个，右滑上一个
      if (next < 0) {
        showToast("已经是第一个文件", 1500); // 不循环：到头停住并提示
        return;
      }
      if (next >= seq.length) {
        showToast("已经是最后一个文件", 1500);
        return;
      }
      var f = seq[next];
      location.href =
        "/preview/" +
        encodePath(f.path) +
        (f.kind ? "?kind=" + encodeURIComponent(f.kind) : "");
    }

    function attach(files) {
      seq = files;
      idx = -1;
      for (var i = 0; i < seq.length; i++) {
        if (seq[i].path === meta.path) {
          idx = i;
          break;
        }
      }
      if (idx < 0 || seq.length < 2) return; // 找不到自己或无可切换项

      document.addEventListener(
        "touchstart",
        function (e) {
          if (!e.touches || !e.touches.length) return;
          var n = e.touches.length;
          if (n === 1) {
            active = false;
            if (skipStart(e.target, e.touches[0].clientY)) {
              single = false;
              singleTarget = null;
              return;
            }
            single = true;
            singleTarget = e.target;
            ssx = e.touches[0].clientX;
            ssy = e.touches[0].clientY;
            hScrollMark(e.target);
            return;
          }
          if (n === 2) {
            single = false; // 第二根手指落下：单指流程作废
            if (
              skipStart(e.target, e.touches[0].clientY) ||
              (singleTarget &&
                skipStart(singleTarget, e.touches[0].clientY))
            ) {
              active = false;
              return;
            }
            var m = midOf(e.touches[0], e.touches[1]);
            sx = lx = m[0];
            sy = ly = m[1];
            dist0 = distL = distOf(e.touches[0], e.touches[1]);
            hScrollMark(e.target);
            active = true;
            return;
          }
          active = false;
          single = false;
        },
        { passive: true }
      );
      document.addEventListener(
        "touchmove",
        function (e) {
          if (active && e.touches && e.touches.length >= 2) {
            var m = midOf(e.touches[0], e.touches[1]);
            lx = m[0];
            ly = m[1];
            distL = distOf(e.touches[0], e.touches[1]);
          }
        },
        { passive: true }
      );
      document.addEventListener(
        "touchcancel",
        function () {
          active = false;
          single = false;
        },
        { passive: true }
      );
      document.addEventListener(
        "touchend",
        function (e) {
          if (active) {
            active = false;
            tryTwoFingerSwitch();
            return;
          }
          if (
            single &&
            e.touches &&
            e.touches.length === 0 &&
            e.changedTouches &&
            e.changedTouches.length
          ) {
            single = false;
            var dx = e.changedTouches[0].clientX - ssx;
            var dy = e.changedTouches[0].clientY - ssy;
            if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
            if (hScrollConsumed()) return;
            if (selectionActive()) return;
            showToast("请用双指左右滑动切换文件", 2200); // 把失败手势变成教学时机
          }
        },
        { passive: true }
      );

      // 手势可用时给一次性提示（每会话只提示一次，不常驻打扰）
      try {
        if (!sessionStorage.getItem("alfs-swipe-hinted")) {
          showToast("双指左右滑动可切换上一个/下一个文件", 2600);
          sessionStorage.setItem("alfs-swipe-hinted", "1");
        }
      } catch (e) {}
    }

    function loadSiblings(hidden) {
      var url =
        "/api/ls?path=" +
        encodeURIComponent(parent) +
        (hidden ? "&hidden=1" : "");
      fetch(url, { credentials: "same-origin" })
        .then(function (res) {
          return res.ok ? res.json() : null;
        })
        .then(function (data) {
          if (!data) return;
          var files = (data.files || []).filter(function (f) {
            return f.previewable;
          });
          // 与列表页同一排序（localStorage alfs-list-sort），滑动顺序=列表顺序
          var sort = { key: "name", dir: "asc" };
          try {
            var v = JSON.parse(localStorage.getItem("alfs-list-sort") || "{}");
            if (
              (v.key === "name" || v.key === "time") &&
              (v.dir === "asc" || v.dir === "desc")
            ) {
              sort = { key: v.key, dir: v.dir };
            }
          } catch (e) {}
          files.sort(function (a, b) {
            var r = 0;
            if (sort.key === "time") r = (a.mtime || 0) - (b.mtime || 0);
            if (r === 0) r = String(a.name).localeCompare(String(b.name), "zh");
            return sort.dir === "desc" ? -r : r;
          });
          var found = files.some(function (f) {
            return f.path === meta.path;
          });
          if (!found && !hidden) {
            var base = meta.path.split("/").pop() || "";
            if (base.charAt(0) === ".") {
              loadSiblings(true); // 当前是隐藏文件：带 hidden=1 重拉
              return;
            }
          }
          attach(files);
        })
        .catch(function () {
          /* 接口失败时静默：滑动不可用，不影响预览 */
        });
    }

    loadSiblings(false);
  }

  // 退出预览时记住最后看过的文件，供列表页恢复焦点
  window.addEventListener("pagehide", function () {
    if (!meta.path) return;
    try {
      sessionStorage.setItem("alfs-preview-focus", meta.path);
    } catch (e) {}
  });

  improveBackLink();
  bindMarkdown();
  bindText();
  bindPdfJs();
  bindMoreMenu();
  bindModebar();
  bindToolbarAutohide();
  bindMediaErrors();
  bindSwipe();
})();
