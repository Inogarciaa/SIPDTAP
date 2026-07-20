/* =========================================================
   iTAPTAP MO — script.js
   Vanilla JS game logic. No frameworks.
   Sections:
     1. Constants & State
     2. LocalStorage helpers (leaderboard + stats)
     3. Sound engine (Web Audio API, no external files)
     4. Screen navigation helpers
     5. Countdown sequence
     6. Core gameplay (tap, timer, combo)
     7. Game over / save score / leaderboard render
     8. Stats + achievements render
     9. Confetti effect
    10. Event listeners / init
   ========================================================= */

/* ---------------- 1. CONSTANTS & STATE ---------------- */
const GAME_DURATION = 30; // seconds
const LB_KEY = 'neonTap_leaderboard';
const STATS_KEY = 'neonTap_stats';
const MAX_LEADERBOARD_ROWS = 10;

let state = {
    score: 0,
    timeLeft: GAME_DURATION,
    rawTaps: 0,           // total taps this game (for combo + achievements)
    multiplierRemaining: 0, // taps left that count double
    timerId: null,
    countdownId: null,
    isPaused: false,
    isMuted: false,
    gameActive: false,
    lastEntryStamp: null,  // used to highlight the newest leaderboard row
};

/* ---------------- 2. LOCALSTORAGE HELPERS ---------------- */

