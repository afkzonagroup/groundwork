// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * SCORM 1.2 content package: imsmanifest.xml and one SCO per module.
 *
 * The manifest follows the SCORM 1.2 Content Aggregation Model (IMS
 * Content Packaging 1.1.2 with the ADL `adlcp` extensions): root
 * `manifest` in the `imscp_rootv1p1p2` namespace, `metadata` with schema
 * "ADL SCORM" and schemaversion "1.2", one `organization` with one `item`
 * per module, and one `resource` of type "webcontent" with
 * `adlcp:scormtype="sco"` per module page.
 *
 * @packageDocumentation
 */

import type { Course } from '../content/course.js';
import { BuildError, type OutputFile, type SiteOptions, renderModulePage, resolvePlaceholders } from '../site/build.js';
import { escapeXml } from '../xml/xml.js';
import { type ZipEntry, createZip } from '../zip/zip.js';

/** IMS Content Packaging namespace used by SCORM 1.2. */
export const IMSCP_NS = 'http://www.imsproject.org/xsd/imscp_rootv1p1p2';
/** ADL SCORM 1.2 extension namespace. */
export const ADLCP_NS = 'http://www.adlnet.org/xsd/adlcp_rootv1p2';

/** Options for a SCORM package. One package holds one role variant. */
export interface ScormOptions extends Pick<SiteOptions, 'organisation' | 'aiContact'> {
  /** Role variant (default: the first role in course.json). */
  readonly role?: string;
}

function roleOf(course: Course, role: string | undefined): { id: string; title: string } {
  const r = role === undefined ? course.roles[0] : course.roles.find((x) => x.id === role);
  if (!r) throw new BuildError(`Unknown role ${JSON.stringify(role)}. Roles: ${course.roles.map((x) => x.id).join(', ')}.`);
  return r;
}

/** Writes imsmanifest.xml for a course and role. */
export function scormManifest(course: Course, role: string): string {
  const r = roleOf(course, role);
  const id = (s: string): string => escapeXml(s);
  const items = course.moduleList
    .map(
      (m) => `      <item identifier="ITEM-${id(m.id)}" identifierref="RES-${id(m.id)}" isvisible="true">
        <title>${escapeXml(m.title)}</title>
        <adlcp:masteryscore>${String(course.passMark)}</adlcp:masteryscore>
      </item>`,
    )
    .join('\n');
  const resources = course.moduleList
    .map(
      (m) => `    <resource identifier="RES-${id(m.id)}" type="webcontent" adlcp:scormtype="sco" href="${id(m.id)}.html">
      <file href="${id(m.id)}.html"/>
    </resource>`,
    )
    .join('\n');
  const manifestId = `MANIFEST-${course.id}-${r.id}-${course.version.replace(/\./g, '-')}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${id(manifestId)}" version="${id(course.version)}" xmlns="${IMSCP_NS}" xmlns:adlcp="${ADLCP_NS}">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG-${id(course.id)}">
    <organization identifier="ORG-${id(course.id)}">
      <title>${escapeXml(`${course.title} (${r.title})`)}</title>
${items}
    </organization>
  </organizations>
  <resources>
${resources}
  </resources>
</manifest>
`;
}

/** The files of a SCORM package: imsmanifest.xml and one HTML page per module. */
export function scormFiles(course: Course, options: ScormOptions = {}): OutputFile[] {
  const r = roleOf(course, options.role);
  const placeholders = resolvePlaceholders(options);
  return [
    { path: 'imsmanifest.xml', content: scormManifest(course, r.id) },
    ...course.moduleList.map((m) => ({ path: `${m.id}.html`, content: renderModulePage(course, m, r.id, 'scorm', placeholders) })),
  ];
}

/**
 * Builds a SCORM 1.2 package as ZIP bytes, ready to upload to an LMS.
 *
 * @example
 * ```ts
 * const zip = buildScormPackage(course, { role: 'staff' });
 * await writeFile('groundwork-staff-scorm12.zip', zip);
 * ```
 */
export function buildScormPackage(course: Course, options: ScormOptions = {}): Uint8Array {
  const encoder = new TextEncoder();
  const entries: ZipEntry[] = scormFiles(course, options).map((f) => ({ name: f.path, data: encoder.encode(f.content) }));
  return createZip(entries);
}
