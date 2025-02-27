/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * The risk scoring algorithm uses a Riemann zeta function to sum an entity's risk inputs to a known, finite value (@see RISK_SCORING_SUM_MAX). It does so by assigning each input a weight based on its position in the list (ordered by score) of inputs. This value represents the complex variable s of Re(s) in traditional Riemann zeta function notation.
 */
export const RISK_SCORING_SUM_VALUE = 1.5;

/**
 * Represents the maximum possible risk score sum. This value is derived from RISK_SCORING_SUM_VALUE, but we store the precomputed value here to be used more conveniently in normalization.
 * @see RISK_SCORING_SUM_VALUE
 */
export const RISK_SCORING_SUM_MAX = 261.2;

/**
 * This value represents the maximum possible risk score after normalization.
 */
export const RISK_SCORING_NORMALIZATION_MAX = 100;

/**
 * This value represents the max amount of alert inputs we store, per entity, in the risk document.
 */
export const MAX_INPUTS_COUNT = 10;
