import 'dotenv/config';
import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveModel } from './lib/ai-provider.js';
import { getSearchVolumes } from './lib/dataforseo.js';

const AI_VOLUME_MULTIPLIER = parseFloat(process.env.AI_VOLUME_MULTIPLIER || '0.15');

const intentKeywordSchema = z.object({
  intent: z.enum([
    'comparison',
    'how-to',
    'what-is',
    'best-top',
    'vs-review',
    'recommendation',
    'problem-solving',
  ]),
  keywords: z.array(z.string()).length(5),
});

const INTENT_SYSTEM_PROMPT = `You are a keyword research expert. Given an AI search prompt, you must:
1. Determine the primary search intent (comparison, how-to, what-is, best-top, vs-review, recommendation, or problem-solving).
2. Generate exactly 5 short keyword phrases (2-5 words each) that a user would type into Google when searching for the same topic.

Rules:
- Keywords must be generic — no brand names.
- Keywords should be realistic, high-volume Google search queries.
- Each keyword must be unique and cover a slightly different angle of the same topic.
- Use lowercase only.`;

async function testDataForSEO() {
  console.log('=== Test 1: DataForSEO Connection ===\n');

  try {
    const volumes = await getSearchVolumes(['best crm software', 'crm tools comparison'], {
      locationCode: 2840,
      languageCode: 'en',
    });
    console.log('DataForSEO volumes:', volumes);
    console.log('OK - DataForSEO connection works!\n');
    return true;
  } catch (err) {
    console.error('FAIL - DataForSEO error:', err.message, '\n');
    return false;
  }
}

async function testLLMExtraction() {
  console.log('=== Test 2: LLM Intent + Keyword Extraction ===\n');

  const testPrompt = 'Best CRM software for small businesses';

  try {
    const aiModel = resolveModel();
    const { object } = await generateObject({
      model: aiModel,
      schema: intentKeywordSchema,
      system: INTENT_SYSTEM_PROMPT,
      prompt: `Analyze this AI search prompt and extract intent + 5 Google keywords:\n\n"${testPrompt}"`,
    });

    console.log('Prompt:', testPrompt);
    console.log('Intent:', object.intent);
    console.log('Keywords:', object.keywords);
    console.log('OK - LLM extraction works!\n');
    return object;
  } catch (err) {
    console.error('FAIL - LLM error:', err.message, '\n');
    return null;
  }
}

async function testFullPipeline() {
  console.log('=== Test 3: Full Pipeline (LLM + DataForSEO + Calculation) ===\n');

  const testPrompt = 'How to improve website SEO ranking';

  try {
    const aiModel = resolveModel();
    const { object: intentResult } = await generateObject({
      model: aiModel,
      schema: intentKeywordSchema,
      system: INTENT_SYSTEM_PROMPT,
      prompt: `Analyze this AI search prompt and extract intent + 5 Google keywords:\n\n"${testPrompt}"`,
    });

    console.log('Prompt:', testPrompt);
    console.log('Intent:', intentResult.intent);
    console.log('Keywords:', intentResult.keywords);

    const volumes = await getSearchVolumes(intentResult.keywords, {
      locationCode: 2840,
      languageCode: 'en',
    });

    console.log('\nGoogle Volumes:');
    for (const [kw, data] of Object.entries(volumes)) {
      console.log(
        `  "${kw}": ${data.volume.toLocaleString()}/mo (competition: ${data.competition ?? 'n/a'})`,
      );
    }

    const totalGoogleVolume = Object.values(volumes).reduce((sum, v) => sum + v.volume, 0);
    const estAiVolume = Math.round(totalGoogleVolume * AI_VOLUME_MULTIPLIER);

    console.log(`\nTotal Google Volume: ${totalGoogleVolume.toLocaleString()}/mo`);
    console.log(
      `AI Multiplier: ${AI_VOLUME_MULTIPLIER} (${(AI_VOLUME_MULTIPLIER * 100).toFixed(0)}%)`,
    );
    console.log(`Est. AI Volume: ${estAiVolume.toLocaleString()}/mo`);
    console.log('\nOK - Full pipeline works!');
  } catch (err) {
    console.error('FAIL - Pipeline error:', err.message);
  }
}

async function main() {
  console.log('Prompt Volumes System - Test Suite\n');
  console.log(`DATAFORSEO_LOGIN: ${process.env.DATAFORSEO_LOGIN ? 'SET' : 'MISSING'}`);
  console.log(`DATAFORSEO_PASSWORD: ${process.env.DATAFORSEO_PASSWORD ? 'SET' : 'MISSING'}`);
  console.log(`AI_VOLUME_MULTIPLIER: ${AI_VOLUME_MULTIPLIER}`);
  console.log(`OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'SET' : 'MISSING'}`);
  console.log('');

  const dfOk = await testDataForSEO();
  if (!dfOk) {
    console.log('Stopping — fix DataForSEO credentials first.');
    process.exit(1);
  }

  const llmResult = await testLLMExtraction();
  if (!llmResult) {
    console.log('Stopping — fix AI provider config first.');
    process.exit(1);
  }

  await testFullPipeline();
}

main().catch(console.error);
