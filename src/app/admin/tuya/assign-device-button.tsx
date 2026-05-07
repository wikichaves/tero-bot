"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { DeviceKind, Property, PropertyDevice } from "@/lib/types";
import { AssignDeviceDialog } from "./assign-device-dialog";

export function AssignDeviceButton({
  tuyaDeviceId,
  tuyaDeviceName,
  properties,
  current,
  suggestedKind,
}: {
  tuyaDeviceId: string;
  tuyaDeviceName: string;
  properties: Pick<Property, "id" | "name">[];
  current: PropertyDevice | null;
  suggestedKind: DeviceKind;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {current ? "Cambiar" : "Asignar"}
      </Button>
      <AssignDeviceDialog
        tuyaDeviceId={tuyaDeviceId}
        tuyaDeviceName={tuyaDeviceName}
        properties={properties}
        current={current}
        suggestedKind={suggestedKind}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
