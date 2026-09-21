/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import { MAX_INVENTORY_IDENTITY_FIELDS } from '@kbn/entity-store/common';
import { DEFAULT_LIST_LIMIT, ESQL_MAX_ROWS } from '../../common';

const MAX_COLUMN_NAME_LENGTH = 512;
const MAX_IDENTITY_VALUE_LENGTH = 1024;

/** Absolute ISO 8601 instants only; the generator never uses `NOW()`. */
const isoDateSchema = z.iso.datetime({ offset: true }).max(64);

const rangeShape = {
  from: isoDateSchema,
  to: isoDateSchema,
};

const assertRange = ({ from, to }: { from: string; to: string }, ctx: z.RefinementCtx): void => {
  if (Date.parse(from) >= Date.parse(to)) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: '"to" must be after "from"' });
  }
};

export const typePathSchema = z.object({
  type: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9]+([._-][a-z0-9]+)*$/),
});

export const sortSchema = z.strictObject({
  column: z.string().min(1).max(MAX_COLUMN_NAME_LENGTH),
  direction: z.enum(['asc', 'desc']),
});

/**
 * A document-level query DSL clause applied before aggregation through the ES|QL request `filter`.
 */
export const documentFilterSchema = z
  .record(z.string().min(1).max(64), z.unknown())
  .refine((documentFilter) => Object.keys(documentFilter).length === 1, {
    message: 'documentFilter must be a single query DSL clause',
  });

export const listBodySchema = z
  .strictObject({
    ...rangeShape,
    limit: z.number().int().min(1).max(ESQL_MAX_ROWS).default(DEFAULT_LIST_LIMIT),
    sort: sortSchema.optional(),
    documentFilter: documentFilterSchema.optional(),
  })
  .superRefine(assertRange);

export const detailBodySchema = z
  .strictObject({
    ...rangeShape,
    identity: z
      .record(
        z.string().min(1).max(MAX_COLUMN_NAME_LENGTH),
        z.string().max(MAX_IDENTITY_VALUE_LENGTH)
      )
      .refine((identity) => {
        const size = Object.keys(identity).length;
        return size >= 1 && size <= MAX_INVENTORY_IDENTITY_FIELDS;
      }, `identity must have between 1 and ${MAX_INVENTORY_IDENTITY_FIELDS} fields`),
  })
  .superRefine(assertRange);

export const rangeBodySchema = z.strictObject(rangeShape).superRefine(assertRange);

export const countBodySchema = z
  .strictObject({
    ...rangeShape,
    documentFilter: documentFilterSchema.optional(),
  })
  .superRefine(assertRange);
