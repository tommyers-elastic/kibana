/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { RouteValidationResultFactory } from '@kbn/core-http-server';
import { k8sPodInventoryDefinition } from '../../../../common/domain/definitions/__fixtures__/inventory_definitions';
import { buildStrictRouteValidationWithZod } from '../utils/build_strict_route_validation';
import {
  DefinitionBody,
  DefinitionTypeParams,
  ListDefinitionsQuery,
  ReplaceDefinitionQuery,
} from './validator';

const hostExtensionDocument = {
  extends: 'host',
  inventory: { label: 'Hosts', sources: [{ index: 'metrics-system.cpu-*' }] },
};

interface ValidationOutcome {
  value?: unknown;
  error?: string;
}

/** Stand-in for the route framework's result factory, capturing which branch was taken. */
const resultFactory = {
  ok: (value: unknown): ValidationOutcome => ({ value }),
  badRequest: (error: string | Error): ValidationOutcome => ({
    error: error instanceof Error ? error.message : error,
  }),
} as unknown as RouteValidationResultFactory;

const validate = (
  schema: Parameters<typeof buildStrictRouteValidationWithZod>[0],
  input: unknown
): ValidationOutcome =>
  buildStrictRouteValidationWithZod(schema)(input, resultFactory) as unknown as ValidationOutcome;

describe('definitions route validators', () => {
  describe('DefinitionTypeParams', () => {
    it('accepts built-in and dotted type names and rejects malformed ones', () => {
      expect(validate(DefinitionTypeParams, { type: 'host' }).value).toEqual({ type: 'host' });
      expect(validate(DefinitionTypeParams, { type: 'k8s.pod' }).error).toBeUndefined();
      expect(validate(DefinitionTypeParams, { type: 'K8s Pod' }).error).toContain('type');
      expect(validate(DefinitionTypeParams, { type: 'host', extra: 1 }).error).toBeDefined();
    });
  });

  describe('ListDefinitionsQuery', () => {
    it('parses mode and the inventory flag', () => {
      expect(validate(ListDefinitionsQuery, {}).value).toEqual({});
      expect(validate(ListDefinitionsQuery, { mode: 'none' }).value).toEqual({ mode: 'none' });
      expect(validate(ListDefinitionsQuery, { inventory: 'true' }).value).toEqual({
        inventory: true,
      });
      expect(
        validate(ListDefinitionsQuery, { inventory: 'false', mode: 'extraction' }).value
      ).toEqual({ inventory: false, mode: 'extraction' });
      expect(validate(ListDefinitionsQuery, { inventory: 'yes' }).error).toBeDefined();
      expect(validate(ListDefinitionsQuery, { mode: 'all' }).error).toBeDefined();
    });
  });

  describe('ReplaceDefinitionQuery', () => {
    it('parses force as a boolean', () => {
      expect(validate(ReplaceDefinitionQuery, { force: 'true' }).value).toEqual({ force: true });
      expect(validate(ReplaceDefinitionQuery, {}).value).toEqual({});
      expect(validate(ReplaceDefinitionQuery, { force: '1' }).error).toBeDefined();
    });
  });

  describe('DefinitionBody', () => {
    it('accepts a full definition and an extension document', () => {
      expect(validate(DefinitionBody, k8sPodInventoryDefinition).value).toEqual(
        k8sPodInventoryDefinition
      );
      expect(validate(DefinitionBody, hostExtensionDocument).value).toEqual(hostExtensionDocument);
    });

    it('rejects a body with neither or both discriminators with a pointed message', () => {
      expect(validate(DefinitionBody, { name: 'x' }).error).toContain(
        'either "type" or "extends" is required'
      );
      expect(
        validate(DefinitionBody, { ...k8sPodInventoryDefinition, extends: 'host' }).error
      ).toContain('"type" and "extends" cannot both be set');
    });

    it('rejects unknown keys at any depth for both kinds', () => {
      expect(
        validate(DefinitionBody, { ...k8sPodInventoryDefinition, indexPatterns: ['x'] }).error
      ).toBeDefined();
      expect(
        validate(DefinitionBody, {
          ...hostExtensionDocument,
          inventory: { ...hostExtensionDocument.inventory, identity: ['host.name'] },
        }).error
      ).toContain('identity');
      expect(
        validate(DefinitionBody, { ...hostExtensionDocument, name: 'Hosts' }).error
      ).toBeDefined();
    });

    it('reports schema failures under the intended kind', () => {
      expect(
        validate(DefinitionBody, { extends: 'host', inventory: { sources: [] } }).error
      ).toContain('inventory.sources');
      expect(
        validate(DefinitionBody, { type: 'k8s.pod', name: '', identityField: { singleField: 'a' } })
          .error
      ).toContain('name');
    });
  });
});
