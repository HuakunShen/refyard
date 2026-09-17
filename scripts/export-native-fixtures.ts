#!/usr/bin/env bun
/**
 * Record what the Node service answers for every native fixture case.
 *
 * The Rust service is a port, so the Node service is the oracle: this script drives the
 * real read service — the same registries, parsers and snapshot store the CLI wires —
 * over the cases in `tests/support/native-cases.ts`, and writes each answer into
 * `tests/fixtures/native/<case>/<file>.json` beside a `manifest.json` naming the requests
 * that produced them.
 *
 * The recordings are committed, so a reviewer sees a change in the oracle as a diff, and
 * `tests/native/differential.test.ts` replays the same requests against the Rust service.
 * Re-run this after changing a case, a parser or the contract:
 *
 *     bun scripts/export-native-fixtures.ts
 *
 * The fixture repositories are temporary and disposed here. Nothing in this script
 * touches a developer's repository, and it never reads a global Git configuration: each
 * fixture carries its own `HOME` and config files.
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReadService } from "@refyard/host-node";
import {
  nativeCases,
  type NativeRequestBody,
} from "../tests/support/native-cases.js";
import { startTestService } from "../tests/support/service.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureRoot = join(repoRoot, "tests/fixtures/native");

/** One request, answered by the Node read service the way the CLI wires it. */
async function answer(
  read: ReadService,
  repositoryId: string,
  request: NativeRequestBody,
): Promise<unknown> {
  switch (request.op) {
    case "status":
      return read.status({
        repositoryId,
        ...(request.includeIgnored === undefined
          ? {}
          : { includeIgnored: request.includeIgnored }),
      });
    case "refs":
      return read.refs({ repositoryId });
    case "history":
      return read.history({
        repositoryId,
        ...(request.limit === undefined ? {} : { limit: request.limit }),
        ...(request.detailOid === undefined
          ? {}
          : { detailOid: request.detailOid }),
        ...(request.firstParentOnly === undefined
          ? {}
          : { firstParentOnly: request.firstParentOnly }),
      });
    case "diff": {
      const scope = {
        repositoryId,
        kind: request.kind,
        ...(request.oid === undefined ? {} : { oid: request.oid }),
        ...(request.from === undefined ? {} : { from: request.from }),
        ...(request.to === undefined ? {} : { to: request.to }),
      };
      if (request.patchForDisplayPath === undefined) {
        return read.diff(scope);
      }
      // The two-step flow a client performs: the change set first, then the patch for the
      // id the service minted for that path.
      const described = await read.diff(scope);
      const target = described.files.find(
        (file) => file.displayPath === request.patchForDisplayPath,
      );
      if (target === undefined) {
        throw new Error(
          `no changed path with the display path ${JSON.stringify(request.patchForDisplayPath)}`,
        );
      }
      return read.diff({ ...scope, pathId: target.pathId });
    }
  }
}

let exported = 0;
for (const fixtureCase of nativeCases()) {
  const repo = await fixtureCase.create();
  let service: Awaited<ReturnType<typeof startTestService>> | null = null;
  try {
    await fixtureCase.prepare(repo);
    service = await startTestService({
      repo,
      subjectPath: fixtureCase.subject(repo),
    });
    const directory = join(fixtureRoot, fixtureCase.name);
    await mkdir(directory, { recursive: true });
    const requests = await fixtureCase.requests(repo);
    const recorded: unknown[] = [];
    for (const request of requests) {
      const response = await answer(
        service.read,
        service.repositoryId,
        request.body,
      );
      await writeFile(
        join(directory, request.file),
        `${JSON.stringify(response, null, 2)}\n`,
        "utf8",
      );
      recorded.push(request);
      exported += 1;
    }
    await writeFile(
      join(directory, "manifest.json"),
      `${JSON.stringify({ case: fixtureCase.name, requests: recorded }, null, 2)}\n`,
      "utf8",
    );
    console.log(
      `${fixtureCase.name}: ${requests.length} responses (${fixtureCase.purpose})`,
    );
  } finally {
    if (service !== null) {
      await service.close();
    }
    await repo.dispose();
  }
}

// A case directory that no longer has a case must not linger: a stale recording would
// look like an oracle for a fixture that no longer exists.
const known = new Set(nativeCases().map((fixtureCase) => fixtureCase.name));
await mkdir(fixtureRoot, { recursive: true });
for (const entry of await readdir(fixtureRoot)) {
  if (entry.endsWith(".json") || known.has(entry)) {
    continue;
  }
  await rm(join(fixtureRoot, entry), { recursive: true, force: true });
  console.log(`removed stale fixture directory ${entry}`);
}

console.log(`exported ${exported} responses into tests/fixtures/native/`);
