/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { EuiCode, EuiPageTemplate } from '@elastic/eui';
import { KbnWarningCallout } from '@kbn/ui-callout';
import { FormattedMessage } from '@kbn/i18n-react';
import { i18n } from '@kbn/i18n';
import { ENTITY_INVENTORY_ENABLED_SETTING } from '../../common';

export const DisabledCallout = () => (
  <EuiPageTemplate>
    <EuiPageTemplate.Section>
      <KbnWarningCallout
        title={i18n.translate('xpack.entityInventory.disabledCallout.title', {
          defaultMessage: 'The entity inventory is not enabled',
        })}
      >
        <p>
          <FormattedMessage
            id="xpack.entityInventory.disabledCallout.body"
            defaultMessage="Set the advanced setting {setting} to true (through the settings API; it is hidden from the advanced settings UI) and reload this page."
            values={{ setting: <EuiCode>{ENTITY_INVENTORY_ENABLED_SETTING}</EuiCode> }}
          />
        </p>
      </KbnWarningCallout>
    </EuiPageTemplate.Section>
  </EuiPageTemplate>
);
