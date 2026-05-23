import { redirect } from "next/navigation";

/**
 * WIK-109: /my-tasks se unificó con /tasks — el filtro por role
 * que hace /tasks ahora cubre todos los casos (mantenimiento ve solo
 * las suyas, gestor las suyas + las que asignó, admin todas).
 *
 * Esta page existe como redirect para que links viejos (bookmarks,
 * mensajes en WhatsApp con la URL /my-tasks, etc) sigan funcionando.
 */
export default function MisTareasRedirect() {
  redirect("/tasks");
}
