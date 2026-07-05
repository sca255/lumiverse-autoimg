const TAG_REGEX = /\[\[AUTOIMG:\s*([\s\S]*?)\s*\]\]/;
const LORA_SUFFIX = "<lora:Anima Turbo LoRA v0.2:1>";
let interceptorRegistered = false;
let storedUserId = null;
let storedBaseUrl = null;
let detectedProvider = 'sdwebuiapi';
const chatCharacterMap = new Map();
const chatAvatarDataMap = new Map();

const PROVIDER_CONFIGS = {
  sdwebuiapi: {
    initImageField: 'init_images',
    isArray: true,
    stripDataUri: true,
    extraParams: { denoising_strength: 0.6 },
  },
  novelai: {
    initImageField: 'reference_image',
    isArray: false,
    stripDataUri: false,
    extraParams: {},
  },
  openai: {
    initImageField: 'image',
    isArray: false,
    stripDataUri: false,
    extraParams: {},
  },
  default: {
    initImageField: 'init_image',
    isArray: false,
    stripDataUri: false,
    extraParams: {},
  },
};

function getProviderConfig(providerId) {
  return PROVIDER_CONFIGS[providerId] || PROVIDER_CONFIGS.default;
}

function waitForAvatarData(chatId, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const data = chatAvatarDataMap.get(chatId);
    if (data) return resolve(data);
    const start = Date.now();
    const check = () => {
      const d = chatAvatarDataMap.get(chatId);
      if (d) resolve(d);
      else if (Date.now() - start >= timeoutMs) resolve(null);
      else setTimeout(check, 100);
    };
    check();
  });
}

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
    "- Order: character → appearance → clothing → pose → expression → setting → style",
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
    storedBaseUrl = payload.baseUrl;
    spindle.log.info(`[autoimg] Registered: userId=${userId}, baseUrl=${storedBaseUrl}`);
  } else if (payload.type === 'avatar_data') {
    chatAvatarDataMap.set(payload.chatId, payload.base64);
    spindle.log.info(`[autoimg] Cached avatar base64 for chat ${payload.chatId} from frontend`);
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
  initImage = chatAvatarDataMap.get(chatId) || null;
  if (!initImage) {
    spindle.log.info(`[autoimg] Avatar not cached yet, waiting for frontend...`);
    initImage = await waitForAvatarData(chatId, 3000);
  }
  if (initImage) {
    spindle.log.info(`[autoimg] Using cached avatar from frontend for chat ${chatId}`);
  } else {
    spindle.log.info(`[autoimg] No cached avatar for chat ${chatId}, generating without init_image`);
  }

  try {
    spindle.log.info(`[autoimg] Calling imageGen.generate with userId: ${storedUserId}`);
    
    const generateParams = {
      prompt: generationPrompt,
      owner_chat_id: chatId,
      userId: storedUserId
    };
    
    if (initImage) {
      const cfg = getProviderConfig(detectedProvider);
      let initValue;
      if (cfg.stripDataUri) {
        initValue = initImage.includes(';base64,') ? initImage.split(';base64,')[1] : initImage;
      } else {
        initValue = initImage;
      }
      const overrideBody = { ...cfg.extraParams };
      overrideBody[cfg.initImageField] = cfg.isArray ? [initValue] : initValue;
      generateParams.parameters = {
        rawRequestOverride: JSON.stringify(overrideBody),
      };
      spindle.log.info(`[autoimg] Provider config: ${detectedProvider || 'default'}, field: ${cfg.initImageField}`);
    }
    
    const result = await spindle.imageGen.generate(generateParams);
    spindle.log.info(`[autoimg] Image generation result: ${JSON.stringify(result).substring(0, 200)}...`);

    if (result?.provider && !detectedProvider) {
      detectedProvider = result.provider;
      spindle.log.info(`[autoimg] Detected provider: ${detectedProvider}`);
    }

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

spindle.on("GENERATION_STARTED", (payload) => {
  const { chatId, characterId } = payload || {};
  if (chatId && characterId) {
    chatCharacterMap.set(chatId, characterId);
    spindle.log.info(`[autoimg] Cached characterId ${characterId} for chat ${chatId}`);
  }
});

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
