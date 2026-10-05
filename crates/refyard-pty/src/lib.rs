//! Headless pty sessions: spawn a shell in an approved directory and shuttle bytes.
//!
//! This crate is deliberately dumb about products. It knows nothing about Tauri,
//! HTTP or Git: a caller hands it a directory it has already approved, a grid
//! size, and a sink for events; it runs the machine's own login shell there and
//! forwards raw bytes in and out until the shell exits. Everything policy-shaped
//! — which directories may be opened, who may drive a session, how frames reach
//! a UI — stays with the host that calls this crate.
//!
//! One thread pair per session, like every serious terminal: a reader copying
//! the master's bytes to the sink, and a waiter reaping the child so no zombie is
//! left behind and the exit code reaches the sink exactly once. `close` kills the
//! child and detaches both; a caller that drops everything without closing is
//! still safe, because the waiter owns the reaping.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};

/// What one session tells its host: shell bytes out, or the shell's end.
#[derive(Debug, Clone)]
pub enum PtyEvent {
    Output(Vec<u8>),
    /// The exit code, or `None` when the host ended the session or the code is
    /// not observable — never a fabricated zero.
    Exit(Option<i32>),
}

/// The sink one session streams to, tagged with the session id: events can
/// start before `open` returns, so the caller learns which session produced
/// them from the argument instead of from closure state it cannot have yet.
pub type PtySink = Arc<dyn Fn(u32, PtyEvent) + Send + Sync>;

/// The per-session sink the reader and waiter hold: the id is already attached.
type TaggedSink = Arc<dyn Fn(PtyEvent) + Send + Sync>;

#[derive(Debug)]
pub struct PtyError(pub String);

impl std::fmt::Display for PtyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for PtyError {}

/// What a new session runs. The caller has already approved `cwd`; the shell is
/// this machine's own login shell unless the caller pins one.
pub struct PtyOpenRequest {
    pub cwd: PathBuf,
    pub cols: u16,
    pub rows: u16,
    pub shell: Option<String>,
}

/// One live session's handles, kept so `write`/`resize`/`close` reach the pty
/// after `open` returns.
struct Session {
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    killer: Mutex<Option<Box<dyn ChildKiller + Send + Sync>>>,
    /// Set before a close kills the child, so the waiter knows the exit is the
    /// host's doing and reports it as `None` rather than a contrived code.
    closed_by_host: AtomicBool,
    exited: AtomicBool,
}

impl Session {
    fn dead(&self) -> bool {
        self.exited.load(Ordering::Acquire)
    }
}

/// The registry of live sessions. Ids are minted here, start at 1, and are never
/// reused — 0 reads as "unset" to a client that has not opened anything yet.
#[derive(Default)]
pub struct PtyRegistry {
    /// Shared with the waiter threads so a reaped child removes its own record
    /// without a reference back to the whole registry.
    sessions: Arc<Mutex<HashMap<u32, Arc<Session>>>>,
    next_id: AtomicU32,
}

