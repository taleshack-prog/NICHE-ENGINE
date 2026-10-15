"use client";

import { useRef, useState } from "react";
import { HardDrive, Loader2, Music, Image as Imagem, Trash2, Upload } from "lucide-react";
import { Botao } from "@/components/ui/botao";
import { Card, CardCabecalho, CardConteudo, CardTitulo } from "@/components/ui/card";
import { Selo } from "@/components/ui/selo";
import type { Acervo, ItemDoAcervo } from "@/lib/niche";

type Tipo = keyof Acervo;

const SECOES: { tipo: Tipo; titulo: string; descricao: string; aceita: string; Icone: typeof Imagem }[] = [
  {
    tipo: "obras",
    titulo: "Obras",
    descricao:
      "As telas tokenizadas. O nome do arquivo é o que a pauta usa em obras: — white-kanji.jpg vira arquivo: white-kanji.",
    aceita: "image/jpeg,image/png,image/webp",
    Icone: Imagem,
  },
  {
    tipo: "ilustra",
    titulo: "Ilustrações",
    descricao:
      "Quadradas, entram inteiras sobre o fundo escuro. A pauta chama pelo nome com extensão: ilustra:judo-energia.png.",
    aceita: "image/jpeg,image/png,image/webp",
    Icone: Imagem,
  },
  {
    tipo: "audio",
    titulo: "Trilhas e narrações",
    descricao: "Escolhidas na aba Montagem de cada episódio.",
    aceita: "audio/*",
    Icone: Music,
  },
];

function tamanho(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function PainelAcervo({ inicial, remoto }: { inicial: Acervo; remoto: boolean }) {
  const [acervo, setAcervo] = useState(inicial);
  const [ocupado, setOcupado] = useState<Tipo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const entradas = useRef<Record<string, HTMLInputElement | null>>({});

  async function recarregar() {
    const r = await fetch("/api/youtube/acervo");
    if (r.ok) setAcervo((await r.json()) as Acervo);
  }

  async function enviar(tipo: Tipo, arquivos: FileList | null) {
    if (!arquivos?.length) return;
    setOcupado(tipo);
    setErro(null);
    try {
      // Um por vez, de propósito: com cinco ilustrações de 7 MB em paralelo o
      // primeiro erro deixaria metade enviada e nenhuma mensagem útil.
      for (const arquivo of Array.from(arquivos)) {
        const forma = new FormData();
        forma.append("tipo", tipo);
        forma.append("arquivo", arquivo);
        const r = await fetch("/api/youtube/acervo", { method: "POST", body: forma });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(`${arquivo.name}: ${d.erro ?? r.status}`);
        }
      }
      await recarregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  async function remover(tipo: Tipo, nome: string) {
    if (!window.confirm(`Remover ${nome} do acervo?`)) return;
    const r = await fetch(
      `/api/youtube/acervo?tipo=${tipo}&nome=${encodeURIComponent(nome)}`,
      { method: "DELETE" },
    );
    if (r.ok) await recarregar();
    else setErro((await r.json()).erro ?? "falha ao remover");
  }

  return (
    <div className="space-y-5">
      <p className="flex items-center gap-2 text-xs text-tenue">
        <HardDrive className="size-3.5" />
        {remoto
          ? "Guardado no volume do serviço — sobrevive a deploy."
          : "Guardado em acervo/, na sua máquina. Ignorado pelo git."}
      </p>

      {erro ? (
        <p className="rounded-md border border-erro/40 bg-erro/10 p-3 text-sm">{erro}</p>
      ) : null}

      {SECOES.map(({ tipo, titulo, descricao, aceita, Icone }) => {
        const itens: ItemDoAcervo[] = acervo[tipo] ?? [];
        return (
          <Card key={tipo}>
            <CardCabecalho className="flex-row items-start justify-between gap-3">
              <div>
                <CardTitulo className="flex items-center gap-1.5">
                  <Icone className="size-3.5" />
                  {titulo}
                  <Selo>{itens.length}</Selo>
                </CardTitulo>
                <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-tenue">
                  {descricao}
                </p>
              </div>
              <div>
                <input
                  ref={(el) => {
                    entradas.current[tipo] = el;
                  }}
                  type="file"
                  multiple
                  accept={aceita}
                  className="hidden"
                  onChange={(e) => void enviar(tipo, e.target.files)}
                />
                <Botao
                  variante="contorno"
                  tamanho="sm"
                  disabled={ocupado !== null}
                  onClick={() => entradas.current[tipo]?.click()}
                >
                  {ocupado === tipo ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Upload className="size-3.5" />
                  )}
                  Enviar
                </Botao>
              </div>
            </CardCabecalho>
            <CardConteudo>
              {itens.length === 0 ? (
                <p className="text-xs text-tenue">vazio</p>
              ) : (
                <ul className="divide-y divide-borda">
                  {itens.map((item) => (
                    <li
                      key={item.nome}
                      className="flex items-center justify-between gap-3 py-1.5 text-xs"
                    >
                      <code className="truncate text-suave">{item.nome}</code>
                      <span className="flex shrink-0 items-center gap-2 text-tenue">
                        {tamanho(item.bytes)}
                        <button
                          onClick={() => void remover(tipo, item.nome)}
                          className="text-tenue transition-colors hover:text-erro"
                          title="remover"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardConteudo>
          </Card>
        );
      })}
    </div>
  );
}
