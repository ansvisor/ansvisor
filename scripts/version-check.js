#!/usr/bin/env node

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const packages = [
  { name: 'root', path: resolve(root, 'package.json') },
  { name: 'web', path: resolve(root, 'web/package.json') },
  { name: 'server', path: resolve(root, 'server/package.json') },
];
const composePath = resolve(root, 'docker-compose.yml');

const versions = packages.map(({ name, path }) => {
  const { version } = JSON.parse(readFileSync(path, 'utf8'));
  return { name, version };
});

const compose = readFileSync(composePath, 'utf8');
const imageVersions = [...compose.matchAll(
  /image:\s*ghcr\.io\/ansvisor\/ansvisor\/(web|server):(\d+\.\d+\.\d+)/g,
)].map(([, service, version]) => ({
  name: `docker-compose ${service} image`,
  version,
}));

if (imageVersions.length !== 2) {
  console.error('Could not find both web and server docker-compose image tags.');
  process.exit(1);
}

versions.push(...imageVersions);

const allMatch = versions.every((v) => v.version === versions[0].version);

if (allMatch) {
  console.log(`All package and docker-compose versions at v${versions[0].version}`);
  process.exit(0);
} else {
  console.error('Version mismatch:');
  for (const { name, version } of versions) {
    console.error(`  ${name}: ${version}`);
  }
  process.exit(1);
}
