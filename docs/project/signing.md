# Signing the app installers

The desktop app's installers come out of `pnpm --filter @svatah/yam-desktop make`
signed or unsigned depending on the environment the command runs in. With no
signing variables set, nothing is signed and the build is exactly the one this
repository made before signing existed. With them set, the macOS app is signed
with a Developer ID and notarized, and the Windows app and installer carry an
Authenticode signature. The test build (`YAM_APP_TEST_BUILD=1`, what the test
suites package) is never signed, whatever the environment holds.

`apps/desktop/forge.config.ts` makes the decision and prints one line saying what
it decided. `tools/repo-checks/test/installers.test.ts` loads that file under each
combination of variables and checks the result.

## What a release builds

The `app-installers` job in `.github/workflows/release.yml` runs on four
machines:

| Runner | Makes |
|---|---|
| `macos-latest` (Apple silicon) | `Yam-<version>-arm64.dmg`, `Yam-darwin-arm64-<version>.zip` |
| `macos-15-intel` | `Yam-<version>-x64.dmg`, `Yam-darwin-x64-<version>.zip` |
| `windows-latest` | `Yam-<version> Setup.exe`, the Squirrel `.nupkg` and `RELEASES`, a `.zip` |
| `ubuntu-latest` | a `.deb` and a `.zip` |

The Intel build runs on an Intel machine rather than being cross-built. `make`
stages the bundled CLI with `pnpm deploy`, which installs the prebuilt native
binaries for the machine it runs on. `macos-15-intel` is the last Intel image
GitHub provides, and GitHub has said it will be retired in August 2027.

The ZIP stays beside the DMG on macOS. An auto-updater downloads the ZIP, never a
disk image.

After `Make`, the step called `Signed or unsigned` inspects the files that were
made, not the secrets that were set, and writes one line to the log and the job
summary: signed and notarized, signed but not notarized, or unsigned.

## What the owner has to create

### macOS

1. **Membership in the Apple Developer Program**, as an organization, so that the
   certificate names Svatah Labs rather than a person. Enrolling an organization
   needs a D-U-N-S number.
2. **A Developer ID Application certificate.** Only the team's Account Holder can
   create one. In Keychain Access, use Certificate Assistant to request a
   certificate from a certificate authority and save the request to disk. Upload
   it at developer.apple.com under Certificates, choosing *Developer ID
   Application*. Download the certificate and double-click it to install it.
   Then, in Keychain Access, select the certificate *and its private key*, export
   both as a `.p12` file, and set a password. A `.p12` without the private key
   installs, and then cannot sign anything.
3. **The identity's name**, which is what `security find-identity -v -p codesigning`
   prints, for example `Developer ID Application: Svatah Labs (AB12CD34EF)`. The
   ten characters in brackets are the **Team ID**.
4. **Notarization credentials**, one of these two:
   - **An App Store Connect API key (preferred).** In App Store Connect, go to
     Users and Access, then Integrations, then Team Keys, and create a key with
     the *Developer* role. Download the `.p8` file. Apple lets you download it
     once. Note the **Key ID** and the **Issuer ID** shown above the list. The
     key belongs to the team, so it keeps working when a person leaves or
     changes their password.
   - **An Apple ID with an app-specific password.** Create the password at
     account.apple.com under Sign-In and Security. You also need the Team ID.

### Windows

**A code-signing certificate**, organization-validated (OV) or extended
validation (EV), from a certificate authority.

Since June 2023, certificate authorities have issued code-signing certificates
only with the private key on hardware: a USB token or a cloud HSM. A new
certificate can therefore almost never be exported as the `.pfx` file this
configuration reads. The PFX path works for a certificate that already exists as
a file. For a new one, choose one of these instead:

- **Azure Trusted Signing.** Microsoft holds the key, and `signtool` signs
  through a plug-in (`Azure.CodeSigning.Dlib.dll`) with a small JSON file naming
  the account and the certificate profile. This is usually the cheapest route
  for an organization, but it has eligibility rules. Check Microsoft's current
  ones before choosing it. To wire it in, `windowsSign` in `forge.config.ts`
  would drop `certificateFile` and `certificatePassword` and set:
  - `signToolPath`: a Windows SDK `signtool.exe` recent enough to load the
    plug-in;
  - `signWithParams`: `/dlib <path>\Azure.CodeSigning.Dlib.dll /dmdf <path>\metadata.json`;
  - `timestampServer`: `http://timestamp.acs.microsoft.com`;
  - `hashes`: SHA-256 only. `@electron/windows-sign` signs with SHA-1 and then
    SHA-256 by default, and Trusted Signing does not sign SHA-1. It adds the
    `/fd`, `/tr` and `/td` flags itself, so they do not belong in
    `signWithParams`.

  The workflow would need the Azure identity (`AZURE_TENANT_ID`,
  `AZURE_CLIENT_ID`, and a secret or a federated OIDC login) and would install
  the plug-in before `Make`. None of this is implemented, because nothing here
  can test it.
