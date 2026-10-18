import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  type Manifest,
  type Plan,
  PlanSchema,
  calculateLlmCost,
  CONFIG,
} from '@relay/shared';

export interface PlanEstimation {
  estTasks: number;
  estTokensIn: number;
  estTokensOut: number;
  estCostUsd: number;
}

export function estimatePlan(plan: Plan, manifest: Manifest): PlanEstimation {
  let mapTasks = 1;

  switch (plan.strategy) {
    case 'per_file':
      mapTasks = Math.max(1, manifest.totalFiles);
      break;
    case 'chunk_rows': {
      let totalRows = 0;
      for (const f of manifest.files) {
        totalRows += f.rows ?? 100;
      }
      const target = Math.max(1, plan.chunking.target || 500);
      mapTasks = Math.max(1, Math.ceil(totalRows / target));
      break;
    }
    case 'chunk_text': {
      const target = Math.max(100, plan.chunking.target || 2000);
      mapTasks = Math.max(1, Math.ceil(manifest.totalEstTokens / target));
      break;
    }
    case 'page_groups': {
      let totalPages = 0;
      for (const f of manifest.files) {
        totalPages += f.pages ?? 1;
      }
      const target = Math.max(1, plan.chunking.target || 5);
      mapTasks = Math.max(1, Math.ceil(totalPages / target));
      break;
    }
    case 'single':
    default:
      mapTasks = 1;
      break;
  }

  // Reduce tasks
  const fanIn = Math.max(2, plan.reduce.fanIn || 20);
  const reduceTasks = mapTasks > 1 ? Math.ceil(mapTasks / fanIn) : 0;
  const totalTasks = mapTasks + reduceTasks;

  const isLlmMap = plan.map.op === 'llm';
  const isLlmReduce = plan.reduce.op === 'llm_synthesis';

  const avgTokensPerTask = isLlmMap ? 400 : 0;
  const reduceTokensPerTask = isLlmReduce ? 1000 : 0;

  const estTokensIn = manifest.totalEstTokens + (totalTasks * 350);
  const estTokensOut = (mapTasks * avgTokensPerTask) + (reduceTasks * reduceTokensPerTask);

  let estCostUsd = 0;
  if (isLlmMap || isLlmReduce) {
    const model = CONFIG.RELAY_WORKER_MODEL || 'claude-haiku-5-5';
    estCostUsd = calculateLlmCost(model, estTokensIn, estTokensOut);
  }

  return {
    estTasks: totalTasks,
    estTokensIn,
    estTokensOut,
    estCostUsd: Number(estCostUsd.toFixed(4)),
  };
}

