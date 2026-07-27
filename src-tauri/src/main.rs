// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  // ═══ Windows 7 兼容性检查 ═══
  #[cfg(target_os = "windows")]
  {
    use std::mem;
    unsafe {
      // 使用 RtlGetVersion 获取真实版本（不受兼容模式影响）
      extern "system" {
        fn RtlGetVersion(info: *mut OSVERSIONINFOW) -> i32;
      }

      #[repr(C)]
      struct OSVERSIONINFOW {
        dw_os_version_info_size: u32,
        dw_major_version: u32,
        dw_minor_version: u32,
        dw_build_number: u32,
        dw_platform_id: u32,
        sz_csd_version: [u16; 128],
      }

      let mut ver = OSVERSIONINFOW {
        dw_os_version_info_size: mem::size_of::<OSVERSIONINFOW>() as u32,
        dw_major_version: 0,
        dw_minor_version: 0,
        dw_build_number: 0,
        dw_platform_id: 0,
        sz_csd_version: [0; 128],
      };

      if RtlGetVersion(&mut ver) == 0 {
        let win_ver = (ver.dw_major_version, ver.dw_minor_version, ver.dw_build_number);
        // Windows 10 = 10.0, Windows 8.1 = 6.3, Windows 8 = 6.2, Windows 7 = 6.1
        if win_ver.0 < 10 {
          extern "system" {
            fn MessageBoxW(hwnd: isize, text: *const u16, caption: *const u16, utype: u32) -> i32;
          }
          let caption: Vec<u16> = "QRTEXT - 系统不支持\0".encode_utf16().collect();
          let msg = format!(
            "当前系统：Windows {}.{} (Build {})\n\n\
             QRTEXT 需要 Windows 10 版本 1803 或更高版本。\n\
             Windows 7 / 8 / 8.1 不支持 WebView2 运行时，\n\
             无法运行此程序。\n\n\
             建议升级到 Windows 10 或更高版本。",
            win_ver.0, win_ver.1, win_ver.2
          );
          let text: Vec<u16> = msg.encode_utf16().collect();
          MessageBoxW(0, text.as_ptr(), caption.as_ptr(), 0x30); // MB_ICONERROR
          std::process::exit(1);
        }
      }
    }
  }

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
