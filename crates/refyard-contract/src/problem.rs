//! The `Problem` shape and its closed set of codes.
//!
//! This is a projection of `packages/git-contract/src/errors.ts`, not a second
//! specification: the codes are the same closed list, the wire names are the same
//! PascalCase strings, and a code that exists on one side and not the other is a bug
//! rather than a new feature. The differential tests check this crate against the
//! checked-in JSON Schema, so this module does not get to invent a vocabulary of its
//! own.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Every failure the browser can branch on. Closed on purpose: a client that had to
/// handle an open-ended set of codes would end up reading English messages instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProblemCode {
    Unauthenticated,
    Forbidden,
    NotFound,
    InvalidRequest,
    UnsupportedOperation,
    InvalidOperationPayload,
    UnsupportedPathEncoding,
    StaleSnapshot,
    StalePreview,
    Conflict,
    IdempotencyConflict,
    ResourceBusy,
    LimitExceeded,
    GitCommandFailed,
    NeedsAttention,
    UncertainOutcome,
    Timeout,
    Cancelled,
    Unavailable,
    InternalError,
}

/// A JSON detail value. The contract allows strings, numbers and booleans only, so a
/// nested object cannot smuggle file content or a credential into an error report.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum DetailValue {
    Text(String),
    Integer(i64),
    Number(f64),
    Boolean(bool),
}

/// One failure, as the wire carries it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    pub code: ProblemCode,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<BTreeMap<String, DetailValue>>,
    pub retryable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<String>,
}

/// The envelope every non-2xx API response uses.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProblemResponse {
    pub problem: Problem,
}

impl Problem {
    /// A failure with no details and no operation. Most call sites need only this.
    pub fn new(code: ProblemCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: None,
            retryable: false,
            operation_id: None,
        }
    }

    /// Marks a failure the caller may safely repeat. Only reads and idempotent
    /// submissions may carry this: retrying a mutation that may have run is how one
    /// commit becomes two.
    pub fn retryable(mut self) -> Self {
        self.retryable = true;
        self
    }

    pub fn with_detail(mut self, key: impl Into<String>, value: DetailValue) -> Self {
        self.details
            .get_or_insert_with(BTreeMap::new)
            .insert(key.into(), value);
        self
    }

    pub fn for_operation(mut self, operation_id: impl Into<String>) -> Self {
        self.operation_id = Some(operation_id.into());
        self
    }
}

impl std::fmt::Display for Problem {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for Problem {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_with_the_wire_names_the_browser_expects() {
        let problem = Problem::new(ProblemCode::StalePreview, "content changed")
            .with_detail("pathId", DetailValue::Text("path_1".to_string()))
            .for_operation("op_1");
        let json = serde_json::to_value(&problem).expect("serializes");
        assert_eq!(
            json,
            serde_json::json!({
                "code": "StalePreview",
                "message": "content changed",
                "details": { "pathId": "path_1" },
                "retryable": false,
                "operationId": "op_1",
            })
        );
    }

    #[test]
    fn omits_absent_optional_fields_rather_than_sending_null() {
        // A `null` details map would make every client branch on two spellings of
        // "nothing here".
        let json =
            serde_json::to_value(Problem::new(ProblemCode::NotFound, "gone")).expect("serializes");
        assert_eq!(
            json,
            serde_json::json!({ "code": "NotFound", "message": "gone", "retryable": false })
        );
    }

    #[test]
    fn refuses_a_code_that_is_not_in_the_contract() {
        let parsed: Result<Problem, _> =
            serde_json::from_str(r#"{"code":"SomethingElse","message":"x","retryable":false}"#);
        assert!(
            parsed.is_err(),
            "an unknown problem code must not deserialize"
        );
    }

    #[test]
    fn carries_every_code_the_contract_publishes() {
        // Guards against a code being added on one side only. The differential test
        // compares this set against the generated JSON Schema.
        let codes = [
            ProblemCode::Unauthenticated,
            ProblemCode::Forbidden,
            ProblemCode::NotFound,
            ProblemCode::InvalidRequest,
            ProblemCode::UnsupportedOperation,
            ProblemCode::InvalidOperationPayload,
            ProblemCode::UnsupportedPathEncoding,
            ProblemCode::StaleSnapshot,
            ProblemCode::StalePreview,
            ProblemCode::Conflict,
            ProblemCode::IdempotencyConflict,
            ProblemCode::ResourceBusy,
            ProblemCode::LimitExceeded,
            ProblemCode::GitCommandFailed,
            ProblemCode::NeedsAttention,
            ProblemCode::UncertainOutcome,
            ProblemCode::Timeout,
            ProblemCode::Cancelled,
            ProblemCode::Unavailable,
            ProblemCode::InternalError,
        ];
        assert_eq!(codes.len(), 20);
        for code in codes {
            let json = serde_json::to_string(&code).expect("serializes");
            let back: ProblemCode = serde_json::from_str(&json).expect("round trips");
            assert_eq!(back, code);
        }
    }
}
