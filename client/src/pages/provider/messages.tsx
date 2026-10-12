import { ProviderLayout } from "@/components/provider-layout";
import InboxPage from "@/pages/inbox";

// Messages and alerts, inside Provider Hub so providers never leave it.
export default function ProviderMessages() {
  return (
    <ProviderLayout title="Messages">
      <InboxPage embedded />
    </ProviderLayout>
  );
}
