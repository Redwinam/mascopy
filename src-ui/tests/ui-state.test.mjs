import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as vue from 'vue';
import * as media from '../src/utils/media.js';

// Boundary: execute current SFC/composable script bodies with real Vue reactivity.
// Tauri IPC, DOM mounting, lifecycle and modal adapter are replaced; no disk copy,
// device eject, Eagle service or camera connection is performed by these tests.
function load(relative, injected, names) {
  let source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  if (relative.endsWith('.vue')) source = source.match(/<script setup>([\s\S]*?)<\/script>/)[1];
  source = source.replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  const mounted = [], unmounted = [];
  const dependencies = { ...vue, ...media, getFileExtensionInfo: media.extensionInfo, extOf: media.extensionOf,
    onMounted: fn => mounted.push(fn), onBeforeUnmount: fn => unmounted.push(fn), useId: () => 'test-title',
    useModalDialog: () => {}, defineEmits: () => () => {}, defineProps: () => ({}),
    setTimeout: () => null, clearTimeout: () => {}, window: { addEventListener() {}, removeEventListener() {} },
    ...injected };
  // Node 26 起 CommonJS 模块的命名空间会多出 'module.exports' 这类不是合法标识符的键，不能当参数名
  const params = Object.entries(dependencies).filter(([key]) => /^[A-Za-z_$][\w$]*$/.test(key));
  return { ...new Function(...params.map(([key]) => key), `${source}\nreturn {${names.join(',')}};`)(...params.map(([, value]) => value)), mounted, unmounted };
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function appState() {
  return load('../src/composables/useAppState.js', {}, ['useAppState']).useAppState();
}
function homeFixture(invoke) {
  const state = appState();
  state.config.value.sd = { source_dir: '/sd', target_dir: '/backup', overwrite_duplicates: true };
  state.config.value.dji = { source_dir: '/dji', target_dir: '/other', overwrite_duplicates: false };
  return { state, home: load('../src/views/Home.vue', { useAppState: () => state, invoke, listen: async () => () => {} }, [
    'startScan', 'startUpload', 'cancel', 'togglePause', 'isUploading', 'isPaused', 'isCancelling',
    'scanSnapshot', 'showSuccessModal', 'noticeModal', 'scanResult', 'filesToDisplay', 'fileProgress', 'ejectVolume', 'saveConfig',
    'handleUploadProgress', 'uploadFailures', 'logs',
    'selectedKeys', 'selectedCount', 'selectedUploadFiles', 'hiddenSelectedCount', 'selectedExtensions', 'fileFilter', 'clearSelection',
  ]) };
}
const file = (name, status = 'upload') => ({ path: `/sd/${name}`, target_path: `/backup/${name}`, filename: name,
  date: { secs_since_epoch: 1_000_000_000 }, size: 10, file_type: 'photo', status });

function eagleFixture(state, invoke) {
  const scope = vue.effectScope();
  const eagle = scope.run(() => load('../src/composables/useEagle.js', { useAppState: () => state, invoke }, ['useEagle']).useEagle());
  return { eagle, dispose: () => scope.stop() };
}
function lightboxFixture(eagle, invoke) {
  const props = vue.reactive({ items: [{ key: 'a', path: '/a.jpg', filename: 'a.jpg' }, { key: 'b', path: '/b.jpg', filename: 'b.jpg' }], modelValue: 'a' });
  const scope = vue.effectScope();
  const box = scope.run(() => load('../src/components/EagleLightbox.vue', {
    defineProps: () => props, useEagle: () => eagle, invoke, convertFileSrc: path => path,
  }, ['confirmCrop', 'cancelCrop', 'cropBusy', 'cropping', 'importCurrent', 'singleImporting', 'cropRect', 'dispSize', 'onCropKey', 'onKey', 'previewLoading', 'previewError', 'loadPreview', 'previewSrc', 'previewCache']));
  return { box, props, dispose: () => { box.unmounted.forEach(fn => fn()); scope.stop(); } };
}

test('scan and upload retain the same snapshot even if shared configuration changes', async () => {
  const scan = deferred(), captured = [];
  const { state, home } = homeFixture(async (command, args) => {
    captured.push({ command, args });
    if (command === 'scan_files') return scan.promise;
    return { completed: 1, skipped: 0, failed: [], cancelled: false };
  });
  const run = home.startScan();
  assert.equal(state.configLocked.value, true);
  state.currentMode.value = 'dji';
  state.config.value.sd.target_dir = '/edited';
  scan.resolve([file('a.jpg')]);
  await run;
  assert.equal(state.configLocked.value, false);
  await home.startUpload(home.filesToDisplay.value);
  assert.equal(captured.find(x => x.command === 'upload_files').args.targetDir, '/backup');
  await home.ejectVolume();
  assert.equal(captured.find(x => x.command === 'eject_volume').args.path, '/sd');
});

test('cancel keeps upload locked until the worker returns and never displays success', async () => {
  const worker = deferred(); let uploadCalls = 0;
  const { home } = homeFixture(async command => {
    if (command === 'scan_files') return [file('a.jpg')];
    if (command === 'upload_files') { uploadCalls++; return worker.promise; }
  });
  await home.startScan();
  const run = home.startUpload(home.filesToDisplay.value);
  await home.cancel();
  assert.equal(home.isUploading.value, true);
  assert.equal(home.isCancelling.value, true);
  await home.startUpload(home.filesToDisplay.value);
  assert.equal(uploadCalls, 1);
  worker.resolve({ completed: 0, skipped: 0, failed: [], cancelled: true });
  await run;
  assert.equal(home.isUploading.value, false);
  assert.equal(home.showSuccessModal.value, false);
  assert.equal(home.scanResult.value.length, 1);
});

test('partial failure retains results; retry excludes completed overwrites', async () => {
  const uploads = [];
  const { home } = homeFixture(async (command, args) => {
    if (command === 'scan_files') return [file('a.jpg', 'overwrite'), file('b.jpg', 'overwrite')];
    if (command === 'upload_files') {
      uploads.push(args.files);
      return uploads.length === 1 ? { completed: 1, skipped: 0, failed: [{ path: '/sd/b.jpg', filename: 'b.jpg', error: 'disk error' }], cancelled: false }
        : { completed: 1, skipped: 0, failed: [], cancelled: false };
    }
  });
  await home.startScan(); await home.startUpload(home.filesToDisplay.value);
  assert.equal(home.showSuccessModal.value, false);
  assert.equal(home.fileProgress.value['/sd/a.jpg'].status, 'done');
  assert.equal(home.scanResult.value.length, 2);
  await home.startUpload(home.filesToDisplay.value);
  assert.deepEqual(uploads[1].map(f => f.filename), ['b.jpg']);
  assert.equal(home.showSuccessModal.value, true);
});

test('file errors are visible while the batch is paused and are not logged twice on completion', async () => {
  const worker = deferred();
  const { home } = homeFixture(async command => {
    if (command === 'scan_files') return [file('a.mp4'), file('b.mp4')];
    if (command === 'upload_files') return worker.promise;
  });
  await home.startScan();
  const pending = home.startUpload(home.filesToDisplay.value);
  const failure = { path: '/sd/a.mp4', filename: 'a.mp4', status: 'error', error: '写入目标文件失败: disk full', file_done: 0, file_total: 10 };
  home.handleUploadProgress(failure);
  home.handleUploadProgress({ ...failure, path: '/unrelated.mp4' });
  await home.togglePause();
  assert.equal(home.isUploading.value, true);
  assert.equal(home.isPaused.value, true);
  assert.equal(home.fileProgress.value[failure.path].error, failure.error);
  assert.equal(home.uploadFailures.value.length, 1);
  assert.equal(home.logs.value.filter(log => log.type === 'error').length, 1);
  worker.resolve({ completed: 0, skipped: 0, failed: [failure], cancelled: true });
  await pending;
  assert.equal(home.logs.value.filter(log => log.type === 'error').length, 1);
  assert.equal(home.fileProgress.value[failure.path].error, failure.error);
  assert.equal(home.showSuccessModal.value, false);
});

test('manual selection uploads exactly the checked files across filters and retains the remaining files', async () => {
  const uploads = [];
  const items = [file('first.mp4'), file('second.jpg'), file('later.mp4'), file('duplicate.jpg', 'skip')];
  const { state, home } = homeFixture(async (command, args) => {
    if (command === 'scan_files') return items;
    if (command === 'upload_files') {
      uploads.push(args.files.map(f => f.path));
      return { completed: args.files.length, completed_paths: args.files.map(f => f.path), skipped: 0, failed: [], cancelled: false };
    }
  });
  await home.startScan();
  await home.startUpload();
  assert.equal(uploads.length, 0, 'an empty selection never uploads the filtered list');
  home.selectedKeys.value = ['/sd/first.mp4', '/sd/second.jpg', '/sd/duplicate.jpg'];
  home.selectedExtensions.value = ['jpg'];
  assert.equal(home.selectedCount.value, 2);
  assert.equal(home.hiddenSelectedCount.value, 1);
  home.fileFilter.value = 'skip';
  assert.equal(home.hiddenSelectedCount.value, 2);
  await home.startUpload();
  assert.deepEqual(uploads[0], ['/sd/first.mp4', '/sd/second.jpg']);
  assert.equal(state.currentStep.value, 'results');
  assert.equal(home.showSuccessModal.value, false);
  assert.equal(home.scanResult.value.length, 4);
  assert.equal(home.fileProgress.value['/sd/later.mp4'], undefined);
  assert.equal(home.selectedCount.value, 0);
  home.selectedKeys.value = ['/sd/later.mp4'];
  await home.startUpload();
  assert.deepEqual(uploads[1], ['/sd/later.mp4']);
  assert.equal(home.showSuccessModal.value, true);
});

test('table selection targets visible unfinished files, retains hidden choices, and locks during upload', () => {
  const props = vue.reactive({ files: [file('a.jpg'), file('b.jpg', 'overwrite'), file('duplicate.jpg', 'skip'), file('done.jpg')],
    selectedKeys: ['/sd/b.jpg'], filter: 'upload', selectable: true, selectionDisabled: false,
    progressMap: { '/sd/done.jpg': { status: 'done' } } });
  const table = load('../src/components/FileTable.vue', {
    defineProps: () => props,
    defineEmits: () => (event, value) => { if (event === 'update:selectedKeys') props.selectedKeys = value; },
  }, ['toggleFile', 'toggleAll', 'allVisibleSelected']);
  table.toggleAll();
  assert.deepEqual(props.selectedKeys, ['/sd/b.jpg', '/sd/a.jpg']);
  assert.equal(table.allVisibleSelected.value, true);
  table.toggleAll();
  assert.deepEqual(props.selectedKeys, ['/sd/b.jpg']);
  table.toggleFile(props.files[2]);
  table.toggleFile(props.files[3]);
  assert.deepEqual(props.selectedKeys, ['/sd/b.jpg']);
  props.selectionDisabled = true;
  table.toggleAll(); table.toggleFile(props.files[1]);
  assert.deepEqual(props.selectedKeys, ['/sd/b.jpg']);
});

test('failed pause/cancel commands retain recoverable task state', async () => {
  const worker = deferred();
  const { home } = homeFixture(async command => {
    if (command === 'scan_files') return [file('a.jpg')];
    if (command === 'upload_files') return worker.promise;
    throw new Error('IPC unavailable');
  });
  await home.startScan(); const run = home.startUpload(home.filesToDisplay.value);
  await home.togglePause(); assert.equal(home.isPaused.value, false);
  await home.cancel(); assert.equal(home.isUploading.value, true); assert.equal(home.isCancelling.value, false);
  assert.equal(home.noticeModal.value.visible, true);
  worker.resolve({ completed: 0, skipped: 0, failed: [], cancelled: true }); await run;
});

test('overwrite setting uses the persistence event and saves each mode independently', async () => {
  const saved = [];
  const { state, home } = homeFixture(async (command, args) => { if (command === 'save_config') saved.push(structuredClone(vue.toRaw(args.config))); });
  state.config.value.sd.overwrite_duplicates = false;
  await home.saveConfig();
  assert.equal(saved[0].sd.overwrite_duplicates, false);
  assert.equal(saved[0].dji.overwrite_duplicates, false);
  const source = readFileSync(new URL('../src/views/Home.vue', import.meta.url), 'utf8');
  assert.match(source, /v-model="config\[currentMode\]\.overwrite_duplicates" @change="saveConfig"/);
});

test('Eagle identity invalidates stale requests, folder selections and imported marks', async () => {
  const state = appState(); state.config.value.eagle.base_url = 'http://a'; state.config.value.eagle.last_folder_id = 'A';
  const old = deferred();
  const { eagle, dispose } = eagleFixture(state, async (command, args) => {
    if (command === 'eagle_ping') return '1';
    if (command === 'save_config') return;
    return args.baseUrl === 'http://a' ? old.promise : [{ id: 'B', name: 'B', children: [] }];
  });
  try {
    const pending = eagle.connectEagle(); await Promise.resolve();
    eagle.markImported('/photo.jpg');
    state.config.value.eagle.base_url = 'http://b';
    assert.equal(eagle.eagleState.value.status, 'idle');
    assert.equal(eagle.markOf('/photo.jpg').imported, undefined);
    await eagle.connectEagle();
    assert.equal(eagle.folderId.value, '');
    old.resolve([{ id: 'A', name: 'A' }]); await pending;
    assert.deepEqual(eagle.folders.value.map(f => f.id), ['B']);
    assert.equal(eagle.eagleState.value.status, 'ok');
  } finally { dispose(); }
});

test('pending crop is locked across cancel and remount; old callback cannot close new crop', async () => {
  const state = appState(); const service = eagleFixture(state, async () => {});
  service.eagle.eagleState.value = { status: 'ok', version: '1', error: '' };
  const worker = deferred(); let requests = 0;
  const one = lightboxFixture(service.eagle, async () => { requests++; return worker.promise; });
  let two;
  try {
    one.box.cropping.value = true; const run = one.box.confirmCrop();
    one.box.cancelCrop(); assert.equal(one.box.cropBusy.value, true);
    one.dispose();
    two = lightboxFixture(service.eagle, async () => { requests++; return worker.promise; });
    two.box.cropping.value = true; await two.box.confirmCrop(); assert.equal(requests, 1);
    worker.resolve({ width: 10, height: 10 }); await run;
    assert.equal(two.box.cropping.value, true);
    assert.equal(two.box.cropBusy.value, false);
    assert.equal(service.eagle.markOf('/a.jpg').cropCount, 1);
  } finally { two?.dispose(); service.dispose(); }
});

test('crop shortcut cannot bypass disconnected state; focused buttons retain native Enter', async () => {
  const service = eagleFixture(appState(), async () => {}); let requests = 0;
  const fixture = lightboxFixture(service.eagle, async () => { requests++; });
  try {
    fixture.box.cropping.value = true;
    await fixture.box.confirmCrop(); assert.equal(requests, 0);
    fixture.box.onKey({ key: 'Enter', target: { closest: () => true }, preventDefault() { throw new Error('native button intercepted'); } });
    const button = { closest: selector => (selector.includes('button') && !selector.includes('input') ? {} : null) };
    fixture.box.onKey({ key: 'Enter', target: button, preventDefault() { throw new Error('native button intercepted'); } });
    assert.equal(requests, 0);
  } finally { fixture.dispose(); service.dispose(); }
});

test('crop keyboard movement and resizing stay inside image bounds', () => {
  const service = eagleFixture(appState(), async () => {}); const fixture = lightboxFixture(service.eagle, async () => {});
  try {
    fixture.box.cropRect.value = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
    const key = (name, shiftKey = false) => fixture.box.onCropKey({ key: name, shiftKey, preventDefault() {}, stopPropagation() {} });
    key('ArrowRight'); assert.ok(Math.abs(fixture.box.cropRect.value.x - 0.21) < 1e-10);
    for (let i = 0; i < 100; i++) key('ArrowRight', true);
    assert.ok(fixture.box.cropRect.value.x + fixture.box.cropRect.value.w <= 1);
    for (let i = 0; i < 100; i++) key('ArrowUp');
    assert.equal(fixture.box.cropRect.value.y, 0);
  } finally { fixture.dispose(); service.dispose(); }
});

test('late preview result cannot overwrite a more recent navigation to the same path', async () => {
  const service = eagleFixture(appState(), async () => {}), pending = [];
  const fixture = lightboxFixture(service.eagle, () => { const d = deferred(); pending.push(d); return d.promise; });
  try {
    fixture.props.items[0].filename = 'a.cr3';
    const first = fixture.box.loadPreview(); const second = fixture.box.loadPreview();
    pending[1].resolve('data:new'); await second;
    pending[0].resolve('data:old'); await first;
    assert.equal(fixture.box.previewSrc.value, 'data:new');
    assert.equal(fixture.box.previewCache.get('/a.jpg'), 'data:new');
  } finally { fixture.dispose(); service.dispose(); }
});

test('thumbnail completion writes the current merged item and ignores replacement generation', async () => {
  const state = appState(); const first = media.mergeTetherFile(null, { key: 'same', status: 'done', target_path: '/a.jpg' });
  state.tetherFiles.value = [first]; const work = deferred();
  const scope = vue.effectScope();
  const tether = scope.run(() => load('../src/components/TetherPanel.vue', { useAppState: () => state, useEagle: () => ({ markOf: () => ({}) }), invoke: () => work.promise }, ['loadThumb']));
  const run = tether.loadThumb(state.tetherFiles.value[0]);
  state.tetherFiles.value[0] = media.mergeTetherFile(state.tetherFiles.value[0], { key: 'same', status: 'done', target_path: '/a.jpg' });
  work.resolve('data:correct'); await run;
  assert.equal(state.tetherFiles.value[0].thumb, 'data:correct');
  const next = media.mergeTetherFile(state.tetherFiles.value[0], { key: 'same', status: 'receiving', target_path: '' });
  assert.equal(next.thumb, ''); assert.equal(next.thumbState, 'idle');
  scope.stop();
});

test('media helpers preserve paths, extensions and date source formats', () => {
  assert.equal(media.normalizePath({ path: '/a/b.jpg' }), '/a/b.jpg');
  assert.equal(media.basename('C:\\photo\\A.JPG'), 'A.JPG');
  assert.deepEqual(media.extensionInfo('A.JPG'), { key: 'jpg', label: 'JPG' });
  assert.deepEqual(media.extensionInfo('.hidden'), { key: 'noext', label: '无后缀' });
  assert.equal(media.extensionOf('file.'), '');
  assert.equal(media.parseMediaDate({ secs_since_epoch: 1 }).getTime(), 1000);
  assert.equal(media.mediaDayKey({ secs_since_epoch: 1 }), media.mediaDayKey(1000));
});

test('converted preview cache is bounded and least recently used entries are evicted', () => {
  const cache = media.createLruCache(2);
  cache.set('a', 'A'); cache.set('b', 'B'); assert.equal(cache.get('a'), 'A');
  cache.set('c', 'C'); assert.equal(cache.get('b'), undefined); assert.equal(cache.size, 2);
  for (let i = 0; i < 100; i++) cache.set(i, String(i));
  assert.equal(cache.size, 2); cache.clear(); assert.equal(cache.size, 0);
});


test('cancelled outcome paths preserve completed overwrites even when no progress event arrives', async () => {
  const uploads = [];
  const { home } = homeFixture(async (command, args) => {
    if (command === 'scan_files') return [file('a.jpg', 'overwrite'), file('b.jpg', 'overwrite')];
    if (command === 'upload_files') {
      uploads.push(args.files);
      return uploads.length === 1
        ? { completed: 1, completed_paths: ['/sd/a.jpg'], skipped: 0, skipped_paths: [], failed: [], cancelled: true }
        : { completed: 1, completed_paths: ['/sd/b.jpg'], skipped: 0, skipped_paths: [], failed: [], cancelled: false };
    }
  });
  await home.startScan(); await home.startUpload(home.filesToDisplay.value);
  assert.equal(home.fileProgress.value['/sd/a.jpg'].status, 'done');
  assert.equal(home.showSuccessModal.value, false);
  await home.startUpload(home.filesToDisplay.value);
  assert.deepEqual(uploads[1].map(item => item.filename), ['b.jpg']);
});


test('thumbnail response from the prior generation cannot overwrite a new capture', async () => {
  const state = appState();
  state.tetherFiles.value = [media.mergeTetherFile(null, { key: 'same', status: 'done', target_path: '/a.jpg' })];
  const old = deferred(); const scope = vue.effectScope();
  const tether = scope.run(() => load('../src/components/TetherPanel.vue', { useAppState: () => state,
    useEagle: () => ({ markOf: () => ({}) }), invoke: () => old.promise }, ['loadThumb']));
  const loading = tether.loadThumb(state.tetherFiles.value[0]);
  state.tetherFiles.value[0] = media.mergeTetherFile(state.tetherFiles.value[0], { key: 'same', status: 'done', target_path: '/b.jpg' });
  old.resolve('data:old'); await loading;
  assert.equal(state.tetherFiles.value[0].thumb, '');
  assert.equal(state.tetherFiles.value[0].thumbState, 'idle');
  scope.stop();
});


test('watch start never forwards legacy automatic source deletion preference', async () => {
  const state = appState();
  state.config.value.tether = { ...state.config.value.tether, mode: 'watch', watch_dir: '/incoming', target_dir: '/archive', delete_source: true };
  const calls = []; const scope = vue.effectScope();
  const tether = scope.run(() => load('../src/components/TetherPanel.vue', { useAppState: () => state,
    useEagle: () => ({ markOf: () => ({}) }), invoke: async (command, args) => {
      calls.push({ command, args }); return { lan_ip: '', ftp_port: null, inbox: null };
    } }, ['start']));
  await tether.start();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'start_tether');
  assert.equal(calls[0].args.args.mode, 'watch');
  assert.equal(calls[0].args.args.deleteSource, false);
  assert.equal(state.config.value.tether.delete_source, true);
  scope.stop();
});
