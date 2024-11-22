/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import * as z from '@kbn/zod';
import { entitylastSeenTimestampField } from './constants';

export * from './constants';

export const entitySourceSchema = z.object({
  type: z.string(),
  timestamp_field: z.optional(z.string().nullable()).default('@timestamp'),
  index_patterns: z.array(z.string()),
  identity_fields: z.array(z.string()),
  metadata_fields: z.array(z.string()),
  filters: z.array(z.string()),
});

export type EntitySource = z.infer<typeof entitySourceSchema>;

const sourceCommand = (source: EntitySource) => {
  let query = `FROM ${source.index_patterns}`;

  const esMetadataFields = source.metadata_fields.filter((field) =>
    ['_index', '_id'].includes(field)
  );
  if (esMetadataFields.length) {
    query += ` METADATA ${esMetadataFields.join(',')}`;
  }

  return query;
};

const filterCommands = (source: EntitySource) => {
  const commands: string[] = [];

  source.identity_fields.forEach((field) => {
    commands.push(`WHERE ${field} IS NOT NULL`);
  });

  source.filters.forEach((filter) => {
    commands.push(`WHERE ${filter}`);
  });

  return commands;
};

const statsCommand = (source: EntitySource) => {
  const aggs = [
    ...source.metadata_fields
      .filter((field) => !source.identity_fields.some((idField) => idField === field))
      .map((field) => `metadata.${field}=VALUES(${field})`),
  ];

  if (source.timestamp_field !== null) {
    aggs.push(`${entitylastSeenTimestampField}=MAX(${source.timestamp_field})`);
  }

  return `STATS ${aggs.join(', ')} BY ${source.identity_fields.join(',')}`;
};

export function getEntityInstancesQuery(source: EntitySource, limit: number): string {
  const commands = [
    sourceCommand(source),
    ...filterCommands(source),
    statsCommand(source),
  ];

  if (source.timestamp_field !== null) {
    commands.push(`SORT ${entitylastSeenTimestampField} DESC`);
  }

  commands.push(`LIMIT ${limit}`);

  return commands.join('|');
}
