/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { isNotEmptyCondition } from './common_fields';
import type { EntityIdentity, EuidAttribute } from './identity_core_schema';
import { isLiteralFieldPath } from './inventory_schema';

/**
 * Separator between identity values in a composite entity id, e.g. `k8s.deployment:ns/name`.
 * Values are not escaped: an identity value containing `/` produces an ambiguous id, exactly as
 * `@` already does for the built-in `user` type.
 */
export const IDENTITY_TUPLE_SEPARATOR = '/';

/** How the inventory `identity` list is read: a tuple of required fields, or ranked alternatives. */
export type InventoryIdentityMode = 'tuple' | 'ranked';

/**
 * Normalises the inventory authoring form of an identity (an ordered list of literal field paths)
 * into the store's identity form so the EUID compiler needs no changes.
 *
 * - One field becomes the compiler's single-field fast path (`{ singleField }`).
 * - `tuple` (default): several fields become one ranking branch with one composition joined by
 *   {@link IDENTITY_TUPLE_SEPARATOR}, plus a `documentsFilter` requiring every field to be present.
 * - `ranked`: several fields become one branch with one single-field composition per field, in
 *   priority order (the first present, non-empty field is the id), plus a `documentsFilter`
 *   requiring any of them: the same shape as the built-in `host` identity. For the same identifier
 *   value carried under different field names by different sources.
 *
 * Throws when a field is not a literal path (expressions, wildcards and whitespace are rejected)
 * or when the list is empty or contains duplicates.
 */
export function identityTupleToIdentityField(
  identity: readonly string[],
  mode: InventoryIdentityMode = 'tuple'
): EntityIdentity {
  assertValidIdentityTuple(identity);

  if (identity.length === 1) {
    return { singleField: identity[0] };
  }

  if (mode === 'ranked') {
    return {
      euidRanking: { branches: [{ ranking: identity.map((field) => [{ field }]) }] },
      documentsFilter: { or: identity.map((field) => isNotEmptyCondition(field)) },
    };
  }

  const composition: EuidAttribute[] = identity.flatMap((field, index) =>
    index === 0 ? [{ field }] : [{ sep: IDENTITY_TUPLE_SEPARATOR }, { field }]
  );

  return {
    euidRanking: { branches: [{ ranking: [composition] }] },
    documentsFilter: { and: identity.map((field) => isNotEmptyCondition(field)) },
  };
}

function assertValidIdentityTuple(identity: readonly string[]): void {
  if (identity.length === 0) {
    throw new Error('Identity tuple must contain at least one field');
  }
  const invalid = identity.filter((field) => !isLiteralFieldPath(field));
  if (invalid.length > 0) {
    throw new Error(
      `Identity fields must be literal field paths (no expressions, wildcards or whitespace): ${invalid
        .map((field) => `"${field}"`)
        .join(', ')}`
    );
  }
  if (new Set(identity).size !== identity.length) {
    throw new Error(`Identity tuple must not contain duplicate fields: ${identity.join(', ')}`);
  }
}
