export function setup(ctx) {
  ctx.sendToBackend({ type: 'register_user', baseUrl: window.location.origin })

  async function callNativeGen(chatId, prompt) {
    const native = await (await fetch('/api/v1/settings/imageGeneration')).json()
    const body = {
      ...(native?.value || native),
      prompt,
      chatId,
      forceGeneration: true,
      skipParse: true,
    }
    const resp = await fetch('/api/v1/image-gen/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!resp.ok) throw new Error(await resp.text())
    const r = await resp.json()
    if (!r.generated) throw new Error(r.reason || 'Generation skipped')
    if (!r.imageId) throw new Error('Image not persisted')
    return r
  }

  const unsubEnded = ctx.events.on('GENERATION_ENDED', async (p) => {
    if (p?.error || typeof p?.content !== 'string') return
    const m = p.content.match(/\[\[AUTOIMG:\s*([\s\S]*?)\s*\]\]/)
    if (!m) return
    const prompt = (m[1] || '').trim()
    if (!prompt) return
    try {
      const r = await callNativeGen(p.chatId, prompt)
      ctx.sendToBackend({
        type: 'autoimg_result',
        chatId: p.chatId,
        messageId: p.messageId,
        imageId: r.imageId,
        imageUrl: r.imageUrl || `/api/v1/image-gen/results/${r.imageId}`,
        originalTag: m[0],
        prompt,
      })
    } catch (e) {}
  })

  return () => { unsubEnded() }
}
