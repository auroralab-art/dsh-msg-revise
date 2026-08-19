function blockText(block: unknown): string | undefined {
  if (typeof block !== 'object' || block === null) return undefined
  const text = (block as { text?: unknown }).text
  return typeof text === 'string' ? text : undefined
}

function assistantHasToken(node: {
  kind: string
  timing?: { firstTokenTime?: number | null }
  blocks?: readonly unknown[]
}): boolean {
  if (node.kind !== 'assistant') return false
  if (node.timing?.firstTokenTime != null) return true
  return node.blocks?.some(block => (blockText(block)?.length ?? 0) > 0) === true
}

/** TTFT of the turn after the last user node. Prior replies do not count. */
export function snapshotHasFirstToken(snapshot: {
  partial: { blocks: readonly unknown[] } | null
  nodes: readonly {
    kind: string
    timing?: { firstTokenTime?: number | null }
    blocks?: readonly unknown[]
  }[]
}): boolean {
  let lastUser = -1
  for (let index = 0; index < snapshot.nodes.length; index += 1) {
    if (snapshot.nodes[index]?.kind === 'user') lastUser = index
  }
  for (let index = lastUser + 1; index < snapshot.nodes.length; index += 1) {
    const node = snapshot.nodes[index]
    if (node === undefined) continue
    if (node.kind === 'user') break
    if (assistantHasToken(node)) return true
  }
  return snapshot.partial?.blocks.some(block => (blockText(block)?.length ?? 0) > 0) === true
}

/** Native composer stop (or any idle edge) before the last turn's first token. */
export function shouldUnsendOnIdle(
  wasRunning: boolean | undefined,
  running: boolean,
  hasFirstToken: boolean,
): boolean {
  return wasRunning === true && running === false && !hasFirstToken
}
