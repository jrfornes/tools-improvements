import * as ts from 'typescript';
import {
  calculateCyclomaticComplexity,
  isTsSourceFile,
  shouldFlagComplexity,
} from './complexity';

function complexityOf(source: string): number {
  const sourceFile = ts.createSourceFile(
    'x.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  return calculateCyclomaticComplexity(sourceFile);
}

describe('calculateCyclomaticComplexity', () => {
  it('is 1 for a straight-line function', () => {
    expect(complexityOf('function f(x: number) { return x + 1; }')).toBe(1);
  });

  it('counts each branch: if, loops, catch, case, ternary', () => {
    const source = `
      function f(x: number) {
        if (x > 0) { x++; }
        for (let i = 0; i < x; i++) {}
        while (x > 0) { x--; }
        try { risky(); } catch (e) { handle(e); }
        switch (x) {
          case 1: break;
          case 2: break;
        }
        return x > 0 ? 'a' : 'b';
      }
    `;
    // base 1 + if + for + while + catch + case*2 + ternary = 8
    expect(complexityOf(source)).toBe(8);
  });

  it('counts short-circuit and nullish operators', () => {
    expect(complexityOf('const y = a && b || (c ?? d);')).toBe(4);
  });
});

describe('isTsSourceFile', () => {
  it.each([
    ['src/foo.ts', true],
    ['src/foo.spec.ts', false],
    ['src/foo.cy.ts', false],
    ['src/foo.d.ts', false],
    ['src/foo.tsx', false],
  ])('%s -> %s', (file, expected) => {
    expect(isTsSourceFile(file)).toBe(expected);
  });
});

describe('shouldFlagComplexity', () => {
  it('stays quiet below the threshold regardless of history', () => {
    expect(shouldFlagComplexity(10, null, 25)).toBe(false);
    expect(shouldFlagComplexity(10, 5, 25)).toBe(false);
  });

  it('flags a new file (no base version) once over threshold', () => {
    expect(shouldFlagComplexity(30, null, 25)).toBe(true);
  });

  it('flags an existing file only when this change made it worse', () => {
    expect(shouldFlagComplexity(30, 24, 25)).toBe(true); // grew past threshold
    expect(shouldFlagComplexity(30, 30, 25)).toBe(false); // unchanged
    expect(shouldFlagComplexity(30, 40, 25)).toBe(false); // improved, still high
  });
});
