const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 768, height: 1024 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const assets = path.resolve(__dirname, '../app/src/main/assets/www');
    await page.route('http://quiz.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }));
    await page.goto('http://quiz.test/');
    await page.addStyleTag({ path: path.join(assets, 'styles.css') });
    const source = fs.readFileSync(path.join(assets, 'app.js'), 'utf8').replace('init();', '');
    await page.addScriptTag({ content: fs.readFileSync(path.join(assets, 'billing.js'), 'utf8') });
    await page.addScriptTag({ content: source });
    await page.evaluate(() => { loadParentFamilies = async () => state.family ? [state.family] : []; });
    const bibleQuestions = [
      ['What is the very first book of the Bible?', ['Exodus', 'Genesis', 'Psalms', 'Matthew'], 'B'],
      ['How many days did God take to create the world before resting on the seventh day?', ['3 days', '5 days', '6 days', '10 days'], 'C'],
      ['Which young shepherd boy defeated the giant Goliath with a sling and a stone?', ['David', 'Solomon', 'Joseph', 'Samuel'], 'A'],
      ['What special gift did Jacob give to his favorite son, Joseph?', ['A golden crown', 'A coat of many colors', 'A silver ring', "A shepherd's staff"], 'B'],
      ['Who did God choose to lead the Israelites out of slavery in Egypt?', ['Abraham', 'Noah', 'Moses', 'Joshua'], 'C'],
      ['In what city was Jesus born?', ['Nazareth', 'Jerusalem', 'Bethlehem', 'Jericho'], 'C'],
      ['How many apostles did Jesus choose to be His closest followers?', ['7', '10', '12', '40'], 'C'],
      ['What is the shortest verse in the Bible?', ['"God is love."', '"Jesus wept."', '"Pray continually."', '"Rejoice always."'], 'B'],
      ['Which fruit of the Spirit is listed first in Galatians 5:22?', ['Joy', 'Peace', 'Love', 'Kindness'], 'C'],
      ['What did Jesus do on the third day after He died on the cross?', ['He rose from the dead.', 'He ascended straight to heaven.', 'He appeared only to the king.', 'He wrote a new gospel.'], 'A'],
    ];
    const pastedBibleQuiz = bibleQuestions.map(([prompt, choices, answer], index) =>
      `**Question ${index + 1}**\n\n${prompt}\n\n${choices.map((choice, i) => `${'ABCD'[i]}) ${choice}`).join('\n\n')}\n\n- **Answer:** ${answer}) ${choices['ABCD'.indexOf(answer)]}\n- **Explanation:** An explanation on another line.`
    ).join('\n\n');
    const parsedBible = await page.evaluate(text => parseQuiz(text), pastedBibleQuiz);
    assert.equal(parsedBible.length, 10);
    parsedBible.forEach((question, index) => {
      assert.equal(question.prompt, bibleQuestions[index][0]);
      assert.equal(question.answer, bibleQuestions[index][2]);
      assert.deepEqual(question.choices.map(c => c.text), bibleQuestions[index][1]);
    });
    const legacyQuiz = await page.evaluate(() => parseQuiz('### **1. Piliin ang sagot?**\nA) Mali\nB) Tama\nC) Iba\nD) Wala\n**Tamang Sagot:** **B) Tama**\n*Paliwanag:* Tama ang B.'));
    assert.equal(legacyQuiz[0].choices[3].text, 'Wala');
    assert.equal(legacyQuiz[0].answer, 'B');
    console.log('All 10 Bible questions, letter keys, clean choices, and existing Filipino format passed');
    await page.evaluate(() => {
      state.session = { mode: 'parent', userId: 'parent' };
      state.family = { id: 'family', name: 'Test Family' };
      state.children = [{ id: 'child', display_name: 'Test Child' }];
      state.view = 'quiz';
      render();
    });
    await page.locator('[name=mc_source][value=manual]').check();
    await page.locator('[name=mc_question]').fill('First book?');
    await page.locator('[name=mc_choice_A]').fill('Exodus');
    await page.locator('[name=mc_choice_B]').fill('Genesis');
    await page.locator('[name=mc_answer]').selectOption('D');
    await page.locator('button[value=preview]').click();
    assert((await page.locator('#mcSourceError').innerText()).includes('answer key'));
    await page.locator('[name=mc_answer]').selectOption('B');
    await page.locator('[name=mc_explanation]').fill('Genesis is first.');
    await page.locator('#addMcRowBtn').click();
    assert.equal(await page.locator('[name=mc_question]').count(), 2);
    await page.locator('[data-delete-mc-row]').nth(1).click();
    await page.locator('button[value=preview]').click();
    const manualMc = await page.evaluate(() => state.previewQuiz.questions[0]);
    assert.equal(manualMc.answer, 'B');
    assert.equal(manualMc.explanation, 'Genesis is first.');
    await page.locator('#backToQuizBtn').click();
    await page.locator('[name=mc_source][value=csv]').check();
    const mcCsv = 'Question,Choice A,Choice B,Choice C,Choice D,Answer Key,Explanation\r\n"First book, please?",Exodus,Genesis,Psalms,Matthew,b,"Genesis is first, before Exodus."\r\nSecond question?,Yes,No,,,A,\r\n';
    await page.locator('#mcCsvFile').setInputFiles({ name: 'multiple-choice.csv', mimeType: 'text/csv', buffer: Buffer.from(mcCsv) });
    await page.locator('button[value=preview]').click();
    await page.locator('#backToQuizBtn').waitFor();
    const csvMc = await page.evaluate(() => state.previewQuiz.questions);
    assert.equal(csvMc.length, 2);
    assert.equal(csvMc[0].answer, 'B');
    assert.equal(csvMc[0].prompt, 'First book, please?');
    assert.equal(csvMc[1].explanation, '');
    assert(await page.evaluate(() => questionExplanationHtml(state.previewQuiz.questions[0]).includes('before Exodus')));
    await page.locator('#backToQuizBtn').click();
    const adjectiveCsvPath = path.join(path.dirname(process.argv[2]), 'english_adjectives_quiz.csv');
    if (fs.existsSync(adjectiveCsvPath)) {
      await page.locator('#mcCsvFile').setInputFiles(adjectiveCsvPath);
      await page.locator('button[value=preview]').click();
      await page.locator('#backToQuizBtn').waitFor();
      const adjectiveQuiz = await page.evaluate(() => state.previewQuiz.questions);
      assert.equal(adjectiveQuiz.length, 10);
      assert.deepEqual(adjectiveQuiz.map(q => q.answer), ['B', 'C', 'B', 'B', 'D', 'A', 'C', 'B', 'C', 'B']);
      assert(adjectiveQuiz.every(q => q.choices.length === 4 && q.explanation.length > 0));
      assert.equal(adjectiveQuiz[0].choices[1].text, 'fluffy');
      await page.locator('#backToQuizBtn').click();
      console.log('Actual adjectives CSV: all 10 choice-prefixed answer keys, choices, explanations and upload preview passed');
    }
    await page.evaluate(() => { state.quizDraftForm = null; app.innerHTML = ''; });
    console.log('Multiple-choice manual entry, validation, CSV upload, optional explanations and preview passed');
    await page.evaluate(() => {
      state.session = { mode: 'parent', userId: 'parent' };
      state.family = { id: 'family', name: 'Test Family' };
      state.children = [{ id: 'child', display_name: 'Test Child' }];
      state.view = 'quiz';
      supabaseGet = async table => table === 'mn_families' ? [state.family]
        : table === 'mn_children' ? state.children : [];
      render();
      window.originalQuizForm = byId('quizForm');
    });
    await page.selectOption('#quizTypeSelect', 'fill_blank');
    await page.locator('[name=question_source][value=manual]').check();
    await page.locator('[name=manual_question]').fill('Draft question');
    await page.locator('[name=manual_answer]').fill('Draft answer');
    await page.locator('#addQuizRowBtn').click();
    await page.evaluate(() => refreshData(true));
    assert(await page.evaluate(() => byId('quizForm') === window.originalQuizForm));
    assert.equal(await page.locator('[name=manual_question]').count(), 2);
    await page.locator('button[value=preview]').click();
    await page.locator('#backToQuizBtn').click();
    assert.equal(await page.locator('#quizTypeSelect').inputValue(), 'fill_blank');
    assert.equal(await page.locator('[name=manual_answer]').first().inputValue(), 'Draft answer');
    await page.locator('#addQuizRowBtn').click();
    assert.equal(await page.locator('[name=manual_question]').count(), 3);
    await page.evaluate(() => { state.notice = 'Old notification'; setView('home'); setView('quiz'); });
    assert.equal(await page.locator('[name=manual_question]').count(), 3);
    assert.equal(await page.evaluate(() => state.notice), '');
    console.log('Quiz draft survives background refresh, preview/back, and tab navigation without duplicate handlers');
    for (const type of ['flash_card', 'fill_blank']) {
      await page.evaluate(() => {
        state.quizDraftForm = null;
        state.children = [{ id: 'child', display_name: 'Test Child' }];
        app.innerHTML = quizForm();
        bindParentHandlers();
      });
      await page.selectOption('#quizTypeSelect', type);
      assert(await page.locator('#quizCsvUpload .csv-format').isVisible());
      await page.locator('[name=question_source][value=manual]').check();
      assert(await page.locator('#quizManualEntry').isVisible());
      assert.equal(await page.locator('#quizCsvUpload').isVisible(), false);
      await page.locator('[name=manual_question]').fill('What is used to type?');
      await page.locator('[name=manual_answer]').fill('Keyboard');
      await page.locator('#addQuizRowBtn').click();
      await page.locator('[name=manual_question]').nth(1).fill('Incomplete row');
      await page.locator('button[value=preview]').click();
      assert((await page.locator('#quizSourceError').innerText()).includes('Row 2'));
      assert.equal(await page.locator('[name=manual_answer]').first().inputValue(), 'Keyboard');
      await page.locator('[data-delete-quiz-row]').nth(1).click();
      await page.locator('button[value=preview]').click();
      assert.equal(await page.evaluate(() => state.previewQuiz.questions[0].answer), 'Keyboard');
      assert(await page.evaluate(() => answersMatch('kEyBoArD', state.previewQuiz.questions[0].answer)));
      await page.locator('#backToQuizBtn').click();
      console.log(`${type}: manual entry, add/delete, incomplete row validation and mixed-case grading passed`);
    }
    const csv = fs.readFileSync(process.argv[2], 'utf8');
    for (const type of ['flash_card', 'fill_blank']) {
      await page.setViewportSize(type === 'flash_card' ? { width: 768, height: 1024 } : { width: 390, height: 844 });
      const count = await page.evaluate(async ({ csv, type }) => {
        const questions = (await parseQuizCsv({ name: 'exam.csv', text: async () => csv }, type))
          .map((q, index) => ({ ...q, id: `q${index}` }));
        state.family = { id: 'family' };
        state.children = [{ id: 'child', display_name: 'Test Child' }];
        state.assignments = [{ id: 'assignment', mission_id: 'mission', child_id: 'child' }];
        state.missions = [{ id: 'mission', title: 'Computer Exam', source_text: `${type} CSV` }];
        state.quizAttempts = [];
        // Return legacy questions without the type marker to exercise mission fallback.
        supabaseGet = async () => questions.map(q => ({ ...q, explanation: '' }));
        supabaseRequest = async () => [];
        supabasePatch = async () => [];
        supabaseInsert = async (table, body) => ({ id: `saved-${Date.now()}`, ...body });
        await startQuiz('assignment');
        return questions.length;
      }, { csv, type });
      assert(count > 1);
      await page.screenshot({ path: path.join(require('node:os').tmpdir(), `missionnest-${type}.png`), fullPage: true });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      for (let attempt = 0; attempt < 2; attempt++) {
        if (type === 'fill_blank') {
          assert.equal(await page.locator('[data-fill-answer]').count(), count);
          assert.equal(await page.locator('#nextQuizBtn').innerText(), 'Submit Quiz');
          await page.locator('#nextQuizBtn').click();
          assert.equal(await page.evaluate(() => state.quizResult), null);
          assert.equal(await page.evaluate(() => state.quizAttempts.length), attempt);
          assert((await page.locator('#app').innerText()).includes(`${count} unanswered questions`));
        }
        for (let i = 0; i < count; i++) {
          const input = type === 'fill_blank' ? page.locator('[data-fill-answer]').nth(i) : page.locator('#typedQuizAnswer');
          const answer = await page.evaluate(index => state.selectedQuiz.questions[index].answer, type === 'fill_blank' ? i : await page.evaluate(() => state.quizStep));
          const wrong = attempt === 0 && i === 0;
          await input.fill(wrong ? 'incorrect test answer' : answer.toLowerCase());
          if (type === 'flash_card') {
            await page.locator('#checkFlashBtn').click();
            if (wrong) {
              await page.locator('#showCorrectAnswerBtn').click();
              assert((await page.locator('[role=status]:not(#quizClockWarning)').innerText()).includes(answer));
            }
          }
          if (type === 'flash_card') await page.locator('#nextQuizBtn').click();
        }
        if (type === 'fill_blank') await page.locator('#nextQuizBtn').click();
        await page.locator('#retakeQuizBtn').waitFor();
        const result = await page.evaluate(() => ({ score: state.quizResult.score, total: state.quizResult.total, attempts: state.quizAttempts.length }));
        assert.equal(result.score, attempt === 0 ? count - 1 : count);
        assert.equal(result.total, count);
        assert.equal(result.attempts, attempt + 1);
        await page.locator('#reviewAnswersBtn').click();
        assert((await page.locator('#app').innerText()).includes('Correct answer:'));
        if (attempt === 0) {
          await page.locator('#retakeQuizBtn').click();
          assert.equal(await page.locator(type === 'fill_blank' ? '[data-fill-answer]' : '#typedQuizAnswer').first().inputValue(), '');
        }
      }
      console.log(`${type}: ${count} questions, score, review and two attempts passed`);
    }
    await page.evaluate(() => {
      state.selectedQuiz = null;
      state.quizResult = null;
      state.quizAttempts = [];
      state.children = [{ id: 'child', display_name: 'Test Child' }, { id: 'sibling', display_name: 'Sibling' }];
      state.assignments = [
        { id: 'pending', child_id: 'child', mission_id: 'mission', status: 'assigned' },
        { id: 'sibling-pending', child_id: 'sibling', mission_id: 'mission', status: 'assigned' },
        { id: 'completed', child_id: 'child', mission_id: 'mission', status: 'submitted' },
      ];
      state.missions = [{ id: 'mission', title: 'Computer Exam', mission_type: 'quiz' }];
      window.quizWrites = [];
      supabaseGet = async (table) => table === 'mn_assignments' ? state.assignments.filter(a => a.status === 'assigned')
        : table === 'mn_missions' ? state.missions
        : [{ prompt: 'What is used to type?', answer: 'Keyboard', choices: [] }];
      supabaseInsert = async (table, body) => { window.quizWrites.push({ table, body }); return { id: 'new', ...body }; };
      refreshData = async () => {};
      app.innerHTML = quizForm();
      bindParentHandlers();
    });
    assert.equal(await page.locator('[data-delete-pending-quiz]').count(), 2);
    assert.equal(await page.locator('[data-quiz-child]').count(), 2);
    assert.equal(await page.locator('[data-delete-pending-quiz=pending]').isVisible(), false);
    await page.locator('[data-quiz-child=child] summary').click();
    assert.equal(await page.locator('[data-delete-pending-quiz=pending]').isVisible(), true);
    assert.equal(await page.locator('[data-delete-pending-quiz=sibling-pending]').isVisible(), false);
    const matches = await page.evaluate(async () => {
      const questions = [{ prompt: 'WHAT IS USED TO TYPE?', answer: 'keyboard', choices: [] }];
      return findPendingQuizDuplicates(['child'], 'Renamed Exam', questions);
    });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].childName, 'Test Child');
    await page.selectOption('#quizTypeSelect', 'flash_card');
    await page.locator('[name=question_source][value=manual]').check();
    await page.locator('[name=title]').fill('Computer Exam');
    await page.locator('[name=manual_question]').fill('What is used to type?');
    await page.locator('[name=manual_answer]').fill('Keyboard');
    await page.locator('[name=children][value=child]').check();
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('button[value=launch]').click();
    await page.waitForFunction(() => !state.quizLaunching);
    assert.equal(await page.evaluate(() => window.quizWrites.length), 0);
    assert.equal(await page.locator('[name=manual_answer]').inputValue(), 'Keyboard');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('button[value=launch]').click();
    await page.waitForFunction(() => !state.quizLaunching);
    assert.equal(await page.evaluate(() => window.quizWrites.filter(w => w.table === 'mn_assignments').length), 1);
    await page.evaluate(() => {
      app.innerHTML = pendingQuizList();
      bindParentHandlers();
      supabaseRequest = async (url, options) => {
        window.deletedQuiz = { url, method: options.method };
        state.assignments = state.assignments.filter(a => a.id !== 'pending');
        return [];
      };
    });
    await page.locator('[data-quiz-child=child] summary').evaluate(element => { if (!element.parentElement.open) element.click(); });
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[data-delete-pending-quiz=pending]').click();
    const deletion = await page.evaluate(() => ({ request: window.deletedQuiz, siblings: state.assignments.some(a => a.id === 'sibling-pending') }));
    assert.equal(deletion.request.method, 'DELETE');
    assert(deletion.request.url.includes('status=not.in.(submitted,approved)'));
    assert.equal(deletion.siblings, true);
    console.log('Pending queue, duplicate content detection, cancel/continue and child-specific deletion passed');
    for (const type of ['multiple_choice', 'fill_blank', 'flash_card']) {
      await page.evaluate(async type => {
        state.quizResult = null;
        state.quizAttempts = [];
        state.assignments = [{ id: 'timed', mission_id: 'timer-mission', child_id: 'child' }];
        state.missions = [{ id: 'timer-mission', mission_type: 'quiz', title: 'Timed test', quiz_time_limit_seconds: 120 }];
        supabaseGet = async () => [0, 1].map(i => ({ id: `t${i}`, prompt: `Question ${i}`, answer: type === 'multiple_choice' ? 'A' : 'Keyboard', choices: type === 'multiple_choice' ? [{ label: 'A', text: 'Keyboard' }, { label: 'B', text: 'Mouse' }] : [], explanation: type }));
        supabaseRequest = async () => [];
        await startQuiz('timed');
        state.selectedQuiz.startedAt = Date.now() - 61000;
        persistQuizAttempt();
        updateQuizClock();
      }, type);
      assert((await page.locator('#quizClockWarning').innerText()).includes('One minute'));
      if (type === 'fill_blank') {
        await page.locator('[data-fill-answer]').first().fill('   ');
        await page.locator('#nextQuizBtn').click();
        assert((await page.locator('#app').innerText()).includes('2 unanswered questions: 1, 2'));
        assert.equal(await page.evaluate(() => state.quizAttempts.length), 0);
      }
      if (type === 'multiple_choice') {
        assert(await page.locator('#previousQuestionBtn').isDisabled());
        await page.locator('[data-answer=A]').click();
        await page.locator('#nextQuestionBtn').click();
        assert(await page.locator('#nextQuestionBtn').isDisabled());
        await page.locator('#nextQuizBtn').click();
        assert.equal(await page.evaluate(() => state.quizAttempts.length), 0);
        assert((await page.locator('#app').innerText()).includes('Please answer question 2'));
        await page.locator('#previousQuestionBtn').click();
        assert(await page.locator('[data-answer=A]').evaluate(el => el.classList.contains('selected')));
        await page.locator('[data-answer=B]').click();
        await page.locator('#nextQuestionBtn').click();
        await page.locator('#previousQuestionBtn').click();
        assert(await page.locator('[data-answer=B]').evaluate(el => el.classList.contains('selected')));
        await page.locator('[data-answer=A]').click();
        console.log('Multiple-choice arrows preserve selections, allow changes and prevent premature submission');
      }
      else await page.locator(type === 'fill_blank' ? '[data-fill-answer]' : '#typedQuizAnswer').first().fill('kEyBoArD');
      assert(await page.evaluate(() => readQuizAttempt('timed').answers.t0 != null));
      await page.evaluate(() => { state.selectedQuiz.startedAt = Date.now() - 121000; updateQuizClock(); updateQuizClock(); });
      await page.locator('#retakeQuizBtn').waitFor();
      const timed = await page.evaluate(() => ({ result: state.quizResult, attempts: state.quizAttempts }));
      assert.equal(timed.result.score, 1);
      assert.equal(timed.result.total, 2);
      assert.equal(timed.result.timedOut, true);
      assert.equal(timed.result.durationSeconds, 120);
      assert.equal(timed.attempts.length, 1);
      assert.equal(timed.attempts[0].duration_seconds, 120);
      await page.locator('#retakeQuizBtn').click();
      assert(await page.evaluate(() => Date.now() - state.selectedQuiz.startedAt < 3000));
      await page.evaluate(() => {
        state.selectedQuiz.timeLimitSeconds = 0;
        state.selectedQuiz.startedAt = Date.now() - 95000;
        state.quizAnswers = { t0: quizQuestionType(state.selectedQuiz.questions[0]) === 'multiple_choice' ? 'A' : 'Keyboard', t1: 'wrong' };
        state.quizStep = 1;
        if (quizQuestionType(state.selectedQuiz.questions[1]) === 'multiple_choice') state.quizAnswers.t1 = 'B';
        if (quizQuestionType(state.selectedQuiz.questions[1]) === 'flash_card') state.quizFeedback = { questionId: 't1', correct: false };
        renderQuiz();
      });
      await page.locator('#nextQuizBtn').click();
      await page.locator('#retakeQuizBtn').waitFor();
      assert(await page.evaluate(() => state.quizResult.durationSeconds >= 95 && !state.quizResult.timedOut));
      console.log(`${type}: warning, automatic submission with unanswered questions, single save, retake clock and open duration passed`);
    }
    await page.evaluate(() => {
      state.quizResult = null;
      state.parentKidMonitor = 'child';
      state.parentMissionDetail = null;
      state.missions = [{ id: 'chore', family_id: 'family', mission_type: 'mission', title: 'Study and watch', instructions: 'Watch https://example.com/watch?v=1&lesson=2', reward_stars: 25 }];
      state.assignments = [
        { id: 'work', child_id: 'child', mission_id: 'chore', status: 'submitted', checklist_done: { 0: true }, kid_comments: { 0: 'Done' }, parent_comments: { 0: 'Well done' }, focus_elapsed_seconds: 90 },
        { id: 'sibling-work', child_id: 'sibling', mission_id: 'chore', status: 'assigned' },
      ];
      supabaseGet = async table => table === 'mn_assignments' ? [state.assignments[0]] : [state.missions[0]];
      supabaseInsert = async (table, body) => {
        const record = { id: 'continued-chore', ...body };
        state.missions.push(record);
        return record;
      };
      supabasePatch = async (table, id, body) => Object.assign(state.assignments.find(a => a.id === id), body);
      refreshData = async () => {};
      renderParentKidMonitor();
    });
    await page.locator('[data-open-mission-detail=work] summary').click();
    assert(await page.locator('.mission-detail-page').isVisible());
    assert.equal(await page.locator('.full-monitor-hero').count(), 0);
    assert.equal(await page.locator('.instruction-link').getAttribute('href'), 'https://example.com/watch?v=1&lesson=2');
    await page.locator('[data-add-continuation]').click();
    await page.locator('[name=new_instruction]').fill('Practice with https://example.com/lesson');
    await page.locator('[name=new_parent_comment]').fill('Try the next activity');
    await page.locator('[data-add-continuation]').click();
    await page.locator('[data-delete-continuation]').nth(1).click();
    await page.locator('button[type=submit]').click();
    await page.waitForFunction(() => state.assignments[0].mission_id === 'continued-chore');
    const continued = await page.evaluate(() => ({ assignment: state.assignments[0], sibling: state.assignments[1], mission: state.missions.find(m => m.id === 'continued-chore') }));
    assert.equal(continued.assignment.checklist_done[0], true);
    assert.equal(continued.assignment.kid_comments[0], 'Done');
    assert.equal(continued.assignment.parent_comments[1], 'Try the next activity');
    assert.equal(continued.assignment.focus_elapsed_seconds, 90);
    assert.equal(continued.assignment.status, 'assigned');
    assert.equal(continued.sibling.mission_id, 'chore');
    assert.equal(continued.mission.instructions.split('\n').length, 2);
    assert(await page.evaluate(() => !instructionLinksHtml('<script>alert(1)</script> javascript:alert(1)').includes('<script>')));
    await page.evaluate(() => {
      const assignment = state.assignments[0];
      app.innerHTML = missionWorksheetTable(missionById(assignment.mission_id), assignment, state.children[0], 'kidLocked');
    });
    assert.equal(await page.locator('.instruction-link').count(), 2);
    assert.equal(await page.locator('[name=done_1]').isChecked(), false);
    const bareLinks = await page.evaluate(() => {
      const node = document.createElement('div');
      node.innerHTML = instructionLinksHtml('Watch youtube.com/watch?v=123 and youtu.be/abc. Visit www.example.com or https://example.org/lesson?a=1&b=2');
      return [...node.querySelectorAll('a')].map(a => a.href);
    });
    assert.deepEqual(bareLinks, ['https://youtube.com/watch?v=123', 'https://youtu.be/abc', 'https://www.example.com/', 'https://example.org/lesson?a=1&b=2']);
    await page.evaluate(() => { app.innerHTML = missionForm(); bindParentHandlers(); });
    await page.locator('[name=instruction_row]').first().fill('Watch youtube.com/watch?v=123');
    const previewLink = page.locator('.instruction-link-preview a').first();
    assert(await previewLink.isVisible());
    await page.context().route('https://youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Video destination test</h1>' }));
    const popupPromise = page.waitForEvent('popup');
    await previewLink.click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    assert(popup.url().startsWith('https://youtube.com/watch?v=123'));
    await popup.close();
    await page.evaluate(() => {
      const assignment = state.assignments[0];
      assignment.parent_comments[1] = 'Watch https://www.youtube.com/watch?v=eEskPXSdjnU';
      assignment.kid_comments[0] = 'I used https://example.com/lesson';
      app.innerHTML = missionWorksheetTable(missionById(assignment.mission_id), assignment, state.children[0], 'kid');
    });
    const parentCommentLink = page.locator('.mission-comment a');
    assert.equal(await parentCommentLink.getAttribute('href'), 'https://www.youtube.com/watch?v=eEskPXSdjnU');
    assert.equal(await page.locator('[name=parent_comment_1]').count(), 0);
    await page.context().route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: 'Video destination' }));
    const commentPopupPromise = page.waitForEvent('popup');
    await parentCommentLink.click();
    const commentPopup = await commentPopupPromise;
    await commentPopup.waitForLoadState();
    assert(commentPopup.url().includes('watch?v=eEskPXSdjnU'));
    await commentPopup.close();
    await page.evaluate(() => {
      const assignment = state.assignments[0];
      app.innerHTML = `<form data-parent-comments="${assignment.id}">${missionWorksheetTable(missionById(assignment.mission_id), assignment, state.children[0], 'parent')}</form>`;
      bindParentHandlers();
    });
    assert.equal(await page.locator('.mission-comment a').getAttribute('href'), 'https://example.com/lesson');
    await page.locator('[name=parent_comment_0]').fill('Next: https://example.com/next');
    assert.equal(await page.locator('[name=parent_comment_0] + .instruction-link-preview a').getAttribute('href'), 'https://example.com/next');
    console.log('Parent comment video opens on child side; child comment links open on parent side; editing permissions retained');
    console.log('Bare video URLs, editable instruction link previews and actual link opening passed');
    console.log('Full-page mission details, safe clickable URLs, continuing rows, retained progress and independent sibling assignment passed');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
