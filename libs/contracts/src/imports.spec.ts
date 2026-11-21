import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '../../..');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });

describe('app boundaries', () => {
  it('apps/demo-bank reaches the contract only through @app/contracts', () => {
    for (const f of files(join(root, 'apps/demo-bank'))) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/from '[^']*(libs\/contracts|contracts\/src)/);
      expect(src).not.toMatch(/from '(\.\.\/)+contracts/);
    }
  });
});
