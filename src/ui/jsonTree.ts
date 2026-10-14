/**
 * Collapsible view of parsed JSON.
 *
 * Nodes are budgeted: a pasted megabyte of JSON would otherwise build a hundred
 * thousand DOM nodes and lock the tab, and the honest answer is to say the tree
 * was cut short rather than to hang.
 */

const MAX_NODES = 3000
const MAX_DEPTH = 24
const AUTO_OPEN_DEPTH = 2

export interface TreeSummary {
  readonly nodes: number
  readonly truncated: boolean
}

type Kind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'

function kindOf(value: unknown): Kind {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  switch (typeof value) {
    case 'object':
      return 'object'
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    default:
      return 'boolean'
  }
}

function scalarText(value: unknown, kind: Kind): string {
  if (kind === 'string') {
    const text = value as string
    return text.length > 200 ? `"${text.slice(0, 200)}…"` : `"${text}"`
  }
  if (kind === 'null') return 'null'
  return String(value)
}

export function renderJsonTree(container: HTMLElement, value: unknown): TreeSummary {
  const budget = { nodes: 0, truncated: false }

  container.replaceChildren()
  container.appendChild(renderValue(null, value, 0, budget, true))

  if (budget.truncated) {
    const note = document.createElement('div')
    note.className = 'jt-truncated'
    note.textContent = `Tree truncated at ${MAX_NODES.toLocaleString()} nodes. The value above is still exact.`
    container.appendChild(note)
  }

  return { nodes: budget.nodes, truncated: budget.truncated }
}

function renderValue(
  key: string | null,
  value: unknown,
  depth: number,
  budget: { nodes: number; truncated: boolean },
  isRoot: boolean,
): HTMLElement {
  const kind = kindOf(value)
  budget.nodes++

  const row = document.createElement('div')
  row.className = 'jt-row'
  if (depth > 0) row.style.setProperty('--jt-depth', String(depth))

  if (key !== null) {
    const keyEl = document.createElement('span')
    keyEl.className = 'jt-key'
    keyEl.textContent = key
    row.appendChild(keyEl)
    const colon = document.createElement('span')
    colon.className = 'jt-colon'
    colon.textContent = ':'
    row.appendChild(colon)
  }

  if (kind === 'object' || kind === 'array') {
    const entries = kind === 'array' ? (value as unknown[]).entries() : Object.entries(value as object)
    const all = [...entries]
    const open = isRoot || depth < AUTO_OPEN_DEPTH

    const details = document.createElement('details')
    details.className = 'jt-node'
    details.open = open

    const summary = document.createElement('summary')
    const badge = document.createElement('span')
    badge.className = 'jt-badge'
    badge.textContent = kind === 'array' ? `[${all.length}]` : `{${all.length}}`
    const preview = document.createElement('span')
    preview.className = 'jt-preview'
    preview.textContent = kind === 'array' ? (all.length > 0 ? ' …' : ' empty') : (all.length > 0 ? ' …' : ' empty')
    summary.append(badge, preview)

    const children = document.createElement('div')
    children.className = 'jt-children'

    let shown = 0
    for (const [childKey, childValue] of all) {
      if (shown >= MAX_NODES || depth + 1 > MAX_DEPTH) {
        budget.truncated = true
        break
      }
      const label = kind === 'array' ? String(childKey) : (childKey as string)
      children.appendChild(renderValue(label, childValue, depth + 1, budget, false))
      shown++
    }

    details.append(summary, children)
    row.appendChild(details)
    return row
  }

  const valueEl = document.createElement('span')
  valueEl.className = `jt-value jt-${kind}`
  valueEl.textContent = scalarText(value, kind)
  row.appendChild(valueEl)
  return row
}

/** Counts without building a tree — used for the summary line before rendering. */
export function describeValue(value: unknown): string {
  const kind = kindOf(value)
  if (kind === 'array') return `array · ${(value as unknown[]).length} items`
  if (kind === 'object') return `object · ${Object.keys(value as object).length} keys`
  return kind
}
