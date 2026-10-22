# 回归测试

改完 `index.html` 必须跑一遍，全绿才算完成：

```bash
node tests/run.js
```

不需要 npm install，也不依赖任何第三方包。测试用 `vm` + 手写 DOM 桩，
直接加载 `index.html` 里的真实脚本，不做任何复制或抽取，所以测的就是线上那份代码。

| 文件 | 覆盖内容 |
|---|---|
| `test_smoke.js` | 所有界面路径点一遍：四个 tab、日历、周期切换、食物筛选、弹窗、记账两视图、趋势大图、导出 |
| `test_freshness.js` | 新鲜度：每个写操作执行完后，当前 tab 的每个容器都必须是最新的（防「同屏两块只刷一块」） |
| `test_trend.js` | 折线图刻度、取值范围、目标线位置、空数据 |
| `test_diet_card.js` | 饮食卡片三态、管理页四个目标行、弹窗记账 |
| `test_diet_trend.js` | 三餐 + 全天合计接入趋势图与统计页 |
| `test_diet_align.js` | 饮食分类与普通分类的行为对齐（菜单 / 开关 / 归档 / 删除 / 连续天数） |
| `test_adapter.js` | 追踪条目适配器：entry 形状统一、注册表完整、渲染层无形态分支、加新形态只改注册表 |

## 分类形态的护栏

`test_adapter.js` 里有两条硬约束，用来防止「饮食分支」重新散回渲染层：

1. **渲染函数体里不许出现形态判断**：直接扫源码，`renderCheckin` / `renderStats` /
   `renderManage` 的函数体内不得出现 `isDietCat`、`catKind`、`builtin`。
2. **`isDietCat` 全文件不超过 3 处**（定义、`getDietCat`、彻底删除时清数据），
   统计前会剥掉注释，避免「注释里提了一句」也算数。

它还模拟了「加一种新形态」：临时往 `CAT_ADAPTERS` 注册一个 `sport` 适配器，
断言三个页面不需要任何改动就能把它渲染出来。这条测试就是第四层重构的目的本身。


## 新鲜度测试怎么判断「该刷新什么」

不需要人工枚举「这个操作该刷哪几块」——那正是容易漏的地方。做法是拿「全量重绘」当金标准：

```
切到目标 tab，全量画一次（预热）
→ 执行写操作（内部走 commit，自动重画）
→ 快照 A
→ 再全量重画一次
→ 快照 B
→ 断言 A === B
```

任何一块容器在 A 和 B 之间不同，就是漏刷。它只要求当前 tab 的容器新鲜，
不要求看不见的 tab 也重画（那是设计边界：切过去时会重画）。

## 渲染基线比对

改结构但不想改外观时（重构、抽函数、换写法），用这个确认「长得一模一样」：

```bash
git show HEAD~1:index.html > /tmp/base.html
node tests/compare_render.js /tmp/base.html
```

它把新旧两份文件各装进独立沙箱，喂同一份 state，逐字比对 6 个容器的 innerHTML
和 22 组折线图 SVG。只忽略标签间空白和 class 属性里多余空格。

## 写测试时的两个坑

1. **`escapeHtml` 必须自己覆盖**。真实实现靠 `div.textContent → innerHTML`，
   而 DOM 桩不实现转义，不覆盖的话所有中文都会变成空串，断言会误判。
2. **`vm` 里 `const` / `let` 不会挂到 sandbox 上**（只有函数声明会）。
   要读 `state` / `ui` / `sync` 这类词法绑定，得用
   `vm.runInContext('ui.date', sandbox)`，不能写 `sandbox.ui`。
