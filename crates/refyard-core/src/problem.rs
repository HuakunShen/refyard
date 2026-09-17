//! Why a parse failed.
//!
//! These are deliberately few, and each maps onto a `Problem` code the browser
//! already knows. The distinction that matters in practice is between "Git answered
//! something we do not understand" and "we did not get all of the answer": the first
//! is a parser bug or a newer Git, the second must never be read as a complete result.

use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum CoreError {
    /// The stream ended inside a record, or a promised body was missing.
    #[error("{format}: output ended before the record was complete: {detail}")]
    OutputIncomplete { format: String, detail: String },

    /// The bytes are not the shape the format requires.
    #[error("{format}: could not read the output: {detail}")]
    OutputUnparsable { format: String, detail: String },

    /// A field is valid but cannot be handed back for execution, because the path
    /// bytes are not text this host can round-trip.
    #[error("{format}: {detail}")]
    UnsupportedPathEncoding { format: String, detail: String },

    /// A value the caller supplied is not acceptable.
    #[error("{detail}")]
    InvalidInput { detail: String },
}

impl CoreError {
    pub fn output_incomplete(format: impl Into<String>, detail: impl Into<String>) -> Self {
        Self::OutputIncomplete {
            format: format.into(),
            detail: detail.into(),
        }
    }

    pub fn output_unparsable(format: impl Into<String>, detail: impl Into<String>) -> Self {
        Self::OutputUnparsable {
            format: format.into(),
            detail: detail.into(),
        }
    }

    pub fn unsupported_path_encoding(format: impl Into<String>, detail: impl Into<String>) -> Self {
        Self::UnsupportedPathEncoding {
            format: format.into(),
            detail: detail.into(),
        }
    }

    pub fn invalid_input(detail: impl Into<String>) -> Self {
        Self::InvalidInput {
            detail: detail.into(),
        }
    }
}
