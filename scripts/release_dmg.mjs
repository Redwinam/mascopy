import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, lstatSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function json(text, label) {
  try { return JSON.parse(text) } catch { throw new Error(`${label} 返回的 JSON 无效`) }
}

function repoFromRemote(remote) {
  const match = remote.trim().match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (!match || !/^[\w.-]+$/.test(match[1]) || !/^[\w.-]+$/.test(match[2])) {
    throw new Error('origin 必须指向 GitHub 仓库')
  }
  return `${match[1]}/${match[2]}`
}

// 只记录目标版本的正式 DMG；文件被本次构建重写后才可上传。
function artifacts(directory, product, version) {
  const files = new Map()
  let names
  try { names = readdirSync(directory) } catch (error) {
    if (error.code === 'ENOENT') return files
    throw error
  }
  for (const name of names) {
    const prefix = `${product}_${version}_`
    if (!name.startsWith(prefix) || !/^(aarch64|x64|universal)\.dmg$/.test(name.slice(prefix.length))) continue
    const path = join(directory, name)
    const stat = lstatSync(path, { bigint: true })
    if (!stat.isFile() || stat.size === 0n) continue
    files.set(path, [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':'))
  }
  return files
}

export function releaseDmg({ rootDir, args = [], env = process.env, run = spawnSync, log = console.log }) {
  if (args.length > 1) throw new Error('用法：scripts/release_dmg.sh [TAG]')
  const config = json(readFileSync(join(rootDir, 'src-tauri/tauri.conf.json'), 'utf8'), 'Tauri 配置')
  const packageJson = json(readFileSync(join(rootDir, 'src-ui/package.json'), 'utf8'), '前端配置')
  if (typeof config.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.+-]+)?$/.test(config.version)) {
    throw new Error('Tauri 配置缺少有效版本号')
  }
  const tag = args[0] || `v${config.version}`
  if (tag.startsWith('-')) throw new Error('TAG 不能以短横线开头')
  const title = `mascopy ${tag}`
  const notes = 'Auto-generated DMG release'
  const call = (command, argv, options = {}) => run(command, argv, {
    cwd: rootDir, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options,
  })
  const checked = (command, argv, options = {}) => {
    const result = call(command, argv, options)
    if (result.error || result.status !== 0) throw new Error(`${command} 执行失败（退出码 ${result.status ?? '不可用'}）`)
    return result.stdout || ''
  }
  checked('git', ['check-ref-format', `refs/tags/${tag}`])
  const repo = repoFromRemote(checked('git', ['remote', 'get-url', 'origin']))
  const metadata = json(checked('cargo', ['metadata', '--offline', '--no-deps', '--format-version', '1']), 'Cargo metadata')
  const app = metadata.packages?.find(item => resolve(item.manifest_path) === join(rootDir, 'src-tauri/Cargo.toml'))
  if (!app || app.version !== config.version || packageJson.version !== config.version) {
    throw new Error('Tauri、Cargo 和前端版本必须一致')
  }
  if (typeof metadata.target_directory !== 'string') throw new Error('Cargo 未返回构建目录')
  const hasGh = call('gh', ['--version']).status === 0
  if (!hasGh && !env.GITHUB_TOKEN) throw new Error('缺少现有 gh 登录或 GITHUB_TOKEN，请先配置部署凭据')
  if (!hasGh && /[\r\n]/.test(env.GITHUB_TOKEN)) throw new Error('GITHUB_TOKEN 格式无效')

  const directory = join(metadata.target_directory, 'release/bundle/dmg')
  const before = artifacts(directory, config.productName, config.version)
  log(`构建 DMG：${tag}`)
  checked('npm', ['--prefix', 'src-ui', 'run', 'tauri', '--', 'build', '--bundles', 'dmg', '--', '--locked'], { stdio: 'inherit' })
  const fresh = [...artifacts(directory, config.productName, config.version)]
    .filter(([path, signature]) => before.get(path) !== signature)
  if (fresh.length !== 1) throw new Error(`本次构建必须生成一个 ${config.version} 正式 DMG，实际找到 ${fresh.length} 个；拒绝使用旧包`)
  const dmgPath = fresh[0][0]
  const name = basename(dmgPath)
  const assertNoDuplicate = release => {
    if (!Array.isArray(release.assets)) throw new Error('Release 缺少资产列表，无法检查重复发布')
    if (release.assets.some(asset => asset.name === name)) throw new Error(`Release 已有同名资产 ${name}；拒绝覆盖，请提升版本或手动处理已有资产`)
  }
  if (hasGh) {
    const view = call('gh', ['release', 'view', tag, '--repo', repo, '--json', 'assets'])
    if (!view.error && view.status === 0) {
      assertNoDuplicate(json(view.stdout, 'gh release view'))
      checked('gh', ['release', 'upload', tag, dmgPath, '--repo', repo], { stdio: 'inherit' })
    } else {
      checked('gh', ['release', 'create', tag, dmgPath, '--repo', repo, '--title', title, '--notes', notes], { stdio: 'inherit' })
    }
  } else {
    const scratch = mkdtempSync(join(tmpdir(), 'mascopy-release-'))
    try {
      const request = (url, { method = 'GET', body, file } = {}) => {
        const responseFile = join(scratch, 'response.json')
        const argv = ['--silent', '--show-error', '--config', '-', '--request', method,
          '--output', responseFile, '--write-out', '%{http_code}',
          '--header', 'Accept: application/vnd.github+json', '--header', 'X-GitHub-Api-Version: 2022-11-28']
        if (body !== undefined) {
          const bodyFile = join(scratch, 'request.json')
          writeFileSync(bodyFile, JSON.stringify(body))
          argv.push('--header', 'Content-Type: application/json', '--data-binary', `@${bodyFile}`)
        }
        if (file) argv.push('--header', 'Content-Type: application/octet-stream', '--data-binary', `@${file}`)
        argv.push(url)
        // 凭据从 stdin 传给 curl，不放在命令行、文件或日志里。
        const result = call('curl', argv, { input: `header = ${JSON.stringify(`Authorization: Bearer ${env.GITHUB_TOKEN}`)}\n` })
        if (result.error || result.status !== 0) throw new Error('GitHub 请求传输失败')
        const status = Number(result.stdout?.trim())
        if (!Number.isInteger(status) || status < 100 || status > 599) throw new Error('GitHub 未返回有效 HTTP 状态')
        return { status, read: () => json(readFileSync(responseFile, 'utf8'), 'GitHub') }
      }
      const expect = (response, status) => {
        if (response.status !== status) throw new Error(`GitHub 请求失败：HTTP ${response.status}`)
        return response.read()
      }
      const api = `https://api.github.com/repos/${repo}/releases`
      const existing = request(`${api}/tags/${encodeURIComponent(tag)}`)
      const release = existing.status === 404
        ? expect(request(api, { method: 'POST', body: { tag_name: tag, name: title, body: notes, draft: false } }), 201)
        : expect(existing, 200)
      assertNoDuplicate(release)
      let uploadUrl
      try { uploadUrl = new URL(release.upload_url.replace(/\{.*$/, '')) } catch { throw new Error('GitHub 返回的上传地址无效') }
      if (uploadUrl.protocol !== 'https:' || uploadUrl.hostname !== 'uploads.github.com' || uploadUrl.port ||
          uploadUrl.username || uploadUrl.password || uploadUrl.pathname !== `/repos/${repo}/releases/${release.id}/assets`) {
        throw new Error('GitHub 返回了非预期的上传地址')
      }
      uploadUrl.search = new URLSearchParams({ name }).toString()
      const uploaded = expect(request(uploadUrl.href, { method: 'POST', file: dmgPath }), 201)
      if (uploaded.name !== name || uploaded.state !== 'uploaded') throw new Error('GitHub 未确认资产上传完成')
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  }
  log(`✅ 发布完成：${tag} -> ${name}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    releaseDmg({ rootDir: resolve(dirname(fileURLToPath(import.meta.url)), '..'), args: process.argv.slice(2) })
  } catch (error) {
    console.error(`发布失败：${error.message}`)
    process.exitCode = 1
  }
}
