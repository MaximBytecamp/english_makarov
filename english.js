/* Разговорный английский — механика страницы.
   Автор: Макаров Максим Николаевич

   1. Профиль читателя: уровень, акцент, подсказки, скорость. Хранится в браузере.
   2. Озвучка через голоса, встроенные в систему (Web Speech API).
   3. Слово с произношением (.w), словарь (.vocab), диалог (.dialog).
   4. Упражнения с перетаскиванием (.ex): match, sort, order, gap, listen.
   5. Повтор слов (.review): ошибки и новые слова возвращаются по расписанию.

   Данные блоков лежат внутри них в <script type="application/json">. */
(() => {
  const KEY = { profile: 'en-book-profile', words: 'en-book-words', done: 'en-book-done' };
  const DAY = 864e5;
  // Корень книги считается от адреса english.js: из него строятся ссылки на словарь.
  const self = document.querySelector('script[src$="english.js"]');
  const base = self ? self.getAttribute('src').replace(/english\.js$/, '') : '';

  const load = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; }
  };
  const store = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* приватный режим */ }
  };
  const data = el => {
    const script = el.querySelector(':scope > script[type="application/json"]');
    try { return script ? JSON.parse(script.textContent) : null; } catch (error) {
      el.textContent = 'Ошибка в данных блока: ' + error.message;
      return null;
    }
  };
  const h = (tag, cls, html) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html != null) el.innerHTML = html;
    return el;
  };
  const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const shuffle = list => {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  const norm = text => String(text).toLowerCase().replace(/[’']/g, "'").replace(/[.,!?;:"«»—–-]+/g, ' ').replace(/\s+/g, ' ').trim();

  /* ---- 1. Профиль ----------------------------------------------- */
  // Значения по умолчанию для каждого уровня: чем выше уровень, тем меньше подсказок.
  const LEVELS = {
    a0: { name: 'с нуля', hint: 'both', tr: 'show', rate: 'slow' },
    a1: { name: 'начальный', hint: 'both', tr: 'show', rate: 'normal' },
    a2: { name: 'базовый', hint: 'both', tr: 'tap', rate: 'normal' },
    b1: { name: 'средний', hint: 'ipa', tr: 'tap', rate: 'normal' },
  };
  const profile = Object.assign({ level: 'a1', accent: 'us', goal: 'both', ...LEVELS.a1, tested: false }, load(KEY.profile, {}));
  const root = document.documentElement;
  const applyProfile = () => {
    root.dataset.level = profile.level;
    root.dataset.hint = profile.hint;
    root.dataset.tr = profile.tr;
    root.dataset.accent = profile.accent;
    document.querySelectorAll('[data-profile]').forEach(el => renderProfile(el));
  };
  const setProfile = (patch, save = true) => {
    Object.assign(profile, patch);
    if (save) store(KEY.profile, profile);
    applyProfile();
    syncPrefs();
  };

  /* ---- 2. Озвучка ----------------------------------------------- */
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  let voices = [];
  const PREFER = {
    us: ['Samantha', 'Google US English', 'Microsoft Aria', 'Microsoft Jenny', 'Microsoft Ava', 'Ava', 'Allison', 'Alex', 'Microsoft Zira'],
    gb: ['Daniel', 'Google UK English Female', 'Google UK English Male', 'Microsoft Sonia', 'Microsoft Libby', 'Serena', 'Kate', 'Microsoft Hazel'],
  };
  const englishVoices = () => voices.filter(v => /^en[-_]/i.test(v.lang));
  const pickVoice = (second = false) => {
    const lang = profile.accent === 'gb' ? 'en-gb' : 'en-us';
    const local = englishVoices().filter(v => v.lang.replace('_', '-').toLowerCase() === lang);
    const ranked = [];
    PREFER[profile.accent].forEach(name => local.filter(v => v.name.includes(name)).forEach(v => ranked.includes(v) || ranked.push(v)));
    local.forEach(v => ranked.includes(v) || ranked.push(v));
    englishVoices().forEach(v => ranked.includes(v) || ranked.push(v));
    // Для второго собеседника в диалоге берём другой голос того же акцента, если он есть.
    return (second && ranked[1] && local.includes(ranked[1])) ? ranked[1] : (ranked[0] || null);
  };
  const refreshVoices = () => {
    voices = synth ? synth.getVoices() : [];
    document.querySelectorAll('.voice-status').forEach(renderVoiceStatus);
  };
  if (synth) {
    // Сначала только список голосов: блок .voice-status рисуется в конце файла,
    // когда объявлены все функции (иначе ошибка до инициализации sayButton).
    voices = synth.getVoices();
    synth.addEventListener ? synth.addEventListener('voiceschanged', refreshVoices) : (synth.onvoiceschanged = refreshVoices);
  }

  let playingEl = null;
  const mark = el => {
    if (playingEl) playingEl.classList.remove('is-playing');
    playingEl = el || null;
    if (playingEl) playingEl.classList.add('is-playing');
  };
  // Возвращает Promise, который выполняется, когда фраза договорена.
  const say = (text, { slow = false, el = null, second = false } = {}) => new Promise(resolve => {
    if (!synth) { resolve(false); return; }
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(second);
    if (voice) utter.voice = voice;
    utter.lang = voice ? voice.lang : (profile.accent === 'gb' ? 'en-GB' : 'en-US');
    utter.rate = slow ? 0.6 : (profile.rate === 'slow' ? 0.78 : 0.95);
    const done = () => { if (playingEl === el) mark(null); resolve(true); };
    utter.onend = done;
    utter.onerror = done;
    mark(el);
    synth.speak(utter);
  });
  const stop = () => { if (synth) synth.cancel(); mark(null); };

  const sayButton = (text, { slow = false, el = null, second = false, label } = {}) => {
    const button = h('button', 'say' + (slow ? ' say--slow' : ''), slow ? 'мед' : '▶');
    button.type = 'button';
    button.title = label || (slow ? 'Медленно' : 'Послушать');
    button.setAttribute('aria-label', (slow ? 'Медленно: ' : 'Послушать: ') + text);
    button.addEventListener('click', event => {
      event.stopPropagation();
      say(text, { slow, el: el || button, second });
    });
    return button;
  };

  function renderVoiceStatus(box) {
    const voice = pickVoice();
    box.classList.toggle('is-missing', !voice);
    if (!synth) {
      box.innerHTML = '<span>Этот браузер не умеет озвучивать текст. Откройте книгу в Chrome, Edge или Safari.</span>';
    } else if (!voice) {
      box.innerHTML = '<span>Английский голос в системе не найден. Как его установить — ниже, в этом параграфе. Без голоса работают все подсказки, кроме звука.</span>';
    } else {
      box.innerHTML = '';
      const button = sayButton('Hello! This is how I sound.');
      box.append(button, h('span', '', `Голос: <b>${esc(voice.name)}</b> · ${esc(voice.lang)}. Нажмите ▶, чтобы проверить звук.`));
    }
  }

  /* ---- Русская подсказка: ЗАГЛАВНЫЕ = ударный слог, {з} = звук th ---- */
  const ru = hint => {
    if (!hint) return '';
    let html = '';
    String(hint).replace(/\{([^}]+)\}|([А-ЯЁ]+)|([^{А-ЯЁ]+)/g, (_, th, stress, plain) => {
      if (th) {
        const low = th.toLowerCase();
        const inner = `<u class="th" title="кончик языка между зубами">${low}</u>`;
        html += th !== low ? `<b>${inner}</b>` : inner;
      } else if (stress) {
        html += `<b>${stress.toLowerCase()}</b>`;
      } else {
        html += esc(plain);
      }
      return '';
    });
    return `<span class="ru">${html.replace(/<\/b><b>/g, '')}</span>`;
  };

  /* ---- Словарь слов, которые встречались читателю ---------------- */
  // Мета-данные слова (перевод, подсказки) нужны блоку повтора на любой странице.
  const words = load(KEY.words, {});
  const remember = (en, meta) => {
    const item = words[en] || { box: 0, due: 0, right: 0, wrong: 0 };
    Object.entries(meta || {}).forEach(([k, v]) => { if (v) item[k] = v; });
    words[en] = item;
    return item;
  };
  const INTERVALS = [0, 1, 2, 4, 8, 16]; // дни до следующего повтора на каждой ступени
  const record = (en, meta, ok) => {
    const item = remember(en, meta);
    const now = Date.now();
    if (ok) {
      item.right += 1;
      item.box = Math.min(item.box + 1, INTERVALS.length - 1);
      item.due = now + INTERVALS[item.box] * DAY;
    } else {
      item.wrong += 1;
      item.box = 0;
      item.due = now;
    }
    item.seen = now;
    store(KEY.words, words);
    document.querySelectorAll('.review').forEach(renderReview);
  };

  /* ---- Разбор слова по буквам (.parse) -----------------------------
     Разметка: [a] — гласная, которая читается; (e) — немая буква;
     {sh} — сочетание, читается одним звуком; | — граница слога. */
  document.querySelectorAll('.parse').forEach(el => {
    const src = el.textContent.trim();
    const word = src.replace(/[\[\](){}|]/g, '');
    const text = el.dataset.say || word;
    const row = h('span', 'parse__letters');
    src.replace(/\[([^\]]+)\]|\(([^)]+)\)|\{([^}]+)\}|(\|)|([^\[\](){}|])/g, (_, v, mute, combo, bar, plain) => {
      if (bar) { row.append(h('span', 'pl-gap')); return ''; }
      if (combo) { row.append(h('span', 'pl c', esc(combo))); return ''; }
      const chars = v || mute || plain;
      [...chars].forEach(ch => row.append(h('span', 'pl' + (v ? ' v' : mute ? ' s' : ''), esc(ch))));
      return '';
    });
    el.innerHTML = '';
    const button = h('button', 'parse__say', '');
    button.type = 'button';
    button.title = 'Послушать: ' + text;
    button.append(row);
    button.addEventListener('click', () => say(text, { el: button }));
    el.append(button);
    if (el.dataset.ipa) el.append(h('span', 'w__ipa', `/${esc(el.dataset.ipa)}/`));
    if (el.dataset.ru) el.append(h('span', 'w__ru', ru(el.dataset.ru)));
    remember(word, { ipa: el.dataset.ipa, ru: el.dataset.ru, tr: el.dataset.tr });
  });

  /* ---- 3. Слово, словарь, диалог --------------------------------- */
  document.querySelectorAll('.w').forEach(el => {
    const text = el.dataset.say || el.textContent.trim();
    const shown = el.textContent.trim();
    el.innerHTML = '';
    const button = h('button', 'w__say', esc(shown));
    button.type = 'button';
    button.title = 'Послушать';
    button.addEventListener('click', () => say(text, { el: button }));
    el.append(button);
    if (el.dataset.ipa) el.append(h('span', 'w__ipa', `/${esc(el.dataset.ipa)}/`));
    if (el.dataset.ru) el.append(h('span', 'w__ru', ru(el.dataset.ru)));
    if (!/\s/.test(text)) remember(text, { ipa: el.dataset.ipa, ru: el.dataset.ru, tr: el.dataset.tr });
  });

  const pron = (ipa, hint) => {
    const box = h('div', 'vocab__pron');
    if (ipa) box.append(h('span', 'hint-ipa', `/${esc(ipa)}/`));
    if (hint) box.append(h('span', 'hint-ru', ru(hint)));
    return box;
  };

  const trSpan = text => {
    const span = h('span', 'tr', esc(text));
    span.addEventListener('click', () => span.classList.add('is-open'));
    return span;
  };

  document.querySelectorAll('.vocab').forEach(box => {
    const list = data(box);
    if (!list) return;
    const head = h('div', 'vocab__head', `<span>${esc(box.dataset.title || 'Слова темы')} · ${list.length}</span>`);
    const all = h('button', 'btn', '▶ все подряд');
    all.type = 'button';
    head.append(all);
    box.append(head);
    const rows = list.map(([en, ipa, hint, tr]) => {
      remember(en, { ipa, ru: hint, tr });
      const row = h('div', 'vocab__row');
      const en1 = h('div', 'vocab__en', esc(en));
      const tr1 = h('div', 'vocab__tr');
      tr1.append(trSpan(tr));
      row.append(sayButton(en, { el: null }), en1, pron(ipa, hint), tr1);
      row.querySelector('.say').addEventListener('click', () => mark(row));
      box.append(row);
      return { en, row };
    });
    let running = false;
    all.addEventListener('click', async () => {
      if (running) { running = false; stop(); all.textContent = '▶ все подряд'; return; }
      running = true;
      all.textContent = '■ стоп';
      for (const { en, row } of rows) {
        if (!running) break;
        await say(en, { el: row });
        await new Promise(r => setTimeout(r, 450));
      }
      running = false;
      all.textContent = '▶ все подряд';
    });
  });
  store(KEY.words, words);

  document.querySelectorAll('.dialog').forEach(box => {
    const spec = data(box);
    if (!spec) return;
    const head = h('div', 'dialog__head', `<span>${esc(spec.title || 'Диалог')}</span>`);
    const row = h('div', 'btnrow');
    const play = h('button', 'btn', '▶ весь диалог');
    const role = h('button', 'btn', `роль: ${esc(spec.you || 'вы')}`);
    play.type = role.type = 'button';
    role.setAttribute('aria-pressed', 'false');
    role.title = 'Реплики собеседника звучат, свои вы говорите сами, потом открываете и сверяете';
    row.append(play, role);
    head.append(row);
    box.append(head);

    const lines = spec.lines.map(([who, en, tr, ipaOrRu, maybeRu]) => {
      // Строка: [кто, английский, перевод, русская подсказка] — 'you' отмечает реплики читателя.
      const you = who === 'you';
      const hint = maybeRu || ipaOrRu;
      const line = h('div', 'line' + (you ? ' line--you' : ''));
      const text = h('div', '');
      text.append(h('div', 'line__en', esc(en)));
      if (hint) text.append(h('div', 'line__ipa hint-ru', ru(hint)));
      const trLine = h('div', 'line__ru');
      trLine.append(trSpan(tr));
      text.append(trLine);
      const reveal = h('button', 'btn line__reveal', 'сказал(а) — показать');
      reveal.type = 'button';
      text.append(reveal);
      const btns = h('div', 'line__btns');
      btns.append(sayButton(en, { el: line, second: !you }), sayButton(en, { slow: true, el: line, second: !you }));
      line.append(h('div', 'line__who', esc(you ? (spec.you || 'Вы') : (spec.them || who))), text, btns);
      box.append(line);
      if (you) remember(en, { tr, ru: hint });
      return { line, en, you, reveal };
    });

    if (!lines.some(item => item.you)) role.remove();

    let token = 0;
    const waitReveal = item => new Promise(resolve => {
      item.line.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      item.reveal.onclick = () => { item.line.classList.add('is-shown'); resolve(); };
    });
    const run = async () => {
      const mine = ++token;
      play.textContent = '■ стоп';
      for (const item of lines) {
        if (mine !== token) return;
        if (box.classList.contains('is-role') && item.you && !item.line.classList.contains('is-shown')) {
          mark(item.line);
          await waitReveal(item);
          if (mine !== token) return;
          await say(item.en, { el: item.line });
        } else {
          await say(item.en, { el: item.line, second: !item.you });
        }
        await new Promise(r => setTimeout(r, 500));
      }
      if (mine === token) play.textContent = '▶ весь диалог';
    };
    play.addEventListener('click', () => {
      if (play.textContent.startsWith('■')) { token++; stop(); play.textContent = '▶ весь диалог'; return; }
      run();
    });
    role.addEventListener('click', () => {
      const on = !box.classList.contains('is-role');
      box.classList.toggle('is-role', on);
      role.setAttribute('aria-pressed', String(on));
      lines.forEach(item => item.line.classList.remove('is-shown'));
      token++; stop(); play.textContent = '▶ весь диалог';
      if (on) run();
    });
  });

  /* ---- 4. Перетаскивание ------------------------------------------ */
  /* Плитку можно перетащить мышью или пальцем, а можно нажать на неё и потом
     на место, куда её положить. С клавиатуры: Tab до плитки, Enter, Tab до места, Enter. */
  const dnd = (container, onDrop) => {
    let picked = null;
    const unpick = () => {
      if (picked) picked.classList.remove('is-picked');
      picked = null;
      container.classList.remove('is-picking');
    };
    const pick = tile => {
      unpick();
      picked = tile;
      tile.classList.add('is-picked');
      container.classList.add('is-picking');
    };
    const dropAt = (zone, tile, point) => {
      unpick();
      onDrop(tile, zone, point);
    };

    container.addEventListener('pointerdown', event => {
      const tile = event.target.closest('.tile');
      if (!tile || !container.contains(tile) || tile.classList.contains('is-locked') || event.button > 0) return;
      const start = { x: event.clientX, y: event.clientY };
      let ghost = null;
      let over = null;
      const box = tile.getBoundingClientRect();
      const offset = { x: start.x - box.left, y: start.y - box.top };
      tile.setPointerCapture(event.pointerId);

      const move = e => {
        if (!ghost && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
        if (!ghost) {
          unpick();
          ghost = tile.cloneNode(true);
          ghost.classList.add('tile--ghost');
          ghost.style.width = box.width + 'px';
          document.body.appendChild(ghost);
          tile.classList.add('is-ghosted');
        }
        ghost.style.left = (e.clientX - offset.x) + 'px';
        ghost.style.top = (e.clientY - offset.y) + 'px';
        const under = document.elementFromPoint(e.clientX, e.clientY);
        const zone = under && under.closest('.drop');
        const target = zone && container.contains(zone) ? zone : null;
        if (target !== over) {
          if (over) over.classList.remove('is-over');
          over = target;
          if (over) over.classList.add('is-over');
        }
      };
      const up = e => {
        tile.removeEventListener('pointermove', move);
        tile.removeEventListener('pointerup', up);
        tile.removeEventListener('pointercancel', up);
        if (over) over.classList.remove('is-over');
        if (ghost) {
          ghost.remove();
          tile.classList.remove('is-ghosted');
          if (over && e.type === 'pointerup') dropAt(over, tile, { x: e.clientX, y: e.clientY });
        } else if (e.type === 'pointerup') {
          // Не тащили — значит нажали: выбираем плитку (или снимаем выбор).
          picked === tile ? unpick() : pick(tile);
          tile.dataset.tap = '1';
        }
      };
      tile.addEventListener('pointermove', move);
      tile.addEventListener('pointerup', up);
      tile.addEventListener('pointercancel', up);
    });

    // Нажатие на место, когда плитка выбрана.
    container.addEventListener('click', event => {
      const tile = event.target.closest('.tile');
      if (tile && tile.dataset.tap) { delete tile.dataset.tap; return; }
      const zone = event.target.closest('.drop');
      if (picked && zone && container.contains(zone) && !zone.contains(picked)) dropAt(zone, picked, null);
      else if (picked && zone && zone.contains(picked)) unpick();
    });
    container.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const tile = event.target.closest('.tile');
      const zone = event.target.closest('.drop');
      if (tile && !tile.classList.contains('is-locked') && (!picked || picked === tile || !zone || zone.contains(tile))) {
        event.preventDefault();
        picked === tile ? unpick() : pick(tile);
      } else if (picked && zone) {
        event.preventDefault();
        dropAt(zone, picked, null);
      }
    });
    container.addEventListener('keydown', event => { if (event.key === 'Escape') unpick(); });
    return { unpick };
  };

  const makeTile = (text, value, { speak = false } = {}) => {
    // div, а не button: у кнопки Enter порождает лишний click и сбивает выбор плитки.
    const tile = h('div', 'tile', esc(text));
    tile.tabIndex = 0;
    tile.setAttribute('role', 'button');
    tile.dataset.value = value ?? text;
    if (speak) tile.dataset.speak = text;
    return tile;
  };
  const wrong = tile => {
    tile.classList.remove('is-wrong');
    void tile.offsetWidth;
    tile.classList.add('is-wrong');
    setTimeout(() => tile.classList.remove('is-wrong'), 600);
  };

  /* ---- Упражнения ----------------------------------------------- */
  const KINDS = {
    match: 'сопоставление', sort: 'сортировка', order: 'сборка фразы', gap: 'пропуски', listen: 'на слух', type: 'диктант',
  };
  const done = load(KEY.done, {});
  // Аэропорт был главой 1.1, потом 2.1, теперь 3.1: прогресс переносится под новый номер.
  ['znachenie', 'kto', 'sluh', 'sborka', 'dialog', 'tablo'].forEach(name => {
    ['1.1-', '2.1-'].forEach(old => {
      if (done[old + name] && !done['3.1-' + name]) { done['3.1-' + name] = done[old + name]; delete done[old + name]; }
    });
  });
  store(KEY.done, done);

  const exercise = (box, spec, { onFinish } = {}) => {
    box.innerHTML = '';
    box.classList.remove('is-done');
    const type = box.dataset.type;
    const head = h('div', 'ex__head');
    head.append(h('p', 'ex__title', esc(spec.title || box.dataset.title || 'Упражнение')), h('span', 'ex__kind', KINDS[type] || type));
    box.append(head);
    if (spec.task) box.append(h('p', 'ex__task', spec.task));
    const body = h('div', 'ex__body');
    box.append(body);
    const foot = h('div', 'ex__foot');
    const score = h('span', 'ex__score');
    const reset = h('button', 'btn', 'начать заново');
    reset.type = 'button';
    reset.addEventListener('click', () => exercise(box, spec, { onFinish }));
    foot.append(score, reset);
    box.append(foot);

    const state = { total: 0, right: 0, mistakes: 0, missed: [] };
    const updateScore = () => {
      score.innerHTML = `верно <b>${state.right}</b> из <b>${state.total}</b> · ошибок <b>${state.mistakes}</b>`;
    };
    const finish = () => {
      box.classList.add('is-done');
      const result = h('div', 'ex__result');
      const clean = state.mistakes === 0;
      result.append(h('p', '', clean
        ? '<b>Без ошибок.</b> Слова этого упражнения вернутся на повтор через день.'
        : `<b>Готово, ошибок: ${state.mistakes}.</b> Фразы с ошибками попали в блок «Повтор» — он покажет их снова сегодня, пока не ответите без ошибки.`));
      if (state.missed.length) {
        const again = h('button', 'btn btn--dark', 'ещё раз только ошибки');
        again.type = 'button';
        again.addEventListener('click', () => exercise(box, onlyMissed(type, spec, state.missed), { onFinish }));
        const p = h('p', '');
        p.append(again);
        result.append(p);
      }
      box.insertBefore(result, foot);
      if (box.dataset.id) {
        const prev = done[box.dataset.id];
        done[box.dataset.id] = { right: state.right, total: state.total, mistakes: Math.min(state.mistakes, prev ? prev.mistakes : 99), at: Date.now() };
        store(KEY.done, done);
      }
      if (onFinish) onFinish(state);
    };

    const handlers = { match: runMatch, sort: runSort, order: runOrder, gap: runGap, listen: runListen, type: runType };
    (handlers[type] || (() => { body.textContent = 'Неизвестный вид упражнения: ' + type; }))(body, spec, state, updateScore, finish);
    updateScore();
  };

  const onlyMissed = (type, spec, missed) => {
    const keep = new Set(missed);
    const copy = { ...spec, title: (spec.title || 'Упражнение') + ' — ошибки' };
    if (type === 'match') copy.pairs = spec.pairs.filter(p => keep.has(p[0]));
    if (type === 'sort') copy.items = spec.items.filter(p => keep.has(p[0]));
    if (type === 'order') copy.items = spec.items.filter(p => keep.has(p.en));
    if (type === 'listen') copy.items = spec.items.filter(p => keep.has(p.join('|')));
    if (type === 'type') copy.items = spec.items.filter(p => keep.has(p.answer));
    if (type === 'gap') return spec;
    return copy;
  };

  // Сопоставление: английская плитка кладётся к своему значению.
  function runMatch(body, spec, state, update, finish) {
    const pairs = shuffle(spec.pairs);
    state.total = pairs.length;
    const list = h('div', 'pairs');
    const slots = pairs.map(([en, label, hint]) => {
      const pair = h('div', 'pair');
      const lab = h('div', 'pair__label', spec.labelHint ? ru(label) : esc(label));
      const slot = h('div', 'slot drop');
      slot.tabIndex = 0;
      slot.dataset.answer = en;
      slot.setAttribute('aria-label', 'Место для ответа: ' + label.replace(/[A-ZА-ЯЁ{}]/g, c => c.toLowerCase()));
      pair.append(lab, slot);
      list.append(pair);
      return { slot, en, label, hint };
    });
    const pool = h('div', 'pool drop');
    shuffle(pairs).forEach(([en]) => pool.append(makeTile(en, en, { speak: spec.speak !== false })));
    body.append(list, pool);
    const missed = new Set();
    dnd(body, (tile, zone) => {
      if (zone === pool || zone.classList.contains('is-filled')) return;
      const target = slots.find(s => s.slot === zone);
      const meta = { tr: spec.labelHint ? null : target.label };
      if (tile.dataset.value === target.en) {
        zone.append(tile);
        tile.classList.add('is-locked');
        tile.tabIndex = -1;
        zone.classList.add('is-filled');
        state.right += 1;
        if (tile.dataset.speak) say(tile.dataset.speak);
        if (spec.track !== false) record(target.en, meta, !missed.has(target.en));
      } else {
        wrong(tile);
        state.mistakes += 1;
        missed.add(tile.dataset.value);
        missed.add(target.en);
        state.missed = [...missed];
      }
      update();
      if (state.right === state.total) finish();
    });
  }

  // Сортировка по корзинам.
  function runSort(body, spec, state, update, finish) {
    const items = shuffle(spec.items);
    state.total = items.length;
    const wrap = h('div', 'buckets');
    const zones = spec.buckets.map((name, index) => {
      const bucket = h('div', 'bucket');
      const inner = h('div', 'bucket__items drop');
      inner.tabIndex = 0;
      inner.dataset.index = index;
      inner.setAttribute('aria-label', 'Корзина: ' + name);
      bucket.append(h('div', 'bucket__name', esc(name)), inner);
      wrap.append(bucket);
      return inner;
    });
    const pool = h('div', 'pool drop');
    items.forEach(([text, index]) => {
      const tile = makeTile(text, String(index), { speak: spec.speak !== false });
      pool.append(tile);
    });
    body.append(wrap, pool);
    const missed = new Set();
    dnd(body, (tile, zone) => {
      if (zone === pool) return;
      if (tile.dataset.value === zone.dataset.index) {
        zone.append(tile);
        tile.classList.add('is-locked');
        tile.tabIndex = -1;
        state.right += 1;
        if (tile.dataset.speak) say(tile.dataset.speak);
      } else {
        wrong(tile);
        state.mistakes += 1;
        missed.add(tile.textContent);
        state.missed = [...missed];
      }
      update();
      if (state.right === state.total) finish();
    });
  }

  // Сборка фразы: слова по порядку. Пунктуация на конце не учитывается.
  function runOrder(body, spec, state, update, finish) {
    const items = spec.shuffle === false ? spec.items.slice() : shuffle(spec.items);
    state.total = items.length;
    let index = 0;
    const show = () => {
      body.innerHTML = '';
      const stage = h('div', '');
      body.append(stage);
      const item = items[index];
      const tries = { n: 0 };
      // spell: слово диктуют по буквам, плитки — буквы, а не слова.
      const spell = !!item.spell;
      const spelled = item.en.toUpperCase().replace(/[^A-Z]/g, '').split('');
      const words1 = spell ? spelled : item.en.replace(/[.?!]$/, '').split(' ');
      const mark1 = spell ? null : item.en.match(/[.?!]$/);
      const step = h('p', 'order__step', `${spell ? 'слово' : 'фраза'} ${index + 1} из ${items.length}`);
      const ruLine = h('p', 'order__ru', esc(item.ru) + (item.note ? `<small>${esc(item.note)}</small>` : ''));
      const line = h('div', 'order__line drop');
      line.tabIndex = 0;
      line.setAttribute('aria-label', 'Строка для фразы');
      const pool = h('div', 'pool drop');
      pool.tabIndex = 0;
      shuffle(words1.concat(item.extra || [])).forEach(w => pool.append(makeTile(w, w)));
      if (spell) line.classList.add('order__line--letters');
      const row = h('div', 'btnrow');
      const check = h('button', 'btn btn--dark', 'проверить');
      const hear = h('button', 'btn', '▶ послушать ответ');
      hear.type = check.type = 'button';
      hear.hidden = !spell;
      if (spell) hear.textContent = '▶ послушать по буквам';
      row.append(check, hear);
      stage.append(step, ruLine, line, pool, row);
      const sayLetters = () => say(spelled.join(', '), { slow: profile.rate === 'slow' });
      // Первое задание само не звучит: браузеры не дают говорить до первого нажатия,
      // а несколько упражнений на странице перебивали бы друг друга.
      if (spell && index > 0) setTimeout(sayLetters, 300);

      dnd(stage, (tile, zone, point) => {
        line.classList.remove('is-wrong');
        if (zone === line && point) {
          const before = [...line.children].find(t => {
            if (t === tile) return false;
            const r = t.getBoundingClientRect();
            return point.y < r.bottom && (point.y < r.top || point.x < r.left + r.width / 2);
          });
          line.insertBefore(tile, before || null);
        } else if (zone === line) {
          line.append(tile);
        } else {
          pool.append(tile);
        }
      });
      // Нажатие по плитке в строке возвращает её в запас и обратно — быстрее, чем тащить.
      stage.addEventListener('dblclick', e => {
        const tile = e.target.closest('.tile');
        if (!tile) return;
        (tile.parentElement === line ? pool : line).append(tile);
      });

      hear.addEventListener('click', () => (spell && !solved ? sayLetters() : say(item.en)));
      let solved = false;
      check.addEventListener('click', () => {
        if (solved) { index += 1; index < items.length ? show() : finish(); return; }
        const got = [...line.children].map(t => t.dataset.value).join(spell ? '' : ' ');
        const ok = spell ? got === spelled.join('') : norm(got) === norm(item.en) || (item.alt || []).some(a => norm(a) === norm(got));
        if (ok) {
          solved = true;
          line.classList.add('is-right');
          [...line.children].forEach(t => { t.classList.add('is-locked'); t.tabIndex = -1; });
          [...pool.children].forEach(t => t.remove());
          if (mark1) line.lastElementChild.textContent += mark1[0];
          state.right += 1;
          record(item.en, { tr: item.ru }, tries.n === 0);
          update();
          say(item.en);
          hear.hidden = false;
          if (spell) hear.textContent = '▶ послушать слово';
          check.textContent = index + 1 < items.length ? 'дальше →' : 'завершить';
        } else {
          tries.n += 1;
          state.mistakes += 1;
          if (!state.missed.includes(item.en)) state.missed.push(item.en);
          line.classList.add('is-wrong');
          update();
          if (tries.n >= 2 && !stage.querySelector('.order__answer')) {
            stage.append(h('p', 'order__answer', `Правильно: <b>${esc(item.en)}</b>${item.why ? ' — ' + esc(item.why) : ''}`));
            hear.hidden = false;
          }
        }
      });
    };
    show();
  }

  // Диктант: звучит число, время или фраза — ответ печатается в поле.
  // Пробелы, дефисы, точки, запятые, двоеточие и знак $ при сравнении не учитываются.
  function runType(body, spec, state, update, finish) {
    const items = spec.shuffle === false ? spec.items.slice() : shuffle(spec.items);
    const clean = v => String(v).toLowerCase().replace(/[\s\-–—.,:$€£()+]/g, '');
    state.total = items.length;
    let index = 0;
    const show = () => {
      body.innerHTML = '';
      const item = items[index];
      let tries = 0, solved = false;
      body.append(h('p', 'order__step', `задание ${index + 1} из ${items.length}`));
      if (item.ru) body.append(h('p', 'order__ru', esc(item.ru)));
      const row = h('div', 'listen');
      const play = sayButton(item.say, { label: 'Послушать ещё раз' });
      const input = h('input', 'typein');
      input.type = 'text';
      input.autocomplete = 'off';
      input.inputMode = /^[\d\s:.,$€£+-]+$/.test(item.answer) ? 'decimal' : 'text';
      input.placeholder = item.placeholder || 'нажмите ▶ и запишите';
      input.setAttribute('aria-label', 'Ответ');
      row.append(play, input);
      const btns = h('div', 'btnrow');
      const check = h('button', 'btn btn--dark', 'проверить');
      check.type = 'button';
      btns.append(check, sayButton(item.say, { slow: true }), h('span', 'order__step', 'медленнее'));
      btns.style.alignItems = 'center';
      body.append(row, btns);
      if (index > 0) { setTimeout(() => say(item.say, { el: play }), 250); input.focus({ preventScroll: true }); }
      const go = () => {
        if (solved) { index += 1; index < items.length ? show() : finish(); return; }
        const got = clean(input.value);
        if (!got) return;
        const ok = [item.answer].concat(item.alt || []).some(a => clean(a) === got);
        input.classList.remove('is-right', 'is-wrong');
        void input.offsetWidth;
        if (ok) {
          solved = true;
          input.classList.add('is-right');
          input.readOnly = true;
          state.right += 1;
          update();
          body.append(h('p', 'order__answer', `<b>${esc(item.answer)}</b>${item.how ? ' — ' + esc(item.how) : ''}`));
          check.textContent = index + 1 < items.length ? 'дальше →' : 'завершить';
        } else {
          tries += 1;
          state.mistakes += 1;
          if (!state.missed.includes(item.answer)) state.missed.push(item.answer);
          input.classList.add('is-wrong');
          update();
          say(item.say, { el: play });
          if (tries >= 2 && !body.querySelector('.order__answer')) {
            body.append(h('p', 'order__answer', `Правильно: <b>${esc(item.answer)}</b>${item.how ? ' — ' + esc(item.how) : ''}`));
          }
        }
      };
      check.addEventListener('click', go);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    };
    show();
  }

  // Пропуски: {слово} в тексте — место для плитки.
  function runGap(body, spec, state, update, finish) {
    const text = h('div', 'gaptext');
    const answers = [];
    spec.lines.forEach(src => {
      const p = h('p', '');
      p.innerHTML = esc(src).replace(/\{([^}]+)\}/g, (_, w) => {
        answers.push(w);
        return `<span class="gap drop" tabindex="0" data-answer="${esc(w)}" aria-label="пропуск"></span>`;
      });
      text.append(p);
    });
    state.total = answers.length;
    const pool = h('div', 'pool drop');
    shuffle(answers.concat(spec.extra || [])).forEach(w => pool.append(makeTile(w, w)));
    body.append(text, pool);
    dnd(body, (tile, zone) => {
      if (zone === pool || zone.classList.contains('is-filled')) return;
      if (norm(tile.dataset.value) === norm(zone.dataset.answer)) {
        zone.append(tile);
        zone.classList.add('is-filled');
        tile.classList.add('is-locked');
        tile.tabIndex = -1;
        state.right += 1;
        const line = zone.closest('p').textContent.replace(/^[—–-]\s*/, '');
        if (!zone.closest('p').querySelector('.gap:not(.is-filled)')) say(line);
      } else {
        wrong(tile);
        state.mistakes += 1;
      }
      update();
      if (state.right === state.total) finish();
    });
  }

  // На слух: звучит одно слово из набора, его плитка кладётся в «ухо».
  function runListen(body, spec, state, update, finish) {
    const items = shuffle(spec.items);
    state.total = items.length;
    let index = 0;
    const show = () => {
      body.innerHTML = '';
      const stage = h('div', '');
      body.append(stage);
      const options = items[index];
      // Какое слово прозвучит, решается случайно: угадать по порядку нельзя.
      const target = spec.fixed ? options[0] : options[Math.floor(Math.random() * options.length)];
      let miss = false;
      const step = h('p', 'order__step', `слово ${index + 1} из ${items.length}`);
      const row = h('div', 'listen');
      const play = sayButton(target, { label: 'Послушать ещё раз' });
      const ear = h('div', 'ear drop', 'нажмите ▶ и положите сюда слово, которое услышали');
      ear.tabIndex = 0;
      row.append(play, ear);
      const pool = h('div', 'pool drop');
      shuffle(options).forEach(w => pool.append(makeTile(w, w)));
      const slow = h('div', 'btnrow');
      slow.append(sayButton(target, { slow: true }), h('span', '', 'медленнее'));
      slow.style.alignItems = 'center';
      stage.append(step, row, pool, slow);
      if (index > 0) setTimeout(() => say(target, { el: play }), 250);
      dnd(stage, (tile, zone) => {
        if (zone !== ear) return;
        if (tile.dataset.value === target) {
          ear.textContent = '';
          ear.append(tile);
          ear.classList.add('is-filled');
          tile.classList.add('is-locked');
          state.right += 1;
          record(target, {}, !miss);
          update();
          const meta = words[target];
          const note = h('p', 'order__answer', `<b>${esc(target)}</b>` + (meta && meta.ipa ? ` /${esc(meta.ipa)}/` : '') + (meta && meta.ru ? ' ' + ru(meta.ru) : '') + (meta && meta.tr ? ' — ' + esc(meta.tr) : ''));
          stage.append(note);
          setTimeout(() => { index += 1; index < items.length ? show() : finish(); }, 1400);
        } else {
          wrong(tile);
          miss = true;
          state.mistakes += 1;
          const key = options.join('|');
          if (!state.missed.includes(key)) state.missed.push(key);
          update();
          say(target, { el: play });
        }
      });
    };
    show();
  }

  document.querySelectorAll('.ex[data-type]').forEach(box => {
    const spec = data(box);
    if (spec) exercise(box, spec);
  });

  /* ---- 5. Повтор слов ---------------------------------------------- */
  function renderReview(box) {
    const all = Object.entries(words).filter(([, w]) => w.seen);
    const now = Date.now();
    const due = all.filter(([, w]) => w.due <= now && w.tr);
    const learned = all.filter(([, w]) => w.box >= 3);
    const hard = all.filter(([, w]) => w.wrong > 0).sort((a, b) => (b[1].wrong - b[1].right) - (a[1].wrong - a[1].right)).slice(0, 6);
    if (box.querySelector('.ex.is-running')) return; // идёт повтор — не перерисовываем под рукой

    box.innerHTML = '';
    box.append(h('div', 'review__head', '<span>Повтор · подстраивается под ваши ошибки</span>'));
    const stats = h('div', 'review__stats');
    stats.innerHTML = `<div><b>${due.length}</b><span>на повтор сегодня</span></div>`
      + `<div><b>${all.length}</b><span>фраз в работе</span></div>`
      + `<div><b>${learned.length}</b><span>держатся в памяти</span></div>`;
    box.append(stats);
    const inner = h('div', 'review__body');
    box.append(inner);
    if (!box.dataset.noDict) {
      const more = h('a', 'review__dict', 'все фразы и слова — в словаре →');
      more.href = base + 'slovar/index.html';
      box.querySelector('.review__head').append(more);
    }
    if (!all.length) {
      inner.append(h('p', '', 'Пока пусто. Сюда попадают фразы из упражнений: ошибка возвращает фразу на повтор в тот же день, верный ответ отодвигает повтор на 1, 2, 4, 8 и 16 дней.'));
      return;
    }
    if (hard.length) {
      inner.append(h('p', '', 'Чаще всего ошибки здесь:'));
      const list = h('div', 'review__hard');
      hard.forEach(([en, w]) => {
        const item = h('span', 'w');
        item.innerHTML = '';
        const b = h('button', 'w__say', esc(en));
        b.type = 'button';
        b.addEventListener('click', () => say(en, { el: b }));
        item.append(b);
        if (w.ipa) item.append(h('span', 'w__ipa', `/${esc(w.ipa)}/`));
        if (w.ru) item.append(h('span', 'w__ru', ru(w.ru)));
        list.append(item);
      });
      inner.append(list);
    }
    if (due.length < 2) {
      const next = all.filter(([, w]) => w.due > now).sort((a, b) => a[1].due - b[1].due)[0];
      inner.append(h('p', '', next
        ? `Сегодня повторять нечего. Ближайший повтор — ${new Date(next[1].due).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}.`
        : 'Сегодня повторять нечего.'));
      return;
    }
    const go = h('button', 'btn btn--dark', `повторить ${Math.min(due.length, 6)} фраз`);
    go.type = 'button';
    inner.append(go);
    go.addEventListener('click', () => {
      const pick = shuffle(due).slice(0, 6);
      const ex = h('div', 'ex is-running');
      ex.dataset.type = 'match';
      go.replaceWith(ex);
      exercise(ex, {
        title: 'Повтор', task: 'Перетащите английскую фразу к её значению. Ошибка вернёт фразу на повтор.',
        pairs: pick.map(([en, w]) => [en, w.tr]),
      }, { onFinish: () => { ex.classList.remove('is-running'); } });
    });
  }
  document.querySelectorAll('.review').forEach(renderReview);

  /* ---- Профиль на обложке и прогресс глав ------------------------ */
  function renderProfile(el) {
    const level = LEVELS[profile.level] || LEVELS.a1;
    el.innerHTML = `<b>${profile.level.toUpperCase()}</b> · ${level.name}`
      + ` · акцент ${profile.accent === 'gb' ? 'британский' : 'американский'}`
      + (profile.tested ? '' : ' · <span>уровень не проверен</span>');
  }
  document.querySelectorAll('[data-progress]').forEach(el => {
    const [prefix, count] = el.dataset.progress.split(':');
    const finished = Object.keys(done).filter(id => id.startsWith(prefix + '-')).length;
    if (finished) el.textContent = `${Math.min(finished, +count)}/${count}`;
    if (finished >= +count) el.textContent = 'пройдено';
  });

  /* ---- Настройки в шапке ------------------------------------------ */
  const prefsBars = [];
  const bar = (label, key, items) => {
    const wrap = h('div', 'langbar');
    wrap.append(h('span', 'langbar__label', label));
    items.forEach(([value, title]) => {
      const button = h('button', '', title);
      button.type = 'button';
      button.dataset.value = value;
      button.addEventListener('click', () => {
        setProfile({ [key]: value });
        if (key === 'accent') document.querySelectorAll('.voice-status').forEach(renderVoiceStatus);
      });
      wrap.append(button);
    });
    prefsBars.push({ wrap, key });
    return wrap;
  };
  function syncPrefs() {
    prefsBars.forEach(({ wrap, key }) => wrap.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === profile[key]))));
  }
  const running = document.querySelector('.running');
  if (running && !document.body.dataset.noPrefs) {
    // На узком экране настройки свёрнуты, чтобы не занимать первый экран.
    const box = h('details', 'prefs-box');
    box.open = !matchMedia('(max-width: 700px)').matches;
    box.append(h('summary', '', 'настройки'));
    const prefs = h('div', 'prefs');
    box.append(prefs);
    prefs.append(
      bar('акцент', 'accent', [['us', 'US'], ['gb', 'UK']]),
      bar('подсказка', 'hint', [['both', 'обе'], ['ru', 'рус'], ['ipa', 'IPA']]),
      bar('перевод', 'tr', [['show', 'виден'], ['tap', 'по нажатию']]),
      bar('темп', 'rate', [['normal', 'обычный'], ['slow', 'медленный']]),
    );
    running.insertBefore(box, running.querySelector('.running__folio'));
  }

  // Ссылка на словарь в шапке каждой страницы.
  if (running && !document.body.dataset.noDict) {
    const link = h('a', 'dict-link', 'словарь');
    link.href = base + 'slovar/index.html';
    running.insertBefore(link, running.querySelector('.running__folio'));
  }

  // Перевод в статичной разметке тоже открывается нажатием.
  document.addEventListener('click', event => {
    const tr = event.target.closest('.tr');
    if (tr) tr.classList.add('is-open');
  });

  document.querySelectorAll('.voice-status').forEach(renderVoiceStatus);
  applyProfile();
  syncPrefs();

  // Для страниц со своими сценариями (стартовая проверка).
  window.EN = { say, stop, sayButton, ru, profile, setProfile, LEVELS, words, record, remember, exercise, store: () => store(KEY.words, words), esc, h };
})();
