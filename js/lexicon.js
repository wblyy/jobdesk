// Concept lexicon: the semantic core of matching and rewriting.
// Each row: [id, label, category, aliases[], parent?]
// category: role | skill | domain | method | trait
// parent: sibling concept used for partial credit (0.55x)

export const LEX = [
  // ---------- roles ----------
  ["pm", "产品经理", "role", ["产品经理", "产品实习生", "产品助理", "产品岗", "产品规划", "产品设计"], null],
  ["pm_ai", "AI产品", "role", ["ai产品", "ai 产品", "智能体产品", "大模型产品", "agent产品", "ai产品经理", "ai应用产品"], "pm"],
  ["pm_data", "数据产品", "role", ["数据产品", "bi产品", "数据平台产品", "指标平台"], "pm"],
  ["pm_b", "B端产品", "role", ["b端产品", "tob产品", "saas产品", "后台产品", "管理后台", "中台产品"], "pm"],
  ["pm_growth", "增长产品", "role", ["增长产品", "增长黑客", "用户增长产品"], "pm"],
  ["ops", "运营", "role", ["运营实习生", "运营岗", "运营助理", "运营专员", "日常运营", "运营策略"], null],
  ["ops_content", "内容运营", "role", ["内容运营", "内容策划", "文案撰写", "文案", "新媒体运营", "新媒体内容", "新媒体", "公众号", "内容生态", "选题"], "ops"],
  ["ops_user", "用户运营", "role", ["用户运营", "社群运营", "私域", "会员运营", "用户分层", "私域流量"], "ops"],
  ["ops_ec", "电商运营", "role", ["电商运营", "店铺运营", "天猫运营", "京东运营", "淘系", "拼多多运营", "网店运营"], "ops"],
  ["ops_live", "直播运营", "role", ["直播运营", "直播间", "主播", "场控", "跟播", "开播", "带货"], "ops"],
  ["ops_xhs", "小红书运营", "role", ["小红书", "种草", "笔记", "蒲公英"], "ops_content"],
  ["ops_dy", "抖音运营", "role", ["抖音", "dou+", "巨量", "千川", "短视频运营", "视频号"], "ops_content"],
  ["ops_cross", "跨境电商", "role", ["跨境电商", "跨境", "亚马逊", "amazon", "独立站", "tiktok shop", "temu", "shein", "速卖通", "shopee", "listing", "海外仓"], "ops_ec"],
  ["ops_game", "游戏运营", "role", ["游戏运营", "游戏社区", "生态运营", "版本运营", "活动运营"], "ops"],
  ["ops_activity", "活动运营", "role", ["活动运营", "活动策划", "策划活动", "campaign"], "ops"],
  ["ops_platform", "平台运营", "role", ["平台运营", "商家运营", "类目运营", "招商", "渠道运营"], "ops"],
  ["ops_supply", "供给/商家运营", "role", ["供给", "商家拓展", "bd商家", "货源"], "ops_platform"],
  ["data_ana", "数据分析", "role", ["数据分析", "数据实习生", "业务分析", "经营分析", "数据运营", "bi分析", "指标体系", "数据洞察", "fde"], null],
  ["data_eng", "数据开发", "role", ["数据开发", "数仓", "数据工程", "etl", "数据管线", "数据pipeline", "数据链路"], null],
  ["data_label", "数据标注采集", "role", ["数据标注", "数据采集", "数采", "标注", "数据清洗", "打标"], null],
  ["algo", "算法", "role", ["算法实习生", "算法工程", "机器学习", "深度学习", "模型训练", "算法优化"], null],
  ["algo_llm", "大模型算法", "role", ["大模型", "llm", "基座模型", "sft", "rlhf", "微调", "预训练", "后训练"], "algo"],
  ["algo_agent", "Agent算法", "role", ["agent", "智能体", "多智能体", "multi-agent", "agentic", "harness", "工具调用"], "algo_llm"],
  ["algo_cv", "视觉/多模态算法", "role", ["计算机视觉", "多模态", "图像生成", "视频生成", "aigc", "世界模型", "扩散模型", "embedding"], "algo"],
  ["algo_rec", "搜广推算法", "role", ["推荐算法", "搜索算法", "广告算法", "搜广推", "召回", "排序", "ctr预估"], "algo"],
  ["be", "后端开发", "role", ["后端开发", "后端实习生", "服务端", "java开发", "golang", "go后端", "java后端", "python后端", "开发实习生", "研发实习生"], null],
  ["fe", "前端开发", "role", ["前端开发", "前端实习生", "web前端", "h5", "小程序开发", "vue", "react", "next.js"], null],
  ["client", "客户端开发", "role", ["客户端开发", "android", "ios", "移动端开发", "flutter", "鸿蒙"], null],
  ["fullstack", "全栈开发", "role", ["全栈", "full stack", "全栈开发", "ai全栈"], null],
  ["qa", "测试", "role", ["测试实习生", "软件测试", "测试开发", "功能测试", "自动化测试", "测试工程师", "质量保障", "测试用例"], null],
  ["sre", "运维/实施", "role", ["运维", "sre", "实施", "技术支持", "系统实施", "交付工程师", "部署"], null],
  ["ui", "UI/视觉设计", "role", ["ui设计", "视觉设计", "平面设计", "美工", "ui实习生", "插画", "动效设计", "主视觉", "设计实习生", "视觉实习生", "界面设计", "高保真", "ui界面", "设计稿", "视觉稿"], null],
  ["ux", "交互/用研", "role", ["交互设计", "用户体验", "ux", "用研", "用户研究", "体验设计"], null],
  ["game_design", "游戏策划", "role", ["游戏策划", "系统策划", "数值策划", "关卡策划", "剧情策划", "文案策划", "战斗策划", "玩法策划", "策划实习生"], "d_game"],
  ["game_art", "游戏美术", "role", ["游戏美术", "地编", "特效", "原画", "3d美术", "角色建模"], null],
  ["game_dev", "游戏开发", "role", ["游戏开发", "u3d", "unity", "ue4", "ue5", "游戏客户端", "游戏服务端"], null],
  ["video", "视频/剪辑", "role", ["剪辑", "拍摄", "视频制作", "后期", "摄影", "混剪", "分镜"], null],
  ["mkt", "市场/品牌", "role", ["市场营销", "品牌", "公关", "pr实习", "媒介", "广告", "市场部", "营销实习生", "marketing"], null],
  ["growth_mkt", "投放/增长", "role", ["投放", "信息流", "效果广告", "获客", "买量", "geo", "seo", "sem"], null],
  ["bd", "商务/渠道", "role", ["商务", "渠道", "bd", "kol", "达人", "mcn", "签约", "招商"], null],
  ["hr", "人力资源", "role", ["hr实习", "招聘实习", "校招", "简历筛选", "面试安排", "mapping", "人才地图", "员工关系", "hrbp"], null],
  ["ai_app", "AI应用落地", "role", ["ai应用", "ai落地", "fde", "场景落地", "提示词工程", "prompt工程", "智能体搭建", "dify", "coze"], null],
  ["hardware", "硬件/机器人", "role", ["硬件", "机器人", "具身智能", "嵌入式", "vr", "ar", "遥操作", "传感器"], null],
  ["customer", "客服/支持", "role", ["客服", "用户支持", "售前", "售后", "工单"], null],
  ["consult", "咨询/方案", "role", ["咨询", "解决方案", "行业研究", "战略分析"], null],

  // ---------- skills ----------
  ["py", "Python", "skill", ["python", "pandas", "numpy", "flask", "django", "fastapi", "beautifulsoup"]],
  ["java", "Java", "skill", ["java", "spring", "springboot", "mybatis", "jvm"]],
  ["js", "JavaScript/TS", "skill", ["javascript", "js", "typescript", "ts", "node.js", "nodejs", "es6"]],
  ["cpp", "C/C++", "skill", ["c++", "c语言", "cpp", "stl"]],
  ["go", "Golang", "skill", ["golang", "go语言"]],
  ["sql", "SQL", "skill", ["sql", "mysql", "postgresql", "hivesql", "clickhouse", "数据库查询"]],
  ["excel", "Excel", "skill", ["excel", "vlookup", "数据透视", "表格处理", "函数公式"]],
  ["ppt", "PPT/汇报材料", "skill", ["ppt", "powerpoint", "keynote", "汇报材料", "可视化报告"]],
  ["figma", "Figma", "skill", ["figma", "sketch", "mastergo", "即时设计", "组件库", "设计系统", "design system"]],
  ["prototype", "原型工具", "skill", ["axure", "墨刀", "processon", "xmind", "原型图", "原型设计", "流程图"]],
  ["adobe", "设计/剪辑软件", "skill", ["ps", "photoshop", "illustrator", "after effects", "premiere", "pr剪辑", "ae动效", "剪映", "capcut", "达芬奇", "lightroom"]],
  ["bi", "BI/埋点", "skill", ["tableau", "powerbi", "power bi", "finebi", "quickbi", "神策", "growingio", "埋点", "数据看板"]],
  ["bigdata", "大数据组件", "skill", ["spark", "flink", "hadoop", "kafka", "hbase", "doris", "hive", "dataworks", "maxcompute"]],
  ["ml", "机器学习", "skill", ["pytorch", "tensorflow", "sklearn", "scikit-learn", "xgboost", "lightgbm", "transformer", "神经网络"]],
  ["llm_tech", "大模型技术栈", "skill", ["rag", "langchain", "llamaindex", "向量数据库", "faiss", "milvus", "lora", "dify", "coze", "扣子", "n8n", "mcp", "openai api", "qwen", "llama"]],
  ["prompt", "Prompt工程", "skill", ["prompt", "提示词", "chain-of-thought", "few-shot", "few shot", "system prompt"]],
  ["git", "Git", "skill", ["git", "github", "gitlab", "版本管理"]],
  ["linux", "Linux/Docker", "skill", ["linux", "docker", "kubernetes", "k8s", "shell脚本", "nginx"]],
  ["api", "API对接", "skill", ["restful", "api", "接口文档", "sdk", "openapi", "webhook", "接口联调"]],
  ["crawler", "爬虫", "skill", ["爬虫", "scrapy", "selenium", "playwright", "反爬", "数据抓取"]],
  ["qe", "测试工具", "skill", ["jira", "postman", "jmeter", "禅道", "testlink", "缺陷管理", "断言"]],
  ["d3", "3D/引擎", "skill", ["blender", "c4d", "maya", "3dsmax", "zbrush", "unreal", "ue5", "犀牛", "keyshot"]],
  ["stat", "统计/实验", "skill", ["统计学", "假设检验", "回归分析", "abtest", "a/b test", "a/b测试", "ab test", "聚类", "显著性"]],
  ["lang", "外语", "skill", ["英语", "english", "雅思", "托福", "cet-6", "六级", "四六级", "阿拉伯语", "日语", "韩语", "法语", "西班牙语"]],
  ["writing", "写作能力", "skill", ["写作", "文案能力", "稿件", "脚本撰写", "长文", "专栏"]],
  ["pres", "表达演示", "skill", ["演讲", "路演", "主持", "答辩", "汇报"]],
  ["aigc_tool", "AIGC工具", "skill", ["midjourney", "stable diffusion", "sd", "comfyui", "sora", "可灵", "即梦", "runway", "chatgpt", "claude", "gemini"]],
  ["office", "办公协作", "skill", ["飞书", "钉钉", "企业微信", "confluence", "notion", "协同文档"]],

  // ---------- domains ----------
  ["d_ec", "电商", "domain", ["电商", "天猫", "淘宝", "京东", "拼多多", "类目", "gmv", "转化率", "客单价", "大促", "618", "双11", "动销"]],
  ["d_live", "直播", "domain", ["直播", "开播", "直播间", "主播", "带货"]],
  ["d_content", "内容/短视频", "domain", ["短视频", "视频号", "b站", "bilibili", "up主", "二创", "漫剧", "内容平台", "小红书"]],
  ["d_game", "游戏", "domain", ["游戏", "手游", "端游", "玩家", "fps", "二次元", "版本更新", "电竞"]],
  ["d_ai", "AI/大模型", "domain", ["ai", "人工智能", "大模型", "aigc", "生成式", "智能体", "agent", "机器学习"]],
  ["d_edu", "教育", "domain", ["教育", "课程", "教研", "k12", "留学", "培训", "知识付费"]],
  ["d_medical", "医疗", "domain", ["医疗", "医院", "临床", "问诊", "病历", "his", "慢病", "药品"]],
  ["d_fin", "金融", "domain", ["金融", "支付", "风控", "信贷", "证券", "保险", "理财", "银行"]],
  ["d_local", "本地生活", "domain", ["本地生活", "团购", "到店", "外卖", "餐饮", "酒店", "旅游", "到店"]],
  ["d_saas", "SaaS/ToB", "domain", ["saas", "tob", "企业服务", "政企", "行业解决方案", "b端客户"]],
  ["d_social", "社交/社区", "domain", ["社交", "社区", "用户画像", "兴趣社区"]],
  ["d_car", "汽车/出行", "domain", ["汽车", "新能源", "智能座舱", "出行", "车企"]],
  ["d_global", "出海", "domain", ["出海", "海外", "东南亚", "中东", "欧美市场", "国际化"]],
  ["d_3d", "3D/空间", "domain", ["3d", "空间设计", "渲染", "建模", "家装", "工业设计", "数字孪生"]],
  ["d_hr", "招聘/HR", "domain", ["招聘", "人才", "候选人", "面试"]],
  ["d_gov", "政务", "domain", ["政务", "政府", "公共服务", "智慧城市"]],
  ["d_hardware", "硬件/制造", "domain", ["硬件", "制造", "供应链", "工厂", "设备"]],
  ["d_tool", "工具/效率", "domain", ["效率工具", "办公工具", "生产力", "开发者工具"]],
  ["d_media", "广告/营销", "domain", ["投放", "广告", "营销", "品牌", "传播"]],
  ["d_ent", "影视/娱乐", "domain", ["影视", "综艺", "动漫", "娱乐", "ip"]],
  ["d_campus", "校园/学生", "domain", ["校园", "学生", "社团", "高校", "校招"]],

  // ---------- methods ----------
  ["m_research", "用户调研", "method", ["用户调研", "问卷", "访谈", "深访", "焦点小组", "用户画像", "需求调研", "用户反馈"]],
  ["m_compete", "竞品/行业研究", "method", ["竞品分析", "竞品", "行业研究", "mapping", "市场调研", "行业分析", "调研报告"]],
  ["m_prd", "PRD/需求", "method", ["prd", "需求文档", "用户故事", "需求分析", "需求评审", "验收标准", "需求拆解", "产品需求", "需求规格", "需求梳理", "需求收集", "需求撰写"]],
  ["m_flow", "流程/原型", "method", ["流程图", "信息架构", "交互稿", "wireframe", "页面结构", "信息结构"]],
  // Game design vocabulary. Without it a 游戏策划 match has no method-level
  // evidence to quote, and the tool falls back to "方向对，细节自己说" for a
  // candidate who literally designed 120 张卡牌 and 3 套成长曲线.
  ["m_game_design", "玩法与系统设计", "method", ["数值设计", "系统设计", "系统拆解", "关卡设计", "玩法设计", "成长曲线", "战斗逻辑", "策划文档", "卡牌设计", "内测"]],
  ["m_ana", "数据分析方法", "method", ["数据复盘", "指标体系", "漏斗", "留存", "转化分析", "归因", "数据看板", "数据监控", "数据洞察"]],
  ["m_ab", "A/B实验", "method", ["a/b测试", "abtest", "ab test", "实验设计", "灰度", "实验组"]],
  ["m_growth", "增长方法", "method", ["拉新", "促活", "裂变", "私域运营", "社群运营", "留存提升", "用户分层"]],
  ["m_content", "内容方法", "method", ["选题", "脚本", "爆款", "账号运营", "涨粉", "内容规划", "选题会", "内容矩阵"]],
  ["m_camp", "活动策划", "method", ["活动策划", "活动执行", "策划方案", "活动落地", "线下活动"]],
  ["m_ad", "投放优化", "method", ["素材优化", "出价", "roi", "cpa", "ctr", "信息流投放", "投放策略", "账户优化"]],
  ["m_ec_ops", "店铺运营方法", "method", ["上架", "选品", "标题优化", "评价管理", "补货", "库存", "活动报名", "直通车"]],
  ["m_test", "测试方法", "method", ["测试用例", "接口测试", "性能测试", "回归测试", "缺陷跟踪", "自动化脚本", "冒烟测试"]],
  ["m_dev", "工程实践", "method", ["代码review", "单元测试", "性能优化", "架构设计", "技术方案", "问题排查", "重构"]],
  ["m_mlops", "模型工程", "method", ["模型评估", "推理优化", "量化", "模型部署", "评测", "数据清洗", "打标", "训练 pipeline"]],
  ["m_proj", "项目管理", "method", ["项目管理", "跨部门", "多线程", "排期", "协同", "推进落地", "需求管理"]],
  ["m_doc", "文档与协作", "method", ["文档整理", "会议纪要", "资料整理", "知识库"]],
  ["m_review", "复盘汇报", "method", ["复盘", "汇报", "周报", "分析报告", "总结"]],
  ["m_visual", "视觉产出", "method", ["海报", "banner", "主视觉", "排版", "配色", "设计规范", "视觉稿", "详情页", "主图"]],
  ["m_shoot", "拍摄制作", "method", ["拍摄", "运镜", "调色", "字幕", "混剪", "布光"]],
  ["m_data_gen", "数据生产", "method", ["数据生产", "数据合成", "数据构造", "语料", "标注规范", "数据质量"]],
  ["m_ba", "业务分析", "method", ["业务分析", "流程梳理", "业务调研", "需求收集", "痛点分析"]],
  ["m_uat", "验收交付", "method", ["验收", "交付", "客户培训", "上线跟进", "问题闭环"]],

  // ---------- traits ----------
  ["s_learn", "学习能力", "trait", ["学习能力", "快速学习", "自学", "上手快"]],
  ["s_comm", "沟通协作", "trait", ["沟通", "协作", "表达能力", "跨团队"]],
  ["s_exec", "执行力", "trait", ["执行力", "责任心", "抗压", "细致", "认真", "踏实"]],
  ["s_logic", "逻辑思维", "trait", ["逻辑", "结构化", "分析能力"]],
  ["s_owner", "自驱", "trait", ["自驱", "主动", "owner意识", "好奇心", "热情"]],
  ["s_sense", "网感/敏感度", "trait", ["网感", "热点", "行业敏感", "洞察", "审美"]],
];

