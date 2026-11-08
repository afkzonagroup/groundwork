<?php
// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only
//
// Moodle configuration for the throwaway test site in compose.yml. Values
// come from the environment set by scripts/lms-moodle-check.mjs.

unset($CFG);
global $CFG;
$CFG = new stdClass();

$CFG->dbtype    = 'pgsql';
$CFG->dblibrary = 'native';
$CFG->dbhost    = 'db';
$CFG->dbname    = 'moodle';
$CFG->dbuser    = 'moodle';
$CFG->dbpass    = getenv('GW_LMS_DB_PASSWORD');
$CFG->prefix    = 'mdl_';
$CFG->dboptions = ['dbpersist' => 0, 'dbport' => 5432];

$CFG->wwwroot   = getenv('GW_LMS_WWWROOT');
$CFG->dataroot  = '/var/www/moodledata';
$CFG->admin     = 'admin';
$CFG->directorypermissions = 02777;

// Test site: no outgoing mail, no registration prompts, no update checks.
$CFG->noemailever = true;
$CFG->site_is_public = false;
$CFG->disableupdatenotifications = true;
$CFG->disableupdateautodeploy = true;

require_once(__DIR__ . '/lib/setup.php');
