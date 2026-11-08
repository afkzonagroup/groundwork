// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// SCORM 1.2 package, manifest validation, ZIP and XML handling.

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { ADLCP_NS, IMSCP_NS, buildScormPackage, scormFiles, scormManifest } from '../src/scorm/manifest.js';
import { validateScormManifest, validateScormPackage } from '../src/scorm/validate.js';
import { BuildError } from '../src/site/build.js';
import { XmlError, escapeXml, isNcName, parseXml } from '../src/xml/xml.js';
import { ZipError, crc32, createZip, isSafeEntryName, readZip } from '../src/zip/zip.js';
import { bundledCourse, cleanTmp, tmpDir } from './helpers.js';

const dir = tmpDir('scorm-');
afterAll(() => {
  cleanTmp(dir);
});

const enc = new TextEncoder();

describe('SCORM 1.2 manifest', () => {
  it('is valid for every role and lists one SCO per module', async () => {
    const course = await bundledCourse();
    for (const role of course.roles) {
      const xml = scormManifest(course, role.id);
      expect(validateScormManifest(xml), role.id).toEqual([]);
      const root = parseXml(xml);
      expect(root.local).toBe('manifest');
      expect(root.ns).toBe(IMSCP_NS);
      const resources = root.children.find((c) => c.local === 'resources')?.children ?? [];
      expect(resources).toHaveLength(course.moduleList.length);
      for (const r of resources) {
        expect(r.attributesNs.get(`{${ADLCP_NS}}scormtype`)).toBe('sco');
        expect(r.attributesNs.get('{}type')).toBe('webcontent');
      }
      const org = root.children.find((c) => c.local === 'organizations')?.children[0];
      const items = org?.children.filter((c) => c.local === 'item') ?? [];
      expect(items.map((i) => i.children.find((c) => c.local === 'masteryscore')?.text)).toEqual(course.moduleList.map(() => '80'));
    }
  });

  it('has the SCORM 1.2 metadata and namespaces', async () => {
    const xml = scormManifest(await bundledCourse(), 'staff');
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<manifest /);
    expect(xml).toContain('xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"');
    expect(xml).toContain('xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"');
    expect(xml).toContain('<schema>ADL SCORM</schema>');
    expect(xml).toContain('<schemaversion>1.2</schemaversion>');
  });

  it('rejects an unknown role', async () => {
    const course = await bundledCourse();
    expect(() => scormFiles(course, { role: 'ceo' })).toThrow(BuildError);
  });

  const valid = `<?xml version="1.0"?>
<manifest identifier="M" xmlns="${IMSCP_NS}" xmlns:adlcp="${ADLCP_NS}">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="O"><organization identifier="O"><title>T</title>
    <item identifier="I" identifierref="R"><title>Item</title><adlcp:masteryscore>80</adlcp:masteryscore></item>
  </organization></organizations>
  <resources><resource identifier="R" type="webcontent" adlcp:scormtype="sco" href="a.html"><file href="a.html"/></resource></resources>
</manifest>`;

  it('accepts a minimal valid manifest', () => {
    expect(validateScormManifest(valid, new Set(['imsmanifest.xml', 'a.html']))).toEqual([]);
  });

  it.each([
    ['wrong namespace', valid.replace(`xmlns="${IMSCP_NS}"`, 'xmlns="urn:other"'), /root element/],
    ['wrong schema version', valid.replace('<schemaversion>1.2', '<schemaversion>2004 3rd Edition'), /schemaversion/],
    ['dangling identifierref', valid.replace('identifierref="R"', 'identifierref="X"'), /unknown resource X/],
    ['duplicate identifier', valid.replace('identifier="I"', 'identifier="O"'), /used more than once/],
    ['invalid identifier', valid.replace('identifier="I"', 'identifier="1 bad"'), /valid XML ID/],
    ['missing scormtype', valid.replace(' adlcp:scormtype="sco"', ''), /scormtype/],
    ['wrong resource type', valid.replace('type="webcontent"', 'type="text"'), /webcontent/],
    ['default organisation missing', valid.replace('default="O"', 'default="Z"'), /default/],
    ['mastery score out of range', valid.replace('>80<', '>180<'), /masteryscore/],
    ['item without title', valid.replace('<title>Item</title>', ''), /non-empty <title>/],
    ['launch file not listed', valid.replace('<file href="a.html"/>', '<file href="b.html"/>'), /does not list its launch file/],
    ['unsafe href', valid.replace(/a\.html/g, '../a.html'), /unsafe href/],
    ['element order', valid.replace(/<metadata>.*<\/metadata>/, '').replace('</manifest>', '<metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata></manifest>'), /in that order/],
    ['no SCO', valid.replace('adlcp:scormtype="sco"', 'adlcp:scormtype="asset"'), /no item that launches a SCO/],
    ['not XML', '<manifest', /Not well-formed/],
    ['DOCTYPE (XXE)', `<!DOCTYPE m [<!ENTITY x SYSTEM "file:///etc/passwd">]>${valid.replace('<?xml version="1.0"?>', '')}`, /Document type declarations/],
  ])('reports %s', (_name, xml, pattern) => {
    expect(validateScormManifest(xml, new Set(['a.html'])).join(' ')).toMatch(pattern);
  });

  it('reports files missing from the package', () => {
    expect(validateScormManifest(valid, new Set(['imsmanifest.xml'])).join(' ')).toMatch(/a\.html .* missing/);
  });
});