impl PtyRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Spawns the shell and starts the reader and waiter threads. The sink is
    /// owned by the session from here on; dropping the registry or closing the
    /// session stops the events.
    pub fn open(&self, request: PtyOpenRequest, sink: PtySink) -> Result<u32, PtyError> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        // Every event this session produces is tagged here, once, so neither the
        // reader nor the waiter needs to know its own id.
        let tagged: TaggedSink = {
            let sink = Arc::clone(&sink);
            Arc::new(move |event| sink(id, event))
        };
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: request.rows,
                cols: request.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| PtyError(format!("openpty failed: {error}")))?;
        let shell = request.shell.unwrap_or_else(default_shell);
        let mut command = CommandBuilder::new(&shell);
        if cfg!(unix) {
            // A login shell sources the profile the person already maintains:
            // their PATH, aliases and prompt, which is the point of a terminal
            // beside a workbench.
            command.arg("-l");
        } else {
            command.arg("-NoLogo");
        }
        command.cwd(&request.cwd);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| PtyError(format!("spawn {shell} failed: {error}")))?;
        let mut child = child;
        // The slave's copy is only for spawning; holding it open would keep the
        // master readable forever after the shell exits.
        drop(pair.slave);

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| PtyError(format!("pty reader failed: {error}")))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| PtyError(format!("pty writer failed: {error}")))?;

        let session = Arc::new(Session {
            writer: Mutex::new(Some(writer)),
            master: Mutex::new(Some(pair.master)),
            killer: Mutex::new(Some(child.clone_killer())),
            closed_by_host: AtomicBool::new(false),
            exited: AtomicBool::new(false),
        });

        // The reader ends when the master reaches EOF (the shell, and every
        // descendant holding the slave, is gone) or errors; either way the
        // waiter owns the exit story, so the reader just stops.
        let reader_sink = Arc::clone(&tagged);
        std::thread::Builder::new()
            .name(format!("refyard-pty-reader-{id}"))
            .spawn(move || reader_loop(reader, reader_sink))
            .map_err(|error| PtyError(format!("reader thread failed: {error}")))?;

        // Reaping belongs to this thread: a child nobody waits for is a zombie
        // for the rest of the process's life.
        let waiter_session = Arc::clone(&session);
        let waiter_sink = Arc::clone(&tagged);
        let sessions = self.inner_sessions();
        std::thread::Builder::new()
            .name(format!("refyard-pty-waiter-{id}"))
            .spawn(move || {
                let code = child
                    .wait()
                    .ok()
                    .map(|status| status.exit_code() as i32);
                waiter_session.exited.store(true, Ordering::Release);
                let killed_by_host =
                    waiter_session.closed_by_host.load(Ordering::Acquire);
                waiter_sink(PtyEvent::Exit(if killed_by_host { None } else { code }));
                sessions.lock().expect("pty registry poisoned").remove(&id);
            })
            .map_err(|error| PtyError(format!("waiter thread failed: {error}")))?;

        self.sessions
            .lock()
            .expect("pty registry poisoned")
            .insert(id, session);
        Ok(id)
    }

    /// Bytes typed by the emulator. A write to a session that already exited is
    /// quietly dropped — the exit event is the truth the caller acts on.
    pub fn write(&self, id: u32, bytes: &[u8]) -> Result<(), PtyError> {
        let session = self.live(id)?;
        let mut guard = session
            .writer
            .lock()
            .expect("pty writer poisoned");
        if let Some(writer) = guard.as_mut() {
            writer
                .write_all(bytes)
                .map_err(|error| PtyError(format!("pty write failed: {error}")))?;
        }
        Ok(())
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), PtyError> {
        let session = self.live(id)?;
        let guard = session.master.lock().expect("pty master poisoned");
        if let Some(master) = guard.as_ref() {
            master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|error| PtyError(format!("pty resize failed: {error}")))?;
        }
        Ok(())
    }

    /// Kills the shell and forgets the session. Idempotent; returns whether a
    /// live session was ended.
    pub fn close(&self, id: u32) -> bool {
        let session = {
            let mut sessions = self.sessions.lock().expect("pty registry poisoned");
            sessions.remove(&id)
        };
        let Some(session) = session else {
            return false;
        };
        if session.dead() {
            return false;
        }
        session.closed_by_host.store(true, Ordering::Release);
        if let Some(killer) = session.killer.lock().expect("pty killer poisoned").as_mut() {
            let _ = killer.kill();
        }
        true
    }

    /// Whether a live (not yet reaped) session with this id exists. Hosts use it
    /// to sweep their own per-session records.
    pub fn is_live(&self, id: u32) -> bool {
        self.sessions
            .lock()
            .expect("pty registry poisoned")
            .contains_key(&id)
    }

    /// Kills and forgets every live session: what a host shutdown owes its shells.
    pub fn close_all(&self) {
        let ids: Vec<u32> = {
            let sessions = self.sessions.lock().expect("pty registry poisoned");
            sessions.keys().copied().collect()
        };
        for id in ids {
            self.close(id);
        }
    }

    /// The name a new session's shell reports, resolved the way this machine
    /// resolves it. The same rule `default_shell` applies at spawn time.
    pub fn default_shell_name(&self) -> String {
        basename(&default_shell())
    }

    fn live(&self, id: u32) -> Result<Arc<Session>, PtyError> {
        let sessions = self.sessions.lock().expect("pty registry poisoned");
        sessions
            .get(&id)
            .cloned()
            .ok_or_else(|| PtyError(format!("no such pty session {id}")))
    }

    /// The map shared with the waiter threads, so a reaped child removes itself
    /// without a reference back to the whole registry.
    fn inner_sessions(&self) -> Arc<Mutex<HashMap<u32, Arc<Session>>>> {
        Arc::clone(&self.sessions)
    }
}

fn reader_loop(mut reader: Box<dyn Read + Send>, sink: TaggedSink) {
    let mut buffer = vec![0u8; 16 * 1024];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) | Err(_) => return,
            Ok(read) => sink(PtyEvent::Output(buffer[..read].to_vec())),
        }
    }
}

/// This machine's login shell. The passwd entry first — a GUI process on macOS
/// often has no `$SHELL` in its environment, and the passwd entry is where the
/// login shell actually lives — then `$SHELL`, then a platform default.
fn default_shell() -> String {
    #[cfg(unix)]
    {
        if let Some(passwd_shell) = passwd_shell() {
            return passwd_shell;
        }
        if let Ok(from_environment) = std::env::var("SHELL") {
            if from_environment.starts_with('/') {
                return from_environment;
            }
        }
        if cfg!(target_os = "macos") {
            "/bin/zsh".to_string()
        } else {
            "/bin/bash".to_string()
        }
    }
    #[cfg(windows)]
    {
        std::env::var("ComSpec").unwrap_or_else(|_| "powershell.exe".to_string())
    }
}

