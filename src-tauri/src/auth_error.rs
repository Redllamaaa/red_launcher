use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "detail")]
pub enum AuthError {
    /// Network-level failure (DNS, timeout, connection reset, etc.)
    Network(String),

    /// Non-2xx HTTP response we couldn't otherwise classify
    Http {
        status: u16,
        body: String,
    },

    /// Response body didn't parse as expected JSON
    Parse(String),

    /// Device-code flow: user declined the sign-in prompt
    Declined,

    /// Device-code flow: code expired before the user finished
    Expired,

    /// Device-code flow: code was malformed/invalid
    InvalidDeviceCode,

    /// No refresh_token in a response that should have had one
    NoRefreshToken,

    /// Xbox Live returned no user hash
    NoUserHash,

    /// Account authenticated but does not own Minecraft
    NotEntitled,

    /// Keyring read/write/delete failure
    Keyring(String),

    /// Catch-all for anything not worth a dedicated variant yet
    Other(String),
}

impl std::fmt::Display for AuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self)
    }
}

impl std::error::Error for AuthError {}

impl From<reqwest::Error> for AuthError {
    fn from(e: reqwest::Error) -> Self {
        AuthError::Network(e.to_string())
    }
}
