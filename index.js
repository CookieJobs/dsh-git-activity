/**
 * dsh-git-activity — 项目进展看板（Host 半身）。
 *
 * 扫描当前 profile 下每个 Workspace 对应的 Git 仓库，汇总「最近提交 / 未提交改动 /
 * 分支与落后领先 / 每日提交分布 / DSH 会话数」，组成一个只读看板，通过 Web 载体
 * 暴露给浏览器半身：
 *
 *   GET /git-activity/api/board?days=14&refresh=1
 *
 * 只读约束：只运行 rev-parse / status / log / rev-list，并且给每个 git 调用加上
 * `--no-optional-locks`，避免和其它 Agent 的 git 进程抢 index.lock。
 *
 * 同一个扫描结果在 config.cacheMs 内复用，页面轮询不会反复拉起 git 进程。
 *
 * 已声明的配置项（cordis.patch.yml 里改，缺省值见 DEFAULTS）：
 *   days / maxCommits / historyLimit / scanChildren / cacheMs / gitTimeoutMs /
 *   maxReposPerWorkspace / extraRepos
 *
 * @module dsh-git-activity
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

/** 浏览器半身请求的路由前缀。 */
const ROUTE_PREFIX = '/git-activity/api'
/** 单个 git 进程的 stdout 上限，防止超大仓库把内存打满。 */
const MAX_BUFFER_BYTES = 8 * 1024 * 1024
/** `git log` 的字段分隔符（不可打印字符，提交信息里不会出现）。 */
const FIELD_SEP = '\u001f'
const LOG_FORMAT = `%H${FIELD_SEP}%h${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%s`
/** 子目录扫描时跳过的目录名。 */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', '.next',
  '.venv', 'venv', '__pycache__', '.cache', 'coverage', '.idea', '.vscode',
])

/** 缺失或非法配置的回退值。 */
const DEFAULTS = {
  days: 14,
  maxCommits: 30,
  historyLimit: 400,
  scanChildren: true,
  cacheMs: 8000,
  gitTimeoutMs: 6000,
  maxReposPerWorkspace: 16,
  extraRepos: [],
}

/**
 * 被隐藏项目的持久化位置：`$DSH_HOME/git-activity/hidden.json`。
 *
 * 只存项目 id（`workspace:<id>` / `extra:<path>`），不存标题和路径 —— 标题改了、
 * 目录挪了，恢复后仍然对得上；工作区被删掉时这条 id 只是躺着不生效。
 */
function stateDirectory() {
  const home = (process.env.DSH_HOME ?? '').trim() || join(homedir(), '.dsh')
  return join(home, 'git-activity')
}

function hiddenStateFile() {
  return join(stateDirectory(), 'hidden.json')
}

/** 读隐藏列表；文件缺失、损坏或类型不对都当作「没有隐藏任何项目」。 */
function readHiddenIds() {
  try {
    const parsed = JSON.parse(readFileSync(hiddenStateFile(), 'utf8'))
    if (!Array.isArray(parsed?.hidden)) return []
    return [...new Set(parsed.hidden.filter(id => typeof id === 'string' && id !== ''))]
  } catch {
    return []
  }
}

/** 原子写隐藏列表（先写临时文件再 rename，避免半个文件）。 */
function writeHiddenIds(ids) {
  const directory = stateDirectory()
  mkdirSync(directory, { recursive: true })
  const file = hiddenStateFile()
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify({ version: 1, hidden: ids }, null, 2), 'utf8')
  renameSync(temporary, file)
}

/** 把任意输入夹成合法整数。 */
function clampInt(value, fallback, min, max) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

