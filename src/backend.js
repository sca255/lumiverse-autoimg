let interceptorRegistered = false;

function sanitizeAlt(text) {
  return String(text).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}

function buildPromptInstruction() {
  return [
    "You MAY very rarely use [[AUTOIMG: danbooru_tags. sentence.]] to generate an image — at most once per ~15 messages, for pivotal scene-establishing moments only.",
    "",
    "### DANBOORU FORMAT: lowercase_underscored_tags, ordered_by_importance. End with one brief composition sentence.",
    "- Character, appearance, clothing, pose, expression, setting, style",
    "- Example: [[AUTOIMG: ancient_library, wooden_shelves, stained_glass, dust_motes, sunlight_beams, vast_interior. Golden light through tall windows illuminates floating dust.]]",
    "",
    "### WHEN: Only when a new scene or character first appears. Never for established scenes, never because a previous message had an image, never for dialogue.",
    "### WHEN NOT: Never use it. If in doubt, omit it. This should fire at most once in a blue moon for first-time visual establishment."
  ].join("\n");
}

function registerInterceptorIfPermitted() {
  if (interceptorRegistered) return;
  if (!spindle.permissions.has("interceptor")) return;

  spindle.registerInterceptor(async (messages) => {
    return [{ role: "system", content: buildPromptInstruction() }, ...messages];
  }, 10);

  interceptorRegistered = true;
  spindle.log.info("[autoimg] Interceptor registered.");
}

spindle.onFrontendMessage(async (payload) => {
  if (payload.type === 'autoimg_result') {
    if (!spindle.permissions.has("chat_mutation")) return;

    const { chatId, messageId, imageId, imageUrl, originalTag, prompt, genPrompt } = payload;

    try {
      const messages = await spindle.chat.getMessages(chatId);
      const msg = messages.find(m => m.id === messageId);
      if (!msg || typeof msg.content !== 'string' || !msg.content.includes(originalTag)) return;

      const alt = sanitizeAlt(prompt) || "Generated scene image";
      const updated = msg.content.replace(originalTag, `${originalTag}\n![${alt}](${imageUrl})`);

      await spindle.chat.updateMessage(chatId, messageId, {
        content: updated,
        metadata: {
          autoimg: {
            prompt,
            genPrompt,
            imageId,
            generatedAt: Date.now(),
          },
        },
      });

      spindle.log.info(`[autoimg] Inserted image ${imageId} into message ${messageId}`);
    } catch (err) {
      spindle.log.error(`[autoimg] Message update failed: ${err?.message || String(err)}`);
    }
  }
});

spindle.permissions.onChanged(({ permission, granted }) => {
  if (permission === "interceptor" && granted) registerInterceptorIfPermitted();
});

spindle.permissions.onDenied(({ permission, operation }) => {
  spindle.log.warn(`[autoimg] Permission denied: ${permission} for ${operation}`);
});

spindle.log.info("[autoimg] Extension loading...");
registerInterceptorIfPermitted();
spindle.log.info("[autoimg] Extension loaded.");
