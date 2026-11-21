import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

const schema = z.object({ a: z.object({ b: z.string() }) });

describe('ZodValidationPipe', () => {
  const pipe = async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [{ provide: ZodValidationPipe, useValue: new ZodValidationPipe(schema) }],
    }).compile();
    return moduleRef.get<ZodValidationPipe<z.infer<typeof schema>>>(ZodValidationPipe);
  };

  it('returns the parsed value', async () => {
    expect((await pipe()).transform({ a: { b: 'x' } })).toEqual({ a: { b: 'x' } });
  });

  it('answers 400 with path and message for an invalid body', async () => {
    try {
      (await pipe()).transform({ a: { b: 1 } });
      throw new Error('expected a throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const body = (e as BadRequestException).getResponse() as { errors: { path: string; message: string }[] };
      expect(body.errors).toHaveLength(1);
      expect(body.errors[0].path).toBe('a.b');
    }
  });
});
