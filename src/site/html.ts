// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * HTML escaping and URL checks for generated pages.
 *
 * @packageDocumentation
 */

import { createHash } from 'node:crypto';

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for HTML element content and quoted attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/**
 * Serialises a value as JSON that is safe inside a `<script type="application/json">`
 * element: `<`, `>`, `&`, U+2028 and U+2029 are written as `\u` escapes, so
 * the content cannot close the element or start a comment.
 */
export function jsonForScriptElement(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * True if `href` may be used in a generated link: an absolute https URL
 * without credentials, or a relative link to a generated page
 * (`name.html`, `role/name.html`, `../index.html`, `#fragment`).
 */
export function isSafeHref(href: string): boolean {
  if (href.length === 0 || href.length > 2000) return false;
  if (/^(\.\.\/)?([a-z0-9-]+\/)?[a-z0-9-]+\.html(#[a-z0-9-]+)?$/.test(href)) return true;
  if (/^#[a-z0-9-]+$/.test(href)) return true;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.username === '' && url.password === '' && !/[\s<>"'`\\]/.test(href);
}

/** CSP source expression for an inline element body: `'sha256-<base64>'`. */
export function cspHash(body: string): string {
  return `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`;
}

/**
 * Content Security Policy for a generated page. Everything is denied except
 * the inline style and (optionally) the inline script, each allowed only by
 * its SHA-256 hash. Trusted Types are required, so no HTML string can reach
 * a DOM sink even if code tried.
 */
export function contentSecurityPolicy(style: string, script: string | undefined): string {
  return [
    "default-src 'none'",
    `script-src ${script === undefined ? "'none'" : cspHash(script)}`,
    `style-src ${cspHash(style)}`,
    "img-src 'none'",
    "font-src 'none'",
    "connect-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types 'none'",
  ].join('; ');
}
