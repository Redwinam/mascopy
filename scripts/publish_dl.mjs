// 构建 DMG 并发布到下载服务 dl.if9.cool：上传安装包 → 写版本清单 → 晋升渠道（官网下载按钮跟着渠道走）。
// 用法：node scripts/publish_dl.mjs [--channel stable|beta] [--notes 文本] [--skip-build] [--no-promote] [--allow-dirty]
// 发布令牌：环境变量 DL_RELEASE_TOKEN 优先；没有就用 op 从 1Password「开发启动器 · 发布令牌」读一次
// （dl.if9.cool 各应用共用这一个令牌）。令牌只放进请求头，不打印、不落盘。
// 每一步都可重跑：同名同内容的文件与相同的版本清单由服务端确认「已存在」，中途失败后加 --skip-build 接着发。
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, lstatSync, readFileSync } from 'node:fs'
import https from 'node:https'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

export const API = 'https://dl.if9.cool'
export const APP = 'mascopy'
const CHANNELS = ['stable', 'beta']
// 1Password「开发」保险库里的「开发启动器 · 发布令牌」（op:// 引用不支持中文名，只能用 ID）
const OP_TOKEN_REF = 'op://flkiwmwx6umyyyv76dnxahwpji/tftd6ckzvvkfb5bhroh6exma5a/credential'
// 与下载服务的校验一致：文件名首字符为文字或数字，其余只含文字、数字与 . _ -，最长 128；单文件 ≤ 95 MiB
const FILE_RE = /^[\p{L}\p{Nd}][\p{L}\p{Nd}._-]{0,127}$/u
const MAX_FILE_BYTES = 95 * 1024 * 1024

function json(text, label) {
  try { return JSON.parse(text) } catch { throw new Error(`${label} 返回的 JSON 无效`) }
}

function options(args) {
  const { values } = parseArgs({
    args, strict: true, allowPositionals: false,
    options: {
      channel: { type: 'string', default: 'stable' },
      notes: { type: 'string' },
      'skip-build': { type: 'boolean', default: false },
      'no-promote': { type: 'boolean', default: false },
      'allow-dirty': { type: 'boolean', default: false },
    },
  })
  if (!CHANNELS.includes(values.channel)) throw new Error(`未知渠道「${values.channel}」，可选 ${CHANNELS.join(' / ')}`)
  return values
}

// 这台机器能产出的平台：Tauri 平台键与 DMG 文件名里的架构名
export function platformOf(arch = process.arch) {
  if (arch === 'arm64') return { target: 'darwin-aarch64', dmgArch: 'aarch64' }
  if (arch === 'x64') return { target: 'darwin-x86_64', dmgArch: 'x64' }
  throw new Error(`不支持的架构 ${arch}`)
}

function dmgStamp(path) {
  try {
    const stat = lstatSync(path, { bigint: true })
    return stat.isFile() && stat.size > 0n ? [stat.dev, stat.ino, stat.size, stat.mtimeNs].join(':') : null
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function sha256(path) {
  return new Promise((done, fail) => {
    const hash = createHash('sha256')
    createReadStream(path).on('error', fail).on('data', chunk => hash.update(chunk)).on('end', () => done(hash.digest('hex')))
  })
}

// 小型 HTTPS 客户端：file 给了就流式写进请求体，带 content-length（服务端要按长度校验）
export function httpsRequest(url, { method = 'GET', headers = {}, body, file, timeoutMs = 60000 } = {}) {
  return new Promise((done, fail) => {
    const req = https.request(new URL(url), { method, headers }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('error', fail)
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let data = null
        try { data = JSON.parse(text) } catch { /* 非 JSON 响应按文本给出 */ }
        done({ status: res.statusCode, json: data, text })
      })
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`${Math.round(timeoutMs / 1000)} 秒没有响应`)))
    req.on('error', fail)
    if (file) createReadStream(file).on('error', error => req.destroy(error)).pipe(req)
    else req.end(body)
  })
}

function failure(action, res) {
  const detail = res.json?.message || res.json?.error || String(res.text || '').trim().slice(0, 300)
  const hint = res.status === 401 ? '（发布令牌无效：检查 DL_RELEASE_TOKEN 或 1Password「开发启动器 · 发布令牌」）' : ''
  return new Error(`${action}失败：HTTP ${res.status}${detail ? ` ${detail}` : ''}${hint}`)
}

