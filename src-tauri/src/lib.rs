use tauri::menu::{MenuBuilder, SubmenuBuilder, MenuItemBuilder};
use tauri::{Emitter, Manager};

/// 纯 Rust 跨平台全屏截图（基于 screenshots）
#[tauri::command]
fn take_screenshot() -> Result<String, String> {
  let screens = screenshots::Screen::all()
    .map_err(|e| format!("无法获取显示器: {e}"))?;

  let path = std::env::temp_dir().join("qrtext_screenshot.png");

  screens
    .first()
    .ok_or("未检测到显示器")?
    .capture()
    .map_err(|e| format!("截图失败: {e}"))?
    .save(&path)
    .map_err(|e| format!("保存截图失败: {e}"))?;

  Ok(path.to_string_lossy().to_string())
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

      // ── 自定义菜单栏（中文标签 + 快捷键） ──
      let about_item = MenuItemBuilder::with_id("about", "关于 QRTEXT")
        .build(app)?;

      let hide_item = MenuItemBuilder::with_id("hide_app", "隐藏 QRTEXT")
        .accelerator("CmdOrCtrl+H")
        .build(app)?;

      let quit_item = MenuItemBuilder::with_id("quit_app", "退出 QRTEXT")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;

      let app_menu = SubmenuBuilder::new(app, "QRTEXT")
        .item(&about_item)
        .separator()
        .item(&hide_item)
        .item(&quit_item)
        .build()?;

      // 编辑菜单 — 自定义中文标签 + 标准快捷键
      let edit_menu = SubmenuBuilder::new(app, "编辑")
        .item(
          &MenuItemBuilder::with_id("undo", "撤销")
            .accelerator("CmdOrCtrl+Z")
            .build(app)?,
        )
        .item(
          &MenuItemBuilder::with_id("redo", "重做")
            .accelerator("CmdOrCtrl+Shift+Z")
            .build(app)?,
        )
        .separator()
        .item(
          &MenuItemBuilder::with_id("cut", "剪切")
            .accelerator("CmdOrCtrl+X")
            .build(app)?,
        )
        .item(
          &MenuItemBuilder::with_id("copy", "拷贝")
            .accelerator("CmdOrCtrl+C")
            .build(app)?,
        )
        .item(
          &MenuItemBuilder::with_id("paste", "粘贴")
            .accelerator("CmdOrCtrl+V")
            .build(app)?,
        )
        .item(
          &MenuItemBuilder::with_id("select_all", "全选")
            .accelerator("CmdOrCtrl+A")
            .build(app)?,
        )
        .build()?;

      let window_menu = SubmenuBuilder::new(app, "窗口")
        .item(
          &MenuItemBuilder::with_id("minimize", "最小化")
            .accelerator("CmdOrCtrl+M")
            .build(app)?,
        )
        .item(
          &MenuItemBuilder::with_id("fullscreen", "进入全屏")
            .accelerator("CmdOrCtrl+Control+F")
            .build(app)?,
        )
        .build()?;

      let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&edit_menu)
        .item(&window_menu)
        .build()?;

      app.set_menu(menu)?;

      // ── 菜单事件：关于 / 窗口操作 ──
      let handle = app.handle().clone();
      app.on_menu_event(move |app, event| {
        match event.id().0.as_str() {
          "about" => {
            let _ = handle.emit("show-about", ());
          }
          "minimize" => {
            let _ = app.get_webview_window("main").map(|w| w.minimize());
          }
          "fullscreen" => {
            if let Some(w) = app.get_webview_window("main") {
              let is_full = w.is_fullscreen().unwrap_or(false);
              let _ = w.set_fullscreen(!is_full);
            }
          }
          "hide_app" => {
            let _ = app.get_webview_window("main").map(|w| w.hide());
          }
          "quit_app" => {
            app.exit(0);
          }
          _ => {}
        }
      });

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
