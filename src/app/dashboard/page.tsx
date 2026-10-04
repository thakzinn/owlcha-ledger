import FeatureShell from "@/components/FeatureShell";
import OwnerInsights from "@/components/OwnerInsights";

export default function DashboardPage() {
  return <FeatureShell title="Dashboard เจ้าของร้าน"><OwnerInsights mode="dashboard" /></FeatureShell>;
}
