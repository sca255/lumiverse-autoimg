const TAG_REGEX = /\[\[AUTOIMG:\s*([\s\S]*?)\s*\]\]/;
const IMG2IMG_SEPARATOR = "|";
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
    "### FOR IMG2IMG (use existing image as reference):",
    "[[AUTOIMG: your image prompt here | image_url]]",
    "Use this when you want to modify or continue from an existing image.",
    "The image_url can be any image URL from the conversation.",
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
    "- Modifying or continuing from an existing image (use img2img format)",
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
    "User: 'Make her smile instead'",
    "Response: [[AUTOIMG: 1girl, silver_hair, long_hair, blue_eyes, leather_armor, intricate_engravings, standing, moonlit_forest, forest_clearing, night, fantasy, smile, happy_expression, detailed_portrait, upper_body. She stands in a moonlit clearing, silver hair catching the light, her leather armor detailed with intricate engravings. A warm smile on her face as she looks at you. | https://example.com/previous-image.png]]",
    "Her expression softens into a gentle smile..."
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
  
  let imagePrompt = prompt;
  let initImage = null;
  
  const separatorIndex = prompt.lastIndexOf(IMG2IMG_SEPARATOR);
  if (separatorIndex !== -1) {
    const possibleUrl = prompt.substring(separatorIndex + 1).trim();
    if (possibleUrl.startsWith("http")) {
      initImage = possibleUrl;
      imagePrompt = prompt.substring(0, separatorIndex).trim();
      spindle.log.info(`[autoimg] Img2img detected. Init image: ${initImage}`);
    }
  }
  
  spindle.log.info(`[autoimg] Extracted prompt: ${imagePrompt.substring(0, 100)}...`);
  const generationPrompt = withRequiredLoraSuffix(imagePrompt);

  if (!storedUserId) {
    spindle.log.error("[autoimg] Cannot generate image: userId not available. Make sure the frontend module is loaded.");
    return;
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
          image: initImage
        })
      };
      spindle.log.info(`[autoimg] Using img2img with init image`);
    }
    
    const result = await spindle.imageGen.generate(generateParams);
    spindle.log.info(`[autoimg] Image generation result: ${JSON.stringify(result).substring(0, 200)}...`);

    const imageRef = result?.imageUrl || result?.imageDataUrl;
    if (!imageRef) {
      throw new Error("Image generation returned no imageUrl/imageDataUrl.");
    }

    const alt = sanitizeAlt(imagePrompt) || "Generated scene image";
    const replacement = `${match[0]}\n[img]${imageRef}[/img]`;
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
