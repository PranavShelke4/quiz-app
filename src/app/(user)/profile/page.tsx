import type { Metadata } from "next";
import { ProfileForms } from "@/components/auth/profile-forms";
import { Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/ui/primitives";
import { requireUser } from "@/lib/auth/dal";
import { formatDate } from "@/lib/utils";
import { getOwnProfile } from "@/services/user.service";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const auth = await requireUser("/profile");
  const profile = await getOwnProfile(auth.userId);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Your profile" description={`Member since ${formatDate(profile.createdAt)}`} />
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="text-muted-foreground">Email: </span>
            {profile.email}
          </p>
        </CardContent>
      </Card>
      <ProfileForms name={profile.name} avatar={profile.avatar ?? ""} team={profile.team} />
    </div>
  );
}
