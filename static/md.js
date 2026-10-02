/* Minimal offline Markdown renderer. Escapes HTML once, then applies inline rules. */
(function (global) {
  "use strict";

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeUrl(url) {
    var u = String(url || "").trim();
    if (/^(https?:|mailto:|\/|#)/i.test(u)) return u;
    return "#";
  }

  function inline(src, basePath) {
    // src is already HTML-escaped text
    var s = String(src);
    s = s.replace(/`([^`]+)`/g, function (_, c) {
      return "<code>" + c + "</code>";
    });
    // 反斜杠转义：先占位为 n，所有规则跑完后还原为字面字符
    var esc = [];
    s = s.replace(/\\([\\`*_~[\]()#+\-.!{}])/g, function (_, c) {
      esc.push(c);
      return "" + (esc.length - 1) + "";
    });
    // 相对路径图片：拼为 /raw/<当前目录>/<文件>，浏览器可直接取原图
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, function (_, alt, url) {
      var u = String(url || "").trim();
      if (!/^(https?:|mailto:|\/|#)/i.test(u)) {
        u = "/raw/" + (basePath ? basePath + "/" : "") + u.replace(/^\.?\//, "");
      }
      return '<img alt="' + alt + '" src="' + escapeHtml(safeUrl(u)) + '" />';
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, function (_, text, url) {
      return (
        '<a href="' +
        escapeHtml(safeUrl(url)) +
        '" target="_blank" rel="noopener noreferrer">' +
        text +
        "</a>"
      );
    });
    s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, "<strong><em>$1</em></strong>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    // 斜体：前缀允许中文标点；结尾只排除紧连的词字符，兼容 CJK 标点
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, "$1<em>$2</em>");
    s = s.replace(/(^|[^_\w])_([^_\n]+)_(?![*\w])/g, "$1<em>$2</em>");
    s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    s = s.replace(/(\d+)/g, function (_, n) {
      return esc[+n] !== undefined ? esc[+n] : "" + n + "";
    });
    return s;
  }

  function render(markdown, opts) {
    var basePath = (opts && opts.basePath) || "";
    var lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
    var html = [];
    var i = 0;
    var listStack = [];

    function closeLists(toDepth) {
      while (listStack.length > toDepth) {
        var t = listStack.pop();
        html.push(t === "ul" ? "</ul>" : "</ol>");
      }
    }

    while (i < lines.length) {
      var line = lines[i];

      if (!line.trim()) {
        closeLists(0);
        i++;
        continue;
      }

      if (/^```/.test(line)) {
        closeLists(0);
        var lang = line.replace(/^```/, "").trim();
        var code = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) {
          code.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++;
        html.push(
          '<pre><code' +
            (lang ? ' class="language-' + escapeHtml(lang) + '"' : "") +
            ">" +
            escapeHtml(code.join("\n")) +
            "</code></pre>"
        );
        continue;
      }

      if (
        /^\s*\|/.test(line) &&
        i + 1 < lines.length &&
        /^\s*\|?[\s:|-]+\|/.test(lines[i + 1]) &&
        lines[i + 1].indexOf("-") !== -1
      ) {
        closeLists(0);
        function splitRow(r) {
          return r
            .trim()
            .replace(/^\||\|$/g, "")
            .split("|")
            .map(function (c) {
              return c.trim();
            });
        }
        var header = splitRow(line);
        i += 2;
        var rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        var t = ["<table><thead><tr>"];
        header.forEach(function (h) {
          t.push("<th>" + inline(escapeHtml(h), basePath) + "</th>");
        });
        t.push("</tr></thead><tbody>");
        rows.forEach(function (row) {
          t.push("<tr>");
          row.forEach(function (c) {
            t.push("<td>" + inline(escapeHtml(c), basePath) + "</td>");
          });
          t.push("</tr>");
        });
        t.push("</tbody></table>");
        html.push(t.join(""));
        continue;
      }

      var h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        closeLists(0);
        var level = h[1].length;
        var htext = h[2];
        var hid = "";
        var am = /\s*\{#([^}]+)\}\s*$/.exec(htext);
        if (am) {
          hid = am[1];
          htext = htext.replace(am[0], "");
        }
        html.push(
          "<h" +
            level +
            (hid ? ' id="' + escapeHtml(hid) + '"' : "") +
            ">" +
            inline(escapeHtml(htext), basePath) +
            "</h" +
            level + ">"
        );
        i++;
        continue;
      }

      if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
        closeLists(0);
        html.push("<hr />");
        i++;
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        closeLists(0);
        var quote = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          quote.push(lines[i].replace(/^\s*>\s?/, ""));
          i++;
        }
        html.push(
          "<blockquote>" + render(quote.join("\n"), opts) + "</blockquote>"
        );
        continue;
      }

      var ul = /^(\s*)[-*+]\s+(.*)$/.exec(line);
      var ol = /^(\s*)\d+\.\s+(.*)$/.exec(line);
      if (ul || ol) {
        var isUl = !!ul;
        var content = isUl ? ul[2] : ol[2];
        var task = "";
        var tm = /^\[([ xX])\]\s+(.*)$/.exec(content);
        if (tm) {
          task =
            '<input type="checkbox" disabled' +
            (tm[1] !== " " ? " checked" : "") +
            "> ";
          content = tm[2];
        }
        var indent = (isUl ? ul[1] : ol[1] || "").length;
        var depth = Math.floor(indent / 2);
        if (depth > 3) depth = 3;
        while (listStack.length > depth + 1) {
          html.push(listStack.pop() === "ul" ? "</ul>" : "</ol>");
        }
        while (listStack.length < depth + 1) {
          html.push(isUl ? "<ul>" : "<ol>");
          listStack.push(isUl ? "ul" : "ol");
        }
        var top = listStack[listStack.length - 1];
        if ((top === "ul") !== isUl) {
          html.push(top === "ul" ? "</ul>" : "</ol>");
          listStack.pop();
          html.push(isUl ? "<ul>" : "<ol>");
          listStack.push(isUl ? "ul" : "ol");
        }
        html.push(
          "<li" +
            (task ? ' class="task"' : "") +
            ">" +
            task +
            inline(escapeHtml(content), basePath) +
            "</li>"
        );
        i++;
        continue;
      }

      closeLists(0);
      var para = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(#{1,6}\s|```|>|\s*[-*+]\s|\s*\d+\.\s|\s*\|)/.test(lines[i])
      ) {
        para.push(lines[i]);
        i++;
      }
      if (!para.length) {
        para.push(lines[i]);
        i++;
      }
      html.push(
        "<p>" +
          inline(escapeHtml(para.join("\n")), basePath).replace(/\n/g, "<br />") +
          "</p>"
      );
    }

    closeLists(0);
    return html.join("\n");
  }

  global.MDWeb = { render: render, escapeHtml: escapeHtml };
})(typeof window !== "undefined" ? window : globalThis);
