use std::process::Command;
use tauri::menu::{MenuBuilder, SubmenuBuilder, MenuItemBuilder};
use tauri::{Emitter, Manager};

/// 调用系统截图工具框选区域，保存到临时文件
#[tauri::command]
fn take_screenshot() -> Result<String, String> {
  let path = std::env::temp_dir().join("qrtext_screenshot.png");

  #[cfg(target_os = "macos")]
  {
    let status = Command::new("screencapture")
      .args(["-i", "-x"])
      .arg(&path)
      .status()
      .map_err(|e| format!("无法启动截图: {e}"))?;
    if !status.success() {
      return Err("截图已取消".into());
    }
  }

  #[cfg(target_os = "linux")]
  {
    let tools: &[(&str, &[&str])] = &[
      ("gnome-screenshot", &["-a", "-f"]),
      ("spectacle", &["-b", "-n", "-o"]),
      ("xfce4-screenshooter", &["-r", "-s"]),
      ("ksnip", &["-r", "-s"]),
    ];
    let mut ok = false;
    for (tool, args) in tools {
      if let Ok(status) = Command::new(tool).args(*args).arg(&path).status() {
        if status.success() {
          ok = true;
          break;
        }
      }
    }
    if !ok {
      return Err("未找到截图工具或截图被取消".into());
    }
  }

  #[cfg(target_os = "windows")]
  {
    Command::new("cmd")
      .args(["/c", "start", "/wait", "ms-screenclip:"])
      .status()
      .map_err(|_| "无法启动截图工具".to_string())?;

    // Windows: ms-screenclip 截图到剪贴板，用 PowerShell 保存
    let ps = r#"
Add-Type -AssemblyName System.Windows.Forms
if ([Windows.Forms.Clipboard]::ContainsImage()) {
  $img = [Windows.Forms.Clipboard]::GetImage()
  $img.Save($env:TEMP + '\qrtext_screenshot.png', [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output 'ok'
} else {
  Write-Output 'no_image'
}
"#;
    let output = Command::new("powershell")
      .args(["-Command", ps])
      .output()
      .map_err(|e| format!("PowerShell 执行失败: {e}"))?;
    if !String::from_utf8_lossy(&output.stdout).contains("ok") {
      return Err("剪贴板中无图片".into());
    }
  }

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
