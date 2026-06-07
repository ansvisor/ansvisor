#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const PACKAGE_PATHS = [
  resolve(root, 'package.json'),
  resolve(root, 'web/package.json'),
  resolve(root, 'server/package.json'),
];
const COMPOSE_PATH = resolve(root, 'docker-compose.yml');

function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`Invalid semver: ${version}`);
  return { major: +match[1], minor: +match[2], patch: +match[3] };
}

function bump(current, type) {
  const v = parseVersion(current);
  switch (type) {
    case 'major': return `${v.major + 1}.0.0`;
    case 'minor': return `${v.major}.${v.minor + 1}.0`;
    case 'patch': return `${v.major}.${v.minor}.${v.patch + 1}`;
    default:
      // Explicit version provided
      parseVersion(type); // validate
      return type;
  }
}

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node version-bump.js <patch|minor|major|x.y.z>');
  process.exit(1);
}

const rootPkg = JSON.parse(readFileSync(PACKAGE_PATHS[0], 'utf8'));
const oldVersion = rootPkg.version;
const newVersion = bump(oldVersion, arg);

for (const pkgPath of PACKAGE_PATHS) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.version = newVersion;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

const compose = readFileSync(COMPOSE_PATH, 'utf8');
let updatedImageCount = 0;
const updatedCompose = compose.replace(
  /(image:\s*ghcr\.io\/ansvisor\/ansvisor\/(?:web|server):)\d+\.\d+\.\d+/g,
  (_, prefix) => {
    updatedImageCount += 1;
    return `${prefix}${newVersion}`;
  },
);

if (updatedImageCount === 0) {
  throw new Error('No docker-compose image tags found to update');
}

writeFileSync(COMPOSE_PATH, updatedCompose);

console.log(`${oldVersion} -> ${newVersion}`);
