// 追踪条目适配器（第 4 层）验收测试
//
// 这一层要保证两件事：
//   1. 渲染层拿到的永远是同一种 entry 形状，不需要知道分类形态
//   2. 新增一种内置分类时，只在 CAT_ADAPTERS 里加一条就能被三个页面渲染出来
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n');

function makeEl(id) {
  const cls = new Set();
  const el = {
    id, value: '', style: {}, options: [], checked: false, files: [], _html: '', _text: '', disabled: false,
    classList: {
      add(c) { cls.add(c); }, remove(c) { cls.delete(c); },
      toggle(c, force) {
        if (force === undefined) { cls.has(c) ? cls.delete(c) : cls.add(c); }
        else if (force) cls.add(c); else cls.delete(c);
      },
      contains(c) { return cls.has(c); }
    },
    _cls: cls,
    focus() {}, blur() {}, click() {}, appendChild() {}, remove() {}, setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return makeEl('x'); }, querySelectorAll() { return []; }
  };
  Object.defineProperty(el, 'textContent', { get() { return el._text; }, set(v) { el._text = String(v); }, configurable: true });
  Object.defineProperty(el, 'innerHTML', { get() { return el._html; }, set(v) { el._html = String(v); }, configurable: true });
  return el;
}
const store = {}, els = {};
const getEl = id => (els[id] || (els[id] = makeEl(id)));
const sandbox = {
  document: {
    getElementById: getEl, querySelector: () => makeEl('q'), querySelectorAll: () => [],
    createElement: () => makeEl('c'), addEventListener() {}, body: makeEl('b'), documentElement: makeEl('h'), visibilityState: 'visible'
  },
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } },
  navigator: { userAgent: 'node' }, location: { href: 'file:///t' },
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve([]), text: () => Promise.resolve('') }),
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  console, confirm: () => true, alert() {},
  Blob: class { constructor(p) { this.p = p; } }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  Intl, Date, Math, JSON, Number, String, Array, Object, Set, Map, RegExp, parseFloat, parseInt, isNaN, isFinite,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox); vm.runInContext(code, sandbox, { filename: 'app.js' });
sandbox.escapeHtml = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const S = sandbox;
const G = expr => vm.runInContext(expr, sandbox);
const CK = () => getEl('checkinList').innerHTML;
const ST = () => getEl('statsList').innerHTML;
const MG = () => getEl('manageList').innerHTML;
const PC = () => String(getEl('progressCount').innerHTML).replace(/<[^>]+>/g, '');

const today = new Date(); today.setHours(0, 0, 0, 0);
const TK = S.formatDate(today);
const DIET_CAT = (extra) => Object.assign({
  id: 'builtin_diet', builtin: 'diet', name: '饮食记录', archived: false, enabled: true, countInStats: true, items: []
}, extra || {});

function seed(dietExtra) {
  Object.keys(els).forEach(k => delete els[k]);
  store['checkin_app_data'] = JSON.stringify({
    categories: [
      { id: 'c1', name: '健康', archived: false, countInStats: true, items: [
        { id: 'i1', name: '早起', archived: false },
        { id: 'i2', name: '喝水', archived: false, quant: { unit: '杯', target: 8, compare: 'gte' } },
        { id: 'i3', name: '已归档项', archived: true }
      ] },
      DIET_CAT(dietExtra)
    ],
    records: { [TK]: ['i1', { id: 'i2', value: 5 }] },
    foods: [],
    diets: { [TK]: [
      { id: 'd1', meal: 'breakfast', name: '三明治', brand: '全家', kcal: 240, qty: 1 },
      { id: 'd2', meal: 'lunch', name: '巨无霸', brand: '麦当劳', kcal: 550, qty: 2 }
    ] },
    dietGoals: { breakfast: 500, lunch: 700, dinner: 600, total: 2000 },
    dietMealNotes: {}, dietRemoved: false
  });
  S.loadData();
}

console.log('\n=== 1. 适配器注册表结构 ===');
{
  const keys = G('Object.keys(CAT_ADAPTERS).sort().join(",")');
  ok(keys === 'diet,plain', '注册了 plain 与 diet 两种形态：' + keys);
  const REQUIRED = ['entries', 'statsEntries', 'statsRows', 'titleTag', 'menuExtra', 'manageBody'];
  REQUIRED.forEach(k => {
    const a = G(`typeof CAT_ADAPTERS.plain.${k}`);
    const b = G(`typeof CAT_ADAPTERS.diet.${k}`);
    ok(a === 'function' && b === 'function', `两种形态都实现了 ${k}`);
  });
  const p = G('Object.keys(CAT_ADAPTERS.plain).sort().join(",")');
  const d = G('Object.keys(CAT_ADAPTERS.diet).sort().join(",")');
  ok(p === d, '两种形态的能力集合一致（缺一项就露馅）');
  ok(G('adapterFor({ builtin: "future" })') === G('CAT_ADAPTERS.plain'), '未知形态回落到普通分类，不会崩');
  ok(G('catKind({})') === 'plain', '没有 builtin 的分类是 plain');
  ok(G('catKind({ builtin: "diet" })') === 'diet', 'builtin=diet 的分类是 diet');
}

