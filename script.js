/* ============================================
   TIMES TABLE TURBO — Game Logic
   ============================================ */

(() => {
  'use strict';

  // ---- Constants ----
  const TOTAL_QUESTIONS = 15;
  const MAX_DIGITS = 3; // max 144
  const STORAGE_KEY = 'timesTableTurboStats';
  const EMA_ALPHA = 0.3; // exponential moving average weight

  // ---- DOM refs ----
  const $startScreen = document.getElementById('start-screen');
  const $gameScreen = document.getElementById('game-screen');
  const $resultsScreen = document.getElementById('results-screen');
  const $progress = document.getElementById('progress');
  const $question = document.getElementById('question');
  const $answerDisplay = document.getElementById('answer-display');
  const $feedbackOverlay = document.getElementById('feedback-overlay');
  const $feedbackIcon = document.getElementById('feedback-icon');
  const $feedbackText = document.getElementById('feedback-text');
  const $statsModal = document.getElementById('stats-modal');
  const $statsGrid = document.getElementById('stats-grid');
  const $resultsTitle = document.getElementById('results-title');
  const $resultsScore = document.getElementById('results-score');
  const $resultsDetails = document.getElementById('results-details');

  // ---- Game state ----
  let questions = [];
  let currentIndex = 0;
  let currentAnswer = '';
  let questionStartTime = 0;
  let roundResults = [];  // { a, b, correct, userAnswer, timeTaken }
  let feedbackTimeout = null;
  let isShowingFeedback = false;

  // =============================================
  //  STATS / LOCALSTORAGE
  // =============================================

  function loadStats() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) { /* corrupted – start fresh */ }
    return {};
  }

  function saveStats(stats) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  }

  function statKey(a, b) {
    return `${a}_${b}`;
  }

  /**
   * Compute a confidence score (0–100) for a single attempt.
   * - Accuracy: correct = 100, incorrect = 0   (70 % weight)
   * - Speed:    0-2 s = 100 … 2-8 s linear … >8 s = 0   (30 % weight)
   */
  function computeScore(correct, timeSec) {
    const accScore = correct ? 100 : 0;

    let speedScore;
    if (timeSec <= 2) speedScore = 100;
    else if (timeSec >= 8) speedScore = 0;
    else speedScore = 100 - ((timeSec - 2) / 6) * 100;

    return accScore * 0.7 + speedScore * 0.3;
  }

  function updateStats(a, b, correct, timeSec) {
    const stats = loadStats();
    const key = statKey(a, b);
    const newScore = computeScore(correct, timeSec);

    if (stats[key]) {
      // Exponential moving average
      stats[key].confidence =
        stats[key].confidence * (1 - EMA_ALPHA) + newScore * EMA_ALPHA;
      stats[key].attempts += 1;
    } else {
      stats[key] = { confidence: newScore, attempts: 1 };
    }

    saveStats(stats);
  }

  // =============================================
  //  QUESTION GENERATION
  // =============================================

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function generateQuestions(table) {
    const qs = [];

    if (table === 'mixed') {
      // Pick 15 random from the full 12×12 pool
      while (qs.length < TOTAL_QUESTIONS) {
        const a = Math.floor(Math.random() * 12) + 1;
        const b = Math.floor(Math.random() * 12) + 1;
        qs.push({ a, b });
      }
    } else {
      const n = parseInt(table, 10);
      // All 12 unique questions for this table, shuffled
      const pool = [];
      for (let i = 1; i <= 12; i++) pool.push({ a: n, b: i });
      shuffle(pool);
      // Take 12 unique + 3 random repeats
      for (let i = 0; i < TOTAL_QUESTIONS; i++) {
        qs.push(pool[i % pool.length]);
      }
      shuffle(qs);
    }

    // Randomly swap factor order for display
    return qs.map(q => {
      if (Math.random() < 0.5) return { a: q.b, b: q.a, answer: q.a * q.b };
      return { ...q, answer: q.a * q.b };
    });
  }

  // =============================================
  //  SCREEN MANAGEMENT
  // =============================================

  function showScreen(screen) {
    [$startScreen, $gameScreen, $resultsScreen].forEach(s =>
      s.classList.remove('active')
    );
    screen.classList.add('active');
  }

  // =============================================
  //  GAME FLOW
  // =============================================

  function startGame(table) {
    questions = generateQuestions(table);
    currentIndex = 0;
    roundResults = [];
    currentAnswer = '';
    showScreen($gameScreen);
    showQuestion();
  }

  function showQuestion() {
    const q = questions[currentIndex];
    $question.textContent = `${q.a} × ${q.b} =`;
    $answerDisplay.textContent = '\u00A0'; // nbsp
    $answerDisplay.classList.remove('flash-correct', 'flash-incorrect');
    $progress.textContent = `${currentIndex + 1} / ${TOTAL_QUESTIONS}`;
    currentAnswer = '';
    questionStartTime = performance.now();
  }

  function submitAnswer() {
    if (currentAnswer === '' || isShowingFeedback) return;

    const q = questions[currentIndex];
    const userAnswer = parseInt(currentAnswer, 10);
    const correct = userAnswer === q.answer;
    const timeSec = (performance.now() - questionStartTime) / 1000;

    roundResults.push({
      a: q.a, b: q.b,
      correct,
      userAnswer,
      expected: q.answer,
      timeTaken: timeSec
    });

    // Update stats
    updateStats(q.a, q.b, correct, timeSec);

    // Show feedback
    showFeedback(correct, q.answer);
  }

  function showFeedback(correct, correctAnswer) {
    isShowingFeedback = true;
    $feedbackOverlay.className = 'feedback-overlay show ' + (correct ? 'correct' : 'incorrect');
    $feedbackIcon.textContent = correct ? '✓' : '✗';
    $feedbackText.textContent = correct ? 'Nice!' : `Answer: ${correctAnswer}`;

    $answerDisplay.classList.add(correct ? 'flash-correct' : 'flash-incorrect');

    feedbackTimeout = setTimeout(() => {
      $feedbackOverlay.className = 'feedback-overlay';
      isShowingFeedback = false;
      currentIndex++;
      if (currentIndex >= TOTAL_QUESTIONS) {
        showResults();
      } else {
        showQuestion();
      }
    }, correct ? 800 : 1500);
  }

  // =============================================
  //  RESULTS
  // =============================================

  function showResults() {
    const correctCount = roundResults.filter(r => r.correct).length;
    $resultsTitle.textContent =
      correctCount === TOTAL_QUESTIONS ? '🌟 Perfect Round!' :
        correctCount >= 12 ? '🎉 Amazing!' :
          correctCount >= 8 ? '👏 Great Job!' : '💪 Keep Practising!';

    $resultsScore.textContent = `${correctCount} / ${TOTAL_QUESTIONS}`;

    // Build detail lines for incorrect answers
    const wrongOnes = roundResults.filter(r => !r.correct);
    if (wrongOnes.length === 0) {
      $resultsDetails.textContent = 'You got every question right!';
    } else {
      $resultsDetails.innerHTML = wrongOnes.map(r =>
        `${r.a} × ${r.b} = <strong>${r.expected}</strong> <span style="color:var(--text-dim)">(you said ${r.userAnswer})</span>`
      ).join('<br>');
    }

    showScreen($resultsScreen);
  }

  // =============================================
  //  STATS GRID RENDERING
  // =============================================

  function confidenceColor(value) {
    // value 0-100 → red(0) → yellow(50) → green(100)
    if (value <= 50) {
      // red to yellow
      const t = value / 50;
      const r = Math.round(239 + (234 - 239) * t);
      const g = Math.round(68 + (179 - 68) * t);
      const b = Math.round(68 + (8 - 68) * t);
      return `rgb(${r},${g},${b})`;
    } else {
      // yellow to green
      const t = (value - 50) / 50;
      const r = Math.round(234 + (34 - 234) * t);
      const g = Math.round(179 + (197 - 179) * t);
      const b = Math.round(8 + (94 - 8) * t);
      return `rgb(${r},${g},${b})`;
    }
  }

  function renderStatsGrid() {
    const stats = loadStats();
    let html = '<tr><th class="corner">×</th>';
    for (let c = 1; c <= 12; c++) html += `<th>${c}</th>`;
    html += '</tr>';

    let hasAnyScore = false;

    for (let r = 1; r <= 12; r++) {
      html += `<tr><th>${r}</th>`;
      for (let c = 1; c <= 12; c++) {
        const key = statKey(r, c);
        const s = stats[key];
        if (s && s.attempts >= 5) {
          hasAnyScore = true;
          const val = Math.round(s.confidence);
          const bg = confidenceColor(val);
          const textColor = val > 55 ? '#111' : '#fff';
          html += `<td style="background:${bg};color:${textColor}" title="${r}×${c}: ${val}% (${s.attempts} attempts)">${val}</td>`;
        } else {
          const tip = s ? `${r}×${c}: ${s.attempts}/5 attempts` : `${r}×${c}: no data`;
          html += `<td style="background:#333;color:#777" title="${tip}">–</td>`;
        }
      }
      html += '</tr>';
    }

    $statsGrid.innerHTML = html;

    const $emptyMsg = document.getElementById('grid-empty-msg');
    $emptyMsg.classList.toggle('visible', !hasAnyScore);
  }

  function openStats() {
    renderStatsGrid();
    $statsModal.classList.add('open');
  }

  function closeStats() {
    $statsModal.classList.remove('open');
  }

  // =============================================
  //  NUMPAD INPUT
  // =============================================

  function pressDigit(digit) {
    if (isShowingFeedback) return;
    if (currentAnswer.length >= MAX_DIGITS) return;
    currentAnswer += digit;
    $answerDisplay.textContent = currentAnswer;
  }

  function pressBackspace() {
    if (isShowingFeedback) return;
    currentAnswer = currentAnswer.slice(0, -1);
    $answerDisplay.textContent = currentAnswer || '\u00A0';
  }

  // =============================================
  //  EVENT LISTENERS
  // =============================================

  // Table select buttons
  document.querySelectorAll('.table-btn, .mixed-btn').forEach(btn => {
    btn.addEventListener('click', () => startGame(btn.dataset.table));
  });

  // Numpad buttons
  document.querySelectorAll('.num-btn[data-num]').forEach(btn => {
    btn.addEventListener('click', () => pressDigit(btn.dataset.num));
  });

  document.querySelector('[data-action="backspace"]')
    .addEventListener('click', pressBackspace);

  document.querySelector('[data-action="enter"]')
    .addEventListener('click', submitAnswer);

  // Keyboard support
  document.addEventListener('keydown', e => {
    if (!$gameScreen.classList.contains('active')) return;
    if (e.key >= '0' && e.key <= '9') pressDigit(e.key);
    else if (e.key === 'Backspace') pressBackspace();
    else if (e.key === 'Enter') submitAnswer();
  });

  // Back button
  document.getElementById('back-btn').addEventListener('click', () => {
    clearTimeout(feedbackTimeout);
    isShowingFeedback = false;
    $feedbackOverlay.className = 'feedback-overlay';
    showScreen($startScreen);
  });

  // Stats open / close
  document.getElementById('open-stats-btn').addEventListener('click', openStats);
  document.getElementById('results-stats-btn').addEventListener('click', openStats);
  document.getElementById('close-stats-btn').addEventListener('click', closeStats);
  $statsModal.addEventListener('click', e => {
    if (e.target === $statsModal) closeStats();
  });

  // Play again
  document.getElementById('play-again-btn').addEventListener('click', () => {
    showScreen($startScreen);
  });

})();
