import { useMemo, type ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReviseFace } from './controller.ts'
import { revisableAfterStop, snapshotUserMessages } from './messages.ts'
import { Revise } from './Revise.tsx'

type HeaderProps = PropsRuntime<'conversation.session.header.actions'> & InjectFace<ReviseFace>

/** Mounts the pencil only. Native composer owns stop. */
export function Header({ useSession, edit }: HeaderProps): ReactNode {
  const running = useSession(snapshot => snapshot.running)
  const nodes = useSession(snapshot => snapshot.nodes)
  const messages = useMemo(() => snapshotUserMessages(nodes), [nodes])
  const allowed = useMemo(() => revisableAfterStop(nodes, messages, running), [nodes, messages, running])
  return <Revise allowed={allowed} edit={edit} />
}
