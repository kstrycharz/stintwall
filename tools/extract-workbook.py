"""Read the supplied workbook without modifying it or executing its formulas."""
import json
import posixpath
from pathlib import Path
import xml.etree.ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

def extract(path):
    with ZipFile(path) as archive:
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            strings = [''.join(e.itertext()) for e in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        rels = {e.attrib['Id']: e.attrib['Target'] for e in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
        sheets = []
        for sheet in workbook.find('m:sheets', NS):
            target = rels[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
            target = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
            tree = ET.fromstring(archive.read(target))
            cells = {}
            for cell in tree.findall('m:sheetData/m:row/m:c', NS):
                value = cell.find('m:v', NS)
                formula = cell.find('m:f', NS)
                kind = cell.attrib.get('t', 'n')
                raw = value.text if value is not None else None
                if kind == 's': raw = strings[int(raw)] if raw is not None else ''
                elif kind == 'inlineStr': raw = ''.join(cell.find('m:is', NS).itertext())
                elif kind == 'b': raw = raw == '1'
                elif kind == 'n' and raw is not None:
                    try: raw = float(raw)
                    except ValueError: pass
                if raw is not None or formula is not None:
                    cells[cell.attrib['r']] = {'value': raw, 'type': kind, 'style': cell.attrib.get('s')}
                    if formula is not None:
                        cells[cell.attrib['r']]['formula'] = formula.text or ''
                        cells[cell.attrib['r']]['formulaAttributes'] = formula.attrib
            sheets.append({'name': sheet.attrib['name'], 'cells': cells,
                           'merges': [e.attrib['ref'] for e in tree.findall('m:mergeCells/m:mergeCell', NS)]})
        charts = []
        cn = {'c': 'http://schemas.openxmlformats.org/drawingml/2006/chart', 'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}
        for name in archive.namelist():
            if name.startswith('xl/charts/chart') and name.endswith('.xml'):
                tree = ET.fromstring(archive.read(name))
                chart_colors = []
                for point in tree.findall('.//c:dPt',cn):
                    color = point.find('c:spPr/a:solidFill/a:srgbClr',cn)
                    if color is not None: chart_colors.append('#'+color.attrib['val'])
                charts.append({'title':' '.join(e.text or '' for e in tree.findall('.//c:title//a:t',cn)),
                               'colors':chart_colors,'references':[e.text for e in tree.findall('.//c:f',cn)]})
        return {'filename': path.name, 'sheets': sheets, 'charts': charts,
                'names': [dict(e.attrib, value=e.text) for e in workbook.findall('m:definedNames/m:definedName', NS)]}

if __name__ == '__main__':
    path = next(ROOT.glob('*.xlsx'))
    result = extract(path)
    (ROOT / 'public' / 'workbook.json').write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    print(f"Extracted {len(result['sheets'])} sheets and {sum(len(s['cells']) for s in result['sheets'])} cells")
