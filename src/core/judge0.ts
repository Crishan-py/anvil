/**
 * Judge0 CE client.
 *
 * The public Community Edition instance sends `Access-Control-Allow-Origin: *`
 * and answers preflights, so the browser can call it directly — there is no
 * server of ours in the path and nothing to install.
 *
 * Verified against the live instance: explicit `fields` are required, because
 * Judge0 omits `exit_code: 0` from the default response.
 */

export const JUDGE0_ENDPOINT = 'https://ce.judge0.com'

const FIELDS = [
  'stdout',
  'stderr',
  'compile_output',
  'message',
  'exit_code',
  'status',
  'time',
  'memory',
] as const

export interface Judge0Request {
  readonly languageId: number
  readonly source: string
  readonly stdin?: string | undefined
  readonly signal?: AbortSignal | undefined
  readonly timeoutMs?: number | undefined
}

export interface Judge0Outcome {
  readonly stdout: string
  readonly stderr: string
  readonly compileOutput: string
  readonly exitCode: number | null
  readonly message: string | null
  readonly timeSeconds: number | null
  readonly memoryKb: number | null
  readonly statusId: number | null
  readonly statusDescription: string | null
}

/** A failure to reach or understand the backend, as opposed to the program failing. */
export class Judge0Error extends Error {
  readonly detail: string | null

  constructor(message: string, detail: string | null) {
    super(message)
    this.name = 'Judge0Error'
    this.detail = detail
  }
}

interface RawResponse {
  stdout?: string | null
  stderr?: string | null
  compile_output?: string | null
  exit_code?: number | null
  message?: string | null
  time?: string | null
  memory?: number | null
  status?: { id?: number; description?: string }
}

export async function runJudge0(request: Judge0Request): Promise<Judge0Outcome> {
  const timeoutMs = request.timeoutMs ?? 20_000
  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)]
  if (request.signal) signals.push(request.signal)

  const url = `${JUDGE0_ENDPOINT}/submissions?base64_encoded=false&wait=true&fields=${FIELDS.join(',')}`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_code: request.source,
        language_id: request.languageId,
        stdin: request.stdin === undefined || request.stdin === '' ? null : request.stdin,
      }),
      signal: AbortSignal.any(signals),
    })
  } catch (cause) {
    throw toTransportError(cause, request.signal?.aborted ?? false)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const detail = body.length > 600 ? `${body.slice(0, 600)}…` : body
    throw new Judge0Error(
      response.status === 429
        ? 'The remote compiler is rate limiting this browser. Wait a few seconds and run again.'
        : `The remote compiler answered ${response.status}.`,
      detail,
    )
  }

  const text = await response.text()
  let raw: RawResponse
  try {
    raw = JSON.parse(text) as RawResponse
  } catch {
    throw new Judge0Error('The remote compiler returned a response that was not JSON.', text.slice(0, 600))
  }

  if (raw.compile_output === undefined && raw.status === undefined) {
    throw new Judge0Error('The remote compiler returned an unexpected payload.', text.slice(0, 600))
  }

  return {
    stdout: raw.stdout ?? '',
    stderr: raw.stderr ?? '',
    compileOutput: raw.compile_output ?? '',
    exitCode: typeof raw.exit_code === 'number' ? raw.exit_code : null,
    message: raw.message ?? null,
    timeSeconds: raw.time === null || raw.time === undefined ? null : Number.parseFloat(raw.time),
    memoryKb: typeof raw.memory === 'number' ? raw.memory : null,
    statusId: typeof raw.status?.id === 'number' ? raw.status.id : null,
    statusDescription: raw.status?.description ?? null,
  }
}

function toTransportError(cause: unknown, aborted: boolean): Judge0Error {
  if (aborted) {
    return new Judge0Error('Run cancelled.', null)
  }
  if (cause instanceof DOMException && cause.name === 'TimeoutError') {
    return new Judge0Error('The remote compiler did not answer in time. Try again.', null)
  }
  const detail = cause instanceof Error ? cause.message : String(cause)
  return new Judge0Error('Could not reach the remote compiler. Check your connection.', detail)
}

/** Judge0 status 6 is a compile failure, which belongs in a different column to a runtime one. */
export function isCompileFailure(outcome: Judge0Outcome): boolean {
  return outcome.statusId === 6 || outcome.compileOutput.trim() !== ''
}
