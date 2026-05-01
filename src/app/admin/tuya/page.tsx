import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { listAllDevices } from "@/lib/tuya/devices";

export const dynamic = "force-dynamic";

export default async function TuyaPage() {
  const result = await listAllDevices().catch((err: Error) => ({
    error: err.message,
  }));

  if ("error" in result) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Tuya</h1>
          <p className="text-sm text-muted-foreground">
            Integración con Smart Life / Tuya Open API.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Error de conexión</CardTitle>
            <CardDescription>
              No se pudo hablar con el cloud de Tuya.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <pre className="whitespace-pre-wrap rounded bg-muted p-3 text-destructive">
              {result.error}
            </pre>
            <ul className="mt-4 list-disc pl-5 text-muted-foreground">
              <li>
                Verificá que <code>TUYA_ACCESS_ID</code>,{" "}
                <code>TUYA_ACCESS_SECRET</code> y <code>TUYA_REGION</code> estén
                en <code>.env.local</code> (y en Vercel).
              </li>
              <li>
                Confirmá que el Cloud Project tenga las APIs requeridas
                autorizadas: <em>IoT Core</em>, <em>Authorization Token
                Management</em>, <em>Smart Home Basic Service</em>,{" "}
                <em>Smart Lock Open Service</em>.
              </li>
              <li>
                Asegurate de haber linkeado tu cuenta de Smart Life en{" "}
                <em>Devices → Link App Account</em>.
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { user, devices } = result;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Tuya</h1>
        <p className="text-sm text-muted-foreground">
          Integración con Smart Life / Tuya Open API.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cuenta linkeada</CardTitle>
          <CardDescription>
            Cuenta de la app Smart Life autorizada al Cloud Project.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {user ? (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
              <dt className="text-muted-foreground">Username</dt>
              <dd>{user.username ?? user.email ?? "—"}</dd>
              <dt className="text-muted-foreground">UID</dt>
              <dd className="font-mono text-xs">{user.uid}</dd>
              {user.create_time && (
                <>
                  <dt className="text-muted-foreground">Linkeado</dt>
                  <dd>
                    {format(new Date(user.create_time * 1000), "d MMM yyyy", {
                      locale: es,
                    })}
                  </dd>
                </>
              )}
            </dl>
          ) : (
            <div className="text-muted-foreground space-y-2">
              <p>
                No se encontró ninguna cuenta linkeada vía los endpoints
                automáticos de Tuya. Probablemente la API de "list users" no
                está disponible en tu plan o cambió de path.
              </p>
              <p>
                <strong>Workaround:</strong> agregá tu UID a las env vars como{" "}
                <code>TUYA_USER_UID</code> (lo ves en Tuya →{" "}
                <em>Devices → Link App Account</em>, columna UID — algo como{" "}
                <code>az159097966553O5Zk</code>) y reiniciá el dev server o
                hacé redeploy en Vercel. Con eso saltamos el discovery y
                listamos los devices directo.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dispositivos ({devices.length})</CardTitle>
          <CardDescription>
            Devices visibles desde el Cloud Project, vía la cuenta linkeada.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay dispositivos. Si en la app Smart Life ves dispositivos,
              probablemente estén en una <em>Home</em> distinta — asegurate que
              la home con tus devices sea la principal o compartida con la
              cuenta linkeada.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Device ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>
                      {d.category_name ?? d.category ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={d.online ? "default" : "secondary"}>
                        {d.online ? "online" : "offline"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{d.id}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
