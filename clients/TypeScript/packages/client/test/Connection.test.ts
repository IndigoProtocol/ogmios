import { createHash } from 'crypto'
import { createServer } from 'http'
import { AddressInfo } from 'net'
import { Duplex } from 'stream'
import {
  createInteractionContext,
  createConnectionObject,
  InteractionContext,
  RequestTimeoutError,
  LedgerStateQuery
} from '../src'

/**
 * A server that reports itself healthy and accepts WebSocket connections, but never sends
 * anything on them afterwards. Mimics a server that is stuck, or a connection that has silently
 * gone half-open.
 */
const createSilentServer = (): Promise<{ close: () => Promise<void>, port: number }> => {
  const sockets = new Set<Duplex>()
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ lastTipUpdate: new Date().toISOString() }))
  })
  server.on('upgrade', (req, socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    const accept = createHash('sha1')
      .update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64')
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '', ''
    ].join('\r\n'))
    socket.on('error', () => {})
  })
  const close = () => new Promise<void>(resolve => {
    sockets.forEach(socket => socket.destroy())
    server.close(() => resolve())
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    resolve({ close, port: (server.address() as AddressInfo).port })
  }))
}

describe('Connection', () => {
  describe('createConnectionObject', () => {
    it('can be passed undefined', () => {
      expect(createConnectionObject(undefined)).toStrictEqual({
        maxPayload: 134217728,
        address: {
          http: 'http://127.0.0.1:1337',
          webSocket: 'ws://127.0.0.1:1337'
        }
      })
    })
    it('can be passed a complete ConnectionConfig object', () => {
      expect(createConnectionObject({
        host: 'some-host',
        port: 1337,
        tls: true
      })).toStrictEqual({
        maxPayload: 134217728,
        address: {
          http: 'https://some-host:1337',
          webSocket: 'wss://some-host:1337'
        }
      })
    })
    it('can be passed an object with just a host', () => {
      expect(createConnectionObject({
        host: 'some-host'
      })).toStrictEqual({
        maxPayload: 134217728,
        address: {
          http: 'http://some-host:1337',
          webSocket: 'ws://some-host:1337'
        }
      })
    })
    it('can be passed an object with just a port', () => {
      expect(createConnectionObject({
        port: 1337
      })).toStrictEqual({
        maxPayload: 134217728,
        address: {
          http: 'http://127.0.0.1:1337',
          webSocket: 'ws://127.0.0.1:1337'
        }
      })
    })
    it('can be passed an object with just tls', () => {
      expect(createConnectionObject({
        tls: true
      })).toStrictEqual({
        maxPayload: 134217728,
        address: {
          http: 'https://127.0.0.1:1337',
          webSocket: 'wss://127.0.0.1:1337'
        }
      })
    })
    it('can be passed an object excluding a host', () => {
      expect(createConnectionObject({
        port: 1337,
        tls: true
      })).toStrictEqual({
        maxPayload: 134217728,
        address: {
          http: 'https://127.0.0.1:1337',
          webSocket: 'wss://127.0.0.1:1337'
        }
      })
    })
    it('can be passed an object excluding a port', () => {
      expect(createConnectionObject({
        host: '127.0.0.1',
        tls: true
      })).toStrictEqual({
        maxPayload: 134217728,
        address: {
          http: 'https://127.0.0.1:1337',
          webSocket: 'wss://127.0.0.1:1337'
        }
      })
    })
    it('can be passed an object excluding tls', () => {
      expect(createConnectionObject({
        host: '127.0.0.1',
        port: 1337
      })).toStrictEqual({
        maxPayload: 134217728,
        address: {
          http: 'http://127.0.0.1:1337',
          webSocket: 'ws://127.0.0.1:1337'
        }
      })
    })
    it('can be passed an address directly', () => {
      expect(createConnectionObject({
        address: {
          http: 'http://127.0.0.1:1442',
          webSocket: 'ws://127.0.0.1:1442'
        }
      })).toStrictEqual({
        maxPayload: 134217728,
        address: {
          http: 'http://127.0.0.1:1442',
          webSocket: 'ws://127.0.0.1:1442'
        }
      })
    })
    it('can be passed an address and maxPayload', () => {
      expect(createConnectionObject({
        maxPayload: 1024,
        address: {
          http: 'http://127.0.0.1:1442',
          webSocket: 'ws://127.0.0.1:1442'
        }
      })).toStrictEqual({
        maxPayload: 1024,
        address: {
          http: 'http://127.0.0.1:1442',
          webSocket: 'ws://127.0.0.1:1442'
        }
      })
    })
    it('cannot be passed an address and a host', () => {
      expect(() => createConnectionObject({
        host: '127.0.0.1',
        address: {
          http: 'http://127.0.0.1:1442',
          webSocket: 'ws://127.0.0.1:1442'
        }
      })).toThrow()
    })
    it('cannot be passed an address and a port', () => {
      expect(() => createConnectionObject({
        port: 1337,
        address: {
          http: 'http://127.0.0.1:1442',
          webSocket: 'ws://127.0.0.1:1442'
        }
      })).toThrow()
    })
    it('cannot be passed an address and a tls flag', () => {
      expect(() => createConnectionObject({
        tls: true,
        address: {
          http: 'http://127.0.0.1:1442',
          webSocket: 'ws://127.0.0.1:1442'
        }
      })).toThrow()
    })
  })
  describe('InteractionContext', () => {
    it('rejects with the Websocket errors on failed connection', async () => {
      let context: InteractionContext
      try {
        context = await createInteractionContext(
          (error) => console.error(error),
          () => {},
          { connection: { host: 'non-existent-host', port: 1111 } }
        )
        expect(context).toBeUndefined()
        if (context.socket.readyState === context.socket.OPEN) {
          await context.socket.close()
        }
      } catch (error) {
        await expect(error.code).toMatch(/EAI_AGAIN|ENOTFOUND/)
      }
      try {
        context = await createInteractionContext(
          (error) => console.error(error),
          () => {},
          { connection: { port: 1111 } }
        )
        expect(context).toBeUndefined()
        if (context.socket.readyState === context.socket.OPEN) {
          await context.socket.close()
        }
      } catch (error) {
        expect(error.code).toBe('ECONNREFUSED')
      }
    })
  })
  describe('MethodOptions', () => {
    let close: () => Promise<void>
    let context: InteractionContext
    beforeEach(async () => {
      const server = await createSilentServer()
      close = server.close
      context = await createInteractionContext(
        console.error,
        () => {},
        { connection: { port: server.port } }
      )
    })
    afterEach(async () => {
      context.socket.terminate()
      await close()
    })

    it('rejects with a RequestTimeoutError when no response arrives within the timeout', async () => {
      expect.assertions(3)
      try {
        await LedgerStateQuery.ledgerTip(context, { timeout: 100 })
      } catch (error) {
        expect(error).toBeInstanceOf(RequestTimeoutError)
        expect(error.timeout).toBe(100)
        expect(error.message).toBe('Request timed out after 100ms')
      }
    })
  })
})