/** 归一化用户配置，任何字段缺失或类型不对都退回默认值。 */
function normalizeOptions(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    days: clampInt(source.days, DEFAULTS.days, 1, 365),
    maxCommits: clampInt(source.maxCommits, DEFAULTS.maxCommits, 1, 200),
    historyLimit: clampInt(source.historyLimit, DEFAULTS.historyLimit, 1, 2000),
    scanChildren: source.scanChildren !== false,
    cacheMs: clampInt(source.cacheMs, DEFAULTS.cacheMs, 0, 300_000),
    gitTimeoutMs: clampInt(source.gitTimeoutMs, DEFAULTS.gitTimeoutMs, 500, 60_000),
    maxReposPerWorkspace: clampInt(
      source.maxReposPerWorkspace, DEFAULTS.maxReposPerWorkspace, 1, 64,
    ),
    extraRepos: Array.isArray(source.extraRepos)
      ? source.extraRepos.filter(item => typeof item === 'string' && item.trim() !== '')
      : [],
  }
}

/**
 * 运行一条只读 git 命令，永不抛出：失败统一以 `{ ok: false, error }` 返回。
 * @param {string} cwd 仓库（或待探测目录）。
 * @param {string[]} args 不含 `git` 本身的参数。
 * @param {object} options 归一化配置（取 gitTimeoutMs）。
 * @returns {Promise<{ ok: boolean, stdout: string, error: string | null }>}
 */
function runGit(cwd, args, options) {
  return new Promise(resolvePromise => {
    execFile(
      'git',
      ['--no-optional-locks', ...args],
      {
        cwd,
        timeout: options.gitTimeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
        encoding: 'utf8',
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error === null || error === undefined) {
          resolvePromise({ ok: true, stdout: String(stdout ?? ''), error: null })
          return
        }
        const message = String(stderr ?? '').trim() || String(error.message ?? error).trim()
        resolvePromise({ ok: false, stdout: String(stdout ?? ''), error: message })
      },
    )
  })
}

/** 把 `git status --porcelain` 的输出折成计数与少量文件条目。 */
function parseStatus(output) {
  const dirty = { total: 0, staged: 0, unstaged: 0, untracked: 0, files: [] }
  for (const line of String(output).split('\n')) {
    if (line.trim() === '') continue
    const index = line[0] ?? ' '
    const worktree = line[1] ?? ' '
    const untracked = index === '?' && worktree === '?'
    dirty.total += 1
    if (untracked) dirty.untracked += 1
    else {
      if (index !== ' ' && index !== '?') dirty.staged += 1
      if (worktree !== ' ' && worktree !== '?') dirty.unstaged += 1
    }
    // 每类最多回传 12 条文件，卡片只展示前几条。
    if (dirty.files.length < 12) {
      dirty.files.push({ code: untracked ? '??' : `${index}${worktree}`.trim(), path: line.slice(3) })
    }
  }
  return dirty
}

/** 解析 `git log --pretty=format:<LOG_FORMAT>` 的输出。 */
function parseCommits(output) {
  const commits = []
  for (const line of String(output).split('\n')) {
    if (line === '') continue
    const parts = line.split(FIELD_SEP)
    if (parts.length < 5) continue
    commits.push({
      sha: parts[0],
      short: parts[1],
      author: parts[2],
      at: parts[3],
      subject: parts.slice(4).join(FIELD_SEP),
    })
  }
  return commits
}

/** 本地日期键，和浏览器时区一致（`YYYY-MM-DD`）。 */
function localDateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 窗口内每日提交数，补零到完整窗口，供卡片画迷你柱状图。
 * @param {Array<{ at: string }>} commits 窗口内的提交（可能被 historyLimit 截断）。
 * @param {number} days 窗口天数。
 */
function buildDailySeries(commits, days) {
  const counts = new Map()
  for (const commit of commits) {
    const at = new Date(commit.at)
    if (Number.isNaN(at.getTime())) continue
    const key = localDateKey(at)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const series = []
  const now = new Date()
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)
    const key = localDateKey(day)
    series.push({ date: key, count: counts.get(key) ?? 0 })
  }
  return series
}

