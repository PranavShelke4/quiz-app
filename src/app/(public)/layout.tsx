import { SiteFooter, SiteHeader } from "@/components/site-header";
import { getAuth } from "@/lib/auth/dal";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuth();
  return (
    <>
      <SiteHeader user={auth?.user ?? null} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
