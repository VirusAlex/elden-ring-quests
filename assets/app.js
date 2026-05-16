/* ============================================================
   Elden Ring Quests — Logic
   ============================================================ */

(() => {
    'use strict';

    // ---------- State ----------
    let mainQuests = [];
    let dlcQuests = [];
    let currentSet = 'main';
    let questTitleById = {};
    let dialoguesById = {};

    // ---------- LocalStorage helpers ----------
    const STORE = {
        get(key, fallback = null) {
            try {
                const v = localStorage.getItem(key);
                if (v === null) return fallback;
                if (v === 'true') return true;
                if (v === 'false') return false;
                return v;
            } catch (e) { return fallback; }
        },
        set(key, value) {
            try { localStorage.setItem(key, String(value)); } catch (e) {}
        },
        remove(key) { try { localStorage.removeItem(key); } catch (e) {} }
    };

    const STATUS_LABELS = {
        'not-started': 'Не начато',
        'in-progress': 'В прогрессе',
        'completed': 'Выполнено',
        'failed': 'Провалено'
    };

    const STATUS_SUFFIX = {
        'not-started': 's-not',
        'in-progress': 's-prog',
        'completed': 's-done',
        'failed': 's-fail'
    };

    // ---------- HTML escape ----------
    const escapeHTML = (str) => String(str ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));

    // ---------- Map links ----------
    // Syntax in text fields: [anchor](ID) — rendered as a link to mapgenie.io.
    // IDs >= 380000 are Shadow Realm (DLC), otherwise Lands Between.
    const MAP_LINK_RE = /\[([^\]]+)\]\((\d+)\)/g;

    function mapUrl(id) {
        const n = parseInt(id, 10);
        const realm = n >= 380000 ? 'the-shadow-realm' : 'the-lands-between';
        return `https://mapgenie.io/elden-ring/maps/${realm}?locationIds=${n}`;
    }

    // Escape HTML AND convert [anchor](ID) tokens to anchor tags.
    // We split the string on the regex, escape each non-link segment, and
    // build links from the match groups so anchor text is safely escaped too.
    function renderRichText(str) {
        const s = String(str ?? '');
        let out = '';
        let last = 0;
        MAP_LINK_RE.lastIndex = 0;
        let m;
        while ((m = MAP_LINK_RE.exec(s)) !== null) {
            out += escapeHTML(s.slice(last, m.index));
            const anchor = escapeHTML(m[1]);
            const href = escapeHTML(mapUrl(m[2]));
            out += `<a class="map-link" target="_blank" rel="noopener" href="${href}">${anchor}</a>`;
            last = m.index + m[0].length;
        }
        out += escapeHTML(s.slice(last));
        return out;
    }

    // ---------- Modal ----------
    function ensureModal() {
        if (document.getElementById('dialogue-modal')) return;
        const overlay = document.createElement('div');
        overlay.id = 'dialogue-modal';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal" role="dialog" aria-modal="true">
                <div class="modal-header">
                    <div class="modal-header-text">
                        <div class="modal-eyebrow">Диалоги</div>
                        <h3 class="modal-title" id="modal-title">—</h3>
                    </div>
                    <button class="modal-close" aria-label="Закрыть">×</button>
                </div>
                <div class="modal-body" id="modal-body"></div>
            </div>
        `;
        document.body.appendChild(overlay);

        // close handlers
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });
        overlay.querySelector('.modal-close').addEventListener('click', closeModal);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay.classList.contains('open')) closeModal();
        });
    }

    function renderParagraphs(text) {
        return String(text || '')
            .split(/\n\s*\n/)
            .map(p => `<p>${escapeHTML(p.trim()).replace(/\n/g, '<br>')}</p>`)
            .join('');
    }

    function openModal(quest) {
        ensureModal();
        const overlay = document.getElementById('dialogue-modal');
        const title = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');
        const dialogues = quest.dialogues || [];

        title.textContent = quest.title;

        if (!dialogues.length) {
            body.innerHTML = '<div class="dialogue-empty">Диалогов пока нет.</div>';
        } else {
            // group consecutive entries by location (everything before first " · ")
            const groups = [];
            let current = null;
            dialogues.forEach(d => {
                const ctx = String(d.context || '');
                const sep = ctx.indexOf(' · ');
                const loc = sep >= 0 ? ctx.slice(0, sep) : ctx;
                const trig = sep >= 0 ? ctx.slice(sep + 3) : '';
                if (!current || current.location !== loc) {
                    current = { location: loc, items: [] };
                    groups.push(current);
                }
                current.items.push({ trigger: trig, text: d.text });
            });

            body.innerHTML = groups.map(g => `
                <section class="dialogue-group">
                    ${g.location ? `<h4 class="dialogue-location">${escapeHTML(g.location)}</h4>` : ''}
                    ${g.items.map(it => `
                        <div class="dialogue-item">
                            ${it.trigger ? `<div class="dialogue-trigger">${escapeHTML(it.trigger)}</div>` : ''}
                            <div class="dialogue-text">${renderParagraphs(it.text)}</div>
                        </div>
                    `).join('')}
                </section>
            `).join('');
        }

        // reset scroll
        body.scrollTop = 0;
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        const overlay = document.getElementById('dialogue-modal');
        if (!overlay) return;
        overlay.classList.remove('open');
        document.body.style.overflow = '';
    }

    // ---------- Rendering ----------
    function renderRewards(list, kill = false) {
        if (!list || !list.length) return '';
        return `<div class="rewards-grid">${list.map(r =>
            `<div class="reward-card${kill ? ' kill-reward' : ''}">${renderRichText(r)}</div>`
        ).join('')}</div>`;
    }

    function renderStep(step, index) {
        const stepId = step.id;
        const classes = ['step'];
        if (step.optional) classes.push('is-optional');
        if (step.warning) classes.push('is-failure-risk');
        if (step.crossQuest) classes.push('is-cross-link');

        const checked = STORE.get(stepId, false);
        if (checked) classes.push('checked');

        let crossNote = '';
        if (step.crossQuest) {
            const targetId = step.crossQuest;
            const targetTitle = questTitleById[targetId] || targetId;
            crossNote = `<a class="cross-quest-note" href="#card-${escapeHTML(targetId)}" data-cross-link="${escapeHTML(targetId)}">Часть цепочки: ${escapeHTML(targetTitle)}</a>`;
        }

        const warningBlock = step.warning
            ? `<span class="step-warning">${renderRichText(step.warning)}</span>`
            : '';

        const num = String(index + 1).padStart(2, '0');

        return `
            <li class="${classes.join(' ')}" data-step-id="${escapeHTML(stepId)}">
                <div class="step-content">
                    <span class="step-num">${num}</span>
                    <input type="checkbox" data-step-checkbox="${escapeHTML(stepId)}" ${checked ? 'checked' : ''}>
                    <span class="step-text">
                        ${renderRichText(step.text)}
                        ${crossNote}
                        ${warningBlock}
                    </span>
                </div>
            </li>
        `;
    }

    function renderFailureBlock(points) {
        if (!points || !points.length) return '';
        return `
            <div class="failure-block">
                <div class="failure-title">Точки провала и софтлоки</div>
                <ul>${points.map(p => `<li>${renderRichText(p)}</li>`).join('')}</ul>
            </div>
        `;
    }

    function renderOptionalBlock(items) {
        if (!items || !items.length) return '';
        return `
            <div class="optional-block">
                <div class="opt-title">Опциональные встречи / действия</div>
                <ul>${items.map(p => `<li>${renderRichText(p)}</li>`).join('')}</ul>
            </div>
        `;
    }

    function renderDialogueButton(quest) {
        if (!quest.dialogues || !quest.dialogues.length) return '';
        return `
            <div class="section-title">Диалоги</div>
            <button class="dialogue-btn" data-dialogue-open="${escapeHTML(quest.id)}">
                Показать диалоги (${quest.dialogues.length})
            </button>
        `;
    }

    function renderPrerequisites(prereqs) {
        if (!prereqs || !prereqs.length) return '';
        return `
            <div class="section-title">Требования</div>
            <ul class="prereq-list">
                ${prereqs.map(p => `<li>${renderRichText(p)}</li>`).join('')}
            </ul>
        `;
    }

    function calcProgress(quest) {
        const total = (quest.steps || []).length;
        if (!total) return { done: 0, total: 0, pct: 0 };
        const done = quest.steps.filter(s => STORE.get(s.id, false) === true).length;
        return { done, total, pct: Math.round(done / total * 100) };
    }

    function renderQuestCard(quest, isDLC) {
        const status = STORE.get(`${quest.id}-status`, 'not-started');
        const collapsed = STORE.get(`${quest.id}-collapsed`, false);
        const progress = calcProgress(quest);

        const meta = [];
        meta.push(`<span class="badge region">${escapeHTML(quest.region || '?')}</span>`);
        if (isDLC) meta.push('<span class="badge dlc">DLC</span>');

        const statusButtons = ['not-started', 'in-progress', 'completed', 'failed'].map(s => `
            <button data-status="${s}" class="${s === status ? `active ${STATUS_SUFFIX[s]}` : ''}">${STATUS_LABELS[s]}</button>
        `).join('');

        return `
            <article class="quest-card status-${status} ${collapsed ? '' : 'open'}" id="card-${escapeHTML(quest.id)}" data-quest-id="${escapeHTML(quest.id)}">
                <header class="quest-head">
                    <div class="quest-head-text">
                        <h2 class="quest-title">${escapeHTML(quest.title)}</h2>
                        <div class="quest-meta">${meta.join('')}</div>
                    </div>
                    <div class="quest-progress-pill" data-progress-pill>${progress.done}/${progress.total}</div>
                    <div class="quest-actions" data-stop-propagation>
                        <div class="status-toggle">${statusButtons}</div>
                        <span class="collapse-chevron">▾</span>
                    </div>
                </header>
                <div class="quest-body">
                    <p class="intro-line"><strong>Как начать</strong> ${renderRichText(quest.howToStart || '—')}</p>
                    ${renderPrerequisites(quest.prerequisites)}
                    ${renderFailureBlock(quest.failurePoints)}
                    ${renderOptionalBlock(quest.optionalEncounters)}
                    <div class="section-title">Шаги · ${progress.done} из ${progress.total}</div>
                    <ol class="steps">${(quest.steps || []).map((s, i) => renderStep(s, i)).join('')}</ol>
                    ${quest.rewards && quest.rewards.length ? `
                        <div class="section-title">Награды за прохождение</div>
                        ${renderRewards(quest.rewards, false)}
                    ` : ''}
                    ${quest.rewardsOnKill && quest.rewardsOnKill.length ? `
                        <div class="section-title">Награды при убийстве / провале</div>
                        ${renderRewards(quest.rewardsOnKill, true)}
                    ` : ''}
                    ${renderDialogueButton(quest)}
                </div>
            </article>
        `;
    }

    function renderSidebarItem(quest) {
        const status = STORE.get(`${quest.id}-status`, 'not-started');
        return `
            <li class="status-${status}" data-nav-id="${escapeHTML(quest.id)}">
                <span>${escapeHTML(quest.title)}</span>
            </li>
        `;
    }

    function renderAll(quests, isDLC) {
        const container = document.getElementById('quests-container');
        const list = document.getElementById('quest-list');
        container.innerHTML = quests.map(q => renderQuestCard(q, isDLC)).join('');
        list.innerHTML = quests.map(renderSidebarItem).join('');
        attachQuestEvents(quests);
        updateProgressSummary();
    }

    // ---------- Events ----------
    function attachQuestEvents(quests) {
        const container = document.getElementById('quests-container');
        const list = document.getElementById('quest-list');
        const questMap = {};
        quests.forEach(q => { questMap[q.id] = q; });

        container.querySelectorAll('.quest-card').forEach(card => {
            const head = card.querySelector('.quest-head');
            head.addEventListener('click', (e) => {
                if (e.target.closest('[data-stop-propagation]')) return;
                if (e.target.closest('input,button,a')) return;
                const isOpen = card.classList.toggle('open');
                STORE.set(`${card.dataset.questId}-collapsed`, !isOpen);
            });

            // chevron click also toggles
            const chevron = card.querySelector('.collapse-chevron');
            if (chevron) {
                chevron.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isOpen = card.classList.toggle('open');
                    STORE.set(`${card.dataset.questId}-collapsed`, !isOpen);
                });
            }

            // status toggle
            card.querySelectorAll('.status-toggle button').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const status = btn.dataset.status;
                    const wasOpen = card.classList.contains('open');
                    card.className = `quest-card status-${status} ${wasOpen ? 'open' : ''}`;
                    STORE.set(`${card.dataset.questId}-status`, status);
                    card.querySelectorAll('.status-toggle button').forEach(b => {
                        const s = b.dataset.status;
                        b.className = (s === status) ? `active ${STATUS_SUFFIX[s]}` : '';
                    });
                    const navItem = list.querySelector(`[data-nav-id="${card.dataset.questId}"]`);
                    if (navItem) navItem.className = `status-${status}`;
                    updateProgressSummary();
                });
            });

            // dialogue button → modal
            card.querySelectorAll('[data-dialogue-open]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const q = questMap[btn.dataset.dialogueOpen];
                    if (q) openModal(q);
                });
            });

            // cross-quest link
            card.querySelectorAll('[data-cross-link]').forEach(a => {
                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const targetId = a.dataset.crossLink;
                    const target = document.getElementById(`card-${targetId}`);
                    if (!target) {
                        // target is in the other set — switch
                        const inMain = mainQuests.some(q => q.id === targetId);
                        const inDlc = dlcQuests.some(q => q.id === targetId);
                        if (inMain && currentSet !== 'main') switchSet('main');
                        else if (inDlc && currentSet !== 'dlc') switchSet('dlc');
                        // wait a tick then scroll
                        setTimeout(() => {
                            const t = document.getElementById(`card-${targetId}`);
                            if (t) {
                                t.classList.add('open');
                                STORE.set(`${targetId}-collapsed`, false);
                                t.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }
                        }, 40);
                        return;
                    }
                    target.classList.add('open');
                    STORE.set(`${targetId}-collapsed`, false);
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
            });

            // step checkboxes
            card.querySelectorAll('[data-step-checkbox]').forEach(cb => {
                cb.addEventListener('change', () => {
                    const id = cb.dataset.stepCheckbox;
                    STORE.set(id, cb.checked);
                    document.querySelectorAll(`[data-step-checkbox="${CSS.escape(id)}"]`).forEach(other => {
                        other.checked = cb.checked;
                        const li = other.closest('.step');
                        if (li) li.classList.toggle('checked', cb.checked);
                    });
                    refreshProgressForStep(id);
                });
            });
        });

        // sidebar nav
        list.querySelectorAll('[data-nav-id]').forEach(item => {
            item.addEventListener('click', () => {
                const id = item.dataset.navId;
                const card = document.getElementById(`card-${id}`);
                if (!card) return;
                if (!card.classList.contains('open')) {
                    card.classList.add('open');
                    STORE.set(`${id}-collapsed`, false);
                }
                card.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
    }

    function refreshProgressForStep(stepId) {
        const list = currentSet === 'main' ? mainQuests : dlcQuests;
        list.forEach(q => {
            if (!q.steps) return;
            if (q.steps.some(s => s.id === stepId)) {
                const card = document.getElementById(`card-${q.id}`);
                if (!card) return;
                const pill = card.querySelector('[data-progress-pill]');
                const p = calcProgress(q);
                if (pill) pill.textContent = `${p.done}/${p.total}`;
                // also update the section title "Шаги · X из Y"
                const stepsTitle = Array.from(card.querySelectorAll('.section-title'))
                    .find(t => t.textContent.startsWith('Шаги'));
                if (stepsTitle) stepsTitle.textContent = `Шаги · ${p.done} из ${p.total}`;
            }
        });
        updateProgressSummary();
    }

    function updateProgressSummary() {
        const set = currentSet === 'main' ? mainQuests : dlcQuests;
        let done = 0, inProgress = 0, failed = 0;
        set.forEach(q => {
            const s = STORE.get(`${q.id}-status`, 'not-started');
            if (s === 'completed') done++;
            else if (s === 'in-progress') inProgress++;
            else if (s === 'failed') failed++;
        });
        const total = set.length;
        const el = document.getElementById('progress-summary');
        if (!el) return;
        el.innerHTML = `
            <span>Всего: <strong>${total}</strong></span>
            <span>Выполнено: <strong>${done}</strong></span>
            <span>В прогрессе: <strong>${inProgress}</strong></span>
            <span>Провалено: <strong>${failed}</strong></span>
        `;
    }

    // ---------- Search ----------
    function setupSearch() {
        const input = document.getElementById('search-input');
        input.addEventListener('input', () => applyFilters(input.value.trim().toLowerCase()));
        document.getElementById('filter-hide-completed').addEventListener('change', () => applyFilters(input.value.trim().toLowerCase()));
    }

    function applyFilters(q) {
        const hideCompleted = document.getElementById('filter-hide-completed').checked;
        const list = currentSet === 'main' ? mainQuests : dlcQuests;
        list.forEach(quest => {
            const card = document.getElementById(`card-${quest.id}`);
            const nav = document.querySelector(`[data-nav-id="${quest.id}"]`);
            if (!card) return;
            const status = STORE.get(`${quest.id}-status`, 'not-started');
            const matchesText = !q
                || quest.title.toLowerCase().includes(q)
                || (quest.character || '').toLowerCase().includes(q)
                || (quest.region || '').toLowerCase().includes(q)
                || (quest.howToStart || '').toLowerCase().includes(q)
                || (quest.steps || []).some(s => (s.text || '').toLowerCase().includes(q))
                || (quest.failurePoints || []).some(p => p.toLowerCase().includes(q))
                || (quest.rewards || []).some(r => r.toLowerCase().includes(q));

            const matchesStatus = !hideCompleted || status !== 'completed';

            const show = matchesText && matchesStatus;
            card.classList.toggle('hidden', !show);
            if (nav) nav.classList.toggle('hidden', !show);
        });
    }

    // ---------- Quest set switching ----------
    function setupQuestTypeToggle() {
        document.getElementById('main-quests-toggle').addEventListener('click', () => switchSet('main'));
        document.getElementById('dlc-quests-toggle').addEventListener('click', () => switchSet('dlc'));
    }

    function switchSet(set) {
        if (set === currentSet) return;
        currentSet = set;
        STORE.set('currentQuestType', set);
        document.getElementById('main-quests-toggle').classList.toggle('active', set === 'main');
        document.getElementById('dlc-quests-toggle').classList.toggle('active', set === 'dlc');
        renderAll(set === 'main' ? mainQuests : dlcQuests, set === 'dlc');
        document.getElementById('search-input').value = '';
    }

    // ---------- Save / Load ----------
    async function calculateHash(data) {
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(data);
        const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
        return Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    async function exportProgress() {
        const data = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            data[key] = localStorage.getItem(key);
        }
        const sorted = {};
        Object.keys(data).sort().forEach(k => sorted[k] = data[k]);
        const json = JSON.stringify(sorted, null, 2);
        const hash = (await calculateHash(json)).slice(0, 12);
        const blob = new Blob([json], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `elden-progress_${hash}.json`;
        link.click();
    }

    function importProgress(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                Object.keys(data).forEach(k => {
                    if (Object.prototype.hasOwnProperty.call(data, k)) localStorage.setItem(k, data[k]);
                });
                location.reload();
            } catch (err) {
                alert('Ошибка при загрузке файла. Убедитесь, что это правильный JSON-файл.');
                console.error(err);
            }
        };
        reader.readAsText(file);
    }

    function setupSaveLoad() {
        document.getElementById('save-progress').addEventListener('click', exportProgress);
        document.getElementById('load-file').addEventListener('change', importProgress);
    }

    // ---------- Init ----------
    async function loadData() {
        const [m, d, dlg] = await Promise.all([
            fetch('data/quests-main.json').then(r => r.json()),
            fetch('data/quests-dlc.json').then(r => r.json()),
            fetch('data/dialogues.json').then(r => r.json()).catch(() => ({}))
        ]);
        mainQuests = m;
        dlcQuests = d;
        dialoguesById = dlg || {};
        questTitleById = {};
        [...m, ...d].forEach(q => {
            questTitleById[q.id] = q.title;
            // External dialogues override embedded ones
            if (dialoguesById[q.id] && dialoguesById[q.id].length) {
                q.dialogues = dialoguesById[q.id];
            }
        });
    }

    async function init() {
        try {
            await loadData();
        } catch (e) {
            document.getElementById('quests-container').innerHTML =
                `<div class="loading">Ошибка загрузки данных квестов. Откройте через локальный сервер (например <code>python -m http.server</code>) — file:// не позволяет браузеру читать JSON через fetch.</div>`;
            console.error(e);
            return;
        }

        currentSet = STORE.get('currentQuestType', 'main') === 'dlc' ? 'dlc' : 'main';
        document.getElementById('main-quests-toggle').classList.toggle('active', currentSet === 'main');
        document.getElementById('dlc-quests-toggle').classList.toggle('active', currentSet === 'dlc');

        ensureModal();
        setupQuestTypeToggle();
        setupSearch();
        setupSaveLoad();
        renderAll(currentSet === 'main' ? mainQuests : dlcQuests, currentSet === 'dlc');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
