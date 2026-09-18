// The few Node APIs the tests use, declared here so the tests typecheck without @types/node.

declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
}

declare module 'node:util' {
  export function inspect(value: unknown, options?: { depth?: number; showHidden?: boolean }): string;
}
