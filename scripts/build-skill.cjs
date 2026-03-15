#!/usr/bin/env node
const { execSync } = require('child_process');
const { mkdirSync, copyFileSync, cpSync, statSync } = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build');
const tempDir = path.join(buildDir, 'temp');

// 1. Build TypeScript
console.log('Building TypeScript...');
execSync('npm run build', { cwd: root, stdio: 'inherit' });

// 2. Prepare build directory
mkdirSync(tempDir, { recursive: true });

// 3. Copy files
for (const file of ['package.json', 'SKILL.md', 'README.md']) {
  copyFileSync(path.join(root, file), path.join(tempDir, file));
}
cpSync(path.join(root, 'dist'), path.join(tempDir, 'dist'), { recursive: true });
mkdirSync(path.join(tempDir, 'scripts'), { recursive: true });
copyFileSync(
  path.join(root, 'scripts', 'skill-init.cjs'),
  path.join(tempDir, 'scripts', 'skill-init.cjs')
);

// 4. Create tarball
const skillFile = path.join(buildDir, 'aiusd-nl-skill.skill');
execSync(`tar -czf "${skillFile}" -C "${tempDir}" .`, { stdio: 'inherit' });

// 5. Cleanup temp
execSync(`rm -rf "${tempDir}"`);

// 6. Report
const size = statSync(skillFile).size;
console.log(`\nSkill package: ${skillFile}`);
console.log(`Size: ${(size / 1024).toFixed(1)} KB`);
