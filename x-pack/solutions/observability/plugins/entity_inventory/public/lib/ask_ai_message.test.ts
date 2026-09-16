/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { buildAskAiMessage } from './ask_ai_message';

describe('buildAskAiMessage', () => {
  it('quotes the type and embeds the pretty-printed document in a json code block', () => {
    const message = buildAskAiMessage('k8s.pod', {
      type: 'k8s.pod',
      inventory: { identity: ['kubernetes.pod.uid'], sources: [{ index: 'metrics-*' }] },
    });

    expect(message).toBe(
      [
        'Here is the current definition of `k8s.pod`:',
        '```json',
        '{',
        '  "type": "k8s.pod",',
        '  "inventory": {',
        '    "identity": [',
        '      "kubernetes.pod.uid"',
        '    ],',
        '    "sources": [',
        '      {',
        '        "index": "metrics-*"',
        '      }',
        '    ]',
        '  }',
        '}',
        '```',
      ].join('\n')
    );
  });
});