// Leaderboard: array of { name, score, date, stamp }
function getLeaderboard() {
    try {
        const raw = localStorage.getItem(LB_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function saveLeaderboard(list) {
    localStorage.setItem(LB_KEY, JSON.stringify(list));
}

function addToLeaderboard(name, score) {
    const list = getLeaderboard();
    const stamp = Date.now();
    list.push({
        name: name || 'Anonymous',
        score,
        date: new Date(stamp).toLocaleDateString(),
        stamp,
    });
    // Sort descending by score, keep top 10
    list.sort((a, b) => b.score - a.score);
    const trimmed = list.slice(0, MAX_LEADERBOARD_ROWS);
    saveLeaderboard(trimmed);
    state.lastEntryStamp = stamp;
    return trimmed;
}

// Stats: { gamesPlayed, totalScore, highestScore, totalTaps, achievements:{beginner,fast,master} }
function getStats() {
    try {
        const raw = localStorage.getItem(STATS_KEY);
        return raw ? JSON.parse(raw) : {
            gamesPlayed: 0,
            totalScore: 0,
            highestScore: 0,
            totalTaps: 0,
            achievements: { beginner: false, fast: false, master: false },
        };
    } catch (e) {
        return { gamesPlayed: 0, totalScore: 0, highestScore: 0, totalTaps: 0, achievements: {} };
    }
}

function saveStats(stats) {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

// Called once per completed game with the final score of that game
function updateStatsAfterGame(finalScore) {
    const stats = getStats();
    stats.gamesPlayed += 1;
    stats.totalScore += finalScore;
    stats.totalTaps += finalScore; // 1 tap ~= 1 point baseline; taps recorded separately below
    if (finalScore > stats.highestScore) stats.highestScore = finalScore;

    // Achievements are based on the score achieved in a single game
    if (finalScore >= 50) stats.achievements.beginner = true;
    if (finalScore >= 100) stats.achievements.fast = true;
    if (finalScore >= 200) stats.achievements.master = true;

    saveStats(stats);
    return stats;
}

/* ---------------- 3. SOUND ENGINE (Web Audio API) ---------------- */
let audioCtx = null;
function ensureAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

// Generic oscillator beep generator
function playTone(freq, duration, type = 'sine', volume = 0.15) {
    if (state.isMuted) return;
    ensureAudio();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.start(now);
    osc.stop(now + duration);
}

function playTapSound() {
    playTone(720 + Math.random() * 80, 0.08, 'square', 0.08);
}
function playCountdownBeep() {
    playTone(440, 0.15, 'triangle', 0.18);
}
function playGoSound() {
    playTone(880, 0.3, 'triangle', 0.2);
}
function playGameOverSound() {
    if (state.isMuted) return;
    ensureAudio();
    // Descending three-note sting
    [520, 400, 260].forEach((f, i) => {
        setTimeout(() => playTone(f, 0.35, 'sawtooth', 0.12), i * 180);
    });
}
function playHighScoreSound() {
    if (state.isMuted) return;
    [500, 650, 800, 1000].forEach((f, i) => {
        setTimeout(() => playTone(f, 0.2, 'triangle', 0.16), i * 100);
    });
}

/* ---------------- 4. SCREEN NAVIGATION ---------------- */
const screens = {
    home: document.getElementById('homeScreen'),
    countdown: document.getElementById('countdownScreen'),
    game: document.getElementById('gameScreen'),
    gameover: document.getElementById('gameOverScreen'),
};

function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('screen--active'));
    screens[name].classList.add('screen--active');
}

/* ---------------- 5. COUNTDOWN SEQUENCE ---------------- */
function startCountdown() {
    showScreen('countdown');
    const numberEl = document.getElementById('countdownNumber');
    const sequence = ['3', '2', '1', 'GO!'];
    let i = 0;

    numberEl.textContent = sequence[i];
    playCountdownBeep();
    restartPopAnimation(numberEl);

    state.countdownId = setInterval(() => {
        i++;
        if (i < sequence.length) {
            numberEl.textContent = sequence[i];
            restartPopAnimation(numberEl);
            if (sequence[i] === 'GO!') {
                playGoSound();
            } else {
                playCountdownBeep();
            }
        } else {
            clearInterval(state.countdownId);
            beginGame();
        }
    }, 800);
}

function restartPopAnimation(el) {
    el.style.animation = 'none';
    // eslint-disable-next-line no-unused-expressions
    el.offsetHeight; // force reflow to restart animation
    el.style.animation = '';
}

/* ---------------- 6. CORE GAMEPLAY ---------------- */
function beginGame() {
    // Reset per-game state
    state.score = 0;
    state.timeLeft = GAME_DURATION;
    state.rawTaps = 0;
    state.multiplierRemaining = 0;
    state.isPaused = false;
    state.gameActive = true;

    const stats = getStats();
    document.getElementById('scoreDisplay').textContent = '0';
    document.getElementById('timeDisplay').textContent = String(GAME_DURATION);
    document.getElementById('bestDisplay').textContent = String(stats.highestScore);

    const tapBtn = document.getElementById('tapBtn');
    tapBtn.disabled = false;

    const progressBar = document.getElementById('progressBar');
    progressBar.style.width = '100%';
    progressBar.classList.remove('time-yellow', 'time-red');

    const timeDisplayEl = document.getElementById('timeDisplay');
    timeDisplayEl.classList.remove('time-yellow', 'time-red');

    document.getElementById('comboBanner').classList.remove('show');
    document.getElementById('pauseOverlay').classList.add('hidden');

    showScreen('game');

    state.timerId = setInterval(tickTimer, 1000);
}

function tickTimer() {
    if (state.isPaused) return;
    state.timeLeft -= 1;

    const timeDisplayEl = document.getElementById('timeDisplay');
    const progressBar = document.getElementById('progressBar');

    timeDisplayEl.textContent = String(state.timeLeft);
    progressBar.style.width = `${(state.timeLeft / GAME_DURATION) * 100}%`;

    // Color-coded countdown zones
    timeDisplayEl.classList.remove('time-yellow', 'time-red');
    progressBar.classList.remove('time-yellow', 'time-red');
    if (state.timeLeft <= 9) {
        timeDisplayEl.classList.add('time-red');
        progressBar.classList.add('time-red');
    } else if (state.timeLeft <= 19) {
        timeDisplayEl.classList.add('time-yellow');
        progressBar.classList.add('time-yellow');
    }

    if (state.timeLeft <= 0) {
        endGame();
    }
}

function handleTap(clientX, clientY) {
    if (!state.gameActive || state.isPaused) return;

    playTapSound();

    state.rawTaps += 1;
    let points = 1;
    let isComboTap = false;

    if (state.multiplierRemaining > 0) {
        points = 2;
        isComboTap = true;
        state.multiplierRemaining -= 1;
    }

    state.score += points;

    // Trigger a new x2 combo window every 20 taps
    if (state.rawTaps % 20 === 0) {
        state.multiplierRemaining = 5;
        showComboBanner();
    }

    const scoreEl = document.getElementById('scoreDisplay');
    scoreEl.textContent = String(state.score);
    scoreEl.classList.remove('bump');
    // eslint-disable-next-line no-unused-expressions
    scoreEl.offsetWidth;
    scoreEl.classList.add('bump');

    const tapBtn = document.getElementById('tapBtn');
    tapBtn.classList.remove('bounce');
    // eslint-disable-next-line no-unused-expressions
    tapBtn.offsetWidth;
    tapBtn.classList.add('bounce');

    spawnFloatingScore(points, isComboTap, clientX, clientY);
    spawnParticles(clientX, clientY);
}

function showComboBanner() {
    const banner = document.getElementById('comboBanner');
    banner.classList.add('show');
    setTimeout(() => banner.classList.remove('show'), 1600);
}

function spawnFloatingScore(points, isCombo, clientX, clientY) {
    const layer = document.getElementById('floatLayer');
    const rect = layer.getBoundingClientRect();
    const x = (clientX ?? rect.left + rect.width / 2) - rect.left;
    const y = (clientY ?? rect.top + rect.height / 2) - rect.top;

    const el = document.createElement('span');
    el.className = 'float-text' + (isCombo ? ' combo' : '');
    el.textContent = `+${points}`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 950);
}

function spawnParticles(clientX, clientY) {
    const layer = document.getElementById('particleLayer');
    const rect = layer.getBoundingClientRect();
    const x = (clientX ?? rect.left + rect.width / 2) - rect.left;
    const y = (clientY ?? rect.top + rect.height / 2) - rect.top;
    const colors = ['#00d9ff', '#0055ff', '#39ff8c', '#ffe066'];

    for (let i = 0; i < 8; i++) {
        const p = document.createElement('span');
        p.className = 'particle';
        const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.5;
        const dist = 40 + Math.random() * 30;
        p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
        p.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
        p.style.left = `${x}px`;
        p.style.top = `${y}px`;
        p.style.background = colors[i % colors.length];
        layer.appendChild(p);
        setTimeout(() => p.remove(), 650);
    }
}

/* Pause / Resume */
function pauseGame() {
    if (!state.gameActive) return;
    state.isPaused = true;
    document.getElementById('pauseOverlay').classList.remove('hidden');
}
function resumeGame() {
    state.isPaused = false;
    document.getElementById('pauseOverlay').classList.add('hidden');
}

/* ---------------- 7. GAME OVER / SAVE SCORE ---------------- */
function endGame() {
    state.gameActive = false;
    clearInterval(state.timerId);
    document.getElementById('tapBtn').disabled = true;
    playGameOverSound();

    const previousBest = getStats().highestScore;
    const stats = updateStatsAfterGame(state.score);
    const isNewRecord = state.score > 0 && state.score > previousBest;

    document.getElementById('finalScore').textContent = String(state.score);
    const tag = document.getElementById('newRecordTag');
    const nameEntry = document.getElementById('nameEntry');
    const playAgainBtn = document.getElementById('playAgainBtn');

    nameEntry.classList.remove('hidden');
    playAgainBtn.classList.add('hidden');
    document.getElementById('playerName').value = '';

    if (isNewRecord && state.score > 0) {
        tag.classList.remove('hidden');
        playHighScoreSound();
        launchConfetti();
    } else {
        tag.classList.add('hidden');
    }

    showScreen('gameover');
}

function saveScore() {
    const nameInput = document.getElementById('playerName');
    const name = nameInput.value.trim() || 'Anonymous';
    addToLeaderboard(name, state.score);
    renderLeaderboard();
    renderHomeSummary();

    document.getElementById('nameEntry').classList.add('hidden');
    document.getElementById('playAgainBtn').classList.remove('hidden');
}

function renderLeaderboard() {
    const body = document.getElementById('leaderboardBody');
    const list = getLeaderboard();

    if (list.length === 0) {
        body.innerHTML = '<tr class="empty-row"><td colspan="4">No scores yet. Be the first legend!</td></tr>';
        return;
    }

    body.innerHTML = list.map((entry, idx) => {
        const rank = idx + 1;
        const rankClass = rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : '';
        const isNewest = entry.stamp === state.lastEntryStamp;
        return `
      <tr class="${isNewest ? 'newest' : ''}">
        <td class="${rankClass}">#${rank}</td>
        <td>${escapeHtml(entry.name)}</td>
        <td>${entry.score}</td>
        <td>${entry.date}</td>
      </tr>
    `;
    }).join('');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/* ---------------- 8. STATS + ACHIEVEMENTS ---------------- */
// Stats panel removed — stats/badges are no longer in the UI

function renderHomeSummary() {
    const stats = getStats();
    document.getElementById('homeHighScore').textContent = stats.highestScore;
    const gamesEl = document.getElementById('homeGamesPlayed');
    if (gamesEl) gamesEl.textContent = stats.gamesPlayed;
}

/* ---------------- 9. CONFETTI EFFECT ---------------- */
function launchConfetti() {
    const canvas = document.getElementById('confettiCanvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');
    const colors = ['#00d9ff', '#0055ff', '#39ff8c', '#ffe066', '#ff3b5c'];

    const pieces = Array.from({ length: 140 }, () => ({
        x: Math.random() * canvas.width,
        y: -20 - Math.random() * canvas.height * 0.5,
        size: 5 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        speedY: 2 + Math.random() * 3,
        speedX: -1.5 + Math.random() * 3,
        rotation: Math.random() * 360,
        rotationSpeed: -6 + Math.random() * 12,
    }));

    let frame = 0;
    const maxFrames = 220;

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        pieces.forEach(p => {
            p.x += p.speedX;
            p.y += p.speedY;
            p.rotation += p.rotationSpeed;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate((p.rotation * Math.PI) / 180);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
            ctx.restore();
        });
        frame++;
        if (frame < maxFrames) {
            requestAnimationFrame(draw);
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }
    draw();
}

/* ---------------- 10. EVENT LISTENERS / INIT ---------------- */
function initEventListeners() {
    document.getElementById('startBtn').addEventListener('click', () => {
        ensureAudio();
        startCountdown();
    });

    const tapBtn = document.getElementById('tapBtn');
    tapBtn.addEventListener('click', (e) => {
        if (tapBtn.disabled) return;
        handleTap(e.clientX, e.clientY);
    });

    // Keyboard support: Spacebar taps too
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && state.gameActive && !state.isPaused) {
            e.preventDefault();
            const rect = tapBtn.getBoundingClientRect();
            handleTap(rect.left + rect.width / 2, rect.top + rect.height / 2);
        }
    });

    document.getElementById('pauseBtn').addEventListener('click', pauseGame);
    document.getElementById('resumeBtn').addEventListener('click', resumeGame);

    document.getElementById('saveScoreBtn').addEventListener('click', saveScore);
    document.getElementById('playerName').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveScore();
    });

    document.getElementById('playAgainBtn').addEventListener('click', () => {
        showScreen('home');
        renderHomeSummary();
    });

    // Admin-gated resets
    const ADMIN_PASSWORD = 'admin123'; // Change this to your preferred password
    const adminModal   = document.getElementById('adminModal');
    const confirmModal = document.getElementById('confirmModal');
    let pendingAdminAction = null; // 'leaderboard' | 'highscore'

    function openAdminModal(action) {
        pendingAdminAction = action;
        document.getElementById('adminPasswordInput').value = '';
        document.getElementById('adminError').classList.add('hidden');
        adminModal.classList.remove('hidden');
        setTimeout(() => document.getElementById('adminPasswordInput').focus(), 50);
    }

    // Both reset buttons → open admin password modal first
    document.getElementById('resetLeaderboardBtn').addEventListener('click', () => openAdminModal('leaderboard'));
    document.getElementById('resetHighScoreBtn').addEventListener('click',   () => openAdminModal('highscore'));

    // Admin modal: Cancel
    document.getElementById('adminCancel').addEventListener('click', () => {
        adminModal.classList.add('hidden');
        pendingAdminAction = null;
    });

    // Admin modal: Submit password
    function checkAdminPassword() {
        const entered = document.getElementById('adminPasswordInput').value;
        if (entered === ADMIN_PASSWORD) {
            adminModal.classList.add('hidden');
            confirmModal.classList.remove('hidden');
        } else {
            document.getElementById('adminError').classList.remove('hidden');
            document.getElementById('adminPasswordInput').value = '';
            document.getElementById('adminPasswordInput').focus();
        }
    }
    document.getElementById('adminSubmit').addEventListener('click', checkAdminPassword);
    document.getElementById('adminPasswordInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') checkAdminPassword();
    });

    // Confirm modal: Cancel
    document.getElementById('confirmCancel').addEventListener('click', () => {
        confirmModal.classList.add('hidden');
        pendingAdminAction = null;
    });

    // Confirm modal: Delete — execute the pending action
    document.getElementById('confirmDelete').addEventListener('click', () => {
        if (pendingAdminAction === 'leaderboard') {
            saveLeaderboard([]);
            renderLeaderboard();
        } else if (pendingAdminAction === 'highscore') {
            const stats = getStats();
            stats.highestScore = 0;
            saveStats(stats);
            renderHomeSummary();
        }
        confirmModal.classList.add('hidden');
        pendingAdminAction = null;
    });
}

/* Leaderboard Modal Logic */
function initLeaderboardModal() {
    const modal = document.getElementById('leaderboardModal');
    const openBtn = document.getElementById('leaderboardBtn');
    const closeBtn = document.getElementById('closeLeaderboardBtn');

    if (!modal || !openBtn || !closeBtn) return;

    openBtn.addEventListener('click', () => {
        ensureAudio();
        renderLeaderboard();
        modal.classList.remove('hidden');
    });

    closeBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
    });

    // Close on clicking outside modal card
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.add('hidden');
        }
    });
}

function init() {
    initEventListeners();
    initLeaderboardModal();
    renderLeaderboard();
    renderHomeSummary();
}

document.addEventListener('DOMContentLoaded', init);