export const CAT_W = { role: 3.0, skill: 1.9, domain: 1.5, method: 1.6, trait: 0.25 };

export const BY_ID = new Map(LEX.map((r) => [r[0], r]));
export const PARENT = new Map(LEX.map((r) => [r[0], r[4] || null]));
export const CAT = new Map(LEX.map((r) => [r[0], r[2]]));
export const LABEL = new Map(LEX.map((r) => [r[0], r[1]]));

// Trie over alias strings, keyed by char code. Walking the text once beats
// scanning ~900 aliases separately; keying by numeric code (not single-char
// strings) keeps 330 JDs indexing in ~100ms instead of ~2s.
// `next` is a plain array indexed by char code: null-prototype object lookups
// in this loop cost 30x what array indexing does.
const NODE = () => ({ next: new Map(), ids: null });
const ROOT = NODE();
// Uint8Array of "can this char start any alias?" — a typed-array index beats a
// Map lookup by ~30x, and it lets the scanner skip the ~75% of characters that
// cannot begin a concept at all.
const START = new Uint8Array(65536);
for (const [id, label, cat, aliases] of LEX) {
  const seen = new Set();
  for (const a of [label, ...aliases]) {
    const key = a.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    START[key.charCodeAt(0)] = 1;
    let node = ROOT;
    for (let k = 0; k < key.length; k++) {
      const c = key.charCodeAt(k);
      if (c === 32) continue; // aliases match with or without inner spaces
      let nx = node.next.get(c);
      if (!nx) node.next.set(c, (nx = NODE()));
      node = nx;
    }
    // an alias may map to several concepts; keep all of them
    node.ids = node.ids || [];
    if (!node.ids.includes(id)) node.ids.push(id);
  }
}

