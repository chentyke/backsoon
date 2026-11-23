import fs from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { now, save } from './store.js';
import { OutputActivity } from './activity.js';
import { msg } from './locale.js';

export class Output {
  constructor(dir, task, notices) {
    this.task = task;
    this.activity = new OutputActivity(task);
    this.notices = notices;
    this.file = path.join(dir, 'output.log');
    this.stateFile = path.join(dir, 'task.json');
    this.previous = path.join(dir, 'output.prev');
    this.fd = fs.openSync(this.file, 'a', 0o600);
    this.size = fs.fstatSync(this.fd).size;
    this.match = task.match && new RegExp(task.match);
    this.rules = new Map(
      Object.entries(task.alert_on || {}).map(([name, re]) => [name, new RegExp(re)]),
    );
  }
  close() {
    fs.closeSync(this.fd);
  }
  stream(stream) {
    stream.setEncoding('utf8');
    let partial = '';
    stream.on('data', (chunk) => {
      const lines = (partial + chunk).split(/[\r\n]/);
      partial = lines.pop();
      for (const line of lines) this.line(line);
      while (partial.length > 8192) {
        this.line(partial.slice(0, 8192));
        partial = partial.slice(8192);
      }
    });
    stream.on('end', () => this.line(partial));
  }
  alert(message) {
    this.task.last_alert = message;
    this.task.updated = now();
    save(this.stateFile, this.task);
    this.notices?.send(msg('alertTriggered', { message }));
  }
  line(raw) {
    const line = stripVTControlCharacters(raw).replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === '\t' ? c : ''));
    if (!line.trim()) return;
    if (this.size >= 1024 * 1024) {
      this.close();
      fs.renameSync(this.file, this.previous);
      this.fd = fs.openSync(this.file, 'w', 0o600);
      this.size = 0;
    }
    const bytes = Buffer.from(line + '\n');
    fs.writeFileSync(this.fd, bytes);
    this.size += bytes.length;
    const task = this.task;
    const previous = [task.percent, task.stage];
    Object.assign(task, { latest: line.slice(-1000), updated: now() });
    if (!task.progress_script && !task.watch) {
      const recognized = this.activity.read(line, task.updated);
      const counts = /^\[([\d,]{1,20}) \/ ([\d,]{1,20})\]/.exec(line);
      if (counts) {
        const [done, total] = counts.slice(1).map((s) => Number(s.replaceAll(',', '')));
        if (total > 0 && done <= total) {
          this.completed = null;
          Object.assign(task, {
            percent: (100 * done) / total,
            stage: line.slice(0, 500),
            progress_source: 'bazel',
            action_done: done,
            action_total: total,
          });
        }
      } else if (/^(Analyzing: target |INFO: Analyzed target )/.test(line)) {
        if (task.percent == null || task.progress_source !== 'bazel' || this.completed != null) {
          this.completed = null;
          Object.assign(task, { percent: null, stage: line.slice(0, 500), progress_source: 'bazel' });
        }
      } else if (task.progress_source === 'bazel' && /^\s*(?:Linking|Compiling|Building)\s+\S/.test(line)) {
        task.stage = line.trim().slice(0, 500);
      } else if (!recognized && task.progress_source !== 'bazel') {
        const percent = [...line.matchAll(/(?<![\d.\-])((?:100(?:\.0+)?|\d{1,2}(?:\.\d+)?))\s*%/g)].at(
          -1,
        );
        if (percent)
          Object.assign(task, {
            percent: Number(percent[1]),
            progress_source: line.trim() === percent[0] ? 'percent' : null,
          });
      }
      if (previous[0] !== task.percent || previous[1] !== task.stage) task.progress_at = task.updated;
      const success = /^INFO: Build completed successfully, ([\d,]{1,20}) total actions?$/.exec(
        line.trim(),
      );
      if (success) this.completed = Number(success[1].replaceAll(',', ''));
    }
    if (['git', 'curl', 'wget'].includes(path.basename(task.argv[0] || '')) &&
        /(?:timed? out|timeout|could not resolve|connection refused|couldn't connect)/i.test(line)) {
      if (task.network_error !== line) task.progress_at = task.updated;
      task.network_error = line.slice(0, 500);
    }
    if (this.match?.test(line)) this.notices?.match(line);
    const matched = [];
    for (const [name, re] of this.rules)
      if (re.test(line)) {
        matched.push(name);
        this.rules.delete(name);
      }
    if (matched.length) this.alert(matched.join(', ') + '\n' + line.slice(0, 500));
  }
}
