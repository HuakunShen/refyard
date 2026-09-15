/**
 * Bounded byte scanning.
 *
 * Machine formats are parsed by *position*: read a fixed number of
 * space-separated ASCII fields, then take everything up to the record terminator
 * as raw bytes. Splitting on whitespace first and deciding later is how newlines,
 * tabs and spaces inside path names turn into corrupted state, so the helpers here
 * never trim, never normalise, and never decode.
 */
import { GitOutputParseError } from "../ports.js";

/** ASCII byte-level helpers over `Uint8Array`, with no encoding assumptions. */
export function byteAt(bytes: Uint8Array, index: number): number {
  const value = bytes[index];
  if (value === undefined) {
    throw new RangeError(
      `index ${index} is outside the buffer (${bytes.byteLength} bytes)`,
    );
  }
  return value;
}

export function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

export function isHexDigit(code: number): boolean {
  return isDigit(code) || (code >= 0x61 && code <= 0x66);
}

export function isAsciiSpace(code: number): boolean {
  return code === 0x20;
}

export function isControl(code: number): boolean {
  return code < 0x20 || code === 0x7f;
}

/** Decode strictly ASCII bytes; refuses anything above 0x7f rather than guessing. */
export function decodeAscii(
  bytes: Uint8Array,
  offset = 0,
  length = bytes.byteLength - offset,
): string {
  let text = "";
  for (let index = offset; index < offset + length; index += 1) {
    const code = bytes[index];
    if (code === undefined) {
      throw new RangeError(`index ${index} is outside the buffer`);
    }
    if (code > 0x7f) {
      throw new GitOutputParseError(
        "ascii",
        "expected an ASCII field but found a byte above 0x7f",
        index,
      );
    }
    text += String.fromCharCode(code);
  }
  return text;
}

/**
 * A cursor over one record.
 *
 * Fields are read positionally. `takeField` stops at the next space and refuses
 * to cross the frame's end; `takeRest` returns the remaining bytes untouched,
 * which is how paths keep their spaces, tabs and newlines.
 */
export class FrameReader {
  readonly #bytes: Uint8Array;
  readonly #format: string;
  #offset: number;

  constructor(
    bytes: Uint8Array,
    format: string,
    offset = 0,
    end = bytes.byteLength,
  ) {
    this.#bytes =
      offset === 0 && end === bytes.byteLength
        ? bytes
        : bytes.subarray(offset, end);
    this.#format = format;
    this.#offset = 0;
  }

  get offset(): number {
    return this.#offset;
  }

  get remaining(): number {
    return this.#bytes.byteLength - this.#offset;
  }

  get exhausted(): boolean {
    return this.remaining === 0;
  }

  /** The frame as seen from the current offset, without copying. */
  rest(): Uint8Array {
    return this.#bytes.subarray(this.#offset);
  }

  #fail(message: string): never {
    throw new GitOutputParseError(this.#format, message, this.#offset);
  }

  expectSpace(): void {
    const code = this.#bytes[this.#offset];
    if (code !== 0x20) {
      this.#fail("expected a space separator");
    }
    this.#offset += 1;
  }

