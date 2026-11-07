/**
 * @file Small store helpers.
 */
import type { Readable } from 'svelte/store';

/**
 * Derived store that only notifies when the selected value changes by `===`.
 * (Svelte's own `derived` re-notifies for any object value, which would re-render
 * every shape on every mouse-move.)
 *
 * IMPORTANT: Svelte's store contract has an optional second `invalidate` argument that a
 * `derived` store uses to mark an input as "update pending" until the matching `run`
 * arrives. This store often does NOT call `run` (value unchanged), so forwarding
 * `invalidate` would leave the downstream `derived` waiting forever and freeze it
 * (stale selection box, stale color picker…). It is therefore deliberately not forwarded;
 * the cost is only that a `derived` may briefly see one input updated before the other.
 */
export function select<T, U>(src: Readable<T>, fn: (v: T) => U): Readable<U> {
  return {
    subscribe(run) {
      let first = true;
      let last: U;
      return src.subscribe(v => {
        const u = fn(v);
        if (first || u !== last) { first = false; last = u; run(u); }
      });
    },
  };
}
