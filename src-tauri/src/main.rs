// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  // ── 崩溃记录：将 panic 信息写入文件，方便排查 ──
  std::panic::set_hook(Box::new(|info| {
    let location = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
    let msg = if let Some(s) = info.payload().downcast_ref::<&str>() {
      s.to_string()
    } else if let Some(s) = info.payload().downcast_ref::<String>() {
      s.clone()
    } else {
      "unknown panic".to_string()
    };
    let full_msg = format!("QRTEXT PANIC [{location}]: {msg}");

    // 写入文件
    let path = std::env::temp_dir().join("qrtext_crash.log");
    let _ = std::fs::write(&path, &full_msg);

    // Windows: 弹窗显示错误（release 模式下无控制台）
    #[cfg(target_os = "windows")]
    {
      let caption: Vec<u16> = "QRTEXT 错误\0".encode_utf16().collect();
      let text: Vec<u16> = full_msg.encode_utf16().collect();
      unsafe {
        extern "system" {
          fn MessageBoxW(hwnd: isize, text: *const u16, caption: *const u16, utype: u32) -> i32;
        }
        MessageBoxW(0, text.as_ptr(), caption.as_ptr(), 0x30); // MB_ICONERROR | MB_OK
      }
    }

    eprintln!("{full_msg}");
  }));

  qrtext_lib::run();
}
