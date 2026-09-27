import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { releaseDmg } from './release_dmg.mjs'

// 所有外部命令均为 stub；只读写临时目录，不访问网络、不读取真实凭据。
function fixture(t, options = {}) {
  const rootDir = mkdtempSync(join(tmpdir(), 'mascopy-release-test-'))
  t.after(() => rmSync(rootDir, { recursive: true, force: true }))
  const target = join(rootDir, 'target')
  const bundle = join(target, 'release/bundle/dmg')
  const filename = '大师拷贝_4.0.0_aarch64.dmg'
  for (const path of ['src-tauri', 'src-ui', 'target/release/bundle/dmg']) mkdirSync(join(rootDir, path), { recursive: true })
  writeFileSync(join(rootDir, 'src-tauri/tauri.conf.json'), JSON.stringify({ productName: '大师拷贝', version: '4.0.0' }))
  writeFileSync(join(rootDir, 'src-ui/package.json'), JSON.stringify({ version: options.uiVersion || '4.0.0' }))
  writeFileSync(join(bundle, filename), 'previous artifact')
  writeFileSync(join(bundle, '大师拷贝_3.9.9_aarch64.dmg'), 'old version')
  const calls = []
  const logs = []
  const result = (stdout = '', status = 0) => ({ stdout, status })
  const release = { id: 71, assets: [], upload_url: 'https://uploads.github.com/repos/example/mascopy/releases/71/assets{?name,label}' }
  if (options.duplicate) release.assets.push({ name: filename })
  if (options.uploadHost) release.upload_url = options.uploadHost
  const run = (command, args, execOptions) => {
    calls.push({ command, args, input: execOptions.input })
    if (command === 'git') return result(args[0] === 'remote' ? 'git@github.com:example/mascopy.git\n' : '')
    if (command === 'cargo') return result(JSON.stringify({
      packages: [{ manifest_path: join(rootDir, 'src-tauri/Cargo.toml'), version: '4.0.0' }], target_directory: target,
    }))
    if (command === 'npm') {
      assert.deepEqual(args, ['--prefix', 'src-ui', 'run', 'tauri', '--', 'build', '--bundles', 'dmg', '--', '--locked'])
      if (options.buildFailure) return result('', 1)
      if (!options.stale) writeFileSync(join(bundle, filename), 'new artifact with different bytes')
      if (options.otherVersion) writeFileSync(join(bundle, '大师拷贝_5.0.0_aarch64.dmg'), 'unrelated')
      if (options.ambiguous) writeFileSync(join(bundle, '大师拷贝_4.0.0_x64.dmg'), 'second architecture')
      return result()
    }
    if (command === 'gh') {
      if (args[0] === '--version') return result('', options.gh ? 0 : 1)
      if (args[1] === 'view') return result(JSON.stringify(release), options.existing ? 0 : 1)
      return result('', options.ghFailure ? 1 : 0)
    }
    if (command === 'curl') {
      const url = new URL(args.at(-1))
      assert.ok(execOptions.input.includes('synthetic-test-token'))
      assert.ok(!args.join(' ').includes('synthetic-test-token'))
      const output = args[args.indexOf('--output') + 1]
      let status
      let response = release
      if (url.pathname.includes('/tags/')) {
        status = options.lookupStatus ?? (options.existing ? 200 : 404)
        assert.equal(decodeURIComponent(url.pathname.split('/tags/')[1]), options.tag || 'v4.0.0')
      } else if (url.hostname === 'api.github.com') {
        status = options.createStatus ?? 201
        const dataArg = args[args.indexOf('--data-binary') + 1]
        const body = JSON.parse(readFileSync(dataArg.slice(1), 'utf8'))
        assert.equal(body.tag_name, options.tag || 'v4.0.0')
        assert.equal(body.name, `mascopy ${options.tag || 'v4.0.0'}`)
      } else {
        status = options.uploadStatus ?? 201
        assert.equal(url.searchParams.get('name'), filename)
        assert.ok(!url.href.includes('大师拷贝'))
        response = { name: filename, state: options.incomplete ? 'new' : 'uploaded' }
      }
      writeFileSync(output, JSON.stringify(response))
      return result(String(status))
    }
    throw new Error(`Unexpected command: ${command}`)
  }
  const invoke = () => releaseDmg({ rootDir, args: options.tag ? [options.tag] : [],
    env: { GITHUB_TOKEN: 'synthetic-test-token' }, run, log: message => logs.push(message) })
  const fails = pattern => {
    assert.throws(invoke, pattern)
    assert.ok(logs.every(line => !line.includes('发布完成')))
  }
  return { invoke, fails, calls, logs }
}

test('REST 发布对 Unicode 文件名及带引号、路径的 tag 正确编码', t => {
  const f = fixture(t, { tag: '候选/"v4.0.0"' })
  f.invoke()
  assert.ok(f.logs.some(line => line.includes('发布完成')))
  assert.equal(f.calls.filter(call => call.command === 'curl').length, 3)
})

for (const [name, options] of [
  ['读取 Release HTTP 401', { lookupStatus: 401 }],
  ['创建 Release HTTP 422', { createStatus: 422 }],
  ['上传 HTTP 401', { uploadStatus: 401 }],
  ['上传 HTTP 422', { uploadStatus: 422 }],
]) {
  test(`${name} 返回失败且不报告成功`, t => fixture(t, options).fails(/HTTP (401|422)/))
}

test('现有 Release 可追加新资产', t => {
  const f = fixture(t, { existing: true })
  f.invoke()
  assert.equal(f.calls.filter(call => call.command === 'curl').length, 2)
})

test('重复发布拒绝覆盖既有资产', t => {
  const f = fixture(t, { existing: true, duplicate: true })
  f.fails(/已有同名资产/)
  assert.equal(f.calls.filter(call => call.command === 'curl').length, 1)
})

test('未产生当前版本新 DMG 时拒绝旧包和其他版本', t => {
  const f = fixture(t, { stale: true, otherVersion: true })
  f.fails(/拒绝使用旧包/)
  assert.equal(f.calls.filter(call => call.command === 'curl').length, 0)
})

test('本次构建多份 DMG 时拒绝猜测产物', t => fixture(t, { ambiguous: true }).fails(/实际找到 2 个/))
test('版本不同步时不开始构建', t => {
  const f = fixture(t, { uiVersion: '3.0.4' })
  f.fails(/版本必须一致/)
  assert.ok(f.calls.every(call => call.command !== 'npm'))
})
test('构建失败不发布', t => fixture(t, { buildFailure: true }).fails(/npm 执行失败/))
test('非 GitHub 上传主机被拒绝', t => fixture(t, { uploadHost: 'https://example.com/assets' }).fails(/非预期的上传地址/))
test('API 未确认 uploaded 状态时失败', t => fixture(t, { incomplete: true }).fails(/未确认资产上传完成/))
test('gh 与 REST 使用一致的重复发布策略', t => fixture(t, { gh: true, existing: true, duplicate: true }).fails(/已有同名资产/))
test('gh 新建 Release 时绑定解析出的仓库', t => {
  const f = fixture(t, { gh: true })
  f.invoke()
  const create = f.calls.find(call => call.command === 'gh' && call.args[1] === 'create')
  assert.equal(create.args[create.args.indexOf('--repo') + 1], 'example/mascopy')
})
test('gh 上传失败不报告成功', t => fixture(t, { gh: true, existing: true, ghFailure: true }).fails(/gh 执行失败/))

test('拒绝会被 gh 识别成选项的 tag', t => fixture(t, { tag: '--delete' }).fails(/TAG 不能以短横线开头/))
