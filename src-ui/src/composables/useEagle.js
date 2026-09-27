import { ref, computed, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useAppState } from './useAppState.js';

const { config } = useAppState();
const eagleCfg = computed(() => config.value.eagle);
// 身份仅驻留内存；不会写入日志、路径或额外配置。
const connectionKey = computed(() => JSON.stringify([eagleCfg.value.base_url.trim().replace(/\/+$/, ''), eagleCfg.value.token]));
const eagleState = ref({ status: 'idle', version: '', error: '' });
const folders = ref([]);
const folderId = ref('');
const tagsInput = ref('');
const marks = ref({});
const pending = ref(new Set());
let connectionRequest = 0;

watch(connectionKey, () => {
  connectionRequest++;
  eagleState.value = { status: 'idle', version: '', error: '' };
  folders.value = [];
  folderId.value = '';
}, { flush: 'sync' });

function flattenFolders(nodes, depth = 0, out = []) {
  (Array.isArray(nodes) ? nodes : []).forEach(n => {
    out.push({ id: n.id, label: `${'　'.repeat(depth)}${n.name}` });
    flattenFolders(n.children, depth + 1, out);
  });
  return out;
}

function operationKey(path, kind, identity) {
  return JSON.stringify([identity, path, kind]);
}

export function useEagle() {
  async function connectEagle() {
    const request = ++connectionRequest;
    const identity = connectionKey.value;
    const auth = { baseUrl: eagleCfg.value.base_url, token: eagleCfg.value.token };
    eagleState.value = { status: 'checking', version: '', error: '' };
    try {
      const version = await invoke('eagle_ping', auth);
      const tree = await invoke('eagle_folders', auth);
      if (request !== connectionRequest || identity !== connectionKey.value) return;
      folders.value = flattenFolders(tree);
      const saved = folderId.value || eagleCfg.value.last_folder_id;
      folderId.value = folders.value.some(f => f.id === saved) ? saved : '';
      eagleState.value = { status: 'ok', version, error: '' };
    } catch (error) {
      if (request !== connectionRequest || identity !== connectionKey.value) return;
      folders.value = [];
      folderId.value = '';
      eagleState.value = { status: 'fail', version: '', error: String(error) };
    }
  }

  async function saveEagleConfig() {
    try {
      await invoke('save_config', { config: config.value });
    } catch (error) {
      eagleState.value = { ...eagleState.value, error: `保存设置失败：${error}` };
    }
  }

  async function persistFolderChoice(choice = folderId.value, identity = connectionKey.value) {
    if (identity !== connectionKey.value) return;
    eagleCfg.value.last_folder_id = choice;
    await saveEagleConfig();
  }

  function markOf(path, identity = connectionKey.value) {
    return marks.value[identity]?.[path] || {};
  }

  function updateMark(path, update, identity) {
    marks.value[identity] = { ...marks.value[identity], [path]: { ...markOf(path, identity), ...update } };
  }

  function markImported(path, identity = connectionKey.value) {
    updateMark(path, { imported: true }, identity);
  }

  function addCropMark(path, identity = connectionKey.value) {
    updateMark(path, { cropCount: (markOf(path, identity).cropCount || 0) + 1 }, identity);
  }

  function isImporting(path, kind, identity = connectionKey.value) {
    return pending.value.has(operationKey(path, kind, identity));
  }

  function beginImport(path, kind, identity = connectionKey.value) {
    const key = operationKey(path, kind, identity);
    if (pending.value.has(key)) return null;
    pending.value = new Set([...pending.value, key]);
    return () => {
      const next = new Set(pending.value);
      next.delete(key);
      pending.value = next;
    };
  }

  return { eagleCfg, eagleState, folders, folderId, tagsInput, connectionKey,
    markOf, markImported, addCropMark, connectEagle, saveEagleConfig, persistFolderChoice, isImporting, beginImport };
}
