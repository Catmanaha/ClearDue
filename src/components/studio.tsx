'use client';
import { useMemo, useEffect, useRef, useState } from 'react';
import { AgStudio, createWidgets, type AgRegistry, type AgWidgetDefinition } from 'ag-studio-react';
import {
  AgStudioAiModule,
  studioTheme,
  AgStudioLicenseManager,
  createAiHarness,
  directLlmRunner,
  type AgLlmAdapter,
  type AgLlmResponse,
  type AgAiEvent,
  type AgReportState,
  type AgAiHarnessSetup,
  type AgWidgetParams,
} from 'ag-studio';
import { EvidenceComparison, ResolutionOutcomes, AnalyticsContext } from './analytics';
import { useContext } from 'react';
import { CaseExplorer } from './case-explorer';
import { viewSchema, viewTool, type DashboardView } from '@/domain/dashboard';
interface Registry extends AgRegistry {
  widgets: readonly (
    | AgWidgetDefinition<'evidenceComparison'>
    | AgWidgetDefinition<'resolutionOutcomes'>
    | AgWidgetDefinition<'caseExplorer'>
  )[];
}
function EvidenceStudioWidget({ widgetApi }: AgWidgetParams) {
  useEffect(() => {
    widgetApi.setDisplayState('displayed');
  }, [widgetApi]);
  return <EvidenceComparison />;
}
function OutcomesStudioWidget({ widgetApi }: AgWidgetParams) {
  useEffect(() => {
    widgetApi.setDisplayState('displayed');
  }, [widgetApi]);
  return <ResolutionOutcomes />;
}
const clearDueStudioTheme = studioTheme.withParams({
  accentColor: '#224e3d',
  backgroundColor: '#f7f8f5',
  textColor: '#20382f',
  borderColor: '#dce3dc',
  fontFamily: 'Segoe UI, Arial, sans-serif',
  fontSize: 13,
  borderRadius: 8,
  studioCanvasBackgroundColor: '#f7f8f5',
  studioCanvasMinWidth: 0,
  studioWidgetBackgroundColor: '#ffffff',
  studioWidgetBorderRadius: 12,
  studioWidgetPadding: 16,
});
function ExplorerStudioWidget({ widgetApi }: AgWidgetParams) {
  useEffect(() => {
    widgetApi.setDisplayState('displayed');
  }, [widgetApi]);
  return <CaseExplorer />;
}
const adapter: AgLlmAdapter = {
  executeTurn(request, options) {
    const complete: Promise<AgLlmResponse> = fetch('/api/studio/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: options?.signal,
    }).then(async (r) => {
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      return result;
    });
    return {
      complete,
      stream: {
        async *[Symbol.asyncIterator](): AsyncGenerator<AgAiEvent> {
          const response = await complete;
          for (const item of response.output) {
            if (item.type === 'message') {
              yield { type: 'TEXT_MESSAGE_START', messageId: item.id, role: 'assistant' };
              for (const c of item.content)
                if (c.type === 'text')
                  yield { type: 'TEXT_MESSAGE_CONTENT', messageId: item.id, delta: c.text };
              yield { type: 'TEXT_MESSAGE_END', messageId: item.id };
            } else if (item.type === 'function_call') {
              yield { type: 'TOOL_CALL_START', toolCallId: item.callId, toolCallName: item.name };
              yield { type: 'TOOL_CALL_ARGS', toolCallId: item.callId, delta: item.arguments };
              yield { type: 'TOOL_CALL_END', toolCallId: item.callId };
            }
          }
        },
      },
    };
  },
};
export function Studio({
  studioKey,
  live,
  applyView,
}: {
  studioKey: string;
  live: boolean;
  applyView: (view: DashboardView) => Promise<void>;
}) {
  const { view, rows } = useContext(AnalyticsContext);
  const studio = useRef<AgStudio<Registry>>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!surface.current) return;
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < 700));
    observer.observe(surface.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!ready || !studio.current) return;
    const api = studio.current.api;
    const state = api.getState();
    const evidenceFirst = view.layout === 'evidence-first';
    const top = compact ? 33 : 23;
    const evidence = {
      xTrack: compact || evidenceFirst ? 0 : 12,
      yTrack: compact && !evidenceFirst ? top + 48 : top,
      xSpan: compact ? 24 : 12,
    };
    const outcomes = {
      xTrack: compact || !evidenceFirst ? 0 : 12,
      yTrack: compact && evidenceFirst ? top + 48 : top,
      xSpan: compact ? 24 : 12,
    };
    let changed = false;
    const pages = state.pages?.map((page) => {
      const layout = page.widgetLayout;
      if (page.id !== 'cases' || !layout?.explorer || !layout.evidence || !layout.outcomes)
        return page;
      if (
        layout.explorer.ySpan === top &&
        layout.evidence.xTrack === evidence.xTrack &&
        layout.evidence.yTrack === evidence.yTrack &&
        layout.evidence.xSpan === evidence.xSpan &&
        layout.outcomes.xTrack === outcomes.xTrack &&
        layout.outcomes.yTrack === outcomes.yTrack &&
        layout.outcomes.xSpan === outcomes.xSpan
      )
        return page;
      changed = true;
      return {
        ...page,
        layout: {
          ...page.layout,
          minWidth: 0,
          pagePadding: compact ? 8 : 20,
          widgetPadding: compact ? 4 : 16,
        },
        widgetLayout: {
          ...layout,
          explorer: { ...layout.explorer, ySpan: top },
          evidence: { ...layout.evidence, ...evidence },
          outcomes: { ...layout.outcomes, ...outcomes },
        },
      };
    });
    // Update only layout references; remounting Studio also destroys its chat and drafts.
    if (changed) api.setState({ ...state, pages });
  }, [ready, view.layout, compact]);
  const widgets = useMemo(() => {
    if (studioKey) AgStudioLicenseManager.setLicenseKey(studioKey);
    return createWidgets<Registry>({
      additionalTypes: [
        {
          id: 'caseExplorer',
          label: 'Case explorer',
          toolbar: [],
          comp: ExplorerStudioWidget,
          form: (p) => p.createDefaults({ dataMappingItems: [] }),
          defaultSize: { width: 1000, height: 350 },
          minSize: { width: 280, height: 300 },
          ai: { description: 'Read-only case selection linked to evidence and recorded outcomes.' },
        },
        {
          id: 'evidenceComparison',
          label: 'Evidence comparison',
          toolbar: [],
          comp: EvidenceStudioWidget,
          form: (p) => p.createDefaults({ dataMappingItems: [] }),
          defaultSize: { width: 600, height: 650 },
          minSize: { width: 280, height: 240 },
          ai: {
            description:
              'Links exact supplied excerpts to billing disagreement findings. Read only.',
          },
        },
        {
          id: 'resolutionOutcomes',
          label: 'Resolution outcomes',
          toolbar: [],
          comp: OutcomesStudioWidget,
          form: (p) => p.createDefaults({ dataMappingItems: [] }),
          defaultSize: { width: 450, height: 650 },
          minSize: { width: 280, height: 240 },
          ai: {
            description:
              'Separates verified or simulated paid amounts from approved reductions and outstanding balances. Read only.',
          },
        },
      ],
      menu: [
        {
          label: 'ClearDue',
          widgetIds: ['caseExplorer', 'evidenceComparison', 'resolutionOutcomes'],
        },
      ],
    });
  }, [studioKey]);
  const [initialState] = useState<AgReportState<Registry>>(() => ({
    pages: [
      {
        id: 'cases',
        layout: { minWidth: 0, pagePadding: 20, widgetPadding: 16 },
        widgets: {
          explorer: { type: 'caseExplorer', dataMapping: {} },
          evidence: { type: 'evidenceComparison', dataMapping: {} },
          outcomes: { type: 'resolutionOutcomes', dataMapping: {} },
        },
        widgetLayout: {
          explorer: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 23 },
          evidence: {
            xTrack: view.layout === 'evidence-first' ? 0 : 12,
            yTrack: 23,
            xSpan: 12,
            ySpan: 48,
          },
          outcomes: {
            xTrack: view.layout === 'evidence-first' ? 12 : 0,
            yTrack: 23,
            xSpan: 12,
            ySpan: 48,
          },
        },
      },
    ],
    selectedPageId: 'cases',
    panels: { data: { collapsed: true }, edit: { collapsed: true } },
  }));
  const ai = useMemo<AgAiHarnessSetup>(
    () =>
      ({ api }) =>
        createAiHarness(api, () => ({
          primary: 'dashboard',
          agents: [
            directLlmRunner({
              id: 'dashboard',
              name: 'Dashboard assistant',
              maxTurns: 4,
              adapter,
              instructions: () =>
                'Help explore authorized ClearDue cases by changing only filters, sorting and widget order. Use set_case_view. Never approve or execute financial operations.',
              tools: () => [
                {
                  name: viewTool.name,
                  description: viewTool.description,
                  kind: 'client',
                  schema: () => viewTool,
                  execute: async (call, ctx) => {
                    try {
                      const next = viewSchema.parse(call.args);
                      await applyView(next);
                      return ctx.success('Dashboard presentation updated.', next);
                    } catch (e) {
                      return ctx.error(e instanceof Error ? e.message : 'Invalid dashboard view.');
                    }
                  },
                },
              ],
            }),
          ],
          promptStarters: [
            {
              label: 'Find cases needing evidence',
              prompt: 'Show cases needing evidence or clarification, oldest first.',
            },
            {
              label: 'Review confirmed outcomes',
              prompt:
                'Show confirmed outcomes, with outcomes first. Keep payments and reductions separate and disclose demo versus sandbox.',
            },
            {
              label: 'Find missing references',
              prompt: 'Show missing-reference cases, largest balances first.',
            },
          ],
        })),
    [applyView],
  );

  return (
    <div className="studio-surface" ref={surface}>
      <AgStudio<Registry>
        ref={studio}
        onApiReady={() => setReady(true)}
        style={{ height: compact ? 1900 : 1250, width: '100%' }}
        theme={clearDueStudioTheme}
        widgets={widgets}
        data={{
          sources: [
            {
              id: 'cases',
              data: rows.map((r) => ({
                customer: r.customer,
                issue: r.issue,
                outstandingPence: r.duePence,
              })),
            },
          ],
        }}
        initialState={initialState}
        mode="edit"
        panels={{ edit: { left: [], right: live ? ['ai'] : [] }, view: { left: [], right: [] } }}
        modules={[AgStudioAiModule]}
        ai={live ? ai : undefined}
        aiToolDisplay={{
          set_case_view: { label: () => ({ text: 'Change dashboard view' }) },
        }}
        loadThemeGoogleFonts={false}
      />
    </div>
  );
}
