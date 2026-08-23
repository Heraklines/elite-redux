# M6 targeting and topology

Oracle SHA: `3bb6d49c924293ef79e3ab2f11e10cf4f5b9c6c7`.

## Topology authority

`src/data/battle-format.ts` is the source contract for side capacities, team arrangement, flat-index compatibility, and adjacency. M6 canonical state uses stable side/position field slots and explicit adjacency. Fixed singles/doubles battler enums are not the core model.

Species or Pokémon object identity is never a target identity. A target is a stable field slot plus the expected occupant Pokémon ID at validation time.

## Observed target derivation

`src/data/moves/move.ts:259-523` supplies authored move target shape. `src/data/moves/move-utils.ts:1-263` establishes the target-set operations used by the current oracle:

1. derive candidates from authored target kind and current field occupancy;
2. normalize to canonical field-slot order;
3. apply side and adjacency filtering;
4. apply legal-target filtering;
5. apply spread promotion or target-shape rewriting;
6. apply redirection or counter-target rules at their observed hook;
7. if an observed mechanic requests random selection, draw from the final ordered candidate list;
8. revalidate the selected target immediately before action execution.

An empty candidate set fails according to the move/control contract and does not consume a random-selection draw.

## Mechanics IR V2 selector vocabulary

Required closed selector operations:

- source battler;
- explicit field slot;
- current occupant;
- ally or enemy side;
- all occupied field slots;
- adjacent occupied field slots;
- legal move targets;
- fainted/healthy party members;
- stable filter;
- stable distinct;
- stable sort by field-slot key;
- first/last;
- audited random one;
- authored spread promotion;
- explicit redirect replacement.

Every selector returns a stable ordered vector. Set or map iteration is never observable ordering.

## Execution invariants

- Command submission validates target shape, but turn execution revalidates the live occupant and legality.
- A target that faints or switches before the action cannot be dereferenced through a stale object.
- Spread power or damage modifiers derive from the resolved target set at the oracle-defined stage.
- Redirection changes the target set, not the actor or command identity.
- Random targeting records candidate count, selected index, reason, and RNG fingerprints.
- Triples remain representable through topology and adjacency even where M6 witnesses cover singles and doubles first.

## Explicit gaps

Variable-target attributes, Commander, counter redirection, trap rules, and callback-authored target promotion remain bespoke until each is represented by closed selectors/conditions/operations and an oracle witness. Static source inspection proves the hook and callback provenance, not the callback's portable semantics.
