/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { Route, Routes } from '@kbn/shared-ux-router';
import { GroupsList } from './pages/groups_list';
import { GroupDetail } from './pages/group_detail';
import { GroupForm } from './pages/group_form';

export const RoutesComponent: React.FC = () => {
  return (
    <Routes>
      <Route exact path="/" component={GroupsList} />
      <Route exact path="/create" component={GroupForm} />
      <Route exact path="/:groupId/edit" component={GroupForm} />
      <Route exact path="/:groupId" component={GroupDetail} />
    </Routes>
  );
};