- **A certificate authority's cloud HSM** (DigiCert KeyLocker or SSL.com
  eSigner, for example). Each ships its own `signtool` integration, and it plugs
  into the same `signWithParams` or `hookModulePath` options of
  `@electron/windows-sign`.

Whichever you choose, the same options must reach both the packager, which signs
`Yam.exe` and its DLLs, and the Squirrel maker, which signs `Setup.exe` and
`Update.exe`. `forge.config.ts` already passes one object to both.

## The GitHub secrets

Set these as repository secrets (Settings, then Secrets and variables, then
Actions), or with `gh secret set <NAME>`. A secret the repository does not have
reaches the job as an empty value, and the configuration treats an empty value
as unset. With none of a platform's secrets, that platform's installers come out
unsigned and the verdict step says so. With only some of them, the build stops:
an identity whose certificate was not installed fails at signing, and an
incomplete notarization set fails before packaging starts.

| Secret | What it holds | Reaches |
|---|---|---|
| `APPLE_CERTIFICATE_P12` | The exported `.p12`, base64-encoded: `base64 -i DeveloperID.p12 \| gh secret set APPLE_CERTIFICATE_P12` | the keychain step, macOS only |
| `APPLE_CERTIFICATE_PASSWORD` | The `.p12` file's password | the keychain step, macOS only |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Svatah Labs (<TEAM ID>)` | `Make`, macOS only |
| `APPLE_API_KEY_P8` | The text of the `.p8` file: `gh secret set APPLE_API_KEY_P8 < AuthKey_<KEY ID>.p8` | `Make`, macOS only |
| `APPLE_API_KEY_ID` | The API key's Key ID | `Make`, macOS only |
| `APPLE_API_ISSUER` | The Issuer ID | `Make`, macOS only |
| `APPLE_ID` | The Apple ID's email address (only if you are not using an API key) | `Make`, macOS only |
| `APPLE_APP_SPECIFIC_PASSWORD` | The app-specific password | `Make`, macOS only |
| `APPLE_TEAM_ID` | The Team ID | `Make`, macOS only |
| `WINDOWS_CERTIFICATE_P12` | The `.pfx`, base64-encoded: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("yam.pfx"))` | the certificate step, Windows only |
| `WINDOWS_CERTIFICATE_PASSWORD` | The `.pfx` file's password | `Make`, Windows only |

Set one notarization method, not half of each. If some notarization variables
are set but neither set is complete, the build fails. The alternative would be
an app that is signed but not notarized, which verifies on the build machine and
is then refused on every Mac that downloads it.

The `app-installers` job has no `environment:`. So these secrets must be
repository secrets, not secrets of the `release` environment that the `publish`
job uses.

### Where each secret goes

No secret is set at workflow or job level. A secret set there would also reach
`pnpm install`, and through it every install script in the dependency tree. The
certificate files reach only the step that installs them, and the other
credentials reach only `Make`. Each is narrowed to the runner that uses it, so
the Linux leg holds none of them.

- On macOS, the `.p12` is imported into a temporary keychain with a random
  password. That keychain is added to the search list, its path is passed to
  Forge as `APPLE_KEYCHAIN`, and it is deleted at the end of the job.
- On Windows, the `.pfx` is written to the runner's temporary directory and its
  path is passed as `WINDOWS_CERTIFICATE_FILE`.

## Signing on your own machine

The configuration reads the same names, except that the API key and the Windows
certificate are paths to files:

```bash
# macOS, with the certificate in your login keychain
APPLE_SIGNING_IDENTITY="Developer ID Application: Svatah Labs (AB12CD34EF)" \
APPLE_API_KEY="$HOME/keys/AuthKey_ABC123DEFG.p8" \
APPLE_API_KEY_ID=ABC123DEFG \
APPLE_API_ISSUER=00000000-0000-0000-0000-000000000000 \
pnpm --filter @svatah/yam-desktop make
```

```powershell
# Windows
$env:WINDOWS_CERTIFICATE_FILE = "C:\keys\yam.pfx"
$env:WINDOWS_CERTIFICATE_PASSWORD = "..."
pnpm --filter @svatah/yam-desktop make
```

`APPLE_KEYCHAIN` is optional and names a keychain other than the default search
list. `WINDOWS_TIMESTAMP_SERVER` overrides the timestamp authority, which is
DigiCert's by default.

Notarization uploads the app to Apple and waits. Allow several minutes, and
longer for a first submission.

## Checking a signed build

### macOS

```bash
app=apps/desktop/out/Yam-darwin-arm64/Yam.app

