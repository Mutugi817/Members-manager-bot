import fs from 'node:fs/promises';
import path from 'node:path';

export class JsonStore {
  constructor(file, initialValue, logger) {
    this.file = file;
    this.initialValue = structuredClone(initialValue);
    this.logger = logger;
    this.value = null;
    this.queue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      this.value = JSON.parse(raw);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.value = structuredClone(this.initialValue);
      await this.#write(this.value);
    }
    return this;
  }

  get() { return structuredClone(this.value); }

  async replace(nextValue) {
    return this.#enqueue(async () => {
      const previous = this.value;
      const next = structuredClone(nextValue);
      await this.#write(next);
      this.value = next;
      return structuredClone(this.value);
    }, previous => { this.value = previous; });
  }

  async mutate(mutator) {
    return this.#enqueue(async () => {
      const previous = structuredClone(this.value);
      const working = structuredClone(this.value);
      const result = await mutator(working);
      await this.#write(working);
      this.value = working;
      return structuredClone(result ?? working);
    });
  }

  #enqueue(task) {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async #write(value) {
    const dir = path.dirname(this.file);
    await fs.mkdir(dir, { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temp, this.file);
  }
}
