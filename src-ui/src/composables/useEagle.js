import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useAppState } from "./useAppState.js";

// Eagle 连接与导入偏好放在模块级：联机灯箱/挑图页共享同一份连接，
// 已导入/裁剪次数标记（按文件路径）也跨视图保持，避免重复导入
const eagleState = ref({ status: "idle", version: "", error: "" }); // idle | checking | ok | fail
const folders = ref([]);
const folderId = ref("");
const tagsInput = ref("");
const marks = ref({}); // { [path]: { imported: bool, cropCount: n } }

function flattenFolders(nodes, depth = 0, out = []) {
    (nodes || []).forEach((n) => {
        out.push({ id: n.id, label: `${"　".repeat(depth)}${n.name}` });
        flattenFolders(n.children, depth + 1, out);
    });
    return out;
}

export function useEagle() {
    const { config } = useAppState();

    const eagleCfg = computed(() => {
        if (!config.value.eagle) {
            config.value.eagle = { base_url: "http://localhost:41595", token: "", last_folder_id: "" };
        }
        return config.value.eagle;
    });

    async function connectEagle() {
        eagleState.value = { status: "checking", version: "", error: "" };
        try {
            const auth = { baseUrl: eagleCfg.value.base_url, token: eagleCfg.value.token };
            const version = await invoke("eagle_ping", auth);
            const tree = await invoke("eagle_folders", auth);
            folders.value = flattenFolders(tree);
            const saved = eagleCfg.value.last_folder_id;
            if (saved && folders.value.some((f) => f.id === saved)) {
                folderId.value = saved;
            }
            eagleState.value = { status: "ok", version, error: "" };
        } catch (e) {
            eagleState.value = { status: "fail", version: "", error: String(e) };
        }
    }

    async function saveEagleConfig() {
        try {
            await invoke("save_config", { config: config.value });
        } catch (e) {
            /* 配置保存失败不阻断导入流程 */
        }
    }

    async function persistFolderChoice() {
        eagleCfg.value.last_folder_id = folderId.value;
        await saveEagleConfig();
    }

    function markOf(path) {
        return marks.value[path] || {};
    }

    function markImported(path) {
        marks.value[path] = { ...markOf(path), imported: true };
    }

    function addCropMark(path) {
        const m = markOf(path);
        marks.value[path] = { ...m, cropCount: (m.cropCount || 0) + 1 };
    }

    return {
        eagleCfg,
        eagleState,
        folders,
        folderId,
        tagsInput,
        markOf,
        markImported,
        addCropMark,
        connectEagle,
        saveEagleConfig,
        persistFolderChoice,
    };
}
