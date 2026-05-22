import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ModeToggle } from "@/components/mode-toggle";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="relative flex flex-1 items-center justify-center p-6">
      <div className="absolute right-4 top-4">
        <ModeToggle />
      </div>
      <Card className="w-full max-w-sm gap-6 py-7">
        <CardHeader>
          <CardTitle className="text-2xl">tero.bot</CardTitle>
          <CardDescription>Iniciar sesión en el panel.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </div>
  );
}
