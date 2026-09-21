/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import { SourceMetadataResolver } from './source_metadata';
import { SourceNotFoundError } from './errors';

const client = (settings: Record<string, string>, fields: string[]) => {
  // Mirrors `_settings/index.mode?include_defaults=true`: an explicit mode is under `settings`,
  // a standard index reports only the default.
  const getSettings = jest.fn(async () =>
    Object.fromEntries(
      Object.entries(settings).map(([index, mode]) => [
        index,
        mode === 'standard'
          ? { settings: {}, defaults: { index: { mode } } }
          : { settings: { index: { mode } } },
      ])
    )
  );
  const fieldCaps = jest.fn(async () => ({
    indices: Object.keys(settings),
    fields: Object.fromEntries(fields.map((field) => [field, { keyword: { type: 'keyword' } }])),
  }));
  return {
    es: { indices: { getSettings }, fieldCaps } as unknown as ElasticsearchClient,
    getSettings,
    fieldCaps,
  };
};

describe('SourceMetadataResolver', () => {
  it('resolves repeated patterns once and batches overlapping indices with a union of fields', async () => {
    const c = client({}, []);
    const getSettings = jest
      .spyOn(c.es.indices, 'getSettings')
      .mockImplementation(async ({ index } = {}) => ({
        shared: { settings: { index: { mode: 'time_series' } } },
        ...(index === 'b' ? { extra: { settings: { index: { mode: 'standard' } } } } : {}),
      }));
    const fieldCaps = jest.spyOn(c.es, 'fieldCaps').mockResolvedValue({
      indices: ['extra', 'shared'],
      fields: {
        id: { keyword: { type: 'keyword', searchable: true, aggregatable: true } },
        cpu: {
          double: { type: 'double', searchable: true, aggregatable: true, indices: ['shared'] },
        },
        load: {
          double: { type: 'double', searchable: true, aggregatable: true, indices: ['extra'] },
        },
      },
    });
    const results = await new SourceMetadataResolver(0).resolveMany(c.es, [
      { index: 'a', fields: ['id', 'cpu'] },
      { index: 'a', fields: ['id', 'load'] },
      { index: 'b', fields: ['id', 'load'] },
    ]);
    expect(getSettings).toHaveBeenCalledTimes(2);
    expect(fieldCaps).toHaveBeenCalledTimes(1);
    expect(fieldCaps).toHaveBeenCalledWith(
      expect.objectContaining({ index: ['extra', 'shared'], fields: ['cpu', 'id', 'load'] })
    );
    expect(results).toEqual([
      {
        status: 'fulfilled',
        value: expect.objectContaining({
          engine: 'TS',
          mappedFields: new Set(['id', 'cpu']),
          indices: ['shared'],
        }),
      },
      {
        status: 'fulfilled',
        value: expect.objectContaining({
          engine: 'TS',
          mappedFields: new Set(['id']),
          indices: ['shared'],
        }),
      },
      {
        status: 'fulfilled',
        value: expect.objectContaining({
          engine: 'FROM',
          mappedFields: new Set(['id', 'load']),
          indices: ['extra', 'shared'],
        }),
      },
    ]);
  });

  it('isolates settings failures and falls back by pattern when batch field caps fails', async () => {
    const c = client({}, []);
    jest.spyOn(c.es.indices, 'getSettings').mockImplementation(async ({ index } = {}) => {
      if (index === 'missing') throw new Error('missing settings');
      return { [String(index)]: { settings: { index: { mode: 'standard' } } } };
    });
    const fieldCaps = jest.spyOn(c.es, 'fieldCaps').mockImplementation(async ({ index } = {}) => {
      if (Array.isArray(index) && index.includes('bad')) throw new Error('bad field caps');
      return {
        indices: ['good'],
        fields: { id: { keyword: { type: 'keyword', searchable: true, aggregatable: true } } },
      };
    });
    const results = await new SourceMetadataResolver(0).resolveMany(c.es, [
      { index: 'good', fields: ['id'] },
      { index: 'bad', fields: ['id'] },
      { index: 'bad', fields: ['id'] },
      { index: 'missing', fields: ['id'] },
    ]);
    expect(results.map(({ status }) => status)).toEqual([
      'fulfilled',
      'rejected',
      'rejected',
      'rejected',
    ]);
    expect(fieldCaps).toHaveBeenCalledTimes(3);
  });

  it('picks TS only when every concrete index is time_series', async () => {
    const resolver = new SourceMetadataResolver(60_000);
    const all = client({ '.ds-a-1': 'time_series', '.ds-a-2': 'time_series' }, ['f']);
    expect((await resolver.resolve(all.es, 'a', ['f'])).engine).toBe('TS');
    const mixed = client({ '.ds-a-1': 'time_series', 'a-old': 'standard' }, ['f']);
    expect((await resolver.resolve(mixed.es, 'b', ['f'])).engine).toBe('FROM');
    const none = client({ 'a-old': 'logsdb' }, ['f']);
    expect((await resolver.resolve(none.es, 'c', ['f'])).engine).toBe('FROM');
  });

  it('reports mapped fields and throws for a pattern matching nothing', async () => {
    const resolver = new SourceMetadataResolver(60_000);
    const c = client({ '.ds-a-1': 'time_series' }, ['kubernetes.pod.uid', 'k8s.pod.cpu.usage']);
    const metadata = await resolver.resolve(c.es, 'a', [
      'kubernetes.pod.uid',
      'k8s.pod.cpu.usage',
      'ghost',
    ]);
    expect([...metadata.mappedFields].sort()).toEqual(['k8s.pod.cpu.usage', 'kubernetes.pod.uid']);
    expect(metadata.indices).toEqual(['.ds-a-1']);
    await expect(resolver.resolve(client({}, []).es, 'missing', ['f'])).rejects.toBeInstanceOf(
      SourceNotFoundError
    );
  });

  it('caches settings independently of fields until the TTL expires, and does not cache failures', async () => {
    jest.useFakeTimers({ now: 0 });
    try {
      const resolver = new SourceMetadataResolver(1_000);
      const c = client({ '.ds-a-1': 'time_series' }, ['f']);
      await resolver.resolve(c.es, 'a', ['f']);
      await resolver.resolve(c.es, 'a', ['f']);
      expect(c.getSettings).toHaveBeenCalledTimes(1);
      await resolver.resolve(c.es, 'a', ['f', 'g']);
      expect(c.getSettings).toHaveBeenCalledTimes(1);
      expect(c.fieldCaps).toHaveBeenCalledTimes(2);
      jest.setSystemTime(2_000);
      await resolver.resolve(c.es, 'a', ['f']);
      expect(c.getSettings).toHaveBeenCalledTimes(2);

      const failing = client({}, []);
      await expect(resolver.resolve(failing.es, 'missing', ['f'])).rejects.toBeInstanceOf(
        SourceNotFoundError
      );
      await expect(resolver.resolve(failing.es, 'missing', ['f'])).rejects.toBeInstanceOf(
        SourceNotFoundError
      );
      expect(failing.getSettings).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps per-index coverage, including unmapped indices and multiple mapped types', async () => {
    const c = client({ old: 'standard', recent: 'standard', empty: 'standard' }, []);
    jest.spyOn(c.es, 'fieldCaps').mockResolvedValue({
      indices: ['old', 'recent', 'empty'],
      fields: {
        id: { keyword: { type: 'keyword', searchable: true, aggregatable: true } },
        environment: {
          keyword: { type: 'keyword', searchable: true, aggregatable: true, indices: ['recent'] },
          unmapped: {
            type: 'unmapped',
            searchable: false,
            aggregatable: false,
            indices: ['old', 'empty'],
          },
        },
        version: {
          keyword: { type: 'keyword', searchable: true, aggregatable: true, indices: ['old'] },
          long: { type: 'long', searchable: true, aggregatable: true, indices: ['recent'] },
        },
      },
    });
    const metadata = await new SourceMetadataResolver(0).resolve(c.es, '*', [
      'id',
      'environment',
      'version',
    ]);
    expect(metadata.mappedFieldsByIndex).toEqual(
      new Map([
        ['empty', new Set(['id'])],
        ['old', new Set(['id', 'version'])],
        ['recent', new Set(['id', 'environment', 'version'])],
      ])
    );
    expect(c.fieldCaps).toHaveBeenCalledWith(expect.objectContaining({ include_unmapped: true }));
  });
});
