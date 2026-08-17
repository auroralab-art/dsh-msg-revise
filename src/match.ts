import type { EditableUserMessage } from './shared.ts'

/** Needle used to claim a message action row for one user block. */
export function matchNeedle(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= 64) return trimmed
  return trimmed.slice(0, 48)
}

/**
 * Claim the first unclaimed user block whose needle appears in the action-row
 * ancestor text. Sequential claiming keeps two similar prompts from colliding.
 */
export function pickUserBlock(
  rowText: string,
  users: readonly EditableUserMessage[],
  claimed: ReadonlySet<number>,
): EditableUserMessage | undefined {
  const haystack = rowText.trim()
  if (haystack.length === 0) return undefined
  for (const user of users) {
    if (claimed.has(user.eventSeq)) continue
    if (user.text.trim().length === 0) continue
    if (haystack.includes(matchNeedle(user.text))) return user
  }
  return undefined
}
