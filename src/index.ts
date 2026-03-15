#!/usr/bin/env node
import { createCli } from './cli.js';

const program = createCli();
program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
