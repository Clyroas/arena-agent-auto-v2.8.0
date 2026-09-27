import { readFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const files = JSON.parse(await readFile(resolve(root, 'extension-files.json'), 'utf8'));
if (!/^\d+(?:\.\d+){0,3}$/.test(manifest.version)) throw new Error('Invalid extension version');
const output = resolve(root, 'dist', `arena-auto-chat-${manifest.version}`);
for (const file of files) {
  if (typeof file !== 'string' || !/^[a-zA-Z0-9._/-]+$/.test(file) || file.split('/').includes('..')) throw new Error('Unsafe package path');
  const source = resolve(root, file);
  if (!source.startsWith(root.endsWith(sep) ? root : root + sep)) throw new Error('Package path escaped the repository');
  await readFile(source); // fail before altering the output if an allow-listed file is missing
}
await rm(output, { recursive: true, force: true });
for (const file of files) {
  const target = resolve(output, file);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(root, file), target);
}
console.log(`Packaged ${files.length} allow-listed files in ${output}`);
