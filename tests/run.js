// 回归测试总入口：node tests/run.js
// 任何改动 index.html 后必须跑一次，全绿才算完成。
// 测试通过 vm + DOM 桩直接加载 index.html 里的真实代码，不做任何复制。
const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
  ['test_smoke.js',      '冒烟：所有界面路径点一遍不报错'],
  ['test_freshness.js',  '新鲜度：写操作后当前 tab 每个容器都是最新'],
  ['test_trend.js',      '折线图：刻度、范围、目标线'],
  ['test_diet_card.js',  '饮食卡片、管理页、弹窗记账'],
  ['test_diet_trend.js', '饮食三餐接入趋势图与统计页'],
  ['test_diet_align.js', '饮食分类与普通分类行为对齐'],
  ['test_diet_picker.js','记账 picker：品类/品牌筛选、筛空可新增、新增后回填'],
  ['test_adapter.js',    '追踪条目适配器：形状统一、注册表完整、渲染层无形态分支'],
  ['test_security.js',   '安全：文本/属性两个转义出口、id 白名单、CSV 公式注入'],
  ['test_migrate.js',    '数据结构版本与迁移：老数据升级、幂等、脏数据兜底'],
  ['test_sync.js',       '同步：三方比较、冲突提示、断网不清空云端'],
  ['test_auth.js',       '认证：全部走 RPC、不直连表、token 失效有提示'],
];

let failed = [];
const started = Date.now();

SUITES.forEach(([file, label]) => {
  console.log('\n' + '='.repeat(60));
  console.log(`${file}  ${label}`);
  console.log('='.repeat(60));
  const r = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(file);
});

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log('\n' + '='.repeat(60));
if (failed.length === 0) {
  console.log(`ALL SUITES PASS  (${SUITES.length} 套, ${secs}s)`);
  process.exit(0);
} else {
  console.log(`FAILED: ${failed.join(', ')}  (${secs}s)`);
  process.exit(1);
}
