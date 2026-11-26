// P6 · 只增不减校验。
// 改稿函数说它没编，这不构成证据。这里拿改后的成品文本、按机械规则回去核对原文：
// 公司名与起止时间逐字、数字逐个、每条原经历有没有归宿。判定结果直接给运营看，
// 不由改稿逻辑自证。
(function (root) {
  // 编造与夸大的高频词。命中即判定失败，不做"可能"处理——面试官第一个追问
  // 的就是这些词，而候选人答不上来的代价由用户承担。
  const OVERCLAIM = [
    /保证/, /稳过/, /必过/, /100\s*%/, /百分之百/, /通过率/, /成功率/, /录取率/, /匹配度/,
    /行业第一/, /业内最强/, /顶尖/, /no\.?1/i, /独角兽/, /头部平台(?!经验)/,
    /有丰富的[^，。]{0,6}经验/, /责任心强/, /沟通能力强/, /抗压能力强/, /熟悉各种工具/,
    /大幅(提升|提高|增长)/, /海量/, /数亿级/, /千万级/, /亿级/,
  ];
  // "负责" 是被允许删除的（空转），"参与/协助/配合" 不许删——删了等于抬角色。
  const DEMOTE_VERBS = ["参与", "协助", "配合", "支持", "跟做"];

  const PUNCT = /[\s，。；、：:（）()「」【】《》"'“”‘’\-—–·•|｜*#]/g;

  function ngrams(s) {
    const t = String(s || "").replace(PUNCT, "");
    const g = new Set();
    for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
    return g;
  }

  function contain(a, b) {
    const ga = ngrams(a);
    if (!ga.size) return 0;
    const gb = ngrams(b);
    let hit = 0;
    for (const g of ga) if (gb.has(g)) hit++;
    return hit / ga.size;
  }

  // 数字连同单位一起取：150 元/天 与 150 个 不是同一个数，不能互相顶替。
  const NUM_RE = /(\d+(?:\.\d+)?)\s*(%|％|万|个|人|篇|张|条|天|倍|元|小时|名|次|款|套|页|字|家|省|城|步|份|场|期|轮|周|月|年|届|分)/g;

  function numbers(text) {
    const out = [];
    const s = String(text || "");
    let m;
    NUM_RE.lastIndex = 0;
    while ((m = NUM_RE.exec(s))) {
      const n = m[1] + (m[2] === "％" ? "%" : m[2]);
      out.push({ n: m[1], unit: m[2] === "％" ? "%" : m[2], tok: n });
    }
    return out;
  }

  // Read-only fields: company, title of the role, and the date range. These are
  // the first three things a recruiter checks against the original, so any drift
  // in them is a hard fail even if it is cosmetically nicer.
  function readonlyOf(res) {
    const out = [];
    for (const b of res.blocks || []) {
      if (b.company && b.company.length >= 2) out.push({ kind: "公司/组织", text: b.company, block: b });
      if (b.period) out.push({ kind: "起止时间", text: b.period, block: b });
      if (b.title && b.title.length >= 2) out.push({ kind: "职位名", text: b.title, block: b });
    }
    // dedupe: two roles at the same company is one company name
    const seen = new Set();
    return out.filter((r) => {
      const k = r.kind + "|" + r.text;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /**
   * @returns {{verdict, blocked, notes, rows, numIssues, reads}}
   *  verdict: FAIL_UNVERIFIED | FAIL | PASS_WITH_NOTES | PASS
   */
  function check(res, text, opts) {
    opts = opts || {};
    const out = String(text || "");
    const outLines = out.split(/\r?\n/).map((l) => l.replace(/^\s*(·|[0-9]+\.)\s*/, "").trim()).filter(Boolean);
    const outPlain = out.replace(PUNCT, "");

    const blocked = [];
    const notes = [];

    // ---- 0) 空稿：没有任何可核对的东西，不能算通过 ----
    if (outLines.length < 4) {
      return { verdict: "FAIL_UNVERIFIED", blocked: ["改稿几乎为空，无法核对"], notes: [], rows: [], numIssues: [] };
    }

    // ---- 1) 只读字段逐字比对 ----
    const reads = readonlyOf(res).map((r) => {
      const ok = outPlain.includes(String(r.text).replace(PUNCT, ""));
      if (!ok) blocked.push(r.kind + "「" + r.text + "」在改好的简历里找不到原文");
      return { kind: r.kind, text: r.text, ok };
    });

    // ---- 2) 数字来源：改后的每个数都必须出自原简历 ----
    const srcNums = numbers(res.raw);
    const outNums = numbers(out);
    const srcKey = new Set(srcNums.map((x) => x.tok));
    const outKey = new Set(outNums.map((x) => x.tok));
    const numIssues = [];
    for (const x of outNums) {
      if (!srcKey.has(x.tok)) {
        numIssues.push({ kind: "无出处", tok: x.tok });
      }
    }
    // 原文里的数字有没有被改口径/四舍五入/相加。
    // 判定用"这个数还在不在"而不是"这个数+#单位还在不在"：改简历会把
    // 「8.2% 的点击率」缩成「8.2%」，单位换了位置并不代表事实变了。
    for (const x of srcNums) {
      if (!outKey.has(x.tok) && !numPresent(out, x.n)) {
        numIssues.push({ kind: "丢失", tok: x.tok });
      }
    }
    if (numIssues.length) {
      for (const n of numIssues) blocked.push(n.kind === "无出处" ? "数字「" + n.tok + "」在原文里没有出处" : "原文的数字「" + n.tok + "」改后不见了");
    }

    // ---- 3) 只增不减：每条原经历要有归宿 ----
    const rows = [];
    for (const u of res.bullets || []) {
      let best = 0, bestLine = "";
      for (const line of outLines) {
        const c = contain(u.text, line);
        if (c > best) { best = c; bestLine = line; }
      }
      const where = u.block ? (u.block.company || u.block.title || "") : "";
      const mapped = best >= 0.6;
      // 数字只存在于被丢掉的那条里 → 这条事实丢了，不能算"已归档"
      let verdict = mapped ? "保留" : "未收录";
      let why = mapped ? "对应到第 " + (outLines.indexOf(bestLine) + 1) + " 行" : "原文这条没有对应输出";
      if (!mapped && u.block) {
        const stillThere = outPlain.includes(String(u.block.company || "").replace(PUNCT, ""));
        if (stillThere) { verdict = "段落保留·条目略"; why = "该段仍在，这条被压缩掉了"; }
      }
      if (!mapped) {
        const um = numbers(u.text);
        for (const x of um) {
          if (!numPresent(out, x.n)) { blocked.push("「" + where + "」那条里的「" + x.tok + "」改后不见了"); verdict = "事实丢失"; break; }
        }
      }
      // 角色降级：原文写"协助"，改后变主导
      if (mapped) {
        const had = DEMOTE_VERBS.filter((v) => u.text.includes(v));
        const kept = DEMOTE_VERBS.filter((v) => bestLine.includes(v));
        if (had.length > kept.length) {
          blocked.push("「" + where + "」原文写「" + had.join("/") + "」，改后没了——等于把你的角色抬高了");
          verdict = "角色被抬高";
        }
      }
      rows.push({ orig: u.text, out: mapped ? bestLine : "", verdict, why, score: best, where });
    }
    const lost = rows.filter((r) => r.verdict === "事实丢失" || r.verdict === "角色被抬高" || r.verdict === "未收录");
    if (lost.length) notes.push("有 " + lost.length + " 条原经历没有完整保留，运营侧自己看一眼要不要补");

    // ---- 4) 夸大口径扫描 ----
    for (const re of OVERCLAIM) {
      const m = out.match(re);
      if (m) blocked.push("出现不能写的说法：「" + m[0] + "」");
    }
    if (/(^|[。；\s])我(?![们])/.test(out)) blocked.push("简历里不要用第一人称「我」");

    // ---- 5) 段落完整性：原文有的段，改后不能整段消失 ----
    const SECTION_NAME = { edu: "教育背景", exp: "实习/工作经历", proj: "项目经历", skill: "技能", award: "荣誉奖项", campus: "校园经历" };
    for (const k of ["edu", "exp", "proj", "skill", "award", "campus"]) {
      const has = (res.sec[k] || []).some((l) => String(l).trim().length > 3);
      if (!has) continue;
      const marker = SECTION_NAME[k];
      if (k === "exp" || k === "proj" || k === "campus") continue; // 合并进【相关经历】，由只读字段兜底
      if (!out.includes(marker) && !out.includes(marker.slice(0, 2))) {
        blocked.push("原文有" + marker + "，改后整段不见了");
      }
    }

    const verdict = blocked.length
      ? "FAIL"
      : notes.length || rows.some((r) => r.verdict === "段落保留·条目略")
        ? "PASS_WITH_NOTES"
        : "PASS";

    return { verdict, blocked: dedupe(blocked), notes, rows, numIssues, reads };
  }

  // 数在不在，且不是另一个数的一部分（"8.2" 不能被 "18.2" 蒙混过去）
  function numPresent(text, n) {
    const re = new RegExp("(^|[^0-9.])" + escapeRe(n) + "(?![0-9])");
    return re.test(text);
  }

  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function dedupe(a) { return [...new Set(a)]; }

  root.JDVerify = { check, numbers };
})(window);
