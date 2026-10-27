// Hörproben der deutschen Azure-Stimmen, um die zwei Lagebild-Stimmen auszuwählen.
//   node pipeline/voices.ts --out daten   → daten/stimmproben/<stimme>.mp3
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';
import { ssml } from './tts.ts';
import { log, sleep } from './util.ts';

export const VOICES = [
  'de-DE-ConradNeural',
  'de-DE-FlorianMultilingualNeural',
  'de-DE-KillianNeural',
  'de-DE-ChristophNeural',
  'de-DE-SeraphinaMultilingualNeural',
  'de-DE-KatjaNeural',
  'de-DE-AmalaNeural',
  'de-DE-LouisaNeural',
  'de-DE-Florian:DragonHDLatestNeural',
  'de-DE-Seraphina:DragonHDLatestNeural'
];

const SAMPLE = 'Guten Morgen. Hier ist dein Lagebild für Mittwoch, den 28. Oktober. Israel wählt heute ein neues Parlament. Bis 16 Uhr Ortszeit lag die Wahlbeteiligung bei 55,7 Prozent.';

const { values } = parseArgs({ options: { out: { type: 'string', default: 'daten' } } });
const key = process.env.AZURE_SPEECH_KEY;
const region = process.env.AZURE_SPEECH_REGION;
if (!key || !region) {
  console.log('::warning::AZURE_SPEECH_KEY oder AZURE_SPEECH_REGION fehlt.');
  process.exit(0);
}
const config = sdk.SpeechConfig.fromSubscription(key, region);
config.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;
const dir = join(values.out!, 'stimmproben');
mkdirSync(dir, { recursive: true });

const results: Record<string, string> = {};
for (const voice of VOICES) {
  const synth = new sdk.SpeechSynthesizer(config, null as unknown as sdk.AudioConfig);
  const res = await new Promise<sdk.SpeechSynthesisResult>((resolve, reject) => synth.speakSsmlAsync(ssml(SAMPLE, voice), resolve, reject));
  synth.close();
  if (res.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
    const file = `${voice.replace(/[:]/g, '_')}.mp3`;
    writeFileSync(join(dir, file), new Uint8Array(res.audioData));
    results[voice] = file;
  } else {
    results[voice] = `Fehler: ${res.errorDetails}`;
  }
  log(voice, results[voice]);
  await sleep(3300);
}
writeFileSync(join(dir, 'index.json'), JSON.stringify({ text: SAMPLE, results }, null, 1) + '\n');
if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, 'changed=true\n', { flag: 'a' });
