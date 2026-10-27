import { getSessionUser } from "@/lib/auth";
import {
  automationActivity,
  countQueuedMessages,
  createAutomationRule,
  listAutomationRules,
  listAutomationRuns,
  listQueuedMessages,
} from "@/lib/db";
import { fail, handle, ok, pick, readBody, str } from "@/lib/api";
import { AUTOMATION_ACTIONS, RULE_PRESETS, sanitizeParams } from "@/lib/automation";
import type { AutomationCadence, AutomationKind, AutomationMode } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Everything the automation page needs in one read. */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return ok({ error: "Sign in required" }, 401);
    return ok({
      rules: listAutomationRules(),
      runs: listAutomationRuns(20),
      queued: listQueuedMessages(25),
      queued_count: countQueuedMessages(),
      activity: automationActivity(7),
      presets: RULE_PRESETS,
      actions: AUTOMATION_ACTIONS,
      can_manage: user.role !== "article",
    });
  } catch (err) {
    return handle(err);
  }
}

/** Create a rule — from a preset or from an explicit action + params. */
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return ok({ error: "Sign in required" }, 401);
    if (user.role === "article") return ok({ error: "Only a partner or manager can configure automation" }, 403);

    const body = await readBody(req);
    const presetId = str(body.preset_id, "Preset", { optional: true, max: 40 });
    const preset = presetId ? RULE_PRESETS.find((p) => p.id === presetId) : undefined;

    const action = preset
      ? preset.action
      : pick(
          body.action,
          AUTOMATION_ACTIONS.map((a) => a.kind),
          "Action",
        );

    const params = sanitizeParams(action as AutomationKind, preset ? preset.params : body.params);
    const mode: AutomationMode = preset
      ? preset.mode
      : pick(body.mode, ["auto", "approval"] as const, "Mode", "auto");
    const cadence: AutomationCadence = preset
      ? preset.cadence
      : pick(body.cadence, ["daily", "weekly", "monthly"] as const, "Cadence", "daily");

    const info = AUTOMATION_ACTIONS.find((a) => a.kind === action)!;
    const name = str(body.name, "Name", { optional: true, max: 120 }) || preset?.name || info.label;

    const rule = createAutomationRule({
      name,
      action: action as AutomationKind,
      params,
      mode,
      cadence,
      created_by: user.name,
    });

    if (!rule) return fail("Could not create the rule", 500);
    return ok({ rule }, 201);
  } catch (err) {
    return handle(err);
  }
}
