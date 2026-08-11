import { computed, ref, watchEffect } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";

// 主题偏好放在模块级：整个应用共用一份，切页签/切视图都不重置
// 存储键与 index.html 首屏脚本一致（那段脚本负责在首帧前上色，改这里要一起改）
const STORAGE_KEY = "mascopy.theme";
const MODES = ["system", "light", "dark"];

const darkQuery =
    typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

const isTauri =
    typeof window !== "undefined" && (window.__TAURI__ !== undefined || window.__TAURI_INTERNALS__ !== undefined);
const appWindow = isTauri ? getCurrentWindow() : null;

function readStoredMode() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return MODES.includes(saved) ? saved : "system";
    } catch {
        return "system";
    }
}

const themeMode = ref(readStoredMode()); // system | light | dark
const systemTheme = ref(darkQuery?.matches ? "dark" : "light");
const resolvedTheme = computed(() => (themeMode.value === "system" ? systemTheme.value : themeMode.value));

darkQuery?.addEventListener("change", (e) => {
    systemTheme.value = e.matches ? "dark" : "light";
});

// data-theme 决定 CSS 变量取哪一套；color-scheme 让滚动条等原生控件跟着变
watchEffect(() => {
    const theme = resolvedTheme.value;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    // 无边框窗口的红绿灯与原生标题栏默认跟随系统，手动切换时把窗口主题一起改掉
    if (appWindow?.setTheme) {
        appWindow.setTheme(themeMode.value === "system" ? null : theme).catch(() => {});
    }
});

function setThemeMode(mode) {
    if (!MODES.includes(mode)) return;
    themeMode.value = mode;
    try {
        localStorage.setItem(STORAGE_KEY, mode);
    } catch {
        // 存不进去也不影响本次运行，忽略
    }
}

export function useTheme() {
    return {
        themeMode,
        resolvedTheme,
        setThemeMode
    };
}
