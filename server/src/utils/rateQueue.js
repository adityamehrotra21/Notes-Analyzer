// Small in-process queue that paces work so free-tier limits are never burst.
//  - concurrency: max jobs running at once
//  - rpm: jobs are spaced at least 60s/rpm apart (smooth, no bursts)
//  - tpm: a sliding 60s window of job "weights" (estimated tokens) never exceeds tpm
// Jobs added with { priority: true } (e.g. a user's chat query) jump ahead of background work.
// Jobs keep the request context they were queued in (requestId/userId for logs and usage).
import { bindContext } from './requestContext.js';

export class RateQueue {
  #jobs = [];
  #active = 0;
  #window = []; // [{ t, weight }] for the last 60s
  #lastStart = 0;
  #timer = null;

  constructor({ name = 'queue', concurrency = 1, rpm = 0, tpm = 0 } = {}) {
    this.name = name;
    this.concurrency = concurrency;
    this.interval = rpm > 0 ? 60_000 / rpm : 0;
    this.tpm = tpm;
  }

  get pending() {
    return this.#jobs.length;
  }

  get running() {
    return this.#active;
  }

  add(fn, { weight = 0, priority = false } = {}) {
    // A single job bigger than the whole budget still has to run; it just runs alone.
    const w = this.tpm ? Math.min(weight, this.tpm) : 0;
    return new Promise((resolve, reject) => {
      const job = { fn: bindContext(fn), weight: w, resolve, reject };
      if (priority) this.#jobs.unshift(job);
      else this.#jobs.push(job);
      this.#pump();
    });
  }

  #waitMs(weight, now) {
    this.#window = this.#window.filter((s) => now - s.t < 60_000);
    let wait = this.interval ? this.#lastStart + this.interval - now : 0;
    if (this.tpm) {
      let used = this.#window.reduce((a, s) => a + s.weight, 0);
      for (const s of this.#window) {
        if (used + weight <= this.tpm) break;
        used -= s.weight;
        wait = Math.max(wait, s.t + 60_000 - now);
      }
    }
    return Math.max(0, wait);
  }

  #pump() {
    if (this.#timer) return;
    while (this.#active < this.concurrency && this.#jobs.length) {
      const now = Date.now();
      const wait = this.#waitMs(this.#jobs[0].weight, now);
      if (wait > 0) {
        this.#timer = setTimeout(() => {
          this.#timer = null;
          this.#pump();
        }, wait + 5);
        return;
      }
      const job = this.#jobs.shift();
      this.#lastStart = now;
      if (job.weight) this.#window.push({ t: now, weight: job.weight });
      this.#active++;
      Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.#active--;
          this.#pump();
        });
    }
  }
}
