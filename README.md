# Stintwall

A black-and-red endurance race planner built from the supplied Sassy Enduro Manager v0.08.1d workbook. Hosted as a fully static GitHub Pages application. No irAI connection, account, Python backend or telemetry is required.

## Use

Open the GitHub Pages site. The public example contains 16 drivers, all 45 schedule rows, all nine original workbook tabs, eight configurable pace periods and the source chart. Example dates are June 2018; change them before a real event.

Set race dates, fuel, pace and team strategy in Race setup. Edit driver identities, iRating, pace, stint preferences and availability in Drivers. Edit assignments, tires, inherited damage, actual back-on-track time and cumulative in-lap in Schedule. Actual stint laps are derived from cumulative in-laps. Overview includes race deltas, fair share, fuel-stint averages, final-stint fuel and the driver-stint-percentage chart. Four independent manual fuel duration scenarios are in Race setup.

Plans save in this browser. They are not uploaded to GitHub and do not sync automatically across devices or teammates. Export JSON for backups or to transfer a filled plan to another browser. Restoring a plan downloads a backup first. CSV exports the schedule. Clearing browser/site data removes the saved browser plan.

Full workbook searches all original cells, cached values, formulas and named ranges. Original XLSX downloads the untouched source. Application edits are saved as JSON/CSV rather than written back to XLSX. This application implements the template's race-management features; it is not a general Excel formula editor or an Apps Script host. See [feature coverage](docs/FEATURE-PARITY.md).

## Development

Node 22 or later: npm ci, npm test, npm run build. Serve dist with any static HTTP server, including under a repository subpath. Vite's relative base keeps GitHub Pages assets working. npm run dev starts the development server.

The GitHub Actions workflow tests, builds and deploys main to GitHub Pages. The repository does not contain local saved plans, SQLite databases, logs, archived Git metadata or credentials.

The optional legacy local launcher and server remain usable for serving the static build. The active client stores plans in browser storage. Existing local browser recovery data is migrated when the app is opened on localhost. Local data/races.sqlite3 and its pre-rebuild backup remain on the original computer and are not published.
