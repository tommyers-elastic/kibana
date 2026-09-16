/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { FF_ENABLE_DYNAMIC_DEFINITIONS } from '../../../../common';

export const DYNAMIC_DEFINITIONS_DISABLED_MESSAGE = `Dynamic entity definitions are not enabled (ui setting "${FF_ENABLE_DYNAMIC_DEFINITIONS}" is off)`;

/** The definitions API is gated by its ui setting; routes map it to 403. */
export class DynamicDefinitionsDisabledError extends Error {
  constructor() {
    super(DYNAMIC_DEFINITIONS_DISABLED_MESSAGE);
    this.name = 'DynamicDefinitionsDisabledError';
  }
}
