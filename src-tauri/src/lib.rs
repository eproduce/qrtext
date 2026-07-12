use std::process::Command;
use std::time::Duration;
use tauri::menu::{MenuBuilder, SubmenuBuilder, MenuItemBuilder};

/// 调用系统原生截图工具，截取到剪贴板后由前端读取
#[tauri::command]
fn take_screenshot() -> Result<String, String> {
  #[cfg(target_os = "macos")]
  {
    // screencapture -c: 截取到剪贴板  -i: 交互式框选
    let status = Command::new("screencapture")
      .args(["-i", "-c"])
      .status()
      .map_err(|e| format!("无法启动截图: {e}"))?;

    if !status.success() {
      return Err("截图已取消".into());
    }
    // 等待剪贴板写入完成
    std::thread::sleep(Duration::from_millis(300));
  }

  #[cfg(target_os = "linux")]
  {
    let tools: &[(&str, &[&str])] = &[
      ("gnome-screenshot", &["-a", "-c"]),
      ("spectacle", &["-b", "-n", "-c"]),
      ("xfce4-screenshooter", &["-r", "-c"]),
      ("ksnip", &["-r"]),
    ];

    for (tool, args) in tools {
      if let Ok(status) = Command::new(tool).args(*args).status() {
        if status.success() {
          std::thread::sleep(Duration::from_millis(500));
          return Ok("ok".into());
        }
      }
    }

    // 回退：import + xclip
    let path = std::env::temp_dir().join("qrtext_screenshot.png");
    if Command::new("import").arg(&path).status().map(|s| s.success()).unwrap_or(false) {
      let _ = Command::new("xclip")
        .args(["-selection", "clipboard", "-t", "image/png", "-i"])
        .arg(&path)
        .status();
      std::thread::sleep(Duration::from_millis(300));
      return Ok("ok".into());
    }

    return Err("未找到截图工具。请安装 gnome-screenshot、spectacle 或 ksnip".into());
  }

  #[cfg(target_os = "windows")]
  {
    let status = Command::new("cmd")
      .args(["/c", "start", "ms-screenclip:"])
      .status();

    if status.is_err() {
      return Err("无法启动截图工具，请使用 Win+Shift+S 截图后粘贴".into());
    }
    std::thread::sleep(Duration::from_millis(500));
    Ok("ok".into())
  }

  #[cfg(not(any(target_os = "linux", target_os = "windows")))]
  Ok("ok".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![take_screenshot])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // ── 自定义菜单栏（中文） ──
      let about_item = MenuItemBuilder::with_id("about", "关于 QRTEXT")
        .build(app)?;

      let app_menu = SubmenuBuilder::new(app, "QRTEXT")
        .item(&about_item)
        .separator()
        .services()
        .separator()
        .hide()
        .quit()
        .build()?;

      let edit_menu = SubmenuBuilder::new(app, "编辑")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

      let window_menu = SubmenuBuilder::new(app, "窗口")
        .minimize()
        .fullscreen()
        .build()?;

      let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&edit_menu)
        .item(&window_menu)
        .build()?;

      app.set_menu(menu)?;

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
