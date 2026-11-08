<?php
// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only
//
// Prints, as JSON, what Moodle recorded for one learner in one SCORM
// activity: the package as Moodle parsed it, every tracked cmi element per
// SCO and attempt, the gradebook grade and the activity completion state.
// Read through Moodle's own APIs, so the check sees what a teacher's report
// would show.
//
// Usage (inside the web container, as www-data):
//   php /opt/groundwork/report.php COURSE_SHORTNAME USERNAME

define('CLI_SCRIPT', true);
require('/var/www/html/config.php');
require_once($CFG->libdir . '/clilib.php');
require_once($CFG->libdir . '/completionlib.php');
require_once($CFG->libdir . '/gradelib.php');
require_once($CFG->dirroot . '/mod/scorm/locallib.php');

$shortname = $argv[1] ?? '';
$username = $argv[2] ?? '';
if ($shortname === '' || $username === '') {
    cli_error('Usage: php report.php COURSE_SHORTNAME USERNAME');
}

$course = $DB->get_record('course', ['shortname' => $shortname], '*', MUST_EXIST);
$user = $DB->get_record('user', ['username' => $username], '*', MUST_EXIST);
$out = ['moodle' => ['release' => $CFG->release, 'version' => $CFG->version], 'activities' => []];

foreach (get_coursemodules_in_course('scorm', $course->id) as $cm) {
    $scorm = $DB->get_record('scorm', ['id' => $cm->instance], '*', MUST_EXIST);
    $scoes = [];
    foreach ($DB->get_records('scorm_scoes', ['scorm' => $scorm->id], 'sortorder, id') as $sco) {
        $scoes[] = [
            'id' => (int) $sco->id,
            'identifier' => $sco->identifier,
            'title' => $sco->title,
            'scormtype' => $sco->scormtype,
            'launch' => $sco->launch,
        ];
    }
    $attempts = [];
    foreach ($DB->get_records('scorm_attempt', ['scormid' => $scorm->id, 'userid' => $user->id], 'attempt') as $attempt) {
        $tracks = [];
        foreach ($scoes as $sco) {
            if ($sco['scormtype'] !== 'sco') {
                continue;
            }
            $values = [];
            $sql = 'SELECT e.element, v.value FROM {scorm_scoes_value} v
                      JOIN {scorm_element} e ON e.id = v.elementid
                     WHERE v.attemptid = ? AND v.scoid = ?
                  ORDER BY e.element';
            foreach ($DB->get_recordset_sql($sql, [$attempt->id, $sco['id']]) as $row) {
                $values[$row->element] = $row->value;
            }
            $tracks[$sco['identifier']] = $values;
        }
        $attempts[] = ['attempt' => (int) $attempt->attempt, 'tracks' => $tracks];
    }
    $grades = grade_get_grades($course->id, 'mod', 'scorm', $scorm->id, $user->id);
    $grade = $grades->items[0]->grades[$user->id] ?? null;
    $modinfo = get_fast_modinfo($course, $user->id);
    $completion = new completion_info($course);
    $state = $completion->get_data($modinfo->get_cm($cm->id), false, $user->id);
    $out['activities'][] = [
        'cmid' => (int) $cm->id,
        'name' => $scorm->name,
        'version' => $scorm->version,
        'grademethod' => (int) $scorm->grademethod,
        'maxgrade' => (float) $scorm->maxgrade,
        'scoes' => $scoes,
        'attempts' => $attempts,
        'grade' => $grade === null ? null : ['grade' => $grade->grade, 'str' => $grade->str_grade],
        'completionstate' => (int) $state->completionstate,
    ];
}

echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
