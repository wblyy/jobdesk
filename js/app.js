// Operator console.
// Wires the offline engine to the page: resume in, one job out, rewritten resume
// out. No network calls after the initial dataset fetch.

import * as JDLex from "./lexicon.js";
window.JDLex = JDLex;
await import("./engine.js");
await import("./dataset.js");
await import("./parse.js");
await import("./message.js");
await import("./verify.js");

const E = window.JDEngine;
const D = window.JDData;
const M = window.JDMessage;
const R = window.JDResume;

const $ = (id) => document.getElementById(id);
const LOG_KEY = "jobdesk.log.v1";
const SET_KEY = "jobdesk.settings.v1";

const state = {
  ds: null,           // { meta, jobs }
  jobs: [],           // indexed (starts as a prefix, fills in on idle)
  pending: [],        // jobs not yet indexed
  gen: 0,             // dataset generation, so a stale idle loop stops
  resume: null,       // parsed resume
  scored: [],         // sorted scores
  rank: 0,            // how far down the list the operator has clicked
  rec: null,          // current score object
  ev: null,           // evidence
  rw: null,           // rewrite
  log: [],            // this session's pushes [{company, title, at}]
  ready: false,       // false until the job index is built
};

/* ---------------- small helpers ---------------- */

let toastTimer = null;
function toast(msg, ms) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("on"), ms || 2200);
}

async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast((label || "已复制") + "，可以直接粘到企微");
  } catch (e) {
    // clipboard API needs a secure context; fall back to a selection
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    toast(ok ? (label || "已复制") : "复制失败，手动选一下文字");
  }
}

function ms(t) { return Math.round(t) + " ms"; }

/* ---------------- settings + log ---------------- */

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SET_KEY) || "{}") || {}; } catch (e) { return {}; }
}
function saveSettings(patch) {
  try { localStorage.setItem(SET_KEY, JSON.stringify({ ...loadSettings(), ...patch })); } catch (e) { /* quota */ }
}

function loadLog() {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]") || []; } catch (e) { return []; }
}
function saveLog() {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(state.log.slice(-60))); } catch (e) { /* quota */ }
}
function renderLog() {
  const box = $("stepLog");
  if (!state.log.length) { box.hidden = true; return; }
  box.hidden = false;
  $("logList").innerHTML = state.log.slice(-10).reverse().map((x) =>
    `<li><b>${esc(x.company)}</b> · ${esc(x.title)}<span>${esc(x.at)}</span></li>`
  ).join("");
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------- dataset ---------------- */

async function bootDataset() {
  const custom = D.loadCustom();
  const bundled = await D.loadBundled("data.jobs.json").catch(() => null);
  const ds = custom || bundled;
  if (!ds) {
    $("dbInfo").textContent = "岗位库加载失败";
    toast("岗位库加载失败，刷新试试");
    return;
  }
  applyDataset(ds, custom ? "custom" : "bundled");
}

// Indexing is the one slow step (~1.5-2.5 s for 330 JDs). It is split so the
// page is usable while it finishes: the first batch is indexed before the boot
// screen lifts, the rest is filled in on idle. A candidate who arrives during
// that window still gets a real recommendation from the first batch, and the
// list quietly extends behind them instead of the page appearing hung.
const FIRST_BATCH = 120;

async function applyDataset(ds, kind) {
  const t0 = performance.now();
  // Importing a new table while the old one is still indexing would interleave
  // two datasets in one array. Each build carries a generation number; a stale
  // idle loop sees it and stops.
  const gen = (state.gen || 0) + 1;
  state.gen = gen;
  state.ds = ds;
  const all = ds.jobs;

  const slice = all.slice(0, FIRST_BATCH);
  state.jobs = slice.map((j) => E.indexJob(j));
  state.pending = all.slice(FIRST_BATCH);
  const ms_ = performance.now() - t0;

  const m = ds.meta || {};
  $("dbInfo").textContent = `${m.count || ds.jobs.length} 个岗位 · ${m.built || "—"}${kind === "custom" ? " · 自建" : ""}`;
  $("dbDetail").innerHTML = `
    <p><b>${esc(m.name || "岗位库")}</b></p>
    <p class="muted">${m.count || ds.jobs.length} 个岗位 ｜ 数据日期 ${esc(m.built || "未标注")} ｜ 来源 ${esc(m.source || "内置")}</p>
    <p class="muted">已建索引 ${state.jobs.length} / ${all.length} 个岗位（${ms(ms_)}），其余空档时间补上</p>
    <p class="muted">${kind === "custom" ? "正在用你自己导入的表格。" : "正在用随包附带的表格。"}</p>`;
  saveSettings({ datasetKind: kind });
  state.ready = true;
  // a new database invalidates the current recommendation
  state.scored = [];
  state.rank = 0;
  $("stepMatch").hidden = true;
  $("stepRewrite").hidden = true;
  document.body.classList.remove("booting");
  if (state.resume) runMatch();
  indexRest(gen);
}

// Fill in the remaining jobs without blocking the first screen.
function indexRest(gen) {
  if (!state.pending || !state.pending.length) return;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 80));
  const step = () => {
    if (state.gen !== gen) return; // a newer table replaced this one
    const t0 = performance.now();
    // ~12 ms per slice keeps frames smooth on a phone; the whole rest takes
    // about six slices.
    while (state.pending.length && performance.now() - t0 < 12) {
      state.jobs.push(E.indexJob(state.pending.shift()));
    }
    if (state.pending.length) {
      idle(step, { timeout: 200 });
    } else if (state.resume && !state.rw && state.rank === 0) {
      // A resume that arrived mid-index was matched against a partial list.
      // Re-running is ~0.4 s and can only improve the answer — but only while
      // the operator is still on the first card. Swapping the recommendation
      // under someone who is already reading it is worse than a slightly
      // narrower shortlist.
      runMatch();
    }
  };
  idle(step, { timeout: 200 });
}

