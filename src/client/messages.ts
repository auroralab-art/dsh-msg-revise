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
