#!/usr/bin/env node
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const packageRoot = path.join(__dirname, '..');
const args = process.argv.slice(2);
const srcEntry = path.join(packageRoot, 'src', 'index.ts');
const distEntry = path.join(packageRoot, 'dist', 'index.js');

function run(cmd, cmdArgs) {
  const child = spawn(cmd, cmdArgs, { stdio: 'inherit', shell: false });
  child.on('exit', (code) => process.exit(code ?? 1));
}

(async function main() {
  if (fs.existsSync(distEntry)) {
    run(process.execPath || 'node', [distEntry, ...args]);
    return;
  }

  let canUseTsx = false;
  try {
    require.resolve('tsx', { paths: [packageRoot] });
    canUseTsx = true;
  } catch (e) {}

  if (fs.existsSync(srcEntry) && canUseTsx) {
    run(process.execPath || 'node', ['--import', 'tsx', srcEntry, ...args]);
    return;
  }

  console.error('Unable to find a runnable entry point.');
  console.error('- Run "npm run build" to produce the dist/ entry point.');
  console.error('- Or install tsx in this project to run directly from source: "npm i -D tsx"');
  process.exit(1);
})();
