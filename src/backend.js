const TAG_REGEX = /\[\[AUTOIMG:\s*([\s\S]*?)\s*\]\]/;
const LORA_SUFFIX = "<lora:Anima Turbo LoRA v0.2:1>";
let interceptorRegistered = false;

function sanitizeAlt(text) {
  return String(text).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}

function buildPromptInstruction() {
  return [
    "## Image Generation Trigger",
    "You have the ability to generate images using this EXACT tag format:",
    "[[AUTOIMG: your image prompt here]]",
    "",
    "### WHEN TO USE the image tag:",
    "- Describing a new scene, location, or environment",
    "- Introducing a character appearance or outfit for the first time",
    "- A dramatic moment that benefits from visual context",
    "- The user asks to see something visual",
    "- Creating atmosphere for a new setting",
    "",
    "### WHEN NOT TO USE:",
    "- Continuing a conversation without new visual elements",
    "- Explaining concepts, feelings, or dialogue",
    "- The scene is already established and no new visuals are introduced",
    "",
    "### FORMAT RULES:",
    "- Include ONLY ONE tag per message",
    "- The tag must appear on its OWN LINE",
    "- After the tag, continue your text response normally",
    "- Make the image prompt detailed: include subject, style, lighting, mood, composition",
    "",
    "### EXAMPLES of good usage:",
    "User: 'What does the ancient library look like?'",
    "Response: [[AUTOIMG: A vast ancient library with towering wooden shelves, dust motes floating in warm sunlight filtering through stained glass windows, old leather-bound books, ornate reading desks, magical atmosphere, fantasy art style]]",
    "This magnificent library stretches upward indefinitely...",
    "",
    "User: 'Show me my character'",
    "Response: [[AUTOIMG: A young woman with silver hair and blue eyes, wearing leather armor with intricate engravings, standing in a moonlit forest clearing, confident stance, detailed character portrait, anime style]]",
    "She adjusts her armor and looks at you with determination..."
  ].join("\n");
}

function withRequiredLoraSuffix(prompt) {
  const trimmed = String(prompt || "").trim();
  if (!trimmed) return LORA_SUFFIX;

  // Preserve existing character LoRAs/tags and only normalize this required LoRA.
  const withoutRequiredSuffix = trimmed.split(LORA_SUFFIX).join("").trim();
  if (!withoutRequiredSuffix) return LORA_SUFFIX;

  return `${withoutRequiredSuffix} ${LORA_SUFFIX}`;
}

function registerInterceptorIfPermitted() {
  if (interceptorRegistered || !spindle.permissions.has("interceptor")) return;

  spindle.registerInterceptor(async (messages) => {
    const injected = {
      role: "system",
      content: buildPromptInstruction()
    };
    return [injected, ...messages];
  }, 95);

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
  const generationPrompt = withRequiredLoraSuffix(prompt);

  try {
    const result = await spindle.imageGen.generate({
      prompt: generationPrompt,
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
          generationPrompt,
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
