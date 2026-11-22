/**
 * dsh-git-activity — 项目进展看板（浏览器半身）。
 *
 * 在左侧栏的面板图标列表里注册一个「项目进展」入口，在主栏渲染看板页面；数据来自
 * Host 半身的同源只读接口 `GET /git-activity/api/board`，浏览器不直接接触文件系统。
 *
 * 视觉约定（都按宿主实际 token 校准，改动前先读）：
 *  - 浅色主题下 `bg-base` / `bg-layer-1` / `bg-layer-2` 全是纯白，卡片只靠
 *    `settings-card-fill` + `settings-card-stroke`(=border-l4) 的描边区分；
 *    需要一点灰度的嵌套面（chip、分段控件底）用 `bg-module-platform`；
 *  - `brand-primary` 是近黑/近白的中性墨色，不是色相，数据强调用 `link` /
 *    `state-business-primary`（deepseek 蓝）；
 *  - macOS 桌面要给自己补 `--dsh-frame-top-clearance`，否则标题落在红绿灯下；
 *  - 字号只 5 档（11/12/13/15/20），字重 400/500，页面标题 20px/500；
 *  - 文案全部走 Client locale 服务（命名空间 `git-activity`），中英各一份。
 */

window.__ModuleLoader__.load({
  id: 'dsh-git-activity',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const PANEL_ID = 'dsh-git-activity'
    /** 右侧栏 tab 类型的 id 与 kind（页面类型，按 kind 打开）。 */
    const TAB_ID = 'dsh-git-activity'
    const TAB_KIND = 'git-activity'
    const API_BASE = '/git-activity/api'
    const LOCALE_NS = 'git-activity'
    const POLL_MS = 30_000
    const TIMELINE_LIMIT = 24

    // ---------------------------------------------------------------- 文案

    const EN = {
      'panel.title': 'Project activity',
      'panel.subtitle': 'Recent commits and uncommitted work in every workspace project, read straight from local Git.',
      'panel.connect': 'Connecting…',
      'panel.connectFailed': 'Not connected',
      'panel.refresh': 'Refresh',
      'panel.updatedAt': 'Updated {time}',
      'panel.switching': 'Loading {days} days…',
      'panel.rangeLabel': 'Time range',
      'panel.range.7': '7 days',
      'panel.range.14': '14 days',
      'panel.range.30': '30 days',
      'stat.projects': 'Projects',
      'stat.projects.hint': '{n} Git repositories',
      'stat.commits': 'Commits ({days}d)',
      'stat.commits.hint': '{n} per day on average',
      'stat.dirty': 'Uncommitted',
      'stat.dirty.hint': 'in {n} repositories',
      'stat.sessions': 'DSH sessions',
      'stat.sessions.hint': 'in these workspaces',
      'section.projects': 'Projects',
      'section.activity': 'Recent commits',
      'section.activityCount': '{n} commits',
      'card.noRepo': 'Not a Git repository',
      'card.noRepoHint': 'No Git repository in this directory.',
      'card.parentRepo': 'Inside repository {path} (not counted here)',
      'card.commits': '{count} in {days}d',
      'card.noCommits': 'No commits in {days}d',
      'card.branch': 'Branch {branch}',
      'card.detached': 'detached HEAD',
      'card.dirty': '{n} uncommitted',
      'card.ahead': '{n} ahead',
      'card.behind': '{n} behind',
      'card.showCommits': 'Show {n} commits',
      'card.less': 'Show less',
      'card.showFiles': 'Show changed files',
      'card.hideFiles': 'Hide files',
      'card.files': 'Changed files',
      'card.truncated': 'Showing the latest {shown} of {total}',
      'card.missing': 'Directory is missing',
      'card.error': 'Could not read this repository: {message}',
      'card.sessions': '{n} DSH session(s)',
      'card.repoCount': '{n} repositories',
      'card.histogram': '{days}-day histogram: {total} commits, busiest {day} with {count}',
      'card.hideNamed': 'Hide {name}',
      'hidden.title': 'Hidden projects',
      'hidden.count': '{n} hidden',
      'hidden.restore': 'Restore',
      'hidden.restoreAll': 'Restore all',
      'hidden.hint': 'Hidden projects are left out of the overview and the commit timeline. They stay listed here until you restore them.',
      'hidden.allHidden': 'Every project is hidden',
      'hidden.emptyBody': 'Restore one below to see its activity again.',
      'strip.commits': '{count} commits / {days}d',
      'strip.openDetail': 'Open details',
      'detail.openBoard': 'Open full board',
      'detail.loading': 'Reading Git status…',
      'detail.hidden': 'This project is hidden on the board',
      'detail.missing': 'This project is no longer registered',
      'time.justNow': 'just now',
      'time.minutes': '{n} min ago',
      'time.hours': '{n} h ago',
      'time.days': '{n} d ago',
      'day.today': 'Today',
      'day.yesterday': 'Yesterday',
      'empty.title': 'No workspaces yet',
      'empty.body': 'Add a workspace in DSH and its commits and changes appear here.',
      'error.title': 'Could not load the board',
      'error.retry': 'Try again',
      'error.network': 'Cannot reach the DSH host process. Refresh the page and try again.',
      'error.unauthorized': 'The page is no longer authorized. Reload the GUI and try again.',
      'foot.note': 'Read-only local Git scan. Refreshes every 30 seconds and never writes.',
      'foot.duration': 'scan took {ms} ms',
      'foot.cached': 'from cache',
      'foot.stale': 'refreshing…',
    }

    const ZH = {
      'panel.title': '项目进展',
      'panel.subtitle': '工作区各项目的最近提交与未提交改动，直接读取本地 Git。',
      'panel.connect': '正在连接…',
      'panel.connectFailed': '未连接',
      'panel.refresh': '刷新',
      'panel.updatedAt': '更新于 {time}',
      'panel.switching': '正在加载 {days} 天窗口…',
      'panel.rangeLabel': '时间范围',
      'panel.range.7': '7 天',
      'panel.range.14': '14 天',
      'panel.range.30': '30 天',
      'stat.projects': '项目',
      'stat.projects.hint': '其中 {n} 个 Git 仓库',
      'stat.commits': '近 {days} 天提交',
      'stat.commits.hint': '平均每天 {n} 个',
      'stat.dirty': '未提交改动',
      'stat.dirty.hint': '分布在 {n} 个仓库',
      'stat.sessions': 'DSH 会话',
      'stat.sessions.hint': '这些工作区累计',
      'section.projects': '项目',
      'section.activity': '最近提交',
      'section.activityCount': '共 {n} 个',
      'card.noRepo': '非 Git 仓库',
      'card.noRepoHint': '这个目录下没有 Git 仓库。',
      'card.parentRepo': '位于仓库 {path} 内（未计入统计）',
      'card.commits': '近 {days} 天 {count} 个',
      'card.noCommits': '近 {days} 天没有提交',
      'card.branch': '分支 {branch}',
      'card.detached': '分离头指针',
      'card.dirty': '{n} 处未提交',
      'card.ahead': '领先 {n}',
      'card.behind': '落后 {n}',
      'card.showCommits': '展开 {n} 条提交',
      'card.less': '收起',
      'card.showFiles': '查看改动文件',
      'card.hideFiles': '收起文件',
      'card.files': '改动文件',
      'card.truncated': '仅显示最近 {shown} 条（共 {total} 条）',
      'card.missing': '目录不存在',
      'card.error': '读取仓库失败：{message}',
      'card.sessions': '{n} 个 DSH 会话',
      'card.repoCount': '{n} 个仓库',
      'card.histogram': '近 {days} 天柱状图：共 {total} 个提交，{day} 最多（{count} 个）',
      'card.hideNamed': '隐藏 {name}',
      'hidden.title': '已隐藏的项目',
      'hidden.count': '已隐藏 {n} 个',
      'hidden.restore': '恢复',
      'hidden.restoreAll': '全部恢复',
      'hidden.hint': '隐藏的项目不计入概览和提交时间线，但仍留在这个列表里，随时可以恢复。',
      'hidden.allHidden': '所有项目都已隐藏',
      'hidden.emptyBody': '在下面恢复一个项目即可重新显示。',
      'strip.commits': '近 {days} 天 {count} 个提交',
      'strip.openDetail': '查看详情',
      'detail.openBoard': '打开完整看板',
      'detail.loading': '正在读取 Git 状态…',
      'detail.hidden': '这个项目在看板里被隐藏了',
      'detail.missing': '这个项目已不在工作区里',
      'time.justNow': '刚刚',
      'time.minutes': '{n} 分钟前',
      'time.hours': '{n} 小时前',
      'time.days': '{n} 天前',
      'day.today': '今天',
      'day.yesterday': '昨天',
      'empty.title': '还没有工作区',
      'empty.body': '在 DSH 里添加工作区后，这里会显示它的提交和改动。',
      'error.title': '看板加载失败',
      'error.retry': '重试',
      'error.network': '无法连接 DSH 的 Host 进程，请刷新页面后重试。',
      'error.unauthorized': '页面登录状态已失效，请重新打开 GUI 后重试。',
      'foot.note': '只读扫描本地 Git，每 30 秒自动刷新，不执行任何写操作。',
      'foot.duration': '本次扫描耗时 {ms} ms',
      'foot.cached': '来自缓存',
      'foot.stale': '正在刷新…',
    }

    // ---------------------------------------------------------------- 本地化

    let localeService = null
    let translate = key => key

    function isChineseBrowser() {
      const language = typeof navigator === 'undefined' ? '' : String(navigator.language ?? '')
      return language.toLowerCase().startsWith('zh')
    }

    /** 用 `{name}` 占位符填参数。 */
    function fill(template, params) {
      if (params === undefined) return template
      return template.replace(/\{(\w+)\}/g, (match, name) => (
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
      ))
    }

    function fallbackTranslate(key, params) {
      const dictionary = isChineseBrowser() ? ZH : EN
      return fill(dictionary[key] ?? EN[key] ?? key, params)
    }

    function subscribeLocale(callback) {
      if (localeService === null || typeof localeService.subscribe !== 'function') return () => {}
      return localeService.subscribe(callback)
    }

    /** 订阅语言变化，让已经挂载的文案跟着切换。 */
    function useLocaleRevision() {
      const [revision, setRevision] = useState(0)
      useEffect(() => {
        let active = true
        const dispose = subscribeLocale(() => {
          if (active) setRevision(value => value + 1)
        })
        return () => {
          active = false
          if (typeof dispose === 'function') dispose()
        }
      }, [])
      return revision
    }

    // ---------------------------------------------------------------- 样式

    const CSS = String.raw`
.ga-page {
  /* 表面：浅色下 bg-base/layer-1/layer-2 同为纯白，卡片靠 settings-card-* 描边立住。 */
  --ga-card-fill: var(--dsw-alias-settings-card-fill, #ffffff);
  --ga-card-stroke: var(--dsw-alias-settings-card-stroke, rgba(127, 127, 127, 0.16));
  --ga-inset: var(--dsw-alias-bg-module-platform, rgba(127, 127, 127, 0.06));
  --ga-skeleton: var(--dsw-alias-bg-skeleton, rgba(127, 127, 127, 0.08));
  --ga-faint: var(--dsw-alias-label-dimmed, rgba(127, 127, 127, 0.35));
  --ga-border: var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.1));
  --ga-text: var(--dsw-alias-label-primary, #1f2328);
  --ga-text-2: var(--dsw-alias-label-secondary, #5c6570);
  --ga-text-3: var(--dsw-alias-label-tertiary, #8b949e);
  --ga-accent: var(--dsw-alias-link, #4176e6);
  --ga-accent-ink: color-mix(in srgb, var(--ga-accent) 82%, var(--ga-text));
  --ga-accent-wash: color-mix(in srgb, var(--ga-accent) 12%, transparent);
  --ga-warn: var(--dsw-alias-state-warn-primary, #d97706);
  --ga-warn-ink: color-mix(in srgb, var(--ga-warn) 78%, var(--ga-text));
  --ga-warn-wash: color-mix(in srgb, var(--ga-warn) 14%, transparent);
  --ga-err: var(--dsw-alias-state-error-primary, #dc2626);
  --ga-err-ink: color-mix(in srgb, var(--ga-err) 72%, var(--ga-text));

  --ga-fs-meta: 11px;
  --ga-fs-secondary: 12px;
  --ga-fs-body: 13px;
  --ga-fs-title: 15px;
  --ga-fs-page: 20px;

  --ga-radius: 12px;
  --ga-radius-sm: 8px;
  --ga-mono: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);

  height: 100%;
  overflow: auto;
  box-sizing: border-box;
  /* macOS 桌面：给窗口 chrome 留出它发布的高度，否则标题压在红绿灯下面。 */
  padding: calc(28px + var(--dsh-frame-top-clearance, 0px)) 24px 48px;
  color: var(--ga-text);
  font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI",
    "PingFang SC", "Microsoft YaHei", sans-serif);
  font-size: var(--ga-fs-body);
  line-height: 1.55;
}
.ga-page * { box-sizing: border-box; }
.ga-shell { max-width: 880px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px; }

/* ---- 页头 ---- */
.ga-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.ga-head-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ga-title { margin: 0; font-size: var(--ga-fs-page); font-weight: 500; line-height: 28px; letter-spacing: -0.01em; }
.ga-sub { margin: 0; max-width: 62ch; font-size: var(--ga-fs-secondary); color: var(--ga-text-2); }
.ga-head-tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ga-updated { font-size: var(--ga-fs-meta); color: var(--ga-text-2); font-variant-numeric: tabular-nums; white-space: nowrap; }

.ga-ranges { display: inline-flex; padding: 2px; gap: 2px; border-radius: 999px; background: var(--ga-inset); }
.ga-range {
  height: 26px; padding: 0 11px; border: 0; border-radius: 999px; background: transparent;
  cursor: pointer; font: inherit; font-size: var(--ga-fs-meta); font-weight: 500; color: var(--ga-text-2);
  transition: background-color 150ms ease, color 150ms ease;
}
.ga-range:hover { color: var(--ga-text); }
.ga-range[aria-pressed="true"] {
  background: var(--ga-card-fill); color: var(--ga-text);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12), inset 0 0 0 1px var(--ga-card-stroke);
}

.ga-btn {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px;
  border: 1px solid var(--ga-card-stroke); border-radius: var(--ga-radius-sm); background: var(--ga-card-fill);
  cursor: pointer; font: inherit; font-size: var(--ga-fs-secondary); font-weight: 500; color: var(--ga-text);
  transition: background-color 150ms ease;
}
.ga-btn:hover:not(:disabled) { background: var(--ga-inset); }
.ga-btn:disabled { cursor: default; opacity: 0.55; }
.ga-btn-icon { width: 30px; padding: 0; justify-content: center; }
.ga-spin { animation: ga-spin 900ms linear infinite; }
@keyframes ga-spin { to { transform: rotate(360deg); } }

/* ---- 概览数字 ---- */
/* 概览是一条带内部分隔线的信息带：整页只有一条纵向信息流，不再出现并排卡片。 */
.ga-stats {
  display: flex; flex-wrap: wrap; gap: 1px; min-width: 0;
  border: 1px solid var(--ga-card-stroke); border-radius: var(--ga-radius);
  background: var(--ga-border); overflow: hidden;
}
.ga-stat {
  display: flex; flex-direction: column; gap: 2px; padding: 12px 14px;
  flex: 1 1 176px; min-width: 0; background: var(--ga-card-fill); border: 0;
}
.ga-stat-value { font-size: var(--ga-fs-page); font-weight: 500; font-variant-numeric: tabular-nums; line-height: 1.3; }
.ga-stat-label { font-size: var(--ga-fs-secondary); font-weight: 500; color: var(--ga-text); }
.ga-stat-hint { font-size: var(--ga-fs-meta); color: var(--ga-text-2); }
.ga-stat-warn .ga-stat-value { color: var(--ga-warn-ink); }

/* ---- 区块 ---- */
.ga-section { display: flex; flex-direction: column; gap: 12px; }
.ga-section-head { display: flex; align-items: baseline; gap: 8px; }
.ga-section-title { margin: 0; font-size: var(--ga-fs-title); font-weight: 500; letter-spacing: -0.005em; }
.ga-section-count { font-size: var(--ga-fs-meta); color: var(--ga-text-2); font-variant-numeric: tabular-nums; }

/* ---- 项目卡片 ---- */
.ga-grid { display: flex; flex-direction: column; gap: 12px; }
.ga-card {
  display: flex; flex-direction: column; gap: 12px; min-width: 0; padding: 14px 16px 16px;
  border: 1px solid var(--ga-card-stroke); border-radius: var(--ga-radius); background: var(--ga-card-fill);
}
.ga-card-titleblock { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.ga-card-head { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
.ga-name { font-size: var(--ga-fs-body); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.ga-path {
  font-family: var(--ga-mono); font-size: var(--ga-fs-meta); color: var(--ga-text-2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ga-repo-head { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
.ga-repo-meta { margin-left: auto; }
.ga-card-tools { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; }
.ga-icon-btn {
  width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
  padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--ga-text-3); cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease;
}
.ga-icon-btn:hover:not(:disabled) { background: var(--ga-inset); color: var(--ga-text); }
.ga-icon-btn:disabled { opacity: 0.5; cursor: default; }

/* 已隐藏项目：留一个可随时恢复的口子 */
.ga-section-tools { margin-left: auto; }
.ga-hidden { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border: 1px dashed var(--ga-card-stroke); border-radius: var(--ga-radius); }
.ga-hidden-head { display: flex; align-items: center; gap: 10px; }
.ga-hidden-head .ga-link-btn { margin-left: auto; }
.ga-hidden-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ga-hidden-name { font-size: var(--ga-fs-secondary); font-weight: 500; white-space: nowrap; }
.ga-hidden-path { font-family: var(--ga-mono); font-size: var(--ga-fs-meta); color: var(--ga-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.ga-hidden-row .ga-link-btn { margin-left: auto; flex: none; }

.ga-chip {
  display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 7px;
  border-radius: 999px; background: var(--ga-inset);
  font-size: var(--ga-fs-meta); font-weight: 500; color: var(--ga-text-2); white-space: nowrap;
}
.ga-chip-branch { font-family: var(--ga-mono); letter-spacing: -0.01em; }
.ga-chip-accent { color: var(--ga-accent-ink); background: var(--ga-accent-wash); }
.ga-chip-warn { color: var(--ga-warn-ink); background: var(--ga-warn-wash); }

.ga-repo { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.ga-actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.ga-detail { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding-top: 2px; }
.ga-repo + .ga-repo { padding-top: 12px; border-top: 1px solid var(--ga-border); }

.ga-last { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.ga-last-subject {
  font-size: var(--ga-fs-body); color: var(--ga-text);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  overflow-wrap: anywhere;
}
.ga-last-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: var(--ga-fs-meta); color: var(--ga-text-2); }
.ga-dot { width: 3px; height: 3px; border-radius: 50%; background: currentColor; opacity: 0.6; }
.ga-sha { font-family: var(--ga-mono); }

/* ---- 每日提交柱 ---- */
.ga-spark-wrap { display: flex; flex-direction: column; gap: 4px; }
.ga-spark { display: flex; align-items: flex-end; gap: 3px; height: 28px; width: 100%; max-width: 360px; }
.ga-spark-bar { flex: 1 1 0; min-width: 2px; border-radius: 2px; background: var(--ga-accent); opacity: 0.85; min-height: 2px; }
.ga-spark-bar[data-empty="true"] { background: var(--ga-faint); opacity: 1; }
.ga-spark-legend { display: flex; justify-content: space-between; font-size: var(--ga-fs-meta); color: var(--ga-text-2); font-variant-numeric: tabular-nums; }

/* ---- 提交与文件列表 ---- */
.ga-commits { display: flex; flex-direction: column; gap: 1px; }
.ga-commit { display: grid; grid-template-columns: 58px minmax(0, 1fr); gap: 8px; align-items: baseline; padding: 3px 0; }
.ga-commit-time { font-size: var(--ga-fs-meta); color: var(--ga-text-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ga-commit-subject { font-size: var(--ga-fs-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ga-link-btn {
  align-self: flex-start; padding: 0; border: 0; background: none; cursor: pointer;
  font: inherit; font-size: var(--ga-fs-meta); font-weight: 500; color: var(--ga-accent-ink);
}
.ga-link-btn:hover:not(:disabled) { text-decoration: underline; }
.ga-link-btn:disabled { opacity: 0.5; cursor: default; }

.ga-files { display: flex; flex-direction: column; gap: 2px; }
.ga-file { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 6px; font-size: var(--ga-fs-meta); }
.ga-file-code { font-family: var(--ga-mono); color: var(--ga-text-2); text-align: center; }
.ga-file-path { font-family: var(--ga-mono); color: var(--ga-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ga-subhead { font-size: var(--ga-fs-meta); font-weight: 500; color: var(--ga-text-2); }
.ga-note { font-size: var(--ga-fs-meta); color: var(--ga-text-2); }

/* ---- 时间线 ---- */
.ga-timeline { display: flex; flex-direction: column; gap: 2px; padding: 6px 16px 14px; border: 1px solid var(--ga-card-stroke); border-radius: var(--ga-radius); background: var(--ga-card-fill); }
.ga-day { display: flex; flex-direction: column; gap: 2px; }
.ga-day-head {
  position: sticky; top: 0; z-index: 1; margin: 0; padding: 8px 0 6px; background: var(--ga-card-fill);
  font-size: var(--ga-fs-meta); font-weight: 500; color: var(--ga-text-2);
}
.ga-tl-row { display: grid; grid-template-columns: 40px 124px minmax(0, 1fr) auto; gap: 10px; align-items: baseline; padding: 3px 0; }
.ga-tl-time { font-family: var(--ga-mono); font-size: var(--ga-fs-meta); color: var(--ga-text-2); }
.ga-tl-project { font-size: var(--ga-fs-meta); font-weight: 500; color: var(--ga-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ga-tl-subject { font-size: var(--ga-fs-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ga-tl-meta { font-family: var(--ga-mono); font-size: var(--ga-fs-meta); color: var(--ga-text-3); white-space: nowrap; }

/* ---- 状态块 ---- */
.ga-banner {
  display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--ga-err) 34%, transparent);
  border-radius: var(--ga-radius-sm); background: color-mix(in srgb, var(--ga-err) 8%, transparent);
  font-size: var(--ga-fs-secondary);
}
.ga-banner-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ga-banner-title { font-weight: 500; color: var(--ga-err-ink); }
.ga-banner-detail { color: var(--ga-text-2); overflow-wrap: anywhere; }
.ga-banner .ga-btn { margin-left: auto; flex: none; }

.ga-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 40px 16px; text-align: center; border: 1px dashed var(--ga-card-stroke); border-radius: var(--ga-radius); }
.ga-empty-title { font-size: var(--ga-fs-title); font-weight: 500; }
.ga-empty-body { font-size: var(--ga-fs-secondary); color: var(--ga-text-2); max-width: 46ch; }

.ga-skeleton { display: flex; flex-direction: column; gap: 12px; }
.ga-skeleton-card { height: 112px; border-radius: var(--ga-radius); background: var(--ga-skeleton); animation: ga-pulse 1.6s ease-in-out infinite; }
.ga-skeleton-stat { height: 68px; border-radius: var(--ga-radius); background: var(--ga-skeleton); animation: ga-pulse 1.6s ease-in-out infinite; }
@keyframes ga-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

.ga-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: var(--ga-fs-meta); color: var(--ga-text-2); }

/* ---- 右侧栏详情：复用看板样式，去掉页面级留白与窗口 chrome 让位 ---- */
.ga-page-inpanel { height: 100%; padding: 12px 14px 28px; }
.ga-page-inpanel .ga-shell { max-width: none; gap: 16px; }
.ga-page-inpanel .ga-title { font-size: 16px; line-height: 22px; }
.ga-page-inpanel .ga-head { gap: 10px; }

/* ---- 会话内 / 新建会话页的紧凑 Git 状态（独立于看板页面，token 重新声明） ---- */
.ga-git {
  --gg-text: var(--dsw-alias-label-primary, #1f2328);
  --gg-text-2: var(--dsw-alias-label-secondary, #5c6570);
  --gg-inset: var(--dsw-alias-bg-module-platform, rgba(127, 127, 127, 0.06));
  --gg-accent: var(--dsw-alias-link, #4176e6);
  --gg-accent-ink: color-mix(in srgb, var(--gg-accent) 82%, var(--gg-text));
  --gg-warn: var(--dsw-alias-state-warn-primary, #d97706);
  --gg-warn-ink: color-mix(in srgb, var(--gg-warn) 78%, var(--gg-text));
  --gg-mono: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0;
  font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI",
    "PingFang SC", "Microsoft YaHei", sans-serif);
  font-size: 11px; line-height: 1.5; color: var(--gg-text-2);
}
.ga-git-strip { flex-wrap: nowrap; padding: 1px 6px; border-radius: 6px; max-width: 100%; overflow: hidden; }
.ga-git-hero { gap: 4px; flex-wrap: nowrap; padding: 2px 4px; border-radius: 6px; max-width: 100%; overflow: hidden; }
.ga-git-line { display: inline-flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 180px; }
.ga-git-subject { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.ga-git-chip {
  display: inline-flex; align-items: center; height: 18px; padding: 0 6px; border-radius: 999px;
  background: var(--gg-inset); color: var(--gg-text-2); white-space: nowrap;
}
.ga-git-chip-accent { color: var(--gg-accent-ink); background: color-mix(in srgb, var(--gg-accent) 12%, transparent); }
.ga-git-chip-warn { color: var(--gg-warn-ink); background: color-mix(in srgb, var(--gg-warn) 14%, transparent); }
.ga-git-mono { font-family: var(--gg-mono); }
.ga-git-time { font-variant-numeric: tabular-nums; white-space: nowrap; }
.ga-git-open {
  /* font: inherit 是简写，会把字号重置成父级（环境信息位的正文），必须在它之后再写一次。 */
  border: 0; background: none; font: inherit; font-size: 11px; line-height: 1.5;
  color: inherit; text-align: left; cursor: pointer; min-width: 0; max-width: 100%;
}
.ga-git-open:hover { background: var(--gg-inset); }
.ga-git-open:focus-visible { outline: 2px solid var(--gg-accent); outline-offset: 2px; }
.ga-git-line { flex: 0 1 auto; overflow: hidden; }

@media (max-width: 720px) {
  .ga-page { padding: calc(20px + var(--dsh-frame-top-clearance, 0px)) 14px 40px; }
  .ga-stat { flex: 1 1 44%; }
  .ga-tl-row { grid-template-columns: 38px minmax(0, 1fr); }
  .ga-tl-project, .ga-tl-meta { display: none; }
  .ga-head-tools { width: 100%; justify-content: space-between; }
}
@media (prefers-reduced-motion: reduce) {
  .ga-page *, .ga-page *::before, .ga-page *::after { animation: none !important; transition: none !important; }
}
`

    /** 注入面板样式；HMR 重新 apply 时替换旧标签。 */
    function injectStyles() {
      if (typeof document === 'undefined') return () => {}
      const stale = document.querySelector(`style[data-plugin-css="${PANEL_ID}"]`)
      if (stale !== null) stale.remove()
      const tag = document.createElement('style')
      tag.dataset.plugin = PANEL_ID
      tag.dataset.pluginCss = PANEL_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => {
        tag.remove()
      }
    }

    // ---------------------------------------------------------------- 取值

    function dateKey(date) {
      const year = date.getFullYear()
      return `${year}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    }

    function pad2(value) {
      return String(value).padStart(2, '0')
    }

    /** 相对时间；跨年或超过一周时给绝对日期（带年份，避免 30 天窗口里读错年）。 */
    function relativeTime(iso, nowMs) {
      const at = Date.parse(iso)
      if (!Number.isFinite(at)) return ''
      const diff = Math.max(0, nowMs - at)
      if (diff < 60_000) return translate('time.justNow')
      const minutes = Math.round(diff / 60_000)
      if (minutes < 60) return translate('time.minutes', { n: minutes })
      const hours = Math.round(minutes / 60)
      if (hours < 24) return translate('time.hours', { n: hours })
      const days = Math.round(hours / 24)
      if (days < 8) return translate('time.days', { n: days })
      const date = new Date(at)
      const stamp = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
      return date.getFullYear() === new Date(nowMs).getFullYear() ? stamp : `${date.getFullYear()}-${stamp}`
    }

    function dayLabel(key, nowMs) {
      if (key === dateKey(new Date(nowMs))) return translate('day.today')
      if (key === dateKey(new Date(nowMs - 86_400_000))) return translate('day.yesterday')
      return key.slice(5)
    }

    function clockTime(iso) {
      const at = new Date(iso)
      if (Number.isNaN(at.getTime())) return ''
      return `${pad2(at.getHours())}:${pad2(at.getMinutes())}`
    }

    /** 更新的绝对时间：今天只给时分，跨天补月日，跨年补年份。 */
    function stampLabel(ms) {
      const at = new Date(ms)
      const time = `${pad2(at.getHours())}:${pad2(at.getMinutes())}`
      const today = dateKey(new Date())
      const key = dateKey(at)
      if (key === today) return time
      const monthDay = `${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`
      return at.getFullYear() === new Date().getFullYear() ? `${monthDay} ${time}` : `${at.getFullYear()}-${monthDay} ${time}`
    }

    /** 拉取看板数据；同源请求带上 GUI 自己的登录 cookie。 */
    async function fetchBoard(days, force, signal) {
      const query = `?days=${encodeURIComponent(String(days))}${force ? '&refresh=1' : ''}`
      let response
      try {
        response = await fetch(`${API_BASE}/board${query}`, {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { accept: 'application/json' },
          signal,
        })
      } catch (error) {
        if (error && error.name === 'AbortError') throw error
        throw new Error(translate('error.network'))
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(translate('error.unauthorized'))
      }
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (response.ok !== true || payload?.ok === false) {
        throw new Error(payload?.error?.message ?? `HTTP ${response.status}`)
      }
      return payload
    }

    /** 单个工作区的 Git 状态（会话内状态条用），只扫一个仓库组，比整块看板便宜。 */
    async function fetchProject(workspaceId, days, signal) {
      const query = `?days=${encodeURIComponent(String(days))}&workspace=${encodeURIComponent(workspaceId)}`
      const response = await fetch(`${API_BASE}/project${query}`, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal,
      })
      if (response.status === 401 || response.status === 403) throw new Error('unauthorized')
      if (response.ok !== true) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json()
      if (payload?.ok === false) throw new Error(payload?.error?.message ?? 'failed')
      return payload
    }

    /** 拉一个工作区的 Git 状态并每 30 秒静默刷新；失败时保持安静（不打扰聊天）。 */
    function useProjectGit(workspaceId, days) {
      const [data, setData] = useState(null)
      const [nowMs, setNowMs] = useState(() => Date.now())
      useEffect(() => {
        setData(null)
        if (workspaceId === null) return undefined
        const controller = new AbortController()
        let cancelled = false
        const load = () => {
          fetchProject(workspaceId, days, controller.signal)
            .then(payload => {
              if (cancelled) return
              setData(payload)
              setNowMs(Date.now())
            })
            .catch(() => {
              if (!cancelled) setData(null)
            })
        }
        load()
        const timer = setInterval(() => {
          if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
          setNowMs(Date.now())
          load()
        }, POLL_MS)
        return () => {
          cancelled = true
          clearInterval(timer)
          controller.abort()
        }
      }, [workspaceId, days])
      return { data, nowMs }
    }

    /** 这个 Session 属于哪个工作区：注册表快照里按 sessionIds 反查。 */
    function useSessionWorkspaceId(useWorkspaces, sessionId) {
      const workspaceId = useWorkspaces(state => {
        const item = state.items.find(workspace => workspace.sessionIds.includes(sessionId))
        return item === undefined ? null : item.workspaceId
      })
      return workspaceId === undefined ? null : workspaceId
    }

    /** 提交一次隐藏/恢复操作；返回服务器重新算好的看板（隐藏状态立刻生效）。 */
    async function postHidden(days, action, id) {
      let response
      try {
        response = await fetch(`${API_BASE}/hidden?days=${encodeURIComponent(String(days))}`, {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify(id === undefined ? { action } : { action, id }),
        })
      } catch {
        throw new Error(translate('error.network'))
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(translate('error.unauthorized'))
      }
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (response.ok !== true || payload?.ok === false) {
        throw new Error(payload?.error?.message ?? `HTTP ${response.status}`)
      }
      return payload.board
    }

    // ---------------------------------------------------------------- 小部件

    function Chip({ tone, className, title, children }) {
      const classes = ['ga-chip']
      if (tone === 'accent') classes.push('ga-chip-accent')
      if (tone === 'warn') classes.push('ga-chip-warn')
      if (className !== undefined) classes.push(className)
      return h('span', { className: classes.join(' '), title }, children)
    }

    function Sparkline({ series, days }) {
      if (!Array.isArray(series) || series.length === 0) return null
      const total = series.reduce((sum, entry) => sum + entry.count, 0)
      const peak = series.reduce((best, entry) => (entry.count > best.count ? entry : best), series[0])
      const label = translate('card.histogram', {
        days,
        total,
        day: peak.date.slice(5),
        count: peak.count,
      })
      const max = series.reduce((top, entry) => Math.max(top, entry.count), 0)
      return h('div', { className: 'ga-spark-wrap' },
        h('div', { className: 'ga-spark', role: 'img', 'aria-label': label },
          series.map(entry => {
            const ratio = max === 0 ? 0 : entry.count / max
            return h('div', {
              key: entry.date,
              className: 'ga-spark-bar',
              'data-empty': entry.count === 0 ? 'true' : 'false',
              style: { height: `${Math.max(2, Math.round(ratio * 100))}%` },
              title: `${entry.date} · ${entry.count}`,
            })
          })),
        h('div', { className: 'ga-spark-legend', 'aria-hidden': 'true' },
          h('span', null, series[0].date.slice(5)),
          h('span', null, series[series.length - 1].date.slice(5)),
        ),
      )
    }

    function CommitLines({ commits, nowMs, limit }) {
      const visible = commits.slice(0, limit)
      if (visible.length === 0) return null
      return h('div', { className: 'ga-commits' }, visible.map(commit => h('div', {
        key: commit.sha,
        className: 'ga-commit',
        title: `${commit.short} · ${commit.author} · ${commit.subject}`,
      },
      h('span', { className: 'ga-commit-time' }, relativeTime(commit.at, nowMs)),
      h('span', { className: 'ga-commit-subject' }, commit.subject),
      )))
    }

    function DirtyFiles({ dirty }) {
      if (!Array.isArray(dirty.files) || dirty.files.length === 0) return null
      return h('div', { className: 'ga-files' },
        h('div', { className: 'ga-subhead' }, translate('card.files')),
        dirty.files.map(file => h('div', { key: `${file.code}:${file.path}`, className: 'ga-file' },
          h('span', { className: 'ga-file-code' }, file.code === '' ? '·' : file.code),
          h('span', { className: 'ga-file-path', title: file.path }, file.path),
        )),
      )
    }

    /** 一个仓库的状态徽标（分支 / 未提交 / 领先落后），单仓库项目会把它并进标题行。 */
    function RepoChips({ repo }) {
      const branchLabel = repo.branch !== ''
        ? repo.branch
        : (repo.detached === true ? translate('card.detached') : '')
      const chips = []
      if (branchLabel !== '') {
        chips.push(h(Chip, {
          key: 'branch',
          tone: 'accent',
          className: 'ga-chip-branch',
          title: repo.upstream === null
            ? translate('card.branch', { branch: branchLabel })
            : `${branchLabel} → ${repo.upstream}`,
        }, branchLabel))
      }
      if (repo.dirty.total > 0) {
        chips.push(h(Chip, { key: 'dirty', tone: 'warn' }, translate('card.dirty', { n: repo.dirty.total })))
      }
      if (repo.ahead > 0) {
        chips.push(h(Chip, { key: 'ahead' }, translate('card.ahead', { n: repo.ahead })))
      }
      if (repo.behind > 0) {
        chips.push(h(Chip, { key: 'behind' }, translate('card.behind', { n: repo.behind })))
      }
      return chips
    }

    function RepoBlock({ repo, days, nowMs, showChips, defaultExpanded }) {
      const [showCommits, setShowCommits] = useState(defaultExpanded === true)
      const [showFiles, setShowFiles] = useState(defaultExpanded === true)
      const commits = Array.isArray(repo.commits) ? repo.commits : []
      const hasFiles = repo.dirty.total > 0 && Array.isArray(repo.dirty.files) && repo.dirty.files.length > 0

      // 提交与文件默认折叠：整页保持一条纵向信息流，细节按需展开；跨项目的提交总览
      // 交给底部时间线，同一批提交不在页面上出现两遍。
      const actions = []
      if (commits.length > 0 && !showCommits) {
        actions.push(h('button', {
          key: 'show-commits',
          type: 'button',
          className: 'ga-link-btn',
          'aria-expanded': false,
          onClick: () => setShowCommits(true),
        }, translate('card.showCommits', { n: commits.length })))
      }
      if (hasFiles && !showFiles) {
        actions.push(h('button', {
          key: 'show-files',
          type: 'button',
          className: 'ga-link-btn',
          'aria-expanded': false,
          onClick: () => setShowFiles(true),
        }, translate('card.showFiles')))
      }

      const detail = []
      if (commits.length > 0 && showCommits) {
        detail.push(h(CommitLines, { key: 'commits', commits, nowMs, limit: commits.length }))
        detail.push(h('button', {
          key: 'commits-less',
          type: 'button',
          className: 'ga-link-btn',
          'aria-expanded': true,
          onClick: () => setShowCommits(false),
        }, translate('card.less')))
      }
      if (repo.commitsInRange > commits.length) {
        detail.push(h('div', { key: 'truncated', className: 'ga-note' },
          translate('card.truncated', { shown: commits.length, total: repo.commitsInRange })))
      }
      if (hasFiles && showFiles) {
        detail.push(h(DirtyFiles, { key: 'files', dirty: repo.dirty }))
        detail.push(h('button', {
          key: 'files-less',
          type: 'button',
          className: 'ga-link-btn',
          'aria-expanded': true,
          onClick: () => setShowFiles(false),
        }, translate('card.hideFiles')))
      }

      return h('div', { className: 'ga-repo' },
        showChips === false
          ? null
          : h('div', { className: 'ga-repo-head' },
            h(RepoChips, { repo }),
            h('span', { className: 'ga-repo-meta' },
              h(Chip, null, translate('card.commits', { count: repo.commitsInRange, days })),
            ),
          ),

        repo.error === null ? null : h('div', { className: 'ga-banner' },
          h('div', { className: 'ga-banner-text' },
            h('span', { className: 'ga-banner-detail' }, translate('card.error', { message: repo.error })),
          ),
        ),

        repo.lastCommit === null ? null : h('div', { className: 'ga-last' },
          h('div', { className: 'ga-last-subject', title: repo.lastCommit.subject }, repo.lastCommit.subject),
          h('div', { className: 'ga-last-meta' },
            h('span', null, repo.lastCommit.author),
            h('span', { className: 'ga-dot' }),
            h('span', null, relativeTime(repo.lastCommit.at, nowMs)),
            h('span', { className: 'ga-dot' }),
            h('span', { className: 'ga-sha' }, repo.lastCommit.short),
          ),
        ),

        h(Sparkline, { series: repo.daily, days }),

        commits.length === 0
          ? h('div', { className: 'ga-note' }, translate('card.noCommits', { days }))
          : null,

        actions.length > 0 ? h('div', { className: 'ga-actions' }, actions) : null,
        detail.length > 0 ? h('div', { className: 'ga-detail' }, detail) : null,
      )
    }

    function StatCard({ label, value, hint, tone }) {
      return h('div', { className: tone === 'warn' ? 'ga-stat ga-stat-warn' : 'ga-stat' },
        h('span', { className: 'ga-stat-value' }, String(value)),
        h('span', { className: 'ga-stat-label' }, label),
        hint === undefined || hint === null ? null : h('span', { className: 'ga-stat-hint' }, hint),
      )
    }

    function ProjectCard({ project, days, nowMs, onHide, busy }) {
      const repos = Array.isArray(project.repos) ? project.repos : []
      const isRepo = repos.length > 0
      const singleRepo = repos.length === 1

      return h('article', { className: 'ga-card' },
        h('div', { className: 'ga-card-titleblock' },
          h('div', { className: 'ga-card-head' },
            h('span', { className: 'ga-name', title: project.title }, project.title),
            singleRepo ? h(RepoChips, { repo: repos[0] }) : null,
            isRepo ? null : h(Chip, { tone: project.status === 'missing-dir' ? 'warn' : undefined },
              project.status === 'missing-dir' ? translate('card.missing') : translate('card.noRepo')),
            singleRepo ? null : (repos.length > 1
              ? h(Chip, { key: 'repo-count' }, translate('card.repoCount', { n: repos.length }))
              : null),
            project.sessions > 0 ? h(Chip, null, translate('card.sessions', { n: project.sessions })) : null,
            h('span', { className: 'ga-card-tools' },
              singleRepo
                ? h(Chip, null, translate('card.commits', { count: repos[0].commitsInRange, days }))
                : null,
              h('button', {
                type: 'button',
                className: 'ga-icon-btn',
                title: translate('card.hideNamed', { name: project.title }),
                'aria-label': translate('card.hideNamed', { name: project.title }),
                disabled: busy === true,
                onClick: () => onHide(project.id),
              }, h(HideIcon)),
            ),
          ),
          project.path === '' ? null : h('div', { className: 'ga-path', title: project.path }, project.path),
        ),
        isRepo
          ? repos.map((repo, index) => h(RepoBlock, {
            key: repo.root ?? index,
            repo,
            days,
            nowMs,
            showChips: !singleRepo,
          }))
          : h('div', { className: 'ga-last' },
            h('div', { className: 'ga-last-meta' }, translate('card.noRepoHint')),
            project.parentRepo === null || project.parentRepo === undefined
              ? null
              : h('div', { className: 'ga-path', title: project.parentRepo },
                translate('card.parentRepo', { path: project.parentRepo })),
          ),
      )
    }

    function Timeline({ projects, nowMs }) {
      const groups = useMemo(() => {
        const collected = []
        for (const project of projects) {
          for (const repo of project.repos ?? []) {
            for (const commit of repo.commits ?? []) {
              collected.push({
                key: `${repo.root}:${commit.sha}`,
                project: project.title,
                at: commit.at,
                time: Date.parse(commit.at),
                subject: commit.subject,
                author: commit.author,
                short: commit.short,
              })
            }
          }
        }
        collected.sort((left, right) => right.time - left.time)
        const buckets = []
        let current = null
        for (const row of collected.slice(0, TIMELINE_LIMIT)) {
          const key = Number.isFinite(row.time) ? dateKey(new Date(row.time)) : ''
          if (current === null || current.key !== key) {
            current = { key, label: dayLabel(key, nowMs), rows: [] }
            buckets.push(current)
          }
          current.rows.push(row)
        }
        return buckets
      }, [projects, nowMs])

      return h('div', { className: 'ga-timeline' }, groups.map(group => h('div', {
        key: group.key,
        className: 'ga-day',
      },
      h('h3', { className: 'ga-day-head' }, group.label),
      h('div', { role: 'list' }, group.rows.map(row => h('div', {
        key: row.key,
        className: 'ga-tl-row',
        role: 'listitem',
        title: `${row.short} · ${row.author}`,
      },
      h('span', { className: 'ga-tl-time' }, clockTime(row.at)),
      h('span', { className: 'ga-tl-project' }, row.project),
      h('span', { className: 'ga-tl-subject' }, row.subject),
      h('span', { className: 'ga-tl-meta' }, row.author),
      ))),
      )))
    }

    function RefreshIcon({ spinning }) {
      return h('svg', {
        width: 14,
        height: 14,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': 'true',
        className: spinning === true ? 'ga-spin' : undefined,
      },
      h('path', {
        d: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
      }),
      h('path', {
        d: 'M13.6 1.9v3.4h-3.4',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
      )
    }

    function HideIcon() {
      return h('svg', {
        width: 14,
        height: 14,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': 'true',
      },
      h('path', {
        d: 'M1.6 8s2.4-4.1 6.4-4.1S14.4 8 14.4 8s-2.4 4.1-6.4 4.1S1.6 8 1.6 8Z',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinejoin: 'round',
      }),
      h('circle', { cx: 8, cy: 8, r: 2, stroke: 'currentColor', strokeWidth: 1.3 }),
      h('path', {
        d: 'M2.9 13.1 13.1 2.9',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
      }),
      )
    }

    /** 已隐藏项目列表：这是恢复展示的唯一入口。 */
    function HiddenPanel({ items, busy, onRestore, onRestoreAll }) {
      return h('div', { className: 'ga-hidden' },
        h('div', { className: 'ga-hidden-head' },
          h('span', { className: 'ga-subhead' }, translate('hidden.title')),
          h('button', {
            type: 'button',
            className: 'ga-link-btn',
            disabled: busy === true,
            onClick: onRestoreAll,
          }, translate('hidden.restoreAll')),
        ),
        h('div', { className: 'ga-note' }, translate('hidden.hint')),
        items.map(item => h('div', { key: item.id, className: 'ga-hidden-row' },
          h('span', { className: 'ga-hidden-name' }, item.title),
          h('span', { className: 'ga-hidden-path', title: item.path }, item.path),
          h('button', {
            type: 'button',
            className: 'ga-link-btn',
            disabled: busy === true,
            onClick: () => onRestore(item.id),
          }, translate('hidden.restore')),
        )),
      )
    }

    /**
     * 一行 Git 状态：分支、未提交、窗口内提交、最近一次提交。
     *
     * composer 下方的环境信息位是**单行**区域（旁边还有「活动」「用量」这类紧凑条目），
     * 所以这里只渲染一行、绝不换行；所有明细都在右侧栏的详情 tab 里，点这一行就打开。
     */
    function GitStatus({ project, days, nowMs, compact, onOpenDetail }) {
      if (project === null || project === undefined) return null
      const repo = Array.isArray(project.repos) ? project.repos[0] : undefined
      // 非 Git 项目没有可说的状态，保持安静，不占环境信息位。
      if (repo === undefined) return null
      const branchLabel = repo.branch !== ''
        ? repo.branch
        : (repo.detached === true ? translate('card.detached') : '')
      const lastCommit = repo.lastCommit
      const info = [
        branchLabel === ''
          ? null
          : h('span', {
            key: 'branch',
            className: 'ga-git-chip ga-git-chip-accent ga-git-mono',
            title: repo.upstream === null ? branchLabel : `${branchLabel} → ${repo.upstream}`,
          }, branchLabel),
        repo.dirty.total > 0
          ? h('span', { key: 'dirty', className: 'ga-git-chip ga-git-chip-warn' },
            translate('card.dirty', { n: repo.dirty.total }))
          : null,
        compact
          ? null
          : h('span', { key: 'commits', className: 'ga-git-chip' },
            translate('strip.commits', { count: repo.commitsInRange, days })),
        compact || lastCommit === null
          ? null
          : h('span', { key: 'last', className: 'ga-git-line' },
            h('span', { className: 'ga-git-subject', title: lastCommit.subject }, lastCommit.subject),
            h('span', null, '·'),
            h('span', { className: 'ga-git-time' }, relativeTime(lastCommit.at, nowMs)),
          ),
      ]
      return h('button', {
        type: 'button',
        className: compact ? 'ga-git ga-git-hero ga-git-open' : 'ga-git ga-git-strip ga-git-open',
        title: translate('strip.openDetail'),
        'aria-label': translate('strip.openDetail'),
        onClick: onOpenDetail,
      }, info)
    }

    /** 会话内的 Git 状态条（composer 下方的环境信息位）。 */
    function SessionGitStrip({ sessionId, useWorkspaces, useSession, openDetail }) {
      useLocaleRevision()
      const blank = useSession(snapshot => snapshot.blank)
      const workspaceId = useSessionWorkspaceId(useWorkspaces, sessionId)
      const { data, nowMs } = useProjectGit(blank === true ? null : workspaceId, 14)
      if (blank === true || workspaceId === null || data === null || data.hidden === true) return null
      return h(GitStatus, {
        project: data.project,
        days: data.days ?? 14,
        nowMs,
        compact: false,
        onOpenDetail: () => openDetail(workspaceId, data.project?.title),
      })
    }

    /** 新建 Session 页（还没开始对话时）的紧凑 Git 徽标。 */
    function HeroGitChip({ sessionId, useWorkspaces, useSession, openDetail }) {
      useLocaleRevision()
      const blank = useSession(snapshot => snapshot.blank)
      const workspaceId = useSessionWorkspaceId(useWorkspaces, sessionId)
      const { data, nowMs } = useProjectGit(blank === true ? workspaceId : null, 14)
      if (blank !== true || workspaceId === null || data === null || data.hidden === true) return null
      return h(GitStatus, {
        project: data.project,
        days: data.days ?? 14,
        nowMs,
        compact: true,
        onOpenDetail: () => openDetail(workspaceId, data.project?.title),
      })
    }

    /** 右侧栏里的项目详情：当前项目的分支、改动文件、每日分布与提交历史。 */
    function ProjectDetailTab({ useTabInfo, sessionId, useWorkspaces, openBoard }) {
      useLocaleRevision()
      const readTabInfo = typeof useTabInfo === 'function' ? useTabInfo : () => undefined
      const info = readTabInfo()
      const params = info?.tab?.navigation?.params
      const fallbackId = useSessionWorkspaceId(useWorkspaces, sessionId)
      const paramsId = params !== null && params !== undefined && typeof params.workspaceId === 'string'
        ? params.workspaceId
        : null
      const workspaceId = paramsId ?? fallbackId
      const { data, nowMs } = useProjectGit(workspaceId, 14)

      const shell = children => h('div', { className: 'ga-page ga-page-inpanel' },
        h('div', { className: 'ga-shell' }, children))

      if (data === null) {
        return shell(h('div', { className: 'ga-empty' },
          h('span', { className: 'ga-empty-body' }, translate('detail.loading'))))
      }
      if (data.hidden === true) {
        return shell(h('div', { className: 'ga-empty' },
          h('span', { className: 'ga-empty-title' }, translate('detail.hidden'))))
      }
      const project = data.project
      if (project === null || project === undefined) {
        return shell(h('div', { className: 'ga-empty' },
          h('span', { className: 'ga-empty-title' }, translate('detail.missing'))))
      }
      const repos = Array.isArray(project.repos) ? project.repos : []
      const days = data.days ?? 14

      return shell([
        h('header', { key: 'head', className: 'ga-head' },
          h('div', { className: 'ga-head-main' },
            h('h1', { className: 'ga-title' }, project.title),
            project.path === '' ? null : h('p', { className: 'ga-path', title: project.path }, project.path),
          ),
          h('div', { className: 'ga-head-tools' },
            h('button', {
              type: 'button',
              className: 'ga-btn',
              onClick: openBoard,
            }, translate('detail.openBoard'))),
        ),
        repos.length === 0
          ? h('div', { key: 'norepo', className: 'ga-empty' },
            h('span', { className: 'ga-empty-title' }, translate('card.noRepo')),
            h('span', { className: 'ga-empty-body' }, translate('card.noRepoHint')),
            project.parentRepo === null || project.parentRepo === undefined
              ? null
              : h('span', { className: 'ga-note' },
                translate('card.parentRepo', { path: project.parentRepo })))
          : h('section', { key: 'repo', className: 'ga-section' },
            repos.map((repo, index) => h('div', {
              key: repo.root ?? index,
              className: 'ga-card',
            }, h(RepoBlock, {
              repo,
              days,
              nowMs,
              showChips: true,
              defaultExpanded: true,
            })))),
        h('div', { key: 'foot', className: 'ga-foot' },
          h('span', null, translate('foot.note'))),
      ])
    }

    /** tab 标签上的文字：打开时把项目名放进 params，这里读出来。 */
    function ProjectTabTitle({ useTabInfo }) {
      const readTabInfo = typeof useTabInfo === 'function' ? useTabInfo : () => undefined
      const info = readTabInfo()
      const label = info?.tab?.navigation?.params?.label
      return h('span', null, typeof label === 'string' && label !== '' ? label : translate('panel.title'))
    }

    // ---------------------------------------------------------------- 页面

    const RANGES = [7, 14, 30]

    function BoardPage() {
      useLocaleRevision()
      const [days, setDays] = useState(14)
      const [payload, setPayload] = useState(null)
      const [error, setError] = useState(null)
      // 'loading' 首屏 | 'idle' 已有数据 | 'refreshing' 手动刷新 | 'failed' 首屏失败
      const [phase, setPhase] = useState('loading')
      const [updatedAt, setUpdatedAt] = useState(null)
      const [hiddenOpen, setHiddenOpen] = useState(false)
      const [busy, setBusy] = useState(false)
      const [nowMs, setNowMs] = useState(() => Date.now())
      const [tick, setTick] = useState(0)
      const payloadRef = useRef(null)
      const forceRef = useRef(false)
      const manualRef = useRef(false)

      /** 隐藏/恢复一次；服务器返回重新算好的看板，直接替换本地数据。 */
      const applyHidden = async (action, id) => {
        if (busy) return
        setBusy(true)
        try {
          const board = await postHidden(days, action, id)
          payloadRef.current = board
          setPayload(board)
          setError(null)
          setUpdatedAt(Date.now())
          setNowMs(Date.now())
          setPhase('idle')
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
        } finally {
          setBusy(false)
        }
      }

      const requestRefresh = useCallback(force => {
        forceRef.current = force === true
        manualRef.current = true
        setTick(value => value + 1)
      }, [])

      useEffect(() => {
        const controller = new AbortController()
        const force = forceRef.current
        const manual = manualRef.current
        forceRef.current = false
        manualRef.current = false
        if (manual) setPhase('refreshing')
        else if (payloadRef.current === null) setPhase('loading')

        fetchBoard(days, force, controller.signal)
          .then(data => {
            if (controller.signal.aborted) return
            payloadRef.current = data
            setPayload(data)
            setError(null)
            setUpdatedAt(Date.now())
            setNowMs(Date.now())
            setPhase('idle')
          })
          .catch(caught => {
            if (controller.signal.aborted) return
            if (caught && caught.name === 'AbortError') return
            setError(caught instanceof Error ? caught.message : String(caught))
            setPhase(payloadRef.current === null ? 'failed' : 'idle')
          })
        return () => controller.abort()
      }, [days, tick])

      // 后台轮询：静默刷新，不改 phase、不触发 aria-live 播报。
      useEffect(() => {
        const timer = setInterval(() => {
          if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
          setNowMs(Date.now())
          setTick(value => value + 1)
        }, POLL_MS)
        return () => clearInterval(timer)
      }, [])

      const totals = payload?.totals ?? null
      const projects = Array.isArray(payload?.projects) ? payload.projects : []
      // 标签一律用「当前展示数据」的窗口，切区间时不会用新窗口标注旧数字。
      const windowDays = payload?.days ?? days
      const switching = payload !== null && payload.days !== days
      const hasActivity = projects.some(project => (project.repos ?? []).some(repo => (repo.commits ?? []).length > 0))
      const activityTotal = totals === null ? 0 : totals.commits
      const hiddenProjects = Array.isArray(payload?.hidden) ? payload.hidden : []
      const hasHidden = hiddenProjects.length > 0
      // 全部隐藏时自动展开恢复列表，否则用户看不到任何入口。
      const showHiddenPanel = hasHidden && (hiddenOpen || projects.length === 0)

      const refreshLabel = phase === 'refreshing' || phase === 'loading'
        ? translate('foot.stale')
        : translate('panel.refresh')

      const header = h('header', { className: 'ga-head' },
        h('div', { className: 'ga-head-main' },
          h('h1', { className: 'ga-title' }, translate('panel.title')),
          h('p', { className: 'ga-sub' }, translate('panel.subtitle')),
        ),
        h('div', { className: 'ga-head-tools' },
          h('div', { className: 'ga-ranges', role: 'group', 'aria-label': translate('panel.rangeLabel') },
            RANGES.map(value => h('button', {
              key: value,
              type: 'button',
              className: 'ga-range',
              'aria-pressed': days === value,
              onClick: () => setDays(value),
            }, translate(`panel.range.${value}`))),
          ),
          h('button', {
            type: 'button',
            className: 'ga-btn ga-btn-icon',
            title: refreshLabel,
            'aria-label': refreshLabel,
            disabled: phase === 'refreshing' || phase === 'loading',
            onClick: () => requestRefresh(true),
          }, h(RefreshIcon, { spinning: phase === 'refreshing' || phase === 'loading' })),
          h('span', { className: 'ga-updated' },
            phase === 'failed'
              ? translate('panel.connectFailed')
              : updatedAt === null
                ? translate('panel.connect')
                : switching
                  ? translate('panel.switching', { days })
                  : translate('panel.updatedAt', { time: stampLabel(updatedAt) })),
        ),
      )

      const statHint = totals === null
        ? null
        : {
          projects: translate('stat.projects.hint', { n: totals.repos }),
          commits: translate('stat.commits.hint', {
            n: (totals.commits / Math.max(1, windowDays)).toFixed(1),
          }),
          dirty: translate('stat.dirty.hint', { n: totals.dirtyRepos }),
          sessions: translate('stat.sessions.hint'),
        }

      const stats = totals === null
        ? h('div', { className: 'ga-stats', 'aria-hidden': 'true' },
          [0, 1, 2, 3].map(key => h('div', { key, className: 'ga-skeleton-stat' })))
        : h('div', { className: 'ga-stats' },
          h(StatCard, {
            label: translate('stat.projects'),
            value: totals.workspaces,
            hint: statHint.projects,
          }),
          h(StatCard, {
            label: translate('stat.commits', { days: windowDays }),
            value: totals.commits,
            hint: statHint.commits,
          }),
          h(StatCard, {
            label: translate('stat.dirty'),
            value: totals.uncommittedFiles,
            hint: statHint.dirty,
            tone: totals.uncommittedFiles > 0 ? 'warn' : undefined,
          }),
          h(StatCard, {
            label: translate('stat.sessions'),
            value: totals.sessions,
            hint: statHint.sessions,
          }),
        )

      const errorBanner = error === null ? null : h('div', { className: 'ga-banner', role: 'alert' },
        h('div', { className: 'ga-banner-text' },
          h('span', { className: 'ga-banner-title' }, translate('error.title')),
          h('span', { className: 'ga-banner-detail' }, error),
        ),
        h('button', {
          type: 'button',
          className: 'ga-btn',
          onClick: () => requestRefresh(true),
        }, translate('error.retry')),
      )

      let body
      if (phase === 'failed' && payload === null) {
        body = h('div', { className: 'ga-empty' },
          h('span', { className: 'ga-empty-title' }, translate('error.title')),
          h('span', { className: 'ga-empty-body' }, translate('error.network')),
        )
      } else if (payload === null) {
        body = h('div', { className: 'ga-skeleton' },
          [0, 1, 2, 3].map(key => h('div', { key, className: 'ga-skeleton-card' })))
      } else if (projects.length === 0 && !hasHidden) {
        body = h('div', { className: 'ga-empty' },
          h('span', { className: 'ga-empty-title' }, translate('empty.title')),
          h('span', { className: 'ga-empty-body' }, translate('empty.body')),
        )
      } else {
        body = [
          h('section', { key: 'projects', className: 'ga-section' },
            h('div', { className: 'ga-section-head' },
              h('h2', { className: 'ga-section-title' }, translate('section.projects')),
              h('span', { className: 'ga-section-count' }, String(projects.length)),
              hasHidden
                ? h('span', { className: 'ga-section-tools' },
                  h('button', {
                    type: 'button',
                    className: 'ga-link-btn',
                    'aria-expanded': showHiddenPanel,
                    onClick: () => setHiddenOpen(value => !value),
                  }, translate('hidden.count', { n: hiddenProjects.length })))
                : null,
            ),
            showHiddenPanel
              ? h(HiddenPanel, {
                items: hiddenProjects,
                busy,
                onRestore: id => { void applyHidden('show', id) },
                onRestoreAll: () => { void applyHidden('showAll') },
              })
              : null,
            projects.length > 0
              ? h('div', { className: 'ga-grid' }, projects.map(project => h(ProjectCard, {
                key: project.id,
                project,
                days: windowDays,
                nowMs,
                busy,
                onHide: id => { void applyHidden('hide', id) },
              })))
              : h('div', { className: 'ga-empty' },
                h('span', { className: 'ga-empty-title' }, translate('hidden.allHidden')),
                h('span', { className: 'ga-empty-body' }, translate('hidden.emptyBody')),
              ),
          ),
          hasActivity
            ? h('section', { key: 'activity', className: 'ga-section' },
              h('div', { className: 'ga-section-head' },
                h('h2', { className: 'ga-section-title' }, translate('section.activity')),
                h('span', { className: 'ga-section-count' },
                  translate('section.activityCount', { n: activityTotal })),
              ),
              h(Timeline, { projects, nowMs }),
            )
            : null,
        ]
      }

      const foot = payload === null ? null : h('div', { className: 'ga-foot' },
        h('span', null, translate('foot.note')),
        h('span', { className: 'ga-dot' }),
        h('span', null, translate('foot.duration', { ms: payload.durationMs ?? 0 })),
        payload.cached === true ? h('span', { className: 'ga-dot' }) : null,
        payload.cached === true ? h('span', null, translate('foot.cached')) : null,
      )

      return h('div', { className: 'ga-page' },
        h('div', { className: 'ga-shell' },
          header,
          stats,
          errorBanner,
          body,
          foot,
        ),
      )
    }

    // ---------------------------------------------------------------- 图标

    function PanelIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 16
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': 'true',
      },
      // 一条主干 + 一条支线 + 三个节点，表达「提交历史」。
      h('path', {
        d: 'M4.2 3.1v9.8M11.8 3.1v3.4a2 2 0 0 1-2 2H6.2a2 2 0 0 0-2 2v2.4',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
      }),
      h('circle', { cx: 4.2, cy: 2.6, r: 1.35, stroke: 'currentColor', strokeWidth: 1.4 }),
      h('circle', { cx: 11.8, cy: 2.6, r: 1.35, stroke: 'currentColor', strokeWidth: 1.4 }),
      h('circle', { cx: 4.2, cy: 13.4, r: 1.35, stroke: 'currentColor', strokeWidth: 1.4 }),
      )
    }

    // ---------------------------------------------------------------- 插件

    return {
      name: PANEL_ID,
      inject: ['slots', 'locale'],
      apply(ctx) {
        const service = ctx.get('locale')
        let boundTranslate = null
        if (service !== undefined && service !== null && typeof service.register === 'function') {
          localeService = service
          try {
            const disposeDictionaries = service.register(LOCALE_NS, { en: EN, zh: ZH })
            ctx.effect(() => disposeDictionaries, 'git-activity: locale dictionaries')
          } catch {
            // 同一命名空间已注册（HMR 重入）时沿用既有字典。
          }
          if (typeof service.bind === 'function') {
            const bound = service.bind(LOCALE_NS)
            boundTranslate = (key, params) => {
              const template = bound(key, params)
              return typeof template === 'string' ? template : fill(String(template ?? key), params)
            }
          }
        }
        // 字典没真正生效时（例如 HMR 重入后旧字典已被销毁）退回本地回退表，避免界面显示裸键。
        translate = boundTranslate !== null && boundTranslate('panel.title') !== 'panel.title'
          ? boundTranslate
          : fallbackTranslate

        ctx.effect(() => injectStyles(), 'git-activity: styles')

        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 40,
          label: () => translate('panel.title'),
        }, PanelIcon)), 'git-activity: sidebar entry')

        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: LOCALE_NS,
        }, BoardPage)), 'git-activity: board page')

        // 从会话里的状态条跳到整块看板：主栏切成看板，右侧详情栏让出宽度。
        const openBoard = () => {
          const layout = ctx.get('layout')
          if (layout === null || layout === undefined) return
          if (typeof layout.selectPanel === 'function') layout.selectPanel(PANEL_ID)
          if (typeof layout.closeRightbar === 'function') layout.closeRightbar()
        }

        // 在右侧栏打开（或复用）这个项目的详情 tab。
        const openDetail = (workspaceId, label) => {
          const service = ctx.get('sidebarRight')
          if (service === null || service === undefined || typeof service.openTab !== 'function') return
          try {
            const params = { workspaceId }
            if (typeof label === 'string' && label !== '') params.label = label
            service.openTab(TAB_KIND, { params })
          } catch {
            // 右侧栏不可用（或 kind 尚未注册）时什么都不做：详情是增强，不该报错打断对话。
          }
        }

        // 右侧栏 tab 类型：静态定义 + 正文，两者共用 TAB_ID。
        ctx.effect(() => {
          const disposeInject = ctx.inject(['sidebarRightTabs'], scoped => {
            const disposers = []
            const keep = handle => {
              if (typeof handle === 'function') disposers.push(handle)
            }
            try {
              const tabs = scoped.sidebarRightTabs
              if (tabs === undefined || tabs === null || typeof tabs.register !== 'function') return
              keep(tabs.register({
                id: TAB_ID,
                kind: TAB_KIND,
                title: () => translate('panel.title'),
              }))
              keep(scoped.slots.inject('sidebar.right.pane.tab', () => scoped.slots.register({
                name: 'sidebar.right.pane.tab',
                key: TAB_ID,
                locale: LOCALE_NS,
                inject: () => ({ openBoard }),
              }, ProjectDetailTab)))
              keep(scoped.slots.inject('sidebar.right.pane.tab.title', () => scoped.slots.register({
                name: 'sidebar.right.pane.tab.title',
                key: TAB_ID,
              }, ProjectTabTitle)))
            } catch {
              for (const dispose of disposers) dispose()
              return
            }
            return () => {
              for (const dispose of disposers) dispose()
            }
          })
          return () => {
            if (typeof disposeInject === 'function') disposeInject()
            else if (disposeInject !== undefined && disposeInject !== null) disposeInject.dispose?.()
          }
        }, 'git-activity: right-sidebar detail tab')

        // 会话内：composer 下方的环境信息位，显示这个项目当前分支/改动/最近提交。
        ctx.effect(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'dsh-git-activity-session',
          order: 2,
          locale: LOCALE_NS,
          inject: () => ({ openDetail }),
        }, SessionGitStrip)), 'git-activity: session git strip')

        // 新建 Session 页：工作区/预设控件之后的小徽标。
        ctx.effect(() => ctx.slots.inject('conversation.hero.options', () => ctx.slots.register({
          name: 'conversation.hero.options',
          id: 'dsh-git-activity-hero',
          order: 0,
          locale: LOCALE_NS,
          inject: () => ({ openDetail }),
        }, HeroGitChip)), 'git-activity: new-session git chip')
      },
    }
  },
})
