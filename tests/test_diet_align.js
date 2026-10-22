// 饮食分类「除记录外全部对齐普通分类」验收测试（B + C 两类改动）
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
const CK = () => getEl('checkinList').innerHTML;
const MG = () => getEl('manageList').innerHTML;
const ST = () => getEl('statsList').innerHTML;
const PC = () => String(getEl('progressCount').innerHTML).replace(/<[^>]+>/g, '');
const today = new Date(); today.setHours(0, 0, 0, 0);
const yest = new Date(today); yest.setDate(yest.getDate() - 1);
const TK = S.formatDate(today), YK = S.formatDate(yest);

const DIET_CAT = (extra) => Object.assign({ id: 'builtin_diet', builtin: 'diet', name: '饮食记录', archived: false, enabled: true, countInStats: true, items: [] }, extra || {});

function seed(extra) {
  Object.keys(els).forEach(k => delete els[k]);
  store['checkin_app_data'] = JSON.stringify(Object.assign({
    categories: [
      { id: 'c1', name: '健康', archived: false, countInStats: true, items: [{ id: 'i1', name: '早起', archived: false }] },
      DIET_CAT()
    ],
    records: {},
    foods: [],
    diets: {
      [TK]: [
        { id: 'd1', meal: 'breakfast', name: '全麦三明治', brand: '全家', kcal: 240, qty: 1 },
        { id: 'd2', meal: 'lunch', name: '巨无霸', brand: '麦当劳', kcal: 550, qty: 2 }
      ],
      [YK]: [{ id: 'd3', meal: 'breakfast', name: '拿铁', brand: '星巴克', kcal: 190, qty: 1 }]
    },
    dietGoals: { breakfast: 500, lunch: 700, dinner: 600, total: 2000 }
  }, extra || {}));
  S.loadData();
}

