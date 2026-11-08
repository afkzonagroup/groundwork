// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Structural checks for SCORM 1.2 manifests and packages. This is not an
 * XML Schema validation; it checks the rules of the SCORM 1.2 Content
 * Aggregation Model that LMS imports depend on.
 *
 * @packageDocumentation
 */

import { type XmlElement, XmlError, isNcName, parseXml } from '../xml/xml.js';
import { ZipError, readZip } from '../zip/zip.js';
import { ADLCP_NS, IMSCP_NS } from './manifest.js';

const SCORMTYPE = `{${ADLCP_NS}}scormtype`;

function children(el: XmlElement, local: string, ns = IMSCP_NS): XmlElement[] {
  return el.children.filter((c) => c.local === local && c.ns === ns);
}

function attr(el: XmlElement, name: string): string | undefined {
  return el.attributesNs.get(`{}${name}`);
}

function isSafeHref(href: string): boolean {
  return /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(href) && !href.split('/').some((s) => s === '..' || s === '.');
}

/**
 * Validates an imsmanifest.xml. Returns a list of problems; empty means the
 * structure is valid. With `files`, also checks that every referenced file
 * is in the package.
 */
export function validateScormManifest(xml: string, files?: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  let root: XmlElement;
  try {
    root = parseXml(xml);
  } catch (error) {
    return [error instanceof XmlError ? `Not well-formed XML: ${error.message}` : 'Not well-formed XML.'];
  }
  if (root.local !== 'manifest' || root.ns !== IMSCP_NS) return [`The root element must be <manifest> in namespace ${IMSCP_NS}.`];

  const identifiers = new Set<string>();
  const registerId = (el: XmlElement, what: string): string | undefined => {
    const id = attr(el, 'identifier');
    if (id === undefined || !isNcName(id)) {
      problems.push(`${what} needs an identifier attribute that is a valid XML ID.`);
      return undefined;
    }
    if (identifiers.has(id)) problems.push(`Identifier ${id} is used more than once.`);
    identifiers.add(id);
    return id;
  };
  registerId(root, '<manifest>');

  const elementOrder = root.children.filter((c) => c.ns === IMSCP_NS).map((c) => c.local);
  const expected = ['metadata', 'organizations', 'resources'];
  if (elementOrder.join(',') !== expected.join(',')) problems.push('<manifest> must contain <metadata>, <organizations> and <resources>, in that order (no sub-manifests).');

  const metadata = children(root, 'metadata')[0];
  if (metadata) {
    const schema = children(metadata, 'schema')[0]?.text.trim();
    const version = children(metadata, 'schemaversion')[0]?.text.trim();
    if (schema !== 'ADL SCORM') problems.push('<metadata><schema> must be "ADL SCORM".');
    if (version !== '1.2') problems.push('<metadata><schemaversion> must be "1.2".');
  }

  const resources = new Map<string, XmlElement>();
  const resourcesEl = children(root, 'resources')[0];
  for (const res of resourcesEl ? children(resourcesEl, 'resource') : []) {
    const id = registerId(res, '<resource>');
    if (id !== undefined) resources.set(id, res);
    if (attr(res, 'type') !== 'webcontent') problems.push(`Resource ${id ?? '?'} must have type="webcontent".`);
    const scormtype = res.attributesNs.get(SCORMTYPE);
    if (scormtype !== 'sco' && scormtype !== 'asset') problems.push(`Resource ${id ?? '?'} needs adlcp:scormtype "sco" or "asset".`);
    const href = attr(res, 'href');
    if (scormtype === 'sco' && href === undefined) problems.push(`SCO resource ${id ?? '?'} needs an href.`);
    if (href !== undefined && !isSafeHref(href)) problems.push(`Resource ${id ?? '?'} has an unsafe href.`);
    const fileHrefs = children(res, 'file').map((f) => attr(f, 'href'));
    if (fileHrefs.some((h) => h === undefined || !isSafeHref(h))) problems.push(`Resource ${id ?? '?'} has a <file> without a safe href.`);
    if (href !== undefined && !fileHrefs.includes(href)) problems.push(`Resource ${id ?? '?'} does not list its launch file ${href} as a <file>.`);
    if (files) for (const h of fileHrefs) if (h !== undefined && !files.has(h)) problems.push(`File ${h} of resource ${id ?? '?'} is missing from the package.`);
  }
  if (resources.size === 0) problems.push('<resources> must contain at least one <resource>.');
  for (const res of resources.values()) {
    for (const dep of children(res, 'dependency')) {
      const ref = attr(dep, 'identifierref');
      if (ref === undefined || !resources.has(ref)) problems.push(`A <dependency> refers to an unknown resource ${ref ?? '(none)'}.`);
    }
  }

  const organizationsEl = children(root, 'organizations')[0];
  const organizations = organizationsEl ? children(organizationsEl, 'organization') : [];
  if (organizations.length === 0) problems.push('<organizations> must contain at least one <organization>.');
  const orgIds: string[] = [];
  let scoCount = 0;
  const checkItem = (item: XmlElement): void => {
    const id = registerId(item, '<item>');
    const first = item.children[0];
    if (!first || first.local !== 'title' || first.ns !== IMSCP_NS || first.text.trim() === '') problems.push(`Item ${id ?? '?'} must start with a non-empty <title>.`);
    const visible = attr(item, 'isvisible');
    if (visible !== undefined && visible !== 'true' && visible !== 'false') problems.push(`Item ${id ?? '?'} has an invalid isvisible value.`);
    const ref = attr(item, 'identifierref');
    const sub = children(item, 'item');
    if (ref !== undefined) {
      if (sub.length > 0) problems.push(`Item ${id ?? '?'} has both identifierref and child items.`);
      const res = resources.get(ref);
      if (!res) problems.push(`Item ${id ?? '?'} refers to an unknown resource ${ref}.`);
      else if (res.attributesNs.get(SCORMTYPE) === 'sco') scoCount += 1;
    } else if (sub.length === 0) problems.push(`Item ${id ?? '?'} has neither identifierref nor child items.`);
    for (const m of children(item, 'masteryscore', ADLCP_NS)) {
      const v = m.text.trim();
      if (!/^[0-9]{1,3}(\.[0-9]+)?$/.test(v) || Number(v) > 100) problems.push(`Item ${id ?? '?'} has an adlcp:masteryscore outside 0 to 100.`);
    }
    for (const s of sub) checkItem(s);
  };
  for (const org of organizations) {
    const id = registerId(org, '<organization>');
    if (id !== undefined) orgIds.push(id);
    const title = children(org, 'title')[0];
    if (!title || title.text.trim() === '') problems.push(`Organization ${id ?? '?'} needs a <title>.`);
    const items = children(org, 'item');
    if (items.length === 0) problems.push(`Organization ${id ?? '?'} has no items.`);
    for (const item of items) checkItem(item);
  }
  const def = organizationsEl ? attr(organizationsEl, 'default') : undefined;
  if (def === undefined || !orgIds.includes(def)) problems.push('<organizations default="..."> must name one of the organizations.');
  if (scoCount === 0) problems.push('The package has no item that launches a SCO.');
  return problems;
}

/**
 * Validates a SCORM 1.2 package (ZIP bytes): safe entry names, an
 * imsmanifest.xml at the root, a valid manifest, and every referenced file
 * present.
 */
export function validateScormPackage(zip: Uint8Array): string[] {
  let entries;
  try {
    entries = readZip(zip);
  } catch (error) {
    return [error instanceof ZipError ? error.message : 'Cannot read the archive.'];
  }
  const manifest = entries.find((e) => e.name === 'imsmanifest.xml');
  if (!manifest) return ['The package has no imsmanifest.xml at its root.'];
  let xml: string;
  try {
    xml = new TextDecoder('utf-8', { fatal: true }).decode(manifest.data);
  } catch {
    return ['imsmanifest.xml is not valid UTF-8.'];
  }
  return validateScormManifest(xml, new Set(entries.map((e) => e.name)));
}
