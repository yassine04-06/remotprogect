use serde::Serialize;
use ssh2::Session;
use std::net::TcpStream;
use std::path::Path;
use suppaftp::FtpStream;
use std::io::{Read, Write};

#[derive(Serialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_at: Option<u64>,
}

#[derive(Serialize)]
pub struct FileListResult {
    pub files: Vec<FileNode>,
    pub current_path: String,
}

// ==========================================
// SFTP Implementation (using ssh2)
// ==========================================

fn connect_ssh2(host: &str, port: i32, username: &str, password: Option<&str>, private_key_path: Option<&str>) -> Result<Session, String> {
    let tcp = TcpStream::connect(format!("{}:{}", host, port)).map_err(|e| format!("TCP connect error: {}", e))?;
    let mut sess = Session::new().map_err(|e| format!("Failed to create ssh session: {}", e))?;
    sess.set_tcp_stream(tcp);
    sess.handshake().map_err(|e| format!("SSH handshake failed: {}", e))?;

    if let Some(key) = private_key_path {
        if !key.is_empty() {
            sess.userauth_pubkey_file(username, None, Path::new(key), password)
                .map_err(|e| format!("Pubkey auth failed: {}", e))?;
            return Ok(sess);
        }
    }

    if let Some(pass) = password {
        sess.userauth_password(username, pass)
            .map_err(|e| format!("Password auth failed: {}", e))?;
    } else {
        return Err("No authentication method provided".into());
    }

    if !sess.authenticated() {
        return Err("Authentication failed".into());
    }
    
    Ok(sess)
}

#[tauri::command]
pub fn sftp_list_dir(
    host: String,
    port: i32,
    username: String,
    password: Option<String>,
    private_key_path: Option<String>,
    path: String,
) -> Result<FileListResult, String> {
    let sess = connect_ssh2(&host, port, &username, password.as_deref(), private_key_path.as_deref())?;
    let sftp = sess.sftp().map_err(|e| format!("SFTP subsystem error: {}", e))?;

    let stat = sftp.stat(Path::new(&path)).map_err(|e| format!("Failed to stat path: {}", e))?;
    if !stat.is_dir() {
        return Err("Path is not a directory".into());
    }

    let files = sftp.readdir(Path::new(&path)).map_err(|e| format!("Failed to read dir: {}", e))?;
    let mut nodes = Vec::new();

    for (file_path, stat) in files {
        let name = file_path.file_name().unwrap_or_default().to_string_lossy().to_string();
        if name == "." || name == ".." {
            continue;
        }

        nodes.push(FileNode {
            name,
            path: file_path.to_string_lossy().to_string().replace("\\", "/"),
            is_dir: stat.is_dir(),
            size: stat.size.unwrap_or(0),
            modified_at: stat.mtime,
        });
    }

    // Sort: directories first, then alphabetical
    nodes.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(FileListResult {
        files: nodes,
        current_path: path.trim_end_matches('/').to_string(),
    })
}

