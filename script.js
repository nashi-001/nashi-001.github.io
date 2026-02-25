// ===== 漢字練習アプリ メインロジック =====
// 依存: kanji_database.js, sentence_pool.js

// ===== 定数 =====
const STORAGE_KEY = 'kanji_practice_data';
const DAILY_PRACTICE_COUNT = 10; // 一回の練習で出す問題数
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// ===== アプリ状態 =====
let state = {
    currentScreen: 'grade-select', // 'grade-select', 'practice', 'stats'
    selectedGrades: [],
    practiceQueue: [],
    currentIndex: 0,
    currentKanji: null,
    currentSentence: null,
    selectedWordKey: null,
    isRevealed: false,
    sessionResults: [],
    isAnimating: false,
    // キャンバス状態
    isDrawing: false,
    lastPos: { x: 0, y: 0 },
    canvasDirty: false
};

// ===== 成績データ管理 =====
// キャッシュ変数
let practiceDataCache = null;

function loadPracticeData(forceReload = false) {
    if (practiceDataCache && !forceReload) return practiceDataCache;
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        if (data) {
            practiceDataCache = JSON.parse(data);
            return practiceDataCache;
        }
    } catch (e) {
        console.error('データ読み込みエラー:', e);
    }
    practiceDataCache = {};
    return practiceDataCache;
}

function savePracticeData(data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        practiceDataCache = data;
    } catch (e) {
        console.error('データ保存エラー:', e);
    }
}

function getKanjiStats(kanji) {
    const data = loadPracticeData();
    if (!data[kanji]) {
        data[kanji] = { history: [] };
    }
    return data[kanji];
}

function recordResult(kanji, result) {
    const data = loadPracticeData();
    if (!data[kanji]) {
        data[kanji] = { history: [] };
    }
    data[kanji].history.push({
        date: Date.now(),
        result: result // 'success' or 'fail'
    });
    savePracticeData(data);
}

// 統計情報の計算
function calculateStats(kanji) {
    const stats = getKanjiStats(kanji);
    const now = Date.now();
    const history = stats.history || [];

    // 直近3日間
    const threeDays = history.filter(h => now - h.date < THREE_DAYS_MS);
    const threeDaySuccess = threeDays.filter(h => h.result === 'success').length;
    const threeDayFail = threeDays.filter(h => h.result === 'fail').length;
    const threeDayTotal = threeDays.length;
    const threeDayRate = threeDayTotal > 0 ? Math.round((threeDaySuccess / threeDayTotal) * 100) : -1;

    // 直近1週間
    const oneWeek = history.filter(h => now - h.date < ONE_WEEK_MS);
    const oneWeekSuccess = oneWeek.filter(h => h.result === 'success').length;
    const oneWeekFail = oneWeek.filter(h => h.result === 'fail').length;
    const oneWeekTotal = oneWeek.length;
    const oneWeekRate = oneWeekTotal > 0 ? Math.round((oneWeekSuccess / oneWeekTotal) * 100) : -1;

    // 全期間
    const allSuccess = history.filter(h => h.result === 'success').length;
    const allFail = history.filter(h => h.result === 'fail').length;
    const allTotal = history.length;
    const allRate = allTotal > 0 ? Math.round((allSuccess / allTotal) * 100) : -1;

    // 最後の結果
    const lastResult = history.length > 0 ? history[history.length - 1].result : null;

    // 連続正解数（最新から遡る）
    let consecutiveSuccesses = 0;
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].result === 'success') {
            consecutiveSuccesses++;
        } else {
            break;
        }
    }

    return {
        threeDay: { success: threeDaySuccess, fail: threeDayFail, total: threeDayTotal, rate: threeDayRate },
        oneWeek: { success: oneWeekSuccess, fail: oneWeekFail, total: oneWeekTotal, rate: oneWeekRate },
        all: { success: allSuccess, fail: allFail, total: allTotal, rate: allRate },
        lastResult: lastResult,
        consecutiveSuccesses: consecutiveSuccesses,
        // 習得判定の厳格化: 週間に正答履歴があり、かつ直近2回以上連続正解しており、直近1週間に誤答がない
        weeklyMastered: oneWeekTotal > 0 && consecutiveSuccesses >= 2 && oneWeekFail === 0
    };
}

