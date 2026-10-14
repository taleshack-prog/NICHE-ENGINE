import { redirect } from "next/navigation";
import { Casca } from "@/components/layout/casca";
import { sessaoAtual } from "@/lib/auth";

/**
 * Casca do dashboard do Instagram.
 *
 * Saiu do layout raiz quando o dashboard do YouTube entrou: os dois operam
 * coisas diferentes (página faceless no Instagram × canal de Shorts) e cada um
 * tem a sua navegação. O grupo entre parênteses não aparece na URL — `/`,
 * `/nichos`, `/producao` continuam onde estavam.
 */
export default async function LayoutInstagram({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessao = await sessaoAtual();
  if (!sessao) redirect("/login");
  return <Casca usuario={sessao.usuario}>{children}</Casca>;
}
