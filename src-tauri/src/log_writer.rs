//! HIGH-A6: PII-scrubbing, size-and-date-rotating log writer.
//!
//! Replaces `tracing_appender::rolling::daily` with a writer that:
//!   1. **Scrubs PII** from every log line — same regex bank as `scrub_sentry_event`
//!      in `lib.rs`: IPv4 addresses, SSH fingerprints, username/hostname fields.
//!   2. **Rotates by SIZE** (10 MiB) in addition to daily rotation, so a burst of
//!      verbose output never creates a single unbounded log file.
//!   3. **Daily rotation**: opens a new file automatically when the calendar day
//!      changes, without any external cron or timer.
//!   4. **Pruning**: keeps at most `MAX_LOG_FILES` (10) rotated files; deletes the
//!      oldest on each rollover.
//!
//! Design note — no renames:
//! Every log file gets its timestamp embedded in the filename at creation time
//! (e.g. `nexorc.2026-05-23_143012.456.log`).  We never rename an open file, which
//! avoids the Windows `FILE_SHARE_DELETE` restriction that makes rename-while-open
//! unreliable on that platform.
//!
//! Thread safety:
//! The writer is handed to `tracing_appender::non_blocking`, which moves it into a
//! dedicated background thread.  From that point only one thread ever calls our
//! `Write` impl, so no internal locking is required.

use chrono::{Datelike, Local};
use regex::Regex;
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};

/// Maximum size of a single log file before it is rotated (10 MiB).
const MAX_LOG_BYTES: u64 = 10 * 1024 * 1024;
/// Maximum number of rotated (archived) log files to keep.
const MAX_LOG_FILES: usize = 10;

// ── Public writer ─────────────────────────────────────────────────────────────

/// A `Write` implementation that scrubs PII and rotates log files.
///
/// Pass this to `tracing_appender::non_blocking(writer)`.
pub struct ScrubRotateWriter {
    file: BufWriter<File>,
    current_size: u64,
    current_day: u32, // day-of-year; triggers daily roll when it changes
    log_dir: PathBuf,
    patterns: Vec<(Regex, &'static str)>,
}

impl ScrubRotateWriter {
    /// Create a writer that appends to (or creates) the appropriate log file
    /// inside `log_dir`.  On startup it reuses the most recent today-file if it
    /// is still under the size limit, otherwise it opens a new one.
    pub fn new(log_dir: &Path) -> io::Result<Self> {
        let today = Local::now().ordinal();
        let (file, size) = Self::open_or_create(log_dir, today)?;
        Ok(Self {
            file: BufWriter::new(file),
            current_size: size,
            current_day: today,
            log_dir: log_dir.to_path_buf(),
            patterns: compile_patterns(),
        })
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /// Open the most recent today-file that still has room, or create a new one.
    fn open_or_create(log_dir: &Path, today_ordinal: u32) -> io::Result<(File, u64)> {
        let today_str = Local::now().format("%Y-%m-%d").to_string();
        let prefix = format!("nexorc.{}", today_str);

        // Walk existing log files, newest-first, and reuse the first one that fits.
        let mut today_files = Self::list_logs(log_dir)
            .into_iter()
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.starts_with(&prefix))
                    .unwrap_or(false)
            })
            .collect::<Vec<_>>();
        today_files.reverse(); // newest name → first

        for path in &today_files {
            if let Ok(meta) = fs::metadata(path) {
                if meta.len() < MAX_LOG_BYTES {
                    let f = OpenOptions::new().append(true).open(path)?;
                    let size = meta.len();
                    return Ok((f, size));
                }
            }
        }

