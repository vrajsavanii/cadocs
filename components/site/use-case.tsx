"use client";

/**
 * Self-playing product panels for the hero and the use-case sections.
 *
 * Each panel loops through its own screen steps while it is on screen, and the
 * incoming panel grows into place (zoom in) / settles from an enlarged state
 * (zoom out) as it scrolls past.
 */
import * as React from "react";
import { FitBox, Reveal, type RevealVariant } from "./anim";
import {
  AppFrame,
  ClientScreen,
  CollectionsScreen,
  ComplianceScreen,
  CopilotScreen,
  DashboardScreen,
  DocumentsScreen,
  LoopPlayer,
} from "./mockups";
import type { UseCase } from "@/lib/site-content";

const SCREEN_FOR: Record<string, React.ComponentType<{ step: number }>> = {
  copilot: CopilotScreen,
  compliance: ComplianceScreen,
  collections: CollectionsScreen,
  clients: ClientScreen,
  documents: DocumentsScreen,
};

/** Which rail item lights up in the replica, matching the real module. */
const ACTIVE_FOR: Record<string, string> = {
  copilot: "/agent",
  compliance: "/compliance",
  collections: "/invoices",
  clients: "/clients",
  documents: "/documents",
};

/** The hero: the real dashboard, assembling itself, at desktop layout scale. */
export function HeroMock() {
  return (
    <Reveal variant="zoom-in" duration={900} className="min-w-0">
      <FitBox width={1180}>
        <LoopPlayer steps={4} interval={2400}>
          {(step) => (
            <AppFrame active="/" badges={{ documents: 9, compliance: 7, invoices: 4 }}>
              <DashboardScreen step={step} />
            </AppFrame>
          )}
        </LoopPlayer>
      </FitBox>
    </Reveal>
  );
}

export function UseCasePanel({ item }: { item: UseCase }) {
  const Screen = SCREEN_FOR[item.id] ?? ComplianceScreen;
  const active = ACTIVE_FOR[item.id] ?? "/compliance";
  const variant: RevealVariant = item.align === "left" ? "right" : "left";

  return (
    <Reveal variant={variant} duration={820} className="min-w-0">
      {/* The replica keeps its real desktop density and scales down as one piece
          instead of reflowing: below ~1300px the wide tables inside it
          (min-w 620px) would otherwise run past the frame and get clipped. */}
      <FitBox width={800}>
        <LoopPlayer steps={item.loopSteps} interval={item.interval}>
          {(step) => (
            <AppFrame active={active} badges={{ documents: 9, compliance: 7, invoices: 4 }}>
              <Screen step={step} />
            </AppFrame>
          )}
        </LoopPlayer>
      </FitBox>
    </Reveal>
  );
}
