#!/usr/bin/env python3
"""Convert the job-list Excel into a compact JSON dataset for the web app.

Usage: python3 -I tools/build_data.py <xlsx> <out.json>

Only reads cells; never executes anything from the workbook.
"""
import json
import re
import sys
import unicodedata
import datetime

import openpyxl

CITY_RE = re.compile(r"(杭州|上海|北京|深圳|广州|南京|苏州|宁波|武汉|成都|西安|厦门|长沙|合肥|无锡)")
WS_RE = re.compile(r"[ \t 　]+")


def norm(v):
    if v is None:
        return ""
    s = str(v)
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    # join CJK chars split by stray spaces (scraped text artefact)
    s = re.sub(r"(?<=[一-龥])[ \t]+(?=[一-龥])", "", s)
    s = WS_RE.sub(" ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def clean_jd(s):
    s = norm(s)
    # common scrape artefact: spaces inside latin words e.g. "Pyth on"
    s = re.sub(r"(?<=[A-Za-z]) (?=[A-Za-z])", "", s)
    s = re.sub(r"(?<=[A-Za-z])(?=[一-龥])", " ", s)
    return s.strip()


def parse_days(text):
    m = re.search(r"(\d)\s*天\s*/\s*周", text) or re.search(r"每周(?:出勤)?\s*(\d)", text)
    return int(m.group(1)) if m else 0


def parse_months(text):
    m = re.search(r"时长\s*(\d+)\s*个月", text) or re.search(r"(\d+)\s*个月", text)
    return int(m.group(1)) if m else 0


def parse_salary(text):
    if not text or "未提供" in text:
        return None
    nums = [int(n) for n in re.findall(r"(\d{2,3})\s*[-~]\s*(\d{2,3})", text) for n in [n[0]]]
    m = re.search(r"(\d{2,3})\s*[-~]\s*(\d{2,3})", text)
    if m:
        return [int(m.group(1)), int(m.group(2))]
    m = re.search(r"(\d{3,5})\s*/\s*月", text)
    if m:
        v = int(m.group(1))
        return [round(v / 22), round(v / 22)]
    return None


def parse_degree(text, jd):
    blob = (text or "") + " " + (jd or "")
    for kw, val in (("博士", "博士"), ("硕士", "硕士"), ("研究生", "硕士"), ("本科", "本科"), ("大专", "大专")):
        if kw in (text or ""):
            return val
    if "学历不限" in (text or ""):
        return "不限"
    for kw, val in (("本科及以上", "本科"), ("本科以上", "本科"), ("硕士及以上", "硕士"), ("大专及以上", "大专")):
        if kw in (jd or ""):
            return val
    return "不限"


def parse_city(loc):
    for line in (loc or "").split("\n"):
        m = CITY_RE.search(line)
        if m:
            return m.group(1)
    return "杭州"


def parse_district(loc):
    m = re.search(r"(余杭|滨江|西湖|拱墅|上城|萧山|钱塘|临平|临安|富阳|桐庐|建德|淳安)", loc or "")
    return m.group(1) + "区" if m else ""


def activity_rank(text):
    t = text or ""
    if "刚刚" in t or "在线" in t:
        return 3
    if "今日" in t:
        return 2
    if "3日" in t or "三日" in t:
        return 1
    if "本周" in t or "7天" in t:
        return 1
    return 0


def main():
    src, out = sys.argv[1], sys.argv[2]
    wb = openpyxl.load_workbook(src, data_only=True)
    ws = wb["岗位清单"]
    rows = list(ws.iter_rows(values_only=True))
    hdr = rows[0]
    idx = {h: i for i, h in enumerate(hdr)}
    jobs = []
    for r in rows[1:]:
        if not r or not r[0]:
            continue
        title = norm(r[idx["岗位"]])
        company = norm(r[idx["公司"]])
        jd = clean_jd(r[idx["JD原文"]])
        if not title or not jd:
            continue
        # the location cell usually repeats the city ("杭州 杭州西湖区…")
        loc = re.sub(r"^(杭州|上海|北京|深圳|广州)\s+", "", norm(r[idx["工作地点"]]))
        sched = norm(r[idx["实习安排"]])
        salary_raw = norm(r[idx["薪资"]])
        sal = parse_salary(salary_raw)
        jobs.append({
            "id": "j%03d" % (len(jobs) + 1),
            "t": title,
            "c": company,
            "city": parse_city(loc),
            "dist": parse_district(loc),
            "loc": loc.replace("\n", " ").strip(),
            "sal": sal,
            "salRaw": salary_raw,
            "days": parse_days(sched),
            "months": parse_months(sched),
            "edu": parse_degree(norm(r[idx["经验学历"]]), jd),
            "jd": jd,
            "act": activity_rank(norm(r[idx["招聘者与活跃"]])),
            "actRaw": norm(r[idx["招聘者与活跃"]]),
        })
    meta = {
        "name": "杭州互联网实习岗位",
        "count": len(jobs),
        "built": datetime.date.today().isoformat(),
        "source": "杭州互联网实习岗位-334.xlsx",
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "jobs": jobs}, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote %d jobs -> %s" % (len(jobs), out))


if __name__ == "__main__":
    main()
