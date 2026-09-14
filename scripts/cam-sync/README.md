# cam-sync

Pulls a fresh JPEG from each Home Assistant camera and uploads it to the
`camera-snapshots` bucket, updating `property_cameras`.

**This does not run on Vercel.** Home Assistant listens on loopback only, so
nothing deployed can reach it. It runs on the operator's Mac under launchd,
every 5 minutes:

| | |
|---|---|
| launchd agent | `~/Library/LaunchAgents/com.wikibot.tero-cam-sync.plist` |
| interval | 300s (`StartInterval`) |
| log | `~/.openclaw/workspace/tero-cam-sync/sync.log` |
| credentials | `HA_URL` / `HA_TOKEN` in the repo's `.env.local` |

Manual run: `node scripts/cam-sync/sync.mjs`

## The three timestamps

They are different things, and conflating them cost two days of debugging:

- **`last_snapshot_at`** — when the camera actually took the picture, read from
  Home Assistant's `image_updated_at`. This is what the UI shows as the photo's
  age.
- **`last_synced_at`** — when this script last reached that camera. Written even
  when the image turns out to be unusable, so a stale capture alongside a recent
  sync reads as "the camera is mute", not "the sync died".
- The upload time is deliberately not stored: it is an implementation detail and
  would only add a third number to confuse.

## Freshness guard

The script refuses to record a capture unless Home Assistant reports
`image_source === "live"` and a plausible `image_updated_at`. After a config
entry reload the integration briefly serves an event thumbnail whose timestamp
reflects receipt, not capture — recording that would make a hours-old frame look
fresh. A `FAIL … event thumbnail has no verified capture time` line in the log is
this guard working, not a bug.

## Auto-reload when an image freezes

The Meari integration wedges itself every few hours: it keeps answering, but
stops producing new images. The script watches for that and reloads the config
entry on its own.

- A camera counts as frozen when its last capture is older than
  `STALE_AFTER_MINUTES` (120).
- After an automatic reload it will not try again for `RELOAD_COOLDOWN_MINUTES`
  (60), recorded in `last_reload_at`. Without that, a camera that cannot be
  recovered would reload its integration every five minutes, all day, against
  Cloud Plus.
- The thresholds are deliberately slack. These are battery cameras that sleep,
  and gaps close to an hour show up even when the integration is healthy — a
  short threshold would fight normal behaviour rather than a fault.
- Unlike a manual capture request, a failed auto-reload does not abort the
  cycle. The run continues and uploads whatever is available.

Expect a `FAIL … event thumbnail` on the cycle right after a reload, and
sometimes the one after that: the camera needs a moment to serve a live frame
again. Recovery within two or three cycles is normal, not a fault.

## Capture requests

Setting `property_cameras.capture_requested_at` queues a capture. On its next
cycle the script reloads that camera's config entry, waits up to 30s for
`image_updated_at` to advance, then clears the request — whether or not the
image moved, so a camera that cannot produce stills does not reload itself
forever.

Note that `homeassistant.update_entity` does **not** work for these cameras: it
returns HTTP 200 and changes nothing. `reload_config_entry` is what actually
unfreezes them.