/* ---------------- resume ---------------- */

async function takeFile(file) {
  if (!file) return;
  const ext = (file.name || "").toLowerCase().split(".").pop();
  // First PDF/Word of the session downloads its reader (~1.5-4 MB); say so, or
  // the operator concludes the tool hung and closes the tab.
  const cold = !R.ready(ext);
  toast(cold ? "第一次读 " + ext.toUpperCase() + "，要下个解析组件，稍等" : "正在读取 " + file.name, cold ? 8000 : 2200);
  try {
    const out = await R.extract(file);
    useResumeText(out.text, out.warning, file.name);
  } catch (e) {
    toast(e.message || "读不了这个文件", 4200);
    if (e.code === "EMPTY") $("pasteWrap").open = true;
  }
}

function useResumeText(text, warning, sourceName) {
  text = String(text || "").trim();
  if (text.length < 40) { toast("文字太少了，至少把经历和技能写上"); return; }
  if (!state.ready) {
    // A cold index takes about a second; queue the resume instead of dropping it.
    toast("岗位库还在建索引，马上好");
    setTimeout(() => useResumeText(text, warning, sourceName), 300);
    return;
  }
  const t0 = performance.now();
  const res = E.parseResume(text);
  const parseMs = performance.now() - t0;
  state.resume = res;
  renderResumeInfo(res, sourceName, parseMs);
  if (warning) toast(warning, 5000);
  runMatch();
}

function renderResumeInfo(res, sourceName, parseMs) {
  const i = res.info;
  const roles = E.topRole(res).slice(0, 3).map((r) => E.LABEL.get(r.id)).filter(Boolean);
  const bits = [];
  if (i.name) bits.push("姓名 " + i.name);
  if (i.degree) bits.push(i.degree);
  if (i.gradYear) bits.push(i.gradYear + " 届");
  if (i.days) bits.push("每周 " + i.days + " 天");
  if (i.city) bits.push(i.city);
  bits.push(res.bullets.length + " 条经历");
  const box = $("resumeInfo");
  box.hidden = false;
  box.innerHTML = `
    <div class="ri-top">
      <span class="ri-file">${esc(sourceName || "粘贴的文字")}</span>
      <span class="ri-time">读取 ${ms(parseMs)}</span>
    </div>
    <p class="ri-bits">${esc(bits.join(" ｜ "))}</p>
    <p class="ri-roles">方向判定：${roles.length ? esc(roles.join("、")) : "没看出明确方向"}</p>
    ${res.bullets.length < 3 ? `<p class="ri-warn">只认出 ${res.bullets.length} 条经历，匹配会不准。最好把「实习经历 / 项目经历」保留成单独的段落。</p>` : ""}`;
}

