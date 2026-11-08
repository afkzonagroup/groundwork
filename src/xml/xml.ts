// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * XML escaping, and a small non-validating parser used to check SCORM
 * manifests. The parser accepts well-formed XML 1.0 with namespaces and
 * refuses document type declarations and processing instructions other than
 * the XML declaration, so entity expansion attacks are impossible.
 *
 * @packageDocumentation
 */

/** Escapes text for XML element content and double-quoted attributes. */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&apos;'));
}

/** True if `value` contains only characters allowed in XML 1.0. */
export function isXmlText(value: string): boolean {
  // eslint-disable-next-line no-control-regex -- matching disallowed control characters is the purpose
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uFFFE\uFFFF]/.test(value) && !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(value);
}

/** True if `value` is an XML NCName in the ASCII subset (letters, digits, `_`, `-`, `.`). */
export function isNcName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.-]{0,254}$/.test(value);
}

/** A parsed element. */
export interface XmlElement {
  /** Qualified name as written, e.g. `adlcp:masteryscore`. */
  readonly name: string;
  /** Local name, e.g. `masteryscore`. */
  readonly local: string;
  /** Namespace URI, or '' if none. */
  readonly ns: string;
  /** Attributes by qualified name as written. */
  readonly attributes: ReadonlyMap<string, string>;
  /** Attributes by `{namespace}local` (unprefixed attributes have no namespace). */
  readonly attributesNs: ReadonlyMap<string, string>;
  readonly children: readonly XmlElement[];
  /** Concatenated text content directly inside this element. */
  readonly text: string;
}

/** Error for malformed XML; the message is safe to show. */
export class XmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XmlError';
  }
}

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const NAME = /^[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?$/;

/** Limits for {@link parseXml}. */
export const XML_LIMITS = { maxBytes: 1024 * 1024, maxDepth: 32, maxElements: 20000, maxAttributes: 50 } as const;

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-z]+);|&/g, (match, ref: string | undefined) => {
    if (ref === undefined) throw new XmlError('Unescaped & in XML.');
    if (ref === 'lt') return '<';
    if (ref === 'gt') return '>';
    if (ref === 'amp') return '&';
    if (ref === 'quot') return '"';
    if (ref === 'apos') return "'";
    if (ref.startsWith('#')) {
      const code = ref.startsWith('#x') ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new XmlError(`Invalid character reference ${match}.`);
      const ch = String.fromCodePoint(code);
      if (!isXmlText(ch)) throw new XmlError(`Invalid character reference ${match}.`);
      return ch;
    }
    throw new XmlError(`Unknown entity ${match}.`);
  });
}

interface Building {
  name: string;
  rawAttributes: [string, string][];
  scope: Map<string, string>;
  children: XmlElement[];
  text: string;
}

function split(name: string): [string, string] {
  const i = name.indexOf(':');
  return i < 0 ? ['', name] : [name.slice(0, i), name.slice(i + 1)];
}

