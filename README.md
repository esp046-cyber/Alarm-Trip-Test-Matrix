# Alarm & Trip Test Matrix

An offline-first Progressive Web App for Testing & Commissioning, Instrumentation, Control and PLC/DCS engineers to document alarm, trip and shutdown testing in the field.

**Safety:** this application is for documentation and workflow support only. It does not connect to, control, command or bypass any PLC, DCS, SCADA, interlock or equipment. The engineer performs the approved physical test and records the observed response.

## Files

| File | What it does |
|---|---|
| `index.html` | App shell: header, main view container, bottom navigation, modal sheet |
| `style.css` | High-contrast industrial theme, mobile-first, large touch targets |
| `app.js` | All logic: IndexedDB storage, projects, matrices, test runner, punch list, CSV, backup, reports, signatures |
| `manifest.json` | PWA metadata so the app can be installed to a home screen |
| `service-worker.js` | Caches the app shell for offline use, with versioned cache (`atm-v1`) |
| `icons/` | App icons (192, 512, and a maskable 512) |

## Run locally

Service workers need HTTP, not `file://`. From the project folder:

```
python3 -m http.server 8080
```

Then open `http://localhost:8080`. Any static server works.

## Test offline mode

1. Load the app once so the service worker installs.
2. Turn on airplane mode, or in DevTools → Network set *Offline*.
3. Reload. The app loads, the indicator reads **Offline**, and a note confirms changes are saved locally.
4. Create alarms, run tests, sign and export — all of it works with no network.

## Deploy to GitHub Pages

1. Create a repository and push these files to the repository root.
2. Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. Open `https://<user>.github.io/<repo>/`. All paths are relative, so it works from a subfolder.
4. After changing any file, bump `CACHE` in `service-worker.js` (e.g. `atm-v2`) so devices pick up the update.

## Install on Android

Chrome → open the site → menu (⋮) → **Install app** / **Add to Home screen**.

## Install on iPhone or iPad

Safari (not Chrome) → open the site → Share → **Add to Home Screen** → Add.

## Creating an alarm test

Projects → **New project** → save → **Open**. Then Alarms → **New alarm**: ID, tag, equipment, description, type, priority, setpoint and unit, direction, expected response, reset requirement, acceptance criteria, and the tolerance your procedure allows. Tolerance is never assumed — you set it per project or per test.

## Creating a trip test

Trips → **New trip**. Same fields plus expected trip action, expected safe state, expected associated alarm and reset requirement.

## Running a test

**Run test** on any row or card opens the runner. Perform the approved test, then record: timestamps (auto-stamped, editable, never silently overwritten), tested value against the setpoint with deviation and tolerance, actual priority, activation, acknowledgement, reset, HMI/SCADA checks, checklist, PASS / FAIL / N/A, comments and signatures. Save the record.

On FAIL, extra fields appear for failure description, expected and actual condition, possible cause, corrective action and retest flag, plus **Create punch item** which carries the test ID, tag, equipment and engineer across.

Retesting creates attempt #2, #3 and so on. Earlier results are never erased — see **History** on any item.

## Generating the final report

Reports → pick a report. It opens in a new tab formatted for print, with project information, alarm/trip details, every attempt, deviations, HMI results, failures, corrective actions, captured signatures and a sign-off block. Print or save as PDF. CSV exports and a full JSON backup are on the same screen and in Settings.

## Location stamps

In the test runner, **Capture current location** records latitude, longitude and accuracy at the moment of testing, using the device's GPS. This is useful on large sites with several areas, so a report shows exactly where each test happened. It requires the browser to have location permission for the site — if it's denied, the app explains this and testing continues normally with the field left blank. Location never affects pass/fail; it's purely a record. A **View on map** link opens the point in Maps (needs a connection); the coordinates themselves are stored offline like everything else and appear in the full test report and the test-results CSV export.

## Data

Everything is stored in IndexedDB in the browser and survives refresh, browser restart and app restart. Nothing leaves the device. Use **Export full backup** in Settings before wiping a device or moving to another one; **Import backup** validates the file and asks for confirmation before replacing anything.
