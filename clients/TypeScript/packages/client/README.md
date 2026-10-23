# Cardano Ogmios TypeScript Client Packages - Client

Provides a natural interface for ECMAScript integrations, including abstraction of Websocket
management and custom error mapping. The [schema] package is imported and
exported as `Schema`.

## Quick Start
```console
yarn add @cardano-ogmios/client
```

## Request Timeouts
Ledger state queries (and `findIntersection`) accept an optional `MethodOptions` argument with
a `timeout`, in milliseconds. When set, the call rejects with a `RequestTimeoutError` if no
response is received in time:

```ts
import { createInteractionContext, createLedgerStateQueryClient, RequestTimeoutError } from '@cardano-ogmios/client'

const context = await createInteractionContext(console.error, () => {})
const client = await createLedgerStateQueryClient(context, {}, { timeout: 5000 })

try {
  await client.ledgerTip()
} catch (e) {
  if (e instanceof RequestTimeoutError) {
    // Give up on this connection; see below.
  }
}
```

A timeout only stops the client from waiting: the server still processes the request and
eventually answers, and that late answer is discarded. Because requests on one connection are
processed sequentially, a connection on which a request has timed out is no longer in a known
state:

- a timed-out `acquireLedgerState` (or `releaseLedgerState`) can leave the server holding an
  acquired (or released) ledger state that the client believes it does not have;
- a timed-out query delays every request queued behind it on the same connection.

After a `RequestTimeoutError`, do not reuse the connection: close it and create a new
`InteractionContext` (and a new client from it).

## Build From Source
See instructions in [Workspace root]

[schema]: ../schema
[Workspace root]: ../..
