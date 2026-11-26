// Node harness: run the browser engine against sample resumes.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import * as JDLex from "../js/lexicon.js";

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, "..");

const win = { JDLex };
const ctx = vm.createContext(win);
win.window = win;
ctx.window = win;
vm.runInContext(fs.readFileSync(path.join(root, "js/engine.js"), "utf8"), ctx);
const E = win.JDEngine;

const data = JSON.parse(fs.readFileSync(path.join(root, "data.jobs.json"), "utf8"));
const t0 = performance.now();
const jobs = data.jobs.map((j) => E.indexJob(j));
console.log("indexed", jobs.length, "jobs in", (performance.now() - t0).toFixed(0), "ms");

const resumes = {
  product_ai: `张一诺
本科 浙江大学 信息管理与信息系统 2028届
电话 13800001111 邮箱 zhangyn@example.com
求职意向：产品经理实习生
教育背景
浙江大学 信息管理与信息系统 本科 2024.09-2028.06 GPA 3.7/4.0
专业技能
- 熟练使用 Figma、Axure、墨刀完成原型设计，能用 ProcessOn 画流程图
- 会写 PRD 与用户故事，熟悉需求评审流程
- 掌握 SQL 与 Excel，能独立做数据复盘和指标体系
- 使用过 Dify 搭建知识库问答智能体，写过 Prompt
实习经历
杭州某教育科技公司 产品实习生 2025.07-2025.09
1. 负责 K12 学习 App 的错题本功能需求调研，访谈 12 位学生与 5 位家长，输出调研报告
2. 独立撰写 PRD 与用户故事，配合研发排期推进上线，功能上线后周活跃使用率提升 18%
3. 每周用 SQL 拉取数据做功能使用漏斗分析，输出复盘文档给到产品负责人
校园经历
浙大创业社团 产品组负责人 2024.10-2025.06
- 主导校园二手交易小程序从 0 到 1，完成竞品分析与原型设计，上线两个月注册用户 2000+
- 用 Axure 做交互稿，协调 6 人团队按期交付
奖项荣誉
校级二等奖学金、互联网+省赛铜奖`,

  ops_content: `李思远
本科 浙江传媒学院 网络与新媒体 2027届
电话 13900002222
求职意向：新媒体运营 / 内容运营
教育背景
浙江传媒学院 网络与新媒体 本科 2023.09-2027.06
实习经历
杭州某 MCN 机构 新媒体运营实习生 2025.06-2025.10
1. 负责公司小红书账号日常运营，独立完成选题、文案撰写与发布，账号粉丝从 3000 涨到 2.1 万
2. 策划 3 次话题活动，单篇笔记最高曝光 46 万，互动率 8.2%
3. 每周跟踪平台流量趋势和热点话题，用灰豚数据复盘笔记数据，调整内容方向
4. 配合商务完成 KOL 对接与内容排期，跟进 20+ 达人的内容交付
校园经历
校学生会新媒体部 部长 2024.09-2025.06
- 运营学校公众号，负责内容策划与排版，单篇推文最高阅读 1.2 万
- 带 8 人团队完成校园活动拍摄与短视频剪辑，用剪映和 PR 完成后期
专业技能
- 熟练使用剪映、PR、PS，能独立完成短视频拍摄与剪辑
- 熟悉小红书、抖音、视频号的平台机制与用户特点
- 具备较强的文案能力与网感`,

  data_ana: `王皓
硕士 浙江工业大学 统计学 2027届
电话 13700003333
教育背景
浙江工业大学 应用统计 硕士 2024.09-2027.06
浙江工业大学 数学与应用数学 本科 2020.09-2024.06
实习经历
杭州某电商公司 数据分析实习生 2025.05-2025.09
1. 负责天猫店铺经营数据分析，用 SQL 取数、Excel 建模，搭建日销与转化率监控看板
2. 独立完成 618 大促复盘，归因分析定位到 3 个转化流失环节，给出优化建议被采纳
3. 设计 A/B 测试评估详情页改版效果，实验组转化率提升 6.4%
项目经历
用户流失预测项目 2024.10-2025.03
- 用 Python（pandas、sklearn）处理 20 万条用户行为数据，构建 XGBoost 流失预测模型，AUC 0.86
- 输出特征重要性分析，定位高流失风险人群，配合运营设计召回策略
专业技能
- SQL（MySQL/Hive）熟练，Python 数据分析（pandas/numpy/sklearn）
- Tableau、Excel 数据透视表，熟悉指标体系搭建与漏斗分析
- 掌握统计学假设检验、回归分析与 A/B 测试方法
奖项
全国大学生数学建模竞赛省一等奖`,

  algo_dev: `陈默
本科 杭州电子科技大学 计算机科学与技术 2027届
电话 13600004444
教育背景
杭州电子科技大学 计算机科学与技术 本科 2023.09-2027.06 GPA 3.8/4.0
专业技能
- 熟练 Python、Java、C++，了解 Go
- 熟悉 PyTorch，做过 LoRA 微调与 RAG 检索增强项目
- 掌握 Linux、Docker、Git，会用 FastAPI 写服务
- 了解 Transformer 原理，熟悉 LangChain、向量数据库（FAISS）
项目经历
企业内部知识库问答机器人 2025.03-2025.08
- 独立开发基于 RAG 的问答系统，用 LangChain + FAISS + Qwen 模型，回答准确率从 62% 提升到 84%
- 设计分块策略与 Prompt 模板，负责召回与重排逻辑优化
- 用 FastAPI 封装接口，Docker 部署上线，服务 200+ 内部员工
多智能体客服系统 2025.09-2025.11
- 基于 Multi-Agent 架构拆分意图识别、检索、回复三个 Agent，用工具调用完成订单查询
- 负责 Agent 编排与评测集构建，整理 300 条测试用例
实习经历
杭州某 AI 创业公司 算法实习生 2025.06-2025.09
1. 参与大模型 Agent 应用开发，负责 Prompt 工程与工具调用链路调试
2. 搭建模型效果评测流程，对比 5 个开源模型在业务场景下的表现
奖项
ACM 校赛银奖、蓝桥杯省一`,

  design_ui: `赵雨晴
本科 中国美术学院 视觉传达设计 2027届
电话 13500005555
教育背景
中国美术学院 视觉传达设计 本科 2023.09-2027.06
实习经历
杭州某互联网公司 UI 设计实习生 2025.07-2025.10
1. 负责电商 App 首页与详情页的视觉设计，输出 40+ 张高保真设计稿
2. 参与设计规范搭建，整理组件库与配色方案，提升设计交付效率
3. 配合运营完成大促主视觉与 banner 设计，支持 618 活动上线
项目经历
游戏化记账 App 设计 2025.03-2025.06
- 独立完成从用户调研到交互稿再到视觉稿的全流程设计
- 用 Figma 输出可交互原型，做 8 人用户测试并迭代 3 版
- 运用插画与动效设计提升趣味性，获校级设计展优秀作品
专业技能
- 熟练 Photoshop、Illustrator、Figma、C4D
- 会使用 AE 做简单动效，了解设计规范与组件化
- 具备手绘插画能力`,

  game_design: `孙浩
本科 浙江理工大学 数字媒体技术 2028届
电话 13400006666
教育背景
浙江理工大学 数字媒体技术 本科 2024.09-2028.06
项目经历
独立开发 Roguelike 卡牌游戏 2025.01-2025.08
- 负责系统策划与数值设计，设计 120 张卡牌与 3 套成长曲线
- 用 Unity 完成核心玩法原型开发，C# 编写战斗逻辑
- 组织 30 人内测，根据玩家反馈迭代 4 个版本，次日留存从 32% 提升到 45%
Game Jam 参赛作品《回声》 2025.05
- 48 小时内完成关卡策划与剧情文案，团队获赛区最佳创意奖
实习经历
杭州某游戏公司 游戏策划实习生 2025.07-2025.09
1. 参与二次元手游的版本活动策划，输出活动方案与配置表
2. 负责玩家社区反馈整理，输出每周玩家舆情分析
专业技能
- 熟练使用 Unity、Excel 配置表、Axure
- 熟悉 FPS、二次元、Roguelike 品类，深度玩家，Steam 游戏时长 2000+
- 了解游戏数值设计与关卡设计方法论
奖项
中国大学生游戏设计大赛三等奖`,
};

