/**
 * Injects 修改 on each matched user row. The editor replaces the bubble
 * text in place — it does not open a page-level dialog.
 */
import { useEffect } from 'react'
import { pickUserBlock } from '../match.ts'
import type { EditableUserMessage } from '../shared.ts'
import type { ReviseFace } from './controller.ts'
import styles from './Revise.module.css'

const STYLE = {
  inline: styles['inline'] ?? '',
  input: styles['input'] ?? '',
  footer: styles['footer'] ?? '',
  chip: styles['chip'] ?? '',
  save: styles['save'] ?? '',
  cancel: styles['cancel'] ?? '',
}

type EditorCleanup = () => void

function userRowOf(flow: Element): HTMLElement | undefined {
  const row = flow.querySelector('[data-time-hover-root]')
  return row instanceof HTMLElement ? row : undefined
}

/** The text bubble inside a user flow item (sibling stack of the action row). */
export function findBubble(flow: Element): HTMLElement | undefined {
  const row = userRowOf(flow)
  const stack = row?.firstElementChild
  if (!(stack instanceof HTMLElement)) return undefined
  for (let index = stack.children.length - 1; index >= 0; index -= 1) {
    const child = stack.children[index]
    if (!(child instanceof HTMLElement)) continue
    if (child.dataset.dshMsgReviseEditor === '1') continue
    const className = child.className
    if (typeof className === 'string' && className.includes('bubble')) return child
  }
  const last = stack.lastElementChild
  return last instanceof HTMLElement ? last : undefined
}

function mountEditor(
  flow: Element,
  block: EditableUserMessage,
  draft: string,
  edit: ReviseFace['edit'],
  close: () => void,
  onDraft: (text: string) => void,
): EditorCleanup {
  const bubble = findBubble(flow)
  if (bubble === undefined) return () => {}

  const hidden: HTMLElement[] = []
  for (const child of Array.from(bubble.children)) {
    if (!(child instanceof HTMLElement)) continue
    if (child.dataset.dshMsgReviseEditor === '1') {
      child.remove()
      continue
    }
    child.hidden = true
    hidden.push(child)
  }

  const editor = document.createElement('div')
  editor.className = STYLE.inline
  editor.dataset.dshMsgReviseEditor = '1'
  const input = document.createElement('textarea')
  input.className = STYLE.input
  input.value = draft
  input.setAttribute('aria-label', '修改提问')
  const footer = document.createElement('div')
  footer.className = STYLE.footer
  const save = document.createElement('button')
  save.type = 'button'
  save.className = STYLE.save
  save.textContent = '重新发送'
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.className = STYLE.cancel
  cancel.textContent = '取消'
  footer.append(cancel, save)
  editor.append(input, footer)
  bubble.appendChild(editor)

  const chip = flow.querySelector<HTMLElement>('[data-dsh-msg-revise-btn="1"]')
  if (chip !== null) chip.hidden = true

  const autoSize = (): void => {
    input.style.height = 'auto'
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 24), 360)}px`
  }
  input.addEventListener('input', () => {
    onDraft(input.value)
    autoSize()
  })
  input.focus()
  input.setSelectionRange(input.value.length, input.value.length)
  autoSize()

  let mounted = true
  let saving = false
  const saveEdit = (): void => {
    if (saving) return
    saving = true
    save.disabled = true
    void edit(block, input.value).then((applied) => {
      if (!mounted) return
      if (applied) { close(); return }
      saving = false
      save.disabled = false
    })
  }
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close()
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      saveEdit()
    }
  }
  save.addEventListener('click', saveEdit)
  cancel.addEventListener('click', close)
  input.addEventListener('keydown', onKey)
  return () => {
    mounted = false
    save.removeEventListener('click', saveEdit)
    cancel.removeEventListener('click', close)
    input.removeEventListener('keydown', onKey)
    editor.remove()
    for (const child of hidden) child.hidden = false
    if (chip !== null) chip.hidden = false
  }
}

export function Revise({
  messages,
  edit,
}: {
  messages: readonly EditableUserMessage[]
  edit: ReviseFace['edit']
}): null {
  useEffect(() => {
    const cleanups: Array<() => void> = []
    let active: EditorCleanup | undefined
    let activeSeq: number | undefined
    let draft = ''

    const closeEditor = (): void => {
      active?.()
      active = undefined
      activeSeq = undefined
      draft = ''
    }

    const editBlock = (flow: Element, block: EditableUserMessage, initial: string): void => {
      active?.()
      draft = initial
      activeSeq = block.eventSeq
      active = mountEditor(flow, block, draft, edit, closeEditor, (text) => { draft = text })
    }

    const sync = (): void => {
      const claimed = new Set<number>()
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-chat-flow-kind="user"] [class*="actions"]'))
      for (const row of rows) {
        const existing = row.querySelector<HTMLElement>('[data-dsh-msg-revise-btn="1"]')
        if (row.dataset.dshMsgRevise === '1' && existing !== null) {
          const seq = Number(row.dataset.dshMsgReviseSeq)
          if (Number.isFinite(seq)) claimed.add(seq)
          continue
        }
        if (row.dataset.dshMsgRevise === '1' && existing === null) {
          delete row.dataset.dshMsgRevise
          delete row.dataset.dshMsgReviseSeq
        }
        const flow = row.closest('[data-chat-flow-kind="user"]')
        if (flow === null) continue
        const text = (flow.textContent ?? '').trim()
        const block = pickUserBlock(text, messages, claimed)
        if (block === undefined) continue
        claimed.add(block.eventSeq)
        const button = document.createElement('button')
        button.type = 'button'
        button.className = STYLE.chip
        button.dataset.dshMsgReviseBtn = '1'
        button.setAttribute('aria-label', '修改')
        button.title = '在这条消息里修改后重新发送'
        button.textContent = '修改'
        const open = (event: Event): void => {
          event.preventDefault()
          event.stopPropagation()
          editBlock(flow, block, block.text)
        }
        button.addEventListener('click', open)
        const official = Array.from(row.querySelectorAll('button')).at(-1)
        if (official !== undefined) official.insertAdjacentElement('afterend', button)
        else row.appendChild(button)
        row.dataset.dshMsgRevise = '1'
        row.dataset.dshMsgReviseSeq = String(block.eventSeq)
        cleanups.push(() => {
          button.removeEventListener('click', open)
          button.remove()
          delete row.dataset.dshMsgRevise
          delete row.dataset.dshMsgReviseSeq
        })
      }

      if (activeSeq === undefined) return
      const live = document.querySelector(`[data-chat-flow-kind="user"] [data-dsh-msg-revise-seq="${String(activeSeq)}"]`)
      const flow = live?.closest('[data-chat-flow-kind="user"]')
      if (flow === null || flow === undefined) return
      if (findBubble(flow)?.querySelector('[data-dsh-msg-revise-editor="1"]') !== null) return
      const block = messages.find(message => message.eventSeq === activeSeq)
      if (block !== undefined) editBlock(flow, block, draft || block.text)
    }

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      closeEditor()
      for (const cleanup of cleanups.reverse()) cleanup()
    }
  }, [messages, edit])

  return null
}
