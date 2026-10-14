# Spreadsheet feature coverage

Reference: Sassy Enduro Manager v0.08.1d, the supplied nine-tab example workbook. Functional inventory includes the workbook's changelog and configuration commands, not just populated input cells.

| Workbook feature | Application location |
| --- | --- |
| Qualifying, registration, goals, retirement, backup communications, setup and practice | Race setup, Team strategy |
| Incoming and outgoing checklist items | Checklists and individual handover dialog; all eight source items retained |
| Race duration, session start, green offset, race start/end, simulated start/end | Race setup and Overview calculations |
| Tank, standard and saving pace/consumption, pit duration, tire duration and global tire-time switch | Race setup |
| Standard/saving lap count, lap including pit average, track time, with-pit time and fuel per stint | Overview, Fuel stint averages |
| Five named and three optional time-of-day factors | Race setup, eight enabled/disabled periods |
| Individual driver factors | Edit driver, used in schedule calculations |
| Timing delta, lap delta, time lost, ideal/projected on-track duration and total race laps | Overview calculations and detailed stint columns |
| Ideal/projected fair-share laps and fuel stints | Overview calculations and driver summaries |
| Final-stint standard/saving fuel, plus-one-lap fuel | Overview final-stint calculator |
| Four editable manual fuel duration scenarios | Race setup, Manual fuel duration scenarios |
| Four stint types (standard/saving, with/without tires) | Edit stint |
| UTC, simulated and driver-local start/end, final and surplus markers | Detailed schedule |
| Actual back-on-track time and cumulative in-lap, derived stint laps and lap delta | Edit stint, handover, schedule |
| Inherited damage modifier with explicit overrides | Edit stint; blank inherits, zero resets |
| Consecutive-stint count/preferences, availability status, combined pace factors | Schedule columns and conflict flags |
| Driver names, colors, offsets, iRating, preference and driver IDs | Drivers and Edit driver |
| Average iRating ignoring unset/nonpositive ratings | Overview calculations |
| Availability interval configuration | Race setup; existing coverage is resampled conservatively |
| Open, Tentative, Blocked and Unassigned availability | Clickable availability grid |
| Driver-local availability times and first/second overlapping stint mapping | Availability times and mapped stints; all overlaps are included |
| Reset Driver Availability command | Drivers toolbar; backup before reset |
| Update Driver Colors command and automatic propagation on rename/color edits | Drivers toolbar; identity-based assignments and colors across chart, schedule and availability |
| Update Stint Visibility, hide/show surplus, unassign surplus | Schedule controls; recorded results protected |
| Driver Stint Percentages doughnut chart | Overview, matching source chart roster counts/colors |
| Changelog and developer/internal cells/configuration/named ranges | Full workbook, all nine tabs and named ranges |
| Persisting and transferring the filled plan | Browser persistence, JSON backup/restore, schedule CSV |

Independent comparison tests verify the example's race-lap total, final fractional stint, fair share, average rating, final fuel and manual fuel against cached worksheet values. Tests also change cumulative in-laps, inherited damage, optional factors, tire-time inclusion and availability interval.

This is an application implementation of this template, not a general Excel/Google Sheets formula editor or an Apps Script host. Spreadsheet UI menus are represented by application controls. The original XLSX is downloadable unchanged; JSON and CSV contain application edits. GitHub Pages plans are private to each browser and do not automatically sync between teammates or devices. No local SQLite database or private saved plan is included in the public repository.
