# er-coop-api — Elite Redux co-op signaling + run-relay (#633)

Cloudflare Worker + D1. Brokers WebRTC matchmaking/signaling for 2-player co-op
and relays the host-authoritative session save for **resume**. The co-op run
itself is peer-to-peer (WebRTC DataChannel), so this worker only carries the
handshake + a thin save blob — it is effectively free to run.

## Deploy (maintainer)

```sh
cd workers/er-coop-api
npx wrangler d1 create er-coop                       # once; paste the id into wrangler.toml
npx wrangler d1 execute er-coop --remote --file ./schema.sql
npx wrangler secret put COOP_IDENTITY_SECRET             # same dedicated secret as er-save-api
npx wrangler deploy
```

Then point the client at it with `VITE_COOP_SERVER_URL=https://er-coop-api.<acct>.workers.dev`
(the WebRTC transport reads this; see `src/data/elite-redux/coop/`). Until then,
co-op runs locally against the in-process `LoopbackTransport` + `SpoofGuest`.

P33 public matchmaking uses `/coop/v3/**`. Its lobby identity comes only from an
authenticated, short-lived account ticket; every subsequent lobby, signaling,
heartbeat, leave, and hot-rejoin request requires the derived bearer token. A hot
rejoin accepts only the same immutable account ID and rotates that member's token
and connection generation. The unauthenticated legacy routes remain separate
during migration and are never used after a client selects P33.

## Pairing flow

1. Host `POST /coop/create {host,seed}` → `{code}`. Host shows the code.
2. Guest types it; `POST /coop/join {code,guest}` → `{seed,state,hostName}`.
3. Each side `POST /coop/signal {code,role,signal}` (its SDP/ICE) and polls
   `GET /coop/signal?code=&role=` for the peer's, until the DataChannel opens.
4. Both `POST /coop/heartbeat {code,role}` periodically (presence).
5. Host pushes the authoritative save with `POST /coop/save {code,blob}`.
6. **Resume:** `GET /coop/load?code=` returns `{blob,state,canResume}`;
   `canResume` is true **only when both peers heartbeat'd within
   `PRESENCE_WINDOW_MS`** (resume-requires-both, #639).

## STUN / TURN (and your Cloudflare quota)

WebRTC connects the two players **directly** (peer-to-peer) using free **STUN**
(just IP reflection - no relay, no data, no cost). ~80-90% of players connect
directly. **TURN** is only a fallback *relay* for the rest (behind symmetric NAT).

- **The signaling worker (this) is negligible:** a handful of requests + ~10 D1
  writes per co-op session - hundreds of concurrent sessions fit the free tier.
- **TURN is OPTIONAL.** By default `GET /coop/ice` returns free STUN only and
  co-op still works for most players. To cover the rest, create a **Cloudflare
  Realtime TURN** key (dashboard -> Realtime -> TURN) and set two secrets:
  ```sh
  npx wrangler secret put CF_TURN_KEY_ID
  npx wrangler secret put CF_TURN_API_TOKEN
  ```
  The worker then mints short-lived TURN credentials at `/coop/ice`. TURN is
  billed on relay **egress** only (~1000 GB/mo free), and co-op carries tiny game
  commands (a few KB/s) - a relayed hour is a few MB, so it never gets close.
- The client reads `GET /coop/ice` automatically (`fetchIceServers` in
  `coop-webrtc-connect.ts`), falling back to free STUN if TURN isn't configured.

## Notes

- Pairing-code alphabet/length mirror `src/data/elite-redux/coop/coop-pairing.ts`
  (pure helpers unit-tested in `test/tests/elite-redux/coop/coop-pairing.test.ts`;
  the ICE policy in `coop-webrtc-connect.test.ts`).
- An hourly cron prunes runs untouched past `RUN_TTL_MS` (default 24h).
