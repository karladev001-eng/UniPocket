#!/usr/bin/env python3
"""Copy only the approved campus overview and location aliases into offline app resources.

Run from any directory. Indoor images, floor/room coordinates and routes are deliberately
excluded. The source documents remain in docs/harness; this does not modify those sources.
"""
import json
from pathlib import Path
import shutil

root = Path(__file__).resolve().parent.parent
source = root / 'docs/harness/assets/hamamatsu-map'
output = root / 'CampusCore/Sources/CampusCore/Resources'
output.mkdir(parents=True, exist_ok=True)
buildings = json.loads((source / 'buildings.json').read_text())
rooms = json.loads((source / 'rooms.json').read_text())
catalog = {key: buildings[key] for key in ('sourceDate', 'orientation', 'viewBox', 'accuracy')}
catalog['buildings'] = [
    {key: building[key] for key in ('id', 'name', 'category', 'short', 'mapCenter', 'mapPolygon')}
    for building in buildings['buildings']
]
catalog['roomAliases'] = [
    {key: room[key] for key in ('id', 'buildingID', 'aliases')}
    for room in rooms['rooms']
]
# These explicit display aliases name the same combined facilities in the supplied diagram.
extra = {'701': ['S-Port', 'Sポート', '浜松分館', '附属図書館浜松分館', '学生支援棟'],
         '806': ['南会館', '南館食堂'], '807': ['北会館', '北館食堂']}
for building in catalog['buildings']:
    building['aliases'] = extra.get(building['id'], [])
# The imported timetable spells the registered 共11–共51 rooms with this full building name.
# Add each known room explicitly, rather than accepting arbitrary numeric room prefixes.
for room in catalog['roomAliases']:
    if room['buildingID'] == '811' and room['id'].startswith('共'):
        room['aliases'].append('共通講義棟' + room['id'][1:])
(output / 'campus-map-catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')
shutil.copyfile(source / 'campus-map-overview.png', output / 'campus-map-overview.png')
