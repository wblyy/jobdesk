// Plain-text message builders for pasting into 企业微信 / 微信.
// P7 的约束：纯文本、一屏内、事实闭合在简历里、公司名与时间照抄、不出现概率措辞、
// 并且**这段话不能原样发给另一个岗位**。最后一条是最容易被忽略的：一句
// 「JD 要的『设计/剪辑软件』你简历里都有实例」对同公司的任何一个设计岗都成立，
// 候选人收到两次就知道你在群发。
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

  /** District only — a mall address is not what decides a candidate's yes. */
  function placeText(job) {
    if (job.dist) return "杭州" + job.dist;
    // 没有区的时候，"杭州·尊宝大厦·金尊市民街98号" 按路名切会切出
    // 「杭州·尊宝大厦·金尊市民」——一个不存在的地名。宁可不写。
    if (job.loc) {
      const m = String(job.loc).match(/杭州[·\s]*([^\s·路街号]{2,4}区)/);
      if (m) return "杭州" + m[1];
    }
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
    return "";
  }

  // 职责句用来说"这个岗到底让你干什么"。它必须来自这条 JD 自己的正文，
  // 不能是角色名——角色名是岗位标题的复述，对同族岗位一模一样。
  function dutyQuote(sc, n) {
    const E = root.JDEngine;
    const limit = n || 26;
    const rows = (sc.duties || []).filter((d) => d.text && d.text.length >= 8);
    if (!rows.length) return "";
    // 优先挑真正被命中的那条：它既是"岗位要什么"，也是"你对得上什么"。
    const hit = rows.find((d) => d.state === "HIT") || rows[0];
    // 抓下来的 JD 里每条职责都带「1、2、」编号。引到话术里就是原文截图味，
    // 候选人一眼看出是把 JD 剪切过来的。
    let t = E.cleanClause(hit.text).replace(/^\d+\s*[.、)）]\s*/, "");
    // 引文要在句读处收尾。硬截到 26 字会留下「(需求分」或「包括：短视频选题策划、脚」，
    // 读起来像程序出错，不像人在说话。断句规则和简历改写里用的是同一套。
    return E.clipQuote(t, limit);
  }

  // 收尾一律走引擎里的同一套规则：补全括号 → 找最近的断点 → 退到英文词首。
  // 话术和简历改稿用的是同一个函数，两处不会对同一条 JD 切出两种样子。
  // 话术一行只有 30 字左右的余量，所以最多只许多走 2 个字；简历改稿里
  // 是多走 6 个字的（那里一行没人量）。
  function quote(t, limit) {
    return root.JDEngine.clipQuote(t, limit, 2);
  }

  // 按句号/分号切，再把过长的句子在逗号处劈开。首行要给「为什么推这个：」留位，
  // 否则第一行永远比后面几行长一截，在手机上先折行。
  function splitSent(t, n, firstN) {
    const out = [];
    let cur = "";
    const budget = () => (out.length ? n : (firstN || n));
    for (const seg of String(t).split(/(?<=[。；])/)) {
      if (!seg) continue;
      if (cur && cur.length + seg.length > budget()) { out.push(cur); cur = ""; }
      if (seg.length > budget() * 1.6) {
        const inner = seg.replace(/[。；]$/, "").split("，");
        let acc = "";
        for (const piece of inner) {
          if (acc && (acc + "，" + piece).length > budget()) { out.push(acc + "，"); acc = piece; }
          else acc = acc ? acc + "，" + piece : piece;
        }
        if (acc) { if (cur) { out.push(cur); cur = ""; } out.push(acc); }
        continue;
      }
      cur = cur ? cur + seg : seg;
    }
    if (cur) out.push(cur);
    return out;
  }

  function whyLine(sc, ev) {
    const E = root.JDEngine;
    const duty = dutyQuote(sc, 18);
    const top = (ev || [])[0];
    // 有具体职责 + 有具体经历 → 两边各说一半，这句话换到别的岗位就说不通。
    // 「这岗要什么」+「你哪条对得上」，两边都必须是这条 JD / 这份简历独有的内容。
    // 少了任意一半，这句话就能原样发给同族的下一个岗位。
    if (duty && top) {
      return "岗要「" + duty + "」。你「" + summarize(top.res, 16) + "」正好接得上。";
    }
    if (duty) {
      return "岗要「" + duty + "」。方向上和你的求职意向一致。";
    }
    const role = (sc.roleAlign && sc.roleAlign.titleRoles || [])[0];
    const roleName = role ? E.LABEL.get(role) : "";
    if (roleName) {
      return "它是「" + roleName + "」方向的岗，跟你写明的求职方向一致。JD 里没有能直接对上的一句，推的时候别把话说满。";
    }
    return "岗位方向和你的经历基本对得上，但 JD 写得比较空，具体做什么要问清楚。";
  }

  /** 诚实缺口：只挑真正影响决定的，别把三条 caveat 全倒出来。 */
  function gapText(sc, res) {
    const gaps = (sc.gaps || []).filter((g) => g.text);
    const edu = eduNote(sc.job, res);
    if (!gaps.length && !edu) return "";
    const out = [];
    if (edu) out.push(edu);
    for (const g of gaps) {
      if (out.length >= 2) break;
      // 学历缺口在 caveats 里已经说过一次了，这里不重复第二遍——
      // 「学历要硕士，你是本科；学历要求：硕士（你是 本科）」是最刺眼的那种重复。
      if (/学历|大专|本科|硕士/.test(g.text) && edu) continue;
      if (out.some((x) => x.slice(0, 8) === g.text.slice(0, 8))) continue;
      out.push(g.text);
    }
    return out.join("；");
  }

  /** The daily one-job push. Must fit one screen and must not fit another job. */
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
    // 拆成两行，每行控制在 20 个汉字左右。企微一屏约 18-20 行，一段 67 字的
    // 长句会折成四行，把最后的「回复 1」挤出屏幕。
    const why = whyLine(sc, ev);
    const parts = splitSent(why, 24, 18);
    lines.push("为什么推这个：" + parts[0]);
    for (let i = 1; i < parts.length; i++) lines.push("　" + parts[i]);
    lines.push("");

    const evTop = (ev || []).slice(0, 2);
    for (const e of evTop) {
      // 每行控制在 30 字内：企微气泡在 390px 宽的手机上约容纳 16 个汉字，
      // 超过就折行，两条证据一共四行，正好把"为什么是它"和"回复1"隔开。
      lines.push("· JD：" + quote(e.jd, 26));
      lines.push("  你：　" + quote(e.res, 26));
    }
    if (!evTop.length) {
      lines.push("· 这条 JD 里没有一句能直接对上你简历的，");
      lines.push("  只能算方向对。");
    }

    const gap = gapText(sc, res);
    if (gap) {
      lines.push("");
      lines.push("先说清楚：" + gap);
    }

    lines.push("");
    lines.push("回复「1」或「跟」，我把你简历按这个岗改好发你。");
    return cut(lines).join("\n");
  }

  /** What changed in the rewrite, for the operator to send alongside the file. */
  function changesText(rw) {
    const lines = ["【简历改了什么】"];
    for (const c of rw.changes) lines.push("· " + c.k + "：" + c.v);
    if (rw.verify) {
      // 校验结果是给运营看的，不发给候选人：候选人不需要知道工具有没有通过自检。
      const v = rw.verify;
      lines.push("");
      lines.push("自检：" + (v.verdict === "PASS" ? "通过。公司名、时间、数字、每条原经历都对得上。" : v.verdict === "PASS_WITH_NOTES" ? "通过，有几条被压缩过，已在上面说明。" : "没过，下面这些要你自己看一眼。"));
      for (const b of (v.blocked || []).slice(0, 4)) lines.push("  - " + b);
    }
    return cut(lines, 24).join("\n");
  }

  /** The rewritten resume itself, as plain text ready to paste into a doc. */
  function resumeText(rw) {
    return rw.text;
  }

  // 用候选人自己那条经历做引子，而不是用一个概念标签——标签换到同族岗位
  // 一个字都不用改，经历不行。
  function summarize(s, n) {
    s = String(s || "").replace(/\s+/g, " ").trim().replace(/[。；;]$/, "");
    return quote(s, n);
  }

  function clamp(s, n) {
    s = String(s || "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  // WeChat shows ~18-20 lines above the fold on a normal phone. Trim the tail
  // rather than let the send button hide the ask.
  function cut(lines, max) {
    const m = max || MAX_LINES;
    if (lines.length <= m) return lines;
    return lines.slice(0, m);
  }

  root.JDMessage = { recommend, changesText, resumeText, salaryText, schedText, whyLine };
})(window);
