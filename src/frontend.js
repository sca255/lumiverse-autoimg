export function setup(ctx) {
  ctx.sendToBackend({ type: 'register_user', baseUrl: window.location.origin })

  async function fetchAvatarForChat(chatId, characterId) {
    try {
      if (!characterId) {
        const chatResp = await fetch(`/api/v1/chats/${chatId}`)
        if (!chatResp.ok) return
        const chatData = await chatResp.json()
        characterId = chatData.character_id || chatData.characterId
      }
      if (!characterId) return

      const charResp = await fetch(`/api/v1/characters/${characterId}`)
      if (!charResp.ok) return
      const charData = await charResp.json()
      const imageId = charData.image_id || charData.imageId
      if (!imageId) return

      const imgResp = await fetch(`/api/v1/images/${imageId}`)
      if (!imgResp.ok) return
      const buf = await imgResp.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      const dataUrl = `data:${imgResp.headers.get('content-type') || 'image/png'};base64,${btoa(binary)}`
      ctx.sendToBackend({ type: 'avatar_data', chatId, base64: dataUrl })
    } catch (e) {
      // silent — text2img fallback
    }
  }

  const unsubGenStart = ctx.events.on('GENERATION_STARTED', (payload) => {
    if (payload?.chatId && payload?.characterId) {
      fetchAvatarForChat(payload.chatId, payload.characterId)
    }
  })

  const unsubSwitch = ctx.events.on('CHAT_SWITCHED', (payload) => {
    if (payload?.chatId) {
      ctx.sendToBackend({ type: 'register_user', baseUrl: window.location.origin })
      fetchAvatarForChat(payload.chatId, payload.characterId)
    }
  })

  return () => { unsubGenStart(); unsubSwitch() }
}
