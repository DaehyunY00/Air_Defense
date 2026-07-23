/** Stable O(log n) queue using IADS_C2's (time, priority, sequence) contract. */
export class EventQueue {
  constructor() {
    this.heap = [];
    this.sequence = 0;
  }

  get size() { return this.heap.length; }

  push({ time, priority = 0, type, payload = {} }) {
    if (!Number.isFinite(time) || time < 0) throw new Error('event time must be non-negative and finite');
    if (!Number.isFinite(priority)) throw new Error('event priority must be finite');
    const event = { time, priority, sequence: this.sequence++, type, payload };
    this.heap.push(event);
    this._up(this.heap.length - 1);
    return event;
  }

  pop() {
    if (!this.heap.length) return null;
    const first = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length) {
      this.heap[0] = last;
      this._down(0);
    }
    return first;
  }

  peek() { return this.heap.length ? this.heap[0] : null; }

  _less(a, b) {
    return a.time !== b.time ? a.time < b.time
      : (a.priority !== b.priority ? a.priority < b.priority : a.sequence < b.sequence);
  }

  _up(index) {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this._less(this.heap[index], this.heap[parent])) break;
      [this.heap[index], this.heap[parent]] = [this.heap[parent], this.heap[index]];
      index = parent;
    }
  }

  _down(index) {
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let best = index;
      if (left < this.heap.length && this._less(this.heap[left], this.heap[best])) best = left;
      if (right < this.heap.length && this._less(this.heap[right], this.heap[best])) best = right;
      if (best === index) return;
      [this.heap[index], this.heap[best]] = [this.heap[best], this.heap[index]];
      index = best;
    }
  }
}

/** Compatibility adapter for the existing DES while the canonical runner is migrated. */
export class LegacyEventQueueAdapter {
  constructor() { this.queue = new EventQueue(); }
  size() { return this.queue.size; }
  push(event) {
    this.queue.push({ time: event.t, priority: event.pri, type: event.type, payload: event.data || {} });
  }
  pop() {
    const event = this.queue.pop();
    return event ? { t: event.time, pri: event.priority, seq: event.sequence, type: event.type, data: event.payload } : null;
  }
  peek() {
    const event = this.queue.peek();
    return event ? { t: event.time, pri: event.priority, seq: event.sequence, type: event.type, data: event.payload } : null;
  }
}
