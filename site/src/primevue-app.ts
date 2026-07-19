import PrimeVue from 'primevue/config';

const baseFieldClasses =
  'w-full hex-chrome bg-white/6 px-4.5 py-3.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-400/25 disabled:cursor-not-allowed disabled:opacity-60';

export default (app: Parameters<NonNullable<import('@astrojs/vue').AstroVueOptions['appEntrypoint']>>[0]) => {
  app.use(PrimeVue, {
    unstyled: true,
    pt: {
      button: {
        root: ({ props }: { props: { severity?: string; variant?: string; text?: boolean } }) => ({
          class: [
            'inline-flex items-center justify-center gap-2 hex-chrome text-sm font-medium transition duration-150',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/35 disabled:cursor-not-allowed disabled:opacity-60',
            props.text
              ? 'bg-transparent px-3.5 py-2.5 text-slate-200 hover:bg-white/6 hover:text-white'
              : props.variant === 'outlined' || props.severity === 'contrast'
                ? 'bg-white/4 px-5 py-3 text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-400/10'
                : 'bg-cyan-400/14 px-5 py-3 text-cyan-100 shadow-[0_0_0_1px_rgba(34,232,255,0.1)] hover:bg-cyan-400/22'
          ]
        }),
        label: 'font-medium'
      },
      tag: {
        root: 'inline-flex items-center hex-tag bg-violet-400/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-100'
      },
      card: {
        root: 'hex-tile bg-slate-950/72 shadow-[0_22px_80px_-36px_rgba(15,23,42,0.95)] backdrop-blur',
        body: 'flex h-full flex-col gap-4 p-7',
        caption: 'flex flex-col gap-2',
        title: 'text-base font-semibold text-white',
        subtitle: 'text-sm text-slate-400',
        content: 'text-sm leading-6 text-slate-300'
      },
      breadcrumb: {
        root: 'border-0 bg-transparent p-0',
        list: 'flex flex-wrap items-center gap-4',
        itemLink: 'inline-flex items-center px-3.5 py-1.5 hex-chrome text-[11px] leading-none uppercase tracking-[0.22em] text-slate-500 transition hover:text-slate-300',
        separator: 'text-slate-700',
        itemIcon: 'text-slate-500',
        homeItemLink: 'inline-flex items-center px-3.5 py-1.5 hex-chrome text-[11px] leading-none uppercase tracking-[0.22em] text-slate-500 transition hover:text-slate-300'
      },
      drawer: {
        root: 'border-l border-white/10 bg-slate-950/96 text-slate-100 shadow-2xl backdrop-blur-xl',
        header: 'border-b border-white/8 px-6 py-5',
        title: 'text-sm font-semibold uppercase tracking-[0.2em] text-slate-100',
        content: 'px-6 py-6',
        pcCloseButton: {
          root: 'inline-flex h-11 w-11 items-center justify-center hex-chrome bg-white/4 text-slate-300 transition hover:bg-white/8 hover:text-white'
        }
      },
      accordion: {
        root: 'flex flex-col gap-4'
      },
      accordionpanel: {
        root: 'overflow-hidden hex-tile bg-slate-950/72'
      },
      accordionheader: {
        root: 'w-full px-6 py-5 text-left text-sm font-medium text-white transition hover:bg-white/5'
      },
      accordioncontent: {
        content: 'px-6 pb-6 text-sm leading-6 text-slate-300'
      },
      tabs: {
        root: 'flex flex-col gap-4'
      },
      tablist: {
        root: 'inline-flex w-full flex-wrap gap-3 hex-tile bg-slate-950/72 p-3'
      },
      tab: {
        root: 'hex-chrome px-5 py-3 text-sm font-medium text-slate-300 transition data-[p-active=true]:bg-cyan-400/16 data-[p-active=true]:text-cyan-100 hover:text-white'
      },
      tabpanels: {
        root: 'hex-tile bg-slate-950/72 p-6'
      },
      select: {
        root: `${baseFieldClasses} flex items-center justify-between gap-3`,
        label: 'truncate',
        dropdown: 'text-slate-400',
        overlay: 'mt-2 overflow-hidden hex-tile bg-slate-950/96 p-2 shadow-2xl backdrop-blur',
        option: 'cursor-pointer hex-chrome px-4 py-2.5 text-sm text-slate-200 transition hover:bg-white/8',
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