/** 读一个目录的直接子目录，失败时返回空数组。 */
function listDirectories(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.'))
      .map(entry => join(dir, entry.name))
  } catch {
    return []
  }
}

/**
 * 找到某个 Workspace 目录真正拥有的仓库根。
 *
 * 规则：只有「工作区自己就是仓库根」或「仓库根在工作区里面（子仓库）」才算这个项目的
 * 仓库。工作区落在一个更大的仓库里（例如 `~/Documents` 被误初始化成仓库）时，父仓库的
 * 提交不属于这个项目，只把它记成 `ancestorRoot` 供界面提示，不参与统计。
 */
async function discoverRepoRoots(dir, options) {
  const roots = []
  const seen = new Set()
  let ancestorRoot = null

  const self = await runGit(dir, ['rev-parse', '--show-toplevel'], options)
  if (self.ok && self.stdout.trim() !== '') {
    const toplevel = self.stdout.trim()
    if (samePath(toplevel, dir)) {
      seen.add(toplevel)
      roots.push(toplevel)
    } else {
      ancestorRoot = toplevel
    }
  }

  if (roots.length === 0 && options.scanChildren) {
    for (const child of listDirectories(dir)) {
      if (roots.length >= options.maxReposPerWorkspace) break
      if (!existsSync(join(child, '.git'))) continue
      const nested = await runGit(child, ['rev-parse', '--show-toplevel'], options)
      if (!nested.ok || nested.stdout.trim() === '') continue
      const root = nested.stdout.trim()
      if (seen.has(root)) continue
      seen.add(root)
      roots.push(root)
    }
  }

  return { roots, ancestorRoot }
}

/** 比较两个路径是否指向同一个目录（能 realpath 就 realpath）。 */
function samePath(left, right) {
  const normalizedLeft = safeRealpath(left)
  const normalizedRight = safeRealpath(right)
  return normalizedLeft === normalizedRight
}

function safeRealpath(target) {
  try {
    return realpathSync(target)
  } catch {
    return resolve(target)
  }
}

/**
 * 读一个仓库的看板数据。
 *
 * 空仓库（有分支但还没有任何提交）是正常状态：不报错、不回退成「读取失败」，
 * 只是没有提交。真正的 git 失败（超时、权限、损坏）仍记进 `error`。
 *
 * @param {string} root 仓库根目录。
 * @param {object} options 归一化配置。
 */
