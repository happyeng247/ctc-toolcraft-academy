/*
 * Content and action bridge for the voice UI. Load after app.js as a classic script.
 * getContext() is JSON-serializable; getSections() may contain DOM elements.
 * No saved note or brief value is read into narration or tutor context.
 *
 * Actions: {action, target?, answer?, text?, field?, scope?, parameter?, value?}
 * - answer is a 1-based option number; numeric brief field identifiers are 1-based.
 * - next/previous/repeat with target:"section" dispatch academy:voice-command.
 *   Event detail: {action, target:"section", route, sectionId?}.
 * - All results contain {ok, action, message}; failures make no requested mutation.
 * - navigate changes the hash; the application's existing hashchange renders it.
 * - Numeric values accept numbers or decimal strings. Boolean values accept
 *   true/false or the strings "true"/"false" (case-insensitive, trimmed).
 * - getContext().currentSections holds lesson prose; currentLesson.sections
 *   indexes it by sectionId to avoid sending the same prose twice.
 */
(function () {
  'use strict';

  const ACTIONS = new Set([
    'navigate', 'next', 'previous', 'repeat', 'quiz', 'answer', 'note',
    'complete', 'set_parameter'
  ]);
  const RELATED = {
    lab: ['tool-anatomy', 'tool-materials', 'holemaking'],
    cutting: ['chip-mechanics', 'milling-operations'],
    manufacture: ['mfg-requirements', 'mfg-carbide', 'mfg-pcd', 'mfg-rollomatic', 'mfg-quality'],
    diagnostics: ['failure-diagnosis', 'pcb-tools'],
    ai: ['ai-design-system', 'knowledge-and-collaboration', 'portfolio-and-experiments'],
    field: ['knowledge-and-collaboration', 'mfg-quality']
  };
  const NUMERIC_PARAMETERS = {
    lab: {
      flutes: {min: 2, max: 6, step: 1, label: 'Flute count', unit: ''},
      helix: {min: 0, max: 50, step: 1, label: 'Helix angle', unit: 'degrees'},
      core: {min: 38, max: 72, step: 1, label: 'Core diameter ratio', unit: 'percent'},
      rake: {min: -10, max: 30, step: 1, label: 'Rake angle', unit: 'degrees'},
      relief: {min: 3, max: 18, step: 1, label: 'Clearance angle', unit: 'degrees'}
    },
    cut: {
      d: {min: 1, max: 20, step: 0.5, label: 'Diameter', unit: 'millimetres'},
      n: {min: 1000, max: 30000, step: 500, label: 'Spindle speed', unit: 'revolutions per minute'},
      z: {min: 2, max: 6, step: 1, label: 'Effective tooth count', unit: ''},
      fz: {min: 0.005, max: 0.08, step: 0.001, label: 'Feed per tooth', unit: 'millimetres'},
      ae: {min: 2, max: 100, step: 1, label: 'Radial engagement ratio', unit: 'percent'},
      ap: {min: 0.5, max: 10, step: 0.5, label: 'Axial depth', unit: 'millimetres'},
      length: {min: 2, max: 6, step: 0.25, label: 'Overhang ratio', unit: 'times diameter'}
    }
  };
  const ENUM_PARAMETERS = {
    kind: ['endmill', 'drill', 'pcd'],
    view: ['3d', 'section', 'edge'],
    feature: ['edges', 'flute', 'core', 'shank']
  };
  const PARAMETER_ALIASES = {
    flute_count: 'flutes', helix_angle: 'helix', core_ratio: 'core',
    core_diameter: 'core', rake_angle: 'rake', clearance: 'relief', clearance_angle: 'relief',
    diameter: 'd', speed: 'n', spindle_speed: 'n', teeth: 'z', effective_teeth: 'z',
    feed_per_tooth: 'fz', radial_engagement: 'ae', axial_depth: 'ap',
    overhang: 'length', overhang_ratio: 'length', tool_family: 'kind'
  };
  let lastBriefField = null;

  const query = selector => document.querySelector(selector);
  const queryAll = selector => Array.from(document.querySelectorAll(selector));
  const clean = value => typeof value === 'string' ? value.trim() : '';
  const normalized = value => clean(value).toLowerCase().replace(/[\s_-]+/g, ' ');
  const join = values => values.filter(value => typeof value === 'string' && value.trim()).join('\n');
  const textOf = selector => query(selector)?.textContent?.trim() || '';
  const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  function currentRoute() {
    const hash = location.hash.replace(/^#/, '');
    if (hash.startsWith('lesson/') && DATA.modules.some(module => `lesson/${module.id}` === hash)) return hash;
    return nav.some(([id]) => id === hash) ? hash : 'learn';
  }

  function currentLesson() {
    const routeName = currentRoute();
    return routeName.startsWith('lesson/')
      ? DATA.modules.find(module => module.id === routeName.slice(7)) || null
      : null;
  }

  function result(action, ok, message, extra = {}) {
    return {ok, action, message, ...extra};
  }

  function section(id, title, text, element) {
    const value = {id, title, text: clean(text)};
    if (element) value.element = element;
    return value;
  }

  function lessonCatalogue() {
    return DATA.modules.map((module, index) => ({
      id: module.id, number: index + 1, title: module.title,
      subtitle: module.subtitle, group: module.group, route: `lesson/${module.id}`
    }));
  }

  function sourcesFor(routeName, lesson) {
    const selected = lesson ? [lesson] : DATA.modules.filter(module => (RELATED[routeName] || []).includes(module.id));
    const sources = selected.flatMap(module => module.sources || []);
    if (routeName === 'sources') sources.push(...DATA.sources);
    return Array.from(new Map(sources.map(source => [source.url, {title: source.title, url: source.url}])).values());
  }

  function lessonIsVisible(module) {
    // A hash can change before its hashchange handler renders the next lesson.
    return textOf('.page-heading h1') === module.title && !!query('.lesson-body .quiz-options');
  }

  function quizFeedback(module) {
    // A previous pass badge is not an explanation. Only expose actually displayed feedback.
    if (!lessonIsVisible(module)) return '';
    const attempted = query('.quiz-options [data-answer].correct, .quiz-options [data-answer].wrong');
    return attempted ? textOf('#quiz-feedback') : '';
  }

  function lessonSections(module) {
    const visible = lessonIsVisible(module);
    const nodes = visible ? queryAll('.lesson-body > section') : [];
    const sections = [section(
      `${module.id}:objectives`, module.title,
      join([module.subtitle, 'By the end, you should be able to:', ...module.objectives]),
      visible ? query('.learning-objectives') : undefined
    )];
    module.sections.forEach((item, index) => sections.push(section(
      `${module.id}:section:${index}`, item.heading,
      join([item.body, ...(item.bullets || [])]), nodes[index]
    )));
    sections.push(section(
      `${module.id}:exercise`, 'Try it on the shop floor', module.exercise.prompt,
      nodes[module.sections.length]
    ));
    const answerDetails = nodes[module.sections.length]?.querySelector('details');
    if (answerDetails?.open) sections.push(section(
      `${module.id}:exercise-answer`, 'What a good answer includes', module.exercise.answer, answerDetails
    ));
    sections.push(section(
      `${module.id}:quiz`, 'Check your understanding',
      join([module.quiz.question, ...module.quiz.options.map((option, index) => `Option ${index + 1}. ${option}`)]),
      nodes[module.sections.length + 1]
    ));
    const feedback = quizFeedback(module);
    if (feedback) sections.push(section(`${module.id}:feedback`, 'Answer feedback', feedback, query('#quiz-feedback')));
    return sections;
  }

  function labSnapshot() {
    return {
      kind: lab.kind, view: lab.view, feature: lab.feature,
      flutes: lab.flutes, helix: lab.helix, core: lab.core,
      rake: lab.rake, relief: lab.relief, spin: lab.spin, exploded: lab.exploded,
      wedgeAngle: 90 - lab.rake - lab.relief,
      modelType: 'Schematic teaching model, not manufacturing CAD'
    };
  }

  function cuttingSnapshot() {
    const {d, n, z, fz, ae, ap, length} = cut;
    const ratio = ae / 100;
    const angle = Math.acos(1 - 2 * ratio);
    return {
      inputs: {d, n, z, fz, ae, ap, length},
      units: {d: 'mm', n: 'rpm', z: 'teeth', fz: 'mm/tooth', ae: 'percent of diameter', ap: 'mm', length: 'L/D'},
      outputs: {
        cuttingSpeedMPerMin: Math.PI * d * n / 1000,
        tableFeedMmPerMin: n * z * fz,
        maxChipThicknessMm: fz * (ratio <= 0.5 ? Math.sin(angle) : 1),
        removalRateCm3PerMin: d * ratio * ap * n * z * fz / 1000,
        engagementDegrees: angle * 180 / Math.PI,
        relativeTipDeflection: Math.pow(length / 3, 3)
      },
      assumptions: 'Illustrative straight peripheral milling with a 90-degree cutting edge, constant engagement and no runout. Deflection is an ideal uniform cantilever at fixed load, material and diameter, relative to L/D = 3. No force, temperature, tool life or production setting is predicted.'
    };
  }

  function currentAITab() {
    if (query('#ai-content [data-brief]')) return 'brief';
    if (query('#ai-content .roadmap')) return 'roadmap';
    return query('[data-ai-tab].active')?.dataset.aiTab || 'lessons';
  }

  function sourceTab() {
    return query('[data-source-tab].active')?.dataset.sourceTab || 'glossary';
  }

  function availableControls() {
    const controls = Object.entries(NUMERIC_PARAMETERS).flatMap(([scope, definitions]) =>
      Object.entries(definitions).map(([parameter, definition]) => {
        const control = {
          scope, parameter, type: 'number', ...definition,
          value: scope === 'lab' ? lab[parameter] : cut[parameter], enabled: true
        };
        if (scope === 'lab' && ['flutes', 'helix', 'core'].includes(parameter) && lab.kind === 'pcd') {
          control.enabled = false;
          control.constraint = 'Select endmill or drill first; the PCD assembly has no flute controls.';
        } else if (scope === 'lab' && parameter === 'flutes' && lab.kind === 'drill') {
          control.min = 2;
          control.max = 2;
          control.constraint = 'This teaching drill has two flutes; select endmill for other counts.';
        }
        return control;
      })
    );
    Object.entries(ENUM_PARAMETERS).forEach(([parameter, values]) => controls.push({
      scope: 'lab', parameter, type: 'enum', values: [...values], value: lab[parameter], enabled: true
    }));
    ['spin', 'exploded'].forEach(parameter => controls.push({
      scope: 'lab', parameter, type: 'boolean', values: ['true', 'false'],
      value: lab[parameter], enabled: parameter !== 'exploded' || lab.kind === 'pcd',
      constraint: parameter === 'spin' ? 'Rotation is visible in the 3D view.' : 'Available only for the PCD assembly.'
    }));
    return controls;
  }

  function getSections() {
    const routeName = currentRoute();
    const lesson = currentLesson();
    if (lesson) return lessonSections(lesson);

    if (routeName === 'learn') {
      return [section('learn:intro', 'Your learning path',
        'Work through the lessons in order. Each includes concepts, a shop-floor exercise and a knowledge check. Pair study with the six-week fieldbook.', query('.academy-hero')),
      ...['Fundamentals', 'Applications', 'Manufacturing', 'AI & Leadership'].map((group, index) => section(
        `learn:group:${index}`, group,
        lessonCatalogue().filter(module => module.group === group)
          .map(module => `Lesson ${module.number}. ${module.title}. ${module.subtitle}`).join('\n'),
        queryAll('.module-list')[index]
      ))];
    }

    if (routeName === 'lab') {
      const family = {endmill: 'carbide end mill', drill: 'PCB microdrill', pcd: 'PCD tipped form tool'}[lab.kind];
      const configuration = lab.view === 'edge'
        ? `Rake is ${lab.rake} degrees. Clearance is ${lab.relief} degrees. The idealized supporting wedge is ${90 - lab.rake - lab.relief} degrees.`
        : lab.kind === 'pcd'
          ? `The supported segments are ${lab.exploded ? 'separated from' : 'assembled with'} the tool body.`
          : `${lab.flutes} flutes. Helix angle ${lab.helix} degrees. Core diameter ${lab.core} percent of outside diameter.`;
      return [
        section('lab:configuration', 'The tool you are exploring', `A schematic ${family}. ${configuration}`, query('#model-stage')),
        section('lab:feature', 'Understand the selected feature', textOf('#geometry-insight'), query('#geometry-insight')),
        section('lab:experiment', 'Try this experiment', textOf('#experiment-text'), query('.lesson-strip')),
        section('lab:scope', 'What this model shows', 'The shapes teach geometry relationships. They do not establish manufacturability, cutting forces, wear or a qualified machine setting.')
      ].filter(item => item.text);
    }

    if (routeName === 'cutting') {
      const snapshot = cuttingSnapshot();
      const output = snapshot.outputs;
      return [
        section('cutting:inputs', 'Illustrative milling inputs',
          `Diameter ${cut.d} millimetres. Spindle speed ${cut.n} revolutions per minute. ${cut.z} effective teeth. Feed per tooth ${cut.fz} millimetres. Radial engagement ${cut.ae} percent of diameter. Axial depth ${cut.ap} millimetres.`, query('.controls-grid')),
        section('cutting:outputs', 'Calculated relationships',
          `Cutting speed ${output.cuttingSpeedMPerMin.toFixed(1)} metres per minute. Table feed ${output.tableFeedMmPerMin.toFixed(0)} millimetres per minute. Maximum chip thickness ${output.maxChipThicknessMm.toFixed(4)} millimetres. Removal rate ${output.removalRateCm3PerMin.toFixed(2)} cubic centimetres per minute.`, query('#cut-metrics')),
        section('cutting:engagement', 'Why engagement matters', textOf('#cut-insight'), query('#cut-insight')),
        section('cutting:overhang', 'The overhang penalty',
          `Overhang is ${cut.length} times diameter. Relative static tip deflection is ${output.relativeTipDeflection.toFixed(2)} times the baseline at an overhang of three diameters. ${snapshot.assumptions}`, query('#stiffness-result'))
      ];
    }

    if (routeName === 'manufacture') {
      const step = DATA.processSteps[activeStep];
      const software = DATA.modules.find(module => module.id === 'mfg-rollomatic');
      return [
        section(`manufacture:step:${activeStep}`, `Step ${activeStep + 1}. ${step.title}`, step.body, query('#process-detail')),
        section(`manufacture:evidence:${activeStep}`, 'Evidence to ask for', step.check, query('#process-detail .check')),
        section('manufacture:software', 'Where the software fits',
          software ? join(software.sections.filter(item => /direction of Tool Sketcher|product families/i.test(item.heading)).map(item => item.body)) : '', query('.software-map'))
      ].filter(item => item.text);
    }

    if (routeName === 'diagnostics') {
      const item = DATA.diagnostics[activeCase];
      return [
        section(`diagnostics:${activeCase}:symptom`, `Case ${activeCase + 1}`, item.symptom, query('#case-detail h2')),
        section(`diagnostics:${activeCase}:possibilities`, 'Competing explanations', join(item.possibilities), queryAll('#case-detail ul')[0]),
        section(`diagnostics:${activeCase}:checks`, 'Evidence that separates them', join(item.checks), queryAll('#case-detail ul')[1]),
        section(`diagnostics:${activeCase}:next`, 'Controlled next step', join([item.change, item.lesson]), query('#case-detail .callout'))
      ];
    }

    if (routeName === 'ai') {
      const tab = currentAITab();
      if (tab === 'brief') return DATA.briefFields.map((field, index) => section(
        `ai:brief:${index}`, field.name, join([field.why, `Example only: ${field.example}`]),
        document.getElementById(`brief-${index}`)?.closest('.field')
      ));
      if (tab === 'roadmap') return DATA.roadmap.map((phase, index) => section(
        `ai:phase:${phase.phase}`, `Phase ${phase.phase}. ${phase.title}`,
        join([phase.deliverable, `Advance when: ${phase.gate}`]), queryAll('.roadmap-row')[index]
      ));
      return lessonCatalogue().filter(module => module.group === 'AI & Leadership').map(module => section(
        `ai:lesson:${module.id}`, module.title, module.subtitle,
        queryAll('[data-lesson]').find(element => element.dataset.lesson === module.id)
      ));
    }

    if (routeName === 'field') return DATA.fieldwork.map((week, index) => section(
      `field:week:${index + 1}`, `${typeof week.week === 'number' ? `Week ${week.week}` : week.week}. ${week.title}`,
      join([...week.tasks, `Bring back: ${week.evidence}`]), queryAll('.week-card')[index]
    ));

    if (routeName === 'sources') {
      if (sourceTab() === 'references') return DATA.sources.map((source, index) => section(
        `sources:reference:${index}`, source.title,
        `Reference: ${source.title}. Open the on-screen link to read the publisher's material.`, queryAll('.sources-list a')[index]
      ));
      if (sourceTab() === 'scope') return [section('sources:scope', 'Scope of this edition', textOf('#source-content'), query('#source-content'))];
      const search = (query('#glossary-search')?.value || '').toLowerCase();
      return DATA.glossary.filter(item => `${item.term} ${item.definition}`.toLowerCase().includes(search))
        .map((item, index) => section(`sources:term:${DATA.glossary.indexOf(item)}`, item.term, item.definition, queryAll('#glossary-list > div')[index]));
    }
    return [];
  }

  function getContext() {
    const routeName = currentRoute();
    const lesson = currentLesson();
    const context = {
      course: 'CTC Toolcraft Academy — educational prototype',
      scope: 'Beginner rotary cutting-tool design, PCB and PCD, manufacturing, inspection and AI-assisted engineering. Teaching examples are not released designs or production recipes.',
      route: routeName,
      supportedActions: [...ACTIONS],
      availableControls: availableControls(),
      controlValueFormat: 'Use the displayed units. Numeric controls accept numbers or decimal strings. Boolean controls accept true/false or the strings "true"/"false". Enum strings must match a listed value.',
      routes: nav.map(([id, title]) => ({id, title})),
      lessonCatalogue: lessonCatalogue(),
      currentSections: getSections().map(({id, title, text}) => ({id, title, text})),
      sources: sourcesFor(routeName, lesson)
    };
    if (lesson) {
      context.currentLesson = {
        id: lesson.id, title: lesson.title, subtitle: lesson.subtitle, group: lesson.group,
        objectives: [...lesson.objectives],
        sections: lesson.sections.map((item, index) => ({heading: item.heading, sectionId: `${lesson.id}:section:${index}`})),
        exercise: {prompt: lesson.exercise.prompt},
        quiz: {question: lesson.quiz.question, options: [...lesson.quiz.options]},
        completed: state.completed.includes(lesson.id), passed: state.passed.includes(lesson.id)
      };
    } else if (routeName === 'lab') context.lab = labSnapshot();
    else if (routeName === 'cutting') context.cutting = cuttingSnapshot();
    else if (routeName === 'manufacture') context.process = {index: activeStep + 1, total: DATA.processSteps.length, ...DATA.processSteps[activeStep]};
    else if (routeName === 'diagnostics') context.diagnostic = {index: activeCase + 1, total: DATA.diagnostics.length, ...DATA.diagnostics[activeCase]};
    else if (routeName === 'ai') {
      context.tab = currentAITab();
      // Field definitions are public curriculum. Visitor-entered values are deliberately absent.
      if (context.tab === 'brief') context.briefFields = DATA.briefFields.map(field => ({name: field.name, why: field.why, example: field.example}));
    } else if (routeName === 'sources') context.tab = sourceTab();
    return context;
  }

  function voiceCommand(action, sectionId) {
    if (sectionId && !getSections().some(item => item.id === sectionId)) return result(action, false, 'That section is not on the current page.');
    const detail = {action, target: 'section', route: currentRoute()};
    if (sectionId) detail.sectionId = sectionId;
    window.dispatchEvent(new CustomEvent('academy:voice-command', {detail}));
    return result(action, true, 'Requested the narration control.', {delegated: true, ...detail});
  }

  function resolveRoute(target) {
    if (typeof target !== 'string') return null;
    const value = target.trim().replace(/^#/, '');
    const match = value.match(/^(?:lesson\s+)?(\d+)$/i);
    if (match) return DATA.modules[Number(match[1]) - 1] ? `lesson/${DATA.modules[Number(match[1]) - 1].id}` : null;
    const module = DATA.modules.find(item => value === item.id || value === `lesson/${item.id}` || normalized(value) === normalized(item.title));
    if (module) return `lesson/${module.id}`;
    const item = nav.find(([id, title]) => value === id || normalized(value) === normalized(title));
    return item ? item[0] : null;
  }

  function goTo(action, routeName) {
    if (!routeName) return result(action, false, 'Choose one of the academy pages or a lesson from the catalogue.');
    const changed = currentRoute() !== routeName;
    if (changed) location.hash = routeName;
    const title = routeName.startsWith('lesson/') ? DATA.modules.find(item => `lesson/${item.id}` === routeName).title : nav.find(([id]) => id === routeName)[1];
    return result(action, true, `${changed ? 'Opening' : 'You are on'} ${title}.`, {route: routeName});
  }

  function navigate(action, target) {
    if (!['navigate', 'next', 'previous', 'repeat'].includes(action)) return result(action, false, 'That navigation action is not supported.');
    if (action === 'repeat' || target === 'section') return voiceCommand(action);
    if (action === 'navigate') return goTo(action, resolveRoute(target));
    const direction = action === 'next' ? 1 : -1;
    const lesson = currentLesson();
    const routeName = currentRoute();
    if (lesson || target === 'lesson' || routeName === 'learn') {
      const index = lesson ? DATA.modules.indexOf(lesson) : -1;
      const nextLesson = DATA.modules[index + direction];
      return nextLesson ? goTo(action, `lesson/${nextLesson.id}`) : result(action, false, direction > 0 ? 'You are at the last lesson.' : 'There is no earlier lesson.');
    }
    if (routeName === 'manufacture' && !['route', 'page'].includes(target)) {
      const nextStep = activeStep + direction;
      const button = queryAll('[data-step]').find(element => Number(element.dataset.step) === nextStep);
      if (!button || nextStep < 0 || nextStep >= DATA.processSteps.length) return result(action, false, 'There is no further manufacturing step in that direction.');
      button.click();
      return result(action, true, `Selected step ${activeStep + 1}. ${DATA.processSteps[activeStep].title}`, {step: activeStep + 1});
    }
    if (routeName === 'diagnostics' && !['route', 'page'].includes(target)) {
      const nextCase = activeCase + direction;
      const button = queryAll('[data-case]').find(element => Number(element.dataset.case) === nextCase);
      if (!button || nextCase < 0 || nextCase >= DATA.diagnostics.length) return result(action, false, 'There is no further diagnostic case in that direction.');
      button.click();
      return result(action, true, `Selected case ${activeCase + 1}.`, {case: activeCase + 1});
    }
    const index = nav.findIndex(([id]) => id === routeName);
    return nav[index + direction] ? goTo(action, nav[index + direction][0]) : result(action, false, 'There is no further page in that direction.');
  }

  function answerQuiz(args) {
    const module = currentLesson();
    if (!module) return result('answer', false, 'Open a lesson before answering its knowledge check.');
    if (!lessonIsVisible(module)) return result('answer', false, 'The lesson is still opening. Try the answer again when it is visible.');
    const raw = args.answer ?? args.value;
    const number = typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw.trim())) ? Number(raw) : NaN;
    if (!Number.isInteger(number) || number < 1 || number > module.quiz.options.length) return result('answer', false, `Choose an option number from 1 to ${module.quiz.options.length}.`);
    const button = queryAll('[data-answer]').find(element => Number(element.dataset.answer) === number - 1);
    if (!button) return result('answer', false, 'The lesson is still opening. Try the answer again when it is visible.');
    button.click();
    return result('answer', true, textOf('#quiz-feedback'), {option: number, correct: number - 1 === module.quiz.correct});
  }

  function briefIndex(value) {
    if (typeof value === 'number' && Number.isInteger(value)) return value - 1;
    if (typeof value !== 'string') return null;
    const match = value.trim().match(/^brief-(\d+)$/);
    if (match) return Number(match[1]);
    const index = DATA.briefFields.findIndex(field => normalized(field.name) === normalized(value));
    return index < 0 ? null : index;
  }

  function appendNote(args) {
    if (typeof args.text !== 'string' || !args.text.trim()) return result('note', false, 'Provide the text to append to your note.');
    const text = args.text.trim().slice(0, 2000);
    const routeName = currentRoute();
    const module = currentLesson();
    const explicitBrief = ['brief', 'field'].includes(args.target) || args.field !== undefined;
    const useBrief = explicitBrief || (routeName === 'ai' && args.target !== 'session' && lastBriefField !== null && query(`#brief-${lastBriefField}`));
    const append = previous => `${previous}${previous && !previous.endsWith('\n') ? '\n' : ''}${text}`;
    let noteId;
    let label;
    if (useBrief) {
      const index = args.field !== undefined ? briefIndex(args.field) : lastBriefField;
      if (routeName !== 'ai' || !Number.isInteger(index) || !DATA.briefFields[index]) return result('note', false, 'Select a visible engineering-brief field for dictation.');
      const field = document.getElementById(`brief-${index}`);
      if (!field || !field.hasAttribute('data-brief')) return result('note', false, 'Open the customer brief and select the field to append to.');
      field.value = append(field.value);
      field.dispatchEvent(new Event('input', {bubbles: true}));
      noteId = `brief:${index}`;
      label = DATA.briefFields[index].name;
    } else if (module && args.target !== 'session') {
      const field = document.getElementById('lesson-notes');
      if (!field || !lessonIsVisible(module)) return result('note', false, 'The lesson is still opening. Try the note again when it is visible.');
      field.value = append(field.value);
      field.dispatchEvent(new Event('input', {bubbles: true}));
      noteId = module.id;
      label = 'this lesson’s notes';
    } else {
      noteId = `voice:${routeName}`;
      state.notes[noteId] = append(typeof state.notes[noteId] === 'string' ? state.notes[noteId] : '');
      save();
      label = 'the local notes for this page';
    }
    const truncated = args.text.trim().length > text.length;
    window.dispatchEvent(new CustomEvent('academy:note-saved', {detail: {route: routeName, noteId}}));
    return result('note', true, `Appended ${text.length} characters to ${label}.${truncated ? ' The entry was limited to 2,000 characters.' : ''}`, {noteId, charactersAdded: text.length, truncated});
  }

  function setParameter(args) {
    if (typeof args.parameter !== 'string') return result('set_parameter', false, 'Name the teaching-model parameter to change.');
    let key = args.parameter.trim().toLowerCase().replace(/[ -]/g, '_');
    let scope = args.scope === 'cutting' ? 'cut' : args.scope;
    const prefix = key.match(/^(lab|cut|cutting)[._](.+)$/);
    if (prefix) {
      const suppliedScope = prefix[1] === 'cutting' ? 'cut' : prefix[1];
      if (scope && scope !== suppliedScope) return result('set_parameter', false, 'The parameter scope and name do not match.');
      scope = suppliedScope;
      key = prefix[2];
    }
    if (owns(PARAMETER_ALIASES, key)) key = PARAMETER_ALIASES[key];
    if (!scope) scope = currentRoute() === 'cutting' ? 'cut' : 'lab';
    if (!['lab', 'cut'].includes(scope)) return result('set_parameter', false, 'Only geometry-lab and cutting-lab parameters can be changed.');
    const definition = owns(NUMERIC_PARAMETERS[scope], key) ? NUMERIC_PARAMETERS[scope][key] : null;
    let value = args.value;
    if (definition) {
      if (typeof value !== 'number' && !(typeof value === 'string' && /^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim()))) return result('set_parameter', false, 'Provide a finite numeric value in the control’s displayed units.');
      value = Number(value);
      const steps = (value - definition.min) / definition.step;
      if (!Number.isFinite(value) || value < definition.min || value > definition.max || Math.abs(steps - Math.round(steps)) > 1e-7) {
        return result('set_parameter', false, `${definition.label} must be between ${definition.min} and ${definition.max} ${definition.unit}, in steps of ${definition.step}.`);
      }
      if (scope === 'lab' && ['flutes', 'helix', 'core'].includes(key) && lab.kind === 'pcd') return result('set_parameter', false, 'Those flute controls do not apply to the PCD assembly model. Select an end mill or drill first.');
      if (scope === 'lab' && key === 'flutes' && lab.kind === 'drill' && value !== 2) return result('set_parameter', false, 'This teaching drill has two flutes. Select the end mill to explore other flute counts.');
    } else if (scope === 'lab' && owns(ENUM_PARAMETERS, key)) {
      const choices = ENUM_PARAMETERS[key];
      if (!choices.includes(value)) return result('set_parameter', false, `Choose one of: ${choices.join(', ')}.`);
    } else if (scope === 'lab' && ['spin', 'exploded'].includes(key)) {
      if (typeof value === 'string' && /^(true|false)$/i.test(value.trim())) value = value.trim().toLowerCase() === 'true';
      if (typeof value !== 'boolean') return result('set_parameter', false, 'Use true or false for this model control.');
      if (key === 'exploded' && lab.kind !== 'pcd') return result('set_parameter', false, 'Separate-segment view is available for the PCD assembly.');
    } else return result('set_parameter', false, 'That parameter is not an editable teaching control.');

    if (scope === 'lab') {
      lab[key] = value;
      if (key === 'kind') {
        lab.flutes = value === 'endmill' ? 3 : 2;
        lab.helix = value === 'pcd' ? 0 : 30;
        lab.feature = 'edges';
        lab.exploded = false;
      }
      if (['rake', 'relief'].includes(key)) lab.view = 'edge';
      if (['flutes', 'helix', 'core'].includes(key) && lab.view === 'edge') lab.view = '3d';
      if (key === 'exploded' && lab.view === 'edge') lab.view = '3d';
      if (currentRoute() === 'lab') renderLab();
      else location.hash = 'lab';
    } else {
      cut[key] = value;
      if (currentRoute() === 'cutting') renderCutting();
      else location.hash = 'cutting';
    }
    const label = definition?.label || key;
    return result('set_parameter', true, `${label} is now ${value}${definition?.unit ? ` ${definition.unit}` : ''} in the teaching model.`,
      {scope, parameter: key, value, route: scope === 'lab' ? 'lab' : 'cutting', current: scope === 'lab' ? labSnapshot() : cuttingSnapshot()});
  }

  function performAction(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args) || !ACTIONS.has(args.action)) return result('unknown', false, 'That voice action is not supported.');
    const action = args.action;
    if (['navigate', 'next', 'previous', 'repeat'].includes(action)) {
      if (args.target === 'section' || action === 'repeat') return voiceCommand(action, clean(args.sectionId) || undefined);
      return navigate(action, args.target);
    }
    if (action === 'set_parameter') return setParameter(args);
    if (action === 'note') return appendNote(args);
    if (action === 'answer') return answerQuiz(args);
    const module = currentLesson();
    if (!module) return result(action, false, 'Open a lesson to use its knowledge check or completion control.');
    if (!lessonIsVisible(module)) return result(action, false, 'The lesson is still opening. Try again when it is visible.');
    if (action === 'quiz') {
      const node = query('.quiz-options');
      node?.scrollIntoView({block: 'center', behavior: 'smooth'});
      const sectionId = `${module.id}:quiz`;
      voiceCommand('repeat', sectionId);
      return result(action, true, 'Ready for the knowledge check.', {sectionId, question: module.quiz.question, options: [...module.quiz.options]});
    }
    if (!state.passed.includes(module.id)) return result(action, false, 'Pass the knowledge check before marking this lesson complete.');
    const button = document.getElementById('complete-lesson');
    if (!button) return result(action, false, 'The lesson is still opening. Try again when it is visible.');
    button.click();
    return result(action, state.completed.includes(module.id), state.completed.includes(module.id) ? 'Lesson marked complete.' : 'The lesson was not marked complete.', {lessonId: module.id});
  }

  document.addEventListener('focusin', event => {
    const field = event.target;
    if (field?.hasAttribute?.('data-brief')) {
      const index = Number(field.dataset.brief);
      if (Number.isInteger(index) && DATA.briefFields[index]) lastBriefField = index;
    }
  });
  window.addEventListener('hashchange', () => { lastBriefField = null; });

  window.AcademyVoiceContent = Object.freeze({getContext, getSections, navigate, performAction});
}());
