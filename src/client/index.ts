import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { VIEW_ORDER } from '../shared.ts'
import { ReviseController } from './controller.ts'
import { Header } from './Header.tsx'

export const inject = ['slots', 'conversation', 'connection', 'sessions']

export function apply(ctx: ClientContext): void {
  const controllers = new Map<SessionId, ReviseController>()
  const controllerFor = (sessionId: SessionId): ReviseController => {
    let controller = controllers.get(sessionId)
    if (controller === undefined) {
      controller = new ReviseController(ctx, sessionId)
      controllers.set(sessionId, controller)
    }
    return controller
  }

  ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'msg-revise-controls',
    order: VIEW_ORDER,
    inject: (sessionId: SessionId) => controllerFor(sessionId).face,
  }, Header)
}
