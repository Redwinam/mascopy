fn main() {
  println!("cargo:rerun-if-changed=tauri.conf.json");
  println!("cargo:rerun-if-changed=capabilities/default.json");
  println!("cargo:rerun-if-changed=../icon.icns");
  tauri_build::build();
  let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set");
  println!(
    "cargo:rustc-env=TAURI_CONFIG_PATH={}/tauri.conf.json",
    manifest_dir
  );
}