#[cfg(unix)]
fn passwd_shell() -> Option<String> {
    // SAFETY: `getuid` takes no pointers and `getpwuid` returns a pointer into
    // thread-local storage that is valid until the next call on this thread;
    // the string is copied out before anything else can call it.
    unsafe {
        let uid = libc::getuid();
        let entry = libc::getpwuid(uid);
        if entry.is_null() || (*entry).pw_shell.is_null() {
            return None;
        }
        let shell = std::ffi::CStr::from_ptr((*entry).pw_shell)
            .to_string_lossy()
            .into_owned();
        if shell.is_empty() {
            None
        } else {
            Some(shell)
        }
    }
}

fn basename(path: &str) -> String {
    path.rsplit(['/', '\\']).next().unwrap_or(path).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn collect() -> (PtySink, mpsc::Receiver<(u32, PtyEvent)>) {
        let (sender, receiver) = mpsc::channel();
        let sink: PtySink = Arc::new(move |id, event| {
            let _ = sender.send((id, event));
        });
        (sink, receiver)
    }

    #[cfg(unix)]
    fn echo_session(
        dir: &std::path::Path,
    ) -> (PtyRegistry, u32, mpsc::Receiver<(u32, PtyEvent)>) {
        let registry = PtyRegistry::new();
        let (sink, receiver) = collect();
        let id = registry
            .open(
                PtyOpenRequest {
                    cwd: dir.to_path_buf(),
                    cols: 80,
                    rows: 24,
                    shell: Some("/bin/sh".to_string()),
                },
                sink,
            )
            .expect("a plain sh spawns in a temp dir");
        (registry, id, receiver)
    }

    #[cfg(unix)]
    fn drain_output(receiver: &mpsc::Receiver<(u32, PtyEvent)>, id: u32, wanted: &[u8]) -> String {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        let mut collected = Vec::new();
        while std::time::Instant::now() < deadline {
            if let Ok((got, PtyEvent::Output(bytes))) =
                receiver.recv_timeout(std::time::Duration::from_millis(250))
            {
                assert_eq!(got, id, "every event names its own session");
                collected.extend_from_slice(&bytes);
                if collected.windows(wanted.len()).any(|window| window == wanted) {
                    break;
                }
            }
        }
        String::from_utf8_lossy(&collected).into_owned()
    }

    #[test]
    fn the_default_shell_reports_a_bare_name() {
        assert!(!PtyRegistry::new().default_shell_name().is_empty());
        assert!(!default_shell().contains('\\'));
    }

    #[cfg(unix)]
    #[test]
    fn a_session_runs_a_shell_and_reports_a_real_exit() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (registry, id, receiver) = echo_session(dir.path());
        registry.write(id, b"echo pty_ok\n").expect("write reaches the shell");
        let output = drain_output(&receiver, id, b"pty_ok");
        assert!(output.contains("pty_ok"), "the shell never echoed: {output}");

        registry.write(id, b"exit 3\n").expect("write reaches the shell");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            assert!(std::time::Instant::now() < deadline, "no exit event arrived");
            match receiver.recv_timeout(std::time::Duration::from_millis(250)) {
                Ok((got, PtyEvent::Exit(code))) => {
                    assert_eq!(got, id);
                    assert_eq!(code, Some(3), "the shell's own exit code must survive");
                    break;
                }
                Ok((_, PtyEvent::Output(_))) => continue,
                Err(_) => continue,
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn close_kills_the_session_and_reports_it_ended_by_the_host() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (registry, id, receiver) = echo_session(dir.path());
        assert!(registry.close(id), "closing a live session ends it");
        assert!(!registry.close(id), "closing again is a no-op");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            assert!(std::time::Instant::now() < deadline, "no exit event arrived");
            match receiver.recv_timeout(std::time::Duration::from_millis(250)) {
                Ok((got, PtyEvent::Exit(code))) => {
                    assert_eq!(got, id);
                    assert_eq!(code, None, "a host kill is not an observed exit code");
                    break;
                }
                Ok((_, PtyEvent::Output(_))) => continue,
                Err(_) => continue,
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn writes_and_resizes_to_an_exited_session_are_refused_quietly() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (registry, id, receiver) = echo_session(dir.path());
        registry.write(id, b"exit\n").expect("write reaches the shell");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            assert!(std::time::Instant::now() < deadline, "no exit event arrived");
            if let Ok((_, PtyEvent::Exit(_))) =
                receiver.recv_timeout(std::time::Duration::from_millis(250))
            {
                break;
            }
        }
        // The session record is gone once reaped, and every handle answers the
        // same truth instead of pretending the shell is still there.
        assert!(matches!(registry.write(id, b"hi\n"), Err(_)));
        assert!(matches!(registry.resize(id, 100, 30), Err(_)));
    }
}
