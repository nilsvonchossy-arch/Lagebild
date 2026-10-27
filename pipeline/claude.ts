// Claude-Aufrufe mit strukturierter Antwort (Zod-Schema), Kostenzählung und Fallback bei Ablehnungen.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import { log } from './util.ts';

/** Preise in US-Dollar pro 1 Mio. Token: Eingabe, Ausgabe, Cache-Lesen (Stand Oktober 2026) */
const PRICES: Record<string, [number, number, number]> = {
  'claude-opus-5-5': [4, 20, 0.2],
  'claude-sonnet-5-5': [2, 10, 0.2],
  'claude-haiku-5-5': [0.1, 0.5, 0.01]
};

/** Opus und Sonnet können abgelehnte Anfragen serverseitig an ein anderes Modell weitergeben, Haiku nicht. */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

export class RefusalError extends Error {}

export interface UsageTotal { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number }

export class Claude {
  readonly usage: UsageTotal = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };
  private readonly client = new Anthropic({ maxRetries: 4 });

  readonly model: string;
  readonly effort: 'low' | 'medium' | 'high';

  constructor(model: string, effort: 'low' | 'medium' | 'high' = 'medium') {
    this.model = model;
    this.effort = effort;
  }

  /** Eine Anfrage mit festem System-Prompt (wird gecacht) und strukturierter Antwort. */
  async ask<S extends z.ZodType>(label: string, system: string, user: string, schema: S, maxTokens = 16000): Promise<z.infer<S>> {
    const fallback = FALLBACK_MODELS.has(this.model);
    const res = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: maxTokens,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
      output_config: { format: betaZodOutputFormat(schema), effort: this.effort },
      ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {})
    });
    this.count(res.usage, res.model);
    if (res.stop_reason === 'refusal') {
      throw new RefusalError(`${label}: abgelehnt (${res.stop_details?.category ?? 'ohne Kategorie'})`);
    }
    if (res.stop_reason === 'max_tokens') throw new Error(`${label}: Antwort abgeschnitten (max_tokens)`);
    if (res.parsed_output == null) throw new Error(`${label}: Antwort passt nicht zum Schema`);
    if (res.model !== this.model) log(`${label}: beantwortet von ${res.model} (Fallback)`);
    return res.parsed_output as z.infer<S>;
  }

  private count(u: Anthropic.Beta.BetaUsage, servedBy: string): void {
    const [pin, pout, pcache] = PRICES[servedBy] ?? PRICES[this.model] ?? [0, 0, 0];
    const input = u.input_tokens ?? 0;
    const cacheRead = u.cache_read_input_tokens ?? 0;
    const cacheWrite = u.cache_creation_input_tokens ?? 0;
    const output = u.output_tokens ?? 0;
    this.usage.calls++;
    this.usage.input += input;
    this.usage.output += output;
    this.usage.cacheRead += cacheRead;
    this.usage.cacheWrite += cacheWrite;
    this.usage.costUsd += (input * pin + cacheWrite * pin * 1.25 + cacheRead * pcache + output * pout) / 1e6;
  }
}