# The signature is valid, covers every nested binary, and has nothing extra.
codesign --verify --deep --strict --verbose=2 "$app"

# Who signed it: Authority=Developer ID Application: ..., a TeamIdentifier,
# a Timestamp, and flags=0x10000(runtime), which is the hardened runtime.
codesign -dv --verbose=4 "$app"

# The entitlements: allow-jit and automation.apple-events, and nothing else.
codesign -d --entitlements - "$app"

# What Gatekeeper will say: "accepted  source=Notarized Developer ID".
spctl -a -vv -t exec "$app"

# The notarization ticket is stapled, so the check works offline.
xcrun stapler validate "$app"
```

The DMG is signed with the same identity, and `codesign -dv Yam-<version>-arm64.dmg`
shows it. The DMG itself is not notarized: the app inside it is the notarized,
stapled part, and Gatekeeper checks that app when it is first opened. So
`spctl -a -t open --context context:primary-signature Yam-<version>-arm64.dmg`
reports `Unnotarized Developer ID`, and that is expected.

If notarization fails, `xcrun notarytool log <submission id>` prints Apple's
reasons, file by file. Apple rejects a bundle that contains any unsigned Mach-O
file, a binary without the hardened runtime, or a signature without a secure
timestamp.

### Windows

```powershell
# From a Windows SDK command prompt. /pa uses the Authenticode policy.
signtool verify /pa /v "apps\desktop\out\make\squirrel.windows\x64\Yam-0.2.0 Setup.exe"
signtool verify /pa /v "apps\desktop\out\Yam-win32-x64\Yam.exe"

# Or, without the SDK:
Get-AuthenticodeSignature "apps\desktop\out\make\squirrel.windows\x64\Yam-0.2.0 Setup.exe"
```

A good result names the certificate's subject and a timestamp. Without the
timestamp, the signature stops being valid when the certificate expires.

### Checking the signing walk without a certificate

`codesign` accepts `-` as an ad-hoc identity. That is enough to check that
`@electron/osx-sign` can walk and sign everything in the bundle, including the
bundled CLI in `Contents/Resources/yam`, and that `codesign --verify --deep
--strict` accepts the result.

An ad-hoc-signed app with the hardened runtime does not launch, though. Library
validation requires every framework to have the app's Team ID, and ad-hoc
signatures have none. To launch one for a test, add
`com.apple.security.cs.disable-library-validation` to a copy of the
entitlements. Never add it to the file the release uses.

## What an unsigned build looks like to a person

### macOS

Electron's binaries carry an ad-hoc signature. That is enough for an Apple
silicon Mac to run the app, but not enough for Gatekeeper to accept a copy that
was downloaded.

- **macOS 15 and later:** opening the app shows a dialog saying Apple could not
  verify that it is free of malware, with *Done* and *Move to Trash*. To open it,
  go to System Settings, then Privacy & Security, and click *Open Anyway* next to
  the message about Yam. This needs an administrator's password.
- **macOS 13 and 14:** Control-click the app, choose *Open*, then choose *Open*
  again in the dialog.
- **From a terminal, on any version:** `xattr -dr com.apple.quarantine /Applications/Yam.app`.

A build that is signed but not notarized gets the same dialog. Gatekeeper looks
for notarization, not only for a signature.

Unsigned builds also lose privacy permissions on every update. macOS records
the Accessibility, Screen Recording and Automation grants against the app's
code signature. An ad-hoc signature changes with every build, so each new
unsigned version asks again, and the old entries stay in System Settings under
the same name. A Developer ID-signed app keeps its grants across updates,
because the requirement macOS records names the team and the bundle ID.

### Windows

Running an unsigned `Setup.exe` that was downloaded shows Microsoft Defender
SmartScreen's *Windows protected your PC* dialog with *Unknown publisher*. To
continue, click *More info*, then *Run anyway*. A browser may first warn that the
file is not commonly downloaded.

Signing replaces *Unknown publisher* with the organization's name. SmartScreen
reputation builds over downloads, so even a signed installer from a new
certificate can show the warning for a while after its first release.

### Linux

The `.deb` and `.zip` are not signed. `apt` and `dpkg` do not check signatures on
a `.deb` installed from a file, so nothing changes for the person installing it.
