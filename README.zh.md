# dsh-git-activity · 项目进展看板

[English](README.md) | 中文

一个 DeepSeek Harness（DSH）插件，回答每天都会问的那个问题：**我这些项目最近都动了什么？**

它只读地读取本地 Git —— 不需要 GitHub/GitLab 账号、不联网、不需要 token —— 所以不管提交是 DSH 里的
Agent 做的，还是别的 Agent、你的编辑器、你自己的终端做的，都会出现在同一个视图里。

```
┌ 项目进展 ───────────────────────────────────────────────────┐
│ 6 个项目 · 3 个 Git 仓库 · 近 14 天 61 个提交 · 52 处未提交 │
│                                                            │
│ noteWithAI   [main] [7 处未提交]       近 14 天 14 个提交   │
│ /Users/me/work/noteWithAI                                  │
│ docs: specify proactive note continuation agent            │
│ CookieJobs · 32 分钟前 · abb0b7f                            │
│ ▁▂▃▅▂▁▁▁▁▁▁▁▁▁                                             │
│                                                            │
│ 最近提交                                                   │
│ 今天   14:03  noteWithAI   docs: spec…        CookieJobs    │
└────────────────────────────────────────────────────────────┘
```

## 为什么做这个

DSH 给你的是「一个 Session」，不是「一个项目的全貌」。如果你还会在别的 Agent 或编辑器里提交代码，
就没有任何地方能告诉你「今天哪些项目动了」。这个插件补上这个位置，并且在每个会话里放一行紧凑状态，
不用离开对话就能看到当前项目在什么状态。

## 你会得到什么

| 位置 | 内容 |
| --- | --- |
| **左侧栏 → 看板图标** | 完整看板：概览信息带、每个工作区一行（分支、领先/落后、未提交数、每日提交柱状图、最近一次提交），以及跨仓库合并的提交时间线。可切换 7 / 14 / 30 天窗口。 |
| **会话内**（输入框下方） | 当前项目的一行状态：分支、未提交文件数、窗口内提交数、最近一次提交。点它打开详情面板。 |
| **新建 Session 页** | 工作区/预设控件旁边一个紧凑的「分支 / 未提交」徽标，开聊前就知道状态。 |
| **右侧栏** | 该项目的详情标签：分支与上游、改动文件、每日柱状图、完整提交列表，以及「打开完整看板」。 |
| **Agent 工具** | `git_activity(days)`，返回同一份数据，可以直接问 Agent「最近各项目进展如何」。 |

还支持**隐藏**不想跟的项目：隐藏后它会从看板、概览数字、提交时间线和会话内状态条里一并移出，
「项目」标题旁的「已隐藏 N 个」可以单个或全部恢复。

## 环境要求

- DSH **0.2.2-rc.5** 或更新（Web / 桌面客户端；这是一个 UI 插件）。
- `PATH` 里有 `git`。
- 零依赖、无构建步骤：浏览器半身是普通的 `window.__ModuleLoader__` 模块，Host 半身只 import Node 内置模块。

## 安装

这是一个本地 bundle：代码留在磁盘上，profile 只是链接到它。

```sh
git clone https://github.com/CookieJobs/dsh-git-activity.git
```

然后在 DSH 里：

1. **插件** → **添加插件** → 选择刚 clone 的 `dsh-git-activity` 目录；
2. 如果 bundle 没有自动启用，手动启用；
3. 刷新页面（⌘R / Ctrl-R）。左侧栏的面板图标列表里（插件、定时任务旁边）会多一个看板图标。

**请不要移动 clone 下来的目录**：profile 里保存的是指向它的链接，不是副本。

卸载时在**插件**页面移除即可；插件不会往仓库目录里写任何东西。

## 配置

默认值写在 `cordis.patch.yml`。要改就在自己的
`~/.dsh/profiles/<profile>/cordis.patch.yml` 里用同一个 id 覆盖（覆盖是替换整段 `config`，不是深合并）：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `days` | `14` | 默认提交窗口（天） |
| `maxCommits` | `30` | 每个仓库最多回传的提交条数 |
| `historyLimit` | `400` | 计算每日柱状图时每个仓库最多读的提交条数 |
| `scanChildren` | `true` | 工作区本身不是仓库时，是否扫描其直接子目录里的仓库 |
| `cacheMs` | `8000` | 扫描结果复用时长；页面轮询不会反复拉起 git |
| `gitTimeoutMs` | `6000` | 单条 git 命令超时 |
| `maxReposPerWorkspace` | `16` | 每个工作区最多识别的子仓库数 |
| `extraRepos` | `[]` | 额外纳管的仓库绝对路径（不在任何工作区里也能看） |

```yaml
- insert:
    - id: git-activity
      name: 'dsh-git-activity'
      config:
        days: 30
        scanChildren: false
        cacheMs: 15000
        extraRepos:
          - /Users/me/work/another-repo
```

## 边界与限制

- **只读**：只运行 `rev-parse` / `status` / `log` / `rev-list`，并始终带 `--no-optional-locks`，
  不会写仓库、不会和别的 Agent 抢 `index.lock`，也不把任何数据发到外部。
- **需要 `git` 在 `PATH` 里**：缺失或超时会在对应卡片上显示错误，而不是假装 0 提交。
- **落在更大仓库里的工作区不计入**：只有「工作区自己就是仓库根」或「仓库在工作区里面」才归这个项目；
  比如 `~/Documents` 意外是个仓库时，它只会给个提示，不会借那个仓库的历史。
- **不联网**：领先/落后数是相对本地 `@{upstream}` 引用算的，不会 fetch。
- **作者归属以 Git 为准**：插件显示提交作者，无法判断是哪个 Agent 提交的；未提交的改动只能看到文件。
- **隐藏列表**保存在 Host 侧 `$DSH_HOME/git-activity/hidden.json`（默认 `~/.dsh/git-activity/hidden.json`），
  按工作区 id 记录；删掉该文件即全部恢复。
- **右侧栏标签是按 Session 的**，因为 DSH 本身按 Session 持久化右侧栏布局。

## 开发

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半身：用 Git 扫描工作区，在 GUI 自己的连接闸门后提供 `/git-activity/api/*`，并注册 `git_activity` 工具 |
| `client.js` | 浏览器半身：看板页面、会话内状态条、新建会话徽标、右侧栏详情标签 |
| `cordis.patch.yml` | 插入 Host 行的 bundle patch |
| `locale/en.json`、`locale/zh.json` | 插件管理页里的标题与描述 |
| `icon.svg` | 插件图标 |

没有构建步骤。改完文件重新安装 bundle（或在**插件**页面重新加载）即可生效。

## 许可

[MIT](LICENSE)
