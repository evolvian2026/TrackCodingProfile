import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the gap between how the app runs in development and how it runs in a
 * container.
 *
 * Everything else in this suite exercises the TypeScript sources through `tsx`,
 * so a wrong path in a Dockerfile or a start script is invisible to all of it.
 * That is exactly what happened: `tsconfig` emits to `dist/src/index.js`
 * because `rootDir` is the package root (so `prisma/seed.ts` compiles too), but
 * the Dockerfile ran `node dist/index.js`. Every test passed and the container
 * crash-looped.
 *
 * These checks are static — they read the config files rather than building —
 * so they cost nothing and still catch the mismatch.
 */

const root = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(root, '..');

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
const read = (file: string) => fs.readFileSync(file, 'utf8');

const tsconfig = readJson(path.join(root, 'tsconfig.json'));
const pkg = readJson(path.join(root, 'package.json'));

/** Where `tsc` puts a source file, given this tsconfig's outDir and rootDir. */
function emittedPath(source: string): string {
  const outDir = tsconfig.compilerOptions.outDir as string;
  const rootDir = (tsconfig.compilerOptions.rootDir as string) ?? '.';
  const relative = path.relative(rootDir, source);
  return path.join(outDir, relative).replace(/\.ts$/, '.js');
}

const ENTRYPOINTS = {
  api: emittedPath('src/index.ts'),
  worker: emittedPath('src/worker.ts'),
  seed: emittedPath('prisma/seed.ts'),
};

describe('the compiled entrypoints', () => {
  it('derives the paths the build actually produces', () => {
    // If this changes, every reference below has to change with it — which is
    // the whole point of the checks that follow.
    expect(ENTRYPOINTS).toEqual({
      api: 'dist/src/index.js',
      worker: 'dist/src/worker.js',
      seed: 'dist/prisma/seed.js',
    });
  });

  it('is what the start scripts run', () => {
    expect(pkg.scripts.start).toBe(`node ${ENTRYPOINTS.api}`);
    expect(pkg.scripts['start:worker']).toBe(`node ${ENTRYPOINTS.worker}`);
  });

  it('is what the backend image runs', () => {
    const dockerfile = read(path.join(root, 'Dockerfile'));
    const cmd = dockerfile.match(/^CMD \[(.+)\]$/m)?.[1] ?? '';
    expect(cmd).toContain(ENTRYPOINTS.api);
  });

  it('is what compose tells the worker to run', () => {
    const compose = read(path.join(repoRoot, 'docker-compose.yml'));
    expect(compose).toContain(ENTRYPOINTS.worker);
    expect(compose).not.toMatch(/'node', 'dist\/worker\.js'/);
  });

  it('lets a container seed itself without a dev dependency', () => {
    // `tsx` is a devDependency and the image installs with --omit=dev, so the
    // production seed has to be the compiled one.
    expect(pkg.scripts['db:seed:prod']).toBe(`node ${ENTRYPOINTS.seed}`);
    expect(pkg.scripts['db:seed:prod']).not.toContain('tsx');
  });
});

describe('the single-container deployment', () => {
  const dockerfile = read(path.join(repoRoot, 'Dockerfile'));
  const entrypoint = read(path.join(repoRoot, 'docker-entrypoint.sh'));

  it('runs the entrypoint that actually exists', () => {
    expect(dockerfile).toContain(ENTRYPOINTS.api);
    expect(entrypoint).toContain(ENTRYPOINTS.seed);
  });

  it('migrates before starting, so a fresh database is never served', () => {
    expect(entrypoint).toContain('prisma migrate deploy');
    // `exec "$@"` must come last, or the app starts before the schema is up.
    expect(entrypoint.trimEnd().endsWith('exec "$@"')).toBe(true);
  });

  it('serves the SPA from the API, which is what keeps the session alive', () => {
    // The refresh cookie is SameSite=Strict, so a split origin silently breaks
    // every session once the access token expires.
    expect(dockerfile).toMatch(/SERVE_WEB=true/);
    expect(dockerfile).toContain('frontend/dist');
  });

  it('needs no Redis, because one process also drains the queue', () => {
    expect(dockerfile).toMatch(/QUEUE_DRIVER=inline/);
    expect(dockerfile).toMatch(/RUN_WORKER_IN_API=true/);
  });
});

describe('what survives --omit=dev', () => {
  it('keeps the Prisma CLI, because the container migrates itself', () => {
    // `prisma migrate deploy` is how the schema reaches a fresh database. A
    // devDependency would not be installed in the runtime image, so the
    // documented startup sequence would fail with "prisma: not found".
    expect(Object.keys(pkg.dependencies)).toContain('prisma');
    expect(Object.keys(pkg.devDependencies ?? {})).not.toContain('prisma');
  });

  it('does not reach for a dev tool in any script a container runs', () => {
    const containerScripts = ['start', 'start:worker', 'db:migrate', 'db:seed:prod'];
    const devOnly = Object.keys(pkg.devDependencies ?? {});
    for (const name of containerScripts) {
      const script = pkg.scripts[name] as string;
      const offender = devOnly.find((dep) => new RegExp(`(^|\\s)${dep}(\\s|$)`).test(script));
      expect(offender, `${name} runs "${script}", which needs the devDependency ${offender}`).toBeUndefined();
    }
  });
});
