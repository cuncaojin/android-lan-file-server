(function () {
  "use strict";

  var meta = window.__PREVIEW_META__ || {};

  function bindMarkdown() {
    var body = document.getElementById("mdBody");
    var source = document.getElementById("mdSource");
    var toggle = document.getElementById("mdToggle");
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

    if (toggle && source) {
      var showingSource = false;
      toggle.addEventListener("click", function () {
        showingSource = !showingSource;
        body.hidden = showingSource;
        source.hidden = !showingSource;
        toggle.textContent = showingSource ? "切换渲染" : "切换源码";
      });
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
        btnFormat.textContent = showPretty ? "查看源码" : "格式化";
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

  function bindCopyPath() {
    var btn = document.getElementById("copyPathBtn");
    if (!btn || !meta.full_path) return;
    btn.addEventListener("click", function () {
      copyText(meta.full_path).then(
        function () {
          var old = btn.textContent;
          btn.textContent = "已复制";
          setTimeout(function () {
            btn.textContent = old;
          }, 1500);
        },
        function () {
          window.prompt("自动复制失败，长按手动复制：", meta.full_path);
        }
      );
    });
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

  // ---- 同目录可预览文件：左右滑动切换（到头即止，不循环） ----
  function encodePath(p) {
    return String(p || "")
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/");
  }

  function bindSwipe() {
    if (!meta.path) return;
    var parent = meta.parent || "";
    var seq = [];
    var idx = -1;
    var sx = 0;
    var sy = 0;
    var active = false;
    var hScroll0 = null;

    // 触点落在交互控件或媒体控制区时，不当作切换手势
    function skipStart(t, y) {
      if (!t || !t.closest) return true;
      if (t.closest("a, button, input, textarea, select, audio")) return true;
      if (t.closest(".actions, .text-toolbar, .md-toolbar")) return true;
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
          if (!e.touches || e.touches.length !== 1) {
            active = false;
            return;
          }
          if (skipStart(e.target, e.touches[0].clientY)) {
            active = false;
            return;
          }
          active = true;
          sx = e.touches[0].clientX;
          sy = e.touches[0].clientY;
          hScrollMark(e.target);
        },
        { passive: true }
      );
      document.addEventListener(
        "touchcancel",
        function () {
          active = false;
        },
        { passive: true }
      );
      document.addEventListener(
        "touchend",
        function (e) {
          if (!active || !e.changedTouches || !e.changedTouches.length) return;
          active = false;
          var dx = e.changedTouches[0].clientX - sx;
          var dy = e.changedTouches[0].clientY - sy;
          // 横向主导 + 足够位移，避免与竖向滚动手势打架
          if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
          if (hScrollConsumed()) return; // 手势在滚动内容上：让位给横向滚动
          try {
            var sel = window.getSelection();
            if (sel && !sel.isCollapsed && String(sel).length) return; // 文本选择中
          } catch (err) {}
          var next = idx + (dx < 0 ? 1 : -1); // 左滑下一个，右滑上一个
          if (next < 0 || next >= seq.length) return; // 不循环：到头停住
          var f = seq[next];
          location.href =
            "/preview/" +
            encodePath(f.path) +
            (f.kind ? "?kind=" + encodeURIComponent(f.kind) : "");
        },
        { passive: true }
      );

      // 手势可用时给一次性提示（每会话只提示一次，不常驻打扰）
      try {
        if (!sessionStorage.getItem("alfs-swipe-hinted")) {
          var tip = document.createElement("div");
          tip.className = "swipe-toast";
          tip.textContent = "左右滑动可切换上一个/下一个文件";
          document.body.appendChild(tip);
          requestAnimationFrame(function () {
            tip.classList.add("show");
          });
          setTimeout(function () {
            tip.classList.remove("show");
            setTimeout(function () {
              tip.remove();
            }, 500);
          }, 2600);
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
          files.sort(function (a, b) {
            return String(a.name).localeCompare(String(b.name), "zh");
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
  bindCopyPath();
  bindMediaErrors();
  bindSwipe();
})();
