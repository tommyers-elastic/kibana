/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { DeepStrict } from '@kbn/zod-helpers/v4';
import type { z } from '@kbn/zod/v4';
import { k8sPodInventoryDefinition } from './__fixtures__/inventory_definitions';
import { entityDefinitionsApiBodySchema } from './definitions_api_body';

const hostExtensionDocument = {
  extends: 'host',
  inventory: { label: 'Hosts', sources: [{ index: 'metrics-system.cpu-*' }] },
};

interface Parseable {
  safeParse: (input: unknown) => z.ZodSafeParseResult<unknown>;
}

const messagesOf = (
  body: unknown,
  schema: Parseable = entityDefinitionsApiBodySchema
): string[] => {
  const result = schema.safeParse(body);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`);
};

describe('entityDefinitionsApiBodySchema', () => {
  it('parses a full definition as itself', () => {
    const result = entityDefinitionsApiBodySchema.safeParse(k8sPodInventoryDefinition);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(k8sPodInventoryDefinition);
  });

  it('parses an extension document as itself', () => {
    const result = entityDefinitionsApiBodySchema.safeParse(hostExtensionDocument);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(hostExtensionDocument);
  });

  it('rejects a body with neither type nor extends, or with both', () => {
    expect(messagesOf({ name: 'x' })).toEqual([
      expect.stringContaining('either "type" or "extends" is required'),
    ]);
    expect(messagesOf({ ...k8sPodInventoryDefinition, extends: 'host' })).toEqual([
      expect.stringContaining('"type" and "extends" cannot both be set'),
    ]);
    expect(messagesOf('host')).toEqual([expect.stringContaining('expected an object')]);
    expect(messagesOf(undefined)).toEqual([expect.stringContaining('expected an object')]);
  });

  it('reports the issues of the intended kind with their paths', () => {
    expect(messagesOf({ type: 'k8s.pod', name: '', identityField: { singleField: 'a' } })).toEqual([
      expect.stringMatching(/^name: /),
    ]);
    expect(messagesOf({ extends: 'host', inventory: { sources: [] } })).toEqual([
      expect.stringMatching(/^inventory\.sources: /),
    ]);
    expect(
      messagesOf({
        extends: 'host',
        inventory: { ...hostExtensionDocument.inventory, identity: ['a'] },
      })
    ).toEqual([expect.stringMatching(/^inventory: Unrecognized key: "identity"/)]);
  });

  it('keeps every accepted key so DeepStrict only rejects unknown ones', () => {
    const strict = DeepStrict(entityDefinitionsApiBodySchema);
    expect(strict.safeParse(k8sPodInventoryDefinition).success).toBe(true);
    expect(strict.safeParse(hostExtensionDocument).success).toBe(true);
    // The definition core is non-strict and strips unknown keys; DeepStrict turns that into a failure.
    expect(messagesOf({ ...k8sPodInventoryDefinition, indexPatterns: ['x'] }, strict)).toEqual([
      expect.stringContaining('Excess keys are not allowed'),
    ]);
    expect(
      strict.safeParse({
        ...hostExtensionDocument,
        inventory: { ...hostExtensionDocument.inventory, inventoryWindow: '15m' },
      }).success
    ).toBe(false);
  });
});
