let interceptorRegistered = false;

function sanitizeAlt(text) {
  return String(text).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}

function buildPromptInstruction() {
  return [
    "## Image Generation Trigger",
    "Generate images using this EXACT format:",
    "[[AUTOIMG: danbooru_tags, more_tags, even_more_tags. Brief composition sentence.]]",
    "",
    "### DANBOORU TAG FORMAT (strict rules):",
    "- ALL tags are lowercase with underscores: 1girl, long_hair, blue_eyes",
    "- NO spaces in tags - use underscores only",
    "- Tags separated by commas",
    "- Order: character \u2192 appearance \u2192 clothing \u2192 pose \u2192 expression \u2192 setting \u2192 style",
    "- End with ONE sentence describing composition/lighting/mood",
    "- NO natural language in the tag section - only valid Danbooru tags",
    "",
    "### TAG ORDER EXAMPLES:",
    "Character: 1girl, 1boy, multiple_girls",
    "Hair: blonde_hair, long_hair, ponytail, twintails",
    "Eyes: blue_eyes, green_eyes, heterochromia",
    "Body: tanned_skin, pale_skin, muscular, slim",
    "Clothing: dress, armor, school_uniform, swimsuit",
    "Pose: standing, sitting, kneeling, lying_down, action_pose",
    "Expression: smile, blush, serious, crying, open_mouth",
    "Setting: indoors, outdoors, forest, city, bedroom, throne_room",
    "Style: masterpiece, best_quality, highly_detailed, anime_style",
    "",
    "### WHEN TO USE:",
    "- New scene or location description",
    "- Character appearance reveal",
    "- Dramatic visual moment",
    "- User asks to see something",
    "",
    "### WHEN NOT TO USE:",
    "- Regular dialogue or text responses",
    "- Concepts without visual element",
    "- Scene already established",
    "",
    "### FORMAT RULES:",
    "- ONE tag per message only",
    "- Tag on its OWN LINE",
    "- Text response continues after tag",
    "",
    "### EXAMPLES:",
    "",
    "User: 'Show me the library'",
    "Response: [[AUTOIMG: library, ancient_books, wooden_shelves, stained_glass, dust_particles, sunlight_beams, high_ceiling, fantasy, ornate_architecture, vast_interior. Warm sunlight through stained glass, golden light on ancient books.]]",
    "The library stretches upward indefinitely...",
    "",
    "User: 'Show my character'",
    "Response: [[AUTOIMG: 1girl, silver_hair, long_hair, blue_eyes, leather_armor, intricate_engravings, standing, moonlit_forest, forest_clearing, night, fantasy, confident_pose, detailed_portrait, upper_body. Moonlight catches silver hair, armor gleams softly.]]",
    "She stands ready, determination in her eyes...",
    "",
    "User: 'What does the throne room look like?'",
    "Response: [[AUTOIMG: throne_room, grand_hall, marble_pillars, red_carpet, chandelier, dramatic_lighting, high_ceiling, medieval_fantasy, ornate_decorations, vast_interior. Crystal chandeliers cast dramatic shadows across marble.]]",
    "The throne room opens before you, vast and imposing..."
  ].join("\n");
}

function registerInterceptorIfPermitted() {
  if (interceptorRegistered) return;
  if (!spindle.permissions.has("interceptor")) return;

  spindle.registerInterceptor(async (messages) => {
    return [{ role: "system", content: buildPromptInstruction() }, ...messages];
  }, 95);

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