async function readRepo(root, options) {
  const since = `${options.days} days ago`
  const repo = {
    root,
    name: basename(root) || root,
    branch: '',
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    dirty: { total: 0, staged: 0, unstaged: 0, untracked: 0, files: [] },
    commitsInRange: 0,
    lastCommit: null,
    commits: [],
    daily: [],
    error: null,
  }

  const problems = []
  const note = (result, label) => {
    if (!result.ok && result.error !== null && !isBenignGitError(result.error)) {
      problems.push(`${label}: ${result.error}`)
    }
  }

  // HEAD 是否存在决定后面是否值得跑 log/rev-list；空仓库只关心分支名与工作区状态。
  const head = await runGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], options)
  const hasCommits = head.ok && head.stdout.trim() !== ''

  const status = await runGit(root, ['status', '--porcelain'], options)
  note(status, 'status')
  if (status.ok) repo.dirty = parseStatus(status.stdout)

  if (!hasCommits) {
    // 还没有提交：`rev-parse --abbrev-ref HEAD` 会失败，用 symbolic-ref 拿分支名。
    const unborn = await runGit(root, ['symbolic-ref', '--short', 'HEAD'], options)
    if (unborn.ok) repo.branch = unborn.stdout.trim()
    repo.daily = buildDailySeries([], options.days)
    repo.error = problems.length > 0 ? problems.join('; ') : null
    return repo
  }

  const [abbrev, log, count, last, upstream] = await Promise.all([
    runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'], options),
    runGit(root, [
      'log', `--max-count=${options.historyLimit}`, `--since=${since}`,
      '--date-order', `--pretty=format:${LOG_FORMAT}`,
    ], options),
    runGit(root, ['rev-list', '--count', `--since=${since}`, 'HEAD'], options),
    runGit(root, ['log', '-1', `--pretty=format:${LOG_FORMAT}`], options),
    runGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], options),
  ])

  note(log, 'log')

  if (abbrev.ok) {
    const value = abbrev.stdout.trim()
    if (value === 'HEAD' || value === '') {
      repo.detached = true
      const short = await runGit(root, ['rev-parse', '--short', 'HEAD'], options)
      if (short.ok) repo.branch = short.stdout.trim()
    } else {
      repo.branch = value
    }
  }

  const windowCommits = log.ok ? parseCommits(log.stdout) : []
  repo.daily = buildDailySeries(windowCommits, options.days)
  repo.commits = windowCommits.slice(0, options.maxCommits)
  repo.commitsInRange = count.ok && count.stdout.trim() !== ''
    ? clampInt(count.stdout.trim(), windowCommits.length, 0, 1_000_000)
    : windowCommits.length

  if (last.ok) {
    const [latest] = parseCommits(last.stdout)
    if (latest !== undefined) repo.lastCommit = latest
  }

  if (upstream.ok && upstream.stdout.trim() !== '') {
    repo.upstream = upstream.stdout.trim()
    const divergence = await runGit(
      root, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], options,
    )
    if (divergence.ok) {
      const [ahead, behind] = divergence.stdout.trim().split(/\s+/)
      repo.ahead = clampInt(ahead, 0, 0, 1_000_000)
      repo.behind = clampInt(behind, 0, 0, 1_000_000)
    }
  }

  repo.error = problems.length > 0 ? problems.join('; ') : null
  return repo
}

/** git 在空仓库、无上游、未跟踪状态下的正常报错，不算失败。 */
function isBenignGitError(message) {
  const text = String(message).toLowerCase()
  return text.includes('does not have any commits yet')
    || text.includes('unknown revision')
    || text.includes('ambiguous argument')
    || text.includes('no upstream')
    || text.includes('no such branch')
}

/**
 * 把一个 Workspace 展开成看板上的一个项目。
 * @param {object} workspace `{ id, title, path, sessionIds, updatedAt }`
 * @param {object} options 归一化配置。
 * @param {Set<string>} [claimedRoots] 已归属其它项目的仓库根，避免同一个仓库被重复计数。
 */
async function buildWorkspaceProject(workspace, options, claimedRoots) {
  const project = {
    id: `workspace:${workspace.id}`,
    kind: 'workspace',
    title: workspace.title ?? basename(workspace.path ?? '') ?? '',
    path: workspace.path ?? '',
    sessions: Array.isArray(workspace.sessionIds) ? workspace.sessionIds.length : 0,
    lastSessionAt: typeof workspace.updatedAt === 'string' ? workspace.updatedAt : null,
    status: 'ok',
    parentRepo: null,
    repos: [],
    error: null,
  }
  if (project.path === '' || !existsSync(project.path)) {
    project.status = 'missing-dir'
    return project
  }
  try {
    const discovered = await discoverRepoRoots(project.path, options)
    project.parentRepo = discovered.ancestorRoot
    const roots = claimedRoots === undefined
      ? discovered.roots
      : discovered.roots.filter(root => !claimedRoots.has(root))
    for (const root of roots) claimedRoots?.add(root)
    project.repos = await Promise.all(roots.map(root => readRepo(root, options)))
  } catch (error) {
    project.error = error instanceof Error ? error.message : String(error)
  }
  return project
}

