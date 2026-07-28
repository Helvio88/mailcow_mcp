#!/usr/bin/env node
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const cwd = process.cwd();
const args = process.argv.slice(2);
const srcEntry = path.join(cwd, 'src', 'index.ts');
const distEntry = path.join(cwd, 'dist', 'src', 'index.js');

function run(cmd, cmdArgs) {
  const child = spawn(cmd, cmdArgs, { stdio: 'inherit', shell: false });
  child.on('exit', (code) => process.exit(code));
}

(async function main() {
  // Detect if ts-node is available in this project
  let canUseTsNode = false;
  try {
    require.resolve('ts-node/register', { paths: [cwd] });
    canUseTsNode = true;
  } catch (e) {}

  // Prefer running source with ts-node in dev
  if (fs.existsSync(srcEntry) && canUseTsNode) {
    const node = process.execPath || 'node';
    run(node, ['-r', 'ts-node/register', srcEntry, ...args]);
    return;
  }

  // Fallback to built dist
  if (fs.existsSync(distEntry)) {
    const node = process.execPath || 'node';
    run(node, [distEntry, ...args]);
    return;
  }

  console.error('Unable to find a runnable entry point.');
  console.error('- Run "npm run build" to produce the dist/ entry point.');
  console.error('- Or install ts-node in this project to run directly from source: "npm i -D ts-node"');
  process.exit(1);
})();
