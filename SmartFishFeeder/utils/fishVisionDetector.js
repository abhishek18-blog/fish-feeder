// utils/fishVisionDetector.js — Strict Fish-Only Vision Verifier using VISION_API_KEY from .env
// Step 1: Verifies whether the photo actually shows a fish.
// Rejects laptops, computers, screens, people, phones, rooms, furniture, pets, and any non-fish object.

import { NativeModules, TurboModuleRegistry } from 'react-native';
import { VISION_API_KEY as ENV_VISION_API_KEY, GROQ_API_KEY as ENV_GROQ_API_KEY } from '@env';

const FISH_KEYWORDS = [
  'fish',
  'goldfish',
  'koi',
  'betta',
  'siamese fighting fish',
  'cichlid',
  'guppy',
  'angelfish',
  'carp',
  'trout',
  'salmon',
  'tilapia',
  'catfish',
  'ray-finned fish',
  'bony fish',
  'osteichthyes',
  'actinopterygii',
  'tetra',
  'serpae tetra',
  'neon tetra',
  'discus',
  'molly',
  'platy',
  'swordtail',
  'oscar',
  'arowana',
  'danio',
  'zebrafish',
  'loach',
  'pleco',
  'plecostomus',
  'aquarium fish',
  'feeder fish',
  'killifish',
  'gourami',
  'barb',
  'rasbora',
  'rainbowfish',
  'piranha',
  'minnow',
  'bass',
  'perch',
  'tuna',
  'mackerel',
  'sardine',
  'anchovy',
  'clownfish',
  'tang',
  'wrasse',
  'goby',
  'blenny',
  'pufferfish',
  'flowerhorn',
];

const NON_FISH_BLOCKLIST = [
  'laptop',
  'computer',
  'personal computer',
  'netbook',
  'keyboard',
  'computer keyboard',
  'monitor',
  'display device',
  'screen',
  'electronics',
  'electronic device',
  'gadget',
  'phone',
  'mobile phone',
  'smartphone',
  'tablet',
  'television',
  'desk',
  'table',
  'chair',
  'furniture',
  'office',
  'person',
  'human',
  'face',
  'selfie',
  'hand',
  'finger',
  'clothing',
  'shirt',
  'shoe',
  'glasses',
  'cat',
  'dog',
  'bird',
  'horse',
  'car',
  'vehicle',
  'building',
  'book',
  'paper',
  'document',
  'screenshot',
  'cup',
  'mug',
  'bottle',
];

function getVisionApiKey(explicitKey) {
  const key =
    explicitKey ||
    ENV_VISION_API_KEY ||
    (typeof process !== 'undefined' && process.env && process.env.VISION_API_KEY) ||
    '';
  return String(key).trim();
}

function getGroqApiKey() {
  const key =
    ENV_GROQ_API_KEY ||
    (typeof process !== 'undefined' && process.env && process.env.GROQ_API_KEY) ||
    '';
  return String(key).trim();
}

export function getMetroApiUrl() {
  try {
    let scriptURL = NativeModules?.SourceCode?.scriptURL;
    if (!scriptURL && TurboModuleRegistry && typeof TurboModuleRegistry.get === 'function') {
      const sc = TurboModuleRegistry.get('SourceCode');
      scriptURL = sc?.getConstants?.()?.scriptURL || sc?.scriptURL;
    }
    if (scriptURL && scriptURL.startsWith('http')) {
      const originMatch = scriptURL.match(/^(https?:\/\/[^/]+)/);
      if (originMatch) {
        return `${originMatch[1]}/api/fish-disease-detect`;
      }
    }
  } catch (e) {
    // ignore
  }
  return 'http://10.226.195.103:8081/api/fish-disease-detect';
}

function cleanBase64(base64Image) {
  if (!base64Image || typeof base64Image !== 'string') return '';
  // Remove data URI prefix AND strip all embedded newlines/whitespace (\r, \n) added by Android Base64 encoder
  return base64Image
    .replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '')
    .replace(/\s+/g, '');
}

function matchesFishLabel(description = '') {
  const lower = String(description || '').toLowerCase().trim();
  if (!lower) return false;
  if (
    lower.includes('fisherman') ||
    lower.includes('fishing') ||
    lower.includes('starfish') ||
    lower.includes('jellyfish') ||
    lower.includes('shellfish') ||
    lower.includes('crayfish') ||
    lower.includes('crawfish') ||
    lower.includes('cuttlefish') ||
    lower.includes('silverfish')
  ) {
    return false;
  }
  for (const kw of FISH_KEYWORDS) {
    if (lower === kw || lower.includes(kw)) {
      return true;
    }
  }
  return false;
}

