"use client";

import { useState } from "react";

/**
 * Client wrapper for an attached photo. Tries to render an `<img>` and
 * falls back to a "no se puede mostrar" placeholder if the URL fails to
 * load — typical when the underlying Kapso/Meta media URL has expired
 * (their CDN issues short-lived signed URLs).
 */
export function PhotoThumb({
  url,
  index,
}: {
  url: string;
  index: number;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block overflow-hidden rounded-md border bg-muted"
    >
      {failed ? (
        <div className="flex h-48 w-full items-center justify-center bg-muted px-4 text-center text-xs text-muted-foreground">
          No se puede mostrar la foto (link caducado o protegido). Click para
          abrirla.
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`Foto adjunta ${index + 1}`}
          className="h-48 w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
      <p className="break-all border-t px-3 py-2 text-xs text-muted-foreground">
        {url}
      </p>
    </a>
  );
}