#[tauri::command]
pub fn sftp_upload(
    host: String,
    port: i32,
    username: String,
    password: Option<String>,
    private_key_path: Option<String>,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    let sess = connect_ssh2(&host, port, &username, password.as_deref(), private_key_path.as_deref())?;
    let sftp = sess.sftp().map_err(|e| format!("SFTP subsystem error: {}", e))?;

    let mut local_file = std::fs::File::open(&local_path).map_err(|e| format!("Failed to open local file: {}", e))?;
    let mut remote_file = sftp.create(Path::new(&remote_path)).map_err(|e| format!("Failed to create remote file: {}", e))?;

    let mut buffer = [0; 65536]; // 64KB chunks
    loop {
        let n = local_file.read(&mut buffer).map_err(|e| format!("Read error: {}", e))?;
        if n == 0 {
            break;
        }
        remote_file.write_all(&buffer[..n]).map_err(|e| format!("Write error: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn sftp_download(
    host: String,
    port: i32,
    username: String,
    password: Option<String>,
    private_key_path: Option<String>,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    let sess = connect_ssh2(&host, port, &username, password.as_deref(), private_key_path.as_deref())?;
    let sftp = sess.sftp().map_err(|e| format!("SFTP subsystem error: {}", e))?;

    let mut remote_file = sftp.open(Path::new(&remote_path)).map_err(|e| format!("Failed to open remote file: {}", e))?;
    let mut local_file = std::fs::File::create(&local_path).map_err(|e| format!("Failed to create local file: {}", e))?;

    let mut buffer = [0; 65536];
    loop {
        let n = remote_file.read(&mut buffer).map_err(|e| format!("Read error: {}", e))?;
        if n == 0 {
            break;
        }
        local_file.write_all(&buffer[..n]).map_err(|e| format!("Write error: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn sftp_delete(
    host: String,
    port: i32,
    username: String,
    password: Option<String>,
    private_key_path: Option<String>,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    let sess = connect_ssh2(&host, port, &username, password.as_deref(), private_key_path.as_deref())?;
    let sftp = sess.sftp().map_err(|e| format!("SFTP subsystem error: {}", e))?;

    if is_dir {
        sftp.rmdir(Path::new(&path)).map_err(|e| format!("Failed to remove directory: {}", e))?;
    } else {
        sftp.unlink(Path::new(&path)).map_err(|e| format!("Failed to remove file: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn sftp_rename(
    host: String,
    port: i32,
    username: String,
    password: Option<String>,
    private_key_path: Option<String>,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let sess = connect_ssh2(&host, port, &username, password.as_deref(), private_key_path.as_deref())?;
    let sftp = sess.sftp().map_err(|e| format!("SFTP subsystem error: {}", e))?;

    sftp.rename(Path::new(&old_path), Path::new(&new_path), None).map_err(|e| format!("Failed to rename: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn sftp_mkdir(
    host: String,
    port: i32,
    username: String,
    password: Option<String>,
    private_key_path: Option<String>,
    path: String,
) -> Result<(), String> {
    let sess = connect_ssh2(&host, port, &username, password.as_deref(), private_key_path.as_deref())?;
    let sftp = sess.sftp().map_err(|e| format!("SFTP subsystem error: {}", e))?;

    sftp.mkdir(Path::new(&path), 0o755).map_err(|e| format!("Failed to create directory: {}", e))?;
    Ok(())
}


// ==========================================
// FTP Implementation (using suppaftp)
// ==========================================

fn connect_ftp(host: &str, port: i32, username: &str, password: Option<&str>) -> Result<FtpStream, String> {
    let addr = format!("{}:{}", host, port);
    let mut ftp_stream = FtpStream::connect(addr).map_err(|e| format!("FTP connect error: {}", e))?;
    
    // We try to login, pass empty string if no pass
    let pass = password.unwrap_or("");
    ftp_stream.login(username, pass).map_err(|e| format!("FTP login failed: {}", e))?;
    
    Ok(ftp_stream)
}

fn parse_ftp_list_line(line: &str, base_path: &str) -> Option<FileNode> {
    // A quick, highly naive UNIX `ls -l` parser. 
    // Example: drwxr-xr-x    2 user     group        4096 Feb 25 15:00 FolderName
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 9 {
        return None;
    }
    
    let perms = parts[0];
    let is_dir = perms.starts_with('d');
    let size = parts[4].parse::<u64>().unwrap_or(0);
    
    // The filename might contain spaces, so we combine everything from index 8 onwards
    let name = parts[8..].join(" ");
    if name == "." || name == ".." {
        return None;
    }

    let full_path = if base_path == "/" || base_path.is_empty() {
        format!("/{}", name)
    } else {
        format!("{}/{}", base_path.trim_end_matches('/'), name)
    };

    Some(FileNode {
        name,
        path: full_path,
        is_dir,
        size,
        modified_at: None, // Missing simple parsing for timestamp in this MVP
    })
}

#[tauri::command]
pub fn ftp_list_dir(
    host: String,
    port: i32,
    username: String,
    password: Option<String>,
    path: String,
) -> Result<FileListResult, String> {
    let mut ftp = connect_ftp(&host, port, &username, password.as_deref())?;
    
    let safe_path = if path.is_empty() { "/" } else { &path };
    ftp.cwd(safe_path).map_err(|e| format!("CWD failed: {}", e))?;

    // Most FTP servers return `ls -l` format for LIST
    let list_data = ftp.list(None).map_err(|e| format!("LIST failed: {}", e))?;
    let mut nodes = Vec::new();

    for line in list_data {
        if let Some(node) = parse_ftp_list_line(&line, safe_path) {
            nodes.push(node);
        }
    }

    nodes.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    ftp.quit().ok();

    Ok(FileListResult {
        files: nodes,
        current_path: safe_path.to_string(),
    })
}

#[tauri::command]
pub fn ftp_upload(
    host: String,
    port: i32,
    username: String,
    password: Option<String>,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    let mut ftp = connect_ftp(&host, port, &username, password.as_deref())?;
    let mut local_file = std::fs::File::open(&local_path).map_err(|e| format!("Failed to open local file: {}", e))?;
    
    ftp.put_file(&remote_path, &mut local_file).map_err(|e| format!("Failed to upload file: {}", e))?;
    ftp.quit().ok();
    Ok(())
}

#[tauri::command]
pub fn ftp_download(
    host: String,
    port: i32,
    username: String,
    password: Option<String>,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    let mut ftp = connect_ftp(&host, port, &username, password.as_deref())?;
    let mut local_file = std::fs::File::create(&local_path).map_err(|e| format!("Failed to create local file: {}", e))?;
    
    let mut stream = ftp.retr_as_stream(&remote_path).map_err(|e| format!("Failed to open remote file: {}", e))?;
    
    let mut buffer = [0; 65536];
    loop {
        let n = stream.read(&mut buffer).map_err(|e| format!("Read error: {}", e))?;
        if n == 0 {
            break;
        }
        local_file.write_all(&buffer[..n]).map_err(|e| format!("Write error: {}", e))?;
    }
    
    ftp.finalize_retr_stream(stream).map_err(|e| format!("Failed to finalize transfer: {}", e))?;
    ftp.quit().ok();
    Ok(())
}

#[tauri::command]
pub fn ftp_delete(
    host: String,
    port: i32,
    username: String,
    password: Option<String>,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    let mut ftp = connect_ftp(&host, port, &username, password.as_deref())?;
    
    if is_dir {
        ftp.rmdir(&path).map_err(|e| format!("Failed to remove directory: {}", e))?;
    } else {
        ftp.rm(&path).map_err(|e| format!("Failed to remove file: {}", e))?;
    }
    
    ftp.quit().ok();
    Ok(())
}

#[tauri::command]
pub fn ftp_rename(
    host: String,
    port: i32,
    username: String,
    password: Option<String>,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let mut ftp = connect_ftp(&host, port, &username, password.as_deref())?;
    ftp.rename(&old_path, &new_path).map_err(|e| format!("Failed to rename: {}", e))?;
    ftp.quit().ok();
    Ok(())
}

#[tauri::command]
pub fn ftp_mkdir(
    host: String,
    port: i32,
    username: String,
    password: Option<String>,
    path: String,
) -> Result<(), String> {
    let mut ftp = connect_ftp(&host, port, &username, password.as_deref())?;
    ftp.mkdir(&path).map_err(|e| format!("Failed to create dir: {}", e))?;
    ftp.quit().ok();
    Ok(())
}
