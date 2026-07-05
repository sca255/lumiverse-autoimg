const TAG_REGEX = /\[\[AUTOIMG:\s*([\s\S]*?)\s*\]\]/;
const LORA_SUFFIX = "<lora:Anima Turbo LoRA v0.2:1>";
let interceptorRegistered = false;
let storedUserId = null;

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
    "### EXAMPLES:",
    "",
    "User: 'Show me the ancient library'",
    "Response: [[AUTOIMG: library, ancient_books, wooden_shelves, stained_glass, dust_particles, sunlight_beams, high_ceiling, fantasy, ornate_architecture, vast_interior. Warm sunlight filters through stained glass windows, casting colorful patterns across towering shelves filled with ancient leather-bound books.]]",
    "This magnificent library stretches upward indefinitely...",
    "",
    "User: 'Show me my character'",
    "Response: [[AUTOIMG: 1girl, silver_hair, long_hair, blue_eyes, leather_armor, intricate_engravings, standing, moonlit_forest, forest_clearing, night, fantasy, confident_pose, detailed_portrait, upper_body. She stands in a moonlit clearing, silver hair catching the light.]]",
    "She adjusts her armor and looks at you with determination...",
    "",
    "User: 'What does the throne room look like?'",
    "Response: [[AUTOIMG: throne_room, grand_hall, marble_pillars, red_carpet, chandelier, dramatic_lighting, high_ceiling, medieval_fantasy, ornate_decorations. She steps into the grand throne room, the red carpet stretching before her beneath the glow of crystal chandeliers.]]",
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

spindle.onFrontendMessage(async (payload, userId) => {
  if (payload.type === 'register_user') {
    storedUserId = userId;
    spindle.log.info(`[autoimg] userId registered from frontend: ${userId}`);
  }
});

async function replaceTagWithImage(chatId, message) {
  spindle.log.info(`[autoimg] replaceTagWithImage called. chatId: ${chatId}`);
  
  if (!message) {
    spindle.log.info(`[autoimg] Skipping: message is null/undefined`);
    return;
  }

  const content = message.content;
  const messageId = message.id;
  
  spindle.log.info(`[autoimg] Message ID: ${messageId}, content type: ${typeof content}`);
  
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
  
  const imagePrompt = prompt;
  spindle.log.info(`[autoimg] Extracted prompt: ${imagePrompt.substring(0, 100)}...`);
  const generationPrompt = withRequiredLoraSuffix(imagePrompt);

  if (!storedUserId) {
    spindle.log.error("[autoimg] Cannot generate image: userId not available. Make sure the frontend module is loaded.");
    return;
  }

  let initImage = null;
  try {
    const chat = await spindle.chats.get(chatId);
    if (chat && chat.character_id) {
      const character = await spindle.characters.get(chat.character_id);
      if (character && character.avatar) {
        initImage = character.avatar;
        spindle.log.info(`[autoimg] Using character avatar as init_image: ${initImage}`);
      }
    }
  } catch (e) {
    spindle.log.info(`[autoimg] Could not get character avatar: ${e.message}`);
  }

  try {
    spindle.log.info(`[autoimg] Calling imageGen.generate with userId: ${storedUserId}`);
    
    const generateParams = {
      prompt: generationPrompt,
      owner_chat_id: chatId,
      userId: storedUserId
    };
    
    if (initImage) {
      generateParams.parameters = {
        rawRequestOverride: JSON.stringify({
          init_image: initImage
        })
      };
    }
    
    const result = await spindle.imageGen.generate(generateParams);
    spindle.log.info(`[autoimg] Image generation result: ${JSON.stringify(result).substring(0, 200)}...`);

    const imageRef = result?.imageUrl || result?.imageDataUrl;
    if (!imageRef) {
      throw new Error("Image generation returned no imageUrl/imageDataUrl.");
    }

    const alt = sanitizeAlt(imagePrompt) || "Generated scene image";
    const replacement = `${match[0]}\n![${alt}](${imageRef})`;
    const updatedContent = content.replace(match[0], replacement);

    await spindle.chat.updateMessage(chatId, messageId, {
      content: updatedContent,
      metadata: {
        autoimg: {
          prompt: imagePrompt,
          generationPrompt,
          initImage,
          imageId: result?.imageId || null,
          provider: result?.provider || null,
          model: result?.model || null,
          generatedAt: Date.now()
        }
      }
    });

    spindle.log.info(`[autoimg] Generated image for message ${messageId}.`);
  } catch (err) {
    spindle.log.error(`[autoimg] Image generation failed: ${err?.message || String(err)}`);
  }
}

spindle.on("GENERATION_ENDED", async (payload) => {
  spindle.log.info(`[autoimg] GENERATION_ENDED event received`);
  spindle.log.info(`[autoimg] Payload keys: ${Object.keys(payload || {}).join(", ")}`);
  
  const { chatId, messageId, content, error } = payload || {};
  spindle.log.info(`[autoimg] chatId: ${chatId}, messageId: ${messageId}, hasContent: ${typeof content === "string"}, error: ${error}`);
  
  if (error) {
    spindle.log.info(`[autoimg] Skipping due to generation error: ${error}`);
    return;
  }
  
  if (typeof content !== "string") {
    spindle.log.info(`[autoimg] Skipping: content is not a string`);
    return;
  }
  
  const hasAutoimg = content.includes("[[AUTOIMG:");
  spindle.log.info(`[autoimg] Message contains AUTOIMG tag: ${hasAutoimg}`);
  
  if (hasAutoimg) {
    spindle.log.info(`[autoimg] Message content preview: ${content.substring(0, 300)}...`);
    await replaceTagWithImage(chatId, { id: messageId, content, role: "assistant" });
  }
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
spindle.log.info("[autoimg] Extension loaded. Waiting for userId from frontend...");
