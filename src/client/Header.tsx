import { useMemo, type ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReviseFace } from './controller.ts'
import { snapshotUserMessages } from './messages.ts'
import { Revise } from './Revise.tsx'
import styles from './Header.module.css'

type HeaderProps = PropsRuntime<'conversation.session.header.actions'> & InjectFace<ReviseFace>

export function Header({ useSession, stop, edit }: HeaderProps): ReactNode {
  const running = useSession(snapshot => snapshot.running)
  const nodes = useSession(snapshot => snapshot.nodes)
  const messages = useMemo(() => snapshotUserMessages(nodes), [nodes])

  return (
    <>
      <Revise messages={messages} edit={edit} />
      {running
        ? (
          <div className={styles['root']}>
            <button
              type="button"
              className={styles['stop']}
              title="停止当前回复，之后可点修改并重新发送"
              onClick={() => { void stop() }}
            >
              ■ 停止
            </button>
          </div>
        )
        : null}
    </>
  )
}
