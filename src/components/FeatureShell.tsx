import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { signOutAction } from "@/app/actions";
import AppHeader from "@/components/AppHeader";

export default async function FeatureShell({ title, children }: { title: string; children: React.ReactNode }) {
  const session = await auth();
  if (!session || session.error) redirect("/login?reason=session");
  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl p-4">
      <AppHeader name={session.user?.name ?? ""} email={session.user?.email ?? ""} signOutAction={signOutAction} />
      <h1 className="mb-4 text-center text-xl font-semibold text-gray-800">{title}</h1>
      {children}
    </main>
  );
}
