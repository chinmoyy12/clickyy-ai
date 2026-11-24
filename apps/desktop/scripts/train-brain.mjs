// Trains Clickyy's on-device intent network from the command catalog and writes
// src/main/assistant/brain/weights.json. Run after changing the catalog: npm run brain:train
import { build } from 'esbuild';
import { writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'scripts/.brain-entry.ts');
const out = resolve(root, 'scripts/.brain.mjs');
writeFileSync(entry, `export { trainingSet } from '../src/main/assistant/brain/data';\nexport { IntentNet } from '../src/main/assistant/brain/net';\nexport { featurize } from '../src/main/assistant/brain/features';\n`);
await build({ entryPoints: [entry], outfile: out, bundle: true, platform: 'node', format: 'esm', alias: { '@shared': resolve(root, 'src/shared') }, logLevel: 'error' });
const { trainingSet, IntentNet, featurize } = await import(pathToFileURL(out).href);
rmSync(entry);
rmSync(out);

const t0 = Date.now();
const { labels, samples, hash } = trainingSet();
const index = new Map(labels.map((l, i) => [l, i]));
const data = samples.map((s) => ({ x: featurize(s.text), y: index.get(s.label) }));
console.log(`${labels.length} intents, ${samples.length} training sentences, data ${hash}`);
const net = new IntentNet(labels, 64);
net.train(data, { epochs: 14, lr: 0.08, onEpoch: (e, loss, acc) => console.log(`epoch ${e + 1}: loss ${loss.toFixed(4)}, train accuracy ${(acc * 100).toFixed(1)}%`) });
const w = net.toWeights(hash);
writeFileSync(resolve(root, 'src/main/assistant/brain/weights.json'), JSON.stringify(w));
console.log(`wrote weights (${Math.round(JSON.stringify(w).length / 1024)} KB) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