/** Parses an XML document and returns its root element. */
export function parseXml(source: string): XmlElement {
  if (source.length > XML_LIMITS.maxBytes) throw new XmlError('XML document too large.');
  if (!isXmlText(source)) throw new XmlError('XML contains characters that are not allowed.');
  let i = source.startsWith('\uFEFF') ? 1 : 0;
  const decl = /^<\?xml\s+version\s*=\s*(["'])1\.[0-9]\1(?:\s+encoding\s*=\s*(["'])[A-Za-z0-9._-]+\2)?(?:\s+standalone\s*=\s*(["'])(?:yes|no)\3)?\s*\?>/.exec(source.slice(i));
  if (decl) i += decl[0].length;
  const stack: Building[] = [];
  let root: XmlElement | undefined;
  let elements = 0;
  const rootScope = new Map<string, string>([
    ['xml', XML_NS],
    ['', ''],
  ]);
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    const textEnd = lt < 0 ? source.length : lt;
    const text = source.slice(i, textEnd);
    if (text.length > 0) {
      const top = stack[stack.length - 1];
      if (top) top.text += decodeEntities(text);
      else if (text.trim() !== '') throw new XmlError('Text outside the root element.');
      if (text.includes(']]>')) throw new XmlError('"]]>" is not allowed in text.');
    }
    if (lt < 0) break;
    i = lt;
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4);
      if (end < 0) throw new XmlError('Unclosed comment.');
      i = end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', i)) {
      const end = source.indexOf(']]>', i + 9);
      const top = stack[stack.length - 1];
      if (end < 0 || !top) throw new XmlError('Malformed CDATA section.');
      top.text += source.slice(i + 9, end);
      i = end + 3;
      continue;
    }
    if (source.startsWith('<!', i)) throw new XmlError('Document type declarations are not allowed.');
    if (source.startsWith('<?', i)) throw new XmlError('Processing instructions are not allowed.');
    if (source.startsWith('</', i)) {
      const end = source.indexOf('>', i);
      if (end < 0) throw new XmlError('Unclosed end tag.');
      const name = source.slice(i + 2, end).trim();
      const top = stack.pop();
      if (!top || top.name !== name) throw new XmlError(`Mismatched end tag </${name}>.`);
      const element = finish(top);
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(element);
      else root = element;
      i = end + 1;
      continue;
    }
    // Start tag.
    const m = /^<([^\s/>]+)/.exec(source.slice(i, i + 300));
    if (!m) throw new XmlError('Malformed tag.');
    const name = m[1] ?? '';
    if (!NAME.test(name)) throw new XmlError(`Invalid element name ${JSON.stringify(name.slice(0, 50))}.`);
    if (root !== undefined) throw new XmlError('More than one root element.');
    if (stack.length >= XML_LIMITS.maxDepth) throw new XmlError('XML nested too deeply.');
    if (++elements > XML_LIMITS.maxElements) throw new XmlError('Too many XML elements.');
    i += m[0].length;
    const rawAttributes: [string, string][] = [];
    let selfClosing = false;
    for (;;) {
      const ws = /^\s*/.exec(source.slice(i, i + 1000));
      i += ws ? ws[0].length : 0;
      if (source.startsWith('/>', i)) {
        selfClosing = true;
        i += 2;
        break;
      }
      if (source.startsWith('>', i)) {
        i += 1;
        break;
      }
      const a = /^([^\s=/>]+)\s*=\s*("([^"<]*)"|'([^'<]*)')/.exec(source.slice(i, i + 5000));
      if (!a) throw new XmlError(`Malformed attribute in <${name}>.`);
      const attrName = a[1] ?? '';
      if (!NAME.test(attrName)) throw new XmlError(`Invalid attribute name in <${name}>.`);
      if (rawAttributes.some(([n]) => n === attrName)) throw new XmlError(`Duplicate attribute ${attrName} in <${name}>.`);
      if (rawAttributes.length >= XML_LIMITS.maxAttributes) throw new XmlError(`Too many attributes in <${name}>.`);
      rawAttributes.push([attrName, decodeEntities(a[3] ?? a[4] ?? '')]);
      i += a[0].length;
    }
    const parentScope = stack[stack.length - 1]?.scope ?? rootScope;
    const scope = new Map(parentScope);
    for (const [attrName, value] of rawAttributes) {
      if (attrName === 'xmlns') scope.set('', value);
      else if (attrName.startsWith('xmlns:')) scope.set(attrName.slice(6), value);
    }
    const building: Building = { name, rawAttributes, scope, children: [], text: '' };
    if (selfClosing) {
      const element = finish(building);
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(element);
      else root = element;
    } else stack.push(building);
  }
  if (stack.length > 0) throw new XmlError(`Unclosed element <${stack[stack.length - 1]?.name ?? ''}>.`);
  if (!root) throw new XmlError('No root element.');
  return root;
}

function finish(b: Building): XmlElement {
  const [prefix, local] = split(b.name);
  const ns = b.scope.get(prefix);
  if (ns === undefined) throw new XmlError(`Undeclared namespace prefix "${prefix}".`);
  const attributes = new Map<string, string>();
  const attributesNs = new Map<string, string>();
  for (const [name, value] of b.rawAttributes) {
    attributes.set(name, value);
    if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
    const [p, l] = split(name);
    if (p === '') attributesNs.set(`{}${l}`, value);
    else {
      const uri = b.scope.get(p);
      if (uri === undefined) throw new XmlError(`Undeclared namespace prefix "${p}".`);
      attributesNs.set(`{${uri}}${l}`, value);
    }
  }
  return { name: b.name, local, ns, attributes, attributesNs, children: b.children, text: b.text };
}
