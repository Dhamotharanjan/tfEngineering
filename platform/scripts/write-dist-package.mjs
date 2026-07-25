import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
writeFileSync('dist/package.json', `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);
