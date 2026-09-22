import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('src');
let count = 0;
async function walk(dir) { for (const entry of await fs.readdir(dir, { withFileTypes: true })) { const p = path.join(dir, entry.name); if (entry.isDirectory()) await walk(p); else if (p.endsWith('.js')) { count++; } } }
await walk(root); console.log(`Project contains ${count} JavaScript source files.`);