export function generateFakePlan(brief: string, manifest: Manifest, answers?: string[]): Plan {
  const briefLower = brief.toLowerCase();
  const hasImages = manifest.files.some(f => f.mime.startsWith('image/') || /\.(png|jpe?g|bmp|webp)$/i.test(f.name));
  const hasCsv = manifest.files.some(f => f.mime === 'text/csv' || (f.rows !== undefined && f.rows > 0) || f.name.endsWith('.csv'));

  const shortBrief = brief.trim().split(/\s+/).length < 4;
  const questions: string[] = [];
  if (shortBrief && (!answers || answers.length === 0)) {
    questions.push('Would you prefer an executive summary or a detailed granular breakdown?');
  }

  let understanding = `Process and analyze ${manifest.summary} according to: "${brief}"`;
  if (answers && answers.length > 0) {
    understanding += ` (Incorporating user guidance: ${answers.join('; ')})`;
  }

  // 1. Image workflow
  if (hasImages || briefLower.includes('image') || briefLower.includes('resize') || briefLower.includes('convert')) {
    return {
      userSummary: `We will inspect and resize all ${manifest.totalFiles} images in parallel to standardized dimensions, pack them, and provide a downloadable ZIP package.`,
      understanding,
      strategy: 'per_file',
      chunking: { unit: 'file', target: 1 },
      map: {
        op: 'tool',
        tool: 'image_resize',
        instruction: 'Resize image to standard 800px width keeping aspect ratio.',
        outputSchema: {
          type: 'object',
          properties: {
            width: { type: 'number' },
            height: { type: 'number' },
            bytes: { type: 'number' },
            base64: { type: 'string' },
          },
        },
      },
      reduce: {
        op: 'concat',
        fanIn: 20,
      },
      deliverable: {
        format: 'zip',
        filename: 'processed_images.zip',
        description: 'ZIP archive containing all processed and resized images.',
      },
      assumptions: ['All image files are valid PNG or JPEG formats.'],
      questions,
      risks: [],
    };
  }

  // 2. CSV / Tabular workflow
  if (hasCsv || briefLower.includes('csv') || briefLower.includes('clean') || briefLower.includes('stats') || briefLower.includes('table')) {
    if (briefLower.includes('clean') || briefLower.includes('dedup')) {
      return {
        userSummary: `Clean and deduplicate tabular dataset across all rows, stripping whitespace, casting data types, and consolidating into a single sanitized CSV.`,
        understanding,
        strategy: 'chunk_rows',
        chunking: { unit: 'rows', target: 500 },
        map: {
          op: 'tool',
          tool: 'csv_clean',
          instruction: 'Deduplicate rows, trim whitespace, and sanitize empty values.',
          outputSchema: {
            type: 'object',
            properties: {
              cleanedRows: { type: 'array' },
              rowCount: { type: 'number' },
            },
          },
        },
        reduce: {
          op: 'table_union',
          fanIn: 20,
        },
        deliverable: {
          format: 'csv',
          filename: 'cleaned_data.csv',
          description: 'Consolidated, sanitized, and deduplicated CSV file.',
        },
        assumptions: ['First row represents column headers.'],
        questions,
        risks: [],
      };
    }

    if (briefLower.includes('stat') || briefLower.includes('metric')) {
      return {
        userSummary: `Calculate column distributions, quantiles, and null frequencies for all uploaded tabular data in parallel, merging results into a statistics report.`,
        understanding,
        strategy: 'chunk_rows',
        chunking: { unit: 'rows', target: 1000 },
        map: {
          op: 'tool',
          tool: 'csv_stats',
          instruction: 'Compute descriptive statistics for each column.',
          outputSchema: {
            type: 'object',
            properties: {
              columns: { type: 'object' },
              totalRows: { type: 'number' },
            },
          },
        },
        reduce: {
          op: 'merge_json',
          fanIn: 20,
        },
        deliverable: {
          format: 'json',
          filename: 'dataset_statistics.json',
          description: 'Comprehensive statistical profile of tabular columns.',
        },
        assumptions: ['Tabular columns maintain consistent types across chunks.'],
        questions,
        risks: [],
      };
    }
  }

  // 3. Document / Reviews / Text analysis workflow
  const isSentimentOrReview = briefLower.includes('review') || briefLower.includes('sentiment') || briefLower.includes('feedback');

  return {
    userSummary: isSentimentOrReview
      ? `Analyze ${manifest.totalFiles} review files in parallel with AI to extract sentiment, themes, and pain points, then synthesize findings into an executive report.`
      : `Distribute the text analysis across ${Math.max(1, manifest.totalFiles)} tasks in parallel, extract structured highlights, and compile an aggregated final deliverable.`,
    understanding,
    strategy: manifest.totalFiles > 1 ? 'per_file' : 'chunk_text',
    chunking: { unit: manifest.totalFiles > 1 ? 'file' : 'tokens', target: manifest.totalFiles > 1 ? 1 : 2000 },
    map: {
      op: 'llm',
      instruction: isSentimentOrReview
        ? 'Evaluate customer sentiment (positive, neutral, negative), list key themes, and summarize feedback.'
        : 'Extract main concepts, key facts, and summary takeaways from the provided text.',
      outputSchema: {
        type: 'object',
        properties: {
          sentiment: { type: 'string' },
          themes: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string' },
        },
        required: ['summary'],
      },
    },
    reduce: {
      op: 'llm_synthesis',
      instruction: isSentimentOrReview
        ? 'Synthesize all individual sentiment analyses into an executive action report with key themes and recommendations.'
        : 'Combine and organize all chunk summaries into a cohesive, structured document.',
      fanIn: 20,
    },
    deliverable: {
      format: 'md',
      filename: isSentimentOrReview ? 'customer_feedback_synthesis.md' : 'analysis_report.md',
      description: isSentimentOrReview
        ? 'Executive markdown report covering sentiment trends, top complaints, and customer praise.'
        : 'Comprehensive Markdown document synthesizing all processed content.',
    },
    assumptions: ['Input text documents are written in English or UTF-8 encodable language.'],
    questions,
    risks: [],
  };
}

