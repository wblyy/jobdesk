// Plain-text message builders for pasting into 企业微信 / 微信.
// Deliberately no images and no markdown: WeChat renders neither, and the
// operator needs to send this in one paste. Every block is sized to fit one
// phone screen (~18 lines at WeChat's font size) so the candidate reads it
// without scrolling.
(function (root) {
  const MAX_LINES = 20;

  function salaryText(job) {
    if (!job.sal) return job.salRaw && !/未提供/.test(job.salRaw) ? job.salRaw : "薪资未写";
    const [a, b] = job.sal;
    return a === b ? a + " 元/天" : a + "-" + b + " 元/天";
  }

  function schedText(job) {
    const bits = [];
    if (job.days) bits.push("每周 " + job.days + " 天");
    if (job.months) bits.push("至少 " + job.months + " 个月");
    return bits.join("，");
  }

  // Domains are context, not capability. "JD 要的「教育」，你简历里都有对应的
  // 实例" is false — the candidate taught nothing; one internship happened to be
  // in edtech. Only tools and methods are things a person can actually claim.
  const WHY_CATS = new Set(["skill", "method"]);

  function whyLine(sc) {
    // The one-sentence answer to "why this job". Built from what actually
    // matched, not from a template that would say the same thing for any job.
    // Only concrete capabilities count: "教育" or "AI" as a domain says nothing
    // about whether this candidate can do the work, and a phrase like "最硬的
    // 几块正好是商务/渠道、教育" reads like the matcher got distracted.
    const E = root.JDEngine;
    const labels = [];
    const seen = new Set();
    for (const h of (sc.hits || [])) {
      if (!WHY_CATS.has(E.CAT.get(h.id))) continue;
      const l = E.LABEL.get(h.id);
      if (!l || seen.has(l)) continue;
      seen.add(l);
      labels.push(l);
      if (labels.length >= 3) break;
    }
    const titleRole = (sc.roleAlign.titleRoles || [])[0];
    const roleName = titleRole ? E.LABEL.get(titleRole) : "";
    if (roleName && labels.length) {
      return "它是「" + roleName + "」方向的岗，JD 要的「" + labels.join("」「") + "」你简历里都有实例。";
    }
    if (roleName) {
      // no concrete overlap in the JD wording — say the honest thing rather
      // than manufacture a reason out of a domain word
      return "它是「" + roleName + "」方向的岗，跟你写明的求职方向一致；真正对口的细节，得靠改简历把相关的经历提到前面。";
    }
    if (labels.length) return "JD 里明确要的「" + labels.join("」「") + "」，你简历里都有对应的实例。";
    return "岗位方向和你的经历基本对得上。";
  }

  /** District only — a mall address is not what decides a candidate's yes. */
  function placeText(job) {
    if (job.dist) return "杭州" + job.dist;
    if (job.loc) return job.loc.split(/[路街号]/)[0] || "杭州";
    return "杭州";
  }

  /** Requirement above what the candidate is — surfaced only when it matters. */
  function eduNote(job, res) {
    const deg = res && res.info && res.info.degree;
    if (!deg || !job.edu || job.edu === "不限") return "";
    const rank = { 大专: 1, 本科: 2, 硕士: 3, 博士: 4 };
    const a = rank[deg] || 0, b = rank[job.edu] || 0;
    if (!a || !b) return "";
    if (b > a) return "学历要" + job.edu + "，你是" + deg;
    if (b === a) return "";
    return "";
  }

  /** The daily one-job push. Must fit one screen. */
  function recommend(sc, ev, opts) {
    opts = opts || {};
    const j = sc.job;
    const res = opts.resume;
    const lines = [];
    lines.push("【今日推荐】" + j.c + " · " + j.t);
    lines.push("");

    const meta = [placeText(j)];
    const sched = schedText(j);
    if (sched) meta.push(sched);
    meta.push(salaryText(j));
    lines.push(meta.join("｜"));

    lines.push("");
    lines.push("为什么推这个：" + whyLine(sc));
    lines.push("");

    const evTop = (ev || []).slice(0, 2);
    for (const e of evTop) {
      lines.push("· JD：" + clamp(e.jd, 34));
      lines.push("  你：　" + clamp(e.res, 34));
    }

    const warn = [];
    const eduWarn = eduNote(j, res);
    if (eduWarn) warn.push(eduWarn);
    if (sc.caveats && sc.caveats.length) warn.push(sc.caveats[0]);
    if (warn.length) {
      lines.push("");
      lines.push("先说清楚：" + warn.join("；"));
    }

    lines.push("");
    lines.push("回复「1」或「跟」，我把你简历按这个岗改好发你。");
    return cut(lines).join("\n");
  }

  /** What changed in the rewrite, for the operator to send alongside the file. */
  function changesText(rw) {
    const lines = ["【简历改了什么】"];
    for (const c of rw.changes) lines.push("· " + c.k + "：" + c.v);
    return cut(lines).join("\n");
  }

  /** The rewritten resume itself, as plain text ready to paste into a doc. */
  function resumeText(rw) {
    return rw.text;
  }

  function clamp(s, n) {
    s = String(s || "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  // WeChat shows ~18-20 lines above the fold on a normal phone. Trim the tail
  // rather than let the send button hide the ask.
  function cut(lines) {
    if (lines.length <= MAX_LINES) return lines;
    return lines.slice(0, MAX_LINES);
  }

  root.JDMessage = { recommend, changesText, resumeText, salaryText, schedText, whyLine };
})(window);