// ascii letter or digit, by char code (no string/regex allocation in the hot loop)
const isAlnum = (c) => (c >= 97 && c <= 122) || (c >= 48 && c <= 57);

// "PS、AI" / "AI/PS" in a designer's skill list is Adobe Illustrator, not
// artificial intelligence. Left alone, every design resume reads as an AI
// candidate, and the tool quotes that back as proof of fit.
const ADOBE_BEFORE = /(?:^|[^a-z])(ps|id|adobe)[\s、\/,，和及]*$/;
function isAdobeAI(text, s, e, id) {
  if (id !== "d_ai" || e - s !== 2) return false;
  return ADOBE_BEFORE.test(text.slice(Math.max(0, s - 5), s).toLowerCase());
}

/**
 * Scan text for concepts. Returns Map<id, {count, hits: string[]}>
 * Longest-match-wins: once a longer alias consumes a span, shorter overlapping
 * aliases are skipped, so "跨境电商运营" does not also fire "电商".
 */
export function scan(text, opts = {}) {
  const low = (text || "").toLowerCase();
  if (!low) return opts.spans ? [] : new Map();
  const n = low.length;
  const wantSpans = opts.spans === true;
  const found = wantSpans ? null : new Map();
  const spans = wantSpans ? [] : null;
  const maxHits = opts.maxHits || 6;
  const wantHits = opts.hits !== false;
  let i = 0;
  while (i < n) {
    const c0 = low.charCodeAt(i);
    if (START[c0] === 0) { i += 1; continue; }
    let node = ROOT;
    let j = i;
    let bestEnd = -1;
    let bestIds = null;
    while (j < n) {
      const cj = low.charCodeAt(j);
      // spaces inside an alias are ignored: "UI 设计实习生" must match "ui设计"
      if (cj === 32) {
        if (node === ROOT) break;
        j++;
        continue;
      }
      const nx = node.next.get(cj);
      if (nx === undefined) break;
      node = nx;
      j++;
      if (node.ids) {
        // ascii aliases must sit on word boundaries ("ai" is not "email")
        if (isAlnum(low.charCodeAt(i))) {
          if (!isAlnum(low.charCodeAt(i - 1)) && !(j < n && isAlnum(low.charCodeAt(j)))) {
            bestEnd = j; bestIds = node.ids;
          }
        } else {
          bestEnd = j; bestIds = node.ids;
        }
      }
    }
    if (bestEnd > i) {
      if (wantSpans) {
        for (const id of bestIds) {
          if (isAdobeAI(low, i, bestEnd, id)) continue;
          spans.push({ id, s: i, e: bestEnd });
        }
      } else {
        for (const id of bestIds) {
          if (isAdobeAI(low, i, bestEnd, id)) continue;
          const rec = found.get(id) || { count: 0, hits: [] };
          rec.count += 1;
          if (wantHits && rec.hits.length < maxHits) {
            const s = Math.max(0, i - 18);
            const e = Math.min(text.length, bestEnd + 30);
            rec.hits.push(text.slice(s, e).replace(/\s+/g, " ").trim());
          }
          found.set(id, rec);
        }
      }
      i = bestEnd;
    } else {
      i += 1;
    }
  }
  return wantSpans ? spans : found;
}

/** Convert a concept Map into weights 0..1 with smoothing. */
export function toWeights(map, { half = 2 } = {}) {
  const out = new Map();
  for (const [id, rec] of map) {
    out.set(id, rec.count / (rec.count + half)); // saturating
  }
  return out;
}
