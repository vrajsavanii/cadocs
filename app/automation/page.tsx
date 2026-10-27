import { AutomationView, type RuleWithExplain } from "@/components/views/automation";
import {
  automationActivity,
  listAutomationRules,
  listAutomationRuns,
  listQueuedMessages,
} from "@/lib/db";
import { AUTOMATION_ACTIONS, RULE_PRESETS, automationBacklog, explainRule } from "@/lib/automation";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AutomationPage() {
  const user = await getSessionUser();
  const rules: RuleWithExplain[] = listAutomationRules().map((rule) => ({ ...rule, explain: explainRule(rule) }));

  return (
    <AutomationView
      rules={rules}
      runs={listAutomationRuns(20)}
      queued={listQueuedMessages(25)}
      activity={automationActivity(7)}
      presets={RULE_PRESETS.map((preset) => ({
        id: preset.id,
        name: preset.name,
        action: preset.action,
        params: preset.params as Record<string, unknown>,
        mode: preset.mode,
        cadence: preset.cadence,
        why: preset.why,
      }))}
      actions={AUTOMATION_ACTIONS.map((a) => ({ kind: a.kind, label: a.label, blurb: a.blurb }))}
      canManage={user?.role !== "article"}
      backlog={automationBacklog()}
    />
  );
}
