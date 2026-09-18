/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * The EUID compiler must work for a non-materialised Observability definition when given the
 * definition object directly, in all five backends, including a composite identity tuple and a
 * dotted type name used as the id prefix.
 */

import { validateQuery } from '@kbn/esql-language';
import {
  INVENTORY_DEFINITION_FIXTURES,
  k8sDeploymentInventoryDefinition,
  k8sPodInventoryDefinition,
} from '../definitions/__fixtures__/inventory_definitions';
import { entityDefinitionInputSchema, getInventoryIdentity } from '../definitions/entity_schema';
import { buildInventoryEntityDefinition } from '../definitions/inventory_definition';
import {
  getEuidDslDocumentsContainsIdFilterFromDefinition,
  getEuidDslFilterBasedOnDocumentFromDefinition,
  getEuidDslFilterBasedOnEntityRecordFromDefinition,
} from './dsl';
import {
  getEuidEsqlDocumentsContainsIdFilterFromDefinition,
  getEuidEsqlEvaluationFromDefinition,
  getEuidEsqlFilterBasedOnDocumentFromDefinition,
  getFieldEvaluationsEsqlFromDefinition,
} from './esql';
import { getEuidKqlFilterBasedOnDocumentFromDefinition } from './kql';
import {
  getEntityIdentifiersFromDefinition,
  getEuidForSearchFromDefinition,
  getEuidFromDefinition,
} from './memory';
import {
  getEuidPainlessEvaluationForSearchFromDefinition,
  getEuidPainlessEvaluationFromDefinition,
  getEuidPainlessRuntimeMappingFromDefinition,
} from './painless';
import {
  getEuidNamespaceSourceFieldsFromDefinition,
  getEuidSourceFieldsFromDefinition,
} from './identity_fields';

const deploymentDoc = {
  '@timestamp': '2026-09-01T00:00:00.000Z',
  kubernetes: { namespace: 'payments', deployment: { name: 'checkout-api' }, pod: { name: 'p1' } },
};

const podDoc = {
  kubernetes: { pod: { uid: '5f3c1e2a-0000-4000-8000-000000000001', name: 'p1' } },
};

describe('ranked authored identity', () => {
  const claim = buildInventoryEntityDefinition({
    type: 'claim',
    name: 'claim',
    inventory: {
      identity: ['halcyon.claim_id', 'claim_id'],
      identityMode: 'ranked',
      sources: [{ index: 'traces-generic.otel-default' }, { index: 'logs-generic.otel-default' }],
    },
  });

  it('derives a first-present-field ranking with an any-of documents filter', () => {
    expect(claim.identityField).toEqual({
      euidRanking: {
        branches: [{ ranking: [[{ field: 'halcyon.claim_id' }], [{ field: 'claim_id' }]] }],
      },
      documentsFilter: {
        or: [
          {
            and: [
              { field: 'halcyon.claim_id', exists: true },
              { field: 'halcyon.claim_id', neq: '' },
            ],
          },
          {
            and: [
              { field: 'claim_id', exists: true },
              { field: 'claim_id', neq: '' },
            ],
          },
        ],
      },
    });
    expect(entityDefinitionInputSchema.safeParse(claim).success).toBe(true);
  });

  it('gives the same id whichever field carries the value', () => {
    expect(getEuidFromDefinition(claim, { halcyon: { claim_id: 'CLM-1' } })).toBe('claim:CLM-1');
    expect(getEuidFromDefinition(claim, { claim_id: 'CLM-1' })).toBe('claim:CLM-1');
    expect(getEuidEsqlEvaluationFromDefinition(claim, 'entity.id')).toContain(
      'halcyon_claim_id_present_or_null'
    );
  });
});

