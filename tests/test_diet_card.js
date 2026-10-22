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
// 桩里没有真实 DOM，escapeHtml 依赖 div.textContent→innerHTML，这里换成等价实现
sandbox.escapeHtml = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const S = sandbox;
const CK = () => getEl('checkinList').innerHTML;
const MG = () => getEl('manageList').innerHTML;
const TODAY = () => S.formatDate(new Date());
const strip = s => String(s).replace(/<[^>]+>/g, '');

const FOODS = [
  { id: 'f1', kind: 'food', brand: '麦当劳', name: '巨无霸', kcal: 550 },
  { id: 'f2', kind: 'drink', brand: '星巴克', name: '拿铁', kcal: 190 },
  { id: 'f3', kind: 'food', brand: '全家', name: '全麦三明治', kcal: 240 }
];

function seed(extra) {
  Object.keys(els).forEach(k => delete els[k]);
  store['checkin_app_data'] = JSON.stringify(Object.assign({
    categories: [
      { id: 'c1', name: '健康', icon: '💪', archived: false, countInStats: true, items: [{ id: 'i1', name: '早起', archived: false }] }
    ],
    records: {},
    foods: FOODS
  }, extra || {}));
  S.loadData();
}

console.log('=== 1. 老数据自动注入内置饮食分类 ===');
seed({
  diets: { '2026-10-18': [{ id: 'old1', foodId: 'f1', name: '巨无霸', brand: '麦当劳', kcal: 550, qty: 1 }] }
});
const dc = S.getDietCat();
ok(!!dc && dc.builtin === 'diet', '老数据没有饮食分类 → 自动注入');
ok(dc.enabled === true, '默认启用');
ok(dc.countInStats === false, '默认不计入「今日完成」');
ok(S.getDietGoals().total === 2000, '缺 total 时补默认 2000');
ok(S.getDietEntries('2026-10-18')[0].meal === 'lunch', '老记录没有 meal → 归到午餐');
ok(S.getDietCat().id === 'builtin_diet', '使用固定 id，重复注入不会重复添加');
S.ensureStateShape(); S.ensureStateShape();
ok(S.getDietCat() !== null, '多次 ensureStateShape 不报错');

