# Task 7 — Queue port and MongoDB adapter

Progress log for the slice-1 plan, Task 7
(`docs/superpowers/plans/2026-09-01-slice1-foundation-intake.md`).

- [x] read Task 7 in the plan
- [x] define ports/queue.port.ts
- [x] write core/db.ts
  - [x] TorDocument and JobDocument shapes
  - [x] connect, disconnect, collection accessors
  - [x] ensureIndexes including the unique contentHash index
        (kept `announcedAt` and the `agency + announcedAt + torStatus`
        compound index: `createdAt` is ingestion time, `announcedAt` is the
        agency's publication date, which is what FR-E-1's trend and FR-E-3's
        date filter query on)
- [x] write the failing test
  - [x] adapters/mongo.queue.test.ts with the six cases from the plan
  - [x] import ../test/env.js first so config resolves
  - [x] run it, confirm it fails because the module does not exist
- [x] implement adapters/mongo.queue.ts
  - [x] enqueue is idempotent while a job is pending or running
  - [x] claim is atomic and respects lockedUntil
  - [x] fail schedules a retry until attempts are exhausted, then gives up
- [x] **added:** install `mongodb` in the api workspace before the test rather
      than at plan step 5, so the first run fails only on the missing adapter
- [x] **added:** verify `findOneAndUpdate`'s return shape on the installed
      driver (v7.6.0) — it resolves to `WithId<T> | null` directly, so the
      plan's `if (!result) return null` is correct for this major
- [x] **added:** prove the atomicity test has teeth, not luck (see below)
- [x] **added:** probe whether a crashed worker's job becomes claimable again —
      it does not (see the finding below); reported rather than redesigned
- [x] run the test against the live Mongo, confirm all six pass
- [x] run the repo gates that CI runs
  - [x] npm test at the root
  - [x] npm run lint at the root
  - [x] npm run build -w @tor-radar/api
- [x] commit

## Environment

`tor-radar-mongo-1` on `0.0.0.0:27017`, `tor-radar-minio-1` on `9010`. Root
`.env` sets `MONGO_URL=mongodb://localhost:27017/tor_radar_test`; the test
imports `../test/env.js` first so the root `vitest run` gate sees it too.

## Evidence that `claim` is genuinely atomic

The in-suite race (`Promise.all([claim(), claim()])`) can pass by accident, so
it was backed by a throwaway harness run against the live Mongo, outside the
repo: 200 rounds, one pending job per round, 12 concurrent claimants spread
over 4 separate `MongoClient` connections, plus a control that swaps
`findOneAndUpdate` for a non-atomic `findOne` then `updateOne` under identical
load.

```
atomic  (shipped): rounds=200 claimants=12 doubleClaimRounds=0   zeroClaimRounds=0
naive   (control): rounds=200 claimants=12 doubleClaimRounds=200 zeroClaimRounds=0
fanOut: jobs=50 claimed=50 distinct=50 stillPending=0
```

The control double-claims in every single round, so the race is genuinely
reachable at this concurrency and the shipped version's clean sweep is the
mechanism working, not the scheduler hiding the window. The fan-out row adds
that 50 claimants over 50 jobs take 50 distinct documents — no job claimed
twice and none skipped.

## Finding: an abandoned job is never reclaimed (property 3 does not hold)

The task brief states that a crashed worker's job must become claimable again,
and that `lockedUntil` is what makes that happen. As specified it does not.

`claim()` filters on `state: "pending"`. A worker that crashes between `claim`
and `complete`/`fail` leaves the document in `state: "running"` forever, so the
`$or` on `lockedUntil` is unreachable: a `pending` job never carries a
`lockedUntil` at all — `enqueue` does not set one, and both `complete` and
`fail` `$unset` it. Task 11's reconciler does not cover the gap either, since
it counts `state: { $in: ["pending", "running"] }` as live and skips such a
record.

Probed against the live Mongo, simulating a crash and then an expired lock:

```
after crash + lock expiry: {"state":"running","lockedUntil":"<past>"}
shipped claim() reclaimed the abandoned job:            false
Task 11 reconciler sees it as live (so skips it):       true
a state:{$in:[pending,running]} filter would reclaim it: true
```

The plan is authoritative on the code, so the adapter ships verbatim and no
test was written to assert a property the implementation does not have (and
none was written to enshrine the current behaviour as correct). The minimal
fix, if the orchestrator wants property 3, is one line in `claim()`'s filter —
`state: { $in: ["pending", "running"] }` — since the `lockedUntil` clause
already restricts it to locks that have expired. That is a design decision for
the plan owner, not for this task.
