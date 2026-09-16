/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Quotes a field path or output column name as an ES|QL identifier. Every generated reference is
 * quoted: reserved words (`last`, `count`) and numeric path segments (`system.load.1`) are parse
 * errors otherwise, and quoting is free.
 */
export const quoteIdentifier = (name: string): string => `\`${name.replace(/`/g, '``')}\``;

/** Quotes a value as an ES|QL string literal. Prefer named parameters for anything user-supplied. */
export const quoteString = (value: string): string =>
  `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const INDEX_PATTERN = /^[A-Za-z0-9_.:*?-]+$/;

/**
 * Whether an index pattern can be placed verbatim after `FROM` / `TS`. Letters, digits, `_`, `.`,
 * `-`, `*`, `?` and `:` (remote cluster prefix) only; one pattern per source.
 */
export const isSafeIndexPattern = (pattern: string): boolean =>
  pattern.length > 0 && INDEX_PATTERN.test(pattern) && !pattern.startsWith('-');

/** `LIKE` pattern matching the concrete indices of a source pattern, including data stream backing indices. */
export const backingIndexLikePatterns = (pattern: string): string[] => [
  pattern,
  `.ds-${pattern}-*`,
];
