use std::process::Command;
use std::time::Duration;

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
    // 依次尝试 Linux 截图工具（-c 表示复制到剪贴板）
    let tools: &[(&str, &[&str])] = &[
      ("gnome-screenshot", &["-a", "-c"]),
      ("spectacle", &["-b", "-n", "-c"]),
      ("xfce4-screenshooter", &["-r", "-c"]),
      ("grim", &["-g", "-"]),  // wlroots: grim -g "$(slurp -d)" -
      ("ksnip", &["-r"]),      // 需要 -s 保存到文件
    ];

    for (tool, args) in tools {
      if let Ok(status) = Command::new(tool).args(*args).status() {
        if status.success() {
          std::thread::sleep(Duration::from_millis(500));
          return Ok("ok".into());
        }
      }
    }

    // 回退：如果都不行，尝试用 import + xclip
    let path = std::env::temp_dir().join("qrtext_screenshot.png");
    let import_ok = Command::new("import")
      .arg(&path)
      .status()
      .map(|s| s.success())
      .unwrap_or(false);

    if import_ok {
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
    // 使用 PowerShell 调用 Win+Shift+S 截图快捷键
    // 或者启动截图工具并等待
    let script = r#"
Add-Type -AssemblyName System.Windows.Forms
# 模拟 Win+Shift+S
[System.Windows.Forms.SendKeys]::SendWait("^+{S}")
"#;

    // 更可靠的方式：直接调用 Windows 截图 API
    // 使用 ms-screenclip: URI 启动截图工具
    let status = Command::new("cmd")
      .args(["/c", "start", "ms-screenclip:"])
      .status();

    if status.is_err() {
      return Err("无法启动截图工具，请使用 Win+Shift+S 截图后粘贴".into());
    }

    // 等待用户完成截图并写入剪贴板
    std::thread::sleep(Duration::from_millis(500));
  }

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
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
