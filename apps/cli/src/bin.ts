#!/usr/bin/env node
/**
 * The executable entry point.
 *
 * It does exactly three things: build the process-level IO, call `main`, and set
 * the exit code. Keeping it this thin is what makes the CLI testable — every
 * behaviour lives in `main` and its commands, which take their IO as an argument.
 *
 * The Git executable is resolved once, here, from `REFYARD_GIT` or `PATH`, so the
 * rest of the program never consults the environment for it.
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "./main.js";
import { resolveGitPath } from "./git-path.js";

const result = await main(process.argv.slice(2), {
  write: (line) => {
    process.stdout.write(`${line}\n`);
  },
  writeError: (line) => {
    process.stderr.write(`${line}\n`);
  },
  cliDirectory: dirname(fileURLToPath(import.meta.url)),
  gitPath: resolveGitPath(),
  cwd: process.cwd(),
});

process.exitCode = result.exitCode;