// 練習対象の漢字を選択するロジック
function selectPracticeKanji(grades, count) {
    let candidates = [];
    for (const grade of grades) {
        const chars = KANJI_BY_GRADE[grade];
        if (chars) {
            for (const ch of chars) {
                candidates.push(ch);
            }
        }
    }

    // 重複除去
    candidates = [...new Set(candidates)];

    // 各漢字の優先度を計算
    const scored = candidates.map(kanji => {
        const stats = calculateStats(kanji);
        let priority = 50; // ベース優先度

        // --- 優先度計算ルール ---

        // 1. 最近失敗した、または復習が必要 → 最高優先度 (90-95)
        if (stats.lastResult === 'fail') {
            priority = 95;
        } else if (stats.threeDay.fail > 0 && stats.consecutiveSuccesses < 2) {
            // 3日以内に失敗しており、その後の復習（連続正解）が2回未満
            priority = 90;
        }
        // 2. 未学習 → 高優先度 (80)
        else if (stats.all.total === 0) {
            priority = 80;
        }
        // 3. 成績が悪い (70未満) → 中〜高優先度 (70-85)
        else if (stats.threeDay.rate >= 0 && stats.threeDay.rate < 70) {
            priority = Math.max(priority, 85);
        } else if (stats.oneWeek.rate >= 0 && stats.oneWeek.rate < 70) {
            priority = Math.max(priority, 70);
        }
        // 4. 習得済み → 低優先度 (5)
        else if (stats.weeklyMastered) {
            priority = 5;
        }

        return { kanji, priority, stats };
    });

    // 優先度で並べ替え（高い順）、同じ優先度ならランダム
    scored.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return Math.random() - 0.5;
    });

    // 上位 count 個を返す（ただし全てmasteredの場合はランダムに出す）
    const nonMastered = scored.filter(s => !s.stats.weeklyMastered);
    if (nonMastered.length >= count) {
        return nonMastered.slice(0, count).map(s => s.kanji);
    } else if (nonMastered.length > 0) {
        // 足りない分はmasteredからランダムに追加
        const mastered = scored.filter(s => s.stats.weeklyMastered);
        const shuffled = mastered.sort(() => Math.random() - 0.5);
        return [...nonMastered, ...shuffled.slice(0, count - nonMastered.length)].map(s => s.kanji);
    } else {
        // 全部マスターしている場合 → ランダムに出す
        const shuffled = scored.sort(() => Math.random() - 0.5);
        return shuffled.slice(0, count).map(s => s.kanji);
    }
}

// ===== 画面管理 =====
function showScreen(screen) {
    state.currentScreen = screen;
    document.getElementById('grade-select-screen').classList.toggle('hidden', screen !== 'grade-select');
    document.getElementById('practice-screen').classList.toggle('hidden', screen !== 'practice');
    document.getElementById('stats-screen').classList.toggle('hidden', screen !== 'stats');
    document.getElementById('complete-screen').classList.toggle('hidden', true);
}

// ===== 学年選択画面 =====
function initGradeSelect() {
    const container = document.getElementById('grade-buttons');
    container.innerHTML = '';

    for (const grade of GRADE_NAMES) {
        const count = KANJI_BY_GRADE[grade] ? [...new Set(KANJI_BY_GRADE[grade])].length : 0;
        const btn = document.createElement('button');
        btn.className = 'grade-btn';
        btn.id = `grade-${grade}`;
        btn.innerHTML = `
            <span class="grade-name">${grade}</span>
            <span class="grade-count">${count}字</span>
            <span class="grade-status">${getGradeMasteryText(grade)}</span>
        `;
        btn.onclick = (e) => {
            e.stopPropagation();
            toggleGrade(grade, btn);
        };
        container.appendChild(btn);
    }
}

function getGradeMasteryText(grade) {
    const chars = KANJI_BY_GRADE[grade];
    if (!chars) return '';
    const uniqueChars = [...new Set(chars)];
    let mastered = 0;
    for (const ch of uniqueChars) {
        const stats = calculateStats(ch);
        if (stats.weeklyMastered) mastered++;
    }
    if (mastered === 0) return '';
    const percentage = Math.round((mastered / uniqueChars.length) * 100);
    return `習得: ${percentage}%`;
}

function toggleGrade(grade, btn) {
    const idx = state.selectedGrades.indexOf(grade);
    if (idx >= 0) {
        state.selectedGrades.splice(idx, 1);
        btn.classList.remove('selected');
    } else {
        state.selectedGrades.push(grade);
        btn.classList.add('selected');
    }
    updateStartButton();
}

