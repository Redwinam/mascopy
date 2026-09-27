import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { API, publishDl } from './publish_dl.mjs'

// 外部命令与 HTTP 均为 stub；只读写临时目录，不访问网络、不读取真实凭据。
function fixture(t, options = {}) {
  const rootDir = mkdtempSync(join(tmpdir(), 'mascopy-dl-test-'))
  t.after(() => rmSync(rootDir, { recursive: true, force: true }))
  const target = join(rootDir, 'target')
  const bundle = join(target, 'release/bundle/dmg')
  const filename = '大师拷贝_4.0.1_aarch64.dmg'
  for (const path of ['src-tauri', 'src-ui', 'target/release/bundle/dmg']) mkdirSync(join(rootDir, path), { recursive: true })
  writeFileSync(join(rootDir, 'src-tauri/tauri.conf.json'), JSON.stringify({ productName: '大师拷贝', version: '4.0.1' }))
  writeFileSync(join(rootDir, 'src-ui/package.json'), JSON.stringify({ version: options.uiVersion || '4.0.1' }))
  if (options.previous) writeFileSync(join(bundle, filename), 'previous artifact')
  const calls = []
  const requests = []
  const logs = []
  const run = (command, args) => {
    calls.push({ command, args })
    if (command === 'cargo') return { status: 0, stdout: JSON.stringify({ packages: [{ manifest_path: join(rootDir, 'src-tauri/Cargo.toml'), version: '4.0.1' }], target_directory: target }) }
    if (command === 'git' && args[0] === 'status') return { status: 0, stdout: options.dirty ? ' M src/lib.rs\n' : '' }
    if (command === 'git' && args[0] === 'describe') return { status: 0, stdout: 'v4.0.0\n' }
    if (command === 'git' && args[0] === 'log') return { status: 0, stdout: 'feat: 联机拍摄\nfix: 灯箱键盘\n' }
    if (command === 'op') return { status: 0, stdout: 'op-synthetic-token' }
    if (command === 'npm') {
      if (!options.stale) writeFileSync(join(bundle, filename), 'fresh dmg bytes')
      return { status: options.buildFailure ? 1 : 0, stdout: '' }
    }
    throw new Error(`Unexpected command: ${command}`)
  }
  const request = async (url, init) => {
    requests.push({ url, ...init })
    if (init.method === 'PUT') return options.existing ? { status: 200, json: { existing: true } } : { status: options.putStatus ?? 201, json: {}, text: '' }
    if (url.endsWith('/release')) return { status: 201, json: {} }
    return { status: 200, json: { previous: '3.0.4', changed: true } }
  }
  const env = options.noEnvToken ? {} : { DL_RELEASE_TOKEN: 'synthetic-test-token' }
  const invoke = (args = []) => publishDl({ rootDir, args, env, run, request, log: line => logs.push(line), arch: 'arm64' })
  return { invoke, calls, requests, logs, filename }
}

test('builds, uploads with checksum, writes the release and promotes stable', async t => {
  const f = fixture(t, { previous: true })
  await f.invoke()
  assert.deepEqual(f.calls.find(call => call.command === 'npm').args, ['--prefix', 'src-ui', 'run', 'tauri', '--', 'build', '--bundles', 'dmg', '--', '--locked'])
  const [put, release, promote] = f.requests
  assert.equal(put.url, `${API}/v1/app/mascopy/4.0.1/files/${encodeURIComponent(f.filename)}`)
  assert.equal(put.headers['x-sha256'], createHash('sha256').update('fresh dmg bytes').digest('hex'))
  assert.equal(put.headers['content-length'], String(Buffer.byteLength('fresh dmg bytes')))
  assert.equal(put.headers.authorization, 'Bearer synthetic-test-token')
  assert.deepEqual(JSON.parse(release.body), { notes: '- feat: 联机拍摄\n- fix: 灯箱键盘', platforms: { 'darwin-aarch64': { installer: f.filename } } })
  assert.equal(promote.url, `${API}/v1/app/mascopy/channels/stable`)
  assert.deepEqual(JSON.parse(promote.body), { version: '4.0.1' })
  assert.ok(f.logs.every(line => !line.includes('synthetic-test-token')))
  assert.ok(f.logs.at(-1).includes('发布完成'))
})

test('environment token wins; otherwise 1Password is read exactly once', async t => {
  const f = fixture(t)
  await f.invoke(['--notes', '首个 dl 版本', '--no-promote'])
  assert.equal(f.calls.filter(call => call.command === 'op').length, 0)
  assert.equal(JSON.parse(f.requests[1].body).notes, '首个 dl 版本')
  assert.equal(f.requests.length, 2)
  assert.equal(f.requests[0].headers.authorization, 'Bearer synthetic-test-token')
  const g = fixture(t, { noEnvToken: true })
  await g.invoke(['--no-promote'])
  assert.equal(g.calls.filter(call => call.command === 'op').length, 1)
  assert.equal(g.requests[0].headers.authorization, 'Bearer op-synthetic-token')
})

test('refuses stale artifacts, dirty trees, version drift and failed uploads', async t => {
  await assert.rejects(fixture(t, { previous: true, stale: true }).invoke(), /拒绝使用旧包/)
  await assert.rejects(fixture(t, { dirty: true }).invoke(), /未提交改动/)
  await assert.rejects(fixture(t, { uiVersion: '4.0.0' }).invoke(), /版本必须一致/)
  await assert.rejects(fixture(t, { buildFailure: true }).invoke(), /npm 执行失败/)
  const denied = fixture(t, { putStatus: 401 })
  await assert.rejects(denied.invoke(), /HTTP 401.*发布令牌无效/)
  assert.equal(denied.requests.length, 1)
  await assert.rejects(fixture(t).invoke(['--channel', 'nightly']), /未知渠道/)
  await assert.rejects(fixture(t).invoke(['--skip-build']), /没找到现有安装包/)
})

test('rerun with --skip-build accepts content the server already has', async t => {
  const f = fixture(t, { previous: true, existing: true })
  await f.invoke(['--skip-build'])
  assert.ok(!f.calls.some(call => call.command === 'npm'))
  assert.ok(f.logs.some(line => line.includes('服务端已有同内容')))
})
