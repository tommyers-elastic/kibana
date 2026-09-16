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

  it('caches per pattern and field set until the TTL expires, and does not cache failures', async () => {
    jest.useFakeTimers({ now: 0 });
    try {
      const resolver = new SourceMetadataResolver(1_000);
      const c = client({ '.ds-a-1': 'time_series' }, ['f']);
      await resolver.resolve(c.es, 'a', ['f']);
      await resolver.resolve(c.es, 'a', ['f']);
      expect(c.getSettings).toHaveBeenCalledTimes(1);
      await resolver.resolve(c.es, 'a', ['f', 'g']);
      expect(c.getSettings).toHaveBeenCalledTimes(2);
      jest.setSystemTime(2_000);
      await resolver.resolve(c.es, 'a', ['f']);
      expect(c.getSettings).toHaveBeenCalledTimes(3);

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
});
