/**
 * Every written campaign the app ships. Adding one is adding a module file
 * under modules/ and one line here; test/livingtable-campaign.test.ts runs
 * validate.ts over everything listed, so a module with a broken reference or
 * a gate that can never open fails the build rather than the player.
 */
import type { TemplateGenre } from "../characters/templates";
import { BLACKSTONE } from "./modules/blackstone";
import type { CampaignModule } from "./types";

export const CAMPAIGN_LIBRARY: readonly CampaignModule[] = [BLACKSTONE];

export function findCampaignModule(id: string | undefined): CampaignModule | undefined {
  return id ? CAMPAIGN_LIBRARY.find((m) => m.id === id) : undefined;
}

export function writtenCampaignsFor(template: TemplateGenre): CampaignModule[] {
  return CAMPAIGN_LIBRARY.filter((m) => m.template === template);
}
