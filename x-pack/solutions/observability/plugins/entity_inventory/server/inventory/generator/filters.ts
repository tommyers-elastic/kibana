/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { Parser } from '@elastic/esql';

const FORBIDDEN = [
  { pattern: /\|/, reason: 'a pipe' },
  { pattern: /;/, reason: 'a semicolon' },
  { pattern: /\/\//, reason: 'a line comment' },
  { pattern: /\/\*/, reason: 'a block comment' },
];

/**
 * Validates a definition's `filter` (of a source or of one of its metrics, which are placed in the
 * same `WHERE`) as a single ES|QL boolean expression: no command separators or comments, and it
 * must parse as exactly the `WHERE` of `FROM x | WHERE <filter>`. Returns the problem, or
 * `undefined` when the filter is safe to place in a `WHERE`.
 */
export const validateSourceFilter = (
  filter: string,
  label = 'source filter'
): string | undefined => {
  for (const { pattern, reason } of FORBIDDEN) {
    if (pattern.test(filter)) {
      return `${label} contains ${reason}: ${filter}`;
    }
  }
  const { root, errors } = Parser.parse(`FROM x | WHERE ${filter}`);
  if (errors.length > 0) {
    return `${label} does not parse: ${errors[0].message}`;
  }
  if (root.commands.length !== 2 || root.commands[1].name !== 'where') {
    return `${label} must be a single boolean expression: ${filter}`;
  }
  return undefined;
};
