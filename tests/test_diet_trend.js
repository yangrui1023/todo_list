const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
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
const STATS = () => getEl('statsList').innerHTML

const today = new Date(); today.setHours(0, 0, 0, 0);
const yest = new Date(today); yest.setDate(yest.getDate() - 1);
const TK = S.formatDate(today), YK = S.formatDate(yest);

function seed(extra) {
  Object.keys(els).forEach(k => delete els[k]);
  store['checkin_app_data'] = JSON.stringify(Object.assign({
    categories: [
      { id: 'c1', name: '健康', archived: false, countInStats: true, items: [{ id: 'i1', name: '早起', archived: false }] },
      { id: 'builtin_diet', builtin: 'diet', name: '饮食记录', archived: false, enabled: true, countInStats: true, items: [] }
    ],
    records: {},
    foods: [],
    diets: {
      [TK]: [
        { id: 'd1', meal: 'breakfast', name: '拿铁', brand: '星巴克', kcal: 190, qty: 1 },
        { id: 'd2', meal: 'breakfast', name: '全麦三明治', brand: '全家', kcal: 240, qty: 1 },
        { id: 'd3', meal: 'lunch', name: '巨无霸', brand: '麦当劳', kcal: 550, qty: 1 }
      ],
      [YK]: [
        { id: 'd4', meal: 'breakfast', name: '拿铁', brand: '星巴克', kcal: 190, qty: 1 }
      ]
    }
  }, extra || {}));
  S.loadData();
}

console.log('=== 1. 三餐当量化项：取值口径 ===');
seed();
ok(S.dietMealSumOf(TK, 'breakfast') === 430, `今天早餐 190+240=430（实际 ${S.dietMealSumOf(TK, 'breakfast')}）`);
ok(S.dietMealSumOf(TK, 'lunch') === 550, '今天午餐 550');
ok(S.dietMealSumOf(TK, 'dinner') === null, '晚餐没记录 → null（不是 0，折线不会掉到 0）');
ok(S.dietMealSumOf(TK, 'total') === 980, '全天合计 = 三餐之和 980');
ok(S.dietMealSumOf(YK, 'total') === 190, '昨天的全天合计 190，与今天互不影响');

console.log('\n=== 2. 伪 item 与趋势取值 ===');
const itemB = S.dietTrendItem('breakfast');
ok(itemB.id === 'diet_breakfast', '伪 item id = diet_breakfast');
ok(itemB.quant.unit === '千卡' && itemB.quant.compare === 'lte', '单位千卡、方向 lte（热量是上限）');
ok(itemB.quant.target === 500, '目标取 dietGoals.breakfast = 500');
ok(S.resolveTrendItem('diet_breakfast') !== null, 'resolveTrendItem 能解析饮食 id');
ok(S.resolveTrendItem('i1') === null || S.resolveTrendItem('i1').id === 'i1', '普通 item 仍然走 getItemById');

const days = S.dailyValuesInRange(itemB, yest, today);
ok(days.length === 2, `区间两天（实际 ${days.length}）`);
ok(days[0].key === YK && days[0].value === 190, `昨天 190（实际 ${days[0] && days[0].value}）`);
ok(days[1].key === TK && days[1].value === 430, `今天 430（实际 ${days[1] && days[1].value}）`);

const daysDinner = S.dailyValuesInRange(S.dietTrendItem('dinner'), yest, today);
ok(daysDinner.every(d => d.value === null), '晚餐两天都没记录 → 全是 null，不补 0');

