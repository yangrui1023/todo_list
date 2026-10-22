// 渲染基线比对：确认重构前后「长得一模一样」。
//
// 用法：
//   node tests/compare_render.js <baseline.html>
//
// baseline 可以是任意一份旧版 index.html，例如：
//   git show HEAD~1:index.html > /tmp/base.html
//   node tests/compare_render.js /tmp/base.html
//
// 做法：把两份文件各自装进独立的 vm 沙箱，喂同一份 state，
// 逐字比对 6 个容器的 innerHTML + 折线图 SVG 输出。
// 只归一化标签间空白与 class 属性内多余空格，其余一律严格相等。
const fs = require('fs'), vm = require('vm'), path = require('path');

const BASELINE = process.argv[2];
if (!BASELINE) {
  console.error('用法: node tests/compare_render.js <baseline.html>');
  process.exit(2);
}

function load(file) {
  const html = fs.readFileSync(file, 'utf8');
  const code = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n');
  function makeEl(id) {
    const cls = new Set();
    const el = {
      id, value: '', style: {}, options: [], checked: false, files: [], _html: '', _text: '',
      classList: { add(c) { cls.add(c); }, remove(c) { cls.delete(c); }, toggle() {}, contains() { return false; } },
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
    document: { getElementById: getEl, querySelector: () => makeEl('q'), querySelectorAll: () => [], createElement: () => makeEl('c'), addEventListener() {}, body: makeEl('b'), documentElement: makeEl('h'), visibilityState: 'visible' },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } },
    navigator: { userAgent: 'node' }, location: { href: 'file:///t' },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve([]), text: () => Promise.resolve('') }),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    console, confirm: () => true, alert() {},
    Blob: class { constructor(p) { this.p = p; } }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    Intl, Date, Math, JSON, Number, String, Array, Object, Set, Map, RegExp, parseFloat, parseInt, isNaN, isFinite,
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: file });
  sandbox.escapeHtml = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  sandbox.__els = els;
  return sandbox;
}

// ---- 固定「今天」，避免跨天导致结果漂移 ----
const T = new Date(); T.setHours(12, 0, 0, 0);
const keyOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = keyOf(T), YEST = keyOf(new Date(T.getTime() - 86400000)), D2 = keyOf(new Date(T.getTime() - 2 * 86400000));

function buildState(kind) {
  const s = {
    categories: [
      { id: 'c1', name: '健康', archived: false, countInStats: true, items: [
        { id: 'p1', name: '早起', archived: false },
        { id: 'q1', name: '喝水', archived: false, quant: { unit: '杯', target: 8, compare: 'gte' } },
        { id: 'q2', name: '体重', archived: false, quant: { unit: 'kg', target: 70, compare: 'lte' } },
        { id: 'p2', name: '已归档项', archived: true }
      ] },
      { id: 'c2', name: '学习', archived: false, countInStats: false, items: [
        { id: 'p3', name: '阅读', archived: false }
      ] },
      { id: 'c3', name: '未来分类', archived: false, startDate: '2099-01-01', countInStats: true, items: [
        { id: 'p4', name: '未来项', archived: false }
      ] }
    ],
    records: {}, foods: [], diets: {}, dietGoals: { breakfast: 500, lunch: 700, dinner: 600, total: 2000 },
    dietMealNotes: {}, dietRemoved: false
  };
  if (kind === 'records' || kind === 'all') {
    s.records[TODAY] = ['p1', { id: 'q1', value: 5, note: '下午补了一杯 <b>加奶</b>' }, { id: 'q2', value: 68 }];
    s.records[YEST] = [{ id: 'q2', value: 68 }];
    s.records[D2] = [{ id: 'q2', value: 68 }];
  }
  if (kind === 'diet' || kind === 'all') {
    s.categories.push({ id: 'builtin_diet', builtin: 'diet', name: '饮食记录', archived: false, enabled: true, countInStats: true, items: [] });
    s.diets[TODAY] = [
      { id: 'd1', meal: 'breakfast', foodId: 'f1', name: '牛奶', brand: '伊利', kcal: 150, qty: 2 },
      { id: 'd2', meal: 'lunch', foodId: 'f2', name: '米饭', brand: '自家', kcal: 400, qty: 2 },
      { id: 'd3', meal: 'lunch', foodId: 'f3', name: '红烧肉', brand: '自家', kcal: 0, qty: 1 }
    ];
    s.dietMealNotes[TODAY] = { breakfast: '两杯拿铁' };
  }
  if (kind === 'diet_nogoal') {
    s.categories.push({ id: 'builtin_diet', builtin: 'diet', name: '饮食记录', archived: false, enabled: true, countInStats: false, items: [] });
    s.dietGoals = { breakfast: null, lunch: null, dinner: null, total: null };
    s.diets[TODAY] = [{ id: 'd9', meal: 'lunch', foodId: 'f2', name: '米饭', brand: '自家', kcal: 400, qty: 1 }];
  }
  if (kind === 'diet_disabled') {
    s.categories.push({ id: 'builtin_diet', builtin: 'diet', name: '饮食记录', archived: false, enabled: false, countInStats: false, items: [] });
  }
  if (kind === 'diet_archived') {
    s.categories.push({ id: 'builtin_diet', builtin: 'diet', name: '饮食记录', archived: true, enabled: true, countInStats: true, items: [] });
  }
  return s;
}

