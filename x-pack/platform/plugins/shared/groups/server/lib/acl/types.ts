/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export type ACLAccessLevel = 'read' | 'write' | 'admin';

export interface GroupACL {
  owner: string;
  permissions: Array<{
    principal: string;
    principalType: 'user' | 'role';
    accessLevel: ACLAccessLevel;
  }>;
}
