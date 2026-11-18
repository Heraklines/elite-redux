/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// The Tier B convention (spec 3.1 / 3.3): a gate that lives inside `canApply` is split into
//
//   canApply = guards(p) && gate(prepare(p)) && residual(prepare(p))
//
// in the ORIGINAL clause order. `guards` are the non-removable safety rules that come first,
// `prepare` is the frame rewrite that must stay in the frame builder (for PostDamage: the multi-hit
// damage rewrite), `gate` is the part the vocabulary can replace, and `residual` is the feasibility
// that stays in the class and must not test the gate again.
//
// The compiler replaces only the gate, by setting `gateOverride` on a freshly built instance.

/** What a Tier B class implements. All four members are optional so a class can adopt it step by step. */
export interface GatedAttr<P> {
  guards?(params: P): boolean;
  prepare?(params: P): P;
  gate?(params: P): boolean;
  residual?(params: P): boolean;
  /** Set by the compiler; replaces `gate` for this instance only. */
  gateOverride?: ((params: P) => boolean) | undefined;
}

/** The shared `canApply` body of every Tier B class. Keeps clause order and short-circuiting. */
export function gatedCanApply<P>(attr: GatedAttr<P>, params: P): boolean {
  if (attr.guards !== undefined && !attr.guards(params)) {
    return false;
  }
  const prepared = attr.prepare === undefined ? params : attr.prepare(params);
  const gate = attr.gateOverride ?? attr.gate?.bind(attr);
  if (gate !== undefined && !gate(prepared)) {
    return false;
  }
  return attr.residual === undefined || attr.residual(prepared);
}

export function setGateOverride<P>(attr: GatedAttr<P>, gate: ((params: P) => boolean) | undefined): void {
  attr.gateOverride = gate;
}
