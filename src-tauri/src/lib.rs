use std::process::Command;
use base64::Engine;
use tauri::menu::{MenuBuilder, SubmenuBuilder, MenuItemBuilder};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// 创建浮动截图窗口（系统级独立窗口）
#[tauri::command]
fn pin_screenshot(app: tauri::AppHandle, data_url: String) -> Result<(), String> {
  let id = format!("pin-{}", std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis());

  // 写临时 HTML 文件
  let html = format!(r#"<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{background:#222;display:flex;flex-direction:column;height:100vh;overflow:hidden}}
.bar{{height:28px;background:rgba(0,0,0,0.6);display:flex;align-items:center;
  justify-content:flex-end;padding:0 8px;-webkit-app-region:drag;flex-shrink:0}}
.bar button{{-webkit-app-region:no-drag;border:none;background:none;color:#fff;
  cursor:pointer;font-size:16px;width:28px;height:28px;border-radius:6px}}
.bar button:hover{{background:rgba(255,255,255,0.15)}}
.img-wrap{{flex:1;display:flex;align-items:center;justify-content:center;overflow:auto;padding:0}}
img{{max-width:100%;max-height:100%;object-fit:contain;user-select:none}}
</style></head><body>
<div class="bar"><button onclick="window.__TAURI__.invoke('close_pin',{{id:'{id}'}})">✕</button></div>
<div class="img-wrap"><img src="{data_url}" /></div>
<script>document.addEventListener('dblclick',()=>window.__TAURI__.invoke('close_pin',{{id:'{id}'}}))</script>
</body></html>"#, id = id, data_url = data_url);

  let tmp = std::env::temp_dir().join(format!("qrtext_pin_{}.html", id));
  std::fs::write(&tmp, &html).map_err(|e| format!("{e}"))?;
  let url = format!("file://{}", tmp.to_string_lossy());

  tauri::WebviewWindowBuilder::new(&app, &id, tauri::WebviewUrl::External(url.parse().map_err(|e| format!("{e}"))?))
    .title("截图")
    .inner_size(420.0, 320.0)
    .min_inner_size(120.0, 80.0)
    .resizable(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .build()
    .map_err(|e| format!("{e}"))?;

  Ok(())
}

#[tauri::command]
fn close_pin(app: tauri::AppHandle, id: String) {
  if let Some(win) = app.get_webview_window(&id) {
    let _ = win.close();
  }
}

/// 调用系统截图工具框选区域，返回 base64 图片数据
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
    let mut ok = false;

    // 按优先级尝试各种截图工具（含国产系统常见工具）
    // 每个元素: (命令, 参数列表, 输出文件参数位置)
    let tools: &[(&str, &[&str])] = &[
      // 麒麟/优麒麟系统截图
      ("ukui-screenshot",       &["-a", "-s"]),
      ("kylin-screenshot",      &["-a"]),
      // GNOME 系
      ("gnome-screenshot",      &["-a", "-f"]),
      // KDE
      ("spectacle",             &["-b", "-n", "-o"]),
      // 通用截图工具
      ("xfce4-screenshooter",   &["-r", "-s"]),
      ("deepin-screenshot",     &["-r", "-s"]),
      ("flameshot",             &["gui", "-r"]),
      // ImageMagick
      ("import",                &[]),
      // 轻量截图
      ("maim",                  &["-s"]),
      ("scrot",                 &["-s"]),
    ];

    for (tool, args) in tools {
      let mut cmd = Command::new(tool);
      cmd.args(*args);
      // 大多数工具需要把路径作为最后一个参数
      if *tool == "import" {
        cmd.arg(&path);
      } else if *tool == "flameshot" {
        cmd.arg("-p").arg(&path);
      } else if *tool == "ukui-screenshot" {
        cmd.arg("-o").arg(&path);
      } else {
        cmd.arg(&path);
      }
      match cmd.status() {
        Ok(status) if status.success() => {
          ok = true;
          // 给截图工具一点时间写入文件
          std::thread::sleep(std::time::Duration::from_millis(500));
          break;
        }
        Ok(_) => continue, // 工具存在但用户取消了
        Err(_) => continue, // 工具不存在
      }
    }

    if !ok {
      return Err(
        "未找到截图工具。请安装以下任一工具：\n\
         flameshot、gnome-screenshot、spectacle、maim、scrot、import (ImageMagick)".into()
      );
    }
  }

  #[cfg(target_os = "windows")]
  {
    Command::new("cmd")
      .args(["/c", "start", "/wait", "ms-screenclip:"])
      .status()
      .map_err(|_| "无法启动截图工具".to_string())?;
    let ps = r#"Add-Type -AssemblyName System.Windows.Forms;if([Windows.Forms.Clipboard]::ContainsImage()){[Windows.Forms.Clipboard]::GetImage().Save($env:TEMP+'\qrtext_screenshot.png','Png')}"#;
    Command::new("powershell").args(["-Command", ps]).output().ok();
  }

  // 读取并返回 base64
  let bytes = std::fs::read(&path).map_err(|_| "截图文件未生成，请重试".to_string())?;
  Ok(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes)))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![take_screenshot, pin_screenshot, close_pin])
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
