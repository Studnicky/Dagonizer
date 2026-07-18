import PrimeVue from 'primevue/config';

const baseFieldClasses =
  'w-full rounded-xl border border-white/12 bg-white/6 px-3.5 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-400/25 disabled:cursor-not-allowed disabled:opacity-60';

export default (app: Parameters<NonNullable<import('@astrojs/vue').AstroVueOptions['appEntrypoint']>>[0]) => {
  app.use(PrimeVue, {
    unstyled: true,
    pt: {
      button: {
        root: ({ props }: { props: { severity?: string; variant?: string; text?: boolean } }) => ({
          class: [
            'inline-flex items-center justify-center gap-2 rounded-xl border text-sm font-medium transition duration-150',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/35 disabled:cursor-not-allowed disabled:opacity-60',
            props.text
              ? 'border-transparent bg-transparent text-slate-200 hover:text-white'
              : props.variant === 'outlined' || props.severity === 'contrast'
                ? 'border-white/14 bg-white/4 px-4 py-2.5 text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-400/10'
                : 'border-cyan-400/30 bg-cyan-400/14 px-4 py-2.5 text-cyan-100 shadow-[0_0_0_1px_rgba(34,232,255,0.1)] hover:bg-cyan-400/22'
          ]
        }),
        label: 'font-medium'
      },
      tag: {
        root: 'inline-flex items-center rounded-full border border-violet-400/25 bg-violet-400/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-100'
      },
      card: {
        root: 'rounded-2xl border border-white/10 bg-slate-950/72 shadow-[0_22px_80px_-36px_rgba(15,23,42,0.95)] backdrop-blur',
        body: 'flex h-full flex-col gap-4 p-6',
        caption: 'flex flex-col gap-2',
        title: 'text-base font-semibold text-white',
        subtitle: 'text-sm text-slate-400',
        content: 'text-sm leading-6 text-slate-300'
      },
      menubar: {
        root: 'flex items-center rounded-2xl border border-white/10 bg-slate-950/78 px-2 py-2 shadow-[0_18px_64px_-36px_rgba(15,23,42,0.9)] backdrop-blur',
        start: 'flex items-center gap-3',
        rootList: 'flex list-none items-center gap-1',
        item: 'relative',
        itemContent: 'rounded-lg transition hover:bg-white/6',
        itemLink: 'flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300 hover:text-white',
        submenu: 'absolute left-0 top-full z-50 mt-1 flex min-w-48 list-none flex-col gap-1 rounded-xl border border-white/10 bg-slate-950/95 p-2 shadow-[0_18px_64px_-36px_rgba(15,23,42,0.9)] backdrop-blur',
        submenuIcon: 'ml-2 text-slate-500',
        mobileButton: 'inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-200'
      },
      menu: {
        root: 'rounded-2xl border border-white/10 bg-slate-950/72 p-2 shadow-[0_18px_64px_-36px_rgba(15,23,42,0.9)] backdrop-blur',
        list: 'flex flex-col gap-2',
        itemContent: 'rounded-xl border border-white/10 bg-white/4 transition hover:border-cyan-300/30 hover:bg-cyan-400/10',
        itemLink: 'flex items-center rounded-xl px-4 py-3 text-sm font-medium text-slate-200 hover:text-white',
        itemIcon: 'text-slate-400',
        separator: 'my-1 border-t border-white/8'
      },
      breadcrumb: {
        root: 'border-0 bg-transparent p-0',
        list: 'flex flex-wrap items-center gap-2',
        itemLink: 'rounded-md text-xs uppercase tracking-[0.24em] text-slate-500 transition hover:text-slate-300',
        separator: 'text-slate-700',
        itemIcon: 'text-slate-500',
        homeItemLink: 'rounded-md text-xs uppercase tracking-[0.24em] text-slate-500 transition hover:text-slate-300'
      },
      drawer: {
        root: 'border-l border-white/10 bg-slate-950/96 text-slate-100 shadow-2xl backdrop-blur-xl',
        header: 'border-b border-white/8 px-5 py-4',
        title: 'text-sm font-semibold uppercase tracking-[0.2em] text-slate-100',
        content: 'px-5 py-5',
        pcCloseButton: {
          root: 'inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/4 text-slate-300 transition hover:bg-white/8 hover:text-white'
        }
      },
      accordion: {
        root: 'flex flex-col gap-3'
      },
      accordionpanel: {
        root: 'overflow-hidden rounded-2xl border border-white/10 bg-slate-950/72'
      },
      accordionheader: {
        root: 'w-full px-5 py-4 text-left text-sm font-medium text-white transition hover:bg-white/5'
      },
      accordioncontent: {
        content: 'px-5 pb-5 text-sm leading-6 text-slate-300'
      },
      tabs: {
        root: 'flex flex-col gap-4'
      },
      tablist: {
        root: 'inline-flex w-full flex-wrap gap-2 rounded-2xl border border-white/10 bg-slate-950/72 p-2'
      },
      tab: {
        root: 'rounded-xl px-4 py-2.5 text-sm font-medium text-slate-300 transition data-[p-active=true]:bg-cyan-400/16 data-[p-active=true]:text-cyan-100 hover:text-white'
      },
      tabpanels: {
        root: 'rounded-2xl border border-white/10 bg-slate-950/72 p-5'
      },
      select: {
        root: `${baseFieldClasses} flex items-center justify-between gap-3`,
        label: 'truncate',
        dropdown: 'text-slate-400',
        overlay: 'mt-2 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/96 p-1 shadow-2xl backdrop-blur',
        option: 'cursor-pointer rounded-xl px-3 py-2 text-sm text-slate-200 transition hover:bg-white/8',
        optionLabel: 'text-sm',
        header: 'hidden'
      },
      inputtext: {
        root: baseFieldClasses
      },
      textarea: {
        root: `${baseFieldClasses} min-h-28 resize-y`
      },
      divider: {
        root: 'my-1 border-t border-white/8'
      }
    }
  });
};
