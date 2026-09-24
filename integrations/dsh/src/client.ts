/**
 * Client half of the Refyard plugin: the Git panel in the Harness Web UI.
 *
 * Two registrations, and neither of them draws a Git UI — the workbench itself is Refyard's
 * own SPA, served by the host half and shown here in a frame. Reimplementing history, diffs
 * and staging in React would be a second product to keep in step with the first, and the
 * frame is same-origin with this page, so it inherits the page's authentication and the
 * browser's own navigation without a bridge.
 *
 * The one thing this half owns is *which* repository the frame opens: it asks the host for
 * the current session's workbench URL rather than guessing, so the panel answers "the
 * repository this session is working in" instead of "the last repository anyone opened".
 */

window.__ModuleLoader__.load({
  id: '@refyard/dsh-plugin',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Slot id, sidebar entry key, main-panel key and right-tab kind. */
    const PANEL_ID = 'refyard'
    /** The right-Sidebar tab type's identity; also the key its body registers under. */
    const TAB_ID = '@refyard/dsh-plugin'
    const TAB_KIND = 'refyard-git'
    const NS = 'refyard'
    /** The host half mounts the workbench here. */
    const CONTEXT_URL = '/refyard/dsh/context'

    const DICTS: Record<string, Record<string, string>> = {
      en: {
        panel: 'Git',
        loading: 'Opening the workbench…',
        failed: 'The Git panel could not reach Refyard',
        retry: 'Retry',
        frameTitle: 'Refyard Git workbench',
        openInPanel: 'Open the Git workbench in the side panel',
      },
      zh: {
        panel: 'Git',
        loading: '正在打开工作台…',
        failed: 'Git 面板无法连接 Refyard',
        retry: '重试',
        frameTitle: 'Refyard Git 工作台',
        openInPanel: '在右侧面板打开 Git 工作台',
      },
    }

    /**
     * Apply-closure translate.
     *
     * The components are created before any plugin is applied, so they cannot capture the
     * locale service; the English dictionary is the fallback for the moment before `apply`
     * runs and for a composition that has no locale service at all.
     */
    let boundT: ((key: string) => string) | null = null
    function translate(key: string): string {
      if (boundT !== null) {
        return boundT(key)
      }
      return DICTS['en']?.[key] ?? key
    }

    /** The applied context, for the components that act on the shell (opening the side tab). */
    let boundContext: HarnessClientContext | null = null

    /** The panel's square nav icon: a commit graph, drawn in the host's own colours. */
    function RefyardIcon({ size }: { size?: number }) {
      const edge = typeof size === 'number' ? size : 18
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: edge,
          height: edge,
          'aria-hidden': true,
          fill: 'none',
          stroke: 'currentColor',
          style: { display: 'block' },
        },
        [
          h('line', {
            key: 'trunk',
            x1: 7,
            y1: 3,
            x2: 7,
            y2: 21,
            strokeWidth: 2,
            strokeLinecap: 'round',
          }),
          h('line', {
            key: 'branch',
            x1: 7,
            y1: 10,
            x2: 17,
            y2: 10,
            strokeWidth: 2,
            strokeLinecap: 'round',
          }),
          h('line', {
            key: 'stem',
            x1: 17,
            y1: 10,
            x2: 17,
            y2: 16,
            strokeWidth: 2,
            strokeLinecap: 'round',
          }),
          h('circle', { key: 'a', cx: 7, cy: 6, r: 2.4, fill: 'currentColor', stroke: 'none' }),
          h('circle', { key: 'b', cx: 7, cy: 16, r: 2.4, fill: 'currentColor', stroke: 'none' }),
          h('circle', { key: 'c', cx: 17, cy: 18, r: 2.4, fill: 'currentColor', stroke: 'none' }),
        ],
      )
    }

    /**
     * The panel: a frame on the host's workbench URL.
     *
     * The URL is fetched rather than composed because loading it is a pairing redirect — the
     * frame is authenticated by a single-use ticket the host mints per document load — and
     * because only the host knows which repository this Session is about. `sessionId` is
     * what makes a right-column tab belong to the project it was opened in.
     *
     * `mode=single` is the difference between the two places this frame is mounted. In the
     * side column the host owns repository selection — one repository, no strip of tabs for
     * the others it happens to know about. The full workbench in the main panel keeps its
     * tabs, because there the reader is the one choosing between repositories.
     */
    function RefyardPanel({ sessionId, mode }: { sessionId?: unknown; mode?: "single" }) {
      const [frameUrl, setFrameUrl] = React.useState<string | null>(null)
      const [failure, setFailure] = React.useState<string | null>(null)
      const [attempt, setAttempt] = React.useState(0)

      React.useEffect(() => {
        let live = true
        setFailure(null)
        const query = new URLSearchParams()
        if (typeof sessionId === 'string' && sessionId !== '') {
          query.set('session', sessionId)
        }
        if (mode === 'single') {
          query.set('mode', 'single')
        }
        const suffix = query.size === 0 ? '' : `?${query.toString()}`
        fetch(`${CONTEXT_URL}${suffix}`, { headers: { accept: 'application/json' } })
          .then((response) => {
            if (!response.ok) {
              throw new Error(`context request answered ${String(response.status)}`)
            }
            return response.json() as Promise<{ panelUrl?: unknown }>
          })
          .then((payload) => {
            if (live) {
              setFrameUrl(withSingleMode(String(payload.panelUrl), mode === 'single'))
            }
          })
          .catch((error: unknown) => {
            if (live) {
              setFailure(error instanceof Error ? error.message : String(error))
            }
          })
        return () => {
          live = false
        }
      }, [attempt, sessionId])

      if (failure !== null) {
        return h(
          'div',
          { style: { display: 'grid', placeItems: 'center', height: '100%', gap: 12 } },
          h('p', { style: { margin: 0, opacity: 0.8 } }, `${translate('failed')} (${failure})`),
          h(
            'button',
            {
              type: 'button',
              onClick: () => setAttempt((value) => value + 1),
              style: {
                padding: '6px 14px',
                borderRadius: 8,
                border: '1px solid rgba(128,128,128,.4)',
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
              },
            },
            translate('retry'),
          ),
        )
      }

      if (frameUrl === null) {
        return h(
          'div',
          { style: { display: 'grid', placeItems: 'center', height: '100%', opacity: 0.7 } },
          h('p', { style: { margin: 0 } }, translate('loading')),
        )
      }

      return h('iframe', {
        src: frameUrl,
        title: translate('frameTitle'),
        style: {
          display: 'block',
          width: '100%',
          height: '100%',
          border: 'none',
          background: 'transparent',
        },
      })
    }

    /**
     * The Session-header control that reveals the Git tab in the right column.
     *
     * This is the seat that answers "a different repository for every project": the right
     * column is Session-scoped and its layout is recorded per Session, so a project that has
     * opened the workbench keeps it, showing that project's repository — not whichever one
     * was opened last anywhere.
     */
    function RefyardHeaderButton() {
      const open = () => {
        boundContext?.get('sidebarRight')?.openTab(TAB_KIND)
      }
      return h(
        'button',
        {
          type: 'button',
          onClick: open,
          title: translate('openInPanel'),
          'aria-label': translate('openInPanel'),
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            padding: 0,
            borderRadius: '50%',
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
          },
        },
        h(RefyardIcon, { size: 16 }),
      )
    }

    /**
     * The side column's copy of the same frame, in single-repository mode.
     *
     * A second component rather than a prop at the call site: the mode is a property of
     * *where* the panel is mounted, and spelling that out here keeps the two mounts from
     * drifting into "whichever one was edited last".
     */
    function RefyardSidePanel({ sessionId }: { sessionId?: unknown }) {
      return h(RefyardPanel, { sessionId, mode: 'single' })
    }

    /**
     * The host's panel URL with the single-repository flag added.
     *
     * The flag is applied here rather than expected from the host so that which *mount* this
     * is stays a property of this half: the same host route answers both, and a host that
     * has not been rebuilt yet still gets the right mode. `repositoryId` is the host's to
     * add — it is the only side that knows the id — and the workbench falls back to the
     * repository path it already carries when that is absent.
     */
    function withSingleMode(panelUrl: string, single: boolean): string {
      if (!single) {
        return panelUrl
      }
      return `${panelUrl}${panelUrl.includes('?') ? '&' : '?'}single=1`
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx: HarnessClientContext) {
        ctx.effect(() => {
          ctx.locale.register(NS, DICTS)
        }, 'refyard: dictionaries')
        boundT = ctx.locale.bind(NS)
        boundContext = ctx
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, RefyardPanel),
        )
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 70,
              label: () => translate('panel'),
              locale: NS,
            },
            RefyardIcon,
          ),
        )

        // The right column is the Session-scoped copy of the same workbench. It is registered
        // through `ctx.inject` rather than read with `ctx.get`, because the registry belongs to
        // another plugin: asking for it inside `apply` is a race with activation order, and
        // losing that race skipped every registration below it with no error at all — the
        // sidebar entry appeared while the tab body and the header button silently did not.
        //
        // Deferring also means a composition with no right column keeps the main panel, since
        // this body simply never runs.
        ctx.inject(['sidebarRightTabs'], (scoped: HarnessInjectedContext) => {
          // A tab type registers in two stages — the type here, its body in the seat keyed by
          // the type's own id — which is what keeps the chip and the body from disagreeing
          // about which tab they are.
          scoped.effect(() => {
            scoped.sidebarRightTabs.register({
              id: TAB_ID,
              kind: TAB_KIND,
              title: () => translate('panel'),
            })
          }, 'refyard: right-column tab type')
          scoped.slots.inject('sidebar.right.pane.tab', () =>
            scoped.slots.register(
              { name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS },
              RefyardSidePanel,
            ),
          )
          scoped.slots.inject('conversation.session.header.utilities', () =>
            scoped.slots.register(
              {
                name: 'conversation.session.header.utilities',
                id: PANEL_ID,
                order: 25,
                label: () => translate('panel'),
                locale: NS,
              },
              RefyardHeaderButton,
            ),
          )
        })
      },
    }
  },
})
