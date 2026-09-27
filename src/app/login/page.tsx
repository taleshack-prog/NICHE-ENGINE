import { redirect } from "next/navigation";
import { FormularioLogin } from "./formulario-login";
import { authDesabilitada } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string }>;
}) {
  if (authDesabilitada()) redirect("/");

  const { de } = await searchParams;

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <FormularioLogin de={de && de.startsWith("/") ? de : "/"} />
    </div>
  );
}
