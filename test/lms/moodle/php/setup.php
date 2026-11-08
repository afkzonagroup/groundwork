<?php
// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only
//
// Prepares the throwaway Moodle site for scripts/lms-moodle-check.mjs:
// one course with completion tracking and one enrolled learner. The SCORM
// activity itself is added through the web interface by the check script,
// the way an administrator uploads a package.
//
// Usage (inside the web container, as www-data):
//   php /opt/groundwork/setup.php LEARNER_PASSWORD

define('CLI_SCRIPT', true);
require('/var/www/html/config.php');
require_once($CFG->libdir . '/clilib.php');
require_once($CFG->dirroot . '/course/lib.php');
require_once($CFG->dirroot . '/user/lib.php');
require_once($CFG->libdir . '/enrollib.php');

$password = $argv[1] ?? '';
if (strlen($password) < 12) {
    cli_error('Usage: php setup.php LEARNER_PASSWORD (at least 12 characters)');
}

\core\session\manager::set_user(get_admin());
set_config('enablecompletion', 1);

$course = $DB->get_record('course', ['shortname' => 'GW-AI']);
if (!$course) {
    $course = create_course((object) [
        'fullname' => 'Groundwork AI literacy (LMS check)',
        'shortname' => 'GW-AI',
        'category' => $DB->get_field_select('course_categories', 'MIN(id)', '1=1'),
        'enablecompletion' => 1,
        'format' => 'topics',
        'numsections' => 1,
    ]);
}

$user = $DB->get_record('user', ['username' => 'learner']);
if (!$user) {
    $userid = user_create_user((object) [
        'username' => 'learner',
        'password' => $password,
        'firstname' => 'Test',
        'lastname' => 'Learner',
        'email' => 'learner@example.invalid',
        'auth' => 'manual',
        'confirmed' => 1,
        'mnethostid' => $CFG->mnet_localhost_id,
    ], true, false);
    $user = $DB->get_record('user', ['id' => $userid], '*', MUST_EXIST);
}

$manual = enrol_get_plugin('manual');
$instance = $DB->get_record('enrol', ['courseid' => $course->id, 'enrol' => 'manual'], '*', MUST_EXIST);
$studentrole = $DB->get_record('role', ['shortname' => 'student'], '*', MUST_EXIST);
$manual->enrol_user($instance, $user->id, $studentrole->id);

echo json_encode(['courseid' => (int) $course->id, 'userid' => (int) $user->id]), "\n";
