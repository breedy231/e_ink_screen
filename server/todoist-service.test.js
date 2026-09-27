#!/usr/bin/env node

/**
 * Tests for TodoistService
 * Run with: node server/todoist-service.test.js
 */

const fs = require('fs');
const path = require('path');
const TodoistService = require('./todoist-service');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✓ ${message}`);
        testsPassed++;
    } else {
        console.error(`  ✗ ${message}`);
        testsFailed++;
    }
}

function loadFixture() {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'todoist', 'tasks.json'), 'utf8'));
}

// Fixed clocks (config.TIMEZONE = America/Chicago, CDT = UTC-5 in September):
const PERSONAL_TIME = new Date('2026-09-12T18:00:00Z'); // Saturday 1pm
const WORK_TIME = new Date('2026-09-16T16:00:00Z');     // Wednesday 11am
const EVENING_TIME = new Date('2026-09-16T23:30:00Z');  // Wednesday 6:30pm

async function runTests() {
    console.log('\n🧪 Running TodoistService Tests\n');

    const service = new TodoistService({ useFixtures: true });
    const fixture = loadFixture();

    console.log('Work-hours detection:');
    assert(service.isWorkHours(WORK_TIME) === true, 'weekday 11am is work hours');
    assert(service.isWorkHours(PERSONAL_TIME) === false, 'Saturday is not work hours');
    assert(service.isWorkHours(EVENING_TIME) === false, 'weekday 6:30pm is not work hours');

    console.log('\nPersonal context (weekend):');
    const personal = service.parseTasks(fixture, fixture._todayIso, PERSONAL_TIME);
    assert(personal.context === 'personal', 'context is personal');
    assert(personal.tasks.length === 5, 'work tasks excluded, 5 personal remain');
    assert(personal.tasks.every(t => t.project !== 'Work'), 'no Work project tasks');

    console.log('\nWork context (weekday 11am):');
    const work = service.parseTasks(fixture, fixture._todayIso, WORK_TIME);
    assert(work.context === 'work', 'context is work');
    assert(work.tasks.length === 2, 'only the 2 Work tasks shown');
    assert(work.tasks.every(t => t.project === 'Work'), 'all tasks from Work project');
    assert(work.counts.total === 2, 'counts reflect the filtered set');
    assert(work.tasks[0].content === 'Reply to Sarah re: API contract', 'higher priority work task first');

    console.log('\nOrdering (personal set):');
    assert(personal.tasks[0].isOverdue && personal.tasks[1].isOverdue, 'overdue tasks sort first');
    assert(personal.tasks[0].content === 'Pay water bill', 'higher-priority overdue task first');

    console.log('\nParsing:');
    assert(personal.tasks[0].priority === 1, 'API priority 4 maps to display P1');
    const timed = personal.tasks.find(t => t.content === 'Dec LTCG true-up prep');
    assert(timed && timed.time === '10:00 AM', 'naive local due datetime formats as clock time');
    assert(personal.tasks[0].project === 'Finance', 'project id resolves to name');

    console.log('\nMAX_TASKS cap:');
    const manyTasks = Array.from({ length: 20 }, (_, i) => ({
        content: `Task ${i}`, project_id: 'p1', priority: 1, due: { date: '2026-09-10' }
    }));
    const capped = service.parseTasks({ tasks: manyTasks, projects: [{ id: 'p1', name: 'Inbox' }] }, '2026-09-10', PERSONAL_TIME);
    assert(capped.tasks.length === 12, 'tasks capped at 12');
    assert(capped.counts.total === 20, 'counts.total reports uncapped size');

    console.log('\nUnconfigured:');
    const noToken = new TodoistService({ apiToken: null, cacheDir: fs.mkdtempSync('/tmp/todoist-test-') });
    const fallback = await noToken.getTodoistData();
    assert(fallback.source === 'fixture', 'missing token falls through to fixture');

    console.log(`\n${testsPassed} passed, ${testsFailed} failed\n`);
    if (testsFailed > 0) process.exit(1);
}

runTests().catch((error) => {
    console.error(`Test run crashed: ${error.message}`);
    process.exit(1);
});
