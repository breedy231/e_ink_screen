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

async function runTests() {
    console.log('\n🧪 Running TodoistService Tests\n');

    const service = new TodoistService({ useFixtures: true });

    console.log('Fixture fallback:');
    const data = await service.getTodoistData();
    assert(data.source === 'fixture', 'useFixtures serves fixture source');
    assert(Array.isArray(data.tasks), 'tasks is an array');
    assert(data.tasks.length === 5, 'all fixture tasks present');

    console.log('\nOrdering:');
    assert(data.tasks[0].isOverdue && data.tasks[1].isOverdue, 'overdue tasks sort first');
    assert(data.tasks[0].content === 'Pay water bill', 'higher-priority overdue task first');
    const nonOverdue = data.tasks.filter(t => !t.isOverdue);
    assert(nonOverdue[0].priority <= nonOverdue[1].priority, 'today tasks sorted by priority');

    console.log('\nParsing:');
    assert(data.tasks[0].priority === 1, 'API priority 4 maps to display P1');
    const timed = data.tasks.find(t => t.content === 'Dec LTCG true-up prep');
    assert(timed && typeof timed.time === 'string' && /AM|PM/.test(timed.time), 'datetime renders as local time string');
    assert(data.tasks[0].project === 'Finance', 'project id resolves to name');

    console.log('\nCounts:');
    assert(data.counts.overdue === 2, 'overdue count');
    assert(data.counts.today === 3, 'today count');
    assert(data.counts.total === 5, 'total count');

    console.log('\nMAX_TASKS cap:');
    const manyTasks = Array.from({ length: 20 }, (_, i) => ({
        content: `Task ${i}`, project_id: 'p1', priority: 1, due: { date: '2026-09-10' }
    }));
    const capped = service.parseTasks({ tasks: manyTasks, projects: [] }, '2026-09-10');
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
