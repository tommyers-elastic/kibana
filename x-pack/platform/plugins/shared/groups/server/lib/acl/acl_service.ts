/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest, SecurityServiceStart, Logger } from '@kbn/core/server';
import type { Group } from '../../../common/types';
import type { ACLAccessLevel } from './types';

export class ACLService {
  constructor(private readonly security: SecurityServiceStart, private readonly logger: Logger) {}

  /**
   * Check if user can read a group
   * Note: Kibana-level privileges are checked by route middleware.
   * This only checks per-group ACL.
   */
  async canRead(request: KibanaRequest, group: Group): Promise<boolean> {
    try {
      const user = this.security.authc.getCurrentUser(request);
      if (!user?.username) {
        return false;
      }

      // Superuser bypass for testing/cleanup
      if (user.roles.includes('superuser')) {
        return true;
      }

      return this.hasGroupAccess(group, user.username, 'read');
    } catch (error) {
      this.logger.error(`Error checking read permission: ${error}`);
      return false;
    }
  }

  /**
   * Check if user can write to a group (add/remove members, update metadata)
   * Note: Kibana-level privileges are checked by route middleware.
   * This only checks per-group ACL.
   */
  async canWrite(request: KibanaRequest, group: Group): Promise<boolean> {
    try {
      const user = this.security.authc.getCurrentUser(request);
      if (!user?.username) {
        return false;
      }

      // Superuser bypass for testing/cleanup
      if (user.roles.includes('superuser')) {
        return true;
      }

      return this.hasGroupAccess(group, user.username, 'write');
    } catch (error) {
      this.logger.error(`Error checking write permission: ${error}`);
      return false;
    }
  }

  /**
   * Check if user can delete a group
   * Note: Kibana-level privileges are checked by route middleware.
   * This only checks per-group ACL.
   */
  async canDelete(request: KibanaRequest, group: Group): Promise<boolean> {
    try {
      const user = this.security.authc.getCurrentUser(request);
      if (!user?.username) {
        return false;
      }

      // Superuser bypass for testing/cleanup
      if (user.roles.includes('superuser')) {
        return true;
      }

      return this.hasGroupAccess(group, user.username, 'admin');
    } catch (error) {
      this.logger.error(`Error checking delete permission: ${error}`);
      return false;
    }
  }

  /**
   * Check if user can manage ACL for a group
   * Note: Kibana-level privileges are checked by route middleware.
   * This only checks per-group ACL.
   */
  async canManageACL(request: KibanaRequest, group: Group): Promise<boolean> {
    try {
      const user = this.security.authc.getCurrentUser(request);
      if (!user?.username) {
        return false;
      }

      // Superuser bypass for testing/cleanup
      if (user.roles.includes('superuser')) {
        return true;
      }

      // Owner always has ACL management rights
      if (group.owner === user.username) {
        return true;
      }

      return this.hasGroupAccess(group, user.username, 'admin');
    } catch (error) {
      this.logger.error(`Error checking ACL management permission: ${error}`);
      return false;
    }
  }

  /**
   * Check if user has specific access level to a group
   */
  private hasGroupAccess(group: Group, username: string, requiredLevel: ACLAccessLevel): boolean {
    // Owner has all access
    if (group.owner === username) {
      return true;
    }

    // Check permissions
    const userPermission = group.permissions?.find(
      (p) => p.principal === username && p.principalType === 'user'
    );

    if (!userPermission) {
      return false;
    }

    // Access level hierarchy: admin > write > read
    const levelHierarchy: Record<ACLAccessLevel, number> = {
      read: 1,
      write: 2,
      admin: 3,
    };

    return levelHierarchy[userPermission.accessLevel] >= levelHierarchy[requiredLevel];
  }

  /**
   * Get current user from request
   */
  getCurrentUser(request: KibanaRequest): string | undefined {
    return this.security.authc.getCurrentUser(request)?.username;
  }
}