  /** Read one space-delimited ASCII token. Empty tokens are rejected. */
  takeField(): string {
    const start = this.#offset;
    let end = start;
    while (end < this.#bytes.byteLength && this.#bytes[end] !== 0x20) {
      end += 1;
    }
    if (end === start) {
      this.#fail("expected a field but found a separator");
    }
    const field = decodeAscii(this.#bytes, start, end - start);
    this.#offset = end;
    return field;
  }

  /** Read up to the next occurrence of `separator`, consuming neither it nor more. */
  takeUntil(separator: number): Uint8Array {
    const start = this.#offset;
    let end = start;
    while (end < this.#bytes.byteLength && this.#bytes[end] !== separator) {
      end += 1;
    }
    const value = this.#bytes.subarray(start, end);
    this.#offset = end;
    return value;
  }

  /** Require one specific byte, e.g. the TAB between counts and a path. */
  expectByte(expected: number, name: string): void {
    const code = this.#bytes[this.#offset];
    if (code !== expected) {
      this.#fail(`expected ${name}`);
    }
    this.#offset += 1;
  }

  /** Read exactly `count` bytes, e.g. a fixed-width status or mode field. */
  takeBytes(count: number): Uint8Array {
    if (this.remaining < count) {
      this.#fail(`expected ${count} more bytes`);
    }
    const slice = this.#bytes.subarray(this.#offset, this.#offset + count);
    this.#offset += count;
    return slice;
  }

  takeFixedString(count: number): string {
    return decodeAscii(this.takeBytes(count), 0, count);
  }

  /** Everything left, as bytes. The path field of a `-z` record, for instance. */
  takeRest(): Uint8Array {
    const rest = this.rest();
    this.#offset = this.#bytes.byteLength;
    return rest;
  }

  /** Everything left, decoded as ASCII. Only safe where the format guarantees ASCII. */
  takeRestAscii(): string {
    const rest = this.takeRest();
    return decodeAscii(rest, 0, rest.byteLength);
  }

  /** Read a decimal number field. */
  takeNumber(): number {
    const field = this.takeField();
    if (field.length === 0) {
      this.#fail("expected a number");
    }
    for (const character of field) {
      const code = character.charCodeAt(0);
      if (!isDigit(code)) {
        this.#fail(`expected a decimal number but found '${field}'`);
      }
    }
    return Number.parseInt(field, 10);
  }

  /** Read an object name and verify it looks like one (40 or 64 lowercase hex). */
  takeOid(): string {
    const field = this.takeField();
    if (!isObjectName(field)) {
      this.#fail(`expected a Git object name but found '${field}'`);
    }
    return field;
  }
}

/** True when `text` is a complete lowercase hex object name of a known length. */
export function isObjectName(text: string): boolean {
  if (text.length !== 40 && text.length !== 64) {
    return false;
  }
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (!isHexDigit(code)) {
      return false;
    }
  }
  return true;
}

/** Object-name length for a repository's format, or null when unrecognised. */
export function oidLengthForFormat(format: "sha1" | "sha256"): number {
  return format === "sha256" ? 64 : 40;
}

/** Split a buffer on a single byte, keeping empty frames out of the result. */
export function splitOnByte(
  bytes: Uint8Array,
  separator: number,
): Uint8Array[] {
  const parts: Uint8Array[] = [];
  let start = 0;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (bytes[index] === separator) {
      parts.push(bytes.subarray(start, index));
      start = index + 1;
    }
  }
  if (start < bytes.byteLength) {
    parts.push(bytes.subarray(start));
  }
  return parts;
}

/** Concatenate byte chunks, used by streaming decoders. */
export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.byteLength;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  for (let index = 0; index < a.byteLength; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

/** A NUL-terminated NUL-framed stream splitter that tolerates any chunking. */
export class NulFramer {
  readonly #format: string;
  #pending: Uint8Array = new Uint8Array(0);

  constructor(format: string) {
    this.#format = format;
  }

  /**
   * Feed bytes, receive complete frames. A frame is only emitted once its NUL
   * terminator has arrived, so a chunk boundary in the middle of a path cannot
   * split a record.
   */
  push(chunk: Uint8Array): Uint8Array[] {
    const combined = NulFramer.#combine(this.#pending, chunk);
    const frames: Uint8Array[] = [];
    let start = 0;
    for (let index = 0; index < combined.byteLength; index += 1) {
      if (combined[index] === 0x00) {
        frames.push(combined.subarray(start, index));
        start = index + 1;
      }
    }
    this.#pending =
      start === combined.byteLength ? new Uint8Array(0) : combined.slice(start);
    return frames;
  }

  /** Bytes received but not yet terminated by a NUL. */
  get pending(): Uint8Array {
    return this.#pending;
  }

  /** Finish the stream: a trailing frame without its NUL is a protocol error. */
  finish(): void {
    if (this.#pending.byteLength > 0) {
      throw new GitOutputParseError(
        this.#format,
        `stream ended with ${this.#pending.byteLength} bytes after the last NUL terminator`,
      );
    }
  }

  static #combine(left: Uint8Array, right: Uint8Array): Uint8Array {
    if (left.byteLength === 0) {
      return right;
    }
    if (right.byteLength === 0) {
      return left;
    }
    return concatBytes([left, right]);
  }
}

/** Split a buffer into NUL-terminated frames, dropping the trailing empty frame. */
export function splitNulFrames(
  bytes: Uint8Array,
  format: string,
  requireTerminator = true,
): Uint8Array[] {
  const framer = new NulFramer(format);
  const frames = framer.push(bytes);
  if (requireTerminator) {
    framer.finish();
  }
  return frames;
}
