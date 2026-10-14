export type LanguageId = 'html' | 'css' | 'javascript' | 'json' | 'python' | 'c' | 'cpp' | 'java'

/** How a language actually gets evaluated. */
export type EngineKind = 'preview' | 'worker' | 'remote' | 'data'

export type TabId = 'console' | 'preview' | 'data'

export type RunEvent =
  | { readonly kind: 'note'; readonly tone: 'info' | 'warn' | 'error'; readonly text: string }
  | { readonly kind: 'output'; readonly stream: 'stdout' | 'stderr'; readonly text: string }
  | { readonly kind: 'awaiting-input'; readonly prompt: string }
  | {
      readonly kind: 'finished'
      readonly ok: boolean
      readonly exitCode: number | null
      readonly durationMs: number
      readonly runtimeMs: number | null
    }

export interface RunRequest {
  readonly language: LanguageId
  readonly source: string
  readonly stdin: string
}

export type RunListener = (event: RunEvent) => void

export interface RunHandle {
  /** Resolves once the run has emitted its terminal `finished` event. */
  readonly finished: Promise<void>
  cancel(): void
  /** Only meaningful for engines with interactive stdin (the Web Worker). */
  sendInput(text: string): void
}
