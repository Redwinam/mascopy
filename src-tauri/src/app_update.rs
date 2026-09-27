//! 应用内自动更新（标题栏「关于与更新」）的两条辅助命令。检查 / 下载 / 安装走 tauri-plugin-updater
//! 自己的插件命令（capabilities/default.json 放行），这里只补「这个构建该不该检查更新」与「装好后重启」。

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::AppHandle;

/// 开发构建（`tauri dev` 或 debug 构建）不检查更新：更新包装进去只会把开发产物整个换掉。
#[tauri::command]
pub fn app_update_supported() -> bool {
    !cfg!(debug_assertions) && !tauri::is_dev()
}

/// `…/大师拷贝.app/Contents/MacOS/<可执行文件>` → `…/大师拷贝.app`；不在 .app 里运行时为 None。
fn app_bundle_of(exe: &Path) -> Option<PathBuf> {
    let macos = exe.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    let is_bundle = macos.file_name()? == "MacOS"
        && contents.file_name()? == "Contents"
        && bundle.extension()? == "app";
    is_bundle.then(|| bundle.to_path_buf())
}

// $1 = 当前进程 pid，$2 = .app 路径。最多等 60 秒（旧进程卡住也不留常驻 shell），退出后用 open 重新打开。
const RELAUNCH_SCRIPT: &str = r#"i=0; while kill -0 "$1" 2>/dev/null && [ "$i" -lt 300 ]; do sleep 0.2; i=$((i+1)); done; exec /usr/bin/open "$2""#;

/// 更新包已原地装好后重启：分离的 /bin/sh 等本进程退出，再经 LaunchServices 打开 .app。
/// 不用 Tauri 自带的 restart：它在本进程退出前就拉起新进程，新旧两个进程会短暂并存。
/// 拷贝中、联机会话中不能重启，由前端拦住（按钮不可点）。
#[tauri::command]
pub fn relaunch_after_update(app: AppHandle) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("当前平台不支持自动重启，请手动重新打开大师拷贝".into());
    }
    let exe = std::env::current_exe().map_err(|e| format!("无法定位应用: {e}"))?;
    let bundle = app_bundle_of(&exe).ok_or("当前不是从 .app 运行，请手动重新打开大师拷贝")?;
    Command::new("/bin/sh")
        .args(["-c", RELAUNCH_SCRIPT, "mascopy-relaunch"])
        .arg(std::process::id().to_string())
        .arg(&bundle)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("启动重启辅助进程失败: {e}"))?;
    // 先让前端拿到结果，再走正常退出路径
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        handle.exit(0);
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::app_bundle_of;
    use std::path::{Path, PathBuf};

    #[test]
    fn bundle_is_derived_only_from_a_real_app_layout() {
        assert_eq!(
            app_bundle_of(Path::new("/Applications/大师拷贝.app/Contents/MacOS/app")),
            Some(PathBuf::from("/Applications/大师拷贝.app"))
        );
        for exe in [
            "/repo/target/release/app",
            "/Applications/大师拷贝/Contents/MacOS/app",
            "/Applications/大师拷贝.app/Contents/Resources/app",
            "app",
        ] {
            assert_eq!(app_bundle_of(Path::new(exe)), None, "{exe}");
        }
    }
}
