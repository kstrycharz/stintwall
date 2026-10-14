# Troubleshooting

The hosted application needs only a browser. No irAI, Python or local API is required. See FEATURE-PARITY.md for the functional inventory.

Use Export race plan to back up data before clearing browser data, switching devices or refreshing after a conflicting-tab save. JSON restore carries the complete editable plan and original workbook cell snapshot. The public site starts with example data and does not publish your saved plan.

Update the example's June 2018 dates in Race setup. Use UTC for event and actual timestamps. Driver UTC offsets are fixed for the event. Availability intervals can be changed with existing coverage conservatively resampled.

Use cumulative Actual in-lap for stint results; actual stint laps are derived. Blank damage inherits the previous modifier; zero resets it. Surplus controls preserve recorded results. The original XLSX is a source download and does not contain app edits.

Development: npm ci, npm test, npm run build. GitHub Pages publishes main using the included Actions workflow. Relative asset paths support the repository subpath.
