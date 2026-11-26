// Dataset loading and Excel override.
// The bundled JSON is built from the operator's Excel by tools/build_data.py.
// When the operator drops in a newer workbook, the same parsing rules run here
// in the browser (SheetJS) and the result is kept in localStorage, so a new
// version is one drag-and-drop away and survives a reload.
(function (root) {
  const LS_KEY = "jobdesk.dataset.v1";
  const SHEET = "岗位清单";

  const CITY_RE = /(杭州|上海|北京|深圳|广州|南京|苏州|宁波|武汉|成都|西安|厦门|长沙|合肥|无锡)/;
  const WS_RE = /[ \t 　]+/g;

  function norm(v) {
    if (v === null || v === undefined) return "";
    let s = String(v);
    try { s = s.normalize("NFKC"); } catch (e) { /* old browsers */ }
    s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    // scraped text often has stray spaces between CJK characters
    s = s.replace(/([一-龥])[ \t]+(?=[一-龥])/g, "$1");
    s = s.replace(WS_RE, " ");
    s = s.replace(/\n{3,}/g, "\n\n");
    return s.trim();
  }

  function cleanJd(s) {
    s = norm(s);
    s = s.replace(/([A-Za-z]) (?=[A-Za-z])/g, "$1");
    s = s.replace(/([A-Za-z])(?=[一-龥])/g, "$1 ");
    return s.trim();
  }

  const parseDays = (t) => {
    const m = /(\d)\s*天\s*\/\s*周/.exec(t) || /每周(?:出勤)?\s*(\d)/.exec(t);
    return m ? +m[1] : 0;
  };
  const parseMonths = (t) => {
    const m = /时长\s*(\d+)\s*个月/.exec(t) || /(\d+)\s*个月/.exec(t);
    return m ? +m[1] : 0;
  };
  function parseSalary(t) {
    if (!t || /未提供/.test(t)) return null;
    let m = /(\d{2,3})\s*[-~]\s*(\d{2,3})/.exec(t);
    if (m) return [+m[1], +m[2]];
    m = /(\d{3,5})\s*\/\s*月/.exec(t);
    if (m) return [Math.round(+m[1] / 22), Math.round(+m[1] / 22)];
    return null;
  }
  function parseDegree(text, jd) {
    for (const [kw, val] of [["博士", "博士"], ["硕士", "硕士"], ["研究生", "硕士"], ["本科", "本科"], ["大专", "大专"]]) {
      if (text.includes(kw)) return val;
    }
    if (/学历不限/.test(text)) return "不限";
    for (const [kw, val] of [["本科及以上", "本科"], ["本科以上", "本科"], ["硕士及以上", "硕士"], ["大专及以上", "大专"]]) {
      if ((jd || "").includes(kw)) return val;
    }
    return "不限";
  }
  function parseCity(loc) {
    for (const line of (loc || "").split("\n")) {
      const m = CITY_RE.exec(line);
      if (m) return m[1];
    }
    return "杭州";
  }
  function parseDistrict(loc) {
    const m = /(余杭|滨江|西湖|拱墅|上城|萧山|钱塘|临平|临安|富阳|桐庐|建德|淳安)/.exec(loc || "");
    return m ? m[1] + "区" : "";
  }
  function activityRank(t) {
    if (/刚刚|在线/.test(t)) return 3;
    if (/今日/.test(t)) return 2;
    if (/3日|三日|本周|7天/.test(t)) return 1;
    return 0;
  }

  /** Convert an array-of-arrays sheet into job objects. */
  function rowsToJobs(rows) {
    if (!rows || !rows.length) return [];
    const hdr = rows[0].map((h) => norm(h));
    const idx = {};
    hdr.forEach((h, i) => { if (h && idx[h] === undefined) idx[h] = i; });
    for (const need of ["岗位", "公司", "JD原文"]) {
      if (idx[need] === undefined) throw new Error("表格缺少「" + need + "」列");
    }
    const get = (r, k) => (idx[k] === undefined ? "" : r[idx[k]]);
    const jobs = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r[idx["岗位"]]) continue;
      const title = norm(r[idx["岗位"]]);
      const jd = cleanJd(r[idx["JD原文"]]);
      if (!title || !jd) continue;
      // the location cell usually repeats the city ("杭州 杭州西湖区…")
      const loc = norm(get(r, "工作地点")).replace(/^(杭州|上海|北京|深圳|广州)\s+/, "");
      const sched = norm(get(r, "实习安排"));
      const salRaw = norm(get(r, "薪资"));
      jobs.push({
        id: "j" + String(jobs.length + 1).padStart(3, "0"),
        t: title,
        c: norm(get(r, "公司")),
        city: parseCity(loc),
        dist: parseDistrict(loc),
        loc: loc.replace(/\n/g, " ").trim(),
        sal: parseSalary(salRaw),
        salRaw,
        days: parseDays(sched),
        months: parseMonths(sched),
        edu: parseDegree(norm(get(r, "经验学历")), jd),
        jd,
        act: activityRank(norm(get(r, "招聘者与活跃"))),
        actRaw: norm(get(r, "招聘者与活跃")),
      });
    }
    return jobs;
  }

  /** Read a workbook File into a dataset. Throws on anything unexpected. */
  async function fromWorkbook(file) {
    if (!root.XLSX) await root.JDResume.ensure.xlsx();
    if (!root.XLSX) throw new Error("表格解析组件加载失败");
    const buf = await file.arrayBuffer();
    let wb;
    try {
      wb = root.XLSX.read(buf, { type: "array" });
    } catch (e) {
      throw new Error("这个文件读不出来，请确认是没有加密的 .xlsx");
    }
    const name = wb.SheetNames.includes(SHEET) ? SHEET : wb.SheetNames[0];
    if (!name) throw new Error("工作簿里没有工作表");
    const rows = root.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false });
    const jobs = rowsToJobs(rows);
    if (jobs.length < 5) throw new Error("只解析到 " + jobs.length + " 个岗位，可能选错了表");
    return {
      meta: {
        name: "杭州互联网实习岗位",
        count: jobs.length,
        built: new Date().toISOString().slice(0, 10),
        source: file.name,
        custom: true,
      },
      jobs,
    };
  }

  // ---- persistence ----
  function saveCustom(ds) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(ds));
      return true;
    } catch (e) {
      return false; // quota exceeded: caller warns and keeps the bundled set
    }
  }
  function loadCustom() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const ds = JSON.parse(raw);
      return ds && ds.jobs && ds.jobs.length ? ds : null;
    } catch (e) {
      return null;
    }
  }
  function clearCustom() { localStorage.removeItem(LS_KEY); }

  async function loadBundled(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error("基础数据加载失败：" + res.status);
    return res.json();
  }

  root.JDData = { loadBundled, loadCustom, saveCustom, clearCustom, fromWorkbook, rowsToJobs, norm };
})(window);
