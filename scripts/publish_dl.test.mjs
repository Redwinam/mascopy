import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { API, OP_REFS, publishDl, verifyUpdaterSignature } from './publish_dl.mjs'

// 外部命令与 HTTP 均为 stub；只读写临时目录，不访问网络、不读取真实凭据。签名用测试里现生成的 Ed25519 密钥，
// 按 Tauri 的格式（minisign 文本整体再 base64）拼出公钥与 .sig。
function minisignKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const keyId = Buffer.from('0123456789abcdef', 'hex')
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12)
  const pub = `untrusted comment: minisign public key: 0123456789ABCDEF\n${Buffer.concat([Buffer.from('Ed'), keyId, raw]).toString('base64')}\n`
  const signFile = content => {
    const digest = createHash('blake2b512').update(content).digest()
    const signature = sign(null, digest, privateKey)
    const trusted = 'timestamp:1790000000\tfile:大师拷贝.app.tar.gz'
    const global = sign(null, Buffer.concat([signature, Buffer.from(trusted)]), privateKey)
    const text = `untrusted comment: signature from tauri secret key\n${Buffer.concat([Buffer.from('ED'), keyId, signature]).toString('base64')}\ntrusted comment: ${trusted}\n${global.toString('base64')}\n`
    return Buffer.from(text).toString('base64')
  }
  return { pubkey: Buffer.from(pub).toString('base64'), signFile }
}

function fixture(t, options = {}) {
  const rootDir = mkdtempSync(join(tmpdir(), 'mascopy-dl-test-'))
  t.after(() => rmSync(rootDir, { recursive: true, force: true }))
  const target = join(rootDir, 'target')
  const bundle = join(target, 'release/bundle')
  const dmgName = '大师拷贝_4.1.0_aarch64.dmg'
  const key = minisignKey()
  const otherKey = minisignKey()
  for (const path of ['src-tauri', 'src-ui', 'target/release/bundle/dmg', 'target/release/bundle/macos/大师拷贝.app/Contents']) mkdirSync(join(rootDir, path), { recursive: true })
  writeFileSync(join(rootDir, 'src-tauri/tauri.conf.json'), JSON.stringify({ productName: '大师拷贝', version: '4.1.0', plugins: { updater: { pubkey: key.pubkey } } }))
  writeFileSync(join(rootDir, 'src-ui/package.json'), JSON.stringify({ version: options.uiVersion || '4.1.0' }))
  const writeArtifacts = (tag, appVersion = '4.1.0') => {
    writeFileSync(join(bundle, 'dmg', dmgName), `dmg ${tag}`)
    writeFileSync(join(bundle, 'macos', '大师拷贝.app.tar.gz'), `tarball ${tag}`)
    writeFileSync(join(bundle, 'macos', '大师拷贝.app.tar.gz.sig'), (options.wrongKey ? otherKey : key).signFile(options.tamper ? 'other bytes' : `tarball ${tag}`))
    writeFileSync(join(bundle, 'macos', '大师拷贝.app/Contents/Info.plist'), `<dict><key>CFBundleShortVersionString</key>\n<string>${appVersion}</string></dict>`)
  }
  if (options.previous) writeArtifacts('previous')
  const calls = [], requests = [], logs = [], buildEnvs = []
  const run = (command, args, execOptions) => {
    calls.push({ command, args })
    if (command === 'cargo') return { status: 0, stdout: JSON.stringify({ packages: [{ manifest_path: join(rootDir, 'src-tauri/Cargo.toml'), version: '4.1.0' }], target_directory: target }) }
    if (command === 'git' && args[0] === 'status') return { status: 0, stdout: options.dirty ? ' M src/lib.rs\n' : '' }
    if (command === 'git' && args[0] === 'describe') return { status: 0, stdout: 'v4.0.1\n' }
    if (command === 'git' && args[0] === 'log') return { status: 0, stdout: 'feat: 应用内自动更新\nfix: 灯箱键盘\n' }
    if (command === '/bin/sh') {
      const refs = args.slice(3)
      const byRef = Object.fromEntries(Object.entries(OP_REFS).map(([name, ref]) => [ref, `op-${name}`]))
      return { status: 0, stdout: refs.map(ref => byRef[ref]).join('\x1e') }
    }
    if (command === 'npm') {
      buildEnvs.push(execOptions.env)
      if (!options.stale) writeArtifacts('fresh', options.appVersion)
      return { status: options.buildFailure ? 1 : 0, stdout: '' }
    }
    throw new Error(`Unexpected command: ${command}`)
  }
  const request = async (url, init) => {
    requests.push({ url, ...init })
    if (init.method === 'PUT') return options.existing ? { status: 200, json: { existing: true } } : { status: options.putStatus ?? 201, json: {}, text: '' }
    if (url.endsWith('/release')) return { status: 201, json: {} }
    return { status: 200, json: { previous: '4.0.1', changed: true } }
  }
  const env = options.env ?? { DL_RELEASE_TOKEN: 'synthetic-test-token', TAURI_SIGNING_PRIVATE_KEY: 'synthetic-key', TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '' }
  const invoke = (args = []) => publishDl({ rootDir, args, env, run, request, log: line => logs.push(line), arch: 'arm64' })
  return { invoke, calls, requests, logs, buildEnvs, dmgName, key }
}

