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
    "### PROMPT STYLE: Danbooru Tags + Natural Description",
    "Structure your image prompts using DANBOORU-STYLE TAGS for key elements,",
    "followed by a natural description for mood, composition, and lighting.",
    "",
    "Tag format rules:",
    "- Use lowercase, underscore-separated tags (e.g. 1girl, long_hair, blue_eyes)",
    "- List tags in order: subject → appearance → clothing → pose → setting → style",
    "- Separate tags with commas",
    "- Add a natural language sentence after the tags for atmosphere and composition",
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
    "",
    "### EXAMPLES of good usage:",
    "",
    "User: 'What does the ancient library look like?'",
    "Response: [[AUTOIMG: library, ancient_books, wooden_shelves, stained_glass, dust_particles, sunlight_beams, high_ceiling, fantasy, ornate_architecture, vast_interior. Warm sunlight filters through stained glass windows, casting colorful patterns across towering shelves filled with ancient leather-bound books. Dust motes float in the golden light, magical atmosphere, cinematic composition.]]",
    "This magnificent library stretches upward indefinitely...",
    "",
    "User: 'Show me my character'",
    "Response: [[AUTOIMG: 1girl, silver_hair, long_hair, blue_eyes, leather_armor, intricate_engravings, standing, moonlit_forest, forest_clearing, night, fantasy, confident_pose, detailed_portrait, upper_body. She stands in a moonlit clearing, silver hair catching the light, her leather armor detailed with intricate engravings. A confident expression on her face as she looks directly at you.]]",
    "She adjusts her armor and looks at you with determination...",
    "",
    "User: 'Describe the scene as she enters the throne room'",
    "Response: [[AUTOIMG: throne_room, grand_hall, marble_pillars, red_carpet, chandelier, dramatic_lighting, high_ceiling, medieval_fantasy, ornate_decorations. She steps into the grand throne room, the red carpet stretching before her beneath the glow of crystal chandeliers. Dramatic shadows play across marble pillars as she approaches with grace.]]",
    "The throne room opens before her, vast and imposing..."
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
  if (interceptorRegistered) {
    spindle.log.info("[autoimg] Interceptor already registered.");
    return;
  }
  if (!spindle.permissions.has("interceptor")) {
    spindle.log.warn("[autoimg] Cannot register interceptor: missing interceptor permission.");
    return;
  }

  spindle.registerInterceptor(async (messages) => {
    const injected = {
      role: "system",
      content: buildPromptInstruction()
    };
    return [injected, ...messages];
  }, 95);

  interceptorRegistered = true;
  spindle.log.info("[autoimg] Interceptor registered successfully.");
}

async function replaceTagWithImage(chatId, message) {
  spindle.log.info(`[autoimg] replaceTagWithImage called. chatId: ${chatId}`);
  
  if (!message) {
    spindle.log.info(`[autoimg] Skipping: message is null/undefined`);
    return;
  }

  // Try to extract content from different possible structures
  let content = message.content;
  if (typeof content === "object" && content !== null) {
    content = content?.text || content?.content || JSON.stringify(content);
  }
  
  // Also check if role is nested differently
  const role = message.role || message.author || message.sender;
  spindle.log.info(`[autoimg] Extracted role: ${role}, content type: ${typeof content}`);
  
  if (typeof content !== "string") {
    spindle.log.info(`[autoimg] Skipping: content is not a string`);
    return;
  }

  const match = content.match(TAG_REGEX);
  if (!match) {
    spindle.log.info(`[autoimg] No AUTOIMG tag found in message content`);
    return;
  }
  spindle.log.info(`[autoimg] Found AUTOIMG tag match: ${match[0].substring(0, 100)}...`);

  if (!spindle.permissions.has("image_gen")) {
    spindle.log.warn("[autoimg] Skipped image generation: missing image_gen permission.");
    return;
  }
  if (!spindle.permissions.has("chat_mutation")) {
    spindle.log.warn("[autoimg] Skipped tag replacement: missing chat_mutation permission.");
    return;
  }
  spindle.log.info(`[autoimg] Permissions OK. image_gen: ${spindle.permissions.has("image_gen")}, chat_mutation: ${spindle.permissions.has("chat_mutation")}`);

  const prompt = (match[1] || "").trim();
  if (!prompt) {
    spindle.log.warn("[autoimg] Found AUTOIMG tag with empty prompt.");
    return;
  }
  spindle.log.info(`[autoimg] Extracted prompt: ${prompt.substring(0, 100)}...`);
  const generationPrompt = withRequiredLoraSuffix(prompt);

  try {
    spindle.log.info(`[autoimg] Calling imageGen.generate...`);
    const result = await spindle.imageGen.generate({
      prompt: generationPrompt,
      owner_chat_id: chatId
    });
    spindle.log.info(`[autoimg] Image generation result: ${JSON.stringify(result).substring(0, 200)}...`);

    const imageRef = result?.imageUrl || result?.imageDataUrl;
    if (!imageRef) {
      throw new Error("Image generation returned no imageUrl/imageDataUrl.");
    }

    const alt = sanitizeAlt(prompt) || "Generated scene image";
    const replacement = `![Generated scene image: ${alt}](${imageRef})`;
    const updatedContent = content.replace(match[0], replacement);

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
  spindle.log.info(`[autoimg] MESSAGE_SENT event received. chatId: ${chatId}`);
  spindle.log.info(`[autoimg] Message keys: ${Object.keys(message || {}).join(", ")}`);
  spindle.log.info(`[autoimg] Message type: ${typeof message}, role: ${message?.role}, content type: ${typeof message?.content}`);
  
  // Try to extract content from different possible structures
  let content = message?.content;
  if (typeof content === "object" && content !== null) {
    content = content?.text || content?.content || JSON.stringify(content);
    spindle.log.info(`[autoimg] Extracted content from object: ${typeof content}`);
  }
  
  if (typeof content === "string") {
    const hasAutoimg = content.includes("[[AUTOIMG:");
    spindle.log.info(`[autoimg] Message contains AUTOIMG tag: ${hasAutoimg}`);
    if (hasAutoimg) {
      spindle.log.info(`[autoimg] Message content preview: ${content.substring(0, 300)}...`);
    }
  }
  
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

spindle.log.info("[autoimg] Extension loading...");
spindle.log.info(`[autoimg] Available permissions: interceptor=${spindle.permissions.has("interceptor")}, image_gen=${spindle.permissions.has("image_gen")}, chat_mutation=${spindle.permissions.has("chat_mutation")}`);
registerInterceptorIfPermitted();
spindle.log.info("[autoimg] Extension loaded.");