console.log('\n=== 2. 打卡页：饮食走普通分类卡片 ===');
S.renderCheckin();
const ck = CK();
ok(ck.indexOf('饮食记录') >= 0, '打卡页出现「饮食记录」');
ok(ck.indexOf('class="category-card"') >= 0 && ck.indexOf('class="category-header"') >= 0, '复用 category-card / category-header');
ok(/class="checkin-item diet-meal-item/.test(ck), '三餐复用 checkin-item 行');
ok(ck.indexOf('早餐') >= 0 && ck.indexOf('午餐') >= 0 && ck.indexOf('晚餐') >= 0, '早/午/晚三行都在');
ok(/category-count">\d+\/\d+</.test(ck), '卡片头右侧是 达成/目标 计数（与普通分类同构）');
ok(ck.indexOf('diet-card') < 0, '旧的独立 diet-card 区块已移除');

console.log('\n=== 3. 三餐合计、超标、达标 ===');
const tk = TODAY();
const entries = S.getDietEntries(tk);
entries.push({ id: 'd1', meal: 'breakfast', foodId: 'f3', name: '全麦三明治', brand: '全家', kcal: 240, qty: 1 });
entries.push({ id: 'd2', meal: 'breakfast', foodId: 'f2', name: '拿铁', brand: '星巴克', kcal: 190, qty: 1 });
entries.push({ id: 'd3', meal: 'lunch', foodId: 'f1', name: '巨无霸', brand: '麦当劳', kcal: 550, qty: 2 });
S.renderCheckin();
let h = CK();
ok(h.indexOf('430/500 千卡') >= 0, '早餐 430/500 达标（绿）');
ok(h.indexOf('quant-badge ok') >= 0, '达标用 .quant-badge.ok');
ok(h.indexOf('1100/700 千卡') >= 0, '午餐 1100/700 超标');
ok(h.indexOf('quant-badge low') >= 0, '超标用 .quant-badge.low');
ok(h.indexOf('1530/2000 千卡') >= 0, '分类名旁显示全天 1530/2000 千卡');
ok(h.indexOf('diet-kcal over') < 0, '全天未超总目标 → 热量标签不变橙');
ok(h.indexOf('不计统计') >= 0, '默认带「不计统计」标签');

console.log('\n=== 4. 某餐目标留空且无记录 → 该行隐藏 ===');
S.getDietGoals();
const raw = JSON.parse(store['checkin_app_data'] || '{}');
// 直接改内存 goals：通过目标弹窗保存路径更真实，这里用 state 间接改
S.openDietGoalModal();
getEl('dietGoalInput_breakfast').value = '500';
getEl('dietGoalInput_lunch').value = '700';
getEl('dietGoalInput_dinner').value = '';
getEl('dietGoalInput_total').value = '2000';
S.confirmEditModal();
S.renderCheckin();
ok(S.getDietGoals().dinner === null, '晚餐目标留空 → null');
ok(CK().indexOf('晚餐') < 0, '晚餐无目标且无记录 → 整行隐藏');
ok(CK().indexOf('早餐') >= 0 && CK().indexOf('午餐') >= 0, '其余两餐照常显示');

console.log('\n=== 5. 全天总目标独立，不等于三餐相加 ===');
ok(S.getDietGoals().total === 2000, 'total 保持 2000（三餐和 1200）');
ok(S.getDietGoals().total !== 500 + 700, 'total 不由三餐相加得出');
S.openDietGoalModal();
getEl('dietGoalInput_total').value = '1500';
S.confirmEditModal();
ok(S.getDietGoals().total === 1500, '全天目标可单独改成 1500');
S.renderCheckin();
ok(CK().indexOf('1530/1500 千卡') >= 0, '全天 1530 超 1500');
ok(CK().indexOf('diet-kcal over') >= 0, '超全天目标 → 热量标签变橙');

console.log('\n=== 6. 停用 / 启用（分类管理页开关）===');
S.renderManage();
let mg = MG();
ok(mg.indexOf('饮食记录') >= 0, '分类管理页出现饮食条目');
ok(mg.indexOf('启用分类') >= 0, '菜单有「启用分类」开关（与普通分类同款）');
ok(mg.indexOf('三餐与全天目标') >= 0, '菜单有「三餐与全天目标」');
ok(mg.indexOf('上移') >= 0 && mg.indexOf('下移') >= 0, '菜单支持排序');
const goalRows = (mg.match(/diet-goal-row/g) || []).length;
ok(goalRows === 4, `早餐/午餐/晚餐/全天总计各占一行（实际 ${goalRows} 行）`);
ok(['早餐', '午餐', '晚餐', '全天总计'].every(t => mg.indexOf(t) >= 0), '四个目标名称都在');
ok(/diet-goal-row total/.test(mg), '全天总计单独高亮一行');
ok(mg.indexOf('归档分类') >= 0 && mg.indexOf('删除分类') >= 0, '饮食也有归档/删除入口');

S.toggleCatEnabled('builtin_diet');
ok(S.getDietCat().enabled === false, '点开关 → enabled=false');
ok(S.getDietGoals().total === 1500, '停用后目标设置仍保留');
S.renderCheckin();
ok(CK().indexOf('饮食记录') < 0, '停用后打卡页不再显示');
S.renderManage();
ok(MG().indexOf('已停用') >= 0, '管理页灰显并标「已停用」');
ok(/manage-category disabled/.test(MG()), '停用条目带 disabled class');

S.toggleCatEnabled('builtin_diet');
ok(S.getDietCat().enabled === true, '再点 → 恢复启用');
S.renderCheckin();
ok(CK().indexOf('饮食记录') >= 0, '重新启用后回到打卡页');

console.log('\n=== 7. 纳入统计 → 三餐计入今日完成 ===');
S.renderCheckin();
let pc = strip(getEl('progressCount').innerHTML);
ok(pc.indexOf('/ 1') >= 0, '默认不计统计：只算普通项 1 个');
S.toggleCountInStats('builtin_diet');
S.renderCheckin();
pc = strip(getEl('progressCount').innerHTML);
ok(pc.indexOf('/ 3') >= 0, '纳入统计后总数 = 1 + 2（晚餐被隐藏）');
ok(pc.indexOf('1 / 3') >= 0, '早餐达标计入完成数（早起未打卡，共 1/3）');
S.toggleCountInStats('builtin_diet');
S.renderCheckin();
ok(strip(getEl('progressCount').innerHTML).indexOf('/ 1') >= 0, '再关掉恢复只算普通项');

console.log('\n=== 8. 记账弹窗（detail 视图）===');
S.openDietMealModal('breakfast');
let inner = getEl('dietModalInner').innerHTML;
ok(getEl('editModalTitle').textContent === '早餐', '弹窗标题 = 早餐');
ok(/2 项 · 共 2 份/.test(getEl('editModalSub').textContent), '副标题显示项数与份数');
ok(inner.indexOf('全麦三明治') >= 0 && inner.indexOf('拿铁') >= 0, '列出该餐两条记录');
ok(inner.indexOf('本餐合计') >= 0, '显示本餐合计');
ok(inner.indexOf('剩余 70 千卡') >= 0, '430/500 → 剩余 70');
ok(/diet-modal-bar/.test(inner), '有进度条');
ok(inner.indexOf('从食物库添加') >= 0, '有「从食物库添加」按钮');
ok(getEl('editModal').classList.contains('diet-modal'), '弹窗加上 diet-modal 类（隐藏取消按钮）');

console.log('\n=== 9. 切到食物库选择视图 ===');
S.switchDietModalView('picker');
ok(getEl('editModalTitle').textContent === '添加食物', '标题切到「添加食物」');
const plist = getEl('dietPickerList').innerHTML;
ok(plist.indexOf('巨无霸') >= 0 && plist.indexOf('全麦三明治') >= 0, '列出食物库条目');
ok(plist.indexOf('已加') >= 0, '已加过的食物标「已加」');
ok(getEl('dietPickerSum').innerHTML.indexOf('早餐 2 项') >= 0, '底部合计显示该餐已选');

console.log('\n=== 10. 加一份 / 改份数 / 删除 后打卡页同步 ===');
S.addDietByFood('f3');
ok(S.dietTotalKcal(S.dietEntriesOf(S.getDietEntries(tk), 'breakfast')) === 670, '同餐再点同食物 → 份数 +1（430+240=670）');
ok(CK().indexOf('670/500 千卡') >= 0, '打卡页立刻同步为 670/500');
ok(CK().indexOf('quant-badge low') >= 0, '670 超 500 → 变橙');
S.changeDietQty('d1', -1);
ok(S.dietTotalKcal(S.dietEntriesOf(S.getDietEntries(tk), 'breakfast')) === 430, '减一份回到 430');
S.removeDietEntry('d2');
ok(S.dietEntriesOf(S.getDietEntries(tk), 'breakfast').length === 1, '删除拿铁后剩 1 项');
ok(CK().indexOf('拿铁') < 0, '打卡页不再出现拿铁');

console.log('\n=== 11. 排序：饮食跟着分类一起移动 ===');
S.renderManage();
S.moveCategory('builtin_diet', -1);
S.renderCheckin();
const ck2 = CK();
const posDiet = ck2.indexOf('饮食记录');
const posHealth = ck2.indexOf('class="category-name">健康');
ok(posDiet >= 0 && posDiet < posHealth, '上移后饮食排在健康前面');
S.moveCategory('builtin_diet', 1);
S.renderCheckin();
ok(CK().indexOf('class="category-name">健康') < CK().indexOf('饮食记录'), '下移后回到健康后面');

console.log('\n=== 12. 目标弹窗校验 ===');
S.openDietGoalModal();
getEl('dietGoalInput_breakfast').value = 'abc';
S.confirmEditModal();
ok(S.getDietGoals().breakfast === 500, '输入字母 → 拦截，目标不变');
getEl('dietGoalInput_breakfast').value = '0';
S.confirmEditModal();
ok(S.getDietGoals().breakfast === 500, '输入 0 → 拦截');
getEl('dietGoalInput_breakfast').value = '520';
getEl('dietGoalInput_total').value = 'x';
S.confirmEditModal();
ok(S.getDietGoals().total === 1500, '全天目标非法 → 拦截，保持 1500');
ok(S.getDietGoals().breakfast === 500, '非法时三餐也不写入');
getEl('dietGoalInput_breakfast').value = '520';
getEl('dietGoalInput_total').value = '2100';
S.confirmEditModal();
ok(S.getDietGoals().breakfast === 520 && S.getDietGoals().total === 2100, '合法值写入');

console.log('\n=== 13. 持久化 ===');
const saved = JSON.parse(store[Object.keys(store).find(k => k.indexOf('checkin_app_data') === 0)]);
ok(Array.isArray(saved.categories), 'categories 已保存');
ok(saved.categories.some(c => c.builtin === 'diet'), '内置饮食分类进本地存储（随整包同步云端）');
ok(saved.categories.find(c => c.builtin === 'diet').enabled === true, 'enabled 一并保存');
ok(saved.dietGoals.total === 2100, '全天总目标一并保存');
ok(!!saved.diets[tk], '当天饮食记录一并保存');

console.log('\n=== 14. 三餐全关目标 + 全无记录 → 仍给一个入口 ===');
seed({ dietGoals: { breakfast: null, lunch: null, dinner: null, total: null } });
S.renderCheckin();
ok(CK().indexOf('饮食记录') >= 0, '饮食分类卡片仍渲染');
ok((CK().match(/diet-meal-item/g) || []).length === 1, '三餐全隐藏时保留当前时段那一餐作为入口');
ok(/category-count">0\/0</.test(CK()), '无目标时计数为 0/0（与普通分类空态同构）');

console.log('\n=== 15. 新建用户（loadDefaultData）也带饮食分类 ===');
Object.keys(els).forEach(k => delete els[k]);
delete store['checkin_app_data'];
S.loadDefaultData();
ok(!!S.getDietCat(), '默认数据含内置饮食分类');
S.renderCheckin();
ok(CK().indexOf('饮食记录') >= 0, '默认数据打卡页显示饮食分类');

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
