/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ALL_BUILT_IN_ENTITY_TYPES } from '../../../common/domain/definitions/built_in_entity_types';
import { getEntityDefinitionWithoutId } from '../../../common/domain/definitions/registry';
import { getEuidSourceFieldsFromDefinition } from '../../../common/domain/euid';
import { BuiltInInventoryExtensionsRegistry } from './built_in_inventory_extensions';
import { EntityDefinitionValidationError } from './errors';

const hostInventoryExtension = {
  label: 'Hosts',
  attributes: ['host.os.name', 'cloud.provider'],
  sources: [
    {
      index: 'metrics-system.cpu-*',
      metrics: [{ name: 'cpu_pct', field: 'system.cpu.total.norm.pct', agg: 'avg' as const }],
    },
  ],
};

describe('BuiltInInventoryExtensionsRegistry', () => {
  let registry: BuiltInInventoryExtensionsRegistry;

  beforeEach(() => {
    registry = new BuiltInInventoryExtensionsRegistry();
  });

  it('registers a valid extension for a built-in type', () => {
    registry.register('host', hostInventoryExtension);
    expect(registry.has('host')).toBe(true);
    expect(registry.get('host')).toEqual(hostInventoryExtension);
    expect(registry.types()).toEqual(['host']);
  });

  it.each(ALL_BUILT_IN_ENTITY_TYPES)('accepts a sources-only extension for %s', (type) => {
    registry.register(type, { sources: [{ index: 'metrics-*' }] });
    expect(registry.get(type)).toEqual({ sources: [{ index: 'metrics-*' }] });
  });

  it('starts empty', () => {
    expect(registry.has('host')).toBe(false);
    expect(registry.get('host')).toBeUndefined();
    expect(registry.types()).toEqual([]);
  });

  it('rejects a type that is not built-in', () => {
    expect(() => registry.register('k8s.pod', hostInventoryExtension)).toThrow(
      EntityDefinitionValidationError
    );
    expect(() => registry.register('k8s.pod', hostInventoryExtension)).toThrow(
      /"k8s.pod" is not a built-in entity type/
    );
    expect(registry.types()).toEqual([]);
  });

  it('rejects a second extension for the same type instead of overriding it', () => {
    registry.register('host', hostInventoryExtension);
    expect(() => registry.register('host', { sources: [{ index: 'other-*' }] })).toThrow(
      /already registered for built-in entity type "host"/
    );
    expect(registry.get('host')).toEqual(hostInventoryExtension);
  });

  it('rejects an extension that fails the schema, with the zod path and message', () => {
    expect(() =>
      registry.register('host', { ...hostInventoryExtension, identity: ['host.name'] })
    ).toThrow(/Invalid inventory extension: <root>: Unrecognized key: "identity"/);
    expect(() => registry.register('host', { label: 'Hosts' })).toThrow(
      /Invalid inventory extension: sources:/
    );
    expect(() =>
      registry.register('host', { ...hostInventoryExtension, attributes: ['COUNT(*)'] })
    ).toThrow(EntityDefinitionValidationError);
    expect(() => registry.register('host', undefined)).toThrow(EntityDefinitionValidationError);
    expect(registry.has('host')).toBe(false);
  });

  it.each(ALL_BUILT_IN_ENTITY_TYPES)(
    'rejects attributes that are identity fields of the built-in %s definition',
    (type) => {
      const { identitySourceFields } = getEuidSourceFieldsFromDefinition(
        getEntityDefinitionWithoutId(type)
      );
      expect(identitySourceFields.length).toBeGreaterThan(0);
      for (const field of identitySourceFields) {
        expect(() =>
          registry.register(type, { sources: [{ index: 'metrics-*' }], attributes: [field] })
        ).toThrow(
          new RegExp(
            `attribute "${field.replace(
              /\./g,
              '\\.'
            )}" is an identity field of the built-in definition`
          )
        );
      }
      expect(registry.has(type)).toBe(false);
    }
  );

  it('names every clashing attribute for host', () => {
    expect(() =>
      registry.register('host', {
        sources: [{ index: 'metrics-*' }],
        attributes: ['host.os.name', 'host.id', 'host.name'],
      })
    ).toThrow(/attribute "host.id" .*; attribute "host.name" /);
  });
});
