/**
 * The JavaScript sandbox.
 *
 * Runs user code in a Web Worker with `console`, `prompt`, `alert` and
 * `confirm` replaced by bridges back to the main thread. The worker is
 * terminated by the main thread on timeout, which is the only thing that stops
 * a genuine infinite loop — no amount of cooperative checking will.
 */

import { createConsoleBridge, describeError, type BridgeMessage } from './console'

interface WorkerHost {
  postMessage(data: unknown): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  close(): void
}

interface RunMessage {
  readonly kind: 'run'
  readonly source: string
}

interface InputMessage {
  readonly kind: 'input'
  readonly token: string
  readonly text: string
}

const host = globalThis as unknown as WorkerHost

const post = (message: BridgeMessage): void => {
  host.postMessage(message)
}

const bridge = createConsoleBridge(post, console)

const notify = (message: string): void => {
  post({ kind: 'output', stream: 'stdout', text: `[alert] ${message}\n` })
}

const confirm = async (question: string): Promise<boolean> => {
  const answer = await bridge.ask(`${question} (y/n) `, 'y')
  return /^(y|yes|true|1)$/i.test(answer.trim())
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...values: unknown[]) => Promise<unknown>

async function run(source: string): Promise<void> {
  try {
    const body = new AsyncFunction('console', 'prompt', 'alert', 'confirm', source)
    await body(bridge.console, bridge.ask, notify, confirm)
    post({ kind: 'done', ok: true })
  } catch (error) {
    post({ kind: 'output', stream: 'stderr', text: `${describeError(error)}\n` })
    post({ kind: 'done', ok: false })
  } finally {
    host.close()
  }
}

host.addEventListener('message', (event) => {
  const data = event.data as RunMessage | InputMessage | undefined
  if (!data || typeof data !== 'object') return

  if (data.kind === 'input') {
    bridge.resolvePrompt(data.token, data.text)
    return
  }

  if (data.kind === 'run') void run(data.source)
})
