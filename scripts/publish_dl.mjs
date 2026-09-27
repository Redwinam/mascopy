// 构建并发布到下载服务 dl.if9.cool：带签名私钥构建 DMG 与自动更新包 → 按应用内公钥验签 → 上传 →
// 写版本清单 → 晋升渠道（官网下载按钮与已安装客户端的自动更新都跟着渠道走）。
// 用法：node scripts/publish_dl.mjs [--channel stable|beta] [--notes 文本] [--skip-build] [--skip-upload] [--no-promote] [--allow-dirty]
// 密钥：环境变量优先（TAURI_SIGNING_PRIVATE_KEY / TAURI_SIGNING_PRIVATE_KEY_PASSWORD / DL_RELEASE_TOKEN），
// 缺的在一次 op 调用里从 1Password 读齐（只弹一次解锁）。只读这一步真正要用的：--skip-build 不读私钥，
// --skip-upload 不读发布令牌。值只放进子进程环境与请求头，不打印、不落盘。
// 每一步都可重跑：同名同内容的文件与相同的版本清单由服务端确认「已存在」，中途失败后加 --skip-build 接着发。
import { spawnSync } from 'node:child_process'
import { createHash, createPublicKey, verify } from 'node:crypto'
import { createReadStream, lstatSync, readFileSync } from 'node:fs'
import https from 'node:https'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

export const API = 'https://dl.if9.cool'
export const APP = 'mascopy'
const CHANNELS = ['stable', 'beta']
// 1Password「开发」保险库（op:// 引用不支持中文名，只能用 ID）：「开发启动器 · 发布令牌」各应用共用；
// 「大师拷贝 · 更新签名」是本应用自己的 minisign 私钥与口令，公钥在 tauri.conf.json 的 plugins.updater.pubkey。
export const OP_REFS = {
  DL_RELEASE_TOKEN: 'op://flkiwmwx6umyyyv76dnxahwpji/tftd6ckzvvkfb5bhroh6exma5a/credential',
  TAURI_SIGNING_PRIVATE_KEY: 'op://flkiwmwx6umyyyv76dnxahwpji/SIGNING_ITEM_ID/private key',
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'op://flkiwmwx6umyyyv76dnxahwpji/SIGNING_ITEM_ID/password',
}
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
      'skip-upload': { type: 'boolean', default: false },
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

function stamp(path) {
  try {
    const stat = lstatSync(path, { bigint: true })
    return stat.isFile() && stat.size > 0n ? [stat.dev, stat.ino, stat.size, stat.mtimeNs].join(':') : null
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function hashFile(path, algorithm) {
  return new Promise((done, fail) => {
    const hash = createHash(algorithm)
    createReadStream(path).on('error', fail).on('data', chunk => hash.update(chunk)).on('end', () => done(hash.digest()))
  })
}

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const minisignLines = text => Buffer.from(String(text).trim(), 'base64').toString('utf8').split('\n')

// 用 tauri.conf.json 里的公钥核对 .sig（Tauri 的 .sig 与 pubkey 都是 minisign 文本整体再 base64）：密钥 ID 相同、
// 文件签名（ED = 先 BLAKE2b-512 再签）与可信注释签名都通过才返回 null，否则返回原因。签名对不上时所有已安装的
// 客户端都会拒绝这次更新，所以上传前在本机先验一遍。
export async function verifyUpdaterSignature(filePath, signatureText, pubkeyText) {
  try {
    const pub = Buffer.from(minisignLines(pubkeyText)[1] || '', 'base64')
    const [, sigLine = '', trustedLine = '', globalLine = ''] = minisignLines(signatureText)
    const sig = Buffer.from(sigLine, 'base64')
    if (pub.length !== 42 || sig.length !== 74) return '签名或公钥格式不对'
    if (!pub.subarray(2, 10).equals(sig.subarray(2, 10))) return '签名所用私钥与应用内公钥不是一对（密钥 ID 不同）'
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, pub.subarray(10)]), format: 'der', type: 'spki' })
    const algorithm = sig.subarray(0, 2).toString('latin1')
    const message = algorithm === 'ED' ? await hashFile(filePath, 'blake2b512') : algorithm === 'Ed' ? readFileSync(filePath) : null
    if (!message) return `不认识的签名算法 ${algorithm}`
    if (!verify(null, message, key, sig.subarray(10))) return '签名与更新包内容对不上'
    const trusted = Buffer.from(trustedLine.replace(/^trusted comment: /, ''), 'utf8')
    if (!verify(null, Buffer.concat([sig.subarray(10), trusted]), key, Buffer.from(globalLine, 'base64'))) return '签名的可信注释校验失败'
    return null
  } catch (error) {
    return `签名校验出错：${error.message}`
  }
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