test('builds signed artifacts, verifies them, uploads both and publishes the updater entry', async t => {
  const f = fixture(t, { previous: true })
  await f.invoke()
  const build = f.calls.find(call => call.command === 'npm')
  assert.deepEqual(build.args, ['--prefix', 'src-ui', 'run', 'tauri', '--', 'build', '--bundles', 'app,dmg', '--config', '{"bundle":{"createUpdaterArtifacts":true}}', '--', '--locked'])
  assert.equal(f.buildEnvs[0].TAURI_SIGNING_PRIVATE_KEY, 'synthetic-key')
  assert.equal(f.buildEnvs[0].TAURI_SIGNING_PRIVATE_KEY_PASSWORD, '')
  const [putDmg, putTar, release, promote] = f.requests
  assert.equal(putDmg.url, `${API}/v1/app/mascopy/4.1.0/files/${encodeURIComponent(f.dmgName)}`)
  assert.equal(putDmg.headers['x-sha256'], createHash('sha256').update('dmg fresh').digest('hex'))
  assert.equal(putTar.url, `${API}/v1/app/mascopy/4.1.0/files/${encodeURIComponent('大师拷贝.app.tar.gz')}`)
  assert.equal(putTar.headers['content-length'], String(Buffer.byteLength('tarball fresh')))
  assert.equal(putDmg.headers.authorization, 'Bearer synthetic-test-token')
  const body = JSON.parse(release.body)
  assert.equal(body.notes, '- feat: 应用内自动更新\n- fix: 灯箱键盘')
  assert.equal(body.platforms['darwin-aarch64'].installer, f.dmgName)
  assert.equal(body.platforms['darwin-aarch64'].updater, '大师拷贝.app.tar.gz')
  assert.equal(await verifyUpdaterSignature(putTar.file, body.platforms['darwin-aarch64'].signature, f.key.pubkey), null)
  assert.equal(promote.url, `${API}/v1/app/mascopy/channels/stable`)
  assert.deepEqual(JSON.parse(promote.body), { version: '4.1.0' })
  assert.ok(f.logs.every(line => !line.includes('synthetic')))
  assert.ok(f.logs.at(-1).includes('发布完成'))
})

test('missing secrets come from one op session, and only the ones this run needs', async t => {
  const all = fixture(t, { env: {} })
  await all.invoke(['--notes', '说明'])
  const reads = all.calls.filter(call => call.command === '/bin/sh')
  assert.equal(reads.length, 1)
  assert.deepEqual(reads[0].args.slice(3), [OP_REFS.TAURI_SIGNING_PRIVATE_KEY, OP_REFS.TAURI_SIGNING_PRIVATE_KEY_PASSWORD, OP_REFS.DL_RELEASE_TOKEN])
  assert.equal(all.buildEnvs[0].TAURI_SIGNING_PRIVATE_KEY, 'op-TAURI_SIGNING_PRIVATE_KEY')
  assert.equal(all.requests[0].headers.authorization, 'Bearer op-DL_RELEASE_TOKEN')
  assert.equal(JSON.parse(all.requests[2].body).notes, '说明')

  const buildOnly = fixture(t, { env: {} })
  await buildOnly.invoke(['--skip-upload'])
  assert.deepEqual(buildOnly.calls.find(call => call.command === '/bin/sh').args.slice(3), [OP_REFS.TAURI_SIGNING_PRIVATE_KEY, OP_REFS.TAURI_SIGNING_PRIVATE_KEY_PASSWORD])
  assert.equal(buildOnly.requests.length, 0)

  const uploadOnly = fixture(t, { previous: true, env: {} })
  await uploadOnly.invoke(['--skip-build', '--no-promote'])
  assert.deepEqual(uploadOnly.calls.find(call => call.command === '/bin/sh').args.slice(3), [OP_REFS.DL_RELEASE_TOKEN])
  assert.ok(!uploadOnly.calls.some(call => call.command === 'npm'))
  assert.equal(uploadOnly.requests.length, 3)

  const envOnly = fixture(t)
  await envOnly.invoke()
  assert.ok(!envOnly.calls.some(call => call.command === '/bin/sh'))
})

test('refuses bad signatures before anything is uploaded', async t => {
  for (const options of [{ wrongKey: true }, { tamper: true }]) {
    const f = fixture(t, options)
    await assert.rejects(f.invoke(), options.wrongKey ? /密钥 ID 不同|对不上/ : /内容对不上/)
    assert.equal(f.requests.length, 0)
  }
})

test('refuses stale artifacts, wrong app version, dirty trees, version drift and failed uploads', async t => {
  await assert.rejects(fixture(t, { previous: true, stale: true }).invoke(), /拒绝使用旧包/)
  await assert.rejects(fixture(t, { appVersion: '4.0.1' }).invoke(), /\.app 的版本是 4\.0\.1/)
  await assert.rejects(fixture(t, { dirty: true }).invoke(), /未提交改动/)
  await assert.rejects(fixture(t, { uiVersion: '4.0.1' }).invoke(), /版本必须一致/)
  await assert.rejects(fixture(t, { buildFailure: true }).invoke(), /npm 执行失败/)
  const denied = fixture(t, { putStatus: 401 })
  await assert.rejects(denied.invoke(), /HTTP 401.*发布令牌无效/)
  assert.equal(denied.requests.length, 1)
  await assert.rejects(fixture(t).invoke(['--channel', 'nightly']), /未知渠道/)
  await assert.rejects(fixture(t).invoke(['--skip-build']), /没找到现有产物/)
  await assert.rejects(fixture(t).invoke(['--skip-build', '--skip-upload']), /什么都不做/)
})

test('rerun with --skip-build accepts content the server already has', async t => {
  const f = fixture(t, { previous: true, existing: true })
  await f.invoke(['--skip-build'])
  assert.ok(!f.calls.some(call => call.command === 'npm'))
  assert.equal(f.logs.filter(line => line.includes('服务端已有同内容')).length, 2)
})
