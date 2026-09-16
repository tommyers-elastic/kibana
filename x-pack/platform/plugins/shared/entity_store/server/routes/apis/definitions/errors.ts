/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { IKibanaResponse, KibanaResponseFactory } from '@kbn/core/server';
import {
  EntityDefinitionAlreadyExistsError,
  EntityDefinitionIdentityChangedError,
  EntityDefinitionNotFoundError,
  EntityDefinitionValidationError,
  InventoryExtensionAlreadyExistsError,
  InventoryExtensionCodeRegisteredError,
} from '../../../domain/definitions';

/** Maps definition domain errors to HTTP responses; returns `undefined` for anything else so the caller rethrows. */
export function mapDefinitionError(
  error: unknown,
  res: KibanaResponseFactory
): IKibanaResponse | undefined {
  if (error instanceof EntityDefinitionValidationError) {
    return res.badRequest({ body: { message: error.message } });
  }
  if (error instanceof EntityDefinitionNotFoundError) {
    return res.notFound({ body: { message: error.message } });
  }
  if (
    error instanceof EntityDefinitionAlreadyExistsError ||
    error instanceof EntityDefinitionIdentityChangedError ||
    error instanceof InventoryExtensionAlreadyExistsError ||
    error instanceof InventoryExtensionCodeRegisteredError
  ) {
    return res.conflict({ body: { message: error.message } });
  }
  return undefined;
}
