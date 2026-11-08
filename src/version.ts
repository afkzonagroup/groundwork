// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/** Package version, kept equal to package.json (checked by a test). */
export const VERSION = '0.1.0';

/** Product name used in the attribution notice. */
export const PRODUCT = 'Groundwork';

/**
 * The attribution notice required by LICENSE-ADDITIONAL-TERMS.md (AGPL-3.0
 * section 7(b)). Removing it from generated output is a commercial-licence
 * feature.
 */
export const ATTRIBUTION = {
  text: 'Groundwork by AFKzona Group',
  url: 'https://afkzonagroup.lt',
} as const;

/** Project home page. */
export const PROJECT_URL = 'https://github.com/afkzonagroup/groundwork';
