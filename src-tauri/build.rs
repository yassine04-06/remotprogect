fn main() {
    tauri_build::build();

    // Pre-compile the RDP helper on Windows builds so it's ready at runtime
    // without requiring csc.exe or the .cs source on the end-user machine.
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "windows" {
        compile_rdp_helper();
    }
}

fn compile_rdp_helper() {
    let manifest_dir =
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set by Cargo");

    let source = std::path::PathBuf::from(&manifest_dir)
        .join("helpers")
        .join("RdpEmbed.cs");
    let output = std::path::PathBuf::from(&manifest_dir)
        .join("helpers")
        .join("RdpEmbed.exe");

    // Rerun this build script only when the C# source changes
    println!("cargo:rerun-if-changed={}", source.display());

    if !source.exists() {
        println!(
            "cargo:warning=RdpEmbed.cs not found at {}. RDP embedding will not be pre-compiled.",
            source.display()
        );
        return;
    }

    // Skip recompilation if the exe is already newer than the source AND not a 0-byte placeholder.
    // A 0-byte file means a previous build failed (or the file is a git-checked-in placeholder)
    // — in either case we MUST attempt the compile again.
    if output.exists() {
        let out_size = output.metadata().map(|m| m.len()).unwrap_or(0);
        let src_modified = source.metadata().and_then(|m| m.modified()).ok();
        let out_modified = output.metadata().and_then(|m| m.modified()).ok();
        if out_size > 0 {
            if let (Some(src), Some(out)) = (src_modified, out_modified) {
                if out >= src {
                    return; // Already up to date
                }
            }
        } else {
            println!("cargo:warning=RdpEmbed.exe is 0 bytes — forcing recompile.");
        }
    }

    let csc_candidates = [
        r"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
        r"C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe",
    ];

    let csc = csc_candidates
        .iter()
        .find(|p| std::path::Path::new(p).exists())
        .copied();

    let csc = match csc {
        Some(c) => c,
        None => {
            println!("cargo:warning=.NET Framework csc.exe not found.");
            println!("cargo:warning=Install .NET Framework 4.x to enable RDP embedding.");
            println!("cargo:warning=RDP embedding will fall back to runtime compilation.");
            return;
        }
    };

    let status = std::process::Command::new(csc)
        .arg("/target:winexe")
        .arg("/optimize+")
        .arg(format!("/out:{}", output.display()))
        .arg("/reference:System.dll")
        .arg("/reference:System.Windows.Forms.dll")
        .arg("/reference:System.Drawing.dll")
        .arg(source.display().to_string())
        .status();

    match status {
        Ok(s) if s.success() => {
            println!("cargo:warning=RdpEmbed.exe compiled successfully.");
        }
        Ok(s) => {
            println!(
                "cargo:warning=RdpEmbed.cs compilation failed (exit code: {}). RDP embedding will fall back to runtime compilation.",
                s
            );
        }
        Err(e) => {
            println!(
                "cargo:warning=Failed to invoke csc.exe: {}. RDP embedding will fall back to runtime compilation.",
                e
            );
        }
    }
}
