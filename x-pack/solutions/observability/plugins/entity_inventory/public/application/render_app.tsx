/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import ReactDOM from 'react-dom';
import type { CoreStart } from '@kbn/core/public';
import { KibanaRenderContextProvider } from '@kbn/react-kibana-context-render';
import { ENTITY_INVENTORY_ENABLED_SETTING } from '../../common';
import { DefinitionsApp } from './definitions_app';
import { DisabledCallout } from './disabled_callout';

interface RenderAppParams {
  coreStart: CoreStart;
  element: HTMLElement;
}

/** Mounts the definitions management app, or a callout when the inventory ui setting is off. */
export const renderApp = ({ coreStart, element }: RenderAppParams): (() => void) => {
  const isEnabled = coreStart.uiSettings.get<boolean>(ENTITY_INVENTORY_ENABLED_SETTING, false);

  ReactDOM.render(
    <KibanaRenderContextProvider {...coreStart}>
      {isEnabled ? <DefinitionsApp core={coreStart} /> : <DisabledCallout />}
    </KibanaRenderContextProvider>,
    element
  );

  return () => {
    ReactDOM.unmountComponentAtNode(element);
  };
};