/* ---------------- matching ---------------- */

function runMatch() {
  if (!state.resume || !state.jobs.length) return;
  const t0 = performance.now();
  state.scored = state.jobs.map((j) => E.scoreJob(state.resume, j)).sort(byBest);
  const ms_ = performance.now() - t0;
  state.rank = 0;
  showRank(ms_);
}

function byBest(a, b) {
  if (b.fit !== a.fit) return b.fit - a.fit;
  return (b.job.act || 0) - (a.job.act || 0);
}

// Among near-equal scores, prefer the one we can actually explain. A vacancy
// whose JD is two lines of boilerplate can outscore a real one on paper and
// still leave the operator with nothing to say to the candidate. Looking two
// places down costs ~2 ms and never skips past a material score gap
// (LOOKAHEAD_GAP), so this reorders neighbours, it does not override the ranking.
const LOOKAHEAD = 3;
const LOOKAHEAD_GAP = 0.05;

function chooseAt(list, rank) {
  const top = list[rank];
  if (!top) return null;
  let best = null;
  const end = Math.min(list.length, rank + LOOKAHEAD);
  for (let i = rank; i < end; i++) {
    const sc = list[i];
    if (top.fit - sc.fit > LOOKAHEAD_GAP && i > rank) break;
    const t0 = performance.now();
    const ev = E.explain(state.resume, sc, 3);
    const evMs = performance.now() - t0;
    const solid = ev.some((e) => e.role || E.CAT.get(e.concept) === "skill" || E.CAT.get(e.concept) === "method");
    if (!best) best = { sc, ev, evMs, at: i, solid };
    if (solid) return { sc, ev, evMs, at: i };
  }
  return best;
}

// Company recently pushed in this session goes to the back, so two days in a row
// do not land on the same employer.
function recentlyPushed(job) {
  return state.log.some((x) => x.company === job.c);
}

