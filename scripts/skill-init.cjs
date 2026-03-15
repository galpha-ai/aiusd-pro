#!/usr/bin/env node
// Postinstall hook: register aiusd-nl globally
const { execSync } = require('child_process');
const path = require('path');

const green = '\x1b[32m';
const yellow = '\x1b[33m';
const reset = '\x1b[0m';

try {
  // Check if already registered
  const which = execSync('which aiusd-nl 2>/dev/null || true', { encoding: 'utf8' }).trim();
  if (which) {
    console.log(`${green}aiusd-nl already available at ${which}${reset}`);
    process.exit(0);
  }

  console.log(`${green}Registering aiusd-nl globally...${reset}`);
  execSync('npm install -g --ignore-scripts .', {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'pipe',
  });
  console.log(`${green}aiusd-nl registered successfully!${reset}`);
} catch (err) {
  console.warn(`${yellow}Global registration failed. Use: node dist/index.js${reset}`);
}
