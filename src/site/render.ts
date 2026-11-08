// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Renders parsed course Markdown to HTML. Every piece of text is escaped;
 * the only markup is what this module writes itself.
 *
 * @packageDocumentation
 */

import type { Block, Inline, PlaceholderName } from '../content/markdown.js';
import type { BodyBlock } from '../content/module.js';
import { escapeHtml, isSafeHref } from './html.js';

/** Values for placeholders such as `{organisation}`. */
export type PlaceholderValues = Readonly<Record<PlaceholderName, string>>;

/** Default placeholder values when the organisation does not set its own. */
export const DEFAULT_PLACEHOLDERS: PlaceholderValues = {
  organisation: 'your organisation',
  'ai-contact': 'the person your organisation has named for AI questions',
};

/** Rendering context. */
export interface RenderContext {
  readonly placeholders: PlaceholderValues;
  /** Role variant being rendered. */
  readonly role: string;
}

/** Renders inline content. Unsafe link targets are rendered as plain text. */
export function renderInline(nodes: readonly Inline[], ctx: RenderContext): string {
  let out = '';
  for (const n of nodes) {
    switch (n.t) {
      case 'text':
        out += escapeHtml(n.v);
        break;
      case 'code':
        out += `<code>${escapeHtml(n.v)}</code>`;
        break;
      case 'strong':
        out += `<strong>${renderInline(n.c, ctx)}</strong>`;
        break;
      case 'em':
        out += `<em>${renderInline(n.c, ctx)}</em>`;
        break;
      case 'placeholder':
        out += escapeHtml(ctx.placeholders[n.name]);
        break;
      case 'link':
        out += isSafeHref(n.href) ? `<a href="${escapeHtml(n.href)}" rel="noreferrer">${renderInline(n.c, ctx)}</a>` : renderInline(n.c, ctx);
        break;
    }
  }
  return out;
}

const CALLOUT_LABELS: Readonly<Record<string, string>> = {
  note: 'Note',
  example: 'Example',
  warning: 'Important',
};

/** Renders blocks; role blocks are included only for the context's role. */
export function renderBlocks(blocks: readonly (Block | BodyBlock)[], ctx: RenderContext, headingShift = 0): string {
  let out = '';
  for (const b of blocks) {
    switch (b.t) {
      case 'heading': {
        const level = Math.min(6, b.level + headingShift);
        out += `<h${String(level)}>${renderInline(b.c, ctx)}</h${String(level)}>\n`;
        break;
      }
      case 'paragraph':
        out += `<p>${renderInline(b.c, ctx)}</p>\n`;
        break;
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        out += `<${tag}>\n${b.items.map((i) => `<li>${renderInline(i.c, ctx)}</li>\n`).join('')}</${tag}>\n`;
        break;
      }
      case 'container': {
        const label = CALLOUT_LABELS[b.name] ?? 'Note';
        out += `<div class="callout callout-${b.name === 'warning' || b.name === 'example' ? b.name : 'note'}" role="note" aria-label="${escapeHtml(label)}">\n${renderBlocks(b.blocks, ctx, headingShift)}</div>\n`;
        break;
      }
      case 'role':
        if (b.roles.includes(ctx.role)) out += `<div class="role-block">\n${renderBlocks(b.blocks, ctx, headingShift)}</div>\n`;
        break;
    }
  }
  return out;
}