// 口令可以合法地为空（私钥没设口令）：显式设成空串也算提供了；私钥与令牌必须非空。
const provided = (env, name) => (name === 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD' ? env[name] !== undefined : Boolean(String(env[name] ?? '').trim()))

export async function publishDl({ rootDir, args = [], env = process.env, run = spawnSync, request = httpsRequest, log = console.log, arch = process.arch }) {
  const opts = options(args)
  if (opts['skip-build'] && opts['skip-upload']) throw new Error('--skip-build 与 --skip-upload 同时给出就什么都不做了')
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
  const pubkey = config.plugins?.updater?.pubkey
  if (typeof pubkey !== 'string' || !pubkey) throw new Error('tauri.conf.json 里没有 plugins.updater.pubkey')
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

  // 只要这一步真正用得到的；缺的值在同一个 /bin/sh 里接连 op read，值之间用 0x1E 分隔，只起一次 op 会话
  const needed = [
    ...(opts['skip-build'] ? [] : ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD']),
    ...(opts['skip-upload'] ? [] : ['DL_RELEASE_TOKEN']),
  ]
  const secrets = Object.fromEntries(needed.filter(name => provided(env, name)).map(name => [name, env[name]]))
  const missing = needed.filter(name => !provided(env, name))
  if (missing.length) {
    log(`从 1Password 读取 ${missing.join('、')}（可能弹出一次解锁）…`)
    const refs = missing.map(name => OP_REFS[name])
    const script = refs.map((_, i) => `op read --no-newline "$${i + 1}"`).join(" && printf '\\036' && ")
    const values = checked('/bin/sh', ['-c', script, 'op-read', ...refs], { stdio: ['inherit', 'pipe', 'inherit'] }).split('\x1e')
    if (values.length !== missing.length) throw new Error('从 1Password 读到的值个数不对，已停止')
    missing.forEach((name, i) => { secrets[name] = values[i] })
  }
  const token = String(secrets.DL_RELEASE_TOKEN || '').trim()
  if (/[\r\n]/.test(token)) throw new Error('发布令牌格式无效')

  const bundle = join(metadata.target_directory, 'release/bundle')
  const dmg = { name: `${config.productName}_${version}_${dmgArch}.dmg` }
  dmg.path = join(bundle, 'dmg', dmg.name)
  const tarball = { name: `${config.productName}.app.tar.gz` }
  tarball.path = join(bundle, 'macos', tarball.name)
  const sigPath = `${tarball.path}.sig`
  const artifacts = [dmg.path, tarball.path, sigPath]
  if (opts['skip-build']) {
    const absent = artifacts.filter(path => !stamp(path))
    if (absent.length) throw new Error(`没找到现有产物 ${absent.map(path => path.split('/').pop()).join('、')}，去掉 --skip-build 重新构建`)
    log(`使用现有产物 ${dmg.name}、${tarball.name}`)
  } else {
    const before = artifacts.map(stamp)
    log(`构建 ${dmg.name} 与自动更新包`)
    // tauri.conf.json 默认不产出更新包（没有私钥的本机构建照常成功），发布时在这里打开
    checked('npm', ['--prefix', 'src-ui', 'run', 'tauri', '--', 'build', '--bundles', 'app,dmg',
      '--config', JSON.stringify({ bundle: { createUpdaterArtifacts: true } }), '--', '--locked'], {
      stdio: 'inherit',
      env: { ...env, TAURI_SIGNING_PRIVATE_KEY: secrets.TAURI_SIGNING_PRIVATE_KEY, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '' },
    })
    const stale = artifacts.filter((path, i) => { const now = stamp(path); return !now || now === before[i] })
    if (stale.length) throw new Error(`本次构建没有生成新的 ${stale.map(path => path.split('/').pop()).join('、')}；拒绝使用旧包`)
  }
  const plist = readFileSync(join(bundle, 'macos', `${config.productName}.app`, 'Contents', 'Info.plist'), 'utf8')
  const bundled = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]*)<\/string>/)?.[1]
  if (bundled !== version) throw new Error(`bundle/macos 里 .app 的版本是 ${bundled ?? '（读不到）'}，不是要发布的 ${version}`)
  const signature = readFileSync(sigPath, 'utf8').trim()
  const bad = await verifyUpdaterSignature(tarball.path, signature, pubkey)
  if (bad) throw new Error(`${tarball.name}.sig：${bad}`)
  log(`${tarball.name}.sig 与应用内公钥核对通过`)
  for (const file of [dmg, tarball]) {
    if (!FILE_RE.test(file.name)) throw new Error(`文件名 ${file.name} 不符合下载服务的规则`)
    file.size = Number(lstatSync(file.path).size)
    if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} 超过下载服务的单文件上限 95 MiB`)
    file.sha256 = (await hashFile(file.path, 'sha256')).toString('hex')
  }
  if (opts['skip-upload']) {
    log('--skip-upload：产物已核对，未上传。之后加 --skip-build 发布这份产物')
    return
  }

  const auth = { authorization: `Bearer ${token}` }
  const post = (url, value) => {
    const body = Buffer.from(JSON.stringify(value))
    return request(url, { method: 'POST', headers: { ...auth, 'content-type': 'application/json', 'content-length': String(body.length) }, body })
  }
  const base = `${API}/v1/app/${APP}`

  for (const file of [dmg, tarball]) {
    const put = await request(`${base}/${version}/files/${encodeURIComponent(file.name)}`, {
      method: 'PUT', file: file.path, timeoutMs: 5 * 60 * 1000,
      headers: { ...auth, 'content-type': 'application/octet-stream', 'content-length': String(file.size), 'x-sha256': file.sha256 },
    })
    if (put.status === 201) log(`已上传 ${file.name}（${(file.size / 1024 / 1024).toFixed(1)} MB）`)
    else if (put.status === 200 && put.json?.existing) log(`${file.name}：服务端已有同内容，跳过`)
    else throw failure(`上传 ${file.name} `, put)
  }

  const release = await post(`${base}/${version}/release`, { notes, platforms: { [target]: { installer: dmg.name, updater: tarball.name, signature } } })
  if (release.status === 201) log(`已写入版本清单 ${version}`)
  else if (release.status === 200 && release.json?.existing) log(`版本清单 ${version} 已存在且内容相同`)
  else throw failure('写版本清单', release)

  if (opts['no-promote']) {
    log('--no-promote：未晋升渠道')
  } else {
    const promoted = await post(`${base}/channels/${opts.channel}`, { version })
    if (promoted.status !== 200) throw failure(`晋升 ${opts.channel}`, promoted)
    log(promoted.json?.changed ? `${opts.channel}：${promoted.json.previous ?? '（空）'} → ${version}` : `${opts.channel} 已经是 ${version}`)
    log(`下载地址：${base}/${opts.channel}/download/${target}；已安装的 4.1.0 及以上版本会在下次自动检查时收到更新`)
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
