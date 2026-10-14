import { isCompileFailure, Judge0Error, runJudge0 } from './judge0'
import { wrapJava } from './javaWrap'
import { language } from './registry'
import type { BridgeMessage } from './console'
import type { RunHandle, RunListener, RunRequest } from './types'

/** Only a terminated worker can stop a real infinite loop. */
const WORKER_TIMEOUT_MS = 10_000
/** Generous, because a cold remote container can take seconds to schedule. */
const REMOTE_TIMEOUT_MS = 25_000

export function startRun(request: RunRequest, listener: RunListener): RunHandle {
  const def = language(request.language)

  switch (def.engine) {
    case 'worker':
      return startWorkerRun(request, listener)
    case 'remote':
      return startRemoteRun(request, listener)
    default:
      return unsupportedRun(listener)
  }
}

function unsupportedRun(listener: RunListener): RunHandle {
  listener({ kind: 'note', tone: 'info', text: 'This language has nothing to execute — it renders.' })
  listener({ kind: 'finished', ok: true, exitCode: null, durationMs: 0, runtimeMs: null })
  let resolveFinished: () => void = () => {}
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve
  })
  resolveFinished()
  return { finished, cancel: () => {}, sendInput: () => {} }
}

function startRemoteRun(request: RunRequest, listener: RunListener): RunHandle {
  const def = language(request.language)
  const controller = new AbortController()
  const started = performance.now()

  let resolveFinished: () => void = () => {}
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve
  })

  let settled = false
  const settle = (): void => {
    if (settled) return
    settled = true
    resolveFinished()
  }

  const languageId = def.judge0LanguageId
  if (languageId === null) {
    listener({ kind: 'note', tone: 'error', text: `${def.label} has no remote runtime configured.` })
    listener({ kind: 'finished', ok: false, exitCode: null, durationMs: 0, runtimeMs: null })
    settle()
    return { finished, cancel: () => {}, sendInput: () => {} }
  }

  void (async () => {
    const wrap = def.id === 'java' ? wrapJava(request.source) : null
    listener({
      kind: 'note',
      tone: 'info',
      text: wrap?.wrapped
        ? `${def.engineLabel} — wrapping bare statements in class Main…`
        : `${def.engineLabel} — compiling and running…`,
    })

    try {
      const outcome = await runJudge0({
        languageId,
        source: wrap?.code ?? request.source,
        stdin: request.stdin,
        signal: controller.signal,
        timeoutMs: REMOTE_TIMEOUT_MS,
      })

      const durationMs = performance.now() - started
      const compileFailed = isCompileFailure(outcome)

      if (compileFailed) {
        listener({ kind: 'note', tone: 'error', text: `${def.label} did not compile.` })
        if (outcome.compileOutput !== '') {
          listener({ kind: 'output', stream: 'stderr', text: outcome.compileOutput })
        }
      } else if (outcome.stdout !== '') {
        listener({ kind: 'output', stream: 'stdout', text: outcome.stdout })
      }

      if (outcome.stderr !== '') listener({ kind: 'output', stream: 'stderr', text: outcome.stderr })

      if (outcome.message !== null) {
        listener({
          kind: 'note',
          tone: outcome.exitCode === 0 ? 'info' : 'warn',
          text: outcome.statusDescription === null ? outcome.message : `${outcome.statusDescription} — ${outcome.message}`,
        })
      }

      listener({
        kind: 'finished',
        ok: !compileFailed && outcome.exitCode === 0,
        exitCode: outcome.exitCode,
        durationMs,
        runtimeMs: outcome.timeSeconds === null ? null : outcome.timeSeconds * 1000,
      })
    } catch (error) {
      const durationMs = performance.now() - started

      if (error instanceof Judge0Error) {
        listener({ kind: 'note', tone: 'error', text: error.message })
        if (error.detail !== null && error.detail !== '') {
          listener({ kind: 'output', stream: 'stderr', text: `${error.detail}\n` })
        }
      } else {
        listener({ kind: 'note', tone: 'error', text: error instanceof Error ? error.message : String(error) })
      }

      listener({ kind: 'finished', ok: false, exitCode: null, durationMs, runtimeMs: null })
    } finally {
      settle()
    }
  })()

  return {
    finished,
    cancel: () => {
      controller.abort()
    },
    sendInput: () => {},
  }
}

function startWorkerRun(request: RunRequest, listener: RunListener): RunHandle {
  const worker = new Worker(new URL('./jsWorker.ts', import.meta.url), { type: 'module' })
  const started = performance.now()

  let resolveFinished: () => void = () => {}
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve
  })

  let settled = false
  let pendingToken: string | null = null

  const timer = setTimeout(() => {
    listener({
      kind: 'note',
      tone: 'error',
      text: `Stopped after ${WORKER_TIMEOUT_MS / 1000}s — the program never returned.`,
    })
    finish(false)
  }, WORKER_TIMEOUT_MS)

  function finish(ok: boolean): void {
    if (settled) return
    settled = true
    clearTimeout(timer)
    worker.terminate()
    listener({
      kind: 'finished',
      ok,
      exitCode: ok ? 0 : 1,
      durationMs: performance.now() - started,
      runtimeMs: null,
    })
    resolveFinished()
  }

  worker.addEventListener('message', (event: MessageEvent<BridgeMessage>) => {
    const message = event.data

    switch (message.kind) {
      case 'output':
        listener({ kind: 'output', stream: message.stream, text: message.text })
        return
      case 'prompt':
        pendingToken = message.token
        listener({ kind: 'awaiting-input', prompt: message.text })
        return
      case 'done':
        finish(message.ok)
    }
  })

  worker.addEventListener('error', (event) => {
    listener({ kind: 'output', stream: 'stderr', text: `${event.message}\n` })
    finish(false)
  })

  worker.postMessage({ kind: 'run', source: request.source })

  return {
    finished,
    cancel: () => {
      listener({ kind: 'note', tone: 'info', text: 'Run cancelled.' })
      finish(false)
    },
    sendInput: (text: string) => {
      if (pendingToken === null) return
      worker.postMessage({ kind: 'input', token: pendingToken, text })
      pendingToken = null
    },
  }
}
