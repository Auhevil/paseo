# Paseo Codely personal builds

This branch extends upstream Paseo 0.10.3. Keep `main` tracking upstream; develop and build personal changes on `codex/codely-provider-compat`. The Codely provider is a separate private repository, `Auhevil/paseo-codely-provider`. Do not add native histories, host state, pairing credentials, signing material or build artifacts to either repository.

## Reproduce a version

Use a dedicated checkout for each runtime version. Never clean or rebuild the checkout serving a running daemon. Record the full core and provider commit IDs, upstream version, `codely --version`, Node version and a build ID beside the delivered artifacts.

```sh
git clone --branch codex/codely-provider-compat https://github.com/Auhevil/paseo.git paseo-build
cd paseo-build
npm ci
npm run build:server
APP_VARIANT=codely npm run build:daemon-web-ui
```

Clone the private provider at the recorded commit, then follow its README to run `npm ci` and `npm run build`. Its build generates local launcher paths; rebuild it after moving the provider directory. Configure its command, data home and optional native project paths in `~/.config/paseo-codely/config.json`. Both chat and Terminal use that file. Do not copy Codely authentication into Paseo configuration.

Enable the provider as a directory plugin using [the plugin guide](docs/plugins.md). Use a separate Paseo home and an unused loopback port for acceptance. Set `features.webUi.enabled` to `true` to serve the bundled browser client. Run the provider's `scripts/configure-terminal.mjs --home /absolute/test-home --apply` once to append its Terminal profile without changing existing profiles.

## Android

Install Java 21 and the Android SDK required by `packages/app` and accept the applicable SDK licenses. Set `JAVA_HOME` and `ANDROID_HOME` to those installations. The first command creates a fixed personal key outside the checkout; subsequent runs retain it. Back up that directory privately: future APK upgrades require the same key.

```sh
node scripts/create-codely-signing.mjs
node scripts/build-codely-android.mjs
```

Default key directory: `~/.config/paseo-codely/android-signing`; override with `PASEO_CODELY_SIGNING_DIR`. The build passes credentials through the child environment, never generated Gradle files or command arguments. Output: `packages/app/android/app/build/outputs/apk/release/app-release.apk`.

Identity: `io.github.auhevil.paseo.codely`; scheme: `paseo-codely`. This installs beside the official app and the earlier test APK. Pair it as a new client. Use the same key and an increasing Android version code for future upgrades. Local Gradle packaging skips Android lint tasks; TypeScript, scoped lint and focused regression checks are separate acceptance steps.

## Apple Silicon macOS

```sh
node scripts/build-codely-macos.mjs
```

The script builds server, browser and Electron assets, then packages ARM64 without publishing. Outputs under `packages/desktop/release`: `mac-arm64/Paseo Codely.app`, `Paseo-Codely-0.10.3-arm64.dmg` and the corresponding ZIP. Local ad-hoc signing uses no Developer ID or notarization; the personal configuration disables hardened library validation because ad-hoc binaries have no shared Team ID.

Identity: `io.github.auhevil.paseo.codely.desktop`; scheme: `paseo-codely`; default client data directory: `~/Library/Application Support/Paseo Codely`. The official application and its data remain separate. This variant disables official automatic updates and connects to an independently started daemon using the selected Paseo home. Start that daemon before opening the app. Quitting the app leaves the independent daemon running.

## Guarded installation and rollback

Before switching, verify no agent has a running turn, approval, queued prompt or running/unacknowledged background work. Postpone the switch if any is active. Save private backups of configuration and persistence, the existing CLI symlink target, old runtime directory and provider directory. Preserve the existing Paseo home, server ID, workspaces, native handles and pairing data.

Stop the old daemon gracefully through its own CLI, update only the provider directory entry/profile as needed, and start the new CLI with the same `--home`. A worker-only restart does not replace the supervisor's executable. Keep the versioned runtime and provider directories in place after building.

The selector changes only an existing CLI symlink and defaults to dry-run:

```sh
node scripts/select-codely-cli.mjs \
  --link /absolute/bin/paseo \
  --previous /absolute/old-runtime/packages/cli/bin/paseo \
  --target /absolute/new-runtime/packages/cli/bin/paseo \
  --state /absolute/private-backups/cli-selection.json
```

Repeat with `--apply` after reviewing the selection. Roll back with the same arguments plus `--rollback --apply`. The selector refuses a changed symlink or a mismatched backup. It never starts or stops services. Keep the state file private and use a new one for each deployment.

If acceptance fails, stop only the new idle service, restore the configuration changes and CLI selection, and start the retained old runtime. Do not restore the entire Paseo home over newer conversations. Recheck identity, pairing, existing-session continuation and desktop-exit behavior after switching.

## Verification

Run scoped lint, formatting and typechecks. Run focused tests directly from their package directory; never run the full suite locally. Include the changed import UI, projection/storage/provider, desktop identity/update and provider plugin tests. Verify packaged startup, browser history/search/import, ordinary shell, Codely profile/resume, busy-session refusal and daemon independence. Android acceptance includes signature, alignment, package ID, architectures, supported API levels, emulator startup and user-performed device pairing/input/background/remote checks.

A build is not full acceptance. Record unperformed device checks and any provider/environment failure separately. Deliver checksums and the exact version combination beside APK, DMG and ZIP; do not publish a release automatically.

For upgrades: select an upstream stable version, merge on an upgrade branch, check provider compatibility, run focused regressions, rebuild affected platforms, preserve the old runtime and switch only when idle. Remove custom patches once upstream incorporates them.
