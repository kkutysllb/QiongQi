# External A2A Interoperability Verification Plan

> For agentic workers: use this plan when a real external A2A peer is available. Keep local fake-model A2A verification in CI; this plan closes the P2 cross-vendor evidence gap.

## Goal

Verify that Qiongqi interoperates with a real external A2A peer, not only another local Qiongqi instance. The run must exercise discovery, authenticated task submission, task status semantics, artifacts when available, and failure diagnostics.

## Preconditions

- Qiongqi has been built and flattened:
  - `pnpm -r run build`
  - `node scripts/flatten-dist.mjs`
- A real peer endpoint is available over HTTPS or a controlled private network.
- The peer exposes:
  - `GET /.well-known/agent-card.json`
  - `POST /a2a/tasks`
- The operator has a bearer token or equivalent token accepted by the peer.
- The peer owner has approved a harmless probe prompt and expected rate limits.

## Environment

```bash
export QIONGQI_A2A_PEER_URL="https://peer.example.com"
export QIONGQI_A2A_PEER_TOKEN="$TOKEN"
```

Optional local tuning:

```bash
export QIONGQI_VERIFY_HOST="127.0.0.1"
export QIONGQI_VERIFY_KEEP_DATA=1
```

## Procedure

1. Run the local deterministic baseline:

   ```bash
   pnpm run verify:evented-a2a
   ```

   Expected: `local evented A2A: passed` and `external peer: skipped`.

2. Run the external peer probe:

   ```bash
   pnpm run verify:evented-a2a -- --external-peer
   ```

   Expected: `local evented A2A: passed` and `external peer: passed`.

3. Capture evidence:
   - command, timestamp, Qiongqi commit SHA, peer name/version from AgentCard
   - HTTP status for AgentCard discovery and task submission
   - task id and initial task status
   - any returned artifact summary, MIME type, and byte size
   - sanitized failure body if the peer rejects the probe

## Acceptance Criteria

- AgentCard discovery returns a valid id and endpoint metadata.
- `POST /a2a/tasks` accepts the probe with bearer auth.
- The task response includes `task.id` and a status in `submitted`, `working`, or `completed`.
- Qiongqi reports external verification as `passed`.
- Failures are actionable: auth, schema mismatch, unsupported endpoint, network/TLS, timeout, or peer-side task failure are distinguishable.

## Failure Triage

- `401` / `403`: verify token scope and whether the peer expects a different auth scheme.
- `404`: confirm the peer supports Stage 4 `/a2a/tasks`; if it only supports legacy `/a2a`, record the compatibility gap.
- `400` / schema errors: compare required fields against `PeerTaskSchema` and the peer's AgentCard.
- Timeout: rerun with peer-side logs and decide whether polling/subscription semantics need a script extension.
- Completed task with no artifacts: acceptable if the peer returns a valid task and summary, but record the artifact behavior.

## Follow-up: Complexity Split Trigger

After the first real external peer pass/fail report, revisit the two current complexity hotspots:

- `ModelCompatClient`: split endpoint-format mapping, streaming decoders, usage/pricing mapping, and error probing if external peer work requires more provider-specific behavior.
- `runtime-factory`: split storage/core creation, capability matrix assembly, A2A identity/peer setup, and HTTP observability wiring if additional external-peer setup increases composition-root size.

Do not split either file only for aesthetics. Use this trigger: a second provider/peer-specific branch lands in the same hotspot, or tests need to mock more than two unrelated subsystems to cover one behavior.
