import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '../../..');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });

describe('app boundaries', () => {
  it.each([
    ['apps/nightwatch', 'demo-bank'],
    ['apps/demo-bank', 'nightwatch'],
  ])('%s does not import %s and reaches the contract only through @app/contracts', (app, other) => {
    for (const f of files(join(root, app))) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(new RegExp(`from '[^']*(apps/${other}|libs/contracts|contracts/src)`));
      expect(src).not.toMatch(/from '(\.\.\/)+contracts/);
    }
  });
});
