"""Собирает словарь книги из глав: slovar/dict.js.

Источники в каждой главе temy/*/index.html:
  .vocab    — JSON [[en, ipa, ru, перевод], ...]
  .dialog   — реплики [кто, en, перевод, ru]
  .parse    — разбор слова с data-tr
  .w        — слово с data-tr
Одинаковые записи склеиваются, у записи остаётся список глав, где она встречается.

Запуск: python3 tools/build_dict.py  (из корня книги). После правки любой главы — перезапустить.
"""
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'slovar' / 'dict.js'

ATTR = re.compile(r'([\w-]+)="([^"]*)"')


def attrs(tag):
    return {k: html.unescape(v) for k, v in ATTR.findall(tag)}


def key(en):
    return re.sub(r'[.?!,]+$', '', en.strip()).lower()


def kind(en):
    words = en.strip().split()
    return 'phrase' if re.search(r'[.?!]$', en.strip()) or len(words) >= 3 else 'word'


def chapter_info(path, text):
    num = re.search(r'<span class="chapter-num">([^<]+)</span>', text).group(1)
    title = re.sub(r'<[^>]+>', ' ', re.search(r'<h1>(.*?)</h1>', text, re.S).group(1))
    title = re.sub(r'\s+', ' ', html.unescape(title)).strip()
    module = re.search(r'модуль (\d+) · ([^<]+)</p>', text)
    return {
        'num': num,
        'title': title,
        'href': f'../temy/{path.parent.name}/index.html',
        'module': int(module.group(1)) if module else 0,
        'moduleName': module.group(2).strip() if module else '',
    }


def main():
    entries = {}
    chapters = []

    def add(en, ipa, ru, tr, ch, src):
        en = en.strip()
        if not en or not tr:
            return
        k = key(en)
        item = entries.get(k)
        if not item:
            item = entries[k] = {'en': en, 'ipa': '', 'ru': '', 'tr': tr, 'kind': kind(en), 'ch': [], 'src': src}
        for field, value in (('ipa', ipa), ('ru', ru)):
            if value and not item[field]:
                item[field] = value
        if ch not in item['ch']:
            item['ch'].append(ch)

    for path in sorted(ROOT.glob('temy/*/index.html')):
        text = path.read_text(encoding='utf-8')
        if 'class="chapter-num"' not in text:
            continue
        info = chapter_info(path, text)
        chapters.append(info)
        ch = info['num']

        for block in re.findall(r'<div class="vocab"[^>]*>\s*<script type="application/json">(.*?)</script>', text, re.S):
            for en, ipa, ru, tr in json.loads(block):
                add(en, ipa, ru, tr, ch, 'vocab')

        for block in re.findall(r'<div class="dialog"[^>]*>\s*<script type="application/json">(.*?)</script>', text, re.S):
            for line in json.loads(block)['lines']:
                _, en, tr, *rest = line
                add(en, '', rest[-1] if rest else '', tr, ch, 'dialog')

        for tag, body in re.findall(r'(<span class="parse"[^>]*>)(.*?)</span>', text):
            a = attrs(tag)
            word = a.get('data-say') or re.sub(r'[\[\](){}|]', '', html.unescape(body))
            add(word, a.get('data-ipa', ''), a.get('data-ru', ''), a.get('data-tr', ''), ch, 'parse')

        for tag, body in re.findall(r'(<span class="w"[^>]*>)(.*?)</span>', text):
            a = attrs(tag)
            if 'data-tr' in a:
                add(a.get('data-say') or html.unescape(body), a.get('data-ipa', ''), a.get('data-ru', ''), a['data-tr'], ch, 'w')

    order = {c['num']: i for i, c in enumerate(chapters)}
    items = sorted(entries.values(), key=lambda e: (order[e['ch'][0]], e['kind'] != 'word'))
    for item in items:
        item.pop('src')
    OUT.write_text(
        '/* Собрано tools/build_dict.py из глав — руками не править. */\n'
        f'window.DICT = {json.dumps({"chapters": chapters, "items": items}, ensure_ascii=False, indent=0)};\n',
        encoding='utf-8')
    words = sum(1 for e in items if e['kind'] == 'word')
    print(f'{len(items)} записей: слов {words}, фраз {len(items) - words}, глав {len(chapters)}')
    for c in chapters:
        n = sum(1 for e in items if c['num'] in e['ch'])
        print(f"  {c['num']:>4} {n:>3}  {c['title']}")


if __name__ == '__main__':
    main()
