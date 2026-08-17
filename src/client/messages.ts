import type { EditableUserMessage } from '../shared.ts'

interface UserNode {
  kind: 'user'
  seq: number
  time: number
  content: ReadonlyArray<{ type: string; text?: string }>
}

interface AssistantNode {
  kind: 'assistant'
  turn: number
  interrupted?: true
}

type ConversationNode = UserNode | AssistantNode | { kind: string }

/** Zero-latency user blocks from the live conversation snapshot. */
export function snapshotUserMessages(nodes: readonly ConversationNode[]): EditableUserMessage[] {
  const result: EditableUserMessage[] = []
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (node === undefined || node.kind !== 'user') continue
    const user = node as UserNode
    let turn = 0
    for (let next = index + 1; next < nodes.length; next += 1) {
      const candidate = nodes[next]
      if (candidate?.kind === 'assistant') {
        turn = (candidate as AssistantNode).turn
        break
      }
      if (candidate?.kind === 'user') break
    }
    for (const [blockIndex, block] of user.content.entries()) {
      if (block.type !== 'text' || typeof block.text !== 'string') continue
      result.push({
        key: `${user.seq}:${blockIndex}`,
        turn,
        eventSeq: user.seq,
        blockIndex,
        text: block.text,
        time: user.time,
      })
    }
  }
  return result
}

/**
 * Pencil is only for the last user prompt after the turn was stopped
 * (or never completed). Finished Q&A rows stay icon-free.
 */
export function revisableAfterStop(
  nodes: readonly ConversationNode[],
  users: readonly EditableUserMessage[],
  running: boolean,
): EditableUserMessage | undefined {
  if (running) return undefined
  const last = users.at(-1)
  if (last === undefined) return undefined
  let lastUserIndex = -1
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (node?.kind === 'user' && (node as UserNode).seq === last.eventSeq) lastUserIndex = index
  }
  if (lastUserIndex < 0) return last
  for (let index = lastUserIndex + 1; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (node?.kind === 'user') break
    if (node?.kind === 'assistant' && (node as AssistantNode).interrupted !== true) return undefined
  }
  return last
}