        // No suitable existing file — create a fresh one.
        let _ = today_ordinal; // used by caller to set current_day
        let path = Self::new_log_path(log_dir);
        let f = OpenOptions::new().create(true).append(true).open(&path)?;
        Ok((f, 0))
    }

    /// Build a timestamped path for a new log file.
    /// Using millisecond precision avoids collisions when multiple rotations
    /// happen within the same second (e.g. rapid test suites).
    fn new_log_path(log_dir: &Path) -> PathBuf {
        let ts = Local::now().format("%Y-%m-%d_%H%M%S%.3f");
        log_dir.join(format!("nexorc.{}.log", ts))
    }

    /// List all `nexorc.*.log` files in `log_dir`, sorted lexicographically
    /// (which matches chronological order given the YYYY-MM-DD timestamp prefix).
    fn list_logs(log_dir: &Path) -> Vec<PathBuf> {
        let Ok(entries) = fs::read_dir(log_dir) else {
            return vec![];
        };
        let mut files: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.starts_with("nexorc.") && n.ends_with(".log"))
                    .unwrap_or(false)
            })
            .collect();
        files.sort();
        files
    }

    /// Delete the oldest rotated files so at most `MAX_LOG_FILES` remain.
    fn prune_old_logs(&self) {
        let files = Self::list_logs(&self.log_dir);
        if files.len() > MAX_LOG_FILES {
            for old in files.iter().take(files.len() - MAX_LOG_FILES) {
                let _ = fs::remove_file(old);
            }
        }
    }

    /// Roll to a fresh file.  Called when size > MAX_LOG_BYTES or the day changed.
    fn rotate(&mut self, new_day: u32) -> io::Result<()> {
        self.file.flush()?;
        let path = Self::new_log_path(&self.log_dir);
        let new_file = OpenOptions::new().create(true).append(true).open(&path)?;
        // File may already exist (same-millisecond call); read actual size.
        let size = new_file.metadata().map(|m| m.len()).unwrap_or(0);
        self.file = BufWriter::new(new_file);
        self.current_size = size;
        self.current_day = new_day;
        self.prune_old_logs();
        Ok(())
    }

    /// Apply the PII-scrubbing patterns to a single log line.
    fn scrub<'a>(&self, text: &'a str) -> std::borrow::Cow<'a, str> {
        let mut out = std::borrow::Cow::Borrowed(text);
        for (re, repl) in &self.patterns {
            if re.is_match(&out) {
                out = std::borrow::Cow::Owned(re.replace_all(&out, *repl).into_owned());
            }
        }
        out
    }
}

impl Write for ScrubRotateWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        // ── Rotate if needed (size or day change) ────────────────────────────
        let today = Local::now().ordinal();
        if self.current_size >= MAX_LOG_BYTES || today != self.current_day {
            let _ = self.rotate(today); // best-effort; if rotation fails we keep writing
        }

        // ── Scrub PII ────────────────────────────────────────────────────────
        let text = String::from_utf8_lossy(buf);
        let scrubbed = self.scrub(&text);
        let bytes = scrubbed.as_bytes();

        self.file.write_all(bytes)?;
        self.current_size += bytes.len() as u64;

        // Always report the original length so the caller (non_blocking channel)
        // does not think a short write occurred.
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.file.flush()
    }
}

// ── PII regex bank ────────────────────────────────────────────────────────────

/// Same patterns as `scrub_sentry_event` in `lib.rs`.
/// Compiled once at writer construction and reused for every log line.
fn compile_patterns() -> Vec<(Regex, &'static str)> {
    let raw: &[(&str, &'static str)] = &[
        // IPv4 addresses (e.g. "Connecting to 192.168.1.10")
        (r"\b(?:\d{1,3}\.){3}\d{1,3}\b", "<ip>"),
        // SSH public-key fingerprints ("SHA256:abc…")
        (r"SHA256:[A-Za-z0-9+/=]{43,}", "<fingerprint>"),
        // "username: admin" / "user: root" style fields
        (r"(?i)\buser(?:name)?:\s*\S+", "user:<scrubbed>"),
        // "hostname: myserver" / "host: 10.0.0.1" style fields
        (r"(?i)\bhost(?:name)?:\s*\S+", "host:<scrubbed>"),
    ];
    raw.iter()
        .filter_map(|(pat, repl)| Regex::new(pat).ok().map(|re| (re, *repl)))
        .collect()
}
