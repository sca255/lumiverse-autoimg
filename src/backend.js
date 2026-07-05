const TAG_REGEX = /\[\[AUTOIMG:\s*([\s\S]*?)\s*\]\]/;
let interceptorRegistered = false;

function sanitizeAlt(text) {
  return String(text).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}

function buildPromptInstruction() {
  return [
    "Image-tag instruction:",
    "Only when an image would materially improve immersion, include exactly one tag in your response:",
    "[[AUTOIMG: detailed visual prompt]]",
    "Do not include the tag in every response.",
    "If an image is unnecessary, do not include the tag at all.",
    "When you do use it, make the prompt concrete (subject, style, setting, lighting, composition)."
  ].join("\n");
}

function registerInterceptorIfPermitted() {
  if (interceptorRegistered || !spindle.permissions.has("interceptor")) return;

  spindle.registerInterceptor(async (messages) => {
    const injected = {
      role: "system",
      content: buildPromptInstruction()
    };
    return [injected, ...messages];
  }, 90);

  interceptorRegistered = true;
  spindle.log.info("[autoimg] Interceptor registered.");
}

async function replaceTagWithImage(chatId, message) {
  if (!message || message.role !== "assistant" || typeof message.content !== "string") return;

  const match = message.content.match(TAG_REGEX);
  if (!match) return;

  if (!spindle.permissions.has("image_gen")) {
    spindle.log.warn("[autoimg] Skipped image generation: missing image_gen permission.");
    return;
  }
  if (!spindle.permissions.has("chat_mutation")) {
    spindle.log.warn("[autoimg] Skipped tag replacement: missing chat_mutation permission.");
    return;
  }

  const prompt = (match[1] || "").trim();
  if (!prompt) {
    spindle.log.warn("[autoimg] Found AUTOIMG tag with empty prompt.");
    return;
  }

  try {
    const result = await spindle.imageGen.generate({
      prompt,
      owner_chat_id: chatId
    });

    const imageRef = result?.imageUrl || result?.imageDataUrl;
    if (!imageRef) {
      throw new Error("Image generation returned no imageUrl/imageDataUrl.");
    }

    const alt = sanitizeAlt(prompt) || "Generated scene image";
    const replacement = `![Generated scene image: ${alt}](${imageRef})`;
    const updatedContent = message.content.replace(match[0], replacement);

    await spindle.chat.updateMessage(chatId, message.id, {
      content: updatedContent,
      metadata: {
        ...(message.metadata || {}),
        autoimg: {
          prompt,
          imageId: result?.imageId || null,
          provider: result?.provider || null,
          model: result?.model || null,
          generatedAt: Date.now()
        }
      }
    });

    spindle.log.info(`[autoimg] Generated image for message ${message.id}.`);
  } catch (err) {
    spindle.log.error(`[autoimg] Image generation failed: ${err?.message || String(err)}`);
  }
}

spindle.on("MESSAGE_SENT", async ({ chatId, message }) => {
  await replaceTagWithImage(chatId, message);
});

spindle.permissions.onChanged(({ permission, granted }) => {
  if (permission === "interceptor" && granted) {
    registerInterceptorIfPermitted();
  }
});

spindle.permissions.onDenied(({ permission, operation }) => {
  spindle.log.warn(`[autoimg] Permission denied: ${permission} for ${operation}`);
});

registerInterceptorIfPermitted();
spindle.log.info("[autoimg] Extension loaded.");
