export function setup(ctx) {
  ctx.sendToBackend({ type: 'register_user' })

  const unsubSwitch = ctx.events.on('CHAT_SWITCHED', (payload) => {
    if (payload.chatId) {
      ctx.sendToBackend({ type: 'register_user' })
    }
  })

  const unsubAvatar = ctx.events.on('CHARACTER_AVATAR_CHANGED', (payload) => {
    if (payload.chatId && payload.imageId) {
      ctx.sendToBackend({ type: 'avatar_changed', chatId: payload.chatId, imageId: payload.imageId })
    }
  })

  return () => { unsubSwitch(); unsubAvatar() }
}
