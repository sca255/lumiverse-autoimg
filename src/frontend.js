export function setup(ctx) {
  ctx.sendToBackend({ type: 'register_user' })

  const unsub = ctx.events.on('CHAT_SWITCHED', (payload) => {
    if (payload.chatId) {
      ctx.sendToBackend({ type: 'register_user' })
    }
  })

  return () => { unsub() }
}
