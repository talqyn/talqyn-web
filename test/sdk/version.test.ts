import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Talqyn, TALQYN_CLIENT_HEADER, TALQYN_VERSION } from '../../src/sdk/index.js';

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  readonly version: string;
};

/** The version travels with every request; it must be the version of the package that was published. */
describe('the SDK version', () => {
  it('matches the package', () => {
    expect(TALQYN_VERSION).toBe(packageJson.version);
    expect(Talqyn.version).toBe(packageJson.version);
  });

  it('names the platform in the client header', () => {
    expect(TALQYN_CLIENT_HEADER).toBe(`web/${packageJson.version}`);
    expect(Talqyn.clientHeader).toBe(TALQYN_CLIENT_HEADER);
  });
});
