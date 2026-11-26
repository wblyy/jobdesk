// Resume text extraction. Everything happens locally in the browser: the file
// is read with FileReader and parsed by vendored libraries, never uploaded.
(function (root) {
  // Parser libraries are ~3 MB together and each is needed only for one file
  // type, so they are fetched on first use rather than at page load.
  const loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      el.onload = () => resolve();
      el.onerror = () => { delete loaded[src]; reject(new Error("组件加载失败，检查网络后重试")); };
      document.head.appendChild(el);
    });
    return loaded[src];
  }

  const ensure = {
    pdf: async () => {
      await loadScript("js/vendor/pdf.min.js");
      if (!root.pdfjsLib) throw new Error("PDF 组件没起来");
      // The worker must be same-origin; it is served alongside the app.
      root.pdfjsLib.GlobalWorkerOptions.workerSrc = "js/vendor/pdf.worker.min.js";
    },
    docx: () => loadScript("js/vendor/mammoth.browser.min.js"),
    xlsx: () => loadScript("js/vendor/xlsx.full.min.js"),
  };

  // Is this file type's parser already in memory? The first PDF of a session
  // pays a ~1.5 MB download; the caller says so instead of looking frozen.
  function ready(kind) {
    if (kind === "pdf") return !!root.pdfjsLib;
    if (kind === "docx") return !!root.mammoth;
    if (kind === "xlsx") return !!root.XLSX;
    return true;
  }

  async function fromPdf(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const pdf = await root.pdfjsLib.getDocument({ data: buf, useWorkerFetch: false, isEvalSupported: false }).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      // Group text items into visual lines. PDFs scatter order entirely; y
      // positions are the only reliable way to rebuild line structure.
      const rows = new Map();
      for (const item of content.items) {
        const y = Math.round(item.transform[5] / 3) * 3;
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y).push(item);
      }
      const ys = [...rows.keys()].sort((a, b) => b - a);
      for (const y of ys) {
        const line = rows.get(y).sort((a, b) => a.transform[4] - b.transform[4])
          .map((it) => it.str).join(" ").replace(/\s+/g, " ").trim();
        if (line) pages.push(line);
      }
      pages.push("");
    }
    return pages.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  async function fromDocx(file) {
    const buf = await file.arrayBuffer();
    const out = await root.mammoth.extractRawText({ arrayBuffer: buf });
    return (out.value || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  async function fromHtml(file) {
    const text = await file.text();
    const doc = new DOMParser().parseFromString(text, "text/html");
    // block elements become lines so section headers stay separable
    const out = [];
    const walk = (node) => {
      for (const ch of node.childNodes) {
        if (ch.nodeType === 3) continue;
        const tag = ch.tagName;
        if (!tag) continue;
        if (/^(P|DIV|LI|TR|H[1-6]|SECTION|BR)$/.test(tag)) {
          const t = (ch.textContent || "").replace(/\s+/g, " ").trim();
          if (t) out.push(t);
        } else {
          walk(ch);
        }
      }
    };
    walk(doc.body);
    return out.join("\n");
  }

  async function fromText(file) {
    const raw = await file.text();
    return raw.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  /** Returns { text, kind, warning } */
  async function extract(file) {
    const name = (file.name || "").toLowerCase();
    const ext = name.split(".").pop();
    if (ext === "pdf") {
      await ensure.pdf();
      const text = await fromPdf(file);
      return finish(text, "PDF", "扫描件 PDF 里没有文字层，读不出内容。可以另存为 Word，或者直接把简历文字粘进下面的输入框。");
    }
    if (ext === "docx") {
      await ensure.docx();
      return finish(await fromDocx(file), "Word");
    }
    if (ext === "doc") {
      throw new Error("旧版 .doc 读不了，请用 Word 另存为 .docx，或者直接粘贴文字。");
    }
    if (ext === "html" || ext === "htm") return finish(await fromHtml(file), "网页");
    if (ext === "txt" || ext === "md") return finish(await fromText(file), "文本");
    throw new Error("不支持的文件类型：" + (ext || "未知") + "。支持 PDF / docx / txt / html。");
  }

  function finish(text, kind, emptyHint) {
    const t = (text || "").trim();
    if (t.length < 40) {
      const err = new Error(emptyHint || "文件里没读到文字，可能是图片或扫描件。");
      err.code = "EMPTY";
      throw err;
    }
    const cjk = (t.match(/[一-龥]/g) || []).length;
    const warning = cjk < t.length * 0.15
      ? "读到的中文很少，可能结构没有完整提取，建议检查一下识别结果再匹配。"
      : "";
    return { text: t, kind, warning };
  }

  root.JDResume = { extract, ensure, ready };
})(window);
