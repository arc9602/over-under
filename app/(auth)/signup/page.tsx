import { redirect } from "next/navigation";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect: redirectTo } = await searchParams;
  const query = redirectTo ? `?redirect=${encodeURIComponent(redirectTo)}` : "";
  redirect(`/login${query}`);
}
