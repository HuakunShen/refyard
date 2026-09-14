/**
 * Service-wide limits and deadlines.
 *
 * These are policy numbers, not measurements. Every one of them exists because an
 * unbounded version of the same thing was a stated failure mode: unbounded
 * patches, unbounded stdout, unbounded queues, unbounded caches, unbounded
 * timeouts. `runtimeLimitsSchema` mirrors them for `GET /capabilities`, and a
 * test asserts the two never drift apart.
 */
import { z } from "zod";

export const LIMITS = {
  /** History paging. */
  historyDefaultPageSize: 200,
  historyMaxPageSize: 500,
  /** Bounded text patch per file, and per response. */
  patchMaxBytesPerFile: 2 * 1024 * 1024,
  patchMaxLinesPerFile: 20_000,
  /** Machine output ceilings. */
  structuredStdoutMaxBytes: 16 * 1024 * 1024,
  stderrDiagnosticMaxBytes: 256 * 1024,
  objectMaxBytes: 16 * 1024 * 1024,
  /** Logical cache budget for read results; no component may exceed it alone. */
  logicalCacheMaxBytes: 64 * 1024 * 1024,
  /** A preview token stops being valid this long after it was issued. */
  previewTokenTtlSeconds: 300,
  /** Command deadlines, by class of operation. */
  readonlyDeadlineSeconds: 15,
  networkDeadlineSeconds: 600,
  hookDeadlineSeconds: 120,
  /** Idempotency records. */
  idempotencyTtlSeconds: 24 * 60 * 60,
  idempotencyMaxEntries: 2_000,
  idempotencyMaxBytes: 16 * 1024 * 1024,
  /** Concurrency. */
  queuedOperationsPerActor: 32,
  concurrentGitProcesses: 4,
  concurrentReadersPerRepository: 2,
  /** Event ring buffer for SSE. */
  eventRingMaxEvents: 1_024,
  eventRingMaxBytes: 1024 * 1024,
  /** Request-bounded collections. */
  pathSelectionMaxEntries: 1_000,
  stashListMaxEntries: 1_000,
  refListMaxEntries: 5_000,
  commitMessageMaxBytes: 1_048_576,
  branchNameMaxLength: 255,
  /** How many tips a history snapshot may pin. */
  historyTipsMax: 16,
} as const;

export const runtimeLimitsSchema = z
  .strictObject({
    historyDefaultPageSize: z.int().positive(),
    historyMaxPageSize: z.int().positive(),
    patchMaxBytesPerFile: z.int().positive(),
    patchMaxLinesPerFile: z.int().positive(),
    objectMaxBytes: z.int().positive(),
    logicalCacheMaxBytes: z.int().positive(),
    previewTokenTtlSeconds: z.int().positive(),
    readonlyDeadlineSeconds: z.int().positive(),
    networkDeadlineSeconds: z.int().positive(),
    hookDeadlineSeconds: z.int().positive(),
    queuedOperationsPerActor: z.int().positive(),
    concurrentGitProcesses: z.int().positive(),
    concurrentReadersPerRepository: z.int().positive(),
    eventRingMaxEvents: z.int().positive(),
    eventRingMaxBytes: z.int().positive(),
    pathSelectionMaxEntries: z.int().positive(),
    historyTipsMax: z.int().positive(),
    commitMessageMaxBytes: z.int().positive(),
    branchNameMaxLength: z.int().positive(),
  })
  .meta({
    id: "RuntimeLimits",
    description:
      "Limits the service enforces on reads, requests, queues and event streams.",
  });

export type RuntimeLimits = z.infer<typeof runtimeLimitsSchema>;

/** The subset of `LIMITS` that is published in `GET /capabilities`. */
export const RUNTIME_LIMITS: RuntimeLimits = runtimeLimitsSchema.parse({
  historyDefaultPageSize: LIMITS.historyDefaultPageSize,
  historyMaxPageSize: LIMITS.historyMaxPageSize,
  patchMaxBytesPerFile: LIMITS.patchMaxBytesPerFile,
  patchMaxLinesPerFile: LIMITS.patchMaxLinesPerFile,
  objectMaxBytes: LIMITS.objectMaxBytes,
  logicalCacheMaxBytes: LIMITS.logicalCacheMaxBytes,
  previewTokenTtlSeconds: LIMITS.previewTokenTtlSeconds,
  readonlyDeadlineSeconds: LIMITS.readonlyDeadlineSeconds,
  networkDeadlineSeconds: LIMITS.networkDeadlineSeconds,
  hookDeadlineSeconds: LIMITS.hookDeadlineSeconds,
  queuedOperationsPerActor: LIMITS.queuedOperationsPerActor,
  concurrentGitProcesses: LIMITS.concurrentGitProcesses,
  concurrentReadersPerRepository: LIMITS.concurrentReadersPerRepository,
  eventRingMaxEvents: LIMITS.eventRingMaxEvents,
  eventRingMaxBytes: LIMITS.eventRingMaxBytes,
  pathSelectionMaxEntries: LIMITS.pathSelectionMaxEntries,
  historyTipsMax: LIMITS.historyTipsMax,
  commitMessageMaxBytes: LIMITS.commitMessageMaxBytes,
  branchNameMaxLength: LIMITS.branchNameMaxLength,
});