function updateStartButton() {
    const btn = document.getElementById('start-btn');
    const count = state.selectedGrades.length;
    if (count > 0) {
        let totalKanji = 0;
        for (const g of state.selectedGrades) {
            totalKanji += [...new Set(KANJI_BY_GRADE[g] || '')].length;
        }
        btn.textContent = `練習開始（${totalKanji}字から出題）`;
        btn.disabled = false;
    } else {
        btn.textContent = '学年を選択してください';
        btn.disabled = true;
    }
}

function startPractice() {
    if (state.selectedGrades.length === 0) return;

    const kanjiList = selectPracticeKanji(state.selectedGrades, DAILY_PRACTICE_COUNT);
    state.practiceQueue = kanjiList;
    state.currentIndex = 0;
    state.sessionResults = [];
    state.isAnimating = false;

    showScreen('practice');
    loadCurrentQuestion();
    initCanvas();
}

// ===== 練習画面 =====
function loadCurrentQuestion() {
    if (state.currentIndex >= state.practiceQueue.length) {
        showComplete();
        return;
    }

    const kanji = state.practiceQueue[state.currentIndex];
    state.currentKanji = kanji;
    state.isRevealed = false;

    // 例文を取得
    const sentence = getRandomSentenceForKanji(kanji);
    state.currentSentence = sentence;

    // この漢字を含む熟語/単語を見つける
    const wordKeys = Object.keys(sentence.words).filter(w => w.includes(kanji));
    state.selectedWordKey = wordKeys.length > 0 ? wordKeys[0] : kanji;

    updateProgressBar();
    renderSentence();
    renderKanjiInfo();
    clearCanvas();
}

function renderSentence() {
    const display = document.getElementById('sentence-display');
    const sentence = state.currentSentence;
    const targetWord = state.selectedWordKey;
    const reading = sentence.words[targetWord] || '';

    let text = sentence.text;
    let html = '';

    // 対象の漢字語を見つけてマーキング
    const pos = text.indexOf(targetWord);
    if (pos >= 0) {
        const before = text.substring(0, pos);
        const after = text.substring(pos + targetWord.length);
        const displayText = state.isRevealed ? targetWord : reading;
        const revealedClass = state.isRevealed ? ' revealed' : '';

        html = escapeHtml(before) +
            `<span class="kanji-target${revealedClass}" data-kanji="${escapeHtml(targetWord)}" data-reading="${escapeHtml(reading)}">${escapeHtml(displayText)}</span>` +
            escapeHtml(after);
    } else {
        // 見つからない場合はそのまま表示
        html = escapeHtml(text);
    }

    display.innerHTML = html;
}

function renderKanjiInfo() {
    const kanji = state.currentKanji;
    const grade = KANJI_TO_GRADE[kanji] || '不明';
    const stats = calculateStats(kanji);

    const infoEl = document.getElementById('kanji-info');
    infoEl.innerHTML = `
        <span class="info-grade">${grade}</span>
        <span class="info-kanji">${kanji}</span>
        ${stats.all.total > 0 ? `<span class="info-rate">${stats.all.rate}%</span>` : '<span class="info-rate new">NEW</span>'}
    `;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ===== タップで切り替え =====
function handleToggle(e) {
    if (state.currentScreen !== 'practice') return;
    if (e.target.closest('#button-area') || e.target.closest('.modal') || e.target.closest('#top-bar')) {
        return;
    }

    state.isRevealed = !state.isRevealed;
    renderSentence();

    const target = document.querySelector('.kanji-target');
    if (target) {
        target.classList.add('pulse');
        setTimeout(() => target.classList.remove('pulse'), 400);
    }
}

// ===== キャンバス（手書き）ロジック =====
function initCanvas() {
    const canvas = document.getElementById('practice-canvas');
    const container = document.getElementById('canvas-container');
    if (!canvas) return;

    // 高解像度対応
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();

    // サイズが変わった場合のみ再設定
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
    }

    const ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 14; // 少し太くする
    ctx.strokeStyle = '#d4a959'; // var(--accent-gold)

    // イベント登録（重複登録防止のため、一旦削除するか確認）
    canvas.removeEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousedown', startDrawing);
    canvas.removeEventListener('mousemove', draw);
    canvas.addEventListener('mousemove', draw);
    canvas.removeEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.removeEventListener('mouseleave', stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing);

    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent('mousedown', {
            clientX: touch.clientX,
            clientY: touch.clientY
        });
        canvas.dispatchEvent(mouseEvent);
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent('mousemove', {
            clientX: touch.clientX,
            clientY: touch.clientY
        });
        canvas.dispatchEvent(mouseEvent);
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        const mouseEvent = new MouseEvent('mouseup', {});
        canvas.dispatchEvent(mouseEvent);
    }, { passive: false });
}

