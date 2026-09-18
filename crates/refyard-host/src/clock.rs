//! The wall clock, in the one format the contract publishes.
//!
//! Hand-rolled rather than pulled from a date crate: the whole requirement is "ISO-8601
//! UTC with milliseconds", the algorithm is a well-known conversion from a Unix
//! timestamp, and a date library would be a dependency with its own timezone database
//! and its own idea of what "now" means. The tests below pin the leap-year and
//! epoch-boundary cases that a hand-written conversion gets wrong.

use std::time::{SystemTime, UNIX_EPOCH};

/// The current instant as milliseconds since the Unix epoch.
///
/// The same clock the ISO-8601 formatting is built on, so a journal timestamp and a
/// preview's expiry cannot come from two different ideas of "now".
pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// The current instant as `YYYY-MM-DDTHH:MM:SS.mmmZ`.
pub fn now_iso8601() -> String {
    format_iso8601_millis(now_millis())
}

/// Formats a Unix timestamp in milliseconds, truncating toward the past.
pub fn format_iso8601_millis(millis: i64) -> String {
    let seconds = millis.div_euclid(1000);
    let remainder = millis.rem_euclid(1000);
    let days = seconds.div_euclid(86_400);
    let second_of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = second_of_day / 3600;
    let minute = (second_of_day % 3600) / 60;
    let second = second_of_day % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{remainder:03}Z")
}

/// Days since 1970-01-01 to a civil date, by Howard Hinnant's `civil_from_days`.
///
/// The epoch-relative shift makes the leap-year arithmetic expressible as integer
/// division: a year is 365 days plus one for each leap day since the epoch, and March
/// is treated as the first month so February's irregularity falls at the end of the
/// shifted year.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let shifted = days + 719_468;
    let era = if shifted >= 0 {
        shifted / 146_097
    } else {
        (shifted - 146_096) / 146_097
    };
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * shifted_month + 2) / 5 + 1) as u32;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_the_epoch() {
        assert_eq!(format_iso8601_millis(0), "1970-01-01T00:00:00.000Z");
    }

    #[test]
    fn formats_a_known_instant_with_milliseconds() {
        // 2026-01-01T00:00:00.000Z is the fixture corpus's commit date.
        let millis = 1_767_225_600_000;
        assert_eq!(format_iso8601_millis(millis), "2026-01-01T00:00:00.000Z");
    }

    #[test]
    fn keeps_milliseconds() {
        assert_eq!(
            format_iso8601_millis(1_767_225_600_123),
            "2026-01-01T00:00:00.123Z"
        );
    }

    #[test]
    fn handles_a_leap_day() {
        // 2024-02-29T12:00:00.000Z — the case a naive 365-day year gets wrong.
        assert_eq!(
            format_iso8601_millis(1_709_208_000_000),
            "2024-02-29T12:00:00.000Z"
        );
    }

    #[test]
    fn handles_a_year_boundary_with_seconds_before_midnight() {
        assert_eq!(
            format_iso8601_millis(1_767_225_599_999),
            "2025-12-31T23:59:59.999Z"
        );
    }

    #[test]
    fn formats_an_instant_before_the_epoch() {
        // Not reachable from `now`, but a timestamp from a commit can be any value and
        // the conversion must not panic or wrap.
        assert_eq!(format_iso8601_millis(-1), "1969-12-31T23:59:59.999Z");
    }

    #[test]
    fn the_current_time_matches_the_contract_pattern() {
        let text = now_iso8601();
        assert_eq!(text.len(), 24, "{text}");
        assert!(text.ends_with('Z'));
        assert_eq!(text.as_bytes()[10], b'T');
    }
}