const norm = x => String(x)
  .replace(/>\s+</g, '><')
  .replace(/\s+/g, ' ')
  .replace(/class="([^"]*)"/g, (m, c) => 'class="' + c.trim().replace(/\s+/g, ' ') + '"')
  .trim();

const CONTAINERS = ['checkinList', 'statsList', 'statsSummary', 'manageList', 'foodList', 'calendarGrid'];

const TREND_CASES = [
  [{ id: 'a', name: '喝水', quant: { unit: '杯', target: 8, compare: 'gte' } }, [3, 6, 8, null, 7, 5, 8, 8]],
  [{ id: 'b', name: '运动', quant: { unit: '分钟', target: 40, compare: 'gte' } }, [0, 2, 1, null, 2, 0, 2, 1]],
  [{ id: 'c', name: '压力', quant: { unit: '', target: -50, compare: 'gte' } }, [60, 65, 70, 62, 68, 66, 69, 64]],
  [{ id: 'd', name: '体重', quant: { unit: 'kg', target: 70, compare: 'lte' } }, [68.6, 68.4, null, 68.9, 68.2, 68.5, 68.1, 67.9]],
  [{ id: 'e', name: '热量', quant: { unit: 'kcal', target: 0, compare: 'lte' } }, [300, 350, 400, 320, 380, 360, 390, 340]],
  [{ id: 'f', name: '冥想', quant: { unit: '分钟', target: 20, compare: 'gte' } }, [null, null, null, null, null, null, null, null]],
  [{ id: 'g', name: '空', quant: { unit: '', target: '', compare: 'gte' } }, [null, null, null, null, null, null, null, null]],
  [{ id: 'h', name: '单点', quant: { unit: '', target: 10, compare: 'gte' } }, [null, null, null, null, null, null, null, 6]],
  [{ id: 'i', name: '收支', quant: { unit: '元', target: -5, compare: 'gte' } }, [-8, -3, -10, -6, -2, -9, -4, -7]],
  [{ id: 'j', name: '单日', quant: { unit: '次', target: 1, compare: 'gte' } }, [2]],
  [{ id: 'l', name: '盈亏', quant: { unit: '元', target: null, compare: 'gte' } }, [-5, 3, -2, 8, 0, -1, 4, 6]],
];
const mkDays = vals => vals.map((v, i) => ({ key: '2026-10-' + String(i + 1).padStart(2, '0'), value: v }));

const OLD = load(BASELINE);
const NEW = load(path.join(__dirname, '..', 'index.html'));

let diff = 0;
const report = (ok, label, a, b) => {
  if (ok) { console.log(`  ok  ${label}`); return; }
  diff++;
  console.log(`  X   ${label}`);
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  console.log('      base …' + a.slice(Math.max(0, i - 60), i + 90));
  console.log('      curr …' + b.slice(Math.max(0, i - 60), i + 90));
};

console.log('\n=== A. 折线图 SVG 输出 ===');
TREND_CASES.forEach(([item, vals], n) => {
  const days = mkDays(vals);
  [['小图', 'renderTrendSvg'], ['大图', 'renderTrendSvgLarge']].forEach(([label, fn]) => {
    const a = norm(OLD[fn](item, days)), b = norm(NEW[fn](item, days));
    report(a === b, `#${n + 1} ${item.name} · ${label}`, a, b);
  });
});

console.log('\n=== B. 各页面渲染（同一份 state）===');
['empty', 'records', 'diet', 'diet_nogoal', 'diet_disabled', 'diet_archived', 'all'].forEach(kind => {
  [OLD, NEW].forEach(sb => {
    vm.runInContext(`state = ${JSON.stringify(buildState(kind))}`, sb);
    vm.runInContext('ensureStateShape()', sb);
    try { vm.runInContext(`currentDate = new Date(${T.getTime()})`, sb); } catch (e) {}
    try { vm.runInContext(`ui.date = new Date(${T.getTime()})`, sb); } catch (e) {}
    try { vm.runInContext(`currentPeriod = 'month'`, sb); } catch (e) {}
    try { vm.runInContext(`ui.period = 'month'`, sb); } catch (e) {}
    try { vm.runInContext('statsOffset = 0', sb); } catch (e) {}
    try { vm.runInContext('ui.statsOffset = 0', sb); } catch (e) {}
    vm.runInContext('renderCheckin()', sb);
    vm.runInContext('renderStats()', sb);
    vm.runInContext('renderManage()', sb);
    vm.runInContext('renderFoods()', sb);
    try { vm.runInContext('renderCalendar()', sb); } catch (e) {}
  });
  CONTAINERS.forEach(id => {
    const a = norm(OLD.__els[id] ? OLD.__els[id].innerHTML : '');
    const b = norm(NEW.__els[id] ? NEW.__els[id].innerHTML : '');
    report(a === b, `${kind} / ${id}`, a, b);
  });
});

console.log(diff === 0
  ? `\nIDENTICAL — ${TREND_CASES.length * 2} 组图表 + 7 个场景 × ${CONTAINERS.length} 个容器全部逐字一致`
  : `\n${diff} 处差异`);
process.exit(diff ? 1 : 0);
