//! What is kept of what the engine says, as the web client's developer
//! settings name it (`logLevel`, `logToFile`, `autoZipLogs`,
//! `terminalLogging`).

use serde::{Deserialize, Serialize};

/// The levels a log can be kept at, least first.
pub(crate) const LOG_LEVELS: [&str; 5] = ["error", "warn", "info", "debug", "trace"];

/// How the log is kept.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct LogChoices {
    /// The level kept; absent for the usual `info`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_level: Option<String>,
    /// Whether a file of the day is written. On here, as this client has
    /// no other place a log is read from.
    #[serde(default = "on", skip_serializing_if = "Clone::clone")]
    pub log_to_file: bool,
    /// Whether files older than a day are compressed.
    #[serde(default = "on", skip_serializing_if = "Clone::clone")]
    pub auto_zip_logs: bool,
    /// Whether a release build writes to the terminal too.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub terminal_logging: bool,
}

const fn on() -> bool {
    true
}

impl Default for LogChoices {
    fn default() -> Self {
        Self {
            log_level: None,
            log_to_file: true,
            auto_zip_logs: true,
            terminal_logging: false,
        }
    }
}

impl LogChoices {
    /// The level in force.
    pub(crate) fn level(&self) -> &str {
        self.log_level.as_deref().unwrap_or("info")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_usual_is_info_to_a_compressed_file_and_the_web_names_are_read() {
        let usual = LogChoices::default();
        assert_eq!(usual.level(), "info");
        assert!(usual.log_to_file && usual.auto_zip_logs && !usual.terminal_logging);
        let read: LogChoices =
            serde_json::from_str(r#"{"log_level":"trace","log_to_file":false}"#).expect("choices");
        assert_eq!((read.level(), read.log_to_file, read.auto_zip_logs), ("trace", false, true));
        assert_eq!(serde_json::to_string(&usual).expect("json"), "{}");
    }
}
