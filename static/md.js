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

  function inline(src) {
    // src is already HTML-escaped text
    var s = String(src);
    s = s.replace(/`([^`]+)`/g, function (_, c) {
      return "<code>" + c + "</code>";
    });
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, function (_, alt, url) {
      return (
        '<img alt="' + alt + '" src="' + escapeHtml(safeUrl(url)) + '" />'
      );
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
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=\s|$|[.,;:!?)])/g, "$1<em>$2</em>");
    s = s.replace(/(^|[\s(])_([^_\n]+)_(?=\s|$|[.,;:!?)])/g, "$1<em>$2</em>");
    s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    return s;
  }

  function render(markdown) {
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

    function pushList(kind) {
      var need = 1;
      while (listStack.length > need) {
        html.push(listStack.pop() === "ul" ? "</ul>" : "</ol>");
      }
      if (listStack.length === 0) {
        html.push(kind === "ul" ? "<ul>" : "<ol>");
        listStack.push(kind);
        return;
      }
      if (listStack[listStack.length - 1] !== kind) {
        html.push(listStack.pop() === "ul" ? "</ul>" : "</ol>");
        html.push(kind === "ul" ? "<ul>" : "<ol>");
        listStack.push(kind);
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
          t.push("<th>" + inline(escapeHtml(h)) + "</th>");
        });
        t.push("</tr></thead><tbody>");
        rows.forEach(function (row) {
          t.push("<tr>");
          row.forEach(function (c) {
            t.push("<td>" + inline(escapeHtml(c)) + "</td>");
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
        html.push(
          "<h" + level + ">" + inline(escapeHtml(h[2])) + "</h" + level + ">"
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
        html.push("<blockquote>" + render(quote.join("\n")) + "</blockquote>");
        continue;
      }

      var ul = /^(\s*)[-*+]\s+(.*)$/.exec(line);
      var ol = /^(\s*)\d+\.\s+(.*)$/.exec(line);
      if (ul || ol) {
        var isUl = !!ul;
        var content = isUl ? ul[2] : ol[2];
        var depth = Math.floor(((isUl ? ul[1] : ol[1]) || "").length / 2);
        if (depth > 1) depth = 1;
        while (listStack.length > depth + 1) {
          html.push(listStack.pop() === "ul" ? "</ul>" : "</ol>");
        }
        pushList(isUl ? "ul" : "ol");
        html.push("<li>" + inline(escapeHtml(content)) + "</li>");
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
        "<p>" + inline(escapeHtml(para.join("\n")).replace(/\n/g, "<br />")) + "</p>"
      );
    }

    closeLists(0);
    return html.join("\n");
  }

  global.MDWeb = { render: render, escapeHtml: escapeHtml };
})(typeof window !== "undefined" ? window : globalThis);
