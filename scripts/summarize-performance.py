#!/usr/bin/env python3
"""Summarize CAMPUS_PERF logs without inventing missing runs; median, p90 and worst."""
import argparse, collections, json, statistics
from pathlib import Path
p = argparse.ArgumentParser(); p.add_argument('logs', nargs='+', type=Path); a = p.parse_args()
groups = collections.defaultdict(list)
for log in a.logs:
    visits = collections.Counter()
    for line in log.read_text().splitlines():
        if 'CAMPUS_PERF ' not in line: continue
        try: row = json.loads(line.split('CAMPUS_PERF ', 1)[1])
        except ValueError: continue
        event = row['event']
        if event in ('data_loaded', 'first_display_tick', 'data_display_tick'):
            groups[event].append(row['ms'])
        elif event == 'tab_display_tick':
            tab = row['tab']; visits[tab] += 1
            groups[f'tab_{tab}_visit_{visits[tab]}'].append(row['duration_ms'])
for key, values in sorted(groups.items()):
    ordered = sorted(values); p90 = ordered[max(0, (len(ordered) * 9 + 9) // 10 - 1)]
    print(f'{key}: n={len(values)} median_ms={statistics.median(values):.2f} p90_ms={p90:.2f} max_ms={max(values):.2f}')
