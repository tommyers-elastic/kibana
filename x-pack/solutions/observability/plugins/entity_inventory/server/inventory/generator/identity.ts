/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EntityDefinition } from '@kbn/entity-store/common';
import { getInventoryIdentity, getInventoryIdentityMode } from '@kbn/entity-store/common';
import { euid } from '@kbn/entity-store/common/euid_helpers';
import { ENTITY_ID_COLUMN, type InventoryIdentityDescriptor } from '../../../common';
import { quoteIdentifier } from './esql_syntax';

export interface IdentityPlan extends InventoryIdentityDescriptor {
  /** Pre-aggregation predicate: every tuple field present, or any ranking field present. */
  presenceFilter: string;
  /** `EVAL` assignments computing `entity.id` on the aggregated rows (may emit helper columns). */
  entityIdEvaluation: string;
}

/**
 * How to group and identify entities of a definition. Authored tuple identities: every field must
 * be present and the rows group by all of them. Ranked identities (built-in types such as `host`,
 * or authored definitions with `identityMode: "ranked"`): rows group by every field the ranking
 * references and the compiler's expression picks the first present one per row, so the same
 * identifier carried under different field names by different sources yields one id.
 * Identity is grouped on raw mapped fields and never computed per document (200x slower).
 */
export const resolveIdentityPlan = (definition: EntityDefinition): IdentityPlan => {
  const entityIdEvaluation = euid.fromDefinition.esql.getEuidEvaluation(
    definition,
    ENTITY_ID_COLUMN
  );
  const tuple = getInventoryIdentity(definition);
  if (tuple && getInventoryIdentityMode(definition) !== 'ranked') {
    return {
      kind: 'tuple',
      fields: tuple,
      presenceFilter: tuple.map((field) => `${quoteIdentifier(field)} IS NOT NULL`).join(' AND '),
      entityIdEvaluation,
    };
  }
  const { identitySourceFields } = euid.fromDefinition.getEuidSourceFields(definition);
  return {
    kind: 'ranking',
    fields: identitySourceFields,
    presenceFilter: `(${identitySourceFields
      .map((field) => `${quoteIdentifier(field)} IS NOT NULL`)
      .join(' OR ')})`,
    entityIdEvaluation,
  };
};
