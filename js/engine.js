// Matching engine. Runs entirely in the browser: no network, no LLM call,
// so a match + rewrite lands in well under a second and resumes never leave the machine.
(function (root) {
  const { LEX, CAT_W, BY_ID, PARENT, CAT, LABEL, scan } = root.JDLex;

  const ROLE_IDS = new Set(LEX.filter((r) => r[2] === "role").map((r) => r[0]));
  const isRole = (id) => ROLE_IDS.has(id);

  // ---------- text utilities ----------
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/　/g, " ")
      .replace(/[​-‏﻿]/g, "");

  // Returns clauses with their character offsets in the original JD, so the
  // whole JD can be scanned once and its matches bucketed per clause. Scanning
  // each clause separately was ~80% of total index time.
  const SENT_END = /[。；;!?！？]/;
  const NUM_HEAD = /[0-9]/;

  function splitClauses(jd) {
    const src = String(jd || "");
    const out = [];
    const push = (s, e) => {
      const raw = src.slice(s, e);
      const t = raw.replace(/\s+/g, " ").trim();
      if (t.length < 6) return;
      const lead = raw.length - raw.replace(/^\s+/, "").length;
      out.push({ text: t, s: s + lead, e });
    };
    let start = 0;
    for (let p = 0; p < src.length; p++) {
      const ch = src[p];
      if (ch === "\n") {
        push(start, p);
        start = p + 1;
        continue;
      }
      if (SENT_END.test(ch)) {
        push(start, p + 1);
        start = p + 1;
        continue;
      }
      // inline numbering: "…交付1.负责xx" → cut before "1."
      if (NUM_HEAD.test(ch) && p > start) {
        let q = p;
        while (q < src.length && NUM_HEAD.test(src[q])) q++;
        if (q < src.length && /[.、)）]/.test(src[q])) {
          push(start, p);
          start = p;
        }
      }
    }
    if (start < src.length) push(start, src.length);
    return out;
  }

  function clauseKind(t) {
    if (/要求|任职|资格|加分|优先|必须|需具备|希望你/.test(t)) return "req";
    if (/职责|工作内容|你将|负责|参与|协助|岗位描述/.test(t)) return "duty";
    return "other";
  }

  function vec(text, opts) {
    const m = scan(text, opts || { hits: false });
    const out = new Map();
    for (const [id, rec] of m) out.set(id, rec.count / (rec.count + 1.6));
    return out;
  }

  // ---------- resume parsing ----------
  const SECTION_KEYS = [
    ["intent", /^(求职意向|意向岗位|期望职位|求职目标)/],
    ["edu", /^(教育背景|教育经历|学历背景|教育)/],
    ["exp", /^(实习经历|工作经历|实习经验|工作实习经历|实践经历|职业经历)/],
    ["proj", /^(项目经历|项目经验|科研经历|作品|项目)/],
    ["skill", /^(专业技能|技能|技能证书|技术栈|专业能力|技能特长)/],
    ["award", /^(奖项|荣誉|获奖|奖学金|证书)/],
    ["summary", /^(个人优势|自我评价|自我介绍|个人总结|个人简介|关于我)/],
    ["campus", /^(校园经历|校园活动|社团|学生工作|社会实践|志愿)/],
  ];

  function sections(text) {
    const lines = String(text).split(/\r?\n/);
    const out = { head: [] };
    let cur = "head";
    for (const line of lines) {
      const t = line.trim().replace(/[【】\[\]：:]/g, "");
      let matched = null;
      if (t.length <= 14) {
        for (const [k, re] of SECTION_KEYS) {
          if (re.test(t)) { matched = k; break; }
        }
      }
      if (matched) {
        cur = matched;
        if (!out[cur]) out[cur] = [];
        // "求职意向：产品经理实习生" is a heading *and* its only content —
        // dropping the remainder loses the single strongest signal in the file.
        const rest = line.trim().replace(/^[【\[]?\s*(求职意向|意向岗位|期望职位|求职目标|个人优势|自我评价|自我介绍|个人总结|个人简介|关于我)\s*[】\]]?\s*[：:]?\s*/, "");
        if (rest && rest !== line.trim()) out[cur].push(rest);
        continue;
      }
      (out[cur] = out[cur] || []).push(line);
    }
    return out;
  }

  // Lines that are really section headers ("杭州某公司 产品实习生 2025.07-2025.09")
  // or bare metadata. They carry no evidence and must never be quoted as an achievement.
  const HEADER_RE = /(19|20)\d{2}\s*[.\-/年]\s*\d{1,2}\s*[.\-/月]?\s*[-~至]\s*((19|20)\d{2}|至今|今)/;
  const BARE_META_RE = /^(姓名|电话|手机|邮箱|联系方式|学校|专业|学历|毕业|政治面貌|籍贯)\s*[:：]?/;

  function isHeaderLine(line) {
    const t = String(line).trim();
    if (!t) return true;
    if (HEADER_RE.test(t) && t.length < 46) return true;
    if (BARE_META_RE.test(t)) return true;
    if (/^[^\s]{2,4}$/.test(t)) return true; // bare name
    return false;
  }

  function bullets(sec) {
    const out = [];
    for (const raw of sec || []) {
      const line = String(raw).replace(/^[\s•·▪◦●○*\-–—>]+/, "").trim();
      if (line.length < 8) continue;
      if (isHeaderLine(line)) continue;
      // split inline numbering "1. xxx 2. yyy"
      const parts = line.split(/(?<=[。；;])\s*(?=\d+[.、)）])/);
      for (const p of parts) {
        const q = p.replace(/^\d+[.、)）]\s*/, "").trim();
        if (q.length >= 8 && !isHeaderLine(q)) out.push(q);
      }
    }
    return out;
  }

  function parseResume(text) {
    const sec = sections(text);
    const flat = norm(text);
    const info = {
      name: (String(text).split(/\r?\n/).find((l) => /^[一-龥]{2,4}$/.test(l.trim())) || "").trim(),
      degree: null,
      gradYear: null,
      days: null,
      months: null,
      city: null,
      phone: (flat.match(/1[3-9]\d{9}/) || [""])[0],
      email: (flat.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [""])[0],
    };
    const degOrder = ["博士", "硕士", "研究生", "本科", "大专", "专科"];
    for (const d of degOrder) {
      if (flat.includes(d.toLowerCase())) {
        info.degree = d === "研究生" ? "硕士" : d === "专科" ? "大专" : d;
        break;
      }
    }
    let m = flat.match(/(20\d{2})\s*届/);
    if (m) info.gradYear = +m[1];
    if (!info.gradYear) {
      m = flat.match(/(20\d{2})\s*[年.\-/]\s*(?:6|7)\s*月?\s*(?:毕业|毕业时间)/);
      if (m) info.gradYear = +m[1];
    }
    m = flat.match(/每周\s*(?:可|能)?\s*(?:到岗|出勤|实习)?\s*([1-7])\s*天/);
    if (m) info.days = +m[1];
    m = flat.match(/(?:可|能)?\s*(?:实习|连续实习)\s*([1-9]|1[0-2])\s*个?月/);
    if (m) info.months = +m[1];
    m = flat.match(/(杭州|上海|北京|深圳|广州)/);
    if (m) info.city = m[1];

    const bulletList = [];
    for (const k of ["exp", "proj", "campus", "award"]) {
      for (const b of bullets(sec[k])) bulletList.push({ sec: k, text: b });
    }
    const allBullets = bulletList.concat(bullets(sec.summary).map((t) => ({ sec: "summary", text: t })));

    const rv = vec(text);
    for (const b of allBullets) {
      b.vec = vec(b.text);
      b.score = 0;
    }
    return {
      raw: text, sec, info, bullets: allBullets, vec: rv,
      roleVec: roleIntentVec(sec, text),
      hasSections: Object.keys(sec).length > 2,
    };
  }

  // Which job family is this person actually applying for?
  // The whole-resume concept vector cannot answer that: a designer who ran
  // "8 人用户测试" looks like a tester, and an analyst who "配合运营" looks like
  // an operator. Intent is read only from places where the candidate states it
  // on purpose — the stated objective and the titles of their roles.
  function roleIntentVec(sec, text) {
    const out = new Map();
    // Presence, not frequency: a candidate who writes "UI 设计实习生" once has
    // stated the family as clearly as one who writes it five times.
    const add = (t, w) => {
      if (!t) return;
      for (const id of scan(t, { hits: false }).keys()) {
        if (!isRole(id)) continue;
        out.set(id, Math.max(out.get(id) || 0, w));
      }
    };
    // 1) stated objective — the strongest signal there is
    for (const line of sec.intent || []) add(line, 1.0);
    // 2) role titles: "杭州某公司 UI 设计实习生 2025.07-2025.10", "XX社团 产品组负责人"
    for (const k of ["exp", "proj", "campus"]) {
      for (const line of sec[k] || []) {
        const t = String(line).trim();
        if (!t || t.length > 60) continue;
        // a title line is short, has no sentence break, and often carries dates
        if (/[，。；,;]/.test(t) && !HEADER_RE.test(t)) continue;
        add(t, 0.85);
      }
    }
    // 3) fallback: no sections and no objective (pasted plain-text resume)
    if (!out.size) add(text.slice(0, 400), 0.9);
    return out;
  }

  // ---------- job indexing ----------
  function indexJob(job) {
    const titleVec = vec(job.t + " " + (job.dist || ""));
    // One scan of the whole JD, then bucket each match into the clause that
    // contains it. Equivalent to scanning clause-by-clause because clauses are
    // non-overlapping slices — and roughly 5x faster across 330 jobs.
    const parts = splitClauses(job.jd);
    const spans = scan(job.jd, { spans: true });
    const clauses = [];
    if (parts.length) {
      // spans are ordered by offset; walk them alongside the clause list
      let k = 0;
      for (const p of parts) {
        const counts = new Map();
        while (k < spans.length && spans[k].s < p.s) k++;
        let q = k;
        while (q < spans.length && spans[q].s < p.e) {
          const sp = spans[q];
          if (sp.e <= p.e) counts.set(sp.id, (counts.get(sp.id) || 0) + 1);
          q++;
        }
        if (!counts.size) continue;
        const v = new Map();
        for (const [id, c] of counts) v.set(id, Math.min(1, c / (c + 1.1)));
        const kind = clauseKind(p.text);
        clauses.push({ text: p.text, vec: v, kind, w: kind === "req" ? 1.25 : kind === "duty" ? 1.1 : 0.7 });
      }
    }
    // Reuse the spans already collected instead of scanning the JD a second time.
    const jdCount = new Map();
    for (const sp of spans) jdCount.set(sp.id, (jdCount.get(sp.id) || 0) + 1);
    const jdVec = new Map();
    for (const [id, c] of jdCount) jdVec.set(id, c / (c + 1.6));
    // The title is the employer's own summary of the role; give it the same
    // weight it has in the JD body even when the phrasing is unusual
    // ("直播实习生" names no lexicon alias directly).
    for (const [id, w] of titleVec) if (isRole(id)) jdVec.set(id, Math.max(jdVec.get(id) || 0, 0.8));

    // The most specific role named in the title wins: "游戏 UI 设计" is a design
    // job, not a game job, because "游戏ui设计" is the longer alias.
    let titleRole = null;
    let bestLen = 0;
    const flatTitle = job.t.toLowerCase().replace(/\s+/g, "");
    for (const id of titleVec.keys()) {
      if (!isRole(id)) continue;
      if (!titleRole) titleRole = id;
      const row = BY_ID.get(id);
      for (const a of [row[1], ...row[3]]) {
        const na = a.toLowerCase().replace(/\s+/g, "");
        if (na && flatTitle.includes(na) && na.length > bestLen) {
          bestLen = na.length;
          titleRole = id;
        }
      }
    }
    return Object.assign(job, { _clauses: clauses, _jdVec: jdVec, _titleVec: titleVec, _titleRole: titleRole });
  }

  // ---------- scoring ----------
  function overlapWeight(id, res) {
    if (res.has(id)) return res.get(id);
    const p = PARENT.get(id);
    if (p && res.has(p)) return 0.45 * res.get(p);
    // children give partial credit upward (resume says "电商运营", JD says "亚马逊运营")
    return 0;
  }

  // Role alignment: how much of the job's role demand the resume actually covers.
  // This is scored separately from clause coverage because role family is the
  // single thing a recruiter judges first, and it keeps scores from bunching.
  //
  // Credit is split by *where* the role appears in the resume. A role named in
  // the candidate's stated objective is proof; the same word appearing somewhere
  // in a bullet is only a hint. Using one flat vector is what let a UI designer
  // rank for a Java role ("配合开发") and an analyst rank for QA ("A/B 测试").
  function roleCredit(res, id) {
    const direct = res.roleVec.get(id) || 0;
    const anyMention = res.vec.get(id) || 0;
    const p = PARENT.get(id);
    const parentIntent = p ? (res.roleVec.get(p) || 0) : 0;
    const childIntent = [...res.roleVec.keys()].some((rid) => PARENT.get(rid) === id) ? 0.5 : 0;
    const anyChild = [...res.vec.keys()].some((rid) => PARENT.get(rid) === id) ? 0.2 : 0;
    const pAny = p ? (res.vec.get(p) || 0) : 0;
    return Math.max(
      direct * 1.0,
      parentIntent * 0.6,
      childIntent * 0.55,
      anyMention * 0.45,
      pAny * 0.3,
      anyChild
    );
  }

  function roleAlignment(res, job) {
    const roleIds = new Set();
    for (const id of job._titleVec.keys()) if (isRole(id)) roleIds.add(id);
    for (const [id, w] of job._jdVec) if (isRole(id) && w > 0.25) roleIds.add(id);
    // A job that never names a role is not a proven match for anyone. Scoring it
    // at a neutral 0.55 let vague postings ("开发实习生(侧重.net开发)") outrank
    // real ones purely on incidental skill overlap, so unknown families sit lower.
    if (!roleIds.size) {
      return { r: 0.35, matched: null, missed: null, titleFit: null, titleRoles: [] };
    }

    let num = 0, den = 0;
    let best = null, worst = null;
    for (const id of roleIds) {
      // title roles matter far more than a role word buried in the JD body
      const w = job._titleVec.has(id) ? 3 : 1;
      den += w;
      const got = roleCredit(res, id);
      num += w * got;
      if (job._titleVec.has(id)) {
        if (got >= 0.5) { if (!best) best = id; } else if (!worst) worst = id;
      }
    }

    // A job whose title names a role this candidate never claims is not a match,
    // no matter how many skills overlap. Without this, "Java 实习生" scored well
    // for a designer because both mentioned collaborative tooling.
    const titleRoles = [...job._titleVec.keys()].filter(isRole);
    let offTarget = 0;
    if (titleRoles.length) {
      offTarget = Math.max(...titleRoles.map((id) => roleCredit(res, id)));
    } else if (res.roleVec.size) {
      // untitled/unclear job: fall back to judging by the JD's main roles
      const jdRoles = [...job._jdVec.keys()].filter((id) => isRole(id) && job._jdVec.get(id) > 0.4);
      offTarget = jdRoles.length ? Math.max(...jdRoles.map((id) => roleCredit(res, id))) : 0.5;
    }

    return { r: den ? num / den : 0.5, matched: best, missed: worst, titleFit: offTarget, titleRoles };
  }

  function scoreJob(res, job) {
    let num = 0, den = 0;
    const hits = [];
    for (const cl of job._clauses) {
      let cw = 0, got = 0;
      for (const [id, w] of cl.vec) {
        const W = CAT_W[CAT.get(id)] || 1;
        cw += W * w;
        const o = overlapWeight(id, res.vec);
        if (o > 0) {
          got += W * w * Math.min(1, o + 0.25);
          hits.push({ id, cl, w: W * w * o });
        }
      }
      if (cw <= 0) continue;
      const cov = Math.min(1, got / cw);
      num += cl.w * cov;
      den += cl.w;
    }
    const coverage = den > 0 ? num / den : 0;

    const ra = roleAlignment(res, job);
    // role family decides more than depth of overlap
    let fit = 0.55 * coverage + 0.45 * ra.r;

    // Hard gate on the job's title role. A candidate with a stated direction
    // should never be handed an opening in a different family just because the
    // words overlap; the gate is a steep curve rather than a cliff so that a
    // genuinely adjacent role still surfaces as a stretch option.
    if (res.roleVec.size && ra.titleRoles.length) {
      const t = ra.titleFit;
      fit *= 0.25 + 0.75 * Math.pow(t, 0.7);
    }

    // eligibility adjustments (soft: surfaced as caveats, never silently dropped)
    const caveats = [];
    if (job.edu === "硕士" && res.info.degree && res.info.degree !== "硕士" && res.info.degree !== "博士") {
      fit *= 0.84; caveats.push("岗位写硕士优先，你是" + res.info.degree);
    }
    if (job.edu === "本科" && res.info.degree === "大专") {
      fit *= 0.86; caveats.push("岗位要求本科，你是大专");
    }
    if (res.info.days && job.days && res.info.days < job.days) {
      fit *= 0.9; caveats.push("岗位要每周 " + job.days + " 天，你简历写 " + res.info.days + " 天");
    }
    if (res.info.months && job.months && res.info.months < job.months) {
      fit *= 0.95; caveats.push("岗位要做 " + job.months + " 个月，你写 " + res.info.months + " 个月");
    }
    const jdY = job.jd.match(/(20\d{2})\s*届/);
    if (jdY && res.info.gradYear) {
      const need = +jdY[1];
      if (res.info.gradYear < need) {
        fit *= 0.78; caveats.push("岗位面向 " + need + " 届，你是 " + res.info.gradYear + " 届");
      }
    }
    if (job.act >= 2) fit *= 1.02; // active recruiter: small nudge toward reachable openings

    return { job, fit: Math.min(fit, 0.99), coverage, roleAlign: ra, hits, caveats };
  }

  // ---------- explain ----------
  function cleanClause(t) {
    return t
      .replace(/^\d+[.、)）]\s*/, "")
      // scraping leaves the next section's heading glued to the end of a clause
      .replace(/(职位要求|岗位要求|任职要求|岗位职责|工作内容|职位描述)\s*[:：]?\s*$/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function resumeQuoteFor(res, id, used) {
    const row = BY_ID.get(id);
    if (!row) return null;
    // Only real achievement bullets count as evidence. Falling back to a raw text
    // search would quote header lines like "求职意向：产品经理实习生", which reads
    // as proof to a matcher but as nothing to a recruiter.
    const cand = res.bullets
      .map((b) => ({
        b,
        hit: b.vec.has(id) ? 1 : PARENT.get(id) && b.vec.has(PARENT.get(id)) ? 0.5 : 0,
      }))
      .filter((x) => x.hit > 0 && x.b.text.length >= 12)
      .sort((a, b) => b.hit - a.hit || b.b.text.length - a.b.text.length);
    if (!cand.length) return null;
    // Three evidence rows quoting the same bullet reads like one achievement
    // padded into three; prefer a fresh bullet when the resume offers one.
    const pick = (used && cand.find((c) => !used.has(c.b.text))) || cand[0];
    if (used) used.add(pick.b.text);
    let t = pick.b.text.replace(/\s+/g, " ").trim();
    if (t.length > 62) {
      const cut = t.slice(0, 62);
      const lastP = Math.max(cut.lastIndexOf("，"), cut.lastIndexOf("。"), cut.lastIndexOf("；"));
      t = (lastP > 24 ? cut.slice(0, lastP) : cut) + "…";
    }
    return t;
  }

  // A JD line that is really compensation, headcount or location boilerplate.
  // Quoting it as a requirement makes the whole match look machine-generated.
  const BOILERPLATE_RE = /(日薪|时薪|薪资|工资|待遇|福利|补贴|转正|编制|招\s*\d+\s*人|急招|简历投递|工作地点|办公地址|地铁|简历请|联系方式)/;

  function isBoilerplate(t) {
    const s = String(t);
    if (BOILERPLATE_RE.test(s)) return true;
    // "岗位日薪:150-200区间,奖金另算;" — mostly digits and pay words
    const digits = (s.match(/\d/g) || []).length;
    return digits > s.length * 0.3;
  }

  function explain(res, sc, limit) {
    const ranked = [];
    const seenClause = new Set();
    const usedQuotes = new Set();
    for (const h of sc.hits) {
      if (seenClause.has(h.cl.text)) continue;
      if (h.id.startsWith("s_")) continue; // soft traits are not persuasive evidence
      if (isBoilerplate(h.cl.text)) continue;
      const q = resumeQuoteFor(res, h.id);
      if (!q) continue;
      seenClause.add(h.cl.text);
      const spec = 1 / Math.sqrt(h.cl.vec.size || 1); // narrower clause = more specific
      ranked.push({
        concept: h.id,
        label: LABEL.get(h.id),
        jd: cleanClause(h.cl.text),
        res: q,
        kind: h.cl.kind,
        score: h.w * (0.6 + 0.8 * spec) * (h.cl.kind === "duty" ? 1.15 : 1),
        role: isRole(h.id),
      });
    }
    // One row per concept AND one row per resume bullet. Three rows quoting the
    // same line look like padding to a reader even when they cite three different
    // JD requirements.
    ranked.sort((a, b) => b.score - a.score);
    const out = [];
    const usedConcepts = new Set();
    for (const r of ranked) {
      if (usedConcepts.has(r.concept)) continue;
      if (usedQuotes.has(r.res)) {
        const alt = ranked.find((x) => !usedConcepts.has(x.concept) && !usedQuotes.has(x.res));
        if (!alt) break;
        usedConcepts.add(alt.concept);
        usedQuotes.add(alt.res);
        out.push(alt);
      } else {
        usedConcepts.add(r.concept);
        usedQuotes.add(r.res);
        out.push(r);
      }
      if (out.length >= (limit || 3)) break;
    }
    out.sort((a, b) => b.score - a.score);
    // Requirements the JD leans on but the resume never answers. These are the
    // honest counterweight to the evidence list.
    const missing = [];
    const jdVec = (sc.job && sc.job._jdVec) || new Map();
    for (const [id, w] of jdVec) {
      if (w < 0.5) continue;
      if (CAT.get(id) !== "skill" && CAT.get(id) !== "method") continue;
      if (res.vec.has(id)) continue;
      missing.push(LABEL.get(id));
    }
    out.missing = missing.slice(0, 3);
    return out;
  }

  function topRole(res) {
    const rows = [];
    for (const [id, w] of res.vec) {
      if (!isRole(id)) continue;
      rows.push({ id, w: w * (CAT_W.role || 3) });
    }
    rows.sort((a, b) => b.w - a.w);
    return rows;
  }

  // ---------- resume rewriting ----------
  // Rewriting only reorders, tightens and re-fronts what the resume already says.
  // It must never invent a verb the candidate did not claim ("主导", "从 0 到 1"
  // are exactly the words an interviewer will probe), so verbs are only *removed*
  // when they are filler, never added.
  //
  // "负责" is the one honest removal: it carries no information at all.
  // "参与 / 协助 / 配合" stay, for two reasons. Dropping them silently upgrades a
  // supporting role to a leading one — the exact inflation this tool refuses to
  // do — and they often govern the sentence ("配合商务完成 KOL 对接" loses its
  // subject if you cut the verb).
  const FILLER_VERB_RE = /^(主要负责|负责)\s*/;

  function polishBullet(text) {
    let t = text.replace(/\s+/g, " ").trim();
    t = t.replace(/^(本人|我)\s*/, "");
    t = t.replace(/^(在|于)?[^，,。]{0,14}?(实习|工作)(期间|中)[，,]?\s*/, "");
    t = t.replace(FILLER_VERB_RE, "");
    t = t.replace(/^[，,、:：\s]+/, "");
    if (!t) return "";
    t = t.replace(/[。；;]+$/, "");
    if (t.length > 88) {
      const cut = t.slice(0, 88);
      const p = Math.max(cut.lastIndexOf("，"), cut.lastIndexOf("、"));
      t = (p > 40 ? cut.slice(0, p) : cut) + "。";
    } else {
      t += "。";
    }
    // capitalise nothing; sentence starts with the action verb the candidate already used
    return t;
  }

  function rewrite(res, job, ev, opts) {
    opts = opts || {};
    const role = job._titleRole || (topRole(res)[0] || {}).id;
    const roleLabel = LABEL.get(role) || job.t;
    const evIds = new Set(ev.map((e) => e.concept));

    // 1) pick and order experience bullets by relevance to this JD
    const scored = res.bullets
      .filter((b) => b.sec === "exp" || b.sec === "proj" || b.sec === "campus")
      .map((b) => {
        let s = 0;
        for (const [id, w] of b.vec) {
          if (job._jdVec.has(id)) s += w * (CAT_W[CAT.get(id)] || 1) * Math.min(1, job._jdVec.get(id) + 0.3);
        }
        return { b, s };
      })
      .sort((a, b) => b.s - a.s);

    const keep = scored.slice(0, opts.maxBullets || 6);
    const dropped = scored.slice(keep.length);

    // 2) targeted summary: the candidate's own strongest facts, reordered to the
    // front where a recruiter reads first. No new claims are introduced.
    const summary = [];
    const seenSummary = new Set();
    for (const e of ev) {
      let s = e.res.replace(/[。；;]+$/, "").replace(/…$/, "").trim();
      if (s.length < 10) continue;
      // the same bullet can answer several JD requirements; say it once
      const key = s.slice(0, 18);
      if (seenSummary.has(key)) continue;
      seenSummary.add(key);
      summary.push(s + "。");
      if (summary.length >= 3) break;
    }
    if (!summary.length) {
      summary.push("有" + (roleLabel || job.t) + "相关的实习与项目积累，可快速上手岗位职责。");
    }

    // 3) assemble
    const lines = [];
    const info = res.info;
    lines.push("求职意向：" + job.c + " · " + job.t);
    if (info.name) lines.push("姓名：" + info.name + (info.phone ? "｜" + info.phone : "") + (info.email ? "｜" + info.email : ""));
    lines.push("");
    lines.push("【个人优势】");
    summary.forEach((s, i) => lines.push((i + 1) + ". " + s));

    const eduLines = (res.sec.edu || []).map((l) => l.trim()).filter((l) => l);
    if (eduLines.length) {
      lines.push("");
      lines.push("【教育背景】");
      eduLines.slice(0, 4).forEach((l) => lines.push(l));
    }

    lines.push("");
    lines.push("【相关经历】");
    const kept = keep.map((k) => polishBullet(k.b.text)).filter(Boolean);
    if (kept.length) {
      for (const t of kept) lines.push("· " + t);
    } else {
      const fallback = res.raw.split(/\r?\n/).filter((l) => l.trim().length > 20 && !isHeaderLine(l))[0] || "";
      const t = polishBullet(fallback);
      if (t) lines.push("· " + t);
    }

    const skillLines = (res.sec.skill || []).map((l) => l.trim()).filter((l) => l.length > 1);
    if (skillLines.length) {
      lines.push("");
      lines.push("【技能证书】");
      skillLines.slice(0, 5).forEach((l) => lines.push(l));
    }
    const award = (res.sec.award || []).map((l) => l.trim()).filter((l) => l.length > 1);
    if (award.length) {
      lines.push("");
      lines.push("【荣誉奖项】");
      award.slice(0, 3).forEach((l) => lines.push(l));
    }

    // 4) what the JD asks for that the resume does not show. Surfaced rather than
    // papered over: telling a candidate to fix a real gap is worth more than a
    // tidy-looking rewrite that gets them screened out.
    const missingTop = ev.missing || [];

    // 5) change log — what actually changed, phrased so it can be pasted to a candidate
    const changes = [];
    changes.push({
      k: "顶部加了求职意向",
      v: "直接写「" + job.c + " · " + job.t + "」。原来 HR 要读完才知道你投什么，现在第一行就对上。",
    });
    if (ev.length) {
      changes.push({
        k: "个人优势重排",
        v: "把简历里已有的「" + ev.slice(0, 3).map((e) => e.label).join("」「") + "」提到最前，跟 JD 的要求一一对应。没有新增你没有的经历。",
      });
    }
    if (kept.length > 1) {
      changes.push({
        k: "经历按对口度重排",
        v: "最相关的 " + kept.length + " 条放前面" + (dropped.length ? "，其余 " + dropped.length + " 条压后" : "") + "。HR 前 10 秒看到的就是对口的。",
      });
    }
    changes.push({
      k: "空转的「负责」删了",
      v: "每条开头直接是你做的事。「参与」「协助」这些保留着——删了就等于把你的角色抬高了，面试一问就露。",
    });
    if (missingTop.length) {
      changes.push({
        k: "这几项还没写（建议你自己补）",
        v: "JD 提到但简历里没体现：" + missingTop.join("、") + "。有相关经历就补一句，没有就别硬写。",
      });
    }

    return { text: lines.join("\n"), changes, missing: missingTop, summary, keptCount: kept.length, droppedCount: dropped.length };
  }

  function trimTo(s, n) {
    s = String(s).replace(/\s+/g, "").replace(/[。；;，,]$/, "");
    return s.length > n ? s.slice(0, n) : s;
  }

  // ---------- public ----------
  root.JDEngine = {
    parseResume, indexJob, scoreJob, explain, rewrite, vec, topRole,
    isRole, LABEL, BY_ID, CAT, trimTo,
  };
})(window);
