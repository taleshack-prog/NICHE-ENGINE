"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Unlink } from "lucide-react";
import { agendarPost, desagendarPost } from "@/actions/posts";
import { Botao } from "@/components/ui/botao";
import { Selo, TOM_STATUS } from "@/components/ui/selo";
import { useAcao } from "@/components/ui/use-acao";
import { FORMATO_LABEL, type Formato } from "@/lib/domain";
import type { PostCard } from "@/lib/queries";
import { cn } from "@/lib/utils";

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;
const HORA_PADRAO = 19; // horário de pico do feed; ajuste conforme seus dados

type Visao = "semana" | "mes";

export function Calendario({ posts }: { posts: PostCard[] }) {
  const router = useRouter();
  const { carregando, executar } = useAcao();
  const [visao, setVisao] = React.useState<Visao>("mes");
  const [ancora, setAncora] = React.useState(() => inicioDoDia(new Date()));
  const [arrastando, setArrastando] = React.useState<string | null>(null);
  const [alvo, setAlvo] = React.useState<string | null>(null);

  const dias = React.useMemo(
    () => (visao === "semana" ? diasDaSemana(ancora) : diasDoMes(ancora)),
    [visao, ancora],
  );

  const porDia = React.useMemo(() => {
    const mapa = new Map<string, PostCard[]>();
    for (const p of posts) {
      const data = p.agendadoPara ?? p.publicadoEm;
      if (!data) continue;
      const chave = chaveDia(data);
      const lista = mapa.get(chave);
      if (lista) lista.push(p);
      else mapa.set(chave, [p]);
    }
    return mapa;
  }, [posts]);

  const semAgenda = posts.filter((p) => !p.agendadoPara && !p.publicadoEm);

  function navegar(direcao: -1 | 1) {
    const d = new Date(ancora);
    if (visao === "semana") d.setDate(d.getDate() + 7 * direcao);
    else d.setMonth(d.getMonth() + direcao, 1);
    setAncora(inicioDoDia(d));
  }

  async function soltarEm(dia: Date) {
    const id = arrastando;
    setArrastando(null);
    setAlvo(null);
    if (!id) return;

    const post = posts.find((p) => p.id === id);
    if (!post) return;
    if (post.publicadoEm) return; // post publicado não se remarca

    // Preserva a hora já escolhida; só troca o dia. Reagendar arrastando não
    // deve silenciosamente jogar tudo para a mesma hora.
    const alvoData = new Date(dia);
    const anterior = post.agendadoPara;
    alvoData.setHours(
      anterior ? anterior.getHours() : HORA_PADRAO,
      anterior ? anterior.getMinutes() : 0,
      0,
      0,
    );

    await executar(() => agendarPost({ id, data: alvoData.toISOString() }), {
      sucesso: "Reagendado.",
      aoConcluir: () => router.refresh(),
    });
  }

  const rotulo =
    visao === "semana"
      ? `${fmtCurto(dias[0] ?? ancora)} – ${fmtCurto(dias[dias.length - 1] ?? ancora)}`
      : new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(ancora);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Botao variante="contorno" tamanho="icone" onClick={() => navegar(-1)} aria-label="Anterior">
          <ChevronLeft />
        </Botao>
        <Botao variante="contorno" tamanho="icone" onClick={() => navegar(1)} aria-label="Próximo">
          <ChevronRight />
        </Botao>
        <span className="min-w-40 text-sm font-medium capitalize">{rotulo}</span>
        <Botao
          variante="fantasma"
          tamanho="sm"
          onClick={() => setAncora(inicioDoDia(new Date()))}
        >
          Hoje
        </Botao>

        <div className="ml-auto flex gap-1 rounded-md border border-borda p-0.5">
          {(["semana", "mes"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVisao(v)}
              className={cn(
                "rounded px-2.5 py-1 text-xs transition-colors",
                visao === v ? "bg-acento/20 text-acento" : "text-suave hover:text-texto",
              )}
            >
              {v === "semana" ? "Semana" : "Mês"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 rounded-xl border border-borda bg-superficie p-2">
        {DIAS.map((d) => (
          <div key={d} className="px-1 pb-1 text-[11px] font-semibold uppercase text-tenue">
            {d}
          </div>
        ))}

        {dias.map((dia) => {
          const chave = chaveDia(dia);
          const doDia = porDia.get(chave) ?? [];
          const foraDoMes = visao === "mes" && dia.getMonth() !== ancora.getMonth();
          const hoje = chave === chaveDia(new Date());

          return (
            <div
              key={chave}
              onDragOver={(e) => {
                e.preventDefault();
                setAlvo(chave);
              }}
              onDragLeave={() => setAlvo((a) => (a === chave ? null : a))}
              onDrop={() => soltarEm(dia)}
              className={cn(
                "min-h-24 rounded-md border border-borda/60 p-1.5",
                foraDoMes ? "bg-fundo/40 opacity-50" : "bg-superficie-2/40",
                hoje && "border-acento/60",
                alvo === chave && "drop-ativo",
                visao === "semana" && "min-h-56",
              )}
            >
              <p
                className={cn(
                  "mb-1 text-[11px] tabular-nums",
                  hoje ? "font-semibold text-acento" : "text-tenue",
                )}
              >
                {dia.getDate()}
              </p>

              <div className="space-y-1">
                {doDia.map((p) => (
                  <div
                    key={p.id}
                    draggable={!p.publicadoEm}
                    onDragStart={() => setArrastando(p.id)}
                    onDragEnd={() => setArrastando(null)}
                    title={`${p.titulo} — ${p.nicho}`}
                    className={cn(
                      "rounded border border-borda bg-superficie px-1.5 py-1 text-[10px] leading-tight",
                      !p.publicadoEm && "cursor-grab",
                      arrastando === p.id && "arrastando",
                    )}
                  >
                    <p className="line-clamp-2 font-medium">{p.titulo}</p>
                    <div className="mt-0.5 flex items-center justify-between gap-1">
                      <span className="text-tenue">
                        {(p.agendadoPara ?? p.publicadoEm)?.toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <Selo tom={TOM_STATUS[p.status] ?? "neutro"} className="px-1 py-0">
                        {FORMATO_LABEL[p.formato as Formato]?.slice(0, 4) ?? p.formato}
                      </Selo>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 rounded-xl border border-borda bg-superficie p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-suave">
          Prontos sem data ({semAgenda.length})
        </h2>
        {semAgenda.length === 0 ? (
          <p className="text-xs text-tenue">
            Nada esperando data. Posts em <strong>Pronto</strong> aparecem aqui para arrastar ao
            calendário.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {semAgenda.map((p) => (
              <div
                key={p.id}
                draggable
                onDragStart={() => setArrastando(p.id)}
                onDragEnd={() => setArrastando(null)}
                className={cn(
                  "cursor-grab rounded-md border border-borda bg-superficie-2 px-2.5 py-1.5 text-xs",
                  arrastando === p.id && "arrastando",
                )}
              >
                <span className="font-medium">{p.titulo}</span>
                <span className="ml-1.5 text-tenue">{p.nicho}</span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[10px] text-tenue">
          Arraste para um dia do calendário para agendar às {HORA_PADRAO}h (a hora exata se
          ajusta no editor do post).
        </p>
      </div>

      {posts.some((p) => p.status === "agendado") ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-tenue">
          <Unlink className="size-3" />
          Para remover uma data, abra o post em Produção ou use:
          {posts
            .filter((p) => p.status === "agendado")
            .slice(0, 5)
            .map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={carregando}
                onClick={() =>
                  executar(() => desagendarPost({ id: p.id }), {
                    sucesso: "Desagendado.",
                    aoConcluir: () => router.refresh(),
                  })
                }
                className="rounded border border-borda px-1.5 py-0.5 hover:border-erro hover:text-erro"
              >
                {p.titulo.slice(0, 24)}
              </button>
            ))}
        </div>
      ) : null}
    </>
  );
}

function inicioDoDia(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function chaveDia(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function diasDaSemana(ancora: Date): Date[] {
  const inicio = new Date(ancora);
  inicio.setDate(inicio.getDate() - inicio.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(inicio);
    d.setDate(d.getDate() + i);
    return inicioDoDia(d);
  });
}

function diasDoMes(ancora: Date): Date[] {
  const primeiro = new Date(ancora.getFullYear(), ancora.getMonth(), 1);
  const inicio = new Date(primeiro);
  inicio.setDate(inicio.getDate() - inicio.getDay());

  // 6 semanas cobrem qualquer mês, inclusive os que começam no sábado.
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(inicio);
    d.setDate(d.getDate() + i);
    return inicioDoDia(d);
  });
}

function fmtCurto(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(d);
}
