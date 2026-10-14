# Workbook mapping and calculations

See FEATURE-PARITY.md for the complete functional inventory. tools/extract-workbook.py reads the source without executing formulas and preserves nine sheets, 6,063 populated/formula cells, merged ranges, shared-formula metadata, 22 named ranges and chart metadata. The original XLSX is bundled for download unchanged.

public/workbook.js maps Overview, Roster, Schedule, Strategy, Checklists, Driver Availability and Config into editable application data. It retains all 71 source availability slots, including surplus slots, rather than truncating to the 24-hour event. The three optional time-of-day periods default disabled. Source driver chart colors are preserved. Only literal actual time/in-lap overrides are imported as recorded results; cached formulas are not mistaken for measurements.

The application uses the workbook's fractional final-stint lap calculation, cumulative in-lap tracking, inherited damage and pace-scaled tire-service calculation. Reserve and minimum rest are extra optional controls. Time-of-day factors are selected at stint start. The scheduler is a heuristic and exposes remaining conflicts.

Source errors and unsupported Google Sheets formula text remain visible in Full workbook. The application implements race calculations directly rather than evaluating arbitrary formula text. Source snapshots are not changed by application input edits. Browser persistence/JSON and CSV contain the edited plan; original XLSX download contains the source template.