export async function generatePlan(brief: string, manifest: Manifest, answers?: string[]): Promise<Plan> {
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const useFake = process.env.RELAY_FAKE_LLM === '1' || (!hasGemini && !hasAnthropic);

  if (useFake) {
    return generateFakePlan(brief, manifest, answers);
  }

  const userContent = JSON.stringify({
    brief,
    manifestSummary: manifest.summary,
    totalFiles: manifest.totalFiles,
    totalEstTokens: manifest.totalEstTokens,
    filePreviews: manifest.files.slice(0, 10).map(f => ({
      name: f.name,
      mime: f.mime,
      bytes: f.bytes,
      rows: f.rows,
      pages: f.pages,
      preview: f.textPreview.slice(0, 300),
    })),
    userAnswers: answers || [],
  }, null, 2);

  // 1. Google Gemini Planner
  if (hasGemini) {
    const modelName = process.env.RELAY_PLANNER_MODEL && !process.env.RELAY_PLANNER_MODEL.startsWith('claude')
      ? process.env.RELAY_PLANNER_MODEL
      : 'gemini-3.6-flash';

    const systemPrompt = `You are Relay's Distributed AI Task Planner.
Given a user's brief and a manifest of uploaded files, design an optimal distributed execution plan.

Rules:
1. Strategy must be one of: "per_file", "chunk_text", "chunk_rows", "page_groups", "single".
2. Map operation op must be "llm" or "tool".
   If op is "tool", tool MUST be one of:
   ['image_resize', 'image_convert', 'csv_clean', 'csv_stats', 'text_extract', 'hash_files', 'json_to_csv', 'regex_extract', 'translate', 'summarize', 'extract_fields', 'classify']
3. Reduce op must be one of: "concat", "merge_json", "table_union", "llm_synthesis".
4. Deliverable format must be one of: "md", "docx", "xlsx", "csv", "json", "zip".
5. Never write or propose raw code execution.
6. If the brief is clear, questions should be empty []. At most ask 1-3 questions only if truly ambiguous.
7. Return strictly a JSON object conforming to this schema:
{
  "userSummary": "Plain words explanation shown to user (2-4 sentences)",
  "understanding": "One sentence of what the user wants",
  "strategy": "per_file" | "chunk_text" | "chunk_rows" | "page_groups" | "single",
  "chunking": { "unit": "file" | "tokens" | "rows" | "pages", "target": number },
  "map": { "op": "llm" | "tool", "tool": "optional_tool_name", "instruction": "string", "outputSchema": { "type": "object", "properties": {} } },
  "reduce": { "op": "concat" | "merge_json" | "table_union" | "llm_synthesis", "instruction": "string", "fanIn": 20 },
  "deliverable": { "format": "md" | "docx" | "xlsx" | "csv" | "json" | "zip", "filename": "string", "description": "string" },
  "assumptions": ["string"],
  "questions": [],
  "risks": []
}`;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const modelsToTry = [modelName];
    if (modelName === 'gemini-3.6-flash') modelsToTry.push('gemini-3.8-flash');
    else if (modelName === 'gemini-3.8-flash') modelsToTry.push('gemini-3.6-flash');

    for (const currentModel of modelsToTry) {
      const gemini = genAI.getGenerativeModel({
        model: currentModel,
        systemInstruction: systemPrompt,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      });

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const prompt = attempt === 0
            ? userContent
            : `${userContent}\n\nNote: Ensure the output strictly conforms to the JSON Plan schema with all required fields (userSummary, understanding, strategy, chunking, map, reduce, deliverable, assumptions, questions, risks).`;
          const res = await gemini.generateContent(prompt);
          const text = res.response.text();
          const cleaned = text.replace(/^```json\n?|\n?```$/g, '').trim();
          const parsed = JSON.parse(cleaned);
          const validated = PlanSchema.safeParse(parsed);
          if (validated.success) {
            return validated.data as Plan;
          }
          console.warn(`[Planner] Gemini (${currentModel}) plan validation issue:`, validated.error.issues);
        } catch (err: any) {
          console.warn(`[Planner] Gemini (${currentModel}) planning attempt ${attempt + 1} error:`, err.message);
        }
      }
    }

    console.warn('[Planner] Gemini planning failed across models; falling back to deterministic plan');
    return generateFakePlan(brief, manifest, answers);
  }

  // 2. Anthropic Claude Planner
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const model = CONFIG.RELAY_PLANNER_MODEL || 'claude-sonnet-5-5';

  const systemPrompt = `You are Relay's Distributed AI Task Planner.
Given a user's brief and a manifest of uploaded files, design an optimal distributed execution plan.

Rules:
1. Strategy must be one of: "per_file", "chunk_text", "chunk_rows", "page_groups", "single".
2. Map operation op must be "llm" or "tool".
   If op is "tool", tool MUST be one of:
   ['image_resize', 'image_convert', 'csv_clean', 'csv_stats', 'text_extract', 'hash_files', 'json_to_csv', 'regex_extract', 'translate', 'summarize', 'extract_fields', 'classify']
3. Reduce op must be one of: "concat", "merge_json", "table_union", "llm_synthesis".
4. Deliverable format must be one of: "md", "docx", "xlsx", "csv", "json", "zip".
5. Never write or propose raw code execution.
6. If the brief is clear, questions should be empty []. At most ask 1-3 questions only if truly ambiguous.
7. Return strictly valid JSON conforming to the plan tool schema.`;

  const planToolDef: Anthropic.Tool = {
    name: 'submit_plan',
    description: 'Submit the structured distributed execution plan for Relay.',
    input_schema: {
      type: 'object',
      properties: {
        userSummary: { type: 'string', description: 'Plain words explanation shown to user (2-4 sentences)' },
        understanding: { type: 'string', description: 'One sentence of what the user wants' },
        strategy: { type: 'string', enum: ['per_file', 'chunk_text', 'chunk_rows', 'page_groups', 'single'] },
        chunking: {
          type: 'object',
          properties: {
            unit: { type: 'string', enum: ['file', 'tokens', 'rows', 'pages'] },
            target: { type: 'number' },
          },
          required: ['unit', 'target'],
        },
        map: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['llm', 'tool'] },
            tool: {
              type: 'string',
              enum: [
                'image_resize', 'image_convert', 'csv_clean', 'csv_stats',
                'text_extract', 'hash_files', 'json_to_csv', 'regex_extract',
                'translate', 'summarize', 'extract_fields', 'classify'
              ]
            },
            instruction: { type: 'string' },
            outputSchema: { type: 'object' },
          },
          required: ['op', 'instruction', 'outputSchema'],
        },
        reduce: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['concat', 'merge_json', 'table_union', 'llm_synthesis'] },
            instruction: { type: 'string' },
            fanIn: { type: 'number' },
          },
          required: ['op', 'fanIn'],
        },
        deliverable: {
          type: 'object',
          properties: {
            format: { type: 'string', enum: ['md', 'docx', 'xlsx', 'csv', 'json', 'zip'] },
            filename: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['format', 'filename', 'description'],
        },
        assumptions: { type: 'array', items: { type: 'string' } },
        questions: { type: 'array', items: { type: 'string' } },
        risks: { type: 'array', items: { type: 'string' } },
      },
      required: ['userSummary', 'understanding', 'strategy', 'chunking', 'map', 'reduce', 'deliverable', 'assumptions', 'questions', 'risks'],
    },
  };

  async function callAnthropic(messages: Anthropic.MessageParam[]): Promise<Plan> {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 2500,
      system: systemPrompt,
      tools: [planToolDef],
      tool_choice: { type: 'tool', name: 'submit_plan' },
      messages,
    });

    const toolUse = response.content.find(c => c.type === 'tool_use' && c.name === 'submit_plan') as Anthropic.ToolUseBlock | undefined;
    if (!toolUse || !toolUse.input) {
      throw new Error('Anthropic model did not return a structured plan tool call');
    }

    const parseResult = PlanSchema.safeParse(toolUse.input);
    if (!parseResult.success) {
      throw new Error(`Invalid plan schema: ${JSON.stringify(parseResult.error.issues)}`);
    }

    return parseResult.data as Plan;
  }

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userContent },
  ];

  try {
    return await callAnthropic(messages);
  } catch (firstErr: any) {
    // Retry once with validation error appended
    messages.push({
      role: 'user',
      content: `The previous plan was rejected due to schema error: ${firstErr.message}. Please fix and return a valid plan.`,
    });
    try {
      return await callAnthropic(messages);
    } catch (secondErr: any) {
      console.warn('[Planner] Anthropic planning failed twice; falling back to deterministic plan:', secondErr.message);
      return generateFakePlan(brief, manifest, answers);
    }
  }
}