describe('SCORM package', () => {
  it('builds a valid ZIP with the manifest at the root', async () => {
    const course = await bundledCourse();
    const zip = buildScormPackage(course, { role: 'managers', organisation: 'Example Ltd' });
    expect(validateScormPackage(zip)).toEqual([]);
    const names = readZip(zip).map((e) => e.name);
    expect(names[0]).toBe('imsmanifest.xml');
    expect(names.slice(1)).toEqual(course.moduleList.map((m) => `${m.id}.html`));
    expect(buildScormPackage(course, { role: 'managers', organisation: 'Example Ltd' })).toEqual(zip);
  });

  it('is accepted by the system unzip tool when available', async () => {
    const path = join(dir, 'pkg.zip');
    writeFileSync(path, buildScormPackage(await bundledCourse()));
    const r = spawnSync('unzip', ['-t', path], { encoding: 'utf8' });
    if (r.error) return; // unzip not installed
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/No errors detected/);
  });

  it('reports packages without a manifest or with missing files', () => {
    expect(validateScormPackage(createZip([{ name: 'a.html', data: enc.encode('x') }]))).toEqual(['The package has no imsmanifest.xml at its root.']);
    expect(validateScormPackage(enc.encode('not a zip'))[0]).toMatch(/Not a ZIP/);
  });
});

describe('ZIP', () => {
  it('computes CRC-32', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('round-trips stored and deflated entries', () => {
    const entries = [
      { name: 'a.txt', data: enc.encode('x') },
      { name: 'dir/b.html', data: enc.encode('<p>hello</p>'.repeat(200)) },
      { name: 'empty', data: new Uint8Array() },
    ];
    const back = readZip(createZip(entries));
    expect(back.map((e) => [e.name, new TextDecoder().decode(e.data)])).toEqual(entries.map((e) => [e.name, new TextDecoder().decode(e.data)]));
  });

  it('refuses unsafe or duplicate names when writing', () => {
    for (const name of ['../evil', '/abs', 'a/../b', 'a\\b', 'C:x', '', 'a//b', 'sp ace']) expect(isSafeEntryName(name), name).toBe(false);
    expect(() => createZip([{ name: '../evil', data: new Uint8Array() }])).toThrow(ZipError);
    expect(() => createZip([{ name: 'a', data: new Uint8Array() }, { name: 'a', data: new Uint8Array() }])).toThrow(ZipError);
  });

  function withName(zip: Uint8Array, from: string, to: string): Uint8Array {
    const text = Buffer.from(zip).toString('latin1').split(from).join(to);
    return new Uint8Array(Buffer.from(text, 'latin1'));
  }

  it('rejects path traversal, corruption and zip bombs when reading', () => {
    const zip = createZip([{ name: 'aa/evil.txt', data: enc.encode('x'.repeat(10)) }]);
    expect(() => readZip(withName(zip, 'aa/evil.txt', '../evil.txt'))).toThrow(/Unsafe entry name/);
    const corrupt = Uint8Array.from(zip);
    const at = 31 + 'aa/evil.txt'.length;
    corrupt[at] = (corrupt[at] ?? 0) ^ 0xff;
    expect(() => readZip(corrupt)).toThrow(ZipError);
    const bomb = createZip([{ name: 'bomb', data: new Uint8Array(5_000_000) }]);
    expect(deflateRawSync(new Uint8Array(5_000_000)).length).toBeLessThan(25_000);
    expect(() => readZip(bomb)).toThrow(/compression ratio/);
    expect(() => readZip(bomb, { maxEntries: 10, maxEntryBytes: 1000, maxTotalBytes: 1000, maxRatio: 1e9 })).toThrow(/larger than/);
    expect(() => readZip(zip.subarray(0, zip.length - 5))).toThrow(ZipError);
  });
});

describe('XML', () => {
  it('escapes text and attributes', () => {
    expect(escapeXml(`<a b="c" d='e'>&`)).toBe('&lt;a b=&quot;c&quot; d=&apos;e&apos;&gt;&amp;');
  });

  it('parses elements, attributes, entities, CDATA and namespaces', () => {
    const root = parseXml('<?xml version="1.0" encoding="UTF-8"?><!-- c --><r xmlns="urn:a" xmlns:p="urn:b" p:x="1 &amp; 2"><p:c>t &#65;&#x42;<![CDATA[<raw>]]></p:c><e/></r>');
    expect(root).toMatchObject({ local: 'r', ns: 'urn:a' });
    expect(root.attributesNs.get('{urn:b}x')).toBe('1 & 2');
    expect(root.children[0]).toMatchObject({ local: 'c', ns: 'urn:b', text: 't AB<raw>' });
    expect(root.children[1]).toMatchObject({ local: 'e', ns: 'urn:a' });
  });

  it.each([
    ['<a><b></a></b>', /Mismatched/],
    ['<a>', /Unclosed element/],
    ['<a/><b/>', /More than one root/],
    ['<p:a/>', /Undeclared namespace/],
    ['<a x="1" x="2"/>', /Duplicate attribute/],
    ['<a>&unknown;</a>', /Unknown entity/],
    ['<a>&</a>', /Unescaped &/],
    ['<a>&#0;</a>', /Invalid character reference/],
    ['<!DOCTYPE a><a/>', /Document type/],
    ['<a><?php x ?></a>', /Processing instructions/],
    ['text<a/>', /Text outside/],
    ['<a>\u0001</a>', /not allowed/],
    [`${'<a>'.repeat(40)}${'</a>'.repeat(40)}`, /nested too deeply/],
  ])('rejects %s', (xml, pattern) => {
    expect(() => parseXml(xml)).toThrow(XmlError);
    expect(() => parseXml(xml)).toThrow(pattern);
  });

  it('checks NCNames', () => {
    expect(isNcName('ITEM-ai-basics')).toBe(true);
    expect(isNcName('1abc')).toBe(false);
    expect(isNcName('a b')).toBe(false);
    expect(isNcName('a:b')).toBe(false);
  });
});
