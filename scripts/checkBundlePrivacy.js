import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MEMBERS } from '../src/config/members.js';

const assetsDir = new URL('../dist/assets/', import.meta.url);
const files = (await readdir(assetsDir)).filter((name) => name.endsWith('.js'));
if (files.length === 0) throw new Error('No built JavaScript assets found. Run npm run build first.');

const bundles = await Promise.all(files.map((name) => readFile(new URL(name, assetsDir), 'utf8')));
const leakedNames = MEMBERS.map((member) => member.name.trim()).filter((name) =>
  name.length >= 4 && bundles.some((bundle) => bundle.includes(name)),
);
if (leakedNames.length) {
  throw new Error(`Fixed member roll data detected in browser bundle (${leakedNames.length} name(s)).`);
}
console.log(`Bundle privacy check passed: ${MEMBERS.length} fixed member records are absent from ${files.length} browser JS assets.`);
