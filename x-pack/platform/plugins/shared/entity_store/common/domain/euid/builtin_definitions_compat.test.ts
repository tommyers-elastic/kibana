/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Backward-compatibility snapshots for the four built-in Security definitions.
 *
 * Every EUID backend (ES|QL, DSL, KQL, Painless, in-memory) is snapshotted for every built-in
 * type against a fixed set of sample documents. These snapshots must not change when the
 * definition schema is refactored: the Security Solution relies on byte-identical output for
 * alert enrichment, risk scoring and entity resolution.
 */

import { ALL_ENTITY_TYPES } from '../definitions/entity_schema';
import type { EntityType } from '../definitions/entity_schema';
import {
  getEuidDslDocumentsContainsIdFilter,
  getEuidDslFilterBasedOnDocument,
  getEuidDslFilterBasedOnEntityRecord,
} from './dsl';
import {
  getEuidEsqlDocumentsContainsIdFilter,
  getEuidEsqlEvaluation,
  getEuidEsqlFilterBasedOnDocument,
  getFieldEvaluationsEsql,
} from './esql';
import { getEuidKqlFilterBasedOnDocument } from './kql';
import {
  getEntityIdentifiersFromDocument,
  getEuidFromObject,
  getEuidFromObjectForSearch,
} from './memory';
import {
  getEuidPainlessEvaluation,
  getEuidPainlessEvaluationForSearch,
  getEuidPainlessRuntimeMapping,
} from './painless';
import { getEuidNamespaceSourceFields, getEuidSourceFields } from './identity_fields';

interface SampleDocument {
  label: string;
  doc: Record<string, unknown>;
}

const SAMPLE_DOCUMENTS: Record<EntityType, SampleDocument[]> = {
  host: [
    { label: 'host.id and host.name', doc: { host: { id: 'host-id-1', name: 'server-1' } } },
    { label: 'host.name only', doc: { host: { name: 'server-1' } } },
    { label: 'host.hostname only', doc: { host: { hostname: 'server-1.example.com' } } },
    { label: 'no identity', doc: { message: 'nothing to see here' } },
  ],
  user: [
    {
      label: 'local user (user.name + host.id)',
      doc: {
        user: { name: 'alice' },
        host: { id: 'host-id-1', name: 'server-1' },
        event: { module: 'system' },
      },
    },
    {
      label: 'okta user by email',
      doc: {
        user: { email: 'alice@example.com', name: 'alice' },
        event: { module: 'okta', kind: 'asset' },
      },
    },
    {
      label: 'asset discovery aws user by id',
      doc: {
        user: { id: 'aws-user-1' },
        cloud: { provider: 'aws' },
        event: { module: 'asset_discovery', kind: 'asset' },
      },
    },
    {
      label: 'dataset chunk source (entra)',
      doc: {
        user: { name: 'bob', domain: 'example.com' },
        data_stream: { dataset: 'entityanalytics_entra_id.user' },
        event: { kind: 'asset' },
      },
    },
    {
      label: 'fails post agg gate (no asset kind, not local)',
      doc: { user: { name: 'bob' }, event: { module: 'system', kind: 'event' } },
    },
  ],
  service: [
    { label: 'service.name', doc: { service: { name: 'checkout-api' } } },
    { label: 'no identity', doc: { message: 'nothing to see here' } },
  ],
  generic: [
    { label: 'entity.id', doc: { entity: { id: 'arn:aws:iam::123456789012:user/alice' } } },
    { label: 'no identity', doc: { message: 'nothing to see here' } },
  ],
};

const ENTITY_RECORDS: Record<EntityType, Record<string, unknown>> = {
  host: { host: { id: ['host-id-1'], name: ['server-1'] }, entity: { id: 'host:host-id-1' } },
  user: {
    user: { email: ['alice@example.com'], name: 'alice' },
    entity: { id: 'user:alice@example.com@okta', namespace: 'okta' },
  },
  service: { service: { name: ['checkout-api'] }, entity: { id: 'service:checkout-api' } },
  generic: { entity: { id: 'arn:aws:iam::123456789012:user/alice' } },
};

describe('built-in definitions EUID compiler output (backward compatibility)', () => {
  describe.each(ALL_ENTITY_TYPES)('%s', (type) => {
    it('ES|QL: typed entity id evaluation', () => {
      expect(getEuidEsqlEvaluation(type, 'entity.id')).toMatchSnapshot();
    });

    it('ES|QL: untyped id evaluation (extraction shape)', () => {
      expect(
        getEuidEsqlEvaluation(type, 'recent.entity.EngineMetadata.UntypedId', {
          withTypeId: false,
        })
      ).toMatchSnapshot();
    });

    it('ES|QL: documents contain id filter', () => {
      expect(getEuidEsqlDocumentsContainsIdFilter(type)).toMatchSnapshot();
    });

    it('ES|QL: shared field evaluations', () => {
      expect(getFieldEvaluationsEsql(type)).toMatchSnapshot();
    });

    it('DSL: documents contain id filter', () => {
      expect(getEuidDslDocumentsContainsIdFilter(type)).toMatchSnapshot();
    });

    it('DSL: filter based on entity record', () => {
      expect(getEuidDslFilterBasedOnEntityRecord(type, ENTITY_RECORDS[type])).toMatchSnapshot();
    });

    it('Painless: evaluation, search evaluation and runtime mapping', () => {
      expect(getEuidPainlessEvaluation(type)).toMatchSnapshot();
      expect(getEuidPainlessEvaluationForSearch(type)).toMatchSnapshot();
      expect(getEuidPainlessRuntimeMapping(type)).toMatchSnapshot();
    });

    it('identity source fields', () => {
      expect(getEuidSourceFields(type)).toMatchSnapshot();
      expect(getEuidNamespaceSourceFields(type)).toMatchSnapshot();
    });

    describe.each(SAMPLE_DOCUMENTS[type])('document: $label', ({ doc }) => {
      it('in-memory: euid, search euid and identifiers', () => {
        expect(getEuidFromObject(type, doc)).toMatchSnapshot();
        expect(getEuidFromObjectForSearch(type, doc)).toMatchSnapshot();
        expect(getEntityIdentifiersFromDocument(type, doc)).toMatchSnapshot();
      });

      it('ES|QL: filter based on document', () => {
        expect(getEuidEsqlFilterBasedOnDocument(type, doc)).toMatchSnapshot();
      });

      it('DSL: filter based on document', () => {
        expect(getEuidDslFilterBasedOnDocument(type, doc)).toMatchSnapshot();
        expect(
          getEuidDslFilterBasedOnDocument(type, doc, { excludeHigherRankedFields: false })
        ).toMatchSnapshot();
      });

      it('KQL: filter based on document', () => {
        expect(getEuidKqlFilterBasedOnDocument(type, doc)).toMatchSnapshot();
      });
    });
  });
});