console.log('=== 1. 打卡页计数对齐：分母 = 设了目标的餐数，与当天记录无关 ===');
seed({ diets: {} });
S.renderCheckin();
ok(/category-count">0\/3</.test(CK()), '无记录时仍是 0/3（不再随记录变成 0/1）');
ok(CK().indexOf('diet-meal-item') >= 0, '三餐目标都在 → 三行都在');
S.getDietEntries(TK).push({ id: 'x1', meal: 'breakfast', name: '三明治', brand: '全家', kcal: 240, qty: 1 });
S.renderCheckin();
ok(/category-count">1\/3</.test(CK()), '记录早餐后 1/3（分母不变，分子跟着达标走）');
ok(CK().indexOf('240/500 千卡') >= 0, '餐次徽章仍是 240/500 千卡');
ok(CK().indexOf('240/2000 千卡') >= 0, '热量总量挪到分类名旁边');
S.renderCheckin();
ok(PC().indexOf('/ 4') >= 0, '纳入统计时分母 = 1 个普通项 + 3 个目标餐');
ok(PC().indexOf('1 / 4') >= 0, '早餐达标计入完成数');
S.toggleCountInStats('builtin_diet');
S.renderCheckin();
ok(PC().indexOf('/ 1') >= 0, '关掉「纳入统计」→ 只算普通项（与普通分类同一开关）');

console.log('\n=== 2. 餐次行与普通打卡项同构：勾选三态 / 🔥 / 💬 ===');
seed();
S.renderCheckin();
let ck = CK();
ok(/diet-meal-item checked done/.test(ck), '达标餐 = checked + done');
ok(/diet-meal-item checked partial/.test(ck), '超标餐 = checked + partial（有记录未达标）');
ok(ck.indexOf('🔥 2天') >= 0, '连续两天的早餐 → 🔥 2天');
ok(/onclick="event.stopPropagation\(\); openDietNoteModal\('breakfast'\)"/.test(ck), '餐次行有 💬 备注按钮');

console.log('\n=== 3. 餐次备注：写入 / 渲染 / 删除，走同一套备注弹窗 ===');
S.setDietMealNote(TK, 'breakfast', '加了双份芝士');
ck = CK();
ok(ck.indexOf('加了双份芝士') >= 0, '备注小字显示在餐次行里');
ok(/note-btn has/.test(ck), '备注按钮变「已有备注」态');
ok(S.getDietMealNote(TK, 'breakfast') === '加了双份芝士', '按日期 + 餐次存进 state.dietMealNotes');
S.openDietNoteModal('breakfast');
ok(getEl('editModalTitle').textContent === '早餐 · 备注', '备注弹窗标题与打卡项同款');
getEl('modalNote').value = '';
S.confirmEditModal();
ok(S.getDietMealNote(TK, 'breakfast') === '', '清空后备注删除');
ok(CK().indexOf('加了双份芝士') < 0, '打卡页同步移除备注');

console.log('\n=== 4. 日历每日数字含饮食已记录餐次 ===');
ok(S.dayCheckinCount(TK) === 2, `今天 = 普通 0 + 饮食 2 餐（实际 ${S.dayCheckinCount(TK)}）`);
ok(S.dayCheckinCount(YK) === 1, '昨天 = 饮食 1 餐');

console.log('\n=== 5. 量化 CSV 导出包含三餐与全天合计 ===');
const col = S.collectQuantItems();
const dietCols = col.filter(o => o.item.dietMeal).map(o => o.item.name);
ok(dietCols.length === 4, `饮食贡献 4 个指标（实际 ${dietCols.join('/')}）`);
ok(dietCols.join('/') === '早餐/午餐/晚餐/全天合计', '列名 = 早餐/午餐/晚餐/全天合计');
ok(col.some(o => o.item.dietMeal === 'breakfast' && o.item.quant.unit === '千卡'), '单位是千卡，可直接进导出表');

console.log('\n=== 6. 管理页：两边菜单同构 + 文案统一 ===');
seed();
S.renderManage();
let mg = MG();
ok(mg.indexOf('启用分类') >= 0, '普通分类也有「启用分类」开关');
ok((mg.match(/启用分类/g) || []).length === 2, '普通分类与饮食分类都有启用开关');
ok(mg.indexOf('计入今日完成') < 0, '不再出现「计入今日完成」这种两套叫法');
ok(mg.indexOf('纳入统计') >= 0, '统一叫「纳入统计」');
ok(mg.indexOf('不计完成') < 0, '不再出现「不计完成」这种叫法');
// 第三层重构后只重画当前 tab：在管理页操作，就断言管理页的容器
S.switchTab('manage');
S.toggleCountInStats('c1');
ok(MG().indexOf('不计统计') >= 0, '关掉统计后标签叫「不计统计」');
S.toggleCountInStats('c1');
S.switchTab('checkin');
ok(mg.indexOf('开始日期') >= 0, '饮食菜单补上「开始日期」');
ok(mg.indexOf('归档分类') >= 0 && mg.indexOf('删除分类') >= 0, '饮食菜单补上归档 / 删除');
ok(mg.indexOf('三餐与全天目标') >= 0, '仍保留自己的记录配置入口');

console.log('\n=== 7. 停用：普通分类 / 饮食分类行为一致 ===');
S.toggleCatEnabled('c1');
S.renderCheckin();
ok(CK().indexOf('早起') < 0, '停用普通分类 → 打卡页不显示');
S.renderStats();
ok(ST().indexOf('class="category-name">健康') < 0, '停用普通分类 → 统计页也不显示');
S.toggleCatEnabled('c1');
S.toggleCatEnabled('builtin_diet');
S.renderCheckin();
ok(CK().indexOf('饮食记录') < 0, '停用饮食 → 打卡页不显示');
S.renderStats();
ok(ST().indexOf('饮食记录') < 0, '停用饮食 → 统计页也不显示');
S.toggleCatEnabled('builtin_diet');

console.log('\n=== 8. 统计页饮食行：连续 / 累计 与普通项同款 ===');
S.renderStats();
const st = ST();
ok(st.indexOf('饮食记录') >= 0, '纳入统计后出饮食卡片');
ok(/🔥 连续2天 · 累计2次/.test(st), '行尾有「🔥 连续N天 · 累计N次」');
ok((st.match(/diet-stats-row/g) || []).length === 4, '四行（三餐 + 全天合计）');

console.log('\n=== 9. 「纳入统计」关闭 → 统计页整块隐藏（与普通分类一致）===');
seed({ categories: [
  { id: 'c1', name: '健康', archived: false, countInStats: true, items: [{ id: 'i1', name: '早起', archived: false }] },
  DIET_CAT({ countInStats: false })
] });
S.renderStats();
ok(ST().indexOf('饮食记录') < 0, '不计统计 → 统计页不显示饮食卡片');
S.renderCheckin();
ok(PC().indexOf('/ 1') >= 0, '同时不进今日完成分母（同一个开关，同一套语义）');

console.log('\n=== 10. 归档饮食 → 打卡页隐藏 / 统计页灰卡 ===');
seed();
S.archiveCategory('builtin_diet');
ok(S.getDietCat().archived === true, '归档成功');
S.renderCheckin();
ok(CK().indexOf('饮食记录') < 0, '归档后打卡页不显示');
S.renderStats();
ok(/stats-category-card archived/.test(ST()), '统计页保留灰卡');
ok(ST().indexOf('已归档') >= 0, '灰卡带「已归档」标签');
S.renderManage();
ok(/已归档分类/.test(MG()), '管理页进入「已归档分类」区');
S.restoreCategory('builtin_diet');
ok(S.getDietCat().archived === false, '可以恢复');

console.log('\n=== 11. 开始日期：饮食也按日期过滤 ===');
seed();
S.getDietCat().startDate = '2099-01-01';
S.renderCheckin();
ok(CK().indexOf('饮食记录') < 0, '开始日期未到 → 打卡页不显示');
S.getDietCat().startDate = '';
S.renderCheckin();
ok(CK().indexOf('饮食记录') >= 0, '清空开始日期 → 立即恢复');

console.log('\n=== 12. 彻底删除饮食：数据清空且不再自动重建 ===');
seed();
S.permanentDeleteCategory('builtin_diet');
ok(S.getDietCat() === null, '分类已删除');
const saved = JSON.parse(store['checkin_app_data']);
ok(saved.dietRemoved === true, 'state.dietRemoved = true');
ok(Object.keys(saved.diets || {}).length === 0, '饮食记录一并清空');
ok(!(saved.categories || []).some(c => c.builtin === 'diet'), 'categories 里不再有饮食');
S.loadData();
ok(S.getDietCat() === null, '重新加载数据也不会把饮食建回来');
S.renderCheckin();
ok(CK().indexOf('饮食记录') < 0, '打卡页不再出现饮食');

console.log('\n=== 13. 清空数据 → 内置饮食回归 ===');
S.loadDefaultData();
ok(!!S.getDietCat(), '重置后饮食分类回来');
ok(S.getDietCat().countInStats === false, '默认仍是「不计统计」（沿用你之前定的默认不计入完成）');

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED'));
process.exit(fail === 0 ? 0 : 1);
