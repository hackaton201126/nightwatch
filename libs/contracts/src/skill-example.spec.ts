import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '../../..');
const skillPath = join(root, '.agents/skills/nightwatch-decision/SKILL.md');
const digest = () => createHash('sha256').update(readFileSync(skillPath)).digest('hex');

const before = digest();
const text = readFileSync(skillPath, 'utf8');

const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
const frontField = (name: string): string | undefined => {
  const m = new RegExp(`^${name}:[ \\t]*(.*)$`, 'm').exec(front?.[1] ?? '');
  return m?.[1].trim().replace(/^(["'])(.*)\1$/, '$2');
};
const jsonBlocks = [...text.matchAll(/^```json[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm)].map((m) => m[1]);

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(
  JSON.parse(readFileSync(join(root, 'docs/nightwatch-risk-response.schema.json'), 'utf8')),
);

describe('nightwatch-decision skill file', () => {
  it('has front matter with the expected name and a bounded description', () => {
    expect(front).not.toBeNull();
    expect(frontField('name')).toBe('nightwatch-decision');
    const description = frontField('description') ?? '';
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(1024);
  });

  it('has exactly one json block', () => {
    expect(jsonBlocks).toHaveLength(1);
  });

  describe('example decision', () => {
    const example = () => JSON.parse(jsonBlocks[0]);

    it('is valid against the response schema', () => {
      const ok = validate(example());
      expect(validate.errors ?? []).toEqual([]);
      expect(ok).toBe(true);
    });

    it('is a non-final hold decided by devin', () => {
      const d = example();
      expect(d.decided_by).toBe('devin');
      expect(d.model.provider).toBe('devin');
      expect(d.decision).toBe('hold');
      expect(d.final).toBe(false);
      expect(typeof d.hold).toBe('object');
      expect(d.hold).not.toBeNull();
    });
  });

  it('leaves the skill file unchanged', () => {
    expect(digest()).toBe(before);
  });
});