function matchesNonFishBlocklist(description = '') {
  const lower = String(description || '').toLowerCase().trim();
  if (!lower) return false;
  for (const bad of NON_FISH_BLOCKLIST) {
    if (lower === bad || lower.includes(bad)) {
      return true;
    }
  }
  return false;
}

/**
 * 1. Google Cloud Vision API (`images:annotate`) using VISION_API_KEY from .env
 */
async function checkWithGoogleCloudVision(rawBase64, apiKey) {
  if (!apiKey) return null;
  const url = `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [
          {
            image: { content: rawBase64 },
            features: [
              { type: 'LABEL_DETECTION', maxResults: 15 },
              { type: 'OBJECT_LOCALIZATION', maxResults: 10 },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    if (!response.ok) return null;

    const data = await response.json();
    const annotation = data?.responses?.[0];
    if (!annotation || annotation.error) return null;

    const labels = Array.isArray(annotation.labelAnnotations) ? annotation.labelAnnotations : [];
    const objects = Array.isArray(annotation.localizedObjectAnnotations)
      ? annotation.localizedObjectAnnotations
      : [];

    const combined = [
      ...objects.map((o) => ({ name: o.name || '', score: o.score || 0 })),
      ...labels.map((l) => ({ name: l.description || '', score: l.score || 0 })),
    ];

    if (combined.length === 0) {
      return {
        isFish: false,
        detectedLabel: 'Unrecognized object',
        confidence: 0,
        reason: 'This image is not a fish. Please upload or take a clear photo of a fish.',
        source: 'Google Cloud Vision',
      };
    }

    const matchedFish = combined.find((item) => matchesFishLabel(item.name) && item.score >= 0.5);
    const matchedNonFish = combined.find(
      (item) => matchesNonFishBlocklist(item.name) && item.score >= 0.55
    );

    if (matchedFish && (!matchedNonFish || matchedFish.score >= matchedNonFish.score)) {
      return {
        isFish: true,
        detectedLabel: matchedFish.name,
        confidence: Math.round((matchedFish.score || 0.85) * 100),
        reason: `Detected ${matchedFish.name} in the photo.`,
        source: 'Google Cloud Vision',
      };
    }

    const topDetected = combined
      .slice(0, 3)
      .map((item) => item.name)
      .filter(Boolean)
      .join(', ');

    return {
      isFish: false,
      detectedLabel: topDetected || 'Non-fish object',
      confidence: Math.round((combined[0]?.score || 0.85) * 100),
      reason: topDetected
        ? `This is not a fish (detected: ${topDetected}). Please take or upload a clear photo of a fish.`
        : 'This is not a fish. Please take or upload a clear photo of a fish.',
      source: 'Google Cloud Vision',
    };
  } catch (err) {
    clearTimeout(timer);
    return null;
  }
}

/**
 * 2. Google Gemini Vision API using VISION_API_KEY (`AIzaSy...`) from .env
 */
async function checkWithGoogleGeminiVision(rawBase64, apiKey) {
  if (!apiKey) return null;
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: 'You are a strict fish-only image filter. Look at this image carefully. Is the main subject a real fish (live or dead aquarium/freshwater/marine fish)? If it shows a laptop, computer, screen, person, hand, phone, desk, furniture, cat, dog, or anything other than a fish, set isFish to false. Respond ONLY with valid JSON: {"isFish": true or false, "detectedObject": "short name of what is in the photo", "confidence": 95}',
                },
                {
                  inline_data: {
                    mime_type: 'image/jpeg',
                    data: rawBase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.0,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);
      if (!response.ok) continue;

      const data = await response.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;

      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.isFish === 'boolean') {
        let isFish = parsed.isFish;
        const objName = parsed.detectedObject || (isFish ? 'Fish' : 'Non-fish object');
        if (!matchesFishLabel(objName) && matchesNonFishBlocklist(objName)) {
          isFish = false;
        }
        return {
          isFish,
          detectedLabel: objName,
          confidence: Number(parsed.confidence) || 92,
          reason: isFish
            ? `Detected ${objName}.`
            : `This is not a fish (detected: ${objName}). Please take or upload a clear photo of a fish.`,
          source: 'Google Vision AI',
        };
      }
    } catch (err) {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * 3. Multimodal Vision check via Qwen 3.8 Vision (`qwen/qwen3.8-27b`)
 */
async function checkWithMultimodalVision(rawBase64, groqKey) {
  if (!groqKey) return null;
  const models = [
    'qwen/qwen3.8-27b',
    'meta-llama/llama-4-scout-17b-16e-instruct',
  ];

  for (const model of models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 14000);

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.0,
          max_tokens: 150,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Look at this image carefully. Does this image show a real fish (aquarium/freshwater/marine fish)? If it shows a laptop, computer, screen, person, hand, phone, desk, furniture, room, or anything other than a fish, set isFish to false. If it shows a fish, set isFish to true. Reply ONLY with a JSON object: {"isFish": true or false, "detectedObject": "short name of what is shown", "confidence": 95}',
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/jpeg;base64,${rawBase64}`,
                  },
                },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);
      if (!response.ok) continue;

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;

      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.isFish === 'boolean') {
        let isFish = parsed.isFish;
        const objName = parsed.detectedObject || (isFish ? 'Fish' : 'Non-fish object');
        if (!matchesFishLabel(objName) && matchesNonFishBlocklist(objName)) {
          isFish = false;
        }
        return {
          isFish,
          detectedLabel: objName,
          confidence: Number(parsed.confidence) || 92,
          reason: isFish
            ? `Detected ${objName}.`
            : `This is not a fish (detected: ${objName}). Please take or upload a clear photo of a fish.`,
          source: 'Vision AI',
        };
      }
    } catch (err) {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * 4. Check via Metro Python Vision Helper (downscales 4MB+ camera photos to 20KB 512x512 JPEG
 *    and checks with VISION_API_KEY & Qwen 3.8 Vision).
 */
async function checkViaMetroVisionServer(rawBase64, visionKey, groqKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(getMetroApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: rawBase64,
        visionOnly: true,
        visionApiKey: visionKey,
        groqApiKey: groqKey,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (data && typeof data.isFish === 'boolean' && data.success) {
      return {
        isFish: data.isFish,
        detectedLabel: data.detectedLabel || (data.isFish ? 'Fish' : 'Non-fish object'),
        confidence: data.confidence || 90,
        reason: data.reason,
        resizedBase64: data.resizedBase64 || null,
        source: data.source || 'Vision API',
      };
    }
    return data?.resizedBase64 ? { onlyResizedBase64: data.resizedBase64 } : null;
  } catch (e) {
    clearTimeout(timer);
    return null;
  }
}

/**
 * Verifies whether `base64Image` contains a fish using `VISION_API_KEY` from `.env`.
 */
export async function verifyFishInImage(base64Image, explicitApiKey = null) {
  let rawBase64 = cleanBase64(base64Image);
  if (!rawBase64) {
    return {
      isFish: false,
      detectedLabel: 'Unreadable image',
      confidence: 0,
      reason: 'Could not read image data. Please try taking or selecting another photo.',
    };
  }

  const visionKey = getVisionApiKey(explicitApiKey);
  const groqKey = getGroqApiKey();

  // 1. Try Metro Vision Helper first (downscales camera/gallery image to 20KB 512x512 JPEG & runs Vision check)
  const metroVision = await checkViaMetroVisionServer(rawBase64, visionKey, groqKey);
  if (metroVision && typeof metroVision.isFish === 'boolean') {
    return metroVision;
  }
  if (metroVision?.onlyResizedBase64) {
    rawBase64 = metroVision.onlyResizedBase64;
  }

  // 2. Direct phone call to Google Cloud Vision API (`images:annotate`) with VISION_API_KEY
  if (visionKey) {
    const cloudVisionResult = await checkWithGoogleCloudVision(rawBase64, visionKey);
    if (cloudVisionResult) {
      return cloudVisionResult;
    }

    // 3. Direct phone call to Google Gemini Vision API with VISION_API_KEY
    const geminiVisionResult = await checkWithGoogleGeminiVision(rawBase64, visionKey);
    if (geminiVisionResult) {
      return geminiVisionResult;
    }
  }

  // 4. Direct phone call to Qwen 3.8 Multimodal Vision API
  const visionResult = await checkWithMultimodalVision(rawBase64, groqKey);
  if (visionResult) {
    return visionResult;
  }

  // 5. Strict fallback if all network calls fail
  return {
    isFish: false,
    detectedLabel: 'No fish detected',
    confidence: 0,
    reason: 'This does not appear to be a fish (or Vision API could not verify a fish). Please take a clear photo of a fish.',
    source: 'Strict Filter',
  };
}
