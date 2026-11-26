// Matching engine. Runs entirely in the browser: no network, no LLM call,
// so a match + rewrite lands in well under a second and resumes never leave the machine.
//
// The pipeline follows 面试大师 v1.1.1, reimplemented deterministically:
//   P2  JD 拆解      — 硬门槛 / 核心职责 / 加分项，按措辞判定，不按位置
//   P3  人岗匹配      — 四维加权 → 压制规则 → 区间定分，分数可审计
//   P5  单版简历改写  — 命中句 / 优势牌 / 降维牌，公司名与起止时间只读
//   P6  只增不减校验  — 每条原 bullet 必须有归宿，数字与只读字段逐字核对
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

  // charCode membership beats a regex `.test(ch)` per character: this loop runs
  // over every character of all 330 JDs, and at that volume the regex calls
  // alone cost more than the trie scan itself.
  function isSentEnd(c) { return c === 0x3002 || c === 0x3b || c === 0x21 || c === 0x3f || c === 0xff01 || c === 0xff1f; }
  function isDigit(c) { return c >= 48 && c <= 57; }
  function isDotLike(c) { return c === 0x2e || c === 0x3001 || c === 0x29 || c === 0xff09; }

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
    const n = src.length;
    for (let p = 0; p < n; p++) {
      const c = src.charCodeAt(p);
      if (c === 10) {
        push(start, p);
        start = p + 1;
        continue;
      }
      if (isSentEnd(c)) {
        push(start, p + 1);
        start = p + 1;
        continue;
      }
      // inline numbering: "…交付1.负责xx" → cut before "1."
      if (isDigit(c) && p > start) {
        let q = p;
        while (q < n && isDigit(src.charCodeAt(q))) q++;
        if (q < n && isDotLike(src.charCodeAt(q))) {
          push(start, p);
          start = p;
        }
      }
    }
    if (start < n) push(start, n);
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
  // The tail month is part of the range: matching only "2024.10-2025" left ".06"
  // stranded in the company field and put a truncated date on the read-only line.
  const HEADER_RE = /(?:19|20)\d{2}\s*[.\-/年]\s*\d{1,2}\s*(?:[.\-/月]\s*\d{1,2}\s*[日号]?)?\s*[-~—–至]\s*(?:(?:19|20)\d{2}\s*[.\-/年]\s*\d{1,2}\s*(?:[.\-/月]\s*\d{1,2}\s*[日号]?)?|至今|今|现在)/;
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

  // "杭州某 SaaS 公司 UI 设计实习生 2025.07-2025.11" → company / title / period.
  // The header is a read-only anchor in P5 and P6: it must survive the rewrite
  // verbatim, so it is parsed once here and carried through as its own record.

  const ORG_SUFFIX = /(公司|集团|科技|网络|传媒|工作室|机构|社团|协会|学会|实验室|研究所|中心|银行|医院|学校|大学|学院|团队|工厂|门店|报社|出版社|部|署|厂|店|社)$/;
  const TITLE_ROLE = /(实习生|实习|助理|专员|工程师|设计师|组长|负责人|主管|经理|顾问|策划|运营|编辑|摄影|剪辑|教师|分析师|研究员|开发|架构师|产品|设计|测试|算法)/;

  // "杭州某教育科技公司 产品实习生" has no separator a naive splitter can
  // trust: cutting at the first space yields company "杭州某" and title
  // "教育科技公司 产品实习生", which then lands on the read-only line and gets
  // sent to a recruiter as the candidate's job title. Every candidate cut is
  // scored instead — company ends in an org marker, title opens with a role
  // word — and the winner is the one that keeps both halves whole.
  function splitOrgTitle(rest) {
    const s = String(rest);
    if (!s) return null;
    let best = null, bestScore = -99;
    for (let i = 2; i < s.length - 1; i++) {
      const aRaw = s.slice(0, i);
      const a = aRaw.trim();
      const b = s.slice(i).trim();
      if (a.length < 2 || b.length < 2) continue;
      let sc = 0;
      if (ORG_SUFFIX.test(a)) sc += 5;
      if (TITLE_ROLE.test(b.slice(0, 8))) sc += 3;
      if (a.length >= 2 && a.length <= 18) sc += 1;
      // cutting inside the word after a space splits "袋鼠云 数据产品实习生"
      // into company "袋鼠云 数" — the space is a boundary, the char after it is not
      if (/\S\s*$/.test(aRaw) && /\s/.test(aRaw) && !/\s$/.test(aRaw)) sc -= 6;
      // a title that starts with an org suffix means the company name was cut short
      if (/^(公司|集团|科技|网络|传媒|工作室|机构|有限公司)/.test(b)) sc -= 5;
      if (sc > bestScore || (sc === bestScore && best && a.length > best.company.length)) {
        bestScore = sc;
        best = { company: a, title: b };
      }
    }
    return bestScore >= 3 ? best : null;
  }

  function parseHead(line) {
    const period = (line.match(HEADER_RE) || [])[0] || "";
    let rest = String(line).replace(HEADER_RE, "")
      .replace(/[（(]\s*[)）]/g, " ")
      .replace(/\s+/g, " ").trim()
      .replace(/[|｜,，/·]+$/, "").trim();
    if (!rest) return { company: "", title: "", period };
    const chunks = rest.split(/\s{2,}|[|｜]|\s*[·—–]\s*/).map((x) => x.trim()).filter(Boolean);
    if (chunks.length >= 2) {
      return { company: chunks[0], title: chunks.slice(1).join(" "), period };
    }
    const split = splitOrgTitle(rest);
    if (split) return { company: split.company, title: split.title, period };
    return { company: rest, title: "", period };
  }

  // Experience is kept as blocks, not a flat bullet list. A bullet without its
  // company and dates is not a resume line — it is a claim with the evidence
  // stripped off, which is exactly what a recruiter distrusts.
  function buildBlocks(sec) {
    const out = [];
    for (const key of ["exp", "proj", "campus"]) {
      let cur = null;
      for (const raw of sec[key] || []) {
        const line = String(raw).trim();
        if (!line) continue;
        const isHead = HEADER_RE.test(line) && line.length < 60;
        if (isHead) {
          cur = Object.assign({ sec: key, bullets: [] }, parseHead(line));
          out.push(cur);
          continue;
        }
        const stripped = line.replace(/^[\s•·▪◦●○*\-–—>]+/, "").replace(/^\d+[.、)）]\s*/, "").trim();
        if (stripped.length < 6) continue;
        if (!cur) {
          cur = { sec: key, company: "", title: "", period: "", bullets: [] };
          out.push(cur);
        }
        // A company line without dates ("校设计协会") becomes the block title.
        if (!cur.bullets.length && !cur.company && stripped.length <= 24 && !/[。；，,]/.test(stripped)) {
          const h = parseHead(stripped);
          cur.company = h.company;
          cur.title = h.title;
          continue;
        }
        cur.bullets.push(stripped);
      }
    }
    return out.filter((b) => b.bullets.length || b.company);
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

    const blockList = buildBlocks(sec);
    const bulletList = [];
    for (const b of blockList) {
      for (const t of b.bullets) bulletList.push({ sec: b.sec, text: t, block: b });
    }
    for (const t of bullets(sec.award)) bulletList.push({ sec: "award", text: t, block: null });
    for (const t of bullets(sec.summary)) bulletList.push({ sec: "summary", text: t, block: null });

    const rv = vec(text);
    for (const b of bulletList) {
      b.vec = vec(b.text);
      b.score = 0;
    }
    return {
      raw: text, sec, info, bullets: bulletList, blocks: blockList, vec: rv,
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

  // ---------- P2 · JD 拆解 ----------
  // 硬门槛 / 加分项 by wording, not by section. A line inside 任职要求 that says
  // 「优先」 is a bonus; a line in 岗位职责 that says 「必须」 is a gate. Position
  // decides nothing on a scraped JD whose headings are half-missing.
  const HEAD_DUTY = /^(岗位职责|工作职责|职位描述|职位职责|工作内容|主要职责|职责描述|职责范围)$/;
  const HEAD_REQ = /^(岗位要求|任职要求|任职资格|职位要求|任职条件|我们希望你|希望你|你需要具备|能力要求|招聘要求)$/;
  const HEAD_BONUS = /^(加分项|加分点|优先条件|额外加分|以下条件优先)$/;
  const HEAD_NOISE = /^(公司介绍|团队介绍|福利待遇|薪资福利|关于我们|关于公司|工作地点|办公地址|联系我们|投递方式)$/;

  const HARD_STRICT = /(必须|必需|要求|需要|至少|不低于|仅限|限定|不少于|最少|一定要|须具备|须有)/;
  const NICE_STRICT = /(优先|加分|更佳|尤佳|最好|有.{0,8}经验者优先|熟悉.{0,10}者优先)/;
  // "责任心 / 抗压 / 沟通协调 / 学习能力 / 逻辑思维 / 自驱 / 团队合作" — unverifiable
  // filler present in nearly every JD. Counting it makes every job look alike.
  const SOFT_ONLY = /^(具有良好的|具备良好的|有较强的|有良好的)?(责任心|抗压能力|沟通协调|沟通能力|团队合作|团队协作|学习能力|逻辑思维|自驱|主动性|执行力|细致认真|耐心|工作热情|积极性)/;

  const HEAD_CLEAN = /[【】\[\]（）()：:\s、.．一二三四五六七八九十、]/g;
  function headingOf(t) {
    const s = t.replace(HEAD_CLEAN, "").replace(/^[0-9]+/, "");
    if (HEAD_DUTY.test(s)) return "duty";
    if (HEAD_REQ.test(s)) return "req";
    if (HEAD_BONUS.test(s)) return "bonus";
    if (HEAD_NOISE.test(s)) return "noise";
    return null;
  }

  // A JD line that is really compensation, headcount or location boilerplate.
  const BOILERPLATE_RE = /(日薪|时薪|薪资|工资|待遇|福利|补贴|转正|编制|招\s*\d+\s*人|急招|简历投递|工作地点|办公地址|地铁|简历请|联系方式|双休|五险一金|周末|年终奖|下午茶|团建)/;

  // 招聘流程信息：批次、起止时间、面试地点、投递截止。它和"这个岗要你干什么"
  // 无关，但常被爬虫拼进职责段，还带着角色词，分数能排到第一。
  const META_INFO_RE = /(毕业起止时间|招聘批次|面试地点|投递截止|简历截止|到岗时间|实习时间:|实习期:|转正机会)/;

  // Eligibility lines ("专业不限,视觉设计、数字媒体…背景都可以") list who may
  // apply, not what the job needs done. Quoting one as proof of fit is the single
  // most obviously machine-generated thing this tool could do.
  const ELIGIBILITY_RE = /(专业不限|学历不限|不限专业|相关专业优先|专业优先|应届生|实习生都欢迎|本科在读|本科及以上在读|在读学生|毕业时间|投递时|欢迎告诉|年级|在校生|及以上学历|本科及以上|硕士及以上|学历要求|统招本科)/;

  function isBoilerplate(t) {
    const s = String(t);
    if (BOILERPLATE_RE.test(s)) return true;
    if (ELIGIBILITY_RE.test(s)) return true;
    if (META_INFO_RE.test(s)) return true;
    // "岗位日薪:150-200区间,奖金另算;" — mostly digits and pay words
    const digits = (s.match(/\d/g) || []).length;
    return digits > s.length * 0.3;
  }

  const QUANT_RE = /(\d+(?:\.\d+)?\s*(?:%|％|万|个|人|篇|张|条|天|倍|元|小时|名|次|款|套|页))/;
  const QUANT_RE_G = new RegExp(QUANT_RE.source, "g");

  const EMPTY_MAP = new Map();

  // Bucket a pre-computed span list into clauses. Every JD is scanned exactly
  // once; re-scanning each clause afterwards tripled index time across 330 jobs
  // for the same answer, because the clauses are non-overlapping slices.
  function bucketSpans(parts, spans) {
    const out = [];
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
      out.push({ text: p.text, s: p.s, e: p.e, vec: v });
    }
    return out;
  }

  // `buckets` is parallel to `parts` (bucketSpans pushes one entry per matched
  // clause, skipping empties), so the vector is fetched by index, not by string
  // key. Building a Map keyed on clause text and looking every clause up again
  // was pure overhead — and hashing long strings is not free.
  function decomposeJD(jd, parts, buckets) {
    parts = parts || splitClauses(jd);
    if (!buckets) buckets = bucketSpans(parts, scan(jd, { spans: true }));
    // Walk both lists together; when a bucket's text matches the clause we are
    // on, that clause has concepts.
    let bi = 0;
    const vecByIndex = new Map();
    for (let i = 0; i < parts.length && bi < buckets.length; i++) {
      if (buckets[bi].text === parts[i].text) { vecByIndex.set(i, buckets[bi].vec); bi++; }
    }
    let sec = "other";
    const hard = [], duties = [], nice = [], unmapped = [];
    let unmappedCount = 0;

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      // Headings are short by construction ("岗位职责："); running the heading
      // regexes over every full sentence was a third of index time.
      const head = p.text.length <= 20 ? headingOf(p.text) : null;
      if (head) {
        sec = head === "noise" ? "noise" : head;
        continue;
      }
      const cvec = vecByIndex.get(i) || EMPTY_MAP;
      const substantive = [...cvec.entries()].filter(([id]) => !id.startsWith("s_"));
      if (isBoilerplate(p.text) || SOFT_ONLY.test(p.text) || !substantive.length) {
        unmappedCount++;
        if (!substantive.length && !isBoilerplate(p.text)) unmapped.push({ text: p.text, reason: "无实质信息" });
        continue;
      }
      if (sec === "noise") { unmappedCount++; continue; }

      const ids = substantive.map(([id]) => id);
      // Job-behaviour clauses are duties; everything else is a requirement or a
      // bonus, per P2 Step 4 ("措辞优先于位置").
      let bucket;
      if (sec === "duty") bucket = "duty";
      else if (sec === "bonus") bucket = "nice";
      else if (sec === "req") bucket = NICE_STRICT.test(p.text) && !HARD_STRICT.test(p.text) ? "nice" : "hard";
      else {
        const k = clauseKind(p.text);
        if (k === "duty") bucket = "duty";
        else if (NICE_STRICT.test(p.text) && !HARD_STRICT.test(p.text)) bucket = "nice";
        else bucket = "hard";
      }
      const row = { text: p.text, ids, vec: cvec };
      if (bucket === "duty") duties.push(row);
      else if (bucket === "nice") nice.push(row);
      else {
        row.strict = HARD_STRICT.test(p.text) ? "明示必须" : "隐含必须";
        row.critical = false;
        hard.push(row);
      }
    }

    // is_critical — 缺失即无法胜任核心职责. 学历只有排他性表述才算；
    // 硬技能必须在职责里也被用到，否则它只是加分项被写进了要求段。
    const dutySkill = new Map();
    for (const d of duties) for (const [id, w] of d.vec) if (CAT.get(id) === "skill") dutySkill.set(id, (dutySkill.get(id) || 0) + w);
    for (const g of hard) {
      if (/(统招|全日制|第一学历|硕士及以上|博士)/.test(g.text)) g.critical = true;
      else if (/\d+\s*年以上|\d+\s*年.{0,4}经验/.test(g.text)) g.critical = true;
      else if (/(平台|市场|品类|行业|渠道).{0,6}(经验|操盘)/.test(g.text)) g.critical = true;
      else if (g.ids.some((id) => CAT.get(id) === "skill" && (dutySkill.get(id) || 0) >= 0.8)) g.critical = true;
    }

    return { hard, duties, nice, unmapped, unmappedCount, segCount: parts.length };
  }

  // ---------- job indexing ----------
  function indexJob(job) {
    const titleVec = vec(job.t + " " + (job.dist || ""));
    // One scan of the whole JD, then bucket each match into the clause that
    // contains it. Equivalent to scanning clause-by-clause because clauses are
    // non-overlapping slices — and roughly 5x faster across 330 jobs.
    const parts = splitClauses(job.jd);
    const spans = scan(job.jd, { spans: true });
    const buckets = bucketSpans(parts, spans);
    const clauses = buckets.map((b) => {
      const kind = clauseKind(b.text);
      return { text: b.text, vec: b.vec, kind, w: kind === "req" ? 1.25 : kind === "duty" ? 1.1 : 0.7 };
    });
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
    const p2 = decomposeJD(job.jd, parts, buckets);
    return Object.assign(job, {
      _clauses: clauses, _jdVec: jdVec, _titleVec: titleVec, _titleRole: titleRole, _p2: p2,
    });
  }

  // ---------- P3 · 人岗匹配 ----------
  function overlapWeight(id, res) {
    if (res.has(id)) return res.get(id);
    const p = PARENT.get(id);
    if (p && res.has(p)) return 0.45 * res.get(p);
    // children give partial credit upward (resume says "电商运营", JD says "亚马逊运营")
    return 0;
  }

  // Role alignment: how much of the job's role demand the resume actually covers.
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
    const titleRoles = [...job._titleVec.keys()].filter(isRole);
    // Roles the JD body mentions that the title does not — these are adjacent
    // work (a "UI 实习生" post that also asks for video editing), not the job
    // itself, so they inform the score without defining it.
    const bodyRoles = [];
    for (const [id, w] of job._jdVec) {
      if (!isRole(id) || w <= 0.25 || job._titleVec.has(id)) continue;
      bodyRoles.push([id, Math.min(1, w)]);
    }
    // A job that never names a role is not a proven match for anyone. Scoring it
    // at a neutral 0.55 let vague postings outrank real ones purely on incidental
    // skill overlap, so unknown families sit lower.
    if (!titleRoles.length && !bodyRoles.length) {
      return { r: 0.35, matched: null, missed: null, titleFit: null, titleRoles: [] };
    }

    // The title is the employer's own name for the job. Averaging it into a pile
    // of adjacent roles lost that: a "UI实习生" post that also mentions 前端 and
    // 数据标注 scored the same as one that did not, and a designer's best
    // on-target job fell below an illustration ad. Title fit leads; body roles
    // only adjust.
    const titleFit = titleRoles.length
      ? Math.max(...titleRoles.map((id) => roleCredit(res, id)))
      : null;

    let bodyR = null;
    if (bodyRoles.length) {
      let num = 0, den = 0;
      for (const [id, w] of bodyRoles) { num += w * roleCredit(res, id); den += w; }
      bodyR = den ? num / den : null;
    }

    let r;
    if (titleFit !== null && bodyR !== null) r = 0.8 * titleFit + 0.2 * bodyR;
    else if (titleFit !== null) r = titleFit;
    else r = bodyR;

    let best = null, worst = null;
    for (const id of titleRoles) {
      if (roleCredit(res, id) >= 0.5) { if (!best) best = id; } else if (!worst) worst = id;
    }

    // `titleFit` is the raw resume-vs-title-role credit and stays null when the
    // posting's title names no role at all. `offTarget` substitutes a neutral
    // value in that case so the weighted score still has something to read —
    // keeping them separate is what lets the suppression rules below tell
    // "this job is another profession" apart from "this posting is vague".
    const offTarget = titleFit === null
      ? (res.roleVec.size ? (bodyR === null ? 0.5 : bodyR) : 0.5)
      : titleFit;

    return { r, matched: best, missed: worst, titleFit, offTarget, bodyFit: bodyR, titleRoles };
  }

  function clauseCoverage(cl, resVec) {
    let cw = 0, got = 0;
    for (const [id, w] of cl.vec) {
      const W = CAT_W[CAT.get(id)] || 1;
      cw += W * w;
      const o = overlapWeight(id, resVec);
      if (o > 0) got += W * w * Math.min(1, o + 0.25);
    }
    return cw > 0 ? Math.min(1, got / cw) : 0;
  }

  const HIT_AT = 0.5;
  const PARTIAL_AT = 0.22;

  function stateOf(share) {
    if (share >= HIT_AT) return "HIT";
    if (share >= PARTIAL_AT) return "PARTIAL";
    return "MISS";
  }

  // P2 Step 3 / R-4.1 — the JD body outranks the job title. A posting called
  // "游戏 UI 设计" whose duties are all 建模 is a 3D art job, and handing it to a
  // UI candidate with a confident paragraph is worse than skipping it.
  function titleMismatch(job) {
    const p2 = job._p2;
    if (!p2 || !job._titleRole || !p2.duties.length) return false;
    const dutyRoles = new Map();
    for (const d of p2.duties) {
      for (const [id, w] of d.vec) {
        if (!isRole(id)) continue;
        dutyRoles.set(id, (dutyRoles.get(id) || 0) + w * (CAT_W.role || 3));
      }
    }
    if (!dutyRoles.size) return false;
    let top = null, topW = 0;
    for (const [id, w] of dutyRoles) if (w > topW) { topW = w; top = id; }
    if (!top || top === job._titleRole) return false;
    const titleW = dutyRoles.get(job._titleRole) || 0;
    return topW >= titleW * 2 && topW >= 3;
  }

  const BAND = [
    [85, 95, "强匹配，主投", 85, 100],
    [65, 84, "良好，值得投", 55, 85],
    [45, 64, "够一够，需重包装", 40, 75],
    [25, 44, "偏弱，除非特别想去", 20, 55],
    [0, 24, "不匹配", 0, 40],
  ];

  function interp(lo, hi, w, wlo, whi) {
    const t = Math.max(0, Math.min(1, (w - wlo) / (whi - wlo)));
    return Math.round(lo + (hi - lo) * t);
  }

  function scoreJob(res, job) {
    const p2 = job._p2 || decomposeJD(job.jd);
    const ra = roleAlignment(res, job);

    // ---- 逐条对照：硬门槛 / 核心职责 / 加分项 ----
    const gates = p2.hard.map((g) => {
      const share = clauseCoverage(g, res.vec);
      return { text: g.text, ids: g.ids, critical: g.critical, strict: g.strict, share, state: stateOf(share) };
    });
    const duties = p2.duties.map((d) => {
      const share = clauseCoverage(d, res.vec);
      return { text: d.text, ids: d.ids, share, state: stateOf(share) };
    });
    const nice = p2.nice.map((n) => {
      const share = clauseCoverage(n, res.vec);
      return { text: n.text, ids: n.ids, share, state: stateOf(share) };
    });

    // ---- 四维加权 ----
    const rate = (arr) => (arr.length ? arr.reduce((s, x) => s + (x.state === "HIT" ? 1 : x.state === "PARTIAL" ? 0.5 : 0), 0) / arr.length : null);
    const hardRate = rate(gates);
    const niceRate = rate(nice);
    const dutyHitRate = duties.length
      ? duties.reduce((s, d) => s + (d.state === "HIT" ? 1 : d.state === "PARTIAL" ? 0.5 : 0), 0) / duties.length
      : 0;

    // 行业/职能对口 = role family (the recruiter's first judgement) blended with
    // domain context. Domain alone never decides — a designer is not an AI
    // candidate because one internship happened at an AI company.
    const domainIds = [];
    for (const [id, w] of job._jdVec) if (CAT.get(id) === "domain" && w >= 0.4) domainIds.push([id, w]);
    const domainR = domainIds.length
      ? domainIds.reduce((s, [id, w]) => s + w * (overlapWeight(id, res.vec) > 0 ? 1 : 0), 0) / domainIds.reduce((s, [, w]) => s + w, 0)
      : 0;
    const roleR = ra.r;
    const funcR = 0.8 * roleR + 0.2 * domainR;

    const dims = {
      hard: hardRate === null ? 70 : hardRate * 100,
      duty: duties.length ? dutyHitRate * 100 : 50,
      func: funcR * 100,
      nice: niceRate === null ? 60 : niceRate * 100,
    };
    const W = 0.4 * dims.hard + 0.3 * dims.duty + 0.2 * dims.func + 0.1 * dims.nice;

    // ---- R1 · 方向不对 ----
    // 岗位标题点明了职业方向，候选人却一次都没提到过这个方向。这不是"差一点"，
    // 是另一个职业：UI 设计去投「游戏策划」、会计去投「算法」，简历再漂亮也过不了
    // 第一轮。没有这条时，张简历的运营/策划岗靠技能词的重叠排到了 79 分，运营一眼
    // 就会看出这个工具不懂岗位。
    const titleRoles = ra.titleRoles || [];
    const offTarget = titleRoles.length > 0 && (ra.titleFit || 0) < 0.34;
    const mismatch = titleMismatch(job);
    const criticalGaps = gates.filter((g) => g.critical && g.state === "MISS");
    const firstDuty = duties[0];
    const firstTwoHit = duties.length >= 2
      ? duties[0].state === "HIT" && duties[1].state === "HIT"
      : !!(duties[0] && duties[0].state === "HIT");
    const mainline = dutyHitRate >= 0.5 && !!firstDuty && firstDuty.state !== "MISS";
    const strong = dutyHitRate >= 0.75 && firstTwoHit;

    // 稀缺强项：带数字的战绩，且它命中的方向就是 JD 职责要的方向
    const quantified = res.bullets.some((b) => QUANT_RE.test(b.text) && b.vec.size && [...b.vec.keys()].some((id) => job._jdVec.has(id) && (CAT.get(id) === "skill" || CAT.get(id) === "method" || isRole(id))));

    let path, score, reason;
    if (mismatch) {
      path = "R1_ROLE_MISMATCH"; score = interp(0, 10, W, 0, 40);
      reason = "岗位名与 JD 正文的职能不一致，正文实际是另一个方向";
    } else if (offTarget) {
      // 有一处例外值得救：简历在 JD 正文里反复出现的那个方向上确实有料
      // （UI 设计投「游戏UI设计」写成了「设计实习生」的标题，或一个岗位名写错了）。
      // 这种情况给到 45–64，也就是"够一够"，而不是直接判死。
      const bodyRescue = (ra.bodyFit || 0) >= 0.6 && dutyHitRate >= 0.5;
      if (bodyRescue) {
        path = "R1_OFF_TARGET_RESCUE";
        score = interp(45, 64, W, 40, 75);
        reason = "岗位标题是「" + (LABEL.get(titleRoles[0]) || "另一个方向") + "」，但 JD 正文里的活你干过，可以够一够";
      } else {
        path = "R1_OFF_TARGET";
        score = interp(0, 24, W, 0, 45);
        reason = "岗位是「" + (LABEL.get(titleRoles[0]) || "另一个方向") + "」方向，你简历里没有这个方向的经历";
      }
    } else if (criticalGaps.length) {
      if (quantified && mainline) {
        path = "R2_RESCUE"; score = interp(45, 64, W, 30, 70);
        reason = "缺关键硬门槛，但有对得上的量化战绩，可以捞回来";
      } else {
        path = "R2_HARD_GAP"; score = interp(8, 25, W, 10, 55);
        reason = "缺 " + criticalGaps.length + " 项关键硬门槛";
      }
    } else if (strong && quantified && W >= 85) {
      path = "R4_STRONG_FIT"; score = interp(85, 95, W, 85, 100);
      reason = "硬门槛全过，核心职责高度咬合且有量化战绩支撑";
    } else if (mainline && titleRoles.length) {
      path = "R3_MAINLINE_FIT"; score = interp(65, 84, W, 55, 85);
      reason = "硬门槛全过，核心职责咬合";
    } else if (mainline) {
      // 岗位标题看不出是干什么的（"软件实习生"）。职责能对上，但你没法判断
      // 这个岗是不是你要的那个方向，也就不该排到真正说清方向的岗位前面。
      path = "R3_VAGUE_TITLE"; score = interp(45, 64, W, 45, 80);
      reason = "岗位名看不出具体方向，JD 职责能对上，投之前建议先问清楚";
    } else {
      path = "R3_WEAK"; score = interp(45, 64, W, 40, 75);
      reason = "硬门槛没卡，但核心职责咬合不够";
    }
    score = Math.max(0, Math.min(95, score));

    const band = BAND.find(([lo, hi]) => score >= lo && score <= hi) || BAND[4];
    const partition = score >= 65 ? "CAN_APPLY" : score >= 45 ? "CAUTION" : "DO_NOT_APPLY";

    // ---- 资格与安排上的缺口：只提示，不静默丢岗 ----
    const caveats = [];
    const gaps = [];
    if (job.edu === "硕士" && res.info.degree && res.info.degree !== "硕士" && res.info.degree !== "博士") {
      caveats.push("岗位写硕士优先，你是" + res.info.degree);
      gaps.push({ kind: "gate", text: "学历要求：硕士（你是 " + res.info.degree + "）" });
    }
    if (job.edu === "本科" && res.info.degree === "大专") {
      caveats.push("岗位要求本科，你是大专");
      gaps.push({ kind: "gate", text: "学历要求：本科（你是 大专）" });
    }
    if (res.info.days && job.days && res.info.days < job.days) {
      caveats.push("岗位要每周 " + job.days + " 天，你简历写 " + res.info.days + " 天");
      gaps.push({ kind: "schedule", text: "出勤：岗位要每周 " + job.days + " 天，你写 " + res.info.days + " 天" });
    }
    if (res.info.months && job.months && res.info.months < job.months) {
      caveats.push("岗位要做 " + job.months + " 个月，你写 " + res.info.months + " 个月");
      gaps.push({ kind: "schedule", text: "时长：岗位要 " + job.months + " 个月，你写 " + res.info.months + " 个月" });
    }
    const jdY = job.jd.match(/(20\d{2})\s*届/);
    if (jdY && res.info.gradYear) {
      const need = +jdY[1];
      if (res.info.gradYear < need) {
        caveats.push("岗位面向 " + need + " 届，你是 " + res.info.gradYear + " 届");
        gaps.push({ kind: "gate", text: "届别：岗位面向 " + need + " 届，你是 " + res.info.gradYear + " 届" });
      }
    }
    for (const g of criticalGaps) {
      gaps.push({ kind: "hard", text: labelIn(g.text, res) });
    }

    // hits — 供证据与话术使用。只记录真正能引用的（子句自身主题是被命中的概念），
    // 这里先全量收集，explain 再按子句相关性过滤。
    const hits = [];
    for (const cl of (job._clauses || [])) {
      for (const [id, w] of cl.vec) {
        const o = overlapWeight(id, res.vec);
        if (o > 0) hits.push({ id, cl, w: (CAT_W[CAT.get(id)] || 1) * w * o });
      }
    }

    return {
      job,
      score,
      fit: score / 100,
      band: band[2],
      partition,
      path,
      reason,
      mismatch,
      dims,
      W,
      duties,
      gates,
      nice,
      dutyHitRate,
      mainline,
      strong,
      roleAlign: ra,
      hits,
      caveats,
      gaps,
      p2,
    };
  }

  // "必须具备互联网或游戏行业的招聘/HR 实习经验" → "招聘/HR 实习经验"
  function labelIn(text, res) {
    const ids = [...scan(text, { hits: false }).keys()]
      .filter((id) => !id.startsWith("s_") && CAT.get(id) !== "domain");
    const labs = [];
    for (const id of ids) {
      const l = LABEL.get(id);
      if (l && !labs.includes(l)) labs.push(l);
    }
    return labs.length ? labs.slice(0, 3).join("、") : trimTo(text, 26);
  }

  // ---------- explain ----------
  function cleanClause(t) {
    return t
      .replace(/^\d+[.、)）]\s*/, "")
      // Splitting on ?/! leaves the previous clause's closing quote and the next
      // bullet's dash at the head of this one: `” - 喜欢 MakeThings:除了 Figma…`.
      .replace(/^["'“”‘’()（）\[\]【】\s\-—–·、,，。；;:：]+/, "")
      // scraping leaves the next section's heading glued to the end of a clause
      .replace(/(职位要求|岗位要求|任职要求|岗位职责|工作内容|职位描述)\s*[:：]?\s*$/, "")
      // scraped JDs mix half-width punctuation into Chinese text; in WeChat it
      // reads as copied source code rather than a sentence
      .replace(/([一-龥])\s*[,，]\s*/g, "$1，")
      .replace(/([一-龥])\s*[;；]\s*/g, "$1；")
      // a colon followed by Chinese is a colon, not a URL scheme or a ratio
      .replace(/\s*:\s*(?=[一-龥])/g, "：")
      .replace(/\s+/g, " ")
      .trim();
  }

  // How much of a clause is actually about this one concept. "把 AI 生图真正嵌进
  // 工作流：写提示词、调参数、控制风格一致性" fires 视觉产出 on the word 风格; citing
  // that clause next to "做过 20+ 张海报" is the clearest tell that a machine
  // assembled the message. Evidence has to answer what the clause is *about*.
  function clauseShare(cl, id) {
    let tot = 0, own = 0;
    for (const [k, w] of cl.vec) {
      const W = (CAT_W[CAT.get(k)] || 1) * Math.min(1, w);
      tot += W;
      if (k === id) own = W;
    }
    return tot ? own / tot : 0;
  }

  // A clause leads with a skill or method the resume has never shown? Then the
  // overlap further down it is incidental, and quoting the clause would attribute
  // that skill to the candidate.
  function clauseLeadsElsewhere(cl, res) {
    let top = null, topW = 0;
    for (const [k, w] of cl.vec) {
      if (k.startsWith("s_")) continue;
      const W = (CAT_W[CAT.get(k)] || 1) * Math.min(1, w);
      if (W > topW * 1.02) { topW = W; top = k; }
    }
    if (!top) return false;
    const cat = CAT.get(top);
    if (cat !== "skill" && cat !== "method") return false;
    return overlapWeight(top, res.vec) === 0;
  }

  function resumeQuoteFor(res, id, used) {
    if (!BY_ID.get(id)) return null;
    // Only real achievement bullets count as evidence. Falling back to a raw text
    // search would quote header lines like "求职意向：产品经理实习生", which reads
    // as proof to a matcher but as nothing to a recruiter.
    const cand = res.bullets
      .map((b) => {
        const direct = b.vec.get(id) || 0;
        const viaParent = PARENT.get(id) ? (b.vec.get(PARENT.get(id)) || 0) * 0.55 : 0;
        // 只看"有没有提到"会在同一段里挑错条目：「组织 30 人内测」和「系统策划与
        // 数值设计」都提到玩法设计，但后者才是这条 JD 要的那件事。按概念权重排。
        return { b, w: direct + viaParent, hit: b.vec.has(id) ? 1 : viaParent ? 0.5 : 0 };
      })
      .filter((x) => x.w > 0 && x.b.text.length >= 12)
      .sort((a, b) => b.w - a.w || b.hit - a.hit || b.b.text.length - a.b.text.length);
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
    return { text: t, direct: pick.hit >= 1, bullet: pick.b, block: pick.b.block };
  }

  /** Where the candidate did it — so the quote reads as an experience, not a slogan. */
  function whereOf(quote, res) {
    const b = quote && quote.block;
    if (!b) {
      const intent = (res.sec.intent || [])[0];
      return intent ? String(intent).trim().slice(0, 18) : "";
    }
    const bits = [b.company, b.title].filter(Boolean);
    return bits.join(" · ").slice(0, 24);
  }

  function explain(res, sc, limit) {
    const ranked = [];
    const seenClause = new Set();
    const usedQuotes = new Set();
    // Requirements the JD leans on but the resume never answers. These are the
    // honest counterweight to the evidence list, and they are computed from the
    // P2 audit rather than from word frequency.
    const unmet = (sc.gates || []).filter((g) => g.state === "MISS")
      .concat((sc.duties || []).filter((d) => d.state === "MISS"));

    for (const h of sc.hits) {
      if (seenClause.has(h.cl.text)) continue;
      if (h.id.startsWith("s_")) continue; // soft traits are not persuasive evidence
      // A domain is where they worked, not what they can do. Quoting 「游戏」 back
      // as the reason reads as if the matcher only saw the industry name.
      if (CAT.get(h.id) === "domain") continue;
      if (isBoilerplate(h.cl.text)) continue;
      // The clause must be *about* this concept, and must not lead with a skill
      // the candidate has never shown. Otherwise the row reads "JD 要 AI 生图 /
      // 你做过海报" — technically true, obviously not an answer.
      if (clauseShare(h.cl, h.id) < 0.34) continue;
      if (clauseLeadsElsewhere(h.cl, res)) continue;
      const q = resumeQuoteFor(res, h.id, usedQuotes);
      if (!q) continue;
      seenClause.add(h.cl.text);
      const spec = 1 / Math.sqrt(h.cl.vec.size || 1); // narrower clause = more specific
      // 凭据的强弱和权重不是一回事：一句"你会 Figma"比"你属于这个岗"更能说服人，
      // 而"这个岗要你做什么"比"这个岗希望你是什么样"更值得引。用权重排序会让
      // 角色词和意愿类条款挤到第一位，把真正具体的那条经历压下去。
      const share = clauseShare(h.cl, h.id);
      const cat = CAT.get(h.id);
      // 「熟练使用各种办公及工具软件(如：墨刀、xmind、axure)」里 axure 只是
      // 举例，这条子句本身讲的是"会用工具"，不是"会原型"。占不到一半就不给它
      // 技能词的高权重。
      const catF = isRole(h.id) ? 0.9 : cat === "skill" ? (share >= 0.45 ? 1.2 : 0.95) : 1.1;
      const kindF = h.cl.kind === "duty" ? 1.3 : h.cl.kind === "req" ? 0.95 : 1;
      ranked.push({
        concept: h.id,
        label: LABEL.get(h.id),
        jd: cleanClause(h.cl.text),
        res: q.text,
        resRaw: q.text,
        where: whereOf(q, res),
        direct: q.direct,
        kind: h.cl.kind,
        score: h.w * (0.6 + 0.8 * spec) * catF * kindF,
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
      if (usedQuotes.has(r.res) && out.some((o) => o.res === r.res)) {
        const alt = ranked.find((x) => !usedConcepts.has(x.concept) && !out.some((o) => o.res === x.res));
        if (!alt) break;
        usedConcepts.add(alt.concept);
        out.push(alt);
      } else {
        usedConcepts.add(r.concept);
        out.push(r);
      }
      if (out.length >= (limit || 3)) break;
    }
    out.sort((a, b) => b.score - a.score);
    const missing = [];
    const seenMiss = new Set();
    for (const m of unmet) {
      for (const id of m.ids) {
        if (CAT.get(id) !== "skill" && CAT.get(id) !== "method") continue;
        if (res.vec.has(id)) continue;
        const l = LABEL.get(id);
        if (!l || seenMiss.has(l)) continue;
        seenMiss.add(l);
        missing.push(l);
      }
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

  // ---------- P5 · resume rewriting ----------
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
      // Cutting to fit can amputate the number that makes the line credible
      // ("…转化率提升 6.4%" → "…转化率提升"). A trimmed bullet that loses its
      // evidence is worse than a long bullet, and the P6 check would reject it.
      const cut = t.slice(0, 88);
      const p = Math.max(cut.lastIndexOf("，"), cut.lastIndexOf("、"));
      const trimmed = (p > 40 ? cut.slice(0, p) : cut) + "。";
      const lost = t.slice(Math.max(0, p > 40 ? p : 88)).match(QUANT_RE);
      t = lost ? t.replace(/[。；;]+$/, "") + "。" : trimmed;
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
    const jdName = job._p2 && job._p2.duties[0] ? labelIn(job._p2.duties[0].text, res) : roleLabel;

    // 命中句要从**整份简历**里挑，不能只看那两三条通过证据过滤的条目：证据过滤
    // 是为了"别引用不相干的 JD 句"，一条都不剩时就会让命中句掉到社团海报上，而
    // 真正对口的实习明明在下一段。这里给所有条目按与 JD 的重合度打分，再叠加两个
    // P5 明确偏好的因素：带数字（可验证）、是实习而不是社团（像工作）。
    const bulletScore = (b) => {
      let n = 0;
      for (const [id, w] of b.vec) {
        const jw = job._jdVec.get(id);
        if (!jw) continue;
        n += w * jw * (CAT_W[CAT.get(id)] || 1);
      }
      if (QUANT_RE.test(b.text)) n += 0.8;
      const blk = b.block;
      if (blk && /实习|工作/.test(blk.title || "")) n += 0.6;
      return n;
    };
    const allRanked = res.bullets
      .filter((b) => b.text.length >= 10)
      .map((b) => ({ res: b.text, bullet: b, block: b.block, score: bulletScore(b), label: null }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    // 证据里那几条的 label 是"对上 JD 的哪个概念"，命中句要用它来说明对上了什么。
    const labelOf = new Map();
    for (const e of ev) if (!labelOf.has(e.res)) labelOf.set(e.res, e.label);

    // 1) 命中句 (R-5.1 #1). It has to fall on a concrete experience — "有产品经验"
    // is exactly the empty sentence P5 forbids. Quote the candidate's own line.
    const topEv = allRanked[0];
    let hit = "";
    if (topEv) {
      const blk = topEv.block;
      // 「在杭州某 SaaS 公司做 UI 设计实习生时」比「在校设计协会 · 视觉组负责人」
      // 更像"这个人真的干过"，也直接回答了"在哪做的"。
      let at = "";
      if (blk && (blk.company || blk.title)) {
        const intern = /实习|工作/.test(blk.title || "");
        at = blk.company ? "在" + blk.company + (intern ? "实习时，" : "时，") : "";
      }
      // 命中句要挂在 JD 的原话上，不是挂在概念标签上。「和这个岗要的
      // 『UI/视觉设计』是同一件事」听着像在复述岗位名；「和 JD 里『负责 Banner 图
      // 及整体直播间视觉风格的排版』是一件事」才是真的对上了那句要求。
      // 一条共享的技能/方法词都没有时（这条经历讲的是界面设计，JD 讲的是直播
      // 物料），不要硬编一个"要求"出来——只说自己做了什么，让证据自己说话。
      const req = bestJdLine(job, topEv.bullet);
      if (req) {
        hit = at + "做过「" + clipQuote(topEv.res, 44) + "」——和 JD 里「" + clipQuote(req, 28) + "」是同一件事。";
      } else {
        const shared = sharedLabel(topEv.bullet, job);
        hit = at + "做过「" + clipQuote(topEv.res, 44) + "」。"
          + (shared ? "这是" + shared + "方向最实的底子。" : "");
      }
    } else {
      hit = "求职方向是" + roleLabel + "；具体对口的细节在本版里按岗位重排过，没有新增经历。";
    }

    // 2) 优势牌 — the candidate's own strongest facts, heaviest overlap first.
    // P5 要 3–5 条。只靠高权重的命中凑不满时，用同一份简历里其余的相关条目补上，
    // 一条都不新写。空着一条会让人以为这个人只有一条经历。
    const summary = [];
    const seenSummary = new Set();
    const pushSum = (txt) => {
      let t = String(txt).replace(/[。；;，、]+$/, "").replace(/…$/, "").trim();
      if (t.length < 10) return;
      const key = t.slice(0, 16);
      if (seenSummary.has(key)) return;
      seenSummary.add(key);
      summary.push(t + "。");
    };
    for (const x of allRanked) { if (summary.length >= 3) break; pushSum(x.res); }
    if (!summary.length) summary.push("有" + roleLabel + "相关的实习与项目积累，按岗位职责重排了顺序。");

    // 3) 降维牌 (R-5.1 #3) — only when the resume actually carries the evidence.
    let edge = "";
    const techIds = [];
    for (const [id, w] of res.vec) {
      const c = CAT.get(id);
      if ((c === "skill" || c === "method") && /^(llm_tech|prompt|aigc_tool|py|sql|ml|api|crawler|bi|d3|m_game_design|m_mlops)$/.test(id) && w >= 0.4) techIds.push(id);
    }
    const jdIsTech = [...job._jdVec.keys()].some((id) => id === "llm_tech" || id === "algo_llm" || id === "m_mlops");
    if (techIds.length && !jdIsTech) {
      edge = "除「" + roleLabel + "」本身，还会「" + techIds.slice(0, 2).map((i) => LABEL.get(i)).join("」「") + "」——做同类岗位时能自己动手，不只是提需求。";
    }

    // 4) 经历：整段保留（R-5.2）。不删段、不删公司名与时间，只重排顺序和条数。
    const scoredBlocks = res.blocks.map((b) => {
      const rows = b.bullets.map((t) => {
        const v = vec(t);
        let s = 0;
        for (const [id, w] of v) {
          if (job._jdVec.has(id)) s += w * (CAT_W[CAT.get(id)] || 1) * Math.min(1, job._jdVec.get(id) + 0.3);
        }
        return { t, v, s };
      }).sort((a, b) => b.s - a.s);
      const blockScore = rows.reduce((s, r) => s + r.s, 0);
      return { b, rows, s: blockScore };
    }).sort((a, b) => b.s - a.s);

    // ---- assemble ----
    const lines = [];
    const info = res.info;
    lines.push("求职意向：" + job.c + " · " + job.t);
    if (info.name) lines.push("姓名：" + info.name + (info.phone ? "｜" + info.phone : "") + (info.email ? "｜" + info.email : ""));
    lines.push("");
    lines.push("【个人定位】");
    lines.push(hit);

    lines.push("");
    lines.push("【个人优势】");
    summary.forEach((s, i) => lines.push((i + 1) + ". " + s));
    if (edge) lines.push((summary.length + 1) + ". " + edge);

    const eduLines = (res.sec.edu || []).map((l) => l.trim()).filter((l) => l);
    if (eduLines.length) {
      lines.push("");
      lines.push("【教育背景】");
      eduLines.slice(0, 4).forEach((l) => lines.push(l));
    }

    // 每段至少留 1 条、最多 6 条；最相关的段落放在最前。被淡化的段落不是删掉，
    // 是把条数压到 1–2 条——删段会让 HR 以为你没干过。
    const keptMap = new Map();
    const muted = [];
    if (scoredBlocks.length) {
      lines.push("");
      lines.push("【相关经历】");
      scoredBlocks.forEach((sb, bi) => {
        const head = [sb.b.company, sb.b.title, sb.b.period].filter(Boolean).join(" ｜ ");
        if (head) lines.push(head);
        const keepN = bi === 0 ? Math.min(6, Math.max(2, sb.rows.length)) : sb.rows.length <= 2 ? sb.rows.length : 2;
        const kept = sb.rows.slice(0, Math.max(1, Math.min(keepN, sb.rows.length)));
        // 被压掉的条目里如果有别处没有的数字，救回来：那是一个事实，不是一句措辞。
        // 只增不减在这里必须真的成立，否则自检会把每一份改稿都判失败。
        const seenNums = new Set();
        for (const r of kept) for (const m of (r.t.match(QUANT_RE_G) || [])) seenNums.add(m.replace(/\s+/g, ""));
        for (const r of sb.rows.slice(kept.length)) {
          const nums = (r.t.match(QUANT_RE_G) || []).map((m) => m.replace(/\s+/g, ""));
          if (nums.some((m) => !seenNums.has(m))) {
            kept.push(r);
            nums.forEach((m) => seenNums.add(m));
          }
        }
        const rows = kept.slice().sort((a, b) => b.s - a.s);
        keptMap.set(sb.b, rows);
        if (rows.length < sb.rows.length) muted.push({ block: sb.b, dropped: sb.rows.length - rows.length });
        for (const r of rows) {
          const p = polishBullet(r.t);
          if (p) lines.push("· " + p);
        }
      });
    }

    const skillLines = (res.sec.skill || []).map((l) => l.trim()).filter((l) => l.length > 1);
    if (skillLines.length) {
      lines.push("");
      lines.push("【技能证书】");
      skillLines.slice(0, 6).forEach((l) => lines.push(l));
    }
    const award = (res.sec.award || []).map((l) => l.trim()).filter((l) => l.length > 1);
    if (award.length) {
      lines.push("");
      lines.push("【荣誉奖项】");
      award.slice(0, 3).forEach((l) => lines.push(l));
    }

    const missingTop = ev.missing || [];
    const text = lines.join("\n");

    // 5) 改动说明 — 说清动了什么、为什么，不说做了多少分。
    const changes = [];
    changes.push({
      k: "顶部加了命中句",
      v: "第一行写「" + job.c + " · " + job.t + "」，第二段用你自己的一条经历点明对口。HR 前 5 秒就知道你投的是什么。",
    });
    if (ev.length) {
      changes.push({
        k: "优势牌提到第一屏",
        v: "把已有的「" + ev.slice(0, 3).map((e) => e.label).join("」「") + "」放到最前，跟 JD 的要求逐条对上。没有新增你没有的经历。",
      });
    }
    if (edge) {
      changes.push({ k: "加了一张降维牌", v: "「" + techIds.slice(0, 2).map((i) => LABEL.get(i)).join("」「") + "」是你简历里本来就写着的，放在这里做差异化；不是这个方向的人很难补。" });
    }
    if (scoredBlocks.length > 1) {
      changes.push({
        k: "经历按对口度重排",
        v: "最相关的「" + (scoredBlocks[0].b.company || scoredBlocks[0].b.title || "第一段") + "」放最前，后面几段保留但压到 1-2 条。一段都没删。",
      });
    }
    changes.push({
      k: "公司名、职位、起止时间一个字没动",
      v: "这三样是只读的。面试官核简历第一眼看的就是它们，改了就是给自己挖坑。",
    });
    changes.push({
      k: "空转的「负责」删了",
      v: "每条开头直接是你做的事。「参与」「协助」「配合」这些保留着——删了就等于把你的角色抬高了，面试一问就露。",
    });
    if (muted.length) {
      changes.push({
        k: "有 " + muted.length + " 段压短了",
        v: muted.map((m) => "「" + (m.block.company || m.block.title || "某段") + "」少 " + m.dropped + " 条").join("，") + "，但每段都留了代表成果。要恢复原文随时能在原简历里找到。",
      });
    }
    if (missingTop.length) {
      changes.push({
        k: "这几项还没写（建议你自己补）",
        v: "JD 提到但简历里没体现：" + missingTop.join("、") + "。有相关经历就补一句，没有就别硬写。",
      });
    }

    const rw = { text, changes, missing: missingTop, summary, hit, edge, keptMap, muted, blocks: scoredBlocks };
    // P6 runs against the produced text, not against our intentions.
    if (root.JDVerify) rw.verify = root.JDVerify.check(res, text, { job, rewrite: rw });
    return rw;
  }

  // The single JD line this bullet answers best. Starting from the JD side and
  // scoring against the bullet is what makes the pairing a quotation of the
  // requirement rather than a restatement of the job title.
  function bestJdLine(job, bullet) {
    if (!bullet || !bullet.vec || !job._clauses) return null;
    let best = null, bestS = 0;
    for (const cl of job._clauses) {
      if (cl.kind === "other" && cl.text.length < 12) continue;
      // 招聘信息被切成一整句的情况：`毕业起止时间:2027-11-01 - 2029-10-31
      // 工作地点:杭州,北京招聘批次`。它含"批次"里的"算法"等词，却又完全在讲
      // 投递条件。引用它去说明"你这经历和岗位要的是同一件事"，候选人一秒就
      // 看穿这是机器从 JD 里随手抓的一句。
      if (isBoilerplate(cl.text) || META_INFO_RE.test(cl.text)) continue;
      let s = 0;
      for (const [id, w] of cl.vec) {
        const bw = bullet.vec.get(id);
        // 角色/领域词在这条子句里只算弱证据：JD 写「直播间视觉素材」，字面上有
        // 「直播运营」，但这一句讲的是做图，不是运营。
        const cat = CAT.get(id);
        const wt = cat === "skill" ? 1.0 : cat === "method" ? 0.9 : isRole(id) ? 0.3 : 0.15;
        if (bw) s += w * bw * (CAT_W[cat] || 1) * wt;
      }
      if (cl.kind === "duty") s *= 1.15;
      if (s > bestS) { bestS = s; best = cl.text; }
    }
    return bestS >= 0.25 ? cleanClause(best).replace(/^\d+\s*[.、)）]\s*/, "") : null;
  }

  // 一条经历和这份 JD 共同指向的概念，技能/方法优先于角色，角色优先于领域。
  // 它回答的是"这条经历证明了你哪一点正好是这个岗要的"。
  function sharedLabel(bullet, job) {
    if (!bullet || !bullet.vec) return null;
    const order = (id) => (CAT.get(id) === "skill" ? 0 : CAT.get(id) === "method" ? 1 : isRole(id) ? 2 : 3);
    const rows = [];
    for (const [id, w] of bullet.vec) {
      const jw = job._jdVec.get(id);
      if (!jw) continue;
      rows.push({ id, s: w * jw * (CAT_W[CAT.get(id)] || 1) * (order(id) === 0 ? 1.4 : 1) });
    }
    rows.sort((a, b) => b.s - a.s || order(a.id) - order(b.id));
    return rows.length ? LABEL.get(rows[0].id) : null;
  }

  function trimTo(s, n) {
    s = String(s).replace(/\s+/g, "").replace(/[。；;，,]$/, "");
    return s.length > n ? s.slice(0, n) : s;
  }

  // 引文截断要在断句处收，否则「熟练掌握主流数据分析工具(Excel、SQL、Pytho」
  // 这种半截产品名会印在简历最上面一行——人选自己看到就知道是机器切出来的。
  // 规则顺序：先修未闭合的括号，再找最近的断点（允许往后多走几个字去够它，
  // 宁可长 3 个字也不要切在词中间），最后才硬截。
  function clipQuote(s, n, maxOver) {
    const over = maxOver == null ? 6 : maxOver;
    s = String(s).replace(/\s+/g, " ").trim().replace(/[。；;，,、\s]+$/, "");
    if (s.length <= n) return s;
    let cut = s.slice(0, n);
    // 「(Excel、SQL、Python 等)」被切在括号里：能补全括号就补全（括号里的
    // 工具名正是这句话的证据），补不齐再退到括号前。
    const o = Math.max(cut.lastIndexOf("（"), cut.lastIndexOf("("));
    const c = Math.max(cut.lastIndexOf("）"), cut.lastIndexOf(")"));
    if (o > c && o >= 8) {
      const close = s.slice(n).search(/[）)]/);
      // 补全括号也要守住行长：括号里的工具名值得留，但不能为它把一行撑到 40 字。
      if (close >= 0 && close < over) return tidy(s.slice(0, n + close + 1));
      return tidy(cut.slice(0, o));
    }
    const isBoundary = (ch) => "，、；：,;:".includes(ch);
    const bounds = [];
    for (let i = 0; i < s.length; i++) if (isBoundary(s[i])) bounds.push(i);
    const under = bounds.filter((p) => p < n && p >= n * 0.62).pop();
    if (under != null) return tidy(s.slice(0, under));
    // 往后够一个断点，但只多走几个字；这比留半截词体面，也比撑破一行体面
    const overIdx = bounds.find((p) => p > n && p <= n + over);
    if (overIdx != null) return tidy(s.slice(0, overIdx));
    if (bounds.length) {
      const anyUnder = bounds.filter((p) => p < n && p >= 6).pop();
      if (anyUnder != null) return tidy(s.slice(0, anyUnder));
    }
    // 中文没有词边界，硬截到 18 字会留下「自动化报」。虚词/连词前后一定是
    // 语意断点，退到最后一个这样的字之前，读起来才是一个完整的短语。
    for (let i = Math.min(n, s.length - 1); i >= 6; i--) {
      if ("的及与和并让使将对把从向为而以".includes(s[i])) return tidy(s.slice(0, i));
    }
    // 英文词被切开时退到词首：「详情页 A+,Banner」不要变成「Banne」
    const tail = cut.match(/[A-Za-z0-9]+$/);
    if (tail && tail.index > 6) cut = cut.slice(0, tail.index);
    return tidy(cut);
  }

  // 收尾：去掉断在末尾的「包括」「如」「例如」这类半句话，「…任务，包括」比
  // 「…任务」更像没写完。
  const DANGLING_TAIL = /[，、；,:：]?\s*(包括|例如|如|比如|以及|和|及|或)$/;
  function tidy(t) {
    let s = String(t).replace(/[，、；,;:：\s]+$/, "");
    s = s.replace(DANGLING_TAIL, "");
    return s.replace(/[（(]$/, "").trim();
  }

  // ---------- public ----------
  root.JDEngine = {
    parseResume, indexJob, scoreJob, explain, rewrite, vec, topRole,
    isRole, LABEL, BY_ID, CAT, trimTo, clipQuote, clauseShare, whereOf, labelIn, cleanClause,
    QUANT_RE, HIT_AT,
  };
})(window);
