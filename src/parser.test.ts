import { buildEodMessage, parseTaskUpdates } from './parser';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const samplePrimary = `#1001: Issues | Investigate sample booking display issue

https://pm.example.com/projects/100/tasks/2001

No issue found with core booking flow; shared update with requester`;

const sampleSecondary = `Add SMS Validation Flow

https://pm.example.com/projects/100/tasks/2002

Completed testing and shared report`;

const sampleMulti = `#1001: Issues | Investigate sample booking display issue
https://pm.example.com/projects/100/tasks/2001
No issue found with core booking flow; shared update with requester
#1002: Issues | Investigate calendar error for sample scheduling case
https://pm.example.com/projects/100/tasks/2003
Waiting for details from requester`;

const sampleNoUrl = `API Bug Fix Validation

Retested and marked passed`;

const sampleTeamsTodo = `Date: 1 January 2026
To-do list shared by client via Microsoft Teams:

@Alex:
Channel: Product - Live
Follow up: Obtain calendar error details to support investigation`;

const sampleTeamsSynced = `Date: 1 January 2026 - Tasks Synced from Microsoft Teams via Cursor Automation`;

const sampleAssignDev = `Hi @Jordan I need 2 tasks to investigate
1. Investigate sample booking display issue
2. Obtain calendar error details from requester`;

const sampleAssignOther = `Change Request: Add highlighter-style calendar colors so restrictions stand out.
Priority: Medium - @Sam`;

const sampleDriveLink = `Hi @Sam
drive.google.com/drive/folders/abc123?usp=drive_link`;

const sampleHiOnly = `Hi @Jordan - Priority: Medium`;

const parsed = parseTaskUpdates([
  samplePrimary,
  sampleSecondary,
  sampleMulti,
  sampleNoUrl,
  sampleTeamsTodo,
  sampleTeamsSynced,
  sampleAssignDev,
  sampleAssignOther,
  sampleDriveLink,
  sampleHiOnly,
  'too short',
]);

assert(parsed.length === 4, `expected 4 real updates, got ${parsed.length}: ${JSON.stringify(parsed)}`);
assert(parsed[0].title.startsWith('#1001:'), `unexpected title: ${parsed[0].title}`);
assert(
  parsed[0].comment.includes('No issue found'),
  `unexpected comment: ${parsed[0].comment}`
);
assert(parsed[1].title === 'Add SMS Validation Flow', 'secondary title mismatch');
assert(parsed[1].comment === 'Completed testing and shared report', 'secondary comment mismatch');
assert(parsed[2].title.startsWith('#1001:'), 'multi block 1 title');
assert(parsed[2].comment.includes('No issue found'), 'multi block 1 comment');
assert(parsed[3].title.startsWith('#1002:'), `multi block 2 title: ${parsed[3].title}`);
assert(
  parsed[3].comment === 'Waiting for details from requester',
  `multi block 2 comment: ${parsed[3].comment}`
);

const eod = buildEodMessage(parsed);
assert(eod.startsWith('EOD:'), 'EOD header missing');
assert(eod.includes('• #1001:'), 'bullet missing');
assert(eod.includes('• #1002:'), 'second bullet missing');
assert(!eod.includes('https://'), 'URL leaked into EOD');
assert(!eod.includes('Hi @Jordan'), 'assignment leaked into EOD');
assert(!eod.includes('To-do list'), 'teams todo leaked into EOD');
assert(!eod.includes('@Sam'), 'handoff leaked into EOD');

console.log('parser.test.ts: OK');
console.log(eod);