export async function publishDl({ rootDir, args = [], env = process.env, run = spawnSync, request = httpsRequest, log = console.log, arch = process.arch }) {
  const opts = options(args)
  const { target, dmgArch } = platformOf(arch)
  const call = (command, argv, extra = {}) => run(command, argv, { cwd: rootDir, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...extra })
  const checked = (command, argv, extra = {}) => {
    const result = call(command, argv, extra)
    if (result.error || result.status !== 0) throw new Error(`${command} 执行失败（退出码 ${result.status ?? '不可用'}）`)
    return result.stdout || ''
  }

  const config = json(readFileSync(join(rootDir, 'src-tauri/tauri.conf.json'), 'utf8'), 'Tauri 配置')
  const packageJson = json(readFileSync(join(rootDir, 'src-ui/package.json'), 'utf8'), '前端配置')
  const version = config.version
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Tauri 配置缺少有效版本号')
  const metadata = json(checked('cargo', ['metadata', '--offline', '--no-deps', '--format-version', '1']), 'Cargo metadata')
  const app = metadata.packages?.find(item => resolve(item.manifest_path) === join(rootDir, 'src-tauri/Cargo.toml'))
  if (!app || app.version !== version || packageJson.version !== version) throw new Error('Tauri、Cargo 和前端版本必须一致')
  if (typeof metadata.target_directory !== 'string') throw new Error('Cargo 未返回构建目录')

  const dirty = checked('git', ['status', '--porcelain', '--untracked-files=normal']).split('\n').filter(Boolean)
  if (dirty.length && !opts['allow-dirty']) throw new Error(`有 ${dirty.length} 处未提交改动：先提交，或加 --allow-dirty`)

  let notes = opts.notes
  if (notes === undefined) {
    const git = argv => { const result = call('git', argv); return result.status === 0 ? String(result.stdout).trim() : '' }
    const previous = git(['describe', '--tags', '--abbrev=0', '--match', 'v*', 'HEAD^'])
    const subjects = git(['log', '--no-merges', '--format=%s', '-n', '100', previous ? `${previous}..HEAD` : 'HEAD']).split('\n').filter(Boolean)
    notes = subjects.length ? subjects.map(subject => `- ${subject}`).join('\n') : '维护更新。'
  }

  let token = String(env.DL_RELEASE_TOKEN || '').trim()
  if (!token) {
    log('从 1Password 读取发布令牌（可能弹出一次解锁）…')
    token = checked('op', ['read', '--no-newline', OP_TOKEN_REF], { stdio: ['inherit', 'pipe', 'inherit'] }).trim()
    if (!token) throw new Error('1Password 返回的发布令牌为空')
  }
  if (/[\r\n]/.test(token)) throw new Error('发布令牌格式无效')

  const name = `${config.productName}_${version}_${dmgArch}.dmg`
  const dmgPath = join(metadata.target_directory, 'release/bundle/dmg', name)
  if (opts['skip-build']) {
    if (!dmgStamp(dmgPath)) throw new Error(`没找到现有安装包 ${name}，去掉 --skip-build 重新构建`)
    log(`使用现有安装包 ${name}`)
  } else {
    const before = dmgStamp(dmgPath)
    log(`构建 ${name}`)
    checked('npm', ['--prefix', 'src-ui', 'run', 'tauri', '--', 'build', '--bundles', 'dmg', '--', '--locked'], { stdio: 'inherit' })
    const after = dmgStamp(dmgPath)
    if (!after || after === before) throw new Error(`本次构建没有生成新的 ${name}；拒绝使用旧包`)
  }
  if (!FILE_RE.test(name)) throw new Error(`文件名 ${name} 不符合下载服务的规则`)
  const size = Number(lstatSync(dmgPath).size)
  if (size > MAX_FILE_BYTES) throw new Error(`${name} 超过下载服务的单文件上限 95 MiB`)
  const digest = await sha256(dmgPath)

  const auth = { authorization: `Bearer ${token}` }
  const post = (url, value) => {
    const body = Buffer.from(JSON.stringify(value))
    return request(url, { method: 'POST', headers: { ...auth, 'content-type': 'application/json', 'content-length': String(body.length) }, body })
  }
  const base = `${API}/v1/app/${APP}`

  const put = await request(`${base}/${version}/files/${encodeURIComponent(name)}`, {
    method: 'PUT', file: dmgPath, timeoutMs: 5 * 60 * 1000,
    headers: { ...auth, 'content-type': 'application/octet-stream', 'content-length': String(size), 'x-sha256': digest },
  })
  if (put.status === 201) log(`已上传 ${name}（${(size / 1024 / 1024).toFixed(1)} MB）`)
  else if (put.status === 200 && put.json?.existing) log(`${name}：服务端已有同内容，跳过`)
  else throw failure(`上传 ${name} `, put)

  const release = await post(`${base}/${version}/release`, { notes, platforms: { [target]: { installer: name } } })
  if (release.status === 201) log(`已写入版本清单 ${version}`)
  else if (release.status === 200 && release.json?.existing) log(`版本清单 ${version} 已存在且内容相同`)
  else throw failure('写版本清单', release)

  if (opts['no-promote']) {
    log('--no-promote：未晋升渠道')
  } else {
    const promoted = await post(`${base}/channels/${opts.channel}`, { version })
    if (promoted.status !== 200) throw failure(`晋升 ${opts.channel}`, promoted)
    log(promoted.json?.changed ? `${opts.channel}：${promoted.json.previous ?? '（空）'} → ${version}` : `${opts.channel} 已经是 ${version}`)
    log(`下载地址：${base}/${opts.channel}/download/${target}`)
  }
  log(`✅ 发布完成：${version}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publishDl({ rootDir: resolve(dirname(fileURLToPath(import.meta.url)), '..'), args: process.argv.slice(2) })
    .catch(error => {
      console.error(`发布失败：${error.message}`)
      process.exitCode = 1
    })
}