function showRank(ms_) {
  const list = state.scored.slice();
  if (state.log.length) {
    list.sort((a, b) => {
      const ra = recentlyPushed(a.job) ? 1 : 0;
      const rb = recentlyPushed(b.job) ? 1 : 0;
      if (ra !== rb) return ra - rb;
      return byBest(a, b);
    });
  }
  const pick = chooseAt(list, state.rank);
  if (!pick) return;
  // If the picker skipped a vacancy with nothing to say, continue from where it
  // landed — otherwise "换下一个" walks back into the one just skipped.
  state.rank = pick.at;
  const sc = pick.sc;
  const ev = pick.ev;
  const evMs = pick.evMs;
  state.rec = sc;
  state.ev = ev;
  state.rw = null;
  renderRec(sc, ev);
  $("stepMatch").hidden = false;
  $("stepRewrite").hidden = true;
  $("matchTiming").textContent = `匹配 ${ms(ms_)} · 找理由 ${ms(evMs)}`;
  $("altNote").textContent = `第 ${state.rank + 1} / ${Math.min(list.length, 30)} 个候选。下一个：${esc(list[state.rank + 1] ? list[state.rank + 1].job.t : "没有了")}`;
  $("btnNext").disabled = state.rank >= Math.min(list.length, 30) - 1;
  $("stepMatch").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderRec(sc, ev) {
  const j = sc.job;
  // District and street address, not the whole scraped location cell: the
  // operator reads this while typing to a candidate, and a mall address adds
  // nothing to the decision.
  const meta = [];
  if (j.dist) meta.push(j.dist);
  if (j.edu && j.edu !== "不限") meta.push(j.edu + "起");
  const sched = M.schedText(j);
  if (sched) meta.push(sched);
  meta.push(M.salaryText(j));

  // 档位直接来自 P3 的区间判定，不再另设阈值——两套阈值迟早会对不上，
  // 运营看到"很对口"却在下面读到"缺关键硬门槛"就不信这个工具了。
  const tier = sc.band;
  const tierClass = sc.score >= 85 ? "t-a" : sc.score >= 65 ? "t-b" : sc.score >= 45 ? "t-c" : "t-d";

  const evHtml = ev.map((e) => `
    <li>
      <div class="ev-jd"><span class="ev-tag">JD</span>${esc(e.jd)}</div>
      <div class="ev-res"><span class="ev-tag own">你</span>${esc(e.res)}</div>
    </li>`).join("");

  const miss = (ev.missing || []).length
    ? `<p class="rec-miss"><b>JD 要、简历没写：</b>${esc(ev.missing.join("、"))}</p>` : "";

  const caveats = (sc.caveats || []).length
    ? `<ul class="rec-caveat">${sc.caveats.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : "";

  // 判定依据：运营被候选人问"为什么是这个"时，要能一句话答上来。
  const dutyHit = sc.duties.length
    ? `核心职责 ${sc.duties.filter((d) => d.state !== "MISS").length}/${sc.duties.length} 条对得上`
    : "JD 没写清职责";
  const gateMiss = sc.gates.filter((g) => g.state === "MISS");
  const whyBits = [sc.reason, dutyHit];
  if (gateMiss.length) whyBits.push("硬门槛没过 " + gateMiss.length + " 条");

  $("rec").innerHTML = `
    <div class="rec-top">
      <div>
        <h3>${esc(j.c)}</h3>
        <p class="rec-title">${esc(j.t)}</p>
      </div>
      <span class="tier ${tierClass}">${tier}</span>
    </div>
    <p class="rec-meta">${esc(meta.join(" ｜ "))}</p>
    <p class="rec-why"><b>为什么是它</b>${esc(M.whyLine(sc, ev))}</p>
    <p class="rec-basis">${esc(whyBits.join("　·　"))}</p>
    ${j.loc ? `<p class="rec-addr">${esc(j.loc)}</p>` : ""}
    ${evHtml ? `<ul class="ev">${evHtml}</ul>` : `<p class="muted">JD 里没有能和你简历直接对上的一句。这条只能算方向对，推荐时别把话说满。</p>`}
    ${miss}
    ${caveats}
  `;
}

/* ---------------- rewrite ---------------- */

function doRewrite() {
  if (!state.rec) return;
  const t0 = performance.now();
  const rw = E.rewrite(state.resume, state.rec.job, state.ev);
  const ms_ = performance.now() - t0;
  state.rw = rw;
  $("resumeOut").textContent = rw.text;
  // 自检结果放最上面。这个面板有 62vh 的滚动区，放在七条改动说明下面，
  // 运营永远不会往下滚到它——那等于没做这个自检。
  $("changesOut").innerHTML = verifyHtml(rw.verify) + rw.changes.map((c) =>
    `<div class="chg"><b>${esc(c.k)}</b><p>${esc(c.v)}</p></div>`).join("");
  $("rewriteTiming").textContent = `改稿 ${ms(ms_)}`;
  $("stepRewrite").hidden = false;
  $("stepRewrite").scrollIntoView({ behavior: "smooth", block: "start" });

  state.log.push({
    company: state.rec.job.c,
    title: state.rec.job.t,
    at: new Date().toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }),
  });
  saveLog();
  renderLog();

  $("btnCopyResume").onclick = () => copy(rw.text, "简历已复制");
  $("btnCopyChanges").onclick = () => copy(M.changesText(rw), "改动说明已复制");
}

// P6 的结果单独一块。改稿说自己没问题不算证据，这里显示的是机械核对的结果：
// 公司名/时间/数字/每条原经历的归宿。有问题就挡在前面，不埋在正文里。
function verifyHtml(v) {
  if (!v) return "";
  const ok = v.verdict === "PASS";
  const cls = ok ? "v-pass" : v.verdict === "PASS_WITH_NOTES" ? "v-note" : "v-fail";
  const head = {
    PASS: "自检通过：公司名、起止时间、数字、每条原经历都对得上。",
    PASS_WITH_NOTES: "自检通过，有几处被压缩过，自己看一眼。",
    FAIL: "自检没过——这些地方不要直接发出去。",
    FAIL_UNVERIFIED: "自检无法完成——改稿内容太少。",
  }[v.verdict] || v.verdict;
  const bad = (v.blocked || []).slice(0, 6).map((b) => `<li>${esc(b)}</li>`).join("");
  const notes = (v.notes || []).slice(0, 3).map((b) => `<li>${esc(b)}</li>`).join("");
  const lost = (v.rows || []).filter((r) => r.verdict !== "保留" && r.verdict !== "段落保留·条目略").slice(0, 4)
    .map((r) => `<li><s>${esc(clip(r.orig, 40))}</s></li>`).join("");
  return `
    <div class="verify ${cls}">
      <b>${esc(head)}</b>
      ${bad ? `<ul class="v-bad">${bad}</ul>` : ""}
      ${notes ? `<ul class="v-note-list">${notes}</ul>` : ""}
      ${lost ? `<p class="v-lost-label">没有完整保留的原条目：</p><ul class="v-lost">${lost}</ul>` : ""}
    </div>`;
}

function clip(s, n) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/* ---------------- events ---------------- */

function wire() {
  $("btnPick").onclick = () => $("file").click();
  $("file").onchange = (e) => { takeFile(e.target.files[0]); e.target.value = ""; };

  const drop = $("drop");
  ["dragenter", "dragover"].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    takeFile(f);
  });

  $("btnPaste").onclick = () => {
    const t = $("paste").value || "";
    if (t.trim().length < 40) { toast("再多粘一点，至少要有经历"); return; }
    useResumeText(t, "", "粘贴的文字");
  };

  $("btnRewrite").onclick = doRewrite;
  $("btnNext").onclick = () => { state.rank += 1; showRank(0); };
  $("btnCopyRec").onclick = () => {
    if (!state.rec) return;
    copy(M.recommend(state.rec, state.ev, { resume: state.resume }), "推荐话术已复制");
  };

  $("btnData").onclick = () => $("dlgData").showModal();
  $("btnPickData").onclick = () => $("fileData").click();
  $("fileData").onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const msg = $("dataMsg");
    msg.textContent = "正在解析 " + f.name + " …";
    msg.className = "data-msg";
    try {
      const ds = await D.fromWorkbook(f);
      if (!D.saveCustom(ds)) {
        msg.textContent = "浏览器存储空间不够，这次先用着，换台机器要重新导入。";
        msg.className = "data-msg warn";
      } else {
        msg.textContent = `导入了 ${ds.jobs.length} 个岗位（${ds.meta.built}）。`;
        msg.className = "data-msg ok";
      }
      applyDataset(ds, "custom");
    } catch (err) {
      msg.textContent = err.message || "导入失败";
      msg.className = "data-msg warn";
    }
  };

  $("btnResetData").onclick = async () => {
    D.clearCustom();
    const bundled = await D.loadBundled("data.jobs.json");
    applyDataset(bundled, "bundled");
    $("dataMsg").textContent = "已恢复内置数据。";
    $("dataMsg").className = "data-msg ok";
  };

  $("btnResetLog").onclick = () => {
    if (!confirm("清空推过岗的记录？清空后同一个公司可能会再推一次。")) return;
    state.log = [];
    saveLog();
    renderLog();
  };
}

/* ---------------- boot ---------------- */

// PDF is the format candidates actually send. Downloading its reader while the
// page sits idle turns the first upload from 7 s into half a second. Skipped on
// metered or slow connections, where the download costs more than it saves.
function prefetchPdf() {
  const c = navigator.connection || {};
  if (c.saveData) return;
  if (c.effectiveType && /(^|-)2g$/.test(c.effectiveType)) return;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  idle(() => { R.ensure.pdf().catch(() => { /* first upload will retry */ }); }, { timeout: 4000 });
}

async function boot() {
  document.body.classList.add("booting");
  wire();
  state.log = loadLog();
  renderLog();
  await bootDataset();
  prefetchPdf();
}

boot();