function getMousePos(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
}

function startDrawing(e) {
    state.isDrawing = true;
    state.lastPos = getMousePos(e.target, e);
    state.canvasDirty = true;
    document.getElementById('canvas-container').classList.add('drawing');
}

function draw(e) {
    if (!state.isDrawing) return;
    const canvas = e.target;
    const ctx = canvas.getContext('2d');
    const pos = getMousePos(canvas, e);

    ctx.beginPath();
    ctx.moveTo(state.lastPos.x, state.lastPos.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();

    state.lastPos = pos;
}

function stopDrawing() {
    state.isDrawing = false;
}

function clearCanvas() {
    const canvas = document.getElementById('practice-canvas');
    const container = document.getElementById('canvas-container');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    // transformをリセットしてからクリア
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    state.canvasDirty = false;
    container.classList.remove('drawing');
}

// ===== 結果処理 =====
function handleResult(type) {
    if (state.isAnimating) return;
    state.isAnimating = true;

    const kanji = state.currentKanji;
    recordResult(kanji, type);
    state.sessionResults.push({ kanji, result: type });

    showFeedback(type);

    setTimeout(() => {
        const display = document.getElementById('sentence-display');
        const canvasContainer = document.getElementById('canvas-container');

        display.classList.add('slide-out-left');
        canvasContainer.classList.add('slide-out-left');

        setTimeout(() => {
            state.currentIndex++;
            display.classList.remove('slide-out-left');
            canvasContainer.classList.remove('slide-out-left');

            display.classList.add('slide-in-right');
            canvasContainer.classList.add('slide-in-right');

            loadCurrentQuestion();

            setTimeout(() => {
                display.classList.remove('slide-in-right');
                canvasContainer.classList.remove('slide-in-right');
                state.isAnimating = false;
            }, 250); // 350 -> 250
        }, 250); // 350 -> 250
    }, 400); // 500 -> 400
}

function showFeedback(type) {
    const overlay = document.createElement('div');
    overlay.className = `feedback-overlay ${type}-feedback`;
    const icon = document.createElement('span');
    icon.className = 'feedback-icon';
    icon.textContent = type === 'success' ? '○' : '✕';
    overlay.appendChild(icon);
    document.body.appendChild(overlay);
    setTimeout(() => overlay.remove(), 800);
}

// ===== プログレスバー =====
function updateProgressBar() {
    const total = state.practiceQueue.length;
    const current = state.currentIndex;
    const percentage = (current / total) * 100;

    document.getElementById('progress-bar').style.width = percentage + '%';
    document.getElementById('progress-text').textContent = `${current} / ${total}`;
}

// ===== 漢字選択モーダル =====
function openSelector() {
    const sentence = state.currentSentence;
    const modal = document.getElementById('selector-modal');
    const optionsContainer = document.getElementById('kanji-options');

    optionsContainer.innerHTML = '';

    const wordKeys = Object.keys(sentence.words);
    for (const word of wordKeys) {
        const btn = document.createElement('button');
        btn.className = 'kanji-option' + (word === state.selectedWordKey ? ' selected' : '');
        btn.textContent = word;
        btn.onclick = (e) => {
            e.stopPropagation();
            state.selectedWordKey = word;
            state.isRevealed = false;
            renderSentence();
            closeSelector();
        };
        optionsContainer.appendChild(btn);
    }

    modal.classList.remove('hidden');
}

function closeSelector() {
    document.getElementById('selector-modal').classList.add('hidden');
}

// ===== 完了画面 =====
function showComplete() {
    const results = state.sessionResults;
    const successCount = results.filter(r => r.result === 'success').length;
    const failCount = results.filter(r => r.result === 'fail').length;
    const total = results.length;

    const summary = document.getElementById('result-summary');
    let kanjiDetails = results.map(r => {
        const icon = r.result === 'success' ? '○' : '✕';
        const cls = r.result === 'success' ? 'success-mark' : 'fail-mark';
        return `<span class="${cls}">${icon} ${r.kanji}</span>`;
    }).join(' ');

    summary.innerHTML = `
        <p>全 ${total} 問中</p>
        <span class="stat success-stat">成功: ${successCount}</span>
        <span class="stat fail-stat">失敗: ${failCount}</span>
        <p style="margin-top: 8px; font-size: 0.85rem;">正答率: ${total > 0 ? Math.round((successCount / total) * 100) : 0}%</p>
        <div class="kanji-results">${kanjiDetails}</div>
    `;

    document.getElementById('complete-screen').classList.remove('hidden');
    document.getElementById('progress-bar').style.width = '100%';
    document.getElementById('progress-text').textContent = `${total} / ${total}`;
}

function restartPractice() {
    document.getElementById('complete-screen').classList.add('hidden');
    startPractice();
}

function backToGradeSelect() {
    document.getElementById('complete-screen').classList.add('hidden');
    showScreen('grade-select');
    initGradeSelect(); // 習得率を更新
    updateStartButton();
}

// ===== 統計画面 =====
function showStatsScreen() {
    showScreen('stats');
    renderStats();
}

function renderStats() {
    const container = document.getElementById('stats-content');
    const data = loadPracticeData();

    // 選択された学年のフィルタ
    const grades = state.selectedGrades.length > 0 ? state.selectedGrades : GRADE_NAMES;

    let html = '<div class="stats-grade-tabs">';
    for (const grade of grades) {
        html += `<button class="stats-tab" onclick="event.stopPropagation(); renderStatsForGrade('${grade}')">${grade}</button>`;
    }
    html += '</div>';
    html += '<div id="stats-grade-content"></div>';

    container.innerHTML = html;

    // 最初の学年を表示
    if (grades.length > 0) {
        renderStatsForGrade(grades[0]);
    }
}

function renderStatsForGrade(grade) {
    const container = document.getElementById('stats-grade-content');
    const chars = KANJI_BY_GRADE[grade];
    if (!chars) {
        container.innerHTML = '<p>データがありません</p>';
        return;
    }

    const uniqueChars = [...new Set(chars)];
    let html = '<div class="stats-grid">';

    // タブをハイライト
    document.querySelectorAll('.stats-tab').forEach(tab => {
        tab.classList.toggle('active', tab.textContent === grade);
    });

    // 統計サマリー
    let mastered = 0, practiced = 0, unpracticed = 0;
    for (const ch of uniqueChars) {
        const stats = calculateStats(ch);
        if (stats.weeklyMastered) mastered++;
        else if (stats.all.total > 0) practiced++;
        else unpracticed++;
    }

    html = `
        <div class="stats-summary">
            <div class="summary-item mastered"><span class="summary-num">${mastered}</span><span class="summary-label">習得済</span></div>
            <div class="summary-item practiced"><span class="summary-num">${practiced}</span><span class="summary-label">練習中</span></div>
            <div class="summary-item unpracticed"><span class="summary-num">${unpracticed}</span><span class="summary-label">未学習</span></div>
        </div>
        <div class="stats-grid">
    `;

    for (const ch of uniqueChars) {
        const stats = calculateStats(ch);
        let statusClass = 'unpracticed';
        let rateText = '—';

        if (stats.weeklyMastered) {
            statusClass = 'mastered';
            rateText = `${stats.all.rate}%`;
        } else if (stats.all.total > 0) {
            statusClass = stats.all.rate >= 70 ? 'good' : 'weak';
            rateText = `${stats.all.rate}%`;
        }

        html += `
            <div class="stats-kanji-item ${statusClass}" title="3日: ${stats.threeDay.rate >= 0 ? stats.threeDay.rate + '%' : '—'} / 週: ${stats.oneWeek.rate >= 0 ? stats.oneWeek.rate + '%' : '—'} / 全体: ${stats.all.rate >= 0 ? stats.all.rate + '%' : '—'}">
                <span class="stats-char">${ch}</span>
                <span class="stats-rate">${rateText}</span>
            </div>
        `;
    }

    html += '</div>';
    container.innerHTML = html;
}

function backToGradeSelectFromStats() {
    showScreen('grade-select');
}

// ===== 戻るボタン =====
function goBack() {
    if (state.currentScreen === 'practice') {
        if (confirm('練習を中断しますか？')) {
            showScreen('grade-select');
            initGradeSelect();
            updateStartButton();
        }
    } else if (state.currentScreen === 'stats') {
        showScreen('grade-select');
    }
}

// ===== 初期化 =====
function init() {
    showScreen('grade-select');
    initGradeSelect();
    updateStartButton();

    // グローバルクリックイベント
    document.addEventListener('click', handleToggle);
}

document.addEventListener('DOMContentLoaded', init);
