// The provider's page settings, as /api/provider/public-page sends them.
import type { ProviderPageBlocker, ProviderPhotoKind } from "@shared/provider-public";

export type ProviderPageSettingsView = {
  code: string;
  path: string;
  displayName: string;
  enabled: boolean;
  live: boolean;
  blockers: ProviderPageBlocker[];
  blockedNote: string | null;
  publicListingCount: number;
  offersHomeHelp: boolean;
  verified: boolean;
  photo: {
    status: string;
    approvedUrl: string | null;
    approvedKind: ProviderPhotoKind | null;
    pendingUrl: string | null;
    pendingKind: ProviderPhotoKind | null;
    submittedAt: string | null;
    reviewedAt: string | null;
    reviewNote: string | null;
    unreviewedUrl: string | null;
  };
};
