// Progress script for `backsoon demo`: reports where the sample task is on
// its timeline, measured from the moment BackSoon started it.
import fs from 'node:fs';
import path from 'node:path';
import { demoReading } from './demo.js';
import { now } from './store.js';

const task = JSON.parse(fs.readFileSync(path.join(process.env.BACKSOON_TASK_DIR, 'task.json'), 'utf8'));
console.log(JSON.stringify(demoReading(now() - task.started)));
