/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EntityDefinition } from '@kbn/entity-store/common';
import { getInventoryIdentityPlan } from '@kbn/entity-store/common';
import { euid } from '@kbn/entity-store/common/euid_helpers';
import { ENTITY_ID_COLUMN, type InventoryIdentityDescriptor } from '../../../common';
import { quoteIdentifier } from './esql_syntax';

export interface IdentityPlan extends InventoryIdentityDescriptor {
  /** Pre-aggregation predicate: every field of a composition present, for any composition. */
  presenceFilter: string;
  /** `EVAL` assignments computing `entity.id` on the aggregated rows (may emit helper columns). */
  entityIdEvaluation: string;
}

const compositionPresence = (composition: string[]): string =>
  composition.map((field) => `${quoteIdentifier(field)} IS NOT NULL`).join(' AND ');

/**
 * How to group and identify entities of a definition, derived from its `identityField` for every
 * type (the store validates authored inventory definitions to the subset served here). One
 * composition is a tuple: every field must be present and the rows group by all of them. Several
 * compositions are a ranking (built-in types such as `host`, or authored alternatives such as a
 * claim id carried as `halcyon.claim_id` in traces and `claim_id` in logs): rows group by every
 * field the ranking references and the compiler's expression picks the first present composition
 * per row, so the same identifier under different field names yields one id. Identity is grouped
 * on raw mapped fields and never computed per document (200x slower).
 */
export const resolveIdentityPlan = (definition: EntityDefinition): IdentityPlan => {
  const { compositions, fields } = getInventoryIdentityPlan(definition);
  const entityIdEvaluation = euid.fromDefinition.esql.getEuidEvaluation(
    definition,
    ENTITY_ID_COLUMN
  );
  if (compositions.length === 1) {
    return {
      kind: 'tuple',
      fields,
      compositions,
      presenceFilter: compositionPresence(compositions[0]),
      entityIdEvaluation,
    };
  }
  return {
    kind: 'ranking',
    fields,
    compositions,
    presenceFilter: `(${compositions
      .map((composition) =>
        composition.length === 1
          ? compositionPresence(composition)
          : `(${compositionPresence(composition)})`
      )
      .join(' OR ')})`,
    entityIdEvaluation,
  };
};
