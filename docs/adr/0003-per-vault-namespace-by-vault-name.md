# Namespace each vault by its name inside one Google account

**Status:** accepted

v0.1.0 assumed one Google account = one vault, so every vault signed in with
the same account wrote into the same `appDataFolder` and would have merged into
each other. We now prefix every remote file with a per-vault **namespace**
(`v/<namespace>/<path>`, tombstones at `m/<namespace>/tombstones.json`) and
pair devices by that namespace, which defaults to the vault's folder name and is
then pinned in the plugin's local data. The name is the only identifier a user
can make match across devices without copying hidden ids around; pinning it
means renaming a vault later doesn't silently re-point it.

## Considered options

- **One Google account per vault** — rejected: each account needs its own sign-in
  and test-user entry on every device.
- **Random vault id stored remotely** — rejected: a new device has no way to know
  which id is "its" vault without an extra picker UI.
- **Vault name, pinned at first run (chosen)** — zero setup when names match;
  editable in settings when they don't.

## Consequences

- Devices must use the same namespace for the same vault (e.g. the phone vault
  must be named `Gold2Go`, or have its namespace set to `Gold2Go`).
- v0.1.0 data was un-prefixed. On first sync after upgrading, a vault renames the
  remote files it owns (ids in its index) into its namespace in place, so ids and
  revisions are unchanged and nothing looks deleted. Legacy files it doesn't own
  are left untouched.
- Because a namespace mistake looks like "everything was deleted remotely", a
  safety stop aborts any pass that would delete most of the vault locally.
