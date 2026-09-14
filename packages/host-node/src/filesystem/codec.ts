/**
 * The text codec: raw path bytes in, display text out, and back only when it is
 * lossless.
 *
 * Git reports paths as bytes because a POSIX path is not necessarily UTF-8, and
 * this service must be able to *show* such a path without ever letting it be used
 * as an operation input. The rule the design sets out is implemented here as two
 * independent answers:
 *
 * - `toDisplayPath` always produces something printable (invalid sequences become
 *   `\xNN` escapes) and marks whether the original bytes were valid UTF-8;
 * - `encodePath` returns bytes only when the text round-trips exactly, so a
 *   display string is *never* silently promoted into an execution argument.
 *
 * Commit messages, author names and diff text are decoded with replacement rather
 * than escaped: they are prose for a human, and a replacement character inside a
 * message is the same thing a terminal would show.
 */
import type { DisplayPath, TextCodec } from "@refyard/git-core";

/** Escape bytes that are not valid UTF-8 as `\xNN`, for display only. */
function escapeInvalidBytes(bytes: Uint8Array): string {
  let text = "";
  let index = 0;
  while (index < bytes.byteLength) {
    const byte = bytes[index] ?? 0;
    if (byte < 0x80) {
      text += String.fromCharCode(byte);
      index += 1;
      continue;
    }
    // Try to decode one multi-byte sequence; on failure, escape this byte.
    let length = 0;
    if ((byte & 0xe0) === 0xc0) {
      length = 2;
    } else if ((byte & 0xf0) === 0xe0) {
      length = 3;
    } else if ((byte & 0xf8) === 0xf0) {
      length = 4;
    }
    const slice = bytes.subarray(index, index + length);
    const decoded = length === 0 ? null : decodeUtf8Strict(slice);
    if (decoded === null) {
      text += `\\x${byte.toString(16).padStart(2, "0")}`;
      index += 1;
      continue;
    }
    text += decoded;
    index += length;
  }
  return text;
}

/** Decode a complete UTF-8 sequence, or return null if the bytes are not valid. */
function decodeUtf8Strict(bytes: Uint8Array): string | null {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    const decoded = decoder.decode(bytes);
    // A single sequence must not decode to more than one code point, or a partial
    // prefix of a longer string would be accepted.
    return [...decoded].length === 1 ? decoded : null;
  } catch {
    return null;
  }
}

export function createTextCodec(): TextCodec {
  const decoder = new TextDecoder("utf-8", { fatal: false });

  return {
    toDisplayPath(bytes: Uint8Array): DisplayPath {
      const strict = new TextDecoder("utf-8", { fatal: true });
      try {
        const text = strict.decode(bytes);
        return { text, representable: true };
      } catch {
        // Valid UTF-8 only in part: keep the readable parts and escape the rest,
        // because a user still has to be able to tell two such files apart.
        return { text: escapeInvalidBytes(bytes), representable: false };
      }
    },

    decodeText(bytes: Uint8Array): string {
      return decoder.decode(bytes);
    },
  };
}

/**
 * Bytes for a path that will be handed to Git, or null when the text cannot be
 * turned back into the exact bytes it came from.
 *
 * Two refusals, for two different reasons:
 *
 * - a NUL byte cannot travel through argv at all (it truncates inside the OS's C
 *   string handling), so it is never valid;
 * - text matching the escape form `\xNN` is *ambiguous*. It is either a path this
 *   codec escaped for display, or a genuine file whose name contains a backslash —
 *   and the two are indistinguishable here. Guessing would mean acting on a path
 *   the user was never shown, so this fails closed; the user renames the file or
 *   works outside the workbench.
 *
 * The request path does not depend on either case: browsers send `pathId`s that
 * the host bound to raw bytes, so text only ever arrives from a human.
 */
export function encodeExecutionPath(text: string): Uint8Array | null {
  if (text.includes("\u0000")) {
    return null;
  }
  if (/\\x[0-9a-fA-F]{2}/.test(text)) {
    return null;
  }
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  // Round-trip test: anything that decoded with escapes will not come back equal.
  const strict = new TextDecoder("utf-8", { fatal: true });
  try {
    if (strict.decode(bytes) !== text) {
      return null;
    }
  } catch {
    return null;
  }
  return bytes;
}
