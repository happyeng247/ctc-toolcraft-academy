'use strict';

// Validate the stable lesson/visual contract and the two reading levels.
// The catalogue is deliberate: saved progress and animated step mappings use
// these IDs and section positions. No Git history or network is needed to run it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.resolve(__dirname, '../src');
const documents = ['foundations.json', 'manufacturing.json', 'ai-playbook.json']
  .map(filename => ({ filename, data: JSON.parse(fs.readFileSync(path.join(SRC, filename), 'utf8')) }));
const lessons = documents.flatMap(({ data }) => data.modules);
const catalogue = [
  ['cutting-system', 4, 2],
  ['tool-anatomy', 4, 0],
  ['chip-mechanics', 4, 1],
  ['workpiece-materials', 4, 2],
  ['tool-materials', 4, 1],
  ['milling-operations', 4, 0],
  ['holemaking', 4, 1],
  ['pcb-tools', 4, 2],
  ['failure-diagnosis', 4, 2],
  ['mfg-requirements', 5, 0],
  ['mfg-carbide', 5, 0],
  ['mfg-pcd', 5, 0],
  ['mfg-rollomatic', 5, 0],
  ['mfg-quality', 5, 0],
  ['ai-design-system', 5, 2],
  ['knowledge-and-collaboration', 5, 2],
  ['portfolio-and-experiments', 5, 1],
];
const requiredText = (value, label) => assert.ok(typeof value === 'string' && value.trim(), `${label} must contain text`);
const wordCount = value => value.trim().split(/\s+/u).length;

function checkTextArray(value, label, { optional = false } = {}) {
  if (optional && value === undefined) return;
  assert.ok(Array.isArray(value), `${label} must be an array`);
  value.forEach((item, index) => requiredText(item, `${label}[${index}]`));
}

test('the 17 lesson IDs and section positions remain compatible with saved progress and visuals', () => {
  assert.deepEqual(lessons.map(lesson => lesson.id), catalogue.map(([id]) => id));
  assert.equal(new Set(lessons.map(lesson => lesson.id)).size, 17);
  for (const [index, lesson] of lessons.entries()) {
    assert.equal(lesson.sections.length, catalogue[index][1], `${lesson.id} changed its visual step count`);
    assert.ok(['Fundamentals', 'Applications', 'Manufacturing', 'AI & Leadership'].includes(lesson.group));
    assert.ok(Number.isFinite(lesson.minutes) && lesson.minutes > 0, `${lesson.id} needs a study estimate`);
  }
});

test('every lesson provides a beginner explanation, an example and optional engineering detail', () => {
  for (const lesson of lessons) {
    for (const key of ['title', 'subtitle', 'analogy', 'takeaway']) requiredText(lesson[key], `${lesson.id}.${key}`);
    assert.ok(lesson.objectives.length > 0, `${lesson.id} needs learning objectives`);
    checkTextArray(lesson.objectives, `${lesson.id}.objectives`);
    for (const [index, section] of lesson.sections.entries()) {
      const label = `${lesson.id}.sections[${index}]`;
      for (const key of ['heading', 'body', 'example', 'takeaway']) requiredText(section[key], `${label}.${key}`);
      assert.ok(wordCount(section.body) <= 90, `${label} puts more than 90 words in its first explanation; use the optional detail for depth`);
      checkTextArray(section.bullets, `${label}.bullets`, { optional: true });
      assert.ok(section.technical && typeof section.technical === 'object', `${label} needs its retained engineering detail`);
      requiredText(section.technical.body, `${label}.technical.body`);
      checkTextArray(section.technical.bullets, `${label}.technical.bullets`, { optional: true });
    }
  }
});

test('rewritten knowledge checks preserve a valid unambiguous answer slot and an explanation', () => {
  for (const [index, lesson] of lessons.entries()) {
    requiredText(lesson.exercise.prompt, `${lesson.id}.exercise.prompt`);
    requiredText(lesson.exercise.answer, `${lesson.id}.exercise.answer`);
    requiredText(lesson.quiz.question, `${lesson.id}.quiz.question`);
    requiredText(lesson.quiz.explanation, `${lesson.id}.quiz.explanation`);
    checkTextArray(lesson.quiz.options, `${lesson.id}.quiz.options`);
    assert.ok(lesson.quiz.options.length >= 2, `${lesson.id} needs at least two choices`);
    assert.equal(new Set(lesson.quiz.options.map(option => option.trim().toLowerCase())).size, lesson.quiz.options.length,
      `${lesson.id} has duplicate quiz choices`);
    assert.ok(Number.isInteger(lesson.quiz.correct) && lesson.quiz.correct >= 0 && lesson.quiz.correct < lesson.quiz.options.length);
    assert.equal(lesson.quiz.correct, catalogue[index][2], `${lesson.id} changed the existing correct answer slot`);
  }
});

test('all public reference links are well-formed HTTPS URLs without embedded credentials', () => {
  const sources = documents.flatMap(({ data }) => data.sources || []).concat(lessons.flatMap(lesson => lesson.sources || []));
  assert.ok(sources.length > 0, 'The course needs references');
  for (const source of sources) {
    requiredText(source.title, 'reference.title');
    const url = new URL(source.url);
    assert.equal(url.protocol, 'https:', source.title);
    assert.ok(url.hostname && !url.username && !url.password, source.title);
    for (const key of url.searchParams.keys()) assert.ok(!/^(api[_-]?key|token|secret)$/i.test(key), `${source.title} must not publish a credential`);
  }
});

test('public course data does not introduce private customer names or provider credentials', () => {
  for (const { filename, data } of documents) {
    const serialized = JSON.stringify(data);
    // This public academy deliberately uses generic jobs, not customer claims.
    assert.ok(!/\b(?:Apple|Tata)\b/u.test(serialized), `${filename} includes a customer name`);
    assert.ok(!/\bsk_[A-Za-z0-9]{20,}\b/u.test(serialized), `${filename} includes a provider key`);
  }
});
