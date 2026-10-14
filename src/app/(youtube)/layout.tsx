import { redirect } from "next/navigation";
import { CascaYoutube } from "@/components/layout/casca-youtube";
import { sessaoAtual } from "@/lib/auth";

export default async function LayoutYoutube({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessao = await sessaoAtual();
  if (!sessao) redirect("/login");
  return <CascaYoutube usuario={sessao.usuario}>{children}</CascaYoutube>;
}
