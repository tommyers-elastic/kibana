/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EntityDefinitionRecord } from '@kbn/entity-store/common';

/**
 * How a record is presented in the list: an API definition, a bare built-in, a built-in carrying
 * an inventory extension (API or code), or a code-registered definition.
 */
export type RecordKind = 'definition' | 'built_in' | 'built_in_extension' | 'code';

export const getRecordKind = ({ source, inventorySource }: EntityDefinitionRecord): RecordKind => {
  if (source === 'api') {
    return 'definition';
  }
  if (source === 'code') {
    return 'code';
  }
  return inventorySource === undefined ? 'built_in' : 'built_in_extension';
};

const RANKING_PREFIX = 'ranking: ';

/**
 * A one-line description of what identifies an entity: the authored tuple joined with " + ", a
 * single field, or "ranking: a, b, c" for the fields a built-in's ranking may fall back through.
 */
export const describeIdentity = ({ definition }: EntityDefinitionRecord): string => {
  const { inventory, identityField } = definition;
  if (inventory !== undefined && 'identity' in inventory && inventory.identity.length > 0) {
    return inventory.identity.join(' + ');
  }
  if ('singleField' in identityField) {
    return identityField.singleField;
  }
  const fields = identityField.euidRanking.branches.flatMap(({ ranking }) =>
    ranking.flatMap((composition) =>
      composition.flatMap((part) => ('field' in part ? [part.field] : []))
    )
  );
  return `${RANKING_PREFIX}${[...new Set(fields)].join(', ')}`;
};

/** Index patterns of the inventory sources, in declaration order (empty without an extension). */
export const getSourceIndices = ({ definition }: EntityDefinitionRecord): string[] =>
  definition.inventory?.sources.map(({ index }) => index) ?? [];