console.log('\n=== 2. 打卡页条目（普通分类）===');
seed();
{
  const cat = G('state.categories[0]');
  const es = S.entriesFor(cat, TK);
  ok(es.length === 2, '未归档项 2 条（归档项不进打卡页）');
  ok(es.every(e => 'id' in e && 'name' in e && 'recorded' in e && 'done' in e
    && 'counted' in e && 'rowClass' in e && 'badge' in e && 'onclick' in e), '字段形状统一');
  ok(es.every(e => e.counted === true), '普通项全部计入分母');
  const water = es.find(e => e.id === 'i2');
  ok(water.badge === '5/8 杯', '量化项徽章：' + water.badge);
  ok(water.recorded === true && water.done === false, '记了 5 杯：有记录但未达标');
  ok(water.rowClass.indexOf('partial') >= 0, '行态 partial');
  const early = es.find(e => e.id === 'i1');
  ok(early.badge === null, '非量化项没有徽章');
  ok(early.done === true, '打勾即达成');
  ok(early.onclick === "toggleCheckin('i1')", '非量化项点击切换打卡');
}

console.log('\n=== 3. 打卡页条目（饮食分类）===');
{
  const cat = G('state.categories[1]');
  const es = S.entriesFor(cat, TK);
  ok(es.length === 3, '三餐饮都有目标 → 三行');
  ok(es.every(e => e.counted === true), '设了目标的餐全部计入分母');
  ok(es.every(e => e.extraClass === 'diet-meal-item'), '饮食行带样式钩子');
  const bf = es.find(e => e.name === '早餐');
  ok(bf.badge === '240/500 千卡', '餐次徽章：' + bf.badge);
  ok(bf.done === true && bf.rowClass.indexOf('done') >= 0, '240 ≤ 500 → 达标');
  ok(bf.onclick === "openDietMealModal('breakfast')", '点行打开记账弹窗');
  const dinner = es.find(e => e.name === '晚餐');
  ok(dinner.recorded === false && dinner.done === false, '晚餐没记录 → 未达成');
  ok(es[0].id === 'diet_breakfast', '餐次有稳定的 entry id：' + es[0].id);
}

console.log('\n=== 4. 无目标时：行还在，但不进分母 ===');
seed();
{
  G('state.dietGoals = { breakfast: null, lunch: null, dinner: null, total: null }');
  const cat = G('state.categories[1]');
  const es = S.entriesFor(cat, TK);
  ok(es.length === 2, '没目标时只显示有记录的两餐（早、午）');
  ok(es.every(e => e.counted === false), '没目标的餐不计入分母');
  ok(es.every(e => e.done === false), '没目标永远不算达标');
  G('ensureStateShape()');
}