for (const [key, text] of Object.entries(resumes)) {
  const res = E.parseResume(text);
  const scored = jobs.map((j) => E.scoreJob(res, j)).sort((a, b) => b.fit - a.fit);
  const top = scored.slice(0, 5);
  console.log("\n" + "=".repeat(78));
  console.log(key, "| degree:", res.info.degree, "| grad:", res.info.gradYear, "| bullets:", res.bullets.length);
  console.log("roles:", E.topRole(res).slice(0, 5).map((r) => E.LABEL.get(r.id) + ":" + r.w.toFixed(1)).join(", "));
  for (const s of top) {
    console.log(`  ${(s.fit * 100).toFixed(1).padStart(5)}  ${s.job.c} · ${s.job.t.slice(0, 34)}  [${s.job.edu}/${s.job.days}天]`);
    if (s.caveats.length) console.log("         ! " + s.caveats.join(" / "));
  }
  const ev = E.explain(res, top[0], 3);
  console.log("  -- evidence for #1:");
  for (const e of ev) console.log(`     [${e.label}] JD: ${e.jd.slice(0, 50)}\n              RES: ${e.res.slice(0, 60)}`);
  const rw = E.rewrite(res, top[0].job, ev);
  console.log("  -- rewritten resume (first 900 chars):\n" + rw.text.slice(0, 900));
  console.log("  -- changes:", rw.changes.map((c) => c.k).join(" | "), "| missing:", rw.missing.join(","));
}
