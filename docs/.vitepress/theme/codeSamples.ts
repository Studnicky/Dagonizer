const OBSERVER_OPTIONS: MutationObserverInit = {
  'childList': true,
  'subtree':   true,
};

const HEADER_CLASS = 'dagonizer-code-sample__header';

export const CodeSampleChrome = {
  install(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const upgrade = (): void => {
      for (const block of document.querySelectorAll<HTMLElement>('.vp-doc div[class*="language-"]')) {
        upgradeCodeBlock(block);
      }
    };

    upgrade();
    const observer = new MutationObserver(() => upgrade());
    observer.observe(document.body, OBSERVER_OPTIONS);
  },
};

function upgradeCodeBlock(block: HTMLElement): void {
  if (block.querySelector(`:scope > .${HEADER_CLASS}`) !== null) return;

  block.classList.add('ui-code-block', 'ui-code-block--source');

  const copyButton = block.querySelector<HTMLElement>(':scope > button.copy');
  const lang = block.querySelector<HTMLElement>(':scope > span.lang');
  if (copyButton === null && lang === null) return;

  const header = document.createElement('div');
  header.className = HEADER_CLASS;
  header.classList.add('ui-code-block__header');

  const titleGroup = document.createElement('div');
  titleGroup.className = 'dagonizer-code-sample__title-group';
  titleGroup.classList.add('ui-code-block__title-group');

  const title = document.createElement('span');
  title.className = 'dagonizer-code-sample__title';
  title.classList.add('ui-code-block__title');
  title.textContent = deriveSampleTitle(block, lang);
  titleGroup.appendChild(title);

  if (lang !== null) {
    lang.classList.add('dagonizer-code-sample__meta');
    lang.classList.add('ui-code-block__meta');
    titleGroup.appendChild(lang);
  }

  header.appendChild(titleGroup);
  if (copyButton !== null) header.appendChild(copyButton);
  block.prepend(header);

  const pre = block.querySelector<HTMLElement>(':scope > pre');
  if (pre !== null) pre.classList.add('ui-code-block__body');
}

function deriveSampleTitle(block: HTMLElement, lang: HTMLElement | null): string {
  const language = block.dataset.language ?? lang?.textContent?.trim() ?? 'code';
  const normalized = language.toLowerCase();

  if (normalized === 'bash' || normalized === 'sh' || normalized === 'shell' || normalized === 'shellscript') {
    return 'Command';
  }

  if (normalized === 'json' || normalized === 'jsonc') return 'JSON';
  if (normalized === 'diff' || normalized === 'patch') return 'Diff';
  if (normalized === 'mermaid') return 'Mermaid';

  return `${languageLabel(language)} sample`;
}

function languageLabel(language: string): string {
  if (language.length === 0) return 'Code';
  return language
    .split(/[-_\s]+/u)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