/** 汇总所有 Workspace（以及额外配置的仓库）的看板数据。 */
async function collectBoard(options, deps) {
  const startedAt = Date.now()
  const workspaces = typeof deps?.listWorkspaces === 'function' ? deps.listWorkspaces() : []
  const projects = []
  const claimedRoots = new Set()

  for (const workspace of workspaces) {
    const project = await buildWorkspaceProject(workspace, options, claimedRoots)
    projects.push(project)
  }

  for (const extra of options.extraRepos) {
    const target = extra.trim()
    if (target === '' || !existsSync(target)) continue
    const discovered = await discoverRepoRoots(target, { ...options, scanChildren: false })
    const root = discovered.roots[0] ?? discovered.ancestorRoot
    if (root === null || root === undefined || claimedRoots.has(root)) continue
    claimedRoots.add(root)
    projects.push({
      id: `extra:${root}`,
      kind: 'extra',
      title: basename(target) || target,
      path: target,
      sessions: 0,
      lastSessionAt: null,
      status: 'ok',
      parentRepo: null,
      repos: [await readRepo(root, options)],
      error: null,
    })
  }

  const hiddenIds = new Set(typeof deps?.hiddenIds === 'function' ? deps.hiddenIds() : [])
  const visible = projects.filter(project => !hiddenIds.has(project.id))
  const hidden = projects
    .filter(project => hiddenIds.has(project.id))
    .map(project => ({
      id: project.id,
      title: project.title,
      path: project.path,
      kind: project.kind,
      sessions: project.sessions,
    }))

  const repos = visible.flatMap(project => project.repos)
  const totals = {
    workspaces: visible.length,
    repos: repos.length,
    commits: repos.reduce((sum, repo) => sum + repo.commitsInRange, 0),
    dirtyRepos: repos.filter(repo => repo.dirty.total > 0).length,
    uncommittedFiles: repos.reduce((sum, repo) => sum + repo.dirty.total, 0),
    sessions: visible.reduce((sum, project) => sum + project.sessions, 0),
  }

  // 最近活跃的项目排前面：有提交的按最新提交时间，没有的按会话更新时间。
  const recency = project => {
    const times = project.repos
      .map(repo => (repo.lastCommit === null ? 0 : Date.parse(repo.lastCommit.at)))
      .filter(value => Number.isFinite(value))
    if (times.length > 0) return Math.max(...times)
    const sessionAt = project.lastSessionAt === null ? 0 : Date.parse(project.lastSessionAt)
    return Number.isFinite(sessionAt) ? sessionAt : 0
  }
  visible.sort((left, right) => recency(right) - recency(left))
  hidden.sort((left, right) => left.title.localeCompare(right.title))

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    days: options.days,
    durationMs: Date.now() - startedAt,
    cached: false,
    totals,
    projects: visible,
    hidden,
  }
}

/** 按 days 缓存扫描结果，并复用同一时刻的进行中请求。 */
function createBoardLoader(deps, options) {
  const cache = new Map()
  const inflight = new Map()

  return async function loadBoard(days, force) {
    const key = String(days)
    const hit = cache.get(key)
    if (force !== true && hit !== undefined && Date.now() - hit.at < options.cacheMs) {
      return { ...hit.payload, cached: true }
    }
    let pending = force === true ? undefined : inflight.get(key)
    if (pending === undefined) {
      pending = collectBoard({ ...options, days }, deps)
      inflight.set(key, pending)
    }
    try {
      const payload = await pending
      cache.set(key, { at: Date.now(), payload })
      return payload
    } finally {
      if (inflight.get(key) === pending) inflight.delete(key)
    }
  }
}

