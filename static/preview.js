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

    body.innerHTML = window.MDWeb ? window.MDWeb.render(raw) : escapeHtml(raw);
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

  improveBackLink();
  bindMarkdown();
  bindText();
  bindPdfJs();
  bindCopyPath();
  bindMediaErrors();
})();
