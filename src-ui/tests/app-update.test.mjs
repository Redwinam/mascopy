import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as vue from 'vue';
import * as appUpdate from '../src/utils/appUpdate.js';

// Boundary: real useAppUpdater.js source with real Vue reactivity; the updater plugin, Tauri IPC,
// timers and localStorage are replaced. No network request, download or relaunch happens here.
function updaterFixture({ supported = true, found = null, checkError = null, storage = {} } = {}) {
  const source = readFileSync(new URL('../src/composables/useAppUpdater.js', import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, '');
  const calls = [], timers = [];
  const state = { uploading: vue.ref(false), tetherActive: vue.ref(false) };
  const localStorage = { getItem: key => storage[key] ?? null, setItem: (key, value) => { storage[key] = value; } };
  const deps = {
    ...vue, ...appUpdate, localStorage,
    useAppState: () => state,
    getVersion: async () => '4.1.0',
    invoke: async (command) => {
      calls.push(command);
      if (command === 'app_update_supported') return supported;
      return null;
    },
    check: async (options) => {
      calls.push(['check', options]);
      if (checkError) throw checkError;
      return found;
    },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {}, setInterval: (fn, ms) => { timers.push({ fn, ms, repeat: true }); return timers.length; }, clearInterval: () => {},
  };
  const params = Object.entries(deps).filter(([key]) => /^[A-Za-z_$][\w$]*$/.test(key));
  const { useAppUpdater } = new Function(...params.map(([key]) => key), `${source}\nreturn { useAppUpdater };`)(...params.map(([, value]) => value));
  return { updater: useAppUpdater(), calls, timers, state, storage };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
function fakeUpdate(events = []) {
  return {
    version: '4.1.1', date: '2026-10-02 08:00:00.0 +00:00:00', body: '- 修复一处问题',
    closed: false, close: async function () { this.closed = true; },
    downloadAndInstall: async (onEvent) => { for (const event of events) onEvent(event); },
  };
}

test('pure helpers: schedule, errors, progress and release date', () => {
  assert.equal(appUpdate.isAutoCheckDue(0), true);
  assert.equal(appUpdate.isAutoCheckDue(1000, 1000 + appUpdate.UPDATE_CHECK_INTERVAL_MS - 1), false);
  assert.equal(appUpdate.isAutoCheckDue(1000, 1000 + appUpdate.UPDATE_CHECK_INTERVAL_MS), true);
  assert.match(appUpdate.describeUpdateError(new Error('Could not fetch a valid release JSON from the remote')), /还没有可用的版本信息/);
  assert.match(appUpdate.describeUpdateError('Read-only file system (os error 30)'), /拖进「应用程序」/);
  assert.match(appUpdate.describeUpdateError('signature verification failed'), /签名校验失败/);
  assert.match(appUpdate.describeUpdateError('error sending request for url'), /连不上下载服务/);
  assert.equal(appUpdate.describeUpdateError(''), '操作失败');
  assert.equal(appUpdate.progressPercent({ downloaded: 50, total: 200 }), 25);
  assert.equal(appUpdate.progressPercent({ downloaded: 50, total: 0 }), null);
  assert.equal(appUpdate.formatBytes(9_606_954), '9.2 MB');
  assert.equal(appUpdate.formatReleaseDate('2026-10-02 08:00:00.0 +00:00:00'), '2026-10-02');
  assert.equal(appUpdate.formatReleaseDate('soon'), '');
});

test('development builds never check and schedule nothing', async () => {
  const f = updaterFixture({ supported: false, found: fakeUpdate() });
  await settle();
  await f.updater.check();
  assert.equal(f.updater.supported.value, false);
  assert.equal(f.updater.phase.value, 'idle');
  assert.ok(!f.calls.some(call => Array.isArray(call)));
  assert.equal(f.timers.length, 0);
});

test('auto check runs 20 seconds after start, then polls; the toggle persists and stops it', async () => {
  const f = updaterFixture();
  await settle();
  assert.equal(f.updater.currentVersion.value, '4.1.0');
  assert.equal(f.timers[0].ms, appUpdate.UPDATE_FIRST_CHECK_DELAY_MS);
  f.timers[0].fn(); await settle();
  assert.equal(f.updater.phase.value, 'latest');
  assert.equal(f.timers[1].ms, appUpdate.UPDATE_CHECK_TICK_MS);
  f.timers[1].fn(); await settle();
  assert.equal(f.calls.filter(call => Array.isArray(call)).length, 1, 'a tick within 6 hours does not check again');
  const before = f.timers.length;
  f.updater.setAutoCheck(false);
  assert.equal(f.storage[appUpdate.UPDATE_AUTO_CHECK_KEY], 'off');
  assert.equal(f.timers.length, before, 'no timer is scheduled while auto check is off');
  assert.equal(updaterFixture({ storage: { [appUpdate.UPDATE_AUTO_CHECK_KEY]: 'off' } }).updater.autoCheck.value, false);
});

test('manual check failure is explained; silent failure stays quiet', async () => {
  const f = updaterFixture({ checkError: new Error('error sending request for url') });
  await settle();
  await f.updater.check();
  assert.equal(f.updater.phase.value, 'idle');
  assert.match(f.updater.error.value, /连不上下载服务/);
  const quiet = updaterFixture({ checkError: new Error('error sending request for url') });
  await settle();
  quiet.timers[0].fn(); await settle();
  assert.equal(quiet.updater.error.value, '');
  assert.equal(quiet.updater.phase.value, 'idle');
});

test('found update downloads with progress, then restart waits for copy and tether to finish', async () => {
  const handle = fakeUpdate([
    { event: 'Started', data: { contentLength: 200 } },
    { event: 'Progress', data: { chunkLength: 120 } },
    { event: 'Progress', data: { chunkLength: 80 } },
    { event: 'Finished' },
  ]);
  const f = updaterFixture({ found: handle });
  await settle();
  await f.updater.check();
  assert.equal(f.updater.phase.value, 'available');
  assert.deepEqual(f.updater.update.value, { version: '4.1.1', date: handle.date, notes: '- 修复一处问题' });
  await f.updater.check();
  assert.equal(f.updater.phase.value, 'available');
  await f.updater.install();
  assert.equal(f.updater.phase.value, 'ready');
  assert.deepEqual(f.updater.progress.value, { downloaded: 200, total: 200 });
  await f.updater.check();
  assert.equal(f.calls.filter(call => Array.isArray(call)).length, 2, 'no re-check once an update is installed');

  f.state.uploading.value = true;
  assert.equal(f.updater.restartBlocked.value, true);
  await f.updater.restart();
  assert.ok(!f.calls.includes('relaunch_after_update'));
  f.state.uploading.value = false; f.state.tetherActive.value = true;
  await f.updater.restart();
  assert.ok(!f.calls.includes('relaunch_after_update'));
  f.state.tetherActive.value = false;
  await f.updater.restart();
  assert.ok(f.calls.includes('relaunch_after_update'));
  assert.equal(f.updater.phase.value, 'restarting');
});

test('failed download returns to available with the reason', async () => {
  const handle = fakeUpdate();
  handle.downloadAndInstall = async () => { throw new Error('Read-only file system (os error 30)'); };
  const f = updaterFixture({ found: handle });
  await settle();
  await f.updater.check();
  await f.updater.install();
  assert.equal(f.updater.phase.value, 'available');
  assert.match(f.updater.error.value, /拖进「应用程序」/);
});
