// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod scanner;
mod metadata;
mod analyzer;
mod uploader;

use std::sync::Arc;
use tauri::{State, Window};
use config::{Config, ConfigManager};
use scanner::{Scanner, MediaFile};
use analyzer::Analyzer;
use uploader::Uploader;

struct AppState {
    config_manager: ConfigManager,
    uploader: Arc<Uploader>,
}

#[tauri::command]
fn get_config(state: State<AppState>) -> Result<Config, String> {
    state.config_manager.load().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_config(state: State<AppState>, config: Config) -> Result<(), String> {
    state.config_manager.save(&config).map_err(|e| e.to_string())
}

#[tauri::command]
async fn scan_files(
    source_dir: String, 
    target_dir: String, 
    overwrite_duplicates: bool,
    mode: Option<String>,
    fast_mode: Option<bool>,
) -> Result<Vec<MediaFile>, String> {
    let scanner = Scanner::with_mode(&mode.unwrap_or_else(|| "sd".to_string()));
    let mut files = scanner.scan(&source_dir, fast_mode.unwrap_or(false));
    
    // Analyze files to determine status and target path
    Analyzer::analyze(&mut files, &target_dir, overwrite_duplicates);
    
    Ok(files)
}

#[tauri::command]
async fn upload_files(
    files: Vec<MediaFile>, 
    window: Window,
    state: State<'_, AppState>
) -> Result<(), String> {
    state.uploader.reset();
    state.uploader.upload_files(files, window).await
}

#[tauri::command]
fn pause_upload(state: State<AppState>) {
    state.uploader.pause();
}

#[tauri::command]
fn resume_upload(state: State<AppState>) {
    state.uploader.resume();
}

#[tauri::command]
fn cancel_upload(state: State<AppState>) {
    state.uploader.cancel();
}

#[tauri::command]
fn add_favorite(
    state: State<AppState>,
    category: String,
    path: String
) -> Result<(), String> {
    let mut config = state.config_manager.load().map_err(|e| e.to_string())?;
    
    let list = match category.as_str() {
        "sd_source" => &mut config.favorites.sd_sources,
        "dji_source" => &mut config.favorites.dji_sources,
        "target" => &mut config.favorites.targets,
        _ => return Err("Invalid category".to_string()),
    };
    
    if !list.contains(&path) {
        list.push(path);
        state.config_manager.save(&config).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
fn remove_favorite(
    state: State<AppState>,
    category: String,
    path: String
) -> Result<(), String> {
    let mut config = state.config_manager.load().map_err(|e| e.to_string())?;
    
    let list = match category.as_str() {
        "sd_source" => &mut config.favorites.sd_sources,
        "dji_source" => &mut config.favorites.dji_sources,
        "target" => &mut config.favorites.targets,
        _ => return Err("Invalid category".to_string()),
    };
    
    list.retain(|p| p != &path);
    state.config_manager.save(&config).map_err(|e| e.to_string())?;
    
    Ok(())
}

fn main() {
    let uploader = Arc::new(Uploader::new());
    let config_manager = ConfigManager::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            config_manager,
            uploader,
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            scan_files,
            upload_files,
            pause_upload,
            resume_upload,
            cancel_upload,
            add_favorite,
            remove_favorite
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