describe('EUID compiler over Observability inventory definitions', () => {
  describe('composite identity (k8s.deployment)', () => {
    const definition = k8sDeploymentInventoryDefinition;

    it('in-memory: composes the id as <type>:<v1>/<v2>', () => {
      expect(getEuidFromDefinition(definition, deploymentDoc)).toBe(
        'k8s.deployment:payments/checkout-api'
      );
      expect(getEuidForSearchFromDefinition(definition, deploymentDoc)).toBe(
        'k8s.deployment:payments/checkout-api'
      );
      expect(getEntityIdentifiersFromDefinition(definition, deploymentDoc)).toEqual({
        'kubernetes.namespace': 'payments',
        'kubernetes.deployment.name': 'checkout-api',
      });
    });

    it('in-memory: returns undefined when any tuple member is missing', () => {
      expect(
        getEuidFromDefinition(definition, { kubernetes: { deployment: { name: 'checkout-api' } } })
      ).toBeUndefined();
      expect(
        getEntityIdentifiersFromDefinition(definition, { kubernetes: { namespace: 'payments' } })
      ).toBeUndefined();
    });

    it('in-memory: unwraps _source and flattened documents', () => {
      expect(getEuidFromDefinition(definition, { _source: deploymentDoc })).toBe(
        'k8s.deployment:payments/checkout-api'
      );
      expect(
        getEuidFromDefinition(definition, {
          'kubernetes.namespace': 'payments',
          'kubernetes.deployment.name': 'checkout-api',
        })
      ).toBe('k8s.deployment:payments/checkout-api');
    });

    it('ES|QL: evaluation, documents filter and document filter', async () => {
      const evaluation = getEuidEsqlEvaluationFromDefinition(definition, 'entity.id');
      expect(evaluation).toMatchSnapshot();
      expect(evaluation).toContain('CONCAT("k8s.deployment:", ');
      await expect(
        validateQuery(`FROM metrics-* | EVAL ${evaluation} | KEEP entity.id`)
      ).resolves.toHaveProperty('errors', []);

      const untyped = getEuidEsqlEvaluationFromDefinition(definition, 'untyped', {
        withTypeId: false,
      });
      expect(untyped).not.toContain('k8s.deployment:');

      const containsId = getEuidEsqlDocumentsContainsIdFilterFromDefinition(definition);
      expect(containsId).toMatchSnapshot();
      await expect(validateQuery(`FROM metrics-* | WHERE ${containsId}`)).resolves.toHaveProperty(
        'errors',
        []
      );

      const docFilter = getEuidEsqlFilterBasedOnDocumentFromDefinition(definition, deploymentDoc);
      expect(docFilter).toMatchSnapshot();
      await expect(validateQuery(`FROM metrics-* | WHERE ${docFilter}`)).resolves.toHaveProperty(
        'errors',
        []
      );

      expect(getFieldEvaluationsEsqlFromDefinition(definition)).toBeUndefined();
    });

    it('DSL: documents filter, document filter and record filter', () => {
      expect(getEuidDslDocumentsContainsIdFilterFromDefinition(definition)).toMatchSnapshot();
      expect(getEuidDslFilterBasedOnDocumentFromDefinition(definition, deploymentDoc)).toEqual({
        bool: {
          filter: [
            { term: { 'kubernetes.namespace': 'payments' } },
            { term: { 'kubernetes.deployment.name': 'checkout-api' } },
          ],
        },
      });
      expect(
        getEuidDslFilterBasedOnEntityRecordFromDefinition(definition, {
          entity: { id: 'k8s.deployment:payments/checkout-api' },
          kubernetes: { namespace: 'payments', deployment: { name: 'checkout-api' } },
        })
      ).toMatchSnapshot();
    });

    it('KQL: document filter', () => {
      expect(getEuidKqlFilterBasedOnDocumentFromDefinition(definition, deploymentDoc)).toBe(
        'kubernetes.namespace: "payments" AND kubernetes.deployment.name: "checkout-api"'
      );
    });

    it('Painless: evaluation and runtime mapping use the dotted type as prefix', () => {
      const evaluation = getEuidPainlessEvaluationFromDefinition(definition);
      expect(evaluation).toMatchSnapshot();
      expect(evaluation).toContain('"k8s.deployment:" + ');
      expect(getEuidPainlessEvaluationForSearchFromDefinition(definition)).toBe(evaluation);
      expect(getEuidPainlessRuntimeMappingFromDefinition(definition)).toMatchSnapshot();
    });

    it('identity source fields are the literal tuple', () => {
      expect(getEuidSourceFieldsFromDefinition(definition)).toEqual({
        requiresOneOf: ['kubernetes.namespace', 'kubernetes.deployment.name'],
        identitySourceFields: ['kubernetes.namespace', 'kubernetes.deployment.name'],
      });
      expect(getEuidNamespaceSourceFieldsFromDefinition(definition)).toEqual({
        exactMatchFields: [],
        prefixMatchFields: [],
      });
    });
  });

  describe('single-field identity (k8s.pod)', () => {
    const definition = k8sPodInventoryDefinition;

    it('in-memory: prefixes the dotted type', () => {
      expect(getEuidFromDefinition(definition, podDoc)).toBe(
        'k8s.pod:5f3c1e2a-0000-4000-8000-000000000001'
      );
      expect(getEntityIdentifiersFromDefinition(definition, podDoc)).toEqual({
        'kubernetes.pod.uid': '5f3c1e2a-0000-4000-8000-000000000001',
      });
    });

    it('ES|QL: single-field fast path', async () => {
      const evaluation = getEuidEsqlEvaluationFromDefinition(definition, 'entity.id');
      expect(evaluation).toBe('entity.id = CONCAT("k8s.pod:", TO_STRING(kubernetes.pod.uid))');
      await expect(
        validateQuery(`FROM metrics-* | EVAL ${evaluation} | KEEP entity.id`)
      ).resolves.toHaveProperty('errors', []);
      expect(getEuidEsqlDocumentsContainsIdFilterFromDefinition(definition)).toBe(
        '(TO_STRING(kubernetes.pod.uid) IS NOT NULL AND TO_STRING(kubernetes.pod.uid) != "")'
      );
    });

    it('DSL, KQL and Painless single-field fast paths', () => {
      expect(getEuidDslFilterBasedOnDocumentFromDefinition(definition, podDoc)).toEqual({
        bool: {
          filter: [{ term: { 'kubernetes.pod.uid': '5f3c1e2a-0000-4000-8000-000000000001' } }],
        },
      });
      expect(getEuidKqlFilterBasedOnDocumentFromDefinition(definition, podDoc)).toBe(
        'kubernetes.pod.uid: "5f3c1e2a-0000-4000-8000-000000000001"'
      );
      expect(getEuidPainlessEvaluationFromDefinition(definition)).toMatchSnapshot();
    });

    it('identity source fields', () => {
      expect(getEuidSourceFieldsFromDefinition(definition)).toEqual({
        requiresOneOf: ['kubernetes.pod.uid'],
        identitySourceFields: ['kubernetes.pod.uid'],
      });
    });
  });

  describe.each(INVENTORY_DEFINITION_FIXTURES.map((definition) => [definition.type, definition]))(
    '%s compiles in every backend',
    (_type, definition) => {
      it('produces valid ES|QL and non-empty output for the other backends', async () => {
        const evaluation = getEuidEsqlEvaluationFromDefinition(definition, 'entity.id');
        await expect(
          validateQuery(`FROM metrics-* | EVAL ${evaluation} | KEEP entity.id`)
        ).resolves.toHaveProperty('errors', []);
        expect(getEuidDslDocumentsContainsIdFilterFromDefinition(definition)).toBeDefined();
        expect(getEuidPainlessEvaluationFromDefinition(definition)).toContain('return');
        expect(getEuidSourceFieldsFromDefinition(definition).identitySourceFields).toEqual(
          getInventoryIdentity(definition)
        );
      });
    }
  );
});
