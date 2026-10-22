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
| `test_diet_picker.js` | 记账 picker：品类 / 品牌两层筛选、筛空可新增、新增后自动回填并加一份 |
| `test_adapter.js` | 追踪条目适配器：entry 形状统一、注册表完整、渲染层无形态分支、加新形态只改注册表 |
| `test_security.js` | 两个转义出口（文本 / 属性）、量化单位注入、备注 title、id 白名单、CSV 公式注入 |
| `test_migrate.js` | 数据结构版本：老数据升级、缺字段补默认、显式 null 不被覆盖、幂等、脏数据兜底 |
| `test_sync.js` | 同步三方比较矩阵、冲突提示与裁决、登出重登不清空云端、断网不误推 |

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

## 转义只有两个出口，别自己拼

浏览器把文本节点里的 `"` 原样保留，所以两件事必须分开做：

- `escapeHtml(x)` —— 文本节点（`<span>${...}</span>`）
- `escAttr(x)` —— 属性值（`value="${...}"` / `title="${...}"`）

`value="${escapeHtml(x)}"` 是错的：名字里一个引号就能从 value 里逃出来接上
`onfocus=...`。`test_security.js` 有一条源码护栏，专门扫这个写法。

另外两条防线不靠转义：

- **id 白名单**（`^[A-Za-z0-9_-]{1,64}$`）：id 会被拼进 `onclick="fn('id')"`，
  别人发来的 JSON 备份里写个脏 id 就等于凭空多一个事件处理器。`sanitizeState()`
  会换掉非法 id，并把 `records` 里的引用一起改过来。
- **CSV 公式前缀**：Excel 会把 `=` 开头的格子当公式执行。文本列走 `csvTextCell()`，
  数值列仍用 `csvCell()`（否则合法的 `-5` 会被写成 `'-5`）。
- **自由文本不进 `onclick` 字面量**：品牌名是用户输入，`onclick="fn('${brand}')"`
  里一个单引号就能截断调用。品牌筛选因此按**索引**传参（`setDietPickerBrand(2)`），
  名字只出现在文本节点里。id 能拼进 `onclick` 是因为它有白名单当护栏。

## 同步判定：三方比较，不猜

`decideSync(localFp, cloudFp, baseFp, localEmpty)` 是唯一判定点：

| 情况 | 结果 |
|---|---|
| 两边内容一致 | `equal` |
| 本地是空的（新设备 / 重登） | `pull`，绝不覆盖云端 |
| 本地没动过 | `pull` |
| 云端没动过 | `push` |
| 两边都改过 / 没有基线且两边都有内容 | `conflict`，弹条让用户选 |

- 比对用的是**内容指纹**（`stateFingerprint`，key 排序后 hash），不是时间戳。
  两台设备的时钟会漂，`_rev` 也是各自从 0 数的，都不可比。
- 基线指纹存独立 key `checkin_sync_base_<uid>`，登出时要一起删 ——
  否则下次同账号登录、本地缓存已空、云端恰好等于旧基线，会被判成「推本地」，
  用空数据清空云端。
- `fetchCloudData()` 区分「请求失败」和「云端确实没数据」。
  以前两者都返回 `null`，断网时会把本地旧数据当成权威推上去。

## 写测试时的两个坑

1. **`escapeHtml` 必须自己覆盖**。真实实现靠 `div.textContent → innerHTML`，
   而 DOM 桩不实现转义，不覆盖的话所有中文都会变成空串，断言会误判。
2. **`vm` 里 `const` / `let` 不会挂到 sandbox 上**（只有函数声明会）。
   要读 `state` / `ui` / `sync` 这类词法绑定，得用
   `vm.runInContext('ui.date', sandbox)`，不能写 `sandbox.ui`。
