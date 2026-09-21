/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EntityDefinitionRecord } from '@kbn/entity-store/common';
import { formatIdentityCompositions } from '../../common';

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

/**
 * A one-line description of what identifies an entity, read from `identityField`: the fields of
 * a composition joined with " + " (`kubernetes.namespace + kubernetes.deployment.name`), ranked
 * alternatives joined with ", else " (`host.id, else host.name, else host.hostname`).
 */
export const describeIdentity = ({ definition }: EntityDefinitionRecord): string => {
  const { identityField } = definition;
  if ('singleField' in identityField) {
    return identityField.singleField;
  }
  // Same reading as the store's `getInventoryIdentityPlan`, kept local so the page-load bundle
  // does not import the schema module.
  const compositions = identityField.euidRanking.branches.flatMap(({ ranking }) =>
    ranking.map((composition) =>
      composition.flatMap((part) => ('field' in part ? [part.field] : []))
    )
  );
  return formatIdentityCompositions(compositions);
};

/** Index patterns of the inventory sources, in declaration order (empty without an extension). */
export const getSourceIndices = ({ definition }: EntityDefinitionRecord): string[] =>
  definition.inventory?.sources.map(({ index }) => index) ?? [];