/** 读取请求体并按 JSON 解析；超过上限直接失败，避免被大包拖住。 */
function readJsonBody(req, limitBytes = 64 * 1024) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = []
    let size = 0
    let settled = false
    const fail = error => {
      if (settled) return
      settled = true
      rejectPromise(error)
    }
    req.on('data', chunk => {
      if (settled) return
      size += chunk.length
      if (size > limitBytes) {
        fail(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      try {
        resolvePromise(chunks.length === 0 ? undefined : JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        rejectPromise(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', fail)
  })
}

/**
 * 应用一次隐藏/恢复操作。
 * @param {unknown} body `{ action: 'hide'|'show', id }` 或 `{ action: 'showAll' }`
 * @returns {{ hidden: string[] }} 新的隐藏列表
 */
function applyHiddenAction(body) {
  const action = body !== null && typeof body === 'object' ? body.action : undefined
  const id = body !== null && typeof body === 'object' ? body.id : undefined
  const current = readHiddenIds()
  if (action === 'showAll') {
    writeHiddenIds([])
    return { hidden: [] }
  }
  if (action !== 'hide' && action !== 'show') {
    const error = new Error('action 必须是 hide、show 或 showAll')
    error.status = 400
    throw error
  }
  if (typeof id !== 'string' || id === '' || id.length > 256) {
    const error = new Error('id 必须是非空字符串')
    error.status = 400
    throw error
  }
  const next = action === 'hide'
    ? [...new Set([...current, id])]
    : current.filter(item => item !== id)
  writeHiddenIds(next)
  return { hidden: next }
}

/**
 * 单个工作区的看板数据，供会话内/新建会话页的紧凑状态条使用。
 * 只扫描这一个工作区，比整块看板便宜；缓存与整块看板同样的 TTL。
 */
function createProjectLoader(deps, options) {
  const cache = new Map()
  const inflight = new Map()

  return async function loadProject(workspaceId, days, force) {
    const key = `${workspaceId}:${days}`
    const hit = cache.get(key)
    if (force !== true && hit !== undefined && Date.now() - hit.at < options.cacheMs) {
      return { ...hit.payload, cached: true }
    }
    let pending = force === true ? undefined : inflight.get(key)
    if (pending === undefined) {
      pending = (async () => {
        const hiddenIds = new Set(typeof deps?.hiddenIds === 'function' ? deps.hiddenIds() : [])
        const workspaces = typeof deps?.listWorkspaces === 'function' ? deps.listWorkspaces() : []
        const workspace = workspaces.find(item => item.id === workspaceId)
        if (workspace === undefined) {
          return { ok: true, days, generatedAt: new Date().toISOString(), hidden: false, project: null, missing: true }
        }
        const hidden = hiddenIds.has(`workspace:${workspace.id}`)
        const project = hidden
          ? null
          : await buildWorkspaceProject(workspace, { ...options, days })
        return { ok: true, days, generatedAt: new Date().toISOString(), hidden, project }
      })()
      inflight.set(key, pending)
    }
    try {
      const payload = await pending
      cache.set(key, { at: Date.now(), payload })
      return { ...payload, cached: false }
    } finally {
      if (inflight.get(key) === pending) inflight.delete(key)
    }
  }
}

/** 统一 JSON 响应。 */
function sendJson(res, status, body) {
  if (res.headersSent === true) {
    res.destroy()
    return
  }
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

/**
 * 用 GUI 自己的连接闸门准入请求，失败即拒绝（fail-closed）。
 * @returns {null | { status: number, code: string, message: string }}
 */
function rejectUnauthorized(connection, req) {
  if (connection === undefined || connection === null || typeof connection.admit !== 'function') {
    return { status: 403, code: 'NO_CONNECTION', message: 'the web carrier has no connection gate' }
  }
  let admission
  try {
    admission = connection.admit({ headers: req.headers })
  } catch {
    return { status: 403, code: 'FORBIDDEN', message: 'the host trust fence rejected this request' }
  }
  if (admission !== null && typeof admission === 'object' && 'peer' in admission && admission.peer !== null) {
    return null
  }
  const rejection = admission !== null && typeof admission === 'object' && 'rejection' in admission
    ? admission.rejection
    : 403
  return {
    status: rejection === 401 ? 401 : 403,
    code: rejection === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
    message: rejection === 401 ? 'not authenticated' : 'request rejected by the host trust fence',
  }
}

/** 构造看板路由：整块看板、单个工作区、隐藏/恢复。 */
function createRouteHandler(ctx, loadBoard, loadProject) {
  return async function handleBoardRequest(req, res) {
    try {
      const rejection = rejectUnauthorized(ctx.get('connection'), req)
      if (rejection !== null) {
        sendJson(res, rejection.status, { ok: false, error: { code: rejection.code, message: rejection.message } })
        return
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      const relative = url.pathname.slice(ROUTE_PREFIX.length).replace(/^\/+/, '')
      if (relative !== '' && relative !== 'board' && relative !== 'hidden' && relative !== 'project') {
        sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: `no route for ${url.pathname}` } })
        return
      }
      const days = clampInt(url.searchParams.get('days'), DEFAULTS.days, 1, 365)
      const force = url.searchParams.get('refresh') === '1'

      if (req.method === 'GET' && relative === 'project') {
        const workspaceId = url.searchParams.get('workspace')
        if (workspaceId === null || workspaceId === '') {
          sendJson(res, 400, { ok: false, error: { code: 'BAD_REQUEST', message: 'workspace 参数必填' } })
          return
        }
        sendJson(res, 200, await loadProject(workspaceId, days, force))
        return
      }
      if (req.method === 'GET') {
        sendJson(res, 200, await loadBoard(days, force))
        return
      }
      if (req.method === 'POST' && relative === 'hidden') {
        applyHiddenAction(await readJsonBody(req))
        // 隐藏状态变了，缓存必须失效，返回新看板省一次往返。
        sendJson(res, 200, { ok: true, board: await loadBoard(days, true) })
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'only GET and POST are supported' } })
        return
      }
      sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: `no route for ${url.pathname}` } })
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500
      if (status >= 500) {
        console.warn(`git-activity: ${error instanceof Error ? error.message : String(error)}`)
      }
      sendJson(res, status, {
        ok: false,
        error: {
          code: status >= 500 ? 'INTERNAL' : 'BAD_REQUEST',
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }
}

/** 把看板数据压成模型易读的扁平结构（Agent 工具的输出）。 */
function toToolValue(board) {
  const projects = board.projects.map(project => {
    const repo = project.repos[0]
    return {
      title: project.title,
      path: project.path,
      sessions: project.sessions,
      isRepo: repo !== undefined,
      branch: repo?.branch !== undefined && repo.branch !== '' ? repo.branch : (repo?.detached === true ? '(detached)' : ''),
      commits: repo?.commitsInRange ?? 0,
      dirtyFiles: repo?.dirty.total ?? 0,
      ahead: repo?.ahead ?? 0,
      behind: repo?.behind ?? 0,
      lastCommit: repo?.lastCommit?.subject ?? '',
      lastCommitAt: repo?.lastCommit?.at ?? '',
    }
  })
  const hiddenCount = Array.isArray(board.hidden) ? board.hidden.length : 0
  const lines = projects.map(project => {
    if (project.isRepo !== true) {
      return `- ${project.title}: 非 Git 仓库，${project.sessions} 个 DSH 会话`
    }
    return `- ${project.title} [${project.branch}] 近 ${board.days} 天 ${project.commits} 个提交，`
      + `未提交 ${project.dirtyFiles}，最近：${project.lastCommit || '无'}`
  })
  if (hiddenCount > 0) lines.push(`（另有 ${hiddenCount} 个项目已隐藏，不计入以上数据）`)
  return {
    days: board.days,
    hiddenCount,
    projectCount: board.totals.workspaces,
    repoCount: board.totals.repos,
    commitCount: board.totals.commits,
    dirtyRepoCount: board.totals.dirtyRepos,
    projects,
    summary: lines.join('\n'),
  }
}

/**
 * 注册 `git_activity` Agent 工具。
 *
 * 本地目录安装的 bundle 无法解析到 dsh 安装里的 `@deepseek-ai/dsh-tools`
 * （bundle 包按 dsh 安装解析，profile 链接的包解析不到），所以这里不用
 * `defineTool` 的简写参数，而是直接给出等价的 JSON Schema 定义：
 * `defineTool` 对简单属性实际产出的就是 `{ type: 'object', properties }`。
 */
function registerAgentTool(scoped, loadBoard, defaults) {
  scoped.effect(() => scoped.tools.register({
    name: 'git_activity',
    description:
      'Read the project activity board: for every DSH workspace, its Git branch, commits in the '
      + 'chosen window, uncommitted changes, and the latest commit. Use it when asked what changed '
      + 'recently across projects, including work committed by other agents or editors.',
    parameters: {
      type: 'object',
      properties: {
        days: {
          type: 'integer',
          description: `Commit window in days (1-365). Defaults to ${defaults.days}.`,
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: [
          'days', 'hiddenCount', 'projectCount', 'repoCount', 'commitCount', 'dirtyRepoCount',
          'summary', 'projects',
        ],
        properties: {
          days: { type: 'integer' },
          hiddenCount: { type: 'integer' },
          projectCount: { type: 'integer' },
          repoCount: { type: 'integer' },
          commitCount: { type: 'integer' },
          dirtyRepoCount: { type: 'integer' },
          summary: { type: 'string' },
          projects: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: [
                'title', 'path', 'isRepo', 'branch', 'commits', 'dirtyFiles', 'ahead', 'behind',
                'lastCommit', 'lastCommitAt',
              ],
              properties: {
                title: { type: 'string' },
                path: { type: 'string' },
                sessions: { type: 'integer' },
                isRepo: { type: 'boolean' },
                branch: { type: 'string' },
                commits: { type: 'integer' },
                dirtyFiles: { type: 'integer' },
                ahead: { type: 'integer' },
                behind: { type: 'integer' },
                lastCommit: { type: 'string' },
                lastCommitAt: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
    },
    async execute(args) {
      const days = clampInt(args?.days, defaults.days, 1, 365)
      const board = await loadBoard(days, true)
      return toToolValue(board)
    },
  }), 'git-activity: agent tool')
}

/**
 * 插件入口。
 * @param {object} ctx Cordis Host 上下文。
 * @param {object} config `cordis.patch.yml` 里的配置（可为空）。
 */
export function apply(ctx, config) {
  const options = normalizeOptions(config)

  // Workspace 注册表是可选依赖：没有它时退回默认工作目录，插件依旧可用。
  const deps = {
    hiddenIds: () => readHiddenIds(),
    listWorkspaces() {
      const registry = ctx.get('workspaceRegistry')
      if (registry !== undefined && registry !== null && typeof registry.list === 'function') {
        return registry.list().map(workspace => ({
          id: workspace.id,
          title: workspace.title,
          path: workspace.path,
          sessionIds: workspace.sessionIds,
          updatedAt: workspace.updatedAt,
        }))
      }
      const workingDirectory = ctx.get('workingDirectory')
      const fallback = typeof workingDirectory?.defaultDirectory === 'string'
        ? workingDirectory.defaultDirectory
        : null
      if (fallback === null) return []
      return [{ id: 'default', title: basename(fallback), path: fallback, sessionIds: [], updatedAt: null }]
    },
  }

  const loadBoard = createBoardLoader(deps, options)
  const loadProject = createProjectLoader(deps, options)

  ctx.inject(['webServer', 'connection'], scoped => {
    scoped.effect(() => {
      const remove = scoped.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: createRouteHandler(scoped, loadBoard, loadProject),
      })
      return () => {
        try {
          remove()
        } catch {
          // 载体拆除时路由可能已经跟着一起消失。
        }
      }
    }, 'git-activity: board route')
  })

  ctx.inject(['tools'], scoped => {
    try {
      registerAgentTool(scoped, loadBoard, options)
    } catch {
      // 工具是可选增益，注册失败不影响看板。
    }
  })
}