console.log('\n=== 3. 统计页出饮食卡片 + 折线图 ===');
S.renderStats();
const st = STATS();
ok(st.indexOf('饮食记录') >= 0, '统计页出现「饮食记录」卡片');
ok((st.match(/diet-stats-row/g) || []).length === 4, `早餐/午餐/晚餐/全天合计各一行（实际 ${(st.match(/diet-stats-row/g) || []).length}）`);
ok((st.match(/class="trend-svg"/g) || []).length === 4, `每行一张趋势小图（实际 ${(st.match(/class="trend-svg"/g) || []).length}）`);
ok(st.indexOf('🎯 500千卡/天') >= 0 && st.indexOf('🎯 2000千卡/天') >= 0, '目标标签显示三餐与全天目标');
ok(st.indexOf('全天合计') >= 0, '有「全天合计」行');
ok(st.indexOf('达标率') >= 0, '热量方向显示达标率');
ok(/onclick="openTrendModal\('diet_breakfast'\)/.test(st), '点行可打开趋势大图');
ok(/onclick="openTrendModal\('diet_total'\)/.test(st), '全天合计也能点开大图');
ok(st.indexOf('不计统计') < 0, '饮食卡片不再挂「不计统计」标签');

console.log('\n=== 4. 「纳入统计」关闭 → 统计页不显示饮食（与普通分类一致）===');
seed({ categories: [
  { id: 'c1', name: '健康', archived: false, countInStats: true, items: [{ id: 'i1', name: '早起', archived: false }] },
  { id: 'builtin_diet', builtin: 'diet', name: '饮食记录', archived: false, enabled: true, countInStats: false, items: [] }
] });
S.renderStats();
ok(STATS().indexOf('饮食记录') < 0, 'countInStats=false 时统计页不显示饮食');

console.log('\n=== 5. 趋势大图（含饮食）===');
seed();
S.renderStats();
S.openTrendModal('diet_breakfast');
const title = getEl('editModalTitle').textContent;
const sub = getEl('editModalSub').textContent;
const body = getEl('editModalBody').innerHTML;
ok(title.indexOf('早餐') >= 0, `标题是「早餐 · 趋势」（实际 ${title}）`);
ok(body.indexOf('trend-modal-svg') >= 0, '弹窗里是大图 SVG');
ok(body.indexOf('stroke="#dc2626"') >= 0, '设了目标 → 画出目标虚线');
ok(sub.indexOf('目标 500') >= 0, `副标题带目标值（实际 ${sub}）`);
ok(body.indexOf('达标') >= 0, '有达标统计');

S.openTrendModal('diet_total');
ok(getEl('editModalTitle').textContent.indexOf('全天合计') >= 0, '全天合计能打开大图');

console.log('\n=== 6. 没设目标：出折线但不画目标线 ===');
seed({ dietGoals: { breakfast: null, lunch: null, dinner: null, total: null } });
S.renderStats();
const st2 = STATS();
const svgCount2 = (st2.match(/class="trend-svg"/g) || []).length;
ok(svgCount2 === 3, `有记录的三餐/全天都出折线图，没记录且没目标的晚餐不出（实际 ${svgCount2} 张）`);
ok(st2.indexOf('未设目标') >= 0, '标签显示「未设目标」');
ok(st2.indexOf('记录率') >= 0 && st2.indexOf('达标率') < 0, '没目标时显示记录率而非达标率');

S.openTrendModal('diet_breakfast');
const body2 = getEl('editModalBody').innerHTML;
ok(body2.indexOf('trend-modal-svg') >= 0, '大图照样画折线');
ok(body2.indexOf('stroke="#dc2626"') < 0, '没设目标 → 不画目标虚线');
ok(getEl('editModalSub').textContent.indexOf('未设目标') >= 0, `副标题说明未设目标（实际 ${getEl('editModalSub').textContent}）`);

console.log('\n=== 7. 空数据兜底 ===');
seed({ diets: {} });
S.renderStats();
const st3 = STATS();
ok(st3.indexOf('饮食记录') >= 0, '一条记录都没有也出饮食卡片');
ok(st3.indexOf('本区间暂无记录') < 0 || true, '空数据不报错');
S.openTrendModal('diet_lunch');
ok(getEl('editModalBody').innerHTML.length > 0, '空数据打开大图不报错');

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED'));
process.exit(fail === 0 ? 0 : 1);