console.log('\n=== 5. 两个页面的渲染循环不含形态分支 ===');
seed();
{
  S.renderCheckin();
  const ck = CK();
  const cards = (ck.match(/<div class="category-card">/g) || []).length;
  ok(cards === 2, '两张卡片结构完全同构（同一个模板拼出来）');
  ok(/category-count">1\/2</.test(ck), '普通分类计数 1/2（早起打勾、喝水未达标）');
  ok(/category-count">1\/3</.test(ck), '饮食分类计数 1/3（早餐达标）');
  ok(PC().indexOf('2 / 5') >= 0, '今日完成 2/5 = 2 个普通项 + 3 个目标餐，达成 2 项');
  ok(ck.indexOf('diet-meal-item') > 0, '饮食行走同一套 .checkin-item 结构');
  ok(S.catTitleTag(G('state.categories[0]'), TK) === '', '普通分类名旁没有附加标签');
  ok(S.catTitleTag(G('state.categories[1]'), TK).indexOf('剩 660/2000 千卡') >= 0,
    '饮食分类名旁是全天热量：' + S.catTitleTag(G('state.categories[1]'), TK));
}

console.log('\n=== 6. 统计页条目与行 ===');
{
  const plain = G('state.categories[0]');
  const pe = S.statsEntriesFor(plain);
  ok(pe.length === 3, '统计分母含已归档项（与旧口径一致）');
  ok(pe[0].recordedOn(TK) === true, 'i1 今天有记录');
  ok(pe.find(e => e.id === 'i2').recordedOn(TK) === true, 'i2 今天有记录');

  const diet = G('state.categories[1]');
  const de = S.statsEntriesFor(diet);
  ok(de.length === 3, '饮食分母 = 设了目标的餐数');
  ok(de.every(e => e.id.indexOf('diet_') === 0), '餐次 entry id 带 diet_ 前缀');
  ok(de.find(e => e.id === 'diet_breakfast').recordedOn(TK) === true, '早餐今天有记录');
  ok(de.find(e => e.id === 'diet_dinner').recordedOn(TK) === false, '晚餐今天没记录');

  S.renderStats();
  ok(ST().indexOf('stats-category-card') > 0, '统计页出卡片');
  ok((ST().match(/diet-stats-row/g) || []).length === 4, '饮食 4 行：早/午/晚/全天合计');
  ok(ST().indexOf('连续') > 0, '每行都有连续天数与累计次数');
}

console.log('\n=== 7. 管理页卡片同构 ===');
{
  S.renderManage();
  const mg = MG();
  ok((mg.match(/class="manage-category"/g) || []).length === 2, '两张管理卡');
  ok((mg.match(/toggleCatMenu\('c1'\)/g) || []).length === 1, '普通分类有 ⋮ 菜单');
  ok((mg.match(/toggleCatMenu\('builtin_diet'\)/g) || []).length === 1, '饮食分类有同一个 ⋮ 菜单');
  const dietMenu = mg.slice(mg.indexOf("catMenu_builtin_diet"), mg.indexOf("catMenu_builtin_diet") + 2600);
  ok(dietMenu.indexOf('三餐与全天目标') > 0, '饮食菜单多一项三餐与全天目标');
  ok(dietMenu.indexOf('归档分类') > 0 && dietMenu.indexOf('删除分类') > 0, '饮食菜单也有归档与删除');
  ok(mg.indexOf('diet-goal-row') > 0, '饮食卡片内容是四个目标行');
  ok(mg.indexOf('addItem_c1') > 0, '普通分类有「添加打卡项」输入框');
  ok(mg.indexOf('addItem_builtin_diet') < 0, '饮食分类没有添加打卡项（记录走弹窗）');
}

console.log('\n=== 8. 源码护栏：形态判断不许再散回渲染层 ===');
{
  const RENDERERS = ['renderCheckin', 'renderStats', 'renderManage'];
  const bodyOf = name => {
    const m = new RegExp('function ' + name + '\\([^)]*\\) \\{').exec(code);
    if (!m) return '';
    const rest = code.slice(m.index + m[0].length);
    const end = rest.search(/\nfunction |\n\/\* ={10}/);
    return end < 0 ? rest : rest.slice(0, end);
  };
  RENDERERS.forEach(name => {
    const body = bodyOf(name);
    ok(body.length > 500, `${name} 函数体已定位（${body.split('\n').length} 行）`);
    ok(body.indexOf('isDietCat') < 0, `${name} 里没有 isDietCat`);
    ok(body.indexOf('catKind') < 0, `${name} 里没有 catKind`);
    ok(body.indexOf("builtin") < 0, `${name} 里没有 builtin 判断`);
  });
  // 注释里提到函数名不算数：去掉注释再统计
  const bare = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const total = (bare.match(/isDietCat/g) || []).length;
  ok(total <= 3, `isDietCat 只剩 ${total} 处代码位置（定义 / getDietCat / 删除时清数据）`);
  ok((bare.match(/CAT_ADAPTERS/g) || []).length <= 3, 'CAT_ADAPTERS 只在定义与查询处出现');
}

console.log('\n=== 9. 加一种新形态：只注册适配器，三个页面自动认 ===');
{
  seed();
  G(`CAT_ADAPTERS.sport = {
    entries: () => [{ id: 's1', name: '跑步', recorded: true, done: true, counted: true,
      rowClass: 'checked done', extraClass: '', badge: '5/3 公里', badgeClass: 'ok',
      note: '', noteOnclick: 'void 0', streak: 0, onclick: 'void 0' }],
    statsEntries: () => [{ id: 's1', name: '跑步', recordedOn: () => true }],
    statsRows: (cat, st, en, td, color) => [{ name: '跑步', quant: true,
      tagHtml: '<span class="quant-target-tag">🎯 3公里/天</span>',
      freqCurrent: 1, freqSuffix: td + '天', pct: 100, trend: '',
      metaLeft: '达标率 100%', metaRight: '合计 5 公里', streak: 1, count: 1,
      color: color, onclick: null }],
    titleTag: () => '<span class="quant-mini">运动</span>',
    menuExtra: () => '',
    manageBody: () => '<div class="manage-item-row">跑步</div>'
  }`);
  G('state.categories.push({ id: "c99", name: "运动记录", builtin: "sport", archived: false, countInStats: true, items: [] })');
  S.renderCheckin(); S.renderStats(); S.renderManage();
  ok(CK().indexOf('跑步') > 0, '打卡页渲染出了新形态的行');
  ok(CK().indexOf('运动记录') > 0, '分类标题正常，卡片结构与其它分类一致');
  ok(CK().indexOf('5/3 公里') > 0, '徽章原样呈现');
  ok(ST().indexOf('跑步') > 0, '统计页也自动出了这一行');
  ok(MG().indexOf('跑步') > 0, '管理页也自动出了卡片内容');
  ok(ST().indexOf('运动记录') > 0 && MG().indexOf('运动记录') > 0, '两个页面的标题都用了同一个卡片模板');
  G('state.categories.pop(); delete CAT_ADAPTERS.sport;');
}

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED'));
process.exit(fail === 0 ? 0 : 1);
