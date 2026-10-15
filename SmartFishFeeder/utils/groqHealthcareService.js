// utils/groqHealthcareService.js — Groq LLM Aquatic Veterinary Healthcare Advisor
// Uses GROQ_API_KEY from .env to summarize the MobileNetV2 fish disease diagnosis
// and generate personalized healthcare, medication, water care, and feeding recommendations.

import { GROQ_API_KEY as ENV_GROQ_KEY } from '@env';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

export function getGroqApiKey() {
  const key = (ENV_GROQ_KEY || process.env.GROQ_API_KEY || '').trim();
  return key;
}

/**
 * Calls Groq API (`llama-3.3-70b-versatile`) with the MobileNetV2 classification output
 * (`Bacterial`, `Viral`, `Fungal`, or `Parasitic`) and returns a structured veterinary
 * summary and healthcare recommendation plan.
 */
export async function generateGroqHealthcarePlan({
  predictedClass,
  subDiagnosis,
  confidence,
  probabilities,
  feederData,
}) {
  const apiKey = getGroqApiKey();
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is missing in .env');
  }

  const probSummary = probabilities
    ? Object.entries(probabilities)
        .map(([k, v]) => `${k}: ${v}%`)
        .join(', ')
    : `${predictedClass}: ${confidence}%`;

  const currentPortion = feederData?.portionSize ?? 1;
  const currentFoodLevel = feederData?.foodLevel ?? 100;

  const systemPrompt = `You are Dr. AquaVet, a board-certified Aquatic Veterinarian and Fish Pathology Specialist integrated into the SmartFish Feeder app.
A user just photographed their aquarium fish, and our on-device MobileNetV2 model (smart_fish_mobilenet.pth) classified the disease into one of 4 pathogen categories: Bacterial, Viral, Fungal, or Parasitic.
Respond ONLY with a valid JSON object matching this exact schema:
{
  "diseaseSummary": "A clear, compassionate, 3-4 sentence clinical summary explaining what this specific fish disease is, how it affects the fish's body/organs, and the urgency level.",
  "clinicalSignsToWatch": [
    "3 to 4 specific visual or behavioral symptoms the fish owner should check for"
  ],
  "rootCauses": [
    "3 common aquarium triggers that cause this pathogen outbreak"
  ],
  "immediateSteps": [
    "3 to 4 urgent step-by-step first-aid actions for the first 24 hours"
  ],
  "medications": [
    {
      "name": "Specific medication or treatment name",
      "dosage": "Exact aquarium dosage and frequency (e.g., per 10 gallons / 38L)",
      "duration": "Treatment duration in days",
      "purpose": "How this medicine targets the pathogen"
    }
  ],
  "waterQualityProtocol": {
    "temperature": "Recommended target temperature in °C and °F with explanation",
    "waterChangeSchedule": "Exact water change percentage and frequency during treatment",
    "aerationAndFiltration": "Filter carbon removal, air stone, and dissolved oxygen instructions",
    "saltTherapy": "Exact aquarium salt dosage and whether it is safe"
  },
  "feederHealthcareAdvice": "Specific feeding schedule and portion recommendation for their automated SmartFish Feeder during treatment (e.g. reducing portion size to prevent ammonia spikes or soaking pellets in vitamins/antibiotics).",
  "prognosisAndPrevention": "Expected recovery timeline in days and how to prevent reinfection."
}`;

  const userPrompt = `MobileNetV2 (.pth) Fish Scan Results:
- Detected Pathogen Category: ${predictedClass}
- Specific Sub-Diagnosis: ${subDiagnosis || predictedClass + ' Infection'}
- Model Confidence: ${confidence}%
- 4-Class Probability Distribution: ${probSummary}
- Current SmartFish Feeder State: Portion Size = ${currentPortion}x, Tank Hopper Food Level = ${currentFoodLevel}%

Generate a comprehensive, practical, veterinary-accurate Disease Summary and Healthcare Recommendation Plan for this fish.`;

  let lastError = null;

  for (const model of GROQ_MODELS) {
    try {
      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          max_tokens: 1200,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        lastError = new Error(`Groq HTTP ${response.status}: ${errText.slice(0, 180)}`);
        continue;
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        lastError = new Error('Empty response from Groq API');
        continue;
      }

      const parsed = JSON.parse(content);
      return {
        ...parsed,
        groqModel: model,
        generatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Failed to reach Groq AI service');
}

/**
 * Allows the user to ask a follow-up question to Groq AI about their fish's diagnosis & treatment
 * (e.g. "How much salt for a 40L tank?" or "Can I treat with tank mates present?").
 */
export async function askGroqFishDoctorQuestion({
  question,
  predictedClass,
  subDiagnosis,
  groqReport,
}) {
  const apiKey = getGroqApiKey();
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is missing in .env');
  }

  const systemPrompt = `You are Dr. AquaVet, an expert Aquatic Veterinarian inside the SmartFish Feeder app.
The user's fish was diagnosed by MobileNetV2 with: ${predictedClass} (${subDiagnosis || ''}).
Summary of current healthcare plan: ${groqReport?.diseaseSummary || ''}.
Answer the user's question clearly, concisely (3-6 sentences or bullet points), with exact dosages and practical fishkeeping advice.`;

  for (const model of GROQ_MODELS) {
    try {
      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.4,
          max_tokens: 450,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: question },
          ],
        }),
      });

      if (!response.ok) continue;
      const data = await response.json();
      const answer = data?.choices?.[0]?.message?.content?.trim();
      if (answer) return answer;
    } catch (e) {
      // try next model
    }
  }

  throw new Error('Could not get a response from Groq AI. Please check your internet connection.');
}

