/* static/js/subjects-dropdown.js
 * Единый popover выбора предметов учителя.
 * API:
 *   SubjectsDropdown.open(anchor, { teacherId, items, selected, onChange })
 *   SubjectsDropdown.close()
 *
 * items:    string[] | { value, label }[]
 * selected: string[]
 * onChange: (values: string[]) => void   — вызывается на КАЖДОЕ изменение
 */
'use strict';

const SubjectsDropdown = (() => {
    let panel, search, list, empty, counter;
    let ctx = null;
    let filtered = [];

    const norm = (item) => typeof item === 'string'
        ? { value: item, label: item }
        : { value: item.value, label: item.label ?? String(item.value) };

    const cssEscape = (s) => window.CSS?.escape
        ? window.CSS.escape(s)
        : String(s).replace(/["\\]/g, '\\$&');

    /* ---------- Создание единственной панели ---------- */

    function build() {
        if (panel) return;

        panel = document.createElement('div');
        panel.className = 'sd-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Выбор предметов учителя');
        panel.setAttribute('aria-hidden', 'true');
        panel.innerHTML = `
            <div class="sd-head">
                <span class="sd-title">Предметы</span>
                <span class="sd-counter"></span>
                <button type="button" class="sd-close" data-sd-action="close"
                        aria-label="Закрыть список">&times;</button>
            </div>
            <div class="sd-search-wrap">
                <span class="sd-search-icon" aria-hidden="true">⌕</span>
                <input type="search" class="sd-search"
                       placeholder="Поиск предмета…"
                       autocomplete="off" spellcheck="false"
                       aria-label="Поиск предмета">
            </div>
            <div class="sd-actions">
                <button type="button" data-sd-action="all">Выбрать все</button>
                <button type="button" data-sd-action="none">Очистить</button>
            </div>
            <div class="sd-list" role="group" aria-label="Список предметов"></div>
            <div class="sd-empty" hidden></div>
            <div class="sd-hint">Изменения сохраняются сразу · Esc — закрыть</div>
        `;
        document.body.appendChild(panel);

        search  = panel.querySelector('.sd-search');
        list    = panel.querySelector('.sd-list');
        empty   = panel.querySelector('.sd-empty');
        counter = panel.querySelector('.sd-counter');

        search.addEventListener('input', renderList);

        search.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const first = list.querySelector('input[type="checkbox"]');
                if (first) first.click();
            } else if (e.key === 'Escape' && search.value) {
                e.preventDefault();
                e.stopPropagation();
                search.value = '';
                renderList();
            }
        });

        panel.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-sd-action]');
            if (!btn || !ctx) return;
            const action = btn.dataset.sdAction;
            if (action === 'close') close(true);
            if (action === 'all')   setAll(true);
            if (action === 'none')  setAll(false);
        });

        panel.addEventListener('keydown', (e) => {
            if (!ctx) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const boxes = [...list.querySelectorAll('input[type="checkbox"]')];
                if (!boxes.length) return;
                e.preventDefault();
                const i = boxes.indexOf(document.activeElement);
                let next;
                if (i === -1) next = e.key === 'ArrowDown' ? 0 : boxes.length - 1;
                else next = (i + (e.key === 'ArrowDown' ? 1 : -1) + boxes.length) % boxes.length;
                boxes[next].focus();
                return;
            }
            if (e.key === 'Home' || e.key === 'End') {
                const boxes = [...list.querySelectorAll('input[type="checkbox"]')];
                if (!boxes.length) return;
                e.preventDefault();
                (e.key === 'Home' ? boxes[0] : boxes[boxes.length - 1]).focus();
                return;
            }
            if (e.key === 'Enter' && document.activeElement.classList.contains('sd-checkbox')) {
                e.preventDefault();
                document.activeElement.click();
            }
        });

        document.addEventListener('pointerdown', (e) => {
            if (!ctx) return;
            if (panel.contains(e.target)) return;
            if (ctx.anchor?.contains(e.target)) return;
            close(false);
        });

        document.addEventListener('focusin', (e) => {
            if (!ctx) return;
            if (panel.contains(e.target)) return;
            if (ctx.anchor?.contains(e.target)) return;
            close(false);
        });

        document.addEventListener('keydown', (e) => {
            if (ctx && e.key === 'Escape') {
                e.preventDefault();
                close(true);
            }
        });

        window.addEventListener('resize', position);
        window.addEventListener('scroll', (e) => {
            if (ctx && !panel.contains(e.target)) position();
        }, true);
    }

    /* ---------- Отрисовка списка ---------- */

    function highlight(el, text, query) {
        el.textContent = '';
        if (!query) { el.textContent = text; return; }
        const lower = text.toLocaleLowerCase('ru');
        const q = query.toLocaleLowerCase('ru');
        let pos = 0, idx;
        while ((idx = lower.indexOf(q, pos)) !== -1) {
            el.append(document.createTextNode(text.slice(pos, idx)));
            const mark = document.createElement('mark');
            mark.textContent = text.slice(idx, idx + q.length);
            el.append(mark);
            pos = idx + q.length;
        }
        el.append(document.createTextNode(text.slice(pos)));
    }

    function renderList() {
        if (!ctx) return;
        const raw = search.value.trim();
        const q = raw.toLocaleLowerCase('ru');
        filtered = ctx.items.filter(i => i.label.toLocaleLowerCase('ru').includes(q));
        const frag = document.createDocumentFragment();

        filtered.forEach(item => {
            const label = document.createElement('label');
            label.className = 'sd-option';

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'sd-checkbox';
            cb.checked = ctx.selected.has(item.value);
            cb.setAttribute('aria-label', item.label);

            const name = document.createElement('span');
            name.className = 'sd-option-name';
            highlight(name, item.label, q);

            label.append(cb, name);

            cb.addEventListener('change', () => {
                if (!ctx) return;
                cb.checked ? ctx.selected.add(item.value) : ctx.selected.delete(item.value);
                commit();
            });

            frag.append(label);
        });

        list.replaceChildren(frag);
        empty.hidden = filtered.length > 0;
        empty.textContent = raw
            ? `По запросу «${raw}» ничего не найдено`
            : 'Список предметов пуст. Добавьте предметы в справочник.';
        updateCounter();
    }

    function updateCounter() {
        if (!ctx) return;
        const n = ctx.selected.size;
        counter.textContent = n ? `выбрано: ${n}` : 'не выбрано';
        counter.classList.toggle('is-empty', n === 0);
    }

    /* ---------- Синхронизация кнопки-якоря ---------- */

    function syncAnchor() {
        if (!ctx) return;
        const a = ctx.anchor;
        if (!a?.isConnected) return;
        const chosen = ctx.items.filter(i => ctx.selected.has(i.value));
        const title = chosen.map(i => i.label).join(', ') || 'Предметы не выбраны';
        a.title = title;
        a.setAttribute('aria-label', `Предметы: ${title}. Изменить`);
        a.classList.toggle('has-subjects', chosen.length > 0);
        const textEl = a.querySelector('.subjects-toggle-text');
        if (textEl) {
            textEl.textContent = '';
            if (!chosen.length) {
                textEl.textContent = 'Не выбраны';
            } else {
                textEl.append(document.createTextNode(chosen[0].label));
                if (chosen.length > 1) {
                    const more = document.createElement('span');
                    more.className = 'subjects-more';
                    more.textContent = `+${chosen.length - 1}`;
                    textEl.append(more);
                }
            }
        }
    }

    function rebindAnchor() {
        if (!ctx || ctx.teacherId == null) return;
        const selector = `[data-subjects-toggle][data-teacher-id="${cssEscape(String(ctx.teacherId))}"]`;
        const fresh = document.querySelector(selector);
        if (!fresh) { close(false); return; }
        if (fresh !== ctx.anchor) {
            if (ctx.anchor?.isConnected) ctx.anchor.setAttribute('aria-expanded', 'false');
            ctx.anchor = fresh;
        }
    }

    /* ---------- Сохранение ---------- */

    function commit() {
        if (!ctx) return;
        const values = ctx.items.filter(i => ctx.selected.has(i.value)).map(i => i.value);
        try {
            ctx.onChange(values);
        } catch (err) {
            console.error('[SubjectsDropdown] onChange:', err);
        }
        rebindAnchor();
        syncAnchor();
        updateCounter();
        position();
    }

    function setAll(on) {
        if (!ctx) return;
        if (on) ctx.items.forEach(i => ctx.selected.add(i.value));
        else ctx.selected.clear();
        renderList();
        commit();
    }

    /* ---------- Позиционирование ---------- */

    function position() {
        if (!ctx) return;
        if (!ctx.anchor?.isConnected) { close(false); return; }
        const r = ctx.anchor.getBoundingClientRect();
        const pw = panel.offsetWidth;
        const ph = panel.offsetHeight;
        const gap = 6, margin = 8;
        let top = r.bottom + gap;
        if (top + ph > window.innerHeight - margin) {
            const above = r.top - ph - gap;
            top = above >= margin ? above : Math.max(margin, window.innerHeight - ph - margin);
        }
        let left = r.left;
        if (left + pw > window.innerWidth - margin) left = window.innerWidth - pw - margin;
        left = Math.max(margin, left);
        panel.style.top = `${Math.round(top)}px`;
        panel.style.left = `${Math.round(left)}px`;
    }

    /* ---------- Public API ---------- */

    function open(anchor, options) {
        if (ctx?.anchor === anchor) { close(true); return; }
        close(false);
        build();

        const items = [];
        const seen = new Set();
        (options.items || []).map(norm).forEach(i => {
            if (!seen.has(i.value)) { seen.add(i.value); items.push(i); }
        });
        (options.selected || []).forEach(v => {
            if (!seen.has(v)) { seen.add(v); items.push({ value: v, label: String(v) }); }
        });

        ctx = {
            anchor,
            teacherId: options.teacherId ?? null,
            items,
            selected: new Set(options.selected || []),
            onChange: options.onChange || (() => {})
        };

        search.value = '';
        panel.classList.add('is-open');
        panel.setAttribute('aria-hidden', 'false');
        anchor.setAttribute('aria-expanded', 'true');

        renderList();
        syncAnchor();
        position();
        search.focus({ preventScroll: true });
    }

    function close(restoreFocus = true) {
        if (!ctx) return;
        const anchor = ctx.anchor;
        if (anchor?.isConnected) anchor.setAttribute('aria-expanded', 'false');
        ctx = null;
        filtered = [];
        panel?.classList.remove('is-open');
        panel?.setAttribute('aria-hidden', 'true');
        if (restoreFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
    }

    return { open, close, isOpen: () => !!ctx };
})